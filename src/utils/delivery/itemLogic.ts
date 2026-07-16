// Logica pura das telas de entrega (predicados de item, valor, rotulo de status).
// Extraido de DeliveryMarking.tsx para ficar testavel e reaproveitavel.
// SEM dependencia de React/Supabase.
import type { RouteOrderItem } from '../../types/database';

// Item devolvido no ERP e bloqueado nesta rota (nada a entregar).
export const isBlockedRouteOrderItem = (item: RouteOrderItem) =>
  item.returned_quantity_snapshot > 0 && item.deliverable_quantity_snapshot <= 0;

// Item que ainda pode ser entregue nesta rota.
export const isDeliverableRouteOrderItem = (item: RouteOrderItem) =>
  item.deliverable_quantity_snapshot > 0;

// Item que deve aparecer na tela do motorista.
// IMPORTANTE: item devolvido no ERP NO MEIO da rota fica com alocado=0 e
// entregável=0 (resync do gatilho) — ele precisa continuar VISÍVEL, senão o
// motorista não vê o alerta "não entregar" e o item some em silêncio
// (o móvel está fisicamente no caminhão!).
export const isVisibleRouteOrderItem = (item: RouteOrderItem) =>
  Number(item.allocated_quantity || 0) > 0
  || Number(item.deliverable_quantity_snapshot || 0) > 0
  || isBlockedRouteOrderItem(item);

export const getRouteOrderItemStatusLabel = (item: RouteOrderItem) => {
  if (isBlockedRouteOrderItem(item)) {
    return 'Devolvido no ERP';
  }
  if (item.status === 'returned') {
    return 'Retornado na entrega';
  }
  if (item.status === 'partial') {
    return 'Devolução parcial';
  }
  if (item.status === 'delivered') {
    return 'Entregue';
  }
  if (item.status === 'cancelled') {
    return 'Cancelado';
  }
  return 'Disponível para entrega';
};

export const getRouteOrderItemStatusClasses = (item: RouteOrderItem) => {
  if (item.status === 'returned' || isBlockedRouteOrderItem(item)) {
    return 'border-red-200 bg-red-50 text-red-700';
  }
  if (item.status === 'partial') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  if (item.status === 'delivered') {
    return 'border-green-200 bg-green-50 text-green-700';
  }
  if (item.status === 'cancelled') {
    return 'border-gray-200 bg-gray-100 text-gray-700';
  }
  return 'border-blue-200 bg-blue-50 text-blue-700';
};

// Valor informativo do pedido descontando o que ja foi devolvido (item-level).
// Robusto: sem snapshot (modo legado) ou linha sem casamento -> usa a quantidade cheia,
// entao o valor nunca fica abaixo do real por falha de casamento.
export const lineUnitPrice = (it: any) => {
  const total = Number(it?.total_price_real ?? it?.total_price ?? NaN);
  const purchased = Number(it?.purchased_quantity ?? 1) || 1;
  if (Number.isFinite(total) && purchased > 0) return total / purchased;
  return Number(it?.unit_price_real ?? it?.unit_price ?? 0);
};

export const computeDeliverableOrderValue = (order: any, snapshotItems: RouteOrderItem[]): number => {
  const items: any[] = Array.isArray(order?.items_json) ? order.items_json : [];
  const fullLineValue = (it: any) => lineUnitPrice(it) * Number(it?.purchased_quantity ?? 1);

  if (!Array.isArray(snapshotItems) || snapshotItems.length === 0) {
    return items.reduce((sum, it) => sum + fullLineValue(it), 0);
  }

  // Saldo entregavel por SKU (consumido linha a linha pra nao contar em dobro).
  const deliverableBySku = new Map<string, number>();
  for (const si of snapshotItems) {
    const sku = String(si.sku_snapshot || '').trim().toLowerCase();
    if (!sku) continue;
    deliverableBySku.set(sku, (deliverableBySku.get(sku) || 0) + Number(si.deliverable_quantity_snapshot || 0));
  }

  return items.reduce((sum, it) => {
    const sku = String(it?.sku || '').trim().toLowerCase();
    const purchased = Number(it?.purchased_quantity ?? 1);
    // SKU desconhecido no snapshot -> mantem valor cheio (fallback seguro).
    if (!sku || !deliverableBySku.has(sku)) return sum + fullLineValue(it);
    const available = deliverableBySku.get(sku) || 0;
    const qty = Math.max(0, Math.min(purchased, available));
    deliverableBySku.set(sku, available - qty);
    return sum + lineUnitPrice(it) * qty;
  }, 0);
};
