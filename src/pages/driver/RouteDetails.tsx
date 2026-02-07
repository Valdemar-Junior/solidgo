import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import { backgroundSync } from '../../utils/offline/backgroundSync';
import DeliveryMarking from '../../components/DeliveryMarking';
import { OfflineStorage, NetworkStatus } from '../../utils/offline/storage';
import type { RouteWithDetails, RouteOrder, Order } from '../../types/database';
import { Truck, MapPin, Clock, Package, RefreshCw, LogOut, ArrowLeft } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { toast } from 'sonner';
import { buildFullAddress } from '../../utils/maps';

export default function DriverRouteDetails() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { routeId } = useParams<{ routeId: string }>();
  const [route, setRoute] = useState<RouteWithDetails | null>(null);
  const [routeOrders, setRouteOrders] = useState<RouteOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    let subscription: any = null;

    if (routeId) {
      loadRouteDetails();

      // Setup Realtime subscription
      subscription = supabase
        .channel(`route_orders:${routeId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'route_orders',
            filter: `route_id=eq.${routeId}`,
          },
          (payload) => {
            console.log('Route order updated:', payload);
            loadRouteDetails();
          }
        )
        .subscribe();
    }

    // Monitor network status
    const handleOnline = () => {
      setIsOnline(true);
      backgroundSync.forceSync();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      // Cleanup Realtime subscription
      if (subscription) {
        supabase.removeChannel(subscription);
      }
    };
  }, [routeId]);

  const loadRouteDetails = async () => {
    if (!routeId) return;

    try {
      setLoading(true);

      if (NetworkStatus.isOnline()) {
        const { data: routeData, error: routeError } = await supabase
          .from('routes')
          .select('*, driver:drivers!driver_id(id, active), vehicle:vehicles!vehicle_id(*)')
          .eq('id', routeId)
          .single();

        if (routeError) throw routeError;
        if (routeData) {
          setRoute(routeData as RouteWithDetails);
        }

        const { data: ordersData, error: ordersError } = await supabase
          .from('route_orders')
          .select('*, order:orders!order_id(*)')
          .eq('route_id', routeId)
          .order('sequence', { ascending: true });

        if (ordersError) throw ordersError;
        if (ordersData) {
          setRouteOrders(ordersData as RouteOrder[]);
          await OfflineStorage.setItem(`route_orders_${routeId}`, ordersData);
        }
      } else {
        const cached = await OfflineStorage.getItem(`route_orders_${routeId}`);
        if (cached) setRouteOrders(cached);
      }

    } catch (error) {
      console.error('Error loading route details:', error);
      toast.error('Erro ao carregar detalhes da rota');
    } finally {
      setLoading(false);
    }
  };



  const handleForceSync = async () => {
    await backgroundSync.forceSync();
    await loadRouteDetails();
  };

  const getProgress = () => {
    if (routeOrders.length === 0) return 0;
    const completed = routeOrders.filter(order => order.status === 'delivered' || order.status === 'returned').length;
    return Math.round((completed / routeOrders.length) * 100);
  };

  // GPS opening removido (endereços imprecisos)
  const openMapsForRoute = () => { };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando detalhes da rota...</p>
        </div>
      </div>
    );
  }

  if (!route) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Truck className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Rota não encontrada</h3>
          <p className="text-gray-600">A rota solicitada não foi encontrada ou você não tem acesso a ela.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start min-w-0">
                <button
                  onClick={() => navigate(-1)}
                  className="p-2 mr-3 hover:bg-gray-100 rounded-full text-gray-600 transition-colors flex-shrink-0"
                  title="Voltar"
                >
                  <ArrowLeft className="h-6 w-6" />
                </button>
                <Truck className="h-8 w-8 text-blue-600 mr-3 flex-shrink-0" />
                <div className="min-w-0">
                  <h1 className="text-xl sm:text-2xl font-bold text-gray-900 break-words">
                    {route.name}
                  </h1>
                  <p className="text-sm text-gray-600 break-words">
                    Motorista: {user?.name || user?.email} • Veículo: {route.vehicle?.model} - {route.vehicle?.plate}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className={`flex items-center px-3 py-1 rounded-full text-sm ${isOnline ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                  <div className={`w-2 h-2 rounded-full mr-2 ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  {isOnline ? 'Online' : 'Offline'}
                </div>
                <button
                  onClick={handleForceSync}
                  className="flex items-center px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm hover:bg-blue-200 transition-colors"
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Sincronizar
                </button>
                <div className="text-xs sm:text-sm text-gray-600">
                  Progresso: {getProgress()}%
                </div>
                <button
                  onClick={async () => { await logout(); window.location.href = '/login'; }}
                  className="flex items-center px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm hover:bg-gray-200 border border-gray-300"
                >
                  <LogOut className="h-4 w-4 mr-1" />
                  Sair
                </button>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-4">
              <div className="bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${getProgress()}%` }}
                ></div>
              </div>
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>{routeOrders.filter(o => o.status === 'delivered').length} entregues</span>
                <span>{routeOrders.filter(o => o.status === 'returned').length} retornados</span>
                <span>{routeOrders.filter(o => o.status === 'pending').length} pendentes</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Route Summary */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <MapPin className="h-5 w-5 mr-2" />
            Resumo da Rota
          </h2>
          <div className="flex justify-end mb-4"></div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{routeOrders.length}</div>
              <div className="text-sm text-gray-600">Total de Pedidos</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {routeOrders.filter(o => o.status === 'delivered').length}
              </div>
              <div className="text-sm text-gray-600">Entregues</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">
                {routeOrders.filter(o => o.status === 'returned').length}
              </div>
              <div className="text-sm text-gray-600">Retornados</div>
            </div>
          </div>

          {route.observations && (
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-800">
                <strong>Observações:</strong> {route.observations}
              </p>
            </div>
          )}
        </div>

        {/* Delivery Marking Component */}
        <DeliveryMarking routeId={routeId} onUpdated={loadRouteDetails} />
      </div>
    </div>
  );
}
