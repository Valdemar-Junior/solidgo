import { create } from 'zustand';
import { supabase } from '../supabase/client';
import type { Order, DriverWithUser, Vehicle, RouteWithDetails } from '../types/database';

interface RouteDataState {
  // Data
  orders: Order[];
  drivers: DriverWithUser[];
  vehicles: Vehicle[];
  conferentes: { id: string; name: string }[];
  routes: RouteWithDetails[];
  requireConference: boolean;
  
  // Loading states
  isLoading: boolean;
  lastFetched: number | null;
  
  // Actions
  loadAll: (force?: boolean) => Promise<void>;
  refreshInBackground: () => Promise<void>;
  setOrders: (orders: Order[]) => void;
  setRoutes: (routes: RouteWithDetails[]) => void;
  clearCache: () => void;
}

// Cache validity time in milliseconds (30 seconds)
const CACHE_TTL = 30000;

export const useRouteDataStore = create<RouteDataState>((set, get) => ({
  // Initial state
  orders: [],
  drivers: [],
  vehicles: [],
  conferentes: [],
  routes: [],
  requireConference: true,
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
    const hasCache = state.orders.length > 0 || state.routes.length > 0;
    if (!hasCache) {
      set({ isLoading: true });
    }

    try {
      // Parallel fetch for all data
      const [
        ordersRes,
        vehiclesRes,
        confSettingRes,
        driversRes,
        conferentesRes,
        routesRes,
      ] = await Promise.all([
        // Orders (pending or returned)
        supabase
          .from('orders')
          .select('*')
          .in('status', ['pending', 'returned'])
          .order('created_at', { ascending: false }),
        
        // Vehicles
        supabase
          .from('vehicles')
          .select('*')
          .eq('active', true),
        
        // Conference setting
        supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'require_route_conference')
          .single(),
        
        // Drivers with their users
        supabase
          .from('drivers')
          .select('id, user_id, active')
          .eq('active', true),
        
        // Conferentes
        supabase
          .from('users')
          .select('id,name,role')
          .eq('role', 'conferente'),
        
        // Routes with details
        supabase
          .from('routes')
          .select('*, vehicle:vehicles!vehicle_id(id,model,plate), route_orders:route_orders(*, order:orders!order_id(*)), conferences:route_conferences!route_id(id,route_id,status,result_ok,finished_at,created_at,resolved_at,resolved_by,resolution,summary)')
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      // Process orders - normalize return flags
      let orders: Order[] = [];
      if (ordersRes.data) {
        orders = (ordersRes.data as Order[]).map((o: any) => {
          if (String(o.status) === 'returned' && !o.return_flag) {
            return { ...o, return_flag: true };
          }
          return o;
        });
      }

      // Process drivers - enrich with user data
      let drivers: DriverWithUser[] = [];
      if (driversRes.data && driversRes.data.length > 0) {
        const uids = Array.from(new Set(driversRes.data.map((d: any) => String(d.user_id)).filter(Boolean)));
        if (uids.length > 0) {
          const { data: usersData } = await supabase
            .from('users')
            .select('id,name,email,role')
            .in('id', uids);
          
          const mapU = new Map<string, any>((usersData || []).map((u: any) => [String(u.id), u]));
          drivers = driversRes.data.map((d: any) => ({ ...d, user: mapU.get(String(d.user_id)) || null }));
        }
        // Filter only drivers
        drivers = drivers.filter((d: any) => String(d?.user?.role || '').toLowerCase() === 'driver');
      }

      // Process routes - enrich with driver names and vehicles
      let routes: RouteWithDetails[] = routesRes.data || [];
      if (routes.length > 0) {
        const routeIds = routes.map(r => r.id).filter(Boolean);
        
        // Enrich with route_orders if missing
        if (routeIds.length > 0) {
          const { data: roBulk } = await supabase
            .from('route_orders')
            .select('*, order:orders!order_id(*)')
            .in('route_id', routeIds)
            .order('sequence');
          
          const byRoute: Record<string, any[]> = {};
          for (const ro of (roBulk || [])) {
            const k = String(ro.route_id);
            if (!byRoute[k]) byRoute[k] = [];
            byRoute[k].push(ro);
          }
          
          for (const r of routes as any[]) {
            const k = String(r.id);
            r.route_orders = byRoute[k] || r.route_orders || [];
            if (Array.isArray(r.conferences) && r.conferences.length > 0) {
              const sorted = [...r.conferences].sort((a: any, b: any) => 
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
              );
              r.conference = sorted[0];
            }
          }
        }

        // Enrich drivers
        const driverIds = Array.from(new Set(routes.map((r: any) => r.driver_id).filter(Boolean)));
        if (driverIds.length > 0) {
          const { data: drvBulk } = await supabase
            .from('drivers')
            .select('id, user_id, active')
            .in('id', driverIds);
          
          if (drvBulk && drvBulk.length > 0) {
            const userIds = Array.from(new Set(drvBulk.map((d: any) => String(d.user_id)).filter(Boolean)));
            if (userIds.length > 0) {
              const { data: usersData } = await supabase
                .from('users')
                .select('id,name,email,role')
                .in('id', userIds);
              
              const mapU = new Map<string, any>((usersData || []).map((u: any) => [String(u.id), u]));
              const enrichedDrivers = drvBulk.map((d: any) => ({ ...d, user: mapU.get(String(d.user_id)) || null }));
              const mapDrv = new Map<string, any>(enrichedDrivers.map((d: any) => [String(d.id), d]));
              
              for (const r of routes as any[]) {
                const d = mapDrv.get(String(r.driver_id));
                if (d) {
                  r.driver = d;
                  r.driver_name = d?.user?.name || d?.name || '';
                }
              }
            }
          }
        }

        // Enrich vehicles
        const vehicleIds = Array.from(new Set(routes.map((r: any) => r.vehicle_id).filter(Boolean)));
        if (vehicleIds.length > 0) {
          const { data: vehBulk } = await supabase
            .from('vehicles')
            .select('id,model,plate')
            .in('id', vehicleIds);
          
          const mapVeh = new Map<string, any>((vehBulk || []).map((v: any) => [String(v.id), v]));
          for (const r of routes as any[]) {
            const v = mapVeh.get(String(r.vehicle_id));
            if (v) r.vehicle = v;
          }
        }

        // Conference fallback
        const missingConf = routes.filter((r: any) => !(r as any).conference).map((r: any) => r.id);
        if (missingConf.length > 0) {
          const { data: confBulk } = await supabase
            .from('latest_route_conferences')
            .select('*')
            .in('route_id', missingConf);
          
          const mapConf = new Map<string, any>();
          (confBulk || []).forEach((c: any) => mapConf.set(String(c.route_id), c));
          for (const r of routes as any[]) {
            if (!(r as any).conference) {
              const c = mapConf.get(String(r.id));
              if (c) (r as any).conference = c;
            }
          }
        }

        // Ensure driver_name fallback
        for (const r of routes as any[]) {
          if (!r.driver_name && r.driver) {
            r.driver_name = r.driver?.user?.name || r.driver?.name || '';
          }
        }
      }

      // Conference setting
      const confSetting = confSettingRes.data as any;
      const flagEnabled = confSetting?.value?.enabled;
      const requireConference = flagEnabled === false ? false : true;

      // Conferentes
      const conferentes = (conferentesRes.data || []).map((u: any) => ({
        id: String(u.id),
        name: String(u.name || u.id)
      }));

      // Update store
      set({
        orders,
        drivers,
        vehicles: (vehiclesRes.data || []) as Vehicle[],
        conferentes,
        routes: routes as RouteWithDetails[],
        requireConference,
        isLoading: false,
        lastFetched: Date.now(),
      });

    } catch (error) {
      console.error('Error loading route data:', error);
      set({ isLoading: false });
    }
  },

  refreshInBackground: async () => {
    // Refresh without blocking UI
    const state = get();
    if (state.isLoading) return;
    
    await get().loadAll(true);
  },

  setOrders: (orders) => set({ orders }),
  setRoutes: (routes) => set({ routes }),
  
  clearCache: () => set({
    orders: [],
    drivers: [],
    vehicles: [],
    conferentes: [],
    routes: [],
    lastFetched: null,
  }),
}));
