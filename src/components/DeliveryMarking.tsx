import { useState, useEffect } from 'react';
import { supabase } from '../supabase/client';
import { OfflineStorage, SyncQueue, NetworkStatus } from '../utils/offline/storage';
import { backgroundSync } from '../utils/offline/backgroundSync';
import type { RouteOrderWithDetails, Order, ReturnReason } from '../types/database';
import { Package, CheckCircle, XCircle, Clock, MapPin, Users } from 'lucide-react';
import { buildFullAddress, geocodeAddress, openWazeWithLL } from '../utils/maps';
import { toast } from 'sonner';

const FALLBACK_RETURN_REASONS: ReturnReason[] = [
  { id: '1', reason: 'Cliente ausente', type: 'both' },
  { id: '2', reason: 'Endereço incorreto / não localizado', type: 'both' },
  { id: '3', reason: 'Cliente sem contato', type: 'both' },
  { id: '4', reason: 'Cliente recusou / cancelou', type: 'both' },
  { id: '5', reason: 'Horário excedido', type: 'both' },
  { id: '99', reason: 'Outro', type: 'both' }
];

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
  // Seleção por pedido para evitar pré-seleção global
  const [returnReasonByOrder, setReturnReasonByOrder] = useState<Record<string, string>>({});
  const [returnObservationsByOrder, setReturnObservationsByOrder] = useState<Record<string, string>>({});
  const [routeDetails, setRouteDetails] = useState<any>(null);

  useEffect(() => {
    loadRouteOrders();
    loadReturnReasons();
    loadRouteDetails();

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
        await loadRouteDetails();
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
          try {
            /* 
            Removido auto-geocoding no load para evitar lentidÃ£o e redundÃ¢ncia.
            As coordenadas devem vir da importaÃ§Ã£o ou serem buscadas sob demanda.
            
            const missing = (data as any[]).filter(r => {
              const a = typeof r.order?.address_json === 'string' ? JSON.parse(r.order.address_json) : (r.order?.address_json || {})
              return !(typeof a.lat === 'number' && typeof a.lng === 'number')
            }).length
            if (missing > 0) {
              toast.info('Ajustando coordenadas da rota...')
              const svc = await fetch('/api/geocode-route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routeId, debug: true, limit: 15 }) })
              if (svc.ok) {
                const js = await svc.json();
                if (js?.ok) toast.success(`Coordenadas atualizadas: ${js.updated}/${js.processed}`)
                await backgroundSync.forceSync();
                await loadRouteOrders();
              }
            }
            */
          } catch { }
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
      // Tenta cache primeiro para funcionar offline
      const cached = await OfflineStorage.getItem('return_reasons');
      if (cached && cached.length) {
        setReturnReasons(cached);
      } else {
        setReturnReasons(FALLBACK_RETURN_REASONS);
        await OfflineStorage.setItem('return_reasons', FALLBACK_RETURN_REASONS);
      }

      if (!NetworkStatus.isOnline()) {
        return;
      }

      const { data, error } = await supabase
        .from('return_reasons')
        .select('*')
        .eq('active', true)
        .order('reason', { ascending: true });

      if (error) throw error;
      if (data && data.length > 0) {
        const filtered = data.filter((r: any) => r.type === 'delivery' || r.type === 'both' || !r.type);
        setReturnReasons(filtered.length ? filtered : FALLBACK_RETURN_REASONS);
        await OfflineStorage.setItem('return_reasons', data);
      } else {
        setReturnReasons(FALLBACK_RETURN_REASONS);
        await OfflineStorage.setItem('return_reasons', FALLBACK_RETURN_REASONS);
      }
    } catch (error: any) {
      console.error('Error loading return reasons:', error);
      const cached = await OfflineStorage.getItem('return_reasons');
      if (cached && cached.length) {
        setReturnReasons(cached);
      } else {
        setReturnReasons(FALLBACK_RETURN_REASONS);
        await OfflineStorage.setItem('return_reasons', FALLBACK_RETURN_REASONS);
      }
    }
  };

  const loadRouteDetails = async () => {
    try {
      const { data, error } = await supabase
        .from('routes')
        .select(`
          name, status,
          driver:drivers(id, user:users(name)),
          team:teams_user(name),
          helper:users!routes_helper_id_fkey(name)
        `)
        .eq('id', routeId)
        .single();

      if (data) setRouteDetails(data);
    } catch (e) {
      console.error('Error loading route details', e);
    }
  };

  const openOrderInMaps = async (routeOrder: RouteOrderWithDetails) => {
    const o = routeOrder.order as any;
    if (!o || !o.address_json) return;
    const raw = o.raw_json || {};
    const enriched = {
      ...o.address_json,
      street: o.address_json.street || raw.destinatario_endereco || '',
      neighborhood: o.address_json.neighborhood || raw.destinatario_bairro || '',
      city: o.address_json.city || raw.destinatario_cidade || '',
      zip: o.address_json.zip || raw.destinatario_cep || '',
      state: o.address_json.state || '',
    };
    const addrText = buildFullAddress(enriched);
    toast.info(`GPS: ${addrText}`);
    const hasLL = typeof enriched.lat !== 'undefined' && typeof enriched.lng !== 'undefined';
    if (hasLL && !isNaN(Number(enriched.lat)) && !isNaN(Number(enriched.lng))) {
      openWazeWithLL(Number(enriched.lat), Number(enriched.lng));
      return;
    }

    // Se nÃ£o tiver lat/lng, avisa e tenta buscar (mas sÃ³ se o usuÃ¡rio clicar, nÃ£o automÃ¡tico no load)
    toast.info('Buscando coordenadas...');

    try {
      const svc = await fetch('/api/geocode-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: routeOrder.order_id, debug: true }) })
      if (svc.ok) {
        const js = await svc.json()
        if (js && js.ok && typeof js.lat === 'number' && typeof js.lng === 'number') {
          toast.success(`Geo OK: ${js.lat},${js.lng}`)
          openWazeWithLL(js.lat, js.lng)
          return
        }
        if (js && js.text) toast.warning('EndereÃ§o sem coordenadas, tentando cliente')
      }
      const coords = await geocodeAddress(enriched);
      if (coords) {
        toast.success(`Geo client OK: ${coords.lat},${coords.lng}`)
        openWazeWithLL(coords.lat, coords.lng);
        try {
          await supabase.from('orders').update({ address_json: { ...enriched, lat: coords.lat, lng: coords.lng } }).eq('id', routeOrder.order_id);
        } catch { }
        return;
      }
    } catch { }
    toast.error('NÃ£o foi possÃ­vel obter coordenadas para este endereÃ§o. Ajuste o endereÃ§o no admin e tente novamente.');
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

        // ATUALIZAÇÃO NO MOMENTO DA ENTREGA (ONLINE)
        // Garante que o pedido saia da lista de disponíveis imediatamente
        const { error: orderError } = await supabase
          .from('orders')
          .update({
            status: 'delivered',
            delivery_date: confirmation.local_timestamp, // Opcional: registrar data entrega
            return_flag: false,
            last_return_reason: null,
            last_return_notes: null
          })
          .eq('id', order.order_id);

        if (orderError) console.warn('[DeliveryMarking] Falha ao atualizar status do pedido principal:', orderError);

        toast.success('Pedido marcado como entregue!');
        setRouteOrders(prev => prev.map(ro => ro.id === order.id ? { ...ro, status: 'delivered', delivered_at: confirmation.local_timestamp } : ro));

        // Verificar se o pedido tem produtos com montagem
        try {
          const { data: orderData, error: orderError } = await supabase
            .from('orders')
            .select('id, items_json, customer_name, phone, address_json, order_id_erp')
            .eq('id', order.order_id)
            .single();

          if (orderError) {
            console.error('Erro ao buscar pedido para montagem:', orderError);
          } else if (orderData && orderData.items_json) {
            console.log('[DeliveryMarking] Verificando montagem para pedido:', orderData.id, 'items:', orderData.items_json.length);

            const produtosComMontagem = orderData.items_json.filter((item: any) =>
              item.has_assembly === 'SIM' || item.has_assembly === 'sim' || item.possui_montagem === true || item.possui_montagem === 'true'
            );

            console.log('[DeliveryMarking] Produtos com montagem encontrados:', produtosComMontagem.length);

            if (produtosComMontagem.length > 0) {
              // Verificar se já existem registros PARA ESTE PEDIDO (order_id é único)
              const { data: existing } = await supabase
                .from('assembly_products')
                .select('id')
                .eq('order_id', orderData.id);

              console.log('[DeliveryMarking] Já existentes para este pedido:', (existing || []).length);

              // Só insere se NÃO existir nenhum registro para este pedido
              if (!existing || existing.length === 0) {
                // Criar registro de montagem pendente
                const assemblyProducts = produtosComMontagem.map((item: any) => ({
                  order_id: orderData.id,
                  product_name: item.name,
                  product_sku: item.sku,
                  customer_name: orderData.customer_name,
                  customer_phone: orderData.phone,
                  installation_address: orderData.address_json,
                  status: 'pending',
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                }));

                // Inserir produtos para montagem (sem assembly_route_id ainda)
                const { error: insertError } = await supabase.from('assembly_products').insert(assemblyProducts);

                if (insertError) {
                  console.error('[DeliveryMarking] Erro ao inserir assembly_products:', insertError);
                } else {
                  console.log('[DeliveryMarking] Inseridos', assemblyProducts.length, 'produtos de montagem com sucesso');

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
                  } catch { }

                  toast.info(`Pedido ${orderData.order_id_erp || order.order.order_id_erp} tem ${produtosComMontagem.length} produto(s) com montagem!`);
                }
              } else {
                console.log('[DeliveryMarking] Pedido já possui produtos de montagem, ignorando criação');
              }
            }
          }
        } catch (error) {
          console.error('Erro ao verificar montagem:', error);
        }


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
    const currentReason = returnReasonByOrder[order.id] || '';
    const currentObs = returnObservationsByOrder[order.id] || '';

    if (!currentReason) {
      toast.error('Por favor, selecione um motivo para o retorno');
      return;
    }

    const isOther = currentReason === 'other';
    const reasonValue = isOther ? currentObs.trim() : currentReason;
    if (isOther && !reasonValue) {
      toast.error('Informe o motivo no campo Observacoes ao escolher "Outro"');
      return;
    }

    try {
      if (processingIds.has(order.id)) return;
      const next = new Set(processingIds); next.add(order.id); setProcessingIds(next);
      const confirmation = {
        order_id: order.order_id,
        route_id: routeId,
        action: 'returned' as const,
        return_reason: reasonValue,
        observations: currentObs,
        local_timestamp: new Date().toISOString(),
        user_id: (await supabase.auth.getUser()).data.user?.id || '',
      };

      if (isOnline) {
        const { error } = await supabase
          .from('route_orders')
          .update({
            status: 'returned',
            returned_at: confirmation.local_timestamp,
            return_reason: confirmation.return_reason,
            return_notes: confirmation.observations || null,
          })
          .eq('id', order.id);

        if (error) throw error;

        // Deixar o pedido roteirizavel novamente, sinalizado como retornado
        // Apenas marcar flag de retorno para visibilidade, MAS MANTER status='assigned'
        // A liberação para 'pending' só ocorre ao FINALIZAR A ROTA.
        const { error: orderUpdateError } = await supabase
          .from('orders')
          .update({
            // status: 'pending', // <--- REMOVIDO: Só libera no Finalizar Rota
            return_flag: true,
            last_return_reason: confirmation.return_reason,
            last_return_notes: confirmation.observations || null,
          })
          .eq('id', order.order_id);

        if (orderUpdateError) {
          console.error('[DeliveryMarking] Falha ao atualizar return_flag na tabela orders:', orderUpdateError);
          // Não falhar completamente, mas avisar
          toast.warning('Retorno registrado na rota, mas flag de retorno pode não ter sido salva.');
        }

        toast.success('Pedido marcado como retornado!');
        setRouteOrders(prev => prev.map(ro => ro.id === order.id ? { ...ro, status: 'returned', returned_at: confirmation.local_timestamp, return_reason: { reason: reasonValue } as any, return_notes: currentObs } : ro));

        if (onUpdated) onUpdated();
      } else {
        // Queue for offline sync
        await SyncQueue.addItem({
          type: 'delivery_confirmation',
          data: confirmation,
        });

        // Também marcar pedido como pendente/retornado para roteirização quando offline
        // queue logic handled above
        await OfflineStorage.setItem(`order_return_${order.order_id}`, {
          // status: 'pending', // <--- REMOVIDO
          return_flag: true,
          last_return_reason: confirmation.return_reason,
          last_return_notes: confirmation.observations || null,
        });

        // Update local state
        const returnReasonObj = returnReasons.find(r => r.reason === currentReason || r.reason === reasonValue);
        const updatedOrders = routeOrders.map(ro =>
          ro.id === order.id
            ? { ...ro, status: 'returned' as const, returned_at: confirmation.local_timestamp, return_reason: returnReasonObj || null, return_notes: currentObs }
            : ro
        );
        setRouteOrders(updatedOrders);

        // Cache offline
        await OfflineStorage.setItem(`route_orders_${routeId}`, updatedOrders);

        toast.success('Pedido marcado como retornado (offline)!');
      }

      // Reset return form
      setReturnReasonByOrder(prev => {
        const copy = { ...prev };
        delete copy[order.id];
        return copy;
      });
      setReturnObservationsByOrder(prev => {
        const copy = { ...prev };
        delete copy[order.id];
        return copy;
      });

      // Toast com opção de desfazer
      toast.success('Retorno registrado', {
        duration: 6000,
        action: {
          label: 'Desfazer',
          onClick: () => undoReturn(order.id),
        },
      });

    } catch (error) {
      console.error('Error marking as returned:', error);
      toast.error('Erro ao marcar pedido como retornado');
    } finally {
      const next2 = new Set(processingIds); next2.delete(order.id); setProcessingIds(next2);
    }
  };

  const undoReturn = async (routeOrderId: string) => {
    const current = routeOrders.find(ro => ro.id === routeOrderId);
    if (!current) return;

    try {
      if (processingIds.has(routeOrderId)) return;
      const next = new Set(processingIds); next.add(routeOrderId); setProcessingIds(next);

      if (isOnline) {
        // ReCheck global status to prevent double processing
        const { data: orderData } = await supabase.from('orders').select('status, id').eq('id', current.order_id).single();
        // If order is delivered or actively in another route, we should normally block.
        // But here assumption is user clicked undo immediately. 
        // For safety: force status back to 'assigned' to LOCK it from Admin Dashboard.

        const { error } = await supabase
          .from('route_orders')
          .update({
            status: 'pending',
            returned_at: null,
            return_reason: null,
            return_notes: null,
          })
          .eq('id', routeOrderId);
        if (error) throw error;

        await supabase
          .from('orders')
          .update({
            status: 'assigned', // LOCK: Back to driver, removed from admin routing list
            return_flag: false,
            last_return_reason: null,
            last_return_notes: null,
          })
          .eq('id', current.order_id);

        const updated = routeOrders.map(ro => ro.id === routeOrderId ? { ...ro, status: 'pending' as const, returned_at: null, return_reason: null } : ro);
        setRouteOrders(updated);
        await OfflineStorage.setItem(`route_orders_${routeId}`, updated);
        setReturnReasonByOrder(prev => { const copy = { ...prev }; delete copy[routeOrderId]; return copy; });
        setReturnObservationsByOrder(prev => { const copy = { ...prev }; delete copy[routeOrderId]; return copy; });
        toast.success('Retorno desfeito');
      } else {
        await SyncQueue.addItem({
          type: 'return_revert',
          data: { order_id: current.order_id, route_id: routeId, user_id: current.route_id },
        });
        const updated = routeOrders.map(ro => ro.id === routeOrderId ? { ...ro, status: 'pending' as const, returned_at: null, return_reason: null } : ro);
        setRouteOrders(updated);
        await OfflineStorage.setItem(`route_orders_${routeId}`, updated);
        setReturnReasonByOrder(prev => { const copy = { ...prev }; delete copy[routeOrderId]; return copy; });
        setReturnObservationsByOrder(prev => { const copy = { ...prev }; delete copy[routeOrderId]; return copy; });
        toast.success('Retorno desfeito (offline)');
      }
    } catch (error) {
      console.error('Error undoing return:', error);
      toast.error('Erro ao desfazer retorno');
    } finally {
      const next2 = new Set(processingIds); next2.delete(routeOrderId); setProcessingIds(next2);
    }
  };

  const undoDelivery = async (routeOrderId: string) => {
    const current = routeOrders.find(ro => ro.id === routeOrderId);
    if (!current) return;

    try {
      if (processingIds.has(routeOrderId)) return;
      const next = new Set(processingIds); next.add(routeOrderId); setProcessingIds(next);

      if (isOnline) {
        const { error } = await supabase
          .from('route_orders')
          .update({
            status: 'pending',
            delivered_at: null,
            signature_url: null
          })
          .eq('id', routeOrderId);
        if (error) throw error;

        await supabase
          .from('orders')
          .update({
            status: 'assigned', // LOCK: Back to driver
            return_flag: false
          })
          .eq('id', current.order_id);

        // Audit: undo delivery
        try {
          const userId = (await supabase.auth.getUser()).data.user?.id || '';
          await supabase.from('audit_logs').insert({
            entity_type: 'order',
            entity_id: current.order_id,
            action: 'delivery_undo',
            details: { route_id: routeId },
            user_id: userId,
            timestamp: new Date().toISOString(),
          });
        } catch { }

        const updated = routeOrders.map(ro => ro.id === routeOrderId ? { ...ro, status: 'pending' as const, delivered_at: null } : ro);
        setRouteOrders(updated);
        await OfflineStorage.setItem(`route_orders_${routeId}`, updated);
        toast.success('Entrega desfeita');

      } else {
        await SyncQueue.addItem({
          type: 'delivery_revert',
          data: { order_id: current.order_id, route_id: routeId, user_id: current.route_id },
        });
        const updated = routeOrders.map(ro => ro.id === routeOrderId ? { ...ro, status: 'pending' as const, delivered_at: null } : ro);
        setRouteOrders(updated);
        await OfflineStorage.setItem(`route_orders_${routeId}`, updated);
        toast.success('Entrega desfeita (offline)');
      }
    } catch (error) {
      console.error('Error undoing delivery:', error);
      toast.error('Erro ao desfazer entrega');
    } finally {
      const next2 = new Set(processingIds); next2.delete(routeOrderId); setProcessingIds(next2);
    }
  };

  const handleFinalizeRoute = async () => {
    // Verificar se todos foram processados
    const pending = routeOrders.filter(r => r.status === 'pending');
    if (pending.length > 0) {
      toast.error(`Ainda existem ${pending.length} pedidos pendentes na rota.`);
      return;
    }

    if (!window.confirm('Confirma a finalização da rota? Os pedidos retornados serão liberados para roteirização.')) {
      return;
    }

    setLoading(true);
    try {
      const confirmation = {
        route_id: routeId,
        local_timestamp: new Date().toISOString(),
      };

      if (isOnline) {
        // 1. Marcar rota como concluída
        const { error } = await supabase.from('routes').update({ status: 'completed' }).eq('id', routeId);
        if (error) throw error;

        // 2. Buscar pedidos retornados DIRETAMENTE do banco para garantir consistência
        const { data: dbReturned } = await supabase
          .from('route_orders')
          .select('order_id')
          .eq('route_id', routeId)
          .eq('status', 'returned');

        const returnedDefaults = routeOrders.filter(r => r.status === 'returned').map(r => r.order_id);
        // Combine DB results with local state as fallback (though DB should be primary source of truth after update)
        // Actually, if we just marked them returned, DB should have them. 
        // Using distinct set of IDs.
        const returnedIds = Array.from(new Set([...(dbReturned?.map(r => r.order_id) || []), ...returnedDefaults]));

        if (returnedIds.length > 0) {
          await supabase
            .from('orders')
            .update({
              status: 'pending',
              return_flag: true // GARANTIA: Se estava como retornado na rota, tem que ter a flag
            })
            .in('id', returnedIds);
        }

        // 3. (NOVO) GARANTIA FINAL: Assegurar que todos os ENTREGUES estejam com status 'delivered' na tabela orders
        // Isso corrige qualquer divergência caso a atualização individual tenha falhado
        const deliveredIds = routeOrders.filter(r => r.status === 'delivered').map(r => r.order_id);
        if (deliveredIds.length > 0) {
          await supabase
            .from('orders')
            .update({ status: 'delivered' })
            .in('id', deliveredIds)
            // Apenas atualiza se NÃO estiver delivered (opcional, mas o update direto é seguro)
            .neq('status', 'delivered');
        }

        toast.success('Rota finalizada com sucesso!');
        setRouteDetails((prev: any) => ({ ...prev, status: 'completed' }));
        if (onUpdated) onUpdated();
      } else {
        // Offline: Queue route completion
        await SyncQueue.addItem({
          type: 'route_completion',
          data: confirmation,
        });

        // Local update
        setRouteDetails((prev: any) => ({ ...prev, status: 'completed' }));
        toast.success('Rota finalizada (offline). Será sincronizada quando online.');
      }

    } catch (error) {
      console.error('Error finalizing route:', error);
      toast.error('Erro ao finalizar rota.');
    } finally {
      setLoading(false);
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
      {routeDetails && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3 border-b border-gray-100 pb-2">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-gray-900">{routeDetails.name}</h2>
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${routeDetails.status === 'completed' ? 'bg-green-100 text-green-800' :
                routeDetails.status === 'in_progress' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'
                }`}>
                {routeDetails.status === 'pending' ? 'Em Separação' : routeDetails.status === 'in_progress' ? 'Em Rota' : routeDetails.status === 'completed' ? 'Finalizada' : routeDetails.status}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="flex items-center gap-2 text-gray-700">
              <Users className="h-4 w-4 text-blue-500" />
              <span className="font-semibold">Equipe:</span> {routeDetails.team?.name || 'Não informada'}
            </div>
            <div className="flex items-center gap-2 text-gray-700">
              <span className="font-semibold">Motorista:</span> {routeDetails.driver?.user?.name || routeDetails.driver?.name || 'Não informado'}
            </div>
            <div className="flex items-center gap-2 text-gray-700">
              <span className="font-semibold">Ajudante:</span> {routeDetails.helper?.name || 'Não informado'}
            </div>
          </div>
        </div>
      )}
      {/* Network Status */}
      <div className={`p-3 rounded-lg flex items-center ${isOnline ? 'bg-green-50 text-green-800' : 'bg-yellow-50 text-yellow-800'
        }`}>
        <div className={`w-2 h-2 rounded-full mr-2 ${isOnline ? 'bg-green-500' : 'bg-yellow-500'
          }`}></div>
        <span className="text-sm font-medium">
          {isOnline ? 'Online' : 'Modo Offline'}
        </span>
      </div>

      {/* Orders List */}
      {routeOrders.map((routeOrder) => {
        const order = routeOrder.order;
        if (!order) return null;
        const selectedReason = returnReasonByOrder[routeOrder.id] || '';
        const selectedObs = returnObservationsByOrder[routeOrder.id] || '';

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
                    const items: any[] = Array.isArray(order.items_json) ? order.items_json as any[] : [];
                    const v = items.reduce((sum: number, it: any) => sum + Number(it.total_price_real ?? it.total_price ?? (Number(it.unit_price_real ?? it.unit_price ?? 0) * Number(it.purchased_quantity ?? 1))), 0);
                    return <div>Valor: R$ {v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>;
                  })()}
                  {(() => {
                    const obs = (order as any).Observacoes_publicas || (order as any).raw_json?.Observacoes || '';
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
                          value={selectedReason}
                          onChange={(e) => setReturnReasonByOrder(prev => ({ ...prev, [routeOrder.id]: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Selecione um motivo</option>
                          {returnReasons.map((reason) => {
                            const label = (reason as any).reason_text || (reason as any).reason || reason.id;
                            const value = (reason as any).reason || (reason as any).reason_text || reason.id;
                            return (
                              <option key={reason.id || value} value={value}>
                                {label}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Observacoes {(selectedReason === 'Outro' || selectedReason === '99' || selectedReason === 'other') ? '(obrigatorio para "Outro")' : ''}
                        </label>
                        <input
                          type="text"
                          value={selectedObs}
                          onChange={(e) => setReturnObservationsByOrder(prev => ({ ...prev, [routeOrder.id]: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Observacoes adicionais..."
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Undo for returned */}
                {routeOrder.status === 'returned' && (
                  <div className="mt-3">
                    <button
                      onClick={() => undoReturn(routeOrder.id)}
                      disabled={processingIds.has(routeOrder.id)}
                      className="inline-flex items-center px-3 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      Desfazer retorno
                    </button>
                  </div>
                )}
                {/* Undo for delivered */}
                {routeOrder.status === 'delivered' && (
                  <div className="mt-3">
                    <button
                      onClick={() => undoDelivery(routeOrder.id)}
                      disabled={processingIds.has(routeOrder.id)}
                      className="inline-flex items-center px-3 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      Desfazer entrega
                    </button>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="ml-4 flex flex-col space-y-2">
                {/* GPS removido */}
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
                      disabled={!selectedReason || processingIds.has(routeOrder.id)}
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

      <div className="mt-8 pt-4 border-t border-gray-200 sticky bottom-0 bg-gray-50 pb-4 px-4 -mx-4 z-10">
        <button
          onClick={handleFinalizeRoute}
          disabled={loading || processingIds.size > 0 || (routeDetails?.status === 'completed')}
          className={`w-full py-4 rounded-xl font-bold text-lg shadow-sm transition-all flex items-center justify-center gap-2 ${routeDetails?.status === 'completed'
            ? 'bg-green-100 text-green-700 cursor-not-allowed border border-green-200'
            : 'bg-green-600 text-white hover:bg-green-700 hover:shadow-md'
            }`}
        >
          {loading ? (
            <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-current"></span>
          ) : routeDetails?.status === 'completed' ? (
            <>
              <CheckCircle className="h-6 w-6" />
              Rota Finalizada
            </>
          ) : (
            <>
              <CheckCircle className="h-6 w-6" />
              Finalizar Rota
            </>
          )}
        </button>
        {routeDetails?.status !== 'completed' && (
          <p className="text-center text-xs text-gray-500 mt-2">
            Só é possível finalizar a rota quando todos os pedidos forem marcados como entregue ou retornado.
          </p>
        )}
      </div>

    </div>
  );
}










