// Logica pura da FILA de roteirizacao: dado um pedido + saldos por item,
// devolve as linhas operacionais (o que ainda falta entregar).
// Extraido de RouteCreation.tsx para ficar testavel. SEM React/Supabase.
import type { OrderItemShadowBalance, OrderItemHold, WaitingAutoRules } from '../../types/database';
import { hasDeliverableBalance } from '../itemFulfillment';

// Contexto opcional da aba "Em Espera": esconde da fila os itens pausados.
export interface HoldContext {
  holdsByOrderId?: Record<string, OrderItemHold[]>;
  autoRules?: WaitingAutoRules | null;
  today?: string; // 'YYYY-MM-DD'
}

const norm = (v: any) => String(v ?? '').trim().toLowerCase();

// Um hold "manual/scheduled" esta ATIVO (segura o item fora da fila) quando:
//  - status = 'active', E
//  - nao e um agendamento cuja data ja chegou (esse volta sozinho pra fila).
export function isHoldActiveOn(hold: OrderItemHold, today: string): boolean {
  if (hold.status !== 'active') return false;
  if (hold.hold_type === 'scheduled' && hold.scheduled_date) {
    // data <= hoje  => venceu => item volta pra fila (nao segura mais)
    return String(hold.scheduled_date) > today;
  }
  return true;
}

// O pedido casa com alguma regra de move automatico (palavra na observacao
// interna OU operacao do ERP)? O move automatico e a NIVEL DE PEDIDO.
export function orderMatchesAutoWaiting(order: any, autoRules?: WaitingAutoRules | null): boolean {
  if (!autoRules) return false;
  const raw: any = order?.raw_json || {};
  const obs = norm(order?.observacoes_internas || raw.observacoes_internas);
  const keywords = Array.isArray(autoRules.keywords) ? autoRules.keywords : [];
  if (obs && keywords.some((k) => k && obs.includes(norm(k)))) return true;

  const operation = norm(order?.raw_json?.operacoes ?? order?.operacoes);
  const operations = Array.isArray(autoRules.operations) ? autoRules.operations : [];
  if (operation && operations.some((op) => op && norm(op) === operation)) return true;

  return false;
}

function holdMatchesItem(hold: OrderItemHold, item: any): boolean {
  const holdKey = norm(hold.source_line_key);
  const itemKey = norm(item?.source_line_key);
  if (holdKey && itemKey && holdKey === itemKey) return true;

  const holdSku = norm(hold.sku);
  const itemSku = norm(item?.sku);
  if (holdSku && holdSku === itemSku) {
    const holdLoc = norm(hold.storage_location);
    const itemLoc = norm(item?.location ?? item?.storage_location);
    if (holdLoc && itemLoc) return holdLoc === itemLoc;
    return true;
  }
  return false;
}

// Aplica a camada "Em Espera": remove da fila os itens pausados.
function applyHolds(order: any, items: any[], ctx?: HoldContext): any[] {
  if (!ctx) return items;
  const holds = ctx.holdsByOrderId?.[String(order?.id || '')] || [];
  const autoMatch = orderMatchesAutoWaiting(order, ctx.autoRules);
  if (holds.length === 0 && !autoMatch) return items;

  const today = ctx.today || '';
  // Esconde da fila: pausas ativas (manual/agendado no futuro) E itens ja retirados (terminal).
  const hidingHolds = holds.filter((h) => h.status === 'picked_up' || isHoldActiveOn(h, today));
  const releasedHolds = holds.filter((h) => h.status === 'released');

  return items.filter((item) => {
    // 1) segurado (em espera) ou ja retirado => fora da fila
    if (hidingHolds.some((h) => holdMatchesItem(h, item))) return false;
    // 2) move automatico (retirada/operacao) esconde tudo, exceto o que foi
    //    liberado na mao (override 'released' daquele item especifico).
    if (autoMatch && !releasedHolds.some((h) => holdMatchesItem(h, item))) return false;
    return true;
  });
}

export function getOperationalItemsForOrder(
  order: any,
  orderBalancesByOrderId: Record<string, OrderItemShadowBalance[]>,
  holdContext?: HoldContext
) {
  const originalItems = Array.isArray(order?.items_json) ? order.items_json : [];
  const rawProds = Array.isArray(order?.raw_json?.produtos_locais)
    ? order.raw_json.produtos_locais
    : (Array.isArray(order?.raw_json?.produtos) ? order.raw_json.produtos : []);

  const enrichedOriginalItems = originalItems.length > 0 && rawProds.length === originalItems.length
    ? originalItems.map((it: any, idx: number) => ({
      ...it,
      department: it.department || rawProds[idx]?.departamento || '',
      brand: it.brand || rawProds[idx]?.marca || '',
    }))
    : originalItems;

  const balances = orderBalancesByOrderId[String(order?.id || '')] || [];
  if (balances.length === 0) return applyHolds(order, enrichedOriginalItems, holdContext);

  const deliverable = balances
    .filter(hasDeliverableBalance)
    .map((bal) => {
      const candidateKey = String(bal.source_line_key || '').trim().toLowerCase();
      const candidateSku = String(bal.sku || '').trim().toLowerCase();

      const originalMatch = enrichedOriginalItems.find((it: any) => {
        const itemSku = String(it?.sku || '').trim().toLowerCase();
        const itemLocation = String(it?.location || '').trim().toLowerCase();
        const itemKit = String(it?.codigo_kit_pai || '').trim().toLowerCase();
        const originalKey = itemSku || itemLocation || itemKit
          ? `item:${itemSku}|${itemLocation}|${itemKit}`
          : '';

        return originalKey === candidateKey || (candidateSku && itemSku === candidateSku);
      });

      return {
        ...originalMatch,
        sku: bal.sku || originalMatch?.sku || '',
        name: originalMatch?.name || originalMatch?.descricao || bal.product_name,
        descricao: originalMatch?.descricao || originalMatch?.name || bal.product_name,
        purchased_quantity: Number(bal.remaining_deliverable_quantity ?? bal.shadow_deliverable_quantity ?? 0),
        quantity: Number(bal.remaining_deliverable_quantity ?? bal.shadow_deliverable_quantity ?? 0),
        location: originalMatch?.location || bal.storage_location || '',
        department: originalMatch?.department || '',
        brand: originalMatch?.brand || '',
        has_assembly: originalMatch?.has_assembly,
        source_line_key: bal.source_line_key,
        order_item_id: bal.order_item_id,
        originally_purchased_quantity: Number(bal.purchased_quantity || 0),
        already_returned_quantity: Number(bal.returned_quantity || 0),
      };
    });

  return applyHolds(order, deliverable, holdContext);
}
