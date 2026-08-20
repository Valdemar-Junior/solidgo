// Helpers PUROS de casamento item<->hold da retirada (SEM supabase/React),
// pra ficarem testáveis. Usados por pickupCore e pelas telas.
import type { OrderItemHold } from '../../types/database';

export const pickupItemKey = (it: any) =>
  `${String(it?.source_line_key || '').toLowerCase()}|${String(it?.sku || '').toLowerCase()}|${String(it?.location || it?.storage_location || '').toLowerCase()}`;

export function pickupHoldMatchesItem(h: Partial<OrderItemHold>, it: any): boolean {
  const hk = String(h.source_line_key || '').toLowerCase();
  const ik = String(it?.source_line_key || '').toLowerCase();
  if (hk && ik && hk === ik) return true;
  const hs = String(h.sku || '').toLowerCase();
  const is = String(it?.sku || '').toLowerCase();
  if (hs && hs === is) {
    const hl = String(h.storage_location || '').toLowerCase();
    const il = String(it?.location || it?.storage_location || '').toLowerCase();
    return hl && il ? hl === il : true;
  }
  return false;
}

export function buildPickupHoldPayload(order: any, item: any, extra: Record<string, any>) {
  return {
    order_id: order.id,
    order_item_id: item?.order_item_id || null,
    source_line_key: item?.source_line_key || null,
    sku: item?.sku || null,
    storage_location: item?.location || item?.storage_location || null,
    product_name: item?.name || item?.descricao || item?.product_name || null,
    ...extra,
  };
}
