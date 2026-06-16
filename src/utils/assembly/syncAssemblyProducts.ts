import { supabase } from '../../supabase/client';

export type AssemblySyncResult = {
  route_id?: string;
  order_id?: string;
  delivered_orders?: number;
  eligible_orders?: number;
  inserted_products: number;
};

const TRUE_ASSEMBLY_VALUES = new Set(['sim', 's', 'true', '1', 'yes', 'y']);

export function isAssemblyRequired(value: unknown): boolean {
  return TRUE_ASSEMBLY_VALUES.has(String(value ?? '').trim().toLowerCase());
}

export async function syncAssemblyProductsForRoute(routeId: string): Promise<AssemblySyncResult> {
  const normalizedRouteId = String(routeId || '').trim();
  if (!normalizedRouteId) {
    throw new Error('routeId invalido para sincronizar montagem');
  }

  const { data, error } = await supabase.rpc('sync_missing_assembly_products_for_route', {
    p_route_id: normalizedRouteId,
  });

  if (error) {
    throw error;
  }

  const result = (data || {}) as Partial<AssemblySyncResult>;

  return {
    route_id: String(result.route_id || normalizedRouteId),
    delivered_orders: Number(result.delivered_orders || 0),
    eligible_orders: Number(result.eligible_orders || 0),
    inserted_products: Number(result.inserted_products || 0),
  };
}

export async function syncAssemblyProductsForOrder(orderId: string): Promise<AssemblySyncResult> {
  const normalizedOrderId = String(orderId || '').trim();
  if (!normalizedOrderId) {
    throw new Error('orderId invalido para sincronizar montagem');
  }

  const { data, error } = await supabase.rpc('sync_missing_assembly_products_for_order', {
    p_order_id: normalizedOrderId,
  });

  if (error) {
    throw error;
  }

  const result = (data || {}) as Partial<AssemblySyncResult>;

  return {
    order_id: String(result.order_id || normalizedOrderId),
    inserted_products: Number(result.inserted_products || 0),
  };
}
