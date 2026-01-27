import { create } from 'zustand';
import { supabase } from '../supabase/client';
import type { AssemblyRoute, AssemblyProductWithDetails, User, Vehicle } from '../types/database';

interface AssemblyDataState {
    // Data
    assemblyRoutes: AssemblyRoute[];
    assemblyPending: AssemblyProductWithDetails[];
    assemblyInRoutes: AssemblyProductWithDetails[];
    montadores: User[];
    vehicles: Vehicle[];
    deliveryInfo: Record<string, string>;

    // Loading states
    isLoading: boolean;
    lastFetched: number | null;

    // Actions
    loadAll: (force?: boolean) => Promise<void>;
    refreshInBackground: () => Promise<void>;
    setAssemblyRoutes: (routes: AssemblyRoute[]) => void;
    setAssemblyPending: (products: AssemblyProductWithDetails[]) => void;
    clearCache: () => void;
}

// Cache validity time in milliseconds (30 seconds)
const CACHE_TTL = 30000;

export const useAssemblyDataStore = create<AssemblyDataState>((set, get) => ({
    // Initial state
    assemblyRoutes: [],
    assemblyPending: [],
    assemblyInRoutes: [],
    montadores: [],
    vehicles: [],
    deliveryInfo: {},
    isLoading: false,
    lastFetched: null,

    loadAll: async (force = false) => {
        const state = get();
        const now = Date.now();

        // Skip if recently fetched and not forced
        if (!force && state.lastFetched && (now - state.lastFetched) < CACHE_TTL) {
            return;
        }

        // Skip if already loading
        if (state.isLoading) return;

        // If we have cached data, don't show loading (stale-while-revalidate)
        const hasCache = state.assemblyPending.length > 0 || state.assemblyRoutes.length > 0;
        if (!hasCache) {
            set({ isLoading: true });
        }

        try {
            // Parallel fetch for all data
            const [
                routesRes,
                productsPendingRes,
                montadoresRes,
                vehiclesRes,
            ] = await Promise.all([
                // Assembly routes
                supabase
                    .from('assembly_routes')
                    .select('*')
                    .order('created_at', { ascending: false }),

                // Assembly products (pending, not in routes)
                supabase
                    .from('assembly_products')
                    .select(`
            id, order_id, product_name, product_sku, status, assembly_route_id, created_at, updated_at,
            order:order_id (id, order_id_erp, customer_name, phone, address_json, raw_json, data_venda, previsao_entrega, previsao_montagem, observacoes_publicas, observacoes_internas),
            installer:installer_id (id, name)
          `)
                    .eq('status', 'pending')
                    .is('assembly_route_id', null)
                    .order('created_at', { ascending: false }),

                // Montadores
                supabase
                    .from('users')
                    .select('*')
                    .eq('role', 'montador'),

                // Vehicles
                supabase
                    .from('vehicles')
                    .select('*')
                    .eq('active', true),
            ]);

            const assemblyRoutes = (routesRes.data || []) as AssemblyRoute[];
            const assemblyPending = (productsPendingRes.data || []) as AssemblyProductWithDetails[];

            // DEBUG LOG: Check if previsao_montagem is coming
            if (assemblyPending.length > 0) {
                const firstOrder = (assemblyPending[0] as any).order;
                console.log('[Store Debug] First Pending Order:', {
                    id: firstOrder?.id,
                    erp: firstOrder?.order_id_erp,
                    prev_entrega: firstOrder?.previsao_entrega,
                    prev_montagem: firstOrder?.previsao_montagem
                });
            }

            const montadores = (montadoresRes.data || []) as User[];
            const vehicles = (vehiclesRes.data || []) as Vehicle[];

            // Get products in routes if we have routes
            let assemblyInRoutes: AssemblyProductWithDetails[] = [];
            if (assemblyRoutes.length > 0) {
                const routeIds = Array.from(new Set(assemblyRoutes.map((r: any) => r.id))).filter(Boolean);
                if (routeIds.length > 0) {
                    const { data: productsR } = await supabase
                        .from('assembly_products')
                        .select(`
              id, order_id, product_name, product_sku, status, assembly_route_id, created_at, updated_at,
              order:order_id (id, order_id_erp, customer_name, phone, address_json, raw_json, data_venda, previsao_entrega, previsao_montagem),
              installer:installer_id (id, name)
            `)
                        .in('assembly_route_id', routeIds);
                    assemblyInRoutes = (productsR || []) as AssemblyProductWithDetails[];
                }
            }

            // Get delivery info for pending products
            let deliveryInfo: Record<string, string> = {};
            const orderIds = Array.from(new Set(assemblyPending.map((ap: any) => String(ap.order_id)).filter(Boolean)));
            if (orderIds.length > 0) {
                const { data: roDelivered } = await supabase
                    .from('route_orders')
                    .select('order_id, delivered_at, status')
                    .in('order_id', orderIds)
                    .eq('status', 'delivered');

                (roDelivered || []).forEach((r: any) => {
                    if (r.delivered_at) deliveryInfo[String(r.order_id)] = String(r.delivered_at);
                });
            }

            // Update store
            set({
                assemblyRoutes,
                assemblyPending,
                assemblyInRoutes,
                montadores,
                vehicles,
                deliveryInfo,
                isLoading: false,
                lastFetched: Date.now(),
            });

        } catch (error) {
            console.error('Error loading assembly data:', error);
            set({ isLoading: false });
        }
    },

    refreshInBackground: async () => {
        const state = get();
        if (state.isLoading) return;
        await get().loadAll(true);
    },

    setAssemblyRoutes: (routes) => set({ assemblyRoutes: routes }),
    setAssemblyPending: (products) => set({ assemblyPending: products }),

    clearCache: () => set({
        assemblyRoutes: [],
        assemblyPending: [],
        assemblyInRoutes: [],
        montadores: [],
        vehicles: [],
        deliveryInfo: {},
        lastFetched: null,
    }),
}));
