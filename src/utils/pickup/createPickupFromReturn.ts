import { supabase } from '../../supabase/client';

// Fluxo COMPLETO de "gerar coleta" a partir de um evento de devolução —
// extraído da Gestão de Entregas pra ser usado também pela Central de
// Devoluções (mesma lógica, um lugar só):
//   1. trava de duplicidade (coleta já criada / criada em outra tela)
//   2. cria o pedido-clone C- (só com os itens devolvidos, sem montagem)
//   3. cria a rota COLETA- com a equipe escolhida
//   4. registra o vínculo oficial (rpc register_order_return_pickup)
//   5. se algo falhar no meio, desfaz o que criou (rollback)
//
// Auto-suficiente de propósito: não usa toast nem estado de tela — quem
// chama decide como avisar o usuário.

const PICKUP_PLACEHOLDER_DRIVER_ID = '6bb1d41b-0a88-4468-8902-c42402fc0aeb';

export type CreatePickupResult =
  | { status: 'already_created' }
  | { status: 'synced_existing' }
  | { status: 'created'; pickupOrderErp: string; routeName: string };

// ---------- helpers de XML (nota de devolução) ----------

function elementsByLocalName(root: Document | Element, name: string): Element[] {
  return Array.from(root.querySelectorAll('*')).filter((el) => el.localName === name);
}

function nodeText(parent: Element, name: string): string {
  const el = elementsByLocalName(parent, name)[0];
  return (el?.textContent || '').trim();
}

function normalizeLookupText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

type PickupItem = {
  sku: string;
  name: string;
  quantity: number;
  purchased_quantity: number;
  location?: string;
  brand?: string;
  [key: string]: unknown;
};

function parsePickupItemsFromReturnXml(xmlText: string): Array<Partial<PickupItem>> {
  const xml = String(xmlText || '').trim();
  if (!xml || !xml.includes('<')) return [];
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xml, 'application/xml');
    if (xmlDoc.getElementsByTagName('parsererror').length > 0) return [];

    return elementsByLocalName(xmlDoc, 'det')
      .map((det) => {
        const prod = elementsByLocalName(det, 'prod')[0];
        if (!prod) return null;
        const sku = nodeText(prod, 'cProd');
        const name = nodeText(prod, 'xProd');
        const quantityRaw = nodeText(prod, 'qCom') || nodeText(prod, 'qTrib') || '1';
        const quantity = Number(String(quantityRaw).replace(',', '.'));
        if (!sku && !name) return null;
        return { sku, name, quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1 };
      })
      .filter(Boolean) as Array<Partial<PickupItem>>;
  } catch {
    return [];
  }
}

// Itens da coleta a partir do XML da devolução, enriquecidos com os itens do
// pedido original (local de estocagem, marca...). Fallback usado quando a
// camada estruturada (order_return_items) não tem os itens.
function buildPickupItemsFromXml(order: any, returnXml: string): PickupItem[] {
  const orderItems: any[] = Array.isArray(order?.items_json) ? order.items_json : [];
  const parsedItems = parsePickupItemsFromReturnXml(order?.return_nfe_xml || returnXml || '');
  if (parsedItems.length === 0) return orderItems as PickupItem[];

  const rawProducts: any[] = Array.isArray(order?.raw_json?.produtos_locais)
    ? order.raw_json.produtos_locais
    : (Array.isArray(order?.raw_json?.produtos) ? order.raw_json.produtos : []);

  const usedIndexes = new Set<number>();
  const findMatch = (pickupItem: Partial<PickupItem>) => {
    const pickupSku = normalizeLookupText(pickupItem?.sku);
    const pickupName = normalizeLookupText(pickupItem?.name);

    const bySku = orderItems.findIndex((c, idx) => !usedIndexes.has(idx)
      && pickupSku && normalizeLookupText(c?.sku) === pickupSku);
    if (bySku >= 0) return bySku;

    const byName = orderItems.findIndex((c, idx) => !usedIndexes.has(idx)
      && pickupName && normalizeLookupText(c?.name) === pickupName);
    if (byName >= 0) return byName;

    return orderItems.findIndex((c, idx) => {
      if (usedIndexes.has(idx)) return false;
      const candidateName = normalizeLookupText(c?.name);
      return Boolean(pickupName && candidateName
        && (candidateName.includes(pickupName) || pickupName.includes(candidateName)));
    });
  };

  return parsedItems.map((pickupItem) => {
    const matchIndex = findMatch(pickupItem);
    if (matchIndex >= 0) usedIndexes.add(matchIndex);
    const matched = matchIndex >= 0 ? orderItems[matchIndex] : null;

    const rawMatch = rawProducts.find((product: any) => {
      const productCode = normalizeLookupText(product?.codigo_produto);
      const productName = normalizeLookupText(product?.nome_produto);
      const pickupSku = normalizeLookupText(pickupItem?.sku);
      const pickupName = normalizeLookupText(pickupItem?.name);
      return (pickupSku && productCode === pickupSku)
        || (pickupName && productName === pickupName)
        || Boolean(pickupName && productName
          && (productName.includes(pickupName) || pickupName.includes(productName)));
    }) || null;

    const quantity = Number(pickupItem?.quantity ?? matched?.purchased_quantity ?? matched?.quantity ?? 1);
    const safeQty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;

    return {
      ...(matched || {}),
      sku: String(pickupItem?.sku || matched?.sku || rawMatch?.codigo_produto || ''),
      name: String(pickupItem?.name || matched?.name || rawMatch?.nome_produto || ''),
      quantity: safeQty,
      purchased_quantity: safeQty,
      location: matched?.location || rawMatch?.local_estocagem || '',
      brand: matched?.brand || rawMatch?.marca || '',
    };
  }).filter((item) => String(item?.sku || item?.name || '').trim().length > 0);
}

