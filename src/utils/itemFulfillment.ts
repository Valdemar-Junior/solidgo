import type {
  ItemFulfillmentControl,
  ItemFulfillmentMode,
  OrderItemShadowBalance,
  StructuredOrderItem,
} from '../types/database';

export const DEFAULT_ITEM_FULFILLMENT_CONTROL: ItemFulfillmentControl = {
  enabled: false,
  mode: 'shadow',
  partial_returns_enabled: false,
  item_route_allocation_enabled: false,
  item_delivery_enabled: false,
  item_scheduling_enabled: false,
  pilot_route_ids: [],
};

const ITEM_FULFILLMENT_MODES: ItemFulfillmentMode[] = ['off', 'shadow', 'pilot', 'enabled'];

const asBoolean = (value: unknown, fallback = false) => {
  if (typeof value === 'boolean') return value;
  return fallback;
};

const asMode = (value: unknown): ItemFulfillmentMode => {
  return ITEM_FULFILLMENT_MODES.includes(value as ItemFulfillmentMode)
    ? (value as ItemFulfillmentMode)
    : DEFAULT_ITEM_FULFILLMENT_CONTROL.mode;
};

const asStringArray = (value: unknown) => {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
};

const asNullableText = (value: unknown) => {
  if (value === null || typeof value === 'undefined') return null;
  const text = String(value).trim();
  return text || null;
};

const asNumber = (value: unknown, fallback = 0) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizeItemFulfillmentControl = (value: unknown): ItemFulfillmentControl => {
  const raw = (value && typeof value === 'object') ? value as Record<string, unknown> : {};

  return {
    enabled: asBoolean(raw.enabled, DEFAULT_ITEM_FULFILLMENT_CONTROL.enabled),
    mode: asMode(raw.mode),
    partial_returns_enabled: asBoolean(
      raw.partial_returns_enabled,
      DEFAULT_ITEM_FULFILLMENT_CONTROL.partial_returns_enabled,
    ),
    item_route_allocation_enabled: asBoolean(
      raw.item_route_allocation_enabled,
      DEFAULT_ITEM_FULFILLMENT_CONTROL.item_route_allocation_enabled,
    ),
    item_delivery_enabled: asBoolean(
      raw.item_delivery_enabled,
      DEFAULT_ITEM_FULFILLMENT_CONTROL.item_delivery_enabled,
    ),
    item_scheduling_enabled: asBoolean(
      raw.item_scheduling_enabled,
      DEFAULT_ITEM_FULFILLMENT_CONTROL.item_scheduling_enabled,
    ),
    pilot_route_ids: asStringArray(raw.pilot_route_ids),
  };
};

export const normalizeStructuredOrderItem = (value: unknown): StructuredOrderItem => {
  const raw = (value && typeof value === 'object') ? value as Record<string, unknown> : {};

  return {
    id: String(raw.id || ''),
    order_id: String(raw.order_id || ''),
    source_line_key: String(raw.source_line_key || ''),
    sku: asNullableText(raw.sku),
    product_name: String(raw.product_name || 'Produto sem nome'),
    purchased_quantity: asNumber(raw.purchased_quantity, 0),
    volume_quantity: raw.volume_quantity === null || typeof raw.volume_quantity === 'undefined'
      ? null
      : asNumber(raw.volume_quantity, 0),
    storage_location: asNullableText(raw.storage_location),
    kit_code: asNullableText(raw.kit_code),
    source_payload: Array.isArray(raw.source_payload) ? raw.source_payload : [],
    source_present: asBoolean(raw.source_present, true),
    source_synced_at: String(raw.source_synced_at || ''),
    created_at: String(raw.created_at || ''),
    updated_at: String(raw.updated_at || ''),
  };
};

export const normalizeOrderItemShadowBalance = (value: unknown): OrderItemShadowBalance => {
  const raw = (value && typeof value === 'object') ? value as Record<string, unknown> : {};

  return {
    order_item_id: String(raw.order_item_id || ''),
    order_id: String(raw.order_id || ''),
    source_line_key: String(raw.source_line_key || ''),
    sku: asNullableText(raw.sku),
    product_name: String(raw.product_name || 'Produto sem nome'),
    storage_location: asNullableText(raw.storage_location),
    kit_code: asNullableText(raw.kit_code),
    source_present: asBoolean(raw.source_present, true),
    purchased_quantity: asNumber(raw.purchased_quantity, 0),
    returned_quantity: asNumber(raw.returned_quantity, 0),
    shadow_deliverable_quantity: asNumber(raw.shadow_deliverable_quantity, 0),
    has_over_return: asBoolean(raw.has_over_return, false),
    delivered_quantity: asNumber(raw.delivered_quantity, 0),
    remaining_deliverable_quantity: asNumber(
      raw.remaining_deliverable_quantity,
      asNumber(raw.shadow_deliverable_quantity, 0),
    ),
  };
};

// Predicados compartilhados sobre o saldo por item (view order_item_shadow_balances).
// Fonte unica de verdade pra "tem saldo entregavel" e "devolvido total", evitando
// a regra copiada em varias telas.
// "Tem o que rotear" = ainda FALTA entregar (restante > 0). Cai no saldo cheio
// se a coluna remaining nao vier (compatibilidade), preservando o comportamento antigo.
export const hasDeliverableBalance = (
  balance: Pick<OrderItemShadowBalance, 'source_present' | 'shadow_deliverable_quantity' | 'remaining_deliverable_quantity'>,
) => Boolean(balance?.source_present)
  && asNumber(balance?.remaining_deliverable_quantity, asNumber(balance?.shadow_deliverable_quantity, 0)) > 0;

export const isFullyReturnedBalance = (
  balance: Pick<OrderItemShadowBalance, 'returned_quantity' | 'shadow_deliverable_quantity'>,
) => asNumber(balance?.returned_quantity, 0) > 0 && asNumber(balance?.shadow_deliverable_quantity, 0) <= 0;

export const getItemFulfillmentModeLabel = (mode: ItemFulfillmentMode) => {
  switch (mode) {
    case 'off':
      return 'Desligado';
    case 'shadow':
      return 'Sombra';
    case 'pilot':
      return 'Piloto';
    case 'enabled':
      return 'Ativo';
    default:
      return 'Sombra';
  }
};

export const shouldCreateRouteOrderItemSnapshots = (control: ItemFulfillmentControl) => {
  return control.mode !== 'off' && control.item_route_allocation_enabled;
};

export const shouldEnforceRouteOrderItemSnapshots = (control: ItemFulfillmentControl) => {
  return control.mode === 'enabled' && control.item_route_allocation_enabled;
};
