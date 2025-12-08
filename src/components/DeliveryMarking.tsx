import { useState, useEffect } from 'react';
import { supabase } from '../supabase/client';
import { OfflineStorage, SyncQueue, NetworkStatus } from '../utils/offline/storage';
import { backgroundSync } from '../utils/offline/backgroundSync';
import type { RouteOrderWithDetails, Order, ReturnReason } from '../types/database';
import { Package, CheckCircle, XCircle, Clock, MapPin } from 'lucide-react';
import { buildFullAddress, openNavigationSmartAddressJson } from '../utils/maps';
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

  const openOrderInMaps = async (routeOrder: RouteOrderWithDetails) => {
    const o = routeOrder.order as any;
    if (!o || !o.address_json) return;
    await openNavigationSmartAddressJson(o.address_json);
  };

  const savePreciseLocation = async (routeOrder: RouteOrderWithDetails) => {
    try {
      await new Promise<void>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const order = routeOrder.order as any;
            const addr = typeof order.address_json === 'string' ? JSON.parse(order.address_json) : (order.address_json || {});
            const nextAddr = { ...addr, lat, lng };
            const { error } = await supabase.from('orders').update({ address_json: nextAddr }).eq('id', routeOrder.order_id);
            if (!error) {
              setRouteOrders(prev => prev.map(ro => ro.id === routeOrder.id ? { ...ro, order: { ...ro.order, address_json: nextAddr } as any } : ro));
              toast.success('Localização precisa salva');
            } else {
              toast.error('Erro ao salvar localização');
            }
            resolve();
          },
          (err) => {
            toast.error('Não foi possível obter a localização do dispositivo');
            reject(err);
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      });
    } catch {}
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
        
        // Verificar se o pedido tem produtos com montagem
        try {
            const { data: orderData } = await supabase
            .from('orders')
            .select('id, items_json, customer_name, phone, address_json, order_id_erp')
            .eq('id', order.order_id)
            .single();
          
          if (orderData && orderData.items_json) {
            const produtosComMontagem = orderData.items_json.filter((item: any) => 
              item.has_assembly === 'SIM' || item.has_assembly === 'sim' || item.possui_montagem === true || item.possui_montagem === 'true'
            );
            
            if (produtosComMontagem.length > 0) {
              // Criar registro de montagem pendente
              const assemblyProducts = produtosComMontagem.map((item: any) => ({
                order_id: orderData.id,
                product_name: item.name,
                product_sku: item.sku,
                customer_name: orderData.customer_name,
                customer_phone: orderData.phone,
                installation_address: orderData.address_json,
                status: 'pending', // Mantém como pending para o admin atribuir
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }));
              
              // Inserir produtos para montagem (sem assembly_route_id ainda)
              await supabase.from('assembly_products').insert(assemblyProducts);

              // Auditoria: pedido passou a requerer montagem
              try {
                const userId = (await supabase.auth.getUser()).data.user?.id || '';
                await supabase.from('audit_logs').insert({
                  entity_type: 'order',
                  entity_id: orderData.id,
                  action: 'assembly_required',
                  details: { count: produtosComMontagem.length },
                  user_id: userId,
                  timestamp: new Date().toISOString(),
                });
              } catch {}
              
              toast.info(`Pedido ${orderData.order_id_erp || order.order.order_id_erp} tem ${produtosComMontagem.length} produto(s) com montagem!`);
            }
          }
        } catch (error) {
          console.error('Erro ao verificar montagem:', error);
        }
        
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
              // Auditoria: pedidos marcados como entregues
              try {
                const userId = (await supabase.auth.getUser()).data.user?.id || '';
                const now = new Date().toISOString();
                const logs = deliveredIds.map((oid: string) => ({
                  entity_type: 'order',
                  entity_id: oid,
                  action: 'delivered',
                  details: { route_id: routeId },
                  user_id: userId,
                  timestamp: now,
                }));
                await supabase.from('audit_logs').insert(logs);
              } catch {}
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
                    {buildFullAddress(order.address_json)}
                  </div>
                  <div>
                    Telefone: {order.phone}
                    {(() => {
                      const toDigits = (s: string) => String(s || '').replace(/\D/g, '');
                      const d = toDigits(order.phone);
                      const n = d ? (d.startsWith('55') ? d : '55' + d) : '';
                      const href = n ? `https://wa.me/${n}` : '';
                      return href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center text-green-600 hover:text-green-700" title="Abrir WhatsApp">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                            <path d="M20.52 3.48A11.84 11.84 0 0 0 12.04 0C5.48 0 .16 5.32.16 11.88c0 2.08.56 4.08 1.6 5.84L0 24l6.48-1.68a11.66 11.66 0 0 0 5.56 1.44h.04c6.56 0 11.88-5.32 11.88-11.88 0-3.2-1.24-6.2-3.52-8.4ZM12.08 21.2h-.04a9.7 9.7 0 0 1-4.96-1.36l-.36-.2-3.84 1L3.96 16l-.24-.4A9.86 9.86 0 0 1 2 11.88c0-5.52 4.52-10.04 10.08-10.04 2.68 0 5.2 1.04 7.08 2.92a9.9 9.9 0 0 1 2.96 7.12c0 5.56-4.52 10.32-10.04 10.32Zm5.76-7.44c-.32-.2-1.88-.92-2.16-1.04-.28-.12-.48-.2-.68.12-.2.32-.8 1.04-.98 1.24-.2.2-.36.24-.68.08-.32-.16-1.36-.5-2.6-1.6-.96-.84-1.6-1.88-1.8-2.2-.2-.32 0-.52.16-.68.16-.16.32-.4.48-.6.16-.2.2-.36.32-.6.12-.24.08-.44-.04-.64-.12-.2-.68-1.64-.92-2.2-.24-.56-.48-.48-.68-.48h-.56c-.2 0-.52.08-.8.4-.28.32-1.08 1.08-1.08 2.64s1.12 3.08 1.28 3.3c.16.2 2.24 3.42 5.4 4.72.76.32 1.36.52 1.82.66.76.24 1.44.2 1.98.12.6-.1 1.88-.76 2.14-1.5.26-.74.26-1.36.18-1.5-.08-.14-.28-.22-.6-.4Z" />
                          </svg>
                        </a>
                      ) : null;
                    })()}
                  </div>
                  <div>Pedido: {order.order_id_erp}</div>
                  {(() => {
                    const items:any[] = Array.isArray(order.items_json) ? order.items_json as any[] : [];
                    const v = items.reduce((sum:number,it:any)=> sum + Number(it.total_price_real ?? it.total_price ?? (Number(it.unit_price_real ?? it.unit_price ?? 0) * Number(it.purchased_quantity ?? 1))), 0);
                    return <div>Valor: R$ {v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>;
                  })()}
                  {(() => {
                    const obs = (order as any).observacoes_publicas || (order as any).raw_json?.observacoes || '';
                    return obs ? (
                      <div className="text-yellow-600">
                        <strong>Obs:</strong> {obs}
                      </div>
                    ) : null;
                  })()}
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
                <button
                  onClick={() => openOrderInMaps(routeOrder)}
                  className="flex items-center px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors text-sm"
                >
                  <MapPin className="h-4 w-4 mr-1" />
                  Abrir no GPS
                </button>
                <button
                  onClick={() => savePreciseLocation(routeOrder)}
                  className="flex items-center px-3 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors text-sm border border-gray-300"
                >
                  Salvar ponto preciso
                </button>
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