// Itens devolvidos da camada estruturada (order_return_items) — a fonte
// preferida: reflete exatamente O QUE e QUANTO voltou, inclusive em parciais.
async function fetchStructuredReturnItems(returnId: string): Promise<PickupItem[]> {
  try {
    const { data, error } = await supabase
      .from('order_return_items')
      .select(`
        source_item_key,
        returned_quantity,
        sku_snapshot,
        product_name_snapshot,
        return:order_returns!inner (id, processing_status),
        order_item:order_items (sku, product_name, storage_location, source_payload)
      `)
      .eq('return.id', returnId)
      .eq('return.processing_status', 'processed');

    if (error) throw error;
    if (!data || data.length === 0) return [];

    const grouped = new Map<string, PickupItem>();
    for (const [index, row] of (data as any[]).entries()) {
      const key = String(row?.source_item_key || row?.sku_snapshot || row?.product_name_snapshot || `return-item-${index}`);
      const current = grouped.get(key) || {
        sku: String(row?.sku_snapshot || row?.order_item?.sku || '').trim(),
        name: String(row?.product_name_snapshot || row?.order_item?.product_name || '').trim(),
        quantity: 0,
        purchased_quantity: 0,
        location: String(row?.order_item?.storage_location || '').trim(),
        brand: '',
      };

      const sourcePayload = Array.isArray(row?.order_item?.source_payload) ? row.order_item.source_payload : [];
      const sourceSample = sourcePayload[0] || {};
      const returnedQuantity = Number(row?.returned_quantity || 0);

      current.quantity += Number.isFinite(returnedQuantity) ? returnedQuantity : 0;
      current.purchased_quantity += Number.isFinite(returnedQuantity) ? returnedQuantity : 0;
      if (!current.location) {
        current.location = String(sourceSample?.location || sourceSample?.local_estocagem || row?.order_item?.storage_location || '').trim();
      }
      if (!current.brand) {
        current.brand = String(sourceSample?.brand || sourceSample?.marca || '').trim();
      }
      grouped.set(key, current);
    }

    return Array.from(grouped.values())
      .filter((item) => String(item?.sku || item?.name || '').trim().length > 0)
      .map((item) => ({
        ...item,
        quantity: item.quantity > 0 ? item.quantity : 1,
        purchased_quantity: item.purchased_quantity > 0 ? item.purchased_quantity : 1,
      }));
  } catch (error) {
    console.warn('[createPickupFromReturn] Falha ao buscar itens estruturados da devolução:', error);
    return [];
  }
}

// ---------- o fluxo principal ----------

