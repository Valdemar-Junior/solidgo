import { useState, useEffect } from 'react';
import { supabase } from '../supabase/client';
import { OfflineStorage, SyncQueue, NetworkStatus } from '../utils/offline/storage';
import { backgroundSync } from '../utils/offline/backgroundSync';
import type { RouteOrderWithDetails, Order, ReturnReason } from '../types/database';
import { Package, CheckCircle, XCircle, Clock, MapPin } from 'lucide-react';
import { toast } from 'sonner';

interface DeliveryMarkingProps {
  routeId: string;
  onUpdated?: () => void;
}

export default function DeliveryMarking({ routeId, onUpdated }: DeliveryMarkingProps) {
  const [routeOrders, setRouteOrders] = useState<RouteOrderWithDetails[]>([]);
  const [returnReasons, setReturnReasons] = useState<ReturnReason[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(NetworkStatus.isOnline());
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  
  const [returnReason, setReturnReason] = useState<string>('');
  const [returnObservations, setReturnObservations] = useState<string>('');

  useEffect(() => {
    loadRouteOrders();
    loadReturnReasons();

    const listener = (online: boolean) => {
      setIsOnline(online);
    };
    NetworkStatus.addListener(listener);

    return () => {
      NetworkStatus.removeListener(listener);
    };
  }, [routeId]);

  useEffect(() => {
    const run = async () => {
      if (isOnline) {
        await backgroundSync.forceSync();
        await loadRouteOrders();
      } else {
        await loadRouteOrders();
      }
    };
    run();
  }, [isOnline]);

  const loadRouteOrders = async () => {
    try {
      setLoading(true);
      
      // Load from Supabase if online
      if (isOnline) {
        const { data, error } = await supabase
          .from('route_orders')
          .select(`
            *,
            order:orders!order_id(*)
          `)
          .eq('route_id', routeId)
          .order('sequence', { ascending: true });

        if (error) throw error;
        if (data) {
          setRouteOrders(data as RouteOrderWithDetails[]);
          // Cache offline
          await OfflineStorage.setItem(`route_orders_${routeId}`, data);
        }
      } else {
        // Load from offline storage
        const cached = await OfflineStorage.getItem(`route_orders_${routeId}`);
        if (cached) {
          setRouteOrders(cached);
        }
      }
    } catch (error) {
      console.error('Error loading route orders:', error);
      toast.error('Erro ao carregar pedidos da rota');
    } finally {
      setLoading(false);
    }
  };

  const loadReturnReasons = async () => {
    try {
      const { data, error } = await supabase
        .from('return_reasons')
        .select('*')
        .eq('active', true)
        .order('reason_text', { ascending: true });

      if (error) throw error;
      if (data) {
        setReturnReasons(data as ReturnReason[]);
        // Cache offline
        await OfflineStorage.setItem('return_reasons', data);
      }
    } catch (error) {
      console.error('Error loading return reasons:', error);
      // Try to load from cache
      const cached = await OfflineStorage.getItem('return_reasons');
      if (cached) {
        setReturnReasons(cached);
      }
    }
  };

  const markAsDelivered = async (order: RouteOrderWithDetails) => {
    try {
      if (processingIds.has(order.id)) return;
      const next = new Set(processingIds); next.add(order.id); setProcessingIds(next);
      const confirmation = {
        order_id: order.order_id,
        route_id: routeId,
        action: 'delivered' as const,
        local_timestamp: new Date().toISOString(),
        user_id: (await supabase.auth.getUser()).data.user?.id || '',
      };

      if (isOnline) {
        const { error } = await supabase
          .from('route_orders')
          .update({
            status: 'delivered',
            delivered_at: confirmation.local_timestamp,
          })
          .eq('id', order.id);
        if (error) throw error;
        toast.success('Pedido marcado como entregue!');
        setRouteOrders(prev => prev.map(ro => ro.id === order.id ? { ...ro, status: 'delivered', delivered_at: confirmation.local_timestamp } : ro));
        try {
          const { data } = await supabase
            .from('route_orders')
            .select('order_id,status')
            .eq('route_id', routeId);
          if (data && data.length > 0) {
            const allDone = data.every((ro: any) => ro.status !== 'pending');
            if (allDone) {
              await supabase.from('routes').update({ status: 'completed' }).eq('id', routeId);
            }
            const deliveredIds = data.filter((d: any) => d.status === 'delivered').map((d: any) => d.order_id);
            if (deliveredIds.length) {
              await supabase.from('orders').update({ status: 'delivered' }).in('id', deliveredIds);
            }
          }
        } catch {}
        if (onUpdated) onUpdated();
      } else {
        await SyncQueue.addItem({ type: 'delivery_confirmation', data: confirmation });
        const updated = routeOrders.map(ro => ro.id === order.id ? { ...ro, status: 'delivered' as const, delivered_at: confirmation.local_timestamp } : ro);
        setRouteOrders(updated);
        await OfflineStorage.setItem(`route_orders_${routeId}`, updated);
        toast.success('Pedido marcado como entregue (offline)!');
      }
    } catch (error) {
      console.error('Error marking as delivered:', error);
      toast.error('Erro ao marcar pedido como entregue');
    } finally {
      const next2 = new Set(processingIds); next2.delete(order.id); setProcessingIds(next2);
    }
  };


  const markAsReturned = async (order: RouteOrderWithDetails) => {
    if (!returnReason) {
      toast.error('Por favor, selecione um motivo para o retorno');
      return;
    }

    try {
      if (processingIds.has(order.id)) return;
      const next = new Set(processingIds); next.add(order.id); setProcessingIds(next);
      const confirmation = {
        order_id: order.order_id,
        route_id: routeId,
        action: 'returned' as const,
        return_reason: returnReason,
        observations: returnObservations,
        local_timestamp: new Date().toISOString(),
        user_id: (await supabase.auth.getUser()).data.user?.id || '',
      };

      if (isOnline) {
        const { error } = await supabase
          .from('route_orders')
          .update({
            status: 'returned',
            returned_at: confirmation.local_timestamp,
          })
          .eq('id', order.id);

        if (error) throw error;

        toast.success('Pedido marcado como retornado!');
        setRouteOrders(prev => prev.map(ro => ro.id === order.id ? { ...ro, status: 'returned', returned_at: confirmation.local_timestamp } : ro));
        try {
          const { data } = await supabase
            .from('route_orders')
            .select('order_id,status')
            .eq('route_id', routeId);
          if (data && data.length > 0) {
            const allDone = data.every((ro: any) => ro.status !== 'pending');
            if (allDone) {
              await supabase.from('routes').update({ status: 'completed' }).eq('id', routeId);
            }
            const returnedIds = data.filter((d: any) => d.status === 'returned').map((d: any) => d.order_id);
            if (returnedIds.length) {
              await supabase.from('orders').update({ status: 'returned' }).in('id', returnedIds);
            }
          }
        } catch {}
        if (onUpdated) onUpdated();
      } else {
        // Queue for offline sync
        await SyncQueue.addItem({
          type: 'delivery_confirmation',
          data: confirmation,
        });

        // Update local state
        const returnReasonObj = returnReasons.find(r => r.reason === returnReason);
        const updatedOrders = routeOrders.map(ro => 
          ro.id === order.id 
            ? { ...ro, status: 'returned' as const, returned_at: confirmation.local_timestamp, return_reason: returnReasonObj || null }
            : ro
        );
        setRouteOrders(updatedOrders);

        // Cache offline
        await OfflineStorage.setItem(`route_orders_${routeId}`, updatedOrders);

        toast.success('Pedido marcado como retornado (offline)!');
      }

      // Reset return form
      setReturnReason('');
      setReturnObservations('');
      
    } catch (error) {
      console.error('Error marking as returned:', error);
      toast.error('Erro ao marcar pedido como retornado');
    } finally {
      const next2 = new Set(processingIds); next2.delete(order.id); setProcessingIds(next2);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'delivered':
        return 'bg-green-100 text-green-800';
      case 'returned':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-yellow-100 text-yellow-800';
    }
  };

  const getStatusTextWithTime = (ro: RouteOrderWithDetails) => {
    const fmt = (s?: string) => s ? new Date(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    if (ro.status === 'delivered') return `Entregue ${fmt(ro.delivered_at)}`;
    if (ro.status === 'returned') return `Retornado ${fmt(ro.returned_at)}`;
    return 'Pendente';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-gray-600">Carregando pedidos...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Network Status */}
      <div className={`p-3 rounded-lg flex items-center ${
        isOnline ? 'bg-green-50 text-green-800' : 'bg-yellow-50 text-yellow-800'
      }`}>
        <div className={`w-2 h-2 rounded-full mr-2 ${
          isOnline ? 'bg-green-500' : 'bg-yellow-500'
        }`}></div>
        <span className="text-sm font-medium">
          {isOnline ? 'Online' : 'Modo Offline'}
        </span>
      </div>

      {/* Orders List */}
      {routeOrders.map((routeOrder) => {
        const order = routeOrder.order;
        if (!order) return null;

        return (
          <div key={routeOrder.id} className="bg-white rounded-lg shadow p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center mb-2">
                  <Package className="h-5 w-5 text-blue-600 mr-2" />
                  <span className="font-semibold text-gray-900">
                    {order.customer_name}
                  </span>
                  <span className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(routeOrder.status)}`}>
                    {getStatusTextWithTime(routeOrder)}
                  </span>
                </div>

                <div className="text-sm text-gray-600 space-y-1">
                  <div className="flex items-center">
                    <MapPin className="h-4 w-4 mr-1" />
                    {order.address_json.street}, {order.address_json.neighborhood}
                  </div>
                  <div>Telefone: {order.phone}</div>
                  <div>Pedido: {order.order_id_erp}</div>
                  <div>Valor: R$ {order.total.toFixed(2)}</div>
                  {order.observations && (
                    <div className="text-yellow-600">
                      <strong>Obs:</strong> {order.observations}
                    </div>
                  )}
                </div>

                {/* Return Form for Pending Orders */}
                {routeOrder.status === 'pending' && (
                  <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Motivo do Retorno
                        </label>
                        <select
                          value={returnReason}
                          onChange={(e) => setReturnReason(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Selecione um motivo</option>
                          {returnReasons.map((reason) => (
                            <option key={reason.id} value={reason.reason}>
                              {reason.reason}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Observações
                        </label>
                        <input
                          type="text"
                          value={returnObservations}
                          onChange={(e) => setReturnObservations(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Observações adicionais..."
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="ml-4 flex flex-col space-y-2">
                {routeOrder.status === 'pending' && (
                  <>
                    <button
                      onClick={() => markAsDelivered(routeOrder)}
                      disabled={processingIds.has(routeOrder.id)}
                      className="flex items-center px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      Entregue
                    </button>
                    
                    <button
                      onClick={() => markAsReturned(routeOrder)}
                      disabled={!returnReason || processingIds.has(routeOrder.id)}
                      className="flex items-center px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Retornado
                    </button>
                  </>
                )}
                
                
              </div>
            </div>
          </div>
        );
      })}

      
    </div>
  );
}
