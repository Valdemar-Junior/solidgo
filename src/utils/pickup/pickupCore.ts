// Lógica compartilhada de RETIRADA por item, usada tanto na roteirização (admin)
// quanto na liberação de saída de loja (gerente). Mantém um só lugar pra:
//  - gravar a retirada (order_withdrawals, com snapshot dos itens quando parcial);
//  - marcar os itens retirados como terminais (order_item_holds status 'picked_up');
//  - gerar a montagem automática só dos itens retirados;
//  - fechar o pedido (status 'delivered') só quando nada mais sobra.
import { supabase } from '../../supabase/client';
import { syncAssemblyProductsForPickup, syncAssemblyProductsForPickupItems } from '../assembly/syncAssemblyProducts';
import { pickupItemKey, pickupHoldMatchesItem, buildPickupHoldPayload } from './pickupMatch';

// Re-exporta os helpers puros (mantém os imports existentes das telas funcionando).
export { pickupItemKey, pickupHoldMatchesItem, buildPickupHoldPayload };

export interface RegisterPickupParams {
  order: any;
  /** Todos os itens do pedido que ainda podem ser retirados (exclui os já retirados). */
  allDeliverableItems: any[];
  /** Subconjunto que o cliente está levando agora. */
  pickedItems: any[];
  responsibleName: string;
  notes?: string | null;
  registeredByUserId?: string | null;
  registeredByName?: string | null;
}

export interface RegisterPickupResult {
  withdrawal: any;
  isPartial: boolean;
  /** Erro NÃO fatal ao sincronizar montagem (pra avisar sem derrubar a retirada). */
  assemblyError?: unknown;
}

// Marca itens como retirados (terminal). Idempotente: se o item já está 'picked_up',
// não faz nada (evita duplicar). Reaproveita a pausa 'active' (Em Espera) se existir.
async function markItemsPickedUp(order: any, items: any[], now: string) {
  const { data: existingHolds } = await supabase
    .from('order_item_holds')
    .select('*')
    .eq('order_id', order.id)
    .in('status', ['active', 'picked_up']);

  for (const it of items) {
    const alreadyPicked = (existingHolds || []).find((h: any) => h.status === 'picked_up' && pickupHoldMatchesItem(h, it));
    if (alreadyPicked) continue; // idempotente: item já retirado

    const activeHold = (existingHolds || []).find((h: any) => h.status === 'active' && pickupHoldMatchesItem(h, it));
    if (activeHold) {
      const { error } = await supabase.from('order_item_holds')
        .update({ status: 'picked_up', hold_type: 'retirada', released_at: null, updated_at: now })
        .eq('id', activeHold.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('order_item_holds')
        .insert(buildPickupHoldPayload(order, it, { hold_type: 'retirada', status: 'picked_up' }));
      if (error) throw error;
    }
  }
}

// Remove os itens retirados de rotas AINDA NÃO finalizadas (snapshot route_order_items),
// pra o motorista não conseguir entregar de novo o que já foi retirado.
async function cancelRouteItemsForPickup(order: any, items: any[], now: string) {
  const { data: roItems } = await supabase
    .from('route_order_items')
    .select('id, order_item_id, source_line_key, sku_snapshot, storage_location_snapshot, status, route:route_id(status)')
    .eq('order_id', order.id);

  const toCancel = (roItems || []).filter((ri: any) => {
    const routeStatus = ri.route?.status;
    if (routeStatus === 'completed') return false;               // rota finalizada não se mexe
    if (ri.status === 'delivered' || ri.status === 'cancelled') return false;
    const like = { source_line_key: ri.source_line_key, sku: ri.sku_snapshot, storage_location: ri.storage_location_snapshot };
    return items.some((it) => {
      if (ri.order_item_id && it?.order_item_id && String(ri.order_item_id) === String(it.order_item_id)) return true;
      return pickupHoldMatchesItem(like, it);
    });
  });

  for (const ri of toCancel) {
    const { error } = await supabase.from('route_order_items')
      .update({ status: 'cancelled', allocated_quantity: 0, deliverable_quantity_snapshot: 0, updated_at: now })
      .eq('id', ri.id);
    if (error) throw error;
  }
}

export async function registerPickupForOrder(params: RegisterPickupParams): Promise<RegisterPickupResult> {
  const { order, allDeliverableItems, pickedItems, responsibleName, notes, registeredByUserId, registeredByName } = params;
  if (!pickedItems || pickedItems.length === 0) {
    throw new Error('Selecione ao menos um item para a retirada.');
  }

  const now = new Date().toISOString();
  const pickedKeys = new Set(pickedItems.map(pickupItemKey));
  const remaining = (allDeliverableItems || []).filter((it) => !pickedKeys.has(pickupItemKey(it)));
  const isPartial = remaining.length > 0;

  // 1) Registra a retirada como um NOVO evento (várias retiradas por pedido).
  //    Snapshot dos itens só quando é parcial (retirada inteira usa items_json do pedido).
  const { data: withdrawal, error: wErr } = await supabase
    .from('order_withdrawals')
    .insert({
      order_id: order.id,
      responsible_name: responsibleName,
      notes: notes?.trim() || null,
      withdrawn_at: now,
      registered_by_user_id: registeredByUserId || null,
      registered_by_name: registeredByName || null,
      source: 'manual',
      items: isPartial ? pickedItems : null,
    })
    .select('*')
    .single();
  if (wErr) throw wErr;

  // 2) Marca os itens retirados como terminais.
  await markItemsPickedUp(order, pickedItems, now);

  // 2b) Cancela esses itens em rotas já criadas (some pro motorista) — evita entrega dupla.
  await cancelRouteItemsForPickup(order, pickedItems, now);

  // 3) Montagem + status do pedido.
  let assemblyError: unknown;
  if (isPartial) {
    try {
      await syncAssemblyProductsForPickupItems(
        String(order.id),
        pickedItems.map((it) => String(it?.sku || '').trim()).filter(Boolean)
      );
    } catch (e) { assemblyError = e; }
  } else {
    const { error: updErr } = await supabase
      .from('orders')
      .update({ status: 'delivered', updated_at: now })
      .eq('id', order.id);
    if (updErr) throw updErr;
    try {
      await syncAssemblyProductsForPickup(String(order.id));
    } catch (e) { assemblyError = e; }
  }

  return { withdrawal, isPartial, assemblyError };
}