export async function createPickupFromReturn(params: {
  returnId: string;
  teamId: string;
  observations?: string;
  conferenteName?: string;
}): Promise<CreatePickupResult> {
  const { returnId, teamId } = params;
  const observations = String(params.observations || '').trim();
  const conferenteName = String(params.conferenteName || 'Conferente').trim() || 'Conferente';

  if (!returnId) throw new Error('Evento de devolução não informado.');
  if (!teamId) throw new Error('Selecione uma equipe.');

  // Evento de devolução (fresco do banco — evita estado velho da tela)
  const { data: returnRecord, error: returnError } = await supabase
    .from('order_returns')
    .select('id, order_id, return_nfe_number, return_nfe_key, return_date, return_type, return_xml, reason, processing_status, pickup_created_at, pickup_order_id, pickup_route_id')
    .eq('id', returnId)
    .single();
  if (returnError) throw returnError;
  if (!returnRecord) throw new Error('Evento de devolução não encontrado.');

  if (returnRecord.pickup_created_at || returnRecord.pickup_order_id || returnRecord.pickup_route_id) {
    return { status: 'already_created' };
  }

  // Pedido original (campos necessários pro clone — sem os PDFs pesados)
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, order_id_erp, customer_name, phone, customer_cpf, address_json, items_json, raw_json, filial_venda, data_venda, blocked_reason, return_nfe_xml, return_nfe_number, return_nfe_key, return_date, return_type, return_danfe_base64')
    .eq('id', returnRecord.order_id)
    .single();
  if (orderError) throw orderError;
  if (!order) throw new Error('Pedido original da devolução não encontrado.');

  // Equipe → motorista/ajudante
  const { data: teamData, error: teamError } = await supabase
    .from('teams_user')
    .select('id, name, driver_user_id, helper_user_id')
    .eq('id', teamId)
    .single();
  if (teamError) throw teamError;

  let driverIdToUse: string | null = null;
  if (teamData?.driver_user_id) {
    const { data: driverRow } = await supabase
      .from('drivers')
      .select('id')
      .eq('user_id', teamData.driver_user_id)
      .maybeSingle();
    if (driverRow?.id) driverIdToUse = String(driverRow.id);
  }
  if (!driverIdToUse) {
    console.warn('[createPickupFromReturn] Motorista da equipe não encontrado. Usando placeholder.');
    driverIdToUse = PICKUP_PLACEHOLDER_DRIVER_ID;
  }
  const helperIdToUse = teamData?.helper_user_id || null;

  const newOrderErpId = `C-${order.order_id_erp}-RET-${String(returnId).slice(0, 8).toUpperCase()}`;

  // Trava de duplicidade: pedido C- já existe?
  const { data: existingPickupOrder } = await supabase
    .from('orders')
    .select('id, order_id_erp, created_at, raw_json')
    .eq('order_id_erp', newOrderErpId)
    .maybeSingle();

  if (existingPickupOrder?.id) {
    const { data: existingRouteOrder, error: existingRouteOrderError } = await supabase
      .from('route_orders')
      .select('route_id')
      .eq('order_id', existingPickupOrder.id)
      .limit(1)
      .maybeSingle();
    if (existingRouteOrderError) throw existingRouteOrderError;

    if (existingRouteOrder?.route_id) {
      const { error: registerExistingError } = await supabase.rpc('register_order_return_pickup', {
        p_return_id: returnId,
        p_pickup_order_id: existingPickupOrder.id,
        p_pickup_route_id: existingRouteOrder.route_id,
      });
      if (registerExistingError) throw registerExistingError;
      return { status: 'synced_existing' };
    }

    const existingSourceReturnId = String((existingPickupOrder.raw_json as any)?.pickup_context?.source_return_id || '');
    if (existingSourceReturnId !== String(returnId)) {
      throw new Error('Já existe um pedido com o mesmo identificador, mas ele não pertence a esta devolução.');
    }

    const existingCreatedAt = new Date(existingPickupOrder.created_at || 0).getTime();
    if (Number.isFinite(existingCreatedAt) && Date.now() - existingCreatedAt < 2 * 60 * 1000) {
      throw new Error('Esta coleta parece estar sendo criada em outra tela. Aguarde alguns segundos e atualize.');
    }

    // Tentativa antiga interrompida: limpa o órfão e recomeça
    const { error: deleteOrphanError } = await supabase
      .from('orders')
      .delete()
      .eq('id', existingPickupOrder.id);
    if (deleteOrphanError) throw deleteOrphanError;
  }

  // Itens da coleta: estruturados primeiro; fallback pro XML se for total
  const structuredItems = await fetchStructuredReturnItems(returnId);
  const isTotalReturn = ['total', 'devolucao_total', 'devolução total']
    .includes(String(returnRecord.return_type || '').trim().toLowerCase());
  const pickupItems = structuredItems.length > 0
    ? structuredItems
    : (isTotalReturn ? buildPickupItemsFromXml(order, String(returnRecord.return_xml || '')) : []);

  if (!pickupItems.length) {
    throw new Error('Não foi possível identificar os itens desta devolução para montar a coleta.');
  }

  const danfeBase64 = String(order.return_danfe_base64 || '');

  let createdPickupOrderId: string | null = null;
  let createdPickupRouteId: string | null = null;

  try {
    // Pedido-clone C- (sem montagem; nasce pendente pra rotear a coleta)
    const { data: newOrderData, error: newOrderError } = await supabase
      .from('orders')
      .insert({
        order_id_erp: newOrderErpId,
        customer_name: order.customer_name,
        phone: order.phone,
        customer_cpf: order.customer_cpf,
        address_json: order.address_json,
        items_json: pickupItems.map((item) => ({
          ...item,
          tem_montagem: false,
          has_assembly: false,
          assembly_status: null,
        })),
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        raw_json: {
          ...(order.raw_json && typeof order.raw_json === 'object' ? order.raw_json : {}),
          pickup_context: {
            source_order_id: order.id,
            source_order_id_erp: order.order_id_erp,
            source_return_id: returnId,
          },
        },
        xml_documento: null,
        return_nfe_xml: returnRecord.return_xml || order.return_nfe_xml || null,
        return_nfe_number: returnRecord.return_nfe_number || order.return_nfe_number,
        return_nfe_key: returnRecord.return_nfe_key || order.return_nfe_key || null,
        return_date: returnRecord.return_date || order.return_date || null,
        return_type: returnRecord.return_type || order.return_type || null,
        danfe_base64: null,
        return_danfe_base64: danfeBase64 || null,
        danfe_gerada_em: danfeBase64 ? new Date().toISOString() : null,
        filial_venda: order.filial_venda,
        data_venda: order.data_venda,
        observacoes_internas: `PEDIDO DE COLETA GERADO AUTOMATICAMENTE.\nOrigem: ${order.order_id_erp}\nEvento de devolução: ${returnId}\nMotivo: ${order.blocked_reason || returnRecord.reason || 'Devolução'}`.slice(0, 1000),
        return_flag: false,
        requires_pickup: false,
        pickup_created_at: null,
        blocked_at: null,
      })
      .select()
      .single();
    if (newOrderError) throw newOrderError;
    createdPickupOrderId = String(newOrderData.id);

    // Rota de coleta
    const routeName = `COLETA-${returnRecord.return_nfe_number || order.order_id_erp}-${new Date().toLocaleDateString('pt-BR').replace(/\//g, '')}`;
    const { data: routeData, error: routeError } = await supabase
      .from('routes')
      .insert({
        name: routeName,
        team_id: teamId,
        driver_id: driverIdToUse,
        helper_id: helperIdToUse,
        vehicle_id: null,
        status: 'pending',
        observations: `Coleta de devolução. NF: ${returnRecord.return_nfe_number || '-'}. Resp: ${conferenteName}. ${observations}`.trim(),
      })
      .select()
      .single();
    if (routeError) throw routeError;
    createdPickupRouteId = String(routeData.id);

    const { error: roError } = await supabase.from('route_orders').insert({
      route_id: routeData.id,
      order_id: newOrderData.id,
      sequence: 1,
      status: 'pending',
      delivery_observations: `Coleta de devolução. NF: ${returnRecord.return_nfe_number || '-'}. Motivo: ${order.blocked_reason || returnRecord.reason || '-'}`,
    });
    if (roError) throw roError;

    // Vínculo oficial da devolução com a coleta
    const { error: registerError } = await supabase.rpc('register_order_return_pickup', {
      p_return_id: returnId,
      p_pickup_order_id: newOrderData.id,
      p_pickup_route_id: routeData.id,
    });
    if (registerError) throw registerError;

    return { status: 'created', pickupOrderErp: newOrderErpId, routeName };
  } catch (error) {
    // Desfaz o que criou nesta tentativa (o vínculo oficial ainda não existia)
    if (createdPickupRouteId) {
      const { error: cleanupRouteError } = await supabase.from('routes').delete().eq('id', createdPickupRouteId);
      if (cleanupRouteError) console.warn('[createPickupFromReturn] Falha ao limpar rota incompleta:', cleanupRouteError);
    }
    if (createdPickupOrderId) {
      const { error: cleanupOrderError } = await supabase.from('orders').delete().eq('id', createdPickupOrderId);
      if (cleanupOrderError) console.warn('[createPickupFromReturn] Falha ao limpar pedido incompleto:', cleanupOrderError);
    }
    throw error;
  }
}
