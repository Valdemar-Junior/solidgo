// Devoluções gravadas pelo fluxo ANTIGO do n8n.
//
// O n8n de produção ainda não chama ingest_erp_return: ele só carimba o pedido
// (blocked_at, blocked_reason, requires_pickup, return_nfe_*), sem criar evento
// em order_returns. As telas do fluxo novo leem order_returns — sem esta ponte,
// essas devoluções (e as coletas pendentes delas) ficam invisíveis.
//
// Quando o pedido ganha um evento processado em order_returns, ele passa a ser
// mostrado pelo fluxo novo e sai daqui (não aparece duas vezes).

export type LegacyReturnOrder = {
  id: string;
  order_id_erp: string;
  customer_name: string | null;
  filial_venda: string | null;
  blocked_at: string | null;
  blocked_reason: string | null;
  requires_pickup: boolean | null;
  pickup_created_at: string | null;
  return_nfe_number: string | null;
  return_date: string | null;
  created_at: string;
};

export type LegacyReturnRow = {
  id: string;
  order_id: string;
  return_nfe_number: string | null;
  return_date: string | null;
  created_at: string;
  return_type: null;
  reason: string | null;
  requires_pickup: boolean;
  pickup_created_at: string | null;
  store_return_confirmed_at: null;
  order: {
    id: string;
    order_id_erp: string;
    customer_name: string | null;
    filial_venda: string | null;
    blocked_at: string | null;
  };
  items: never[];
  isLegacy: true;
};

const LEGACY_ROW_PREFIX = 'legacy:';

export const legacyReturnRowId = (orderId: string) => `${LEGACY_ROW_PREFIX}${orderId}`;
export const isLegacyReturnRowId = (id: string) => String(id || '').startsWith(LEGACY_ROW_PREFIX);

// O n8n antigo gravava o texto "undefined" quando a nota vinha vazia.
const INVALID_NFE_NUMBERS = new Set(['', 'undefined', 'null']);

export function normalizeReturnNfeNumber(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return INVALID_NFE_NUMBERS.has(text.toLowerCase()) ? null : text;
}

export const isPickupOrderErp = (orderIdErp: unknown) =>
  String(orderIdErp ?? '').trim().toUpperCase().startsWith('C-');

export function buildLegacyReturnRows(
  orders: LegacyReturnOrder[],
  orderIdsWithEvent: Set<string>,
): LegacyReturnRow[] {
  return orders
    .filter((o) => o?.id
      && !isPickupOrderErp(o.order_id_erp)
      && !orderIdsWithEvent.has(String(o.id))
      && (o.blocked_at || (o.requires_pickup && !o.pickup_created_at)))
    .map((o) => ({
      id: legacyReturnRowId(String(o.id)),
      order_id: String(o.id),
      return_nfe_number: normalizeReturnNfeNumber(o.return_nfe_number),
      return_date: o.return_date || o.blocked_at,
      created_at: o.blocked_at || o.created_at,
      return_type: null,
      reason: o.blocked_reason,
      requires_pickup: Boolean(o.requires_pickup),
      pickup_created_at: o.pickup_created_at,
      store_return_confirmed_at: null,
      order: {
        id: String(o.id),
        order_id_erp: String(o.order_id_erp || ''),
        customer_name: o.customer_name,
        filial_venda: o.filial_venda,
        blocked_at: o.blocked_at,
      },
      items: [] as never[],
      isLegacy: true as const,
    }));
}

// Mesmo número do site antigo (C-<pedido>), que é o padrão das coletas já
// feitas. Se esse número já pertence a uma coleta ANTERIOR do mesmo pedido
// (segunda devolução), a nova ganha a data da devolução no fim.
export function legacyPickupOrderErpId(orderIdErp: string, previousPickupTaken: boolean, returnDate?: string | null): string {
  const base = `C-${orderIdErp}`;
  if (!previousPickupTaken) return base;
  const d = returnDate ? new Date(returnDate) : new Date();
  const stamp = Number.isNaN(d.getTime()) ? String(Date.now()) : d.toISOString().slice(0, 10).replace(/-/g, '');
  return `${base}-${stamp}`;
}

// Mesmo formato de nome da rota de coleta do site antigo, sem o
// "COLETA-undefined-..." que a nota vazia produzia.
export function legacyPickupRouteName(nfeNumber: unknown, orderIdErp: string, now: Date = new Date()): string {
  const nota = normalizeReturnNfeNumber(nfeNumber);
  return `COLETA-${nota || orderIdErp}-${now.toLocaleDateString('pt-BR').replace(/\//g, '')}`;
}
