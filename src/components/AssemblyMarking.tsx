import { useState, useEffect } from 'react';
import { supabase } from '../supabase/client';
import { OfflineStorage, SyncQueue, NetworkStatus } from '../utils/offline/storage';
import { backgroundSync } from '../utils/offline/backgroundSync';
import type { ReturnReason } from '../types/database';
import { Package, CheckCircle, XCircle, Clock, MapPin } from 'lucide-react';
import { buildFullAddress, openWazeWithLL } from '../utils/maps';
import { toast } from 'sonner';

const FALLBACK_RETURN_REASONS: ReturnReason[] = [
  { id: 'customer-absent', reason: 'Cliente ausente' },
  { id: 'address-issue', reason: 'Endereço incorreto ou incompleto' },
  { id: 'damages', reason: 'Produto danificado' },
  { id: 'refused', reason: 'Cliente recusou montagem' },
  { id: 'other', reason: 'Outro (digitar abaixo)' },
];

interface AssemblyMarkingProps {
  routeId: string;
  onUpdated?: () => void;
}

export default function AssemblyMarking({ routeId, onUpdated }: AssemblyMarkingProps) {
  const [assemblyItems, setAssemblyItems] = useState<any[]>([]);
  const [returnReasons, setReturnReasons] = useState<ReturnReason[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(NetworkStatus.isOnline());
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [returnReasonByOrder, setReturnReasonByOrder] = useState<Record<string, string>>({});
  const [returnObservationsByOrder, setReturnObservationsByOrder] = useState<Record<string, string>>({});

  useEffect(() => {
    loadRouteItems();
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
        await loadRouteItems();
      } else {
        await loadRouteItems();
      }
    };
    run();
  }, [isOnline]);

  const loadRouteItems = async () => {
    try {
      setLoading(true);

      if (isOnline) {
        const { data, error } = await supabase
          .from('assembly_products')
          .select(`
            *,
            order:order_id(*)
          `)
          .eq('assembly_route_id', routeId)
          .order('created_at', { ascending: true });

        if (error) throw error;
        if (data) {
          setAssemblyItems(data);
          await OfflineStorage.setItem(`assembly_items_${routeId}`, data);
        }
      } else {
        const cached = await OfflineStorage.getItem(`assembly_items_${routeId}`);
        if (cached) {
          setAssemblyItems(cached);
        }
      }
    } catch (error) {
      console.error('Error loading assembly items:', error);
      toast.error('Erro ao carregar itens de montagem');
    } finally {
      setLoading(false);
    }
  };

  const loadReturnReasons = async () => {
    try {
      const cached = await OfflineStorage.getItem('return_reasons');
      if (cached && cached.length) {
        setReturnReasons(cached);
      } else {
        setReturnReasons(FALLBACK_RETURN_REASONS);
        await OfflineStorage.setItem('return_reasons', FALLBACK_RETURN_REASONS);
      }

      if (!NetworkStatus.isOnline()) return;

      const { data, error } = await supabase
        .from('return_reasons')
        .select('*')
        .eq('active', true)
        .order('reason', { ascending: true });

      if (error) throw error;
      if (data && data.length > 0) {
        setReturnReasons(data as ReturnReason[]);
        await OfflineStorage.setItem('return_reasons', data);
      } else {
        setReturnReasons(FALLBACK_RETURN_REASONS);
        await OfflineStorage.setItem('return_reasons', FALLBACK_RETURN_REASONS);
      }
    } catch (error) {
      console.error('Error loading return reasons:', error);
    }
  };

  const markAsCompleted = async (item: any) => {
    try {
      if (processingIds.has(item.id)) return;
      const next = new Set(processingIds); next.add(item.id); setProcessingIds(next);

      const now = new Date().toISOString();
      const userId = (await supabase.auth.getUser()).data.user?.id || '';

      const confirmation = {
        item_id: item.id,
        route_id: routeId,
        action: 'completed',
        local_timestamp: now,
        user_id: userId,
      };

      if (isOnline) {
        const { error } = await supabase
          .from('assembly_products')
          .update({
            status: 'completed',
            completion_date: now,
          })
          .eq('id', item.id);

        if (error) throw error;
        toast.success('Serviço marcado como MONTADO!');

        // Atualiza estado local
        const updated = assemblyItems.map(it => it.id === item.id ? { ...it, status: 'completed', completion_date: now } : it);
        setAssemblyItems(updated);
        await OfflineStorage.setItem(`assembly_items_${routeId}`, updated);

        // Verifica se todos os produtos da rota estão concluídos
        const { data: allProducts } = await supabase
          .from('assembly_products')
          .select('status')
          .eq('assembly_route_id', routeId);

        if (allProducts && allProducts.length > 0) {
          const allDone = allProducts.every((p: any) => p.status !== 'pending');
          if (allDone) {
            await supabase.from('assembly_routes').update({ status: 'completed' }).eq('id', routeId);
            toast.success('Rota de montagem concluída!');
          }
        }

        if (onUpdated) onUpdated();
      } else {
        // Offline
        await SyncQueue.addItem({ type: 'assembly_confirmation', data: confirmation });
        const updated = assemblyItems.map(it => it.id === item.id ? { ...it, status: 'completed', completion_date: now } : it);
        setAssemblyItems(updated);
        await OfflineStorage.setItem(`assembly_items_${routeId}`, updated);
        toast.success('Marcado como MONTADO (offline)!');
      }
    } catch (error) {
      console.error('Error marking as completed:', error);
      toast.error('Erro ao marcar serviço');
    } finally {
      const next2 = new Set(processingIds); next2.delete(item.id); setProcessingIds(next2);
    }
  };

  const markAsReturned = async (item: any) => {
    const currentReason = returnReasonByOrder[item.id] || '';
    const currentObs = returnObservationsByOrder[item.id] || '';

    if (!currentReason) {
      toast.error('Selecione um motivo para o retorno');
      return;
    }

    const isOther = currentReason === 'other';
    const reasonValue = isOther ? currentObs.trim() : currentReason;
    if (isOther && !reasonValue) {
      toast.error('Informe o motivo nas observações');
      return;
    }

    try {
      if (processingIds.has(item.id)) return;
      const next = new Set(processingIds); next.add(item.id); setProcessingIds(next);

      const now = new Date().toISOString();
      const userId = (await supabase.auth.getUser()).data.user?.id || '';

      const confirmation = {
        item_id: item.id,
        route_id: routeId,
        action: 'returned',
        return_reason: reasonValue,
        observations: currentObs,
        local_timestamp: now,
        user_id: userId,
      };

      if (isOnline) {
        // Marca como cancelado/retornado na lista atual
        const { error } = await supabase
          .from('assembly_products')
          .update({
            status: 'cancelled', // Retornado
            returned_at: now,
            observations: currentObs ? `(Retorno: ${reasonValue}) ${currentObs}` : `Retorno: ${reasonValue}`
          })
          .eq('id', item.id);

        if (error) throw error;

        // Clone para nova tentativa (libera para nova rota)
        const newItem = {
          order_id: item.order_id,
          product_name: item.product_name,
          product_sku: item.product_sku,
          customer_name: item.customer_name,
          customer_phone: item.customer_phone,
          installation_address: item.installation_address,
          status: 'pending', // Volta para pendente sem rota
          observations: item.observations,
          assembly_route_id: null, // Sem rota definida
          was_returned: true // Marca como retorno para badge
        };

        await supabase.from('assembly_products').insert(newItem);

        toast.success('Marcado como RETORNADO!');

        const updated = assemblyItems.map(it => it.id === item.id ? { ...it, status: 'cancelled' } : it);
        setAssemblyItems(updated);
        OfflineStorage.setItem(`assembly_items_${routeId}`, updated);

        // Verifica se todos os produtos da rota estão concluídos
        const { data: allProducts } = await supabase
          .from('assembly_products')
          .select('status')
          .eq('assembly_route_id', routeId);

        if (allProducts && allProducts.length > 0) {
          const allDone = allProducts.every((p: any) => p.status !== 'pending');
          if (allDone) {
            await supabase.from('assembly_routes').update({ status: 'completed' }).eq('id', routeId);
            toast.success('Rota de montagem concluída!');
          }
        }

        if (onUpdated) onUpdated();
      } else {
        await SyncQueue.addItem({ type: 'assembly_return', data: confirmation });

        const updated = assemblyItems.map(it => it.id === item.id ? { ...it, status: 'cancelled' } : it);
        setAssemblyItems(updated);
        OfflineStorage.setItem(`assembly_items_${routeId}`, updated);

        toast.success('Marcado como RETORNADO (offline)!');
      }

      setReturnReasonByOrder(prev => { const copy = { ...prev }; delete copy[item.id]; return copy; });
      setReturnObservationsByOrder(prev => { const copy = { ...prev }; delete copy[item.id]; return copy; });

    } catch (error) {
      console.error('Error marking return:', error);
      toast.error('Erro ao registrar retorno');
    } finally {
      const next2 = new Set(processingIds); next2.delete(item.id); setProcessingIds(next2);
    }
  };

  const undoAction = async (item: any) => {
    try {
      if (processingIds.has(item.id)) return;
      const next = new Set(processingIds); next.add(item.id); setProcessingIds(next);

      const userId = (await supabase.auth.getUser()).data.user?.id || '';
      const now = new Date().toISOString();

      const confirmation = {
        item_id: item.id,
        route_id: routeId,
        action: 'undo',
        local_timestamp: now,
        user_id: userId,
      };

      if (isOnline) {
        // Resetar item para pendente
        const { error } = await supabase
          .from('assembly_products')
          .update({
            status: 'pending',
            completion_date: null,
            observations: item.observations ? item.observations.replace(/\(Retorno: .*\)\s*/, '').replace(/^Retorno: .*/, '').trim() : item.observations
          })
          .eq('id', item.id);

        if (error) throw error;

        toast.success('Ação desfeita!');

        const updated = assemblyItems.map(it => it.id === item.id ? {
          ...it,
          status: 'pending',
          completion_date: null,
          observations: it.observations ? it.observations.replace(/\(Retorno: .*\)\s*/, '').replace(/^Retorno: .*/, '').trim() : it.observations
        } : it);

        setAssemblyItems(updated);
        await OfflineStorage.setItem(`assembly_items_${routeId}`, updated);

        if (onUpdated) onUpdated();
      } else {
        // Offline Undo
        await SyncQueue.addItem({ type: 'assembly_undo', data: confirmation });

        const updated = assemblyItems.map(it => it.id === item.id ? {
          ...it,
          status: 'pending',
          completion_date: null,
          observations: it.observations ? it.observations.replace(/\(Retorno: .*\)\s*/, '').replace(/^Retorno: .*/, '').trim() : it.observations
        } : it);

        setAssemblyItems(updated);
        await OfflineStorage.setItem(`assembly_items_${routeId}`, updated);

        toast.success('Ação desfeita (offline)!');
      }

      // Limpar formulários de retorno se existirem
      setReturnReasonByOrder(prev => { const copy = { ...prev }; delete copy[item.id]; return copy; });
      setReturnObservationsByOrder(prev => { const copy = { ...prev }; delete copy[item.id]; return copy; });

    } catch (error) {
      console.error('Error undoing action:', error);
      toast.error('Erro ao desfazer ação');
    } finally {
      const next2 = new Set(processingIds); next2.delete(item.id); setProcessingIds(next2);
    }
  };

  const openMaps = (item: any) => {
    const addr = item.installation_address || item.order?.address_json;
    if (!addr) {
      toast.error('Endereço não disponível');
      return;
    }

    const fullAddr = buildFullAddress(addr);
    toast.info(`Endereço: ${fullAddr}`);

    if (addr.lat && addr.lng) {
      openWazeWithLL(addr.lat, addr.lng);
    } else {
      // Fallback simples para busca textual se não houver coordenadas
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddr)}`;
      window.open(mapsUrl, '_blank');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-yellow-100 text-yellow-800';
    }
  };

  const getStatusText = (status: string) => {
    if (status === 'completed') return 'Montado';
    if (status === 'cancelled') return 'Retornado';
    return 'Pendente';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-gray-600">Carregando serviços...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={`p-3 rounded-lg flex items-center ${isOnline ? 'bg-green-50 text-green-800' : 'bg-yellow-50 text-yellow-800'
        }`}>
        <div className={`w-2 h-2 rounded-full mr-2 ${isOnline ? 'bg-green-500' : 'bg-yellow-500'
          }`}></div>
        <span className="text-sm font-medium">
          {isOnline ? 'Online' : 'Modo Offline'}
        </span>
      </div>

      {assemblyItems.map((item) => {
        const selectedReason = returnReasonByOrder[item.id] || '';
        const selectedObs = returnObservationsByOrder[item.id] || '';

        return (
          <div key={item.id} className="bg-white rounded-lg shadow p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center mb-2">
                  <Package className="h-5 w-5 text-indigo-600 mr-2" />
                  <span className="font-semibold text-gray-900">
                    {item.customer_name}
                  </span>
                  <span className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(item.status)}`}>
                    {getStatusText(item.status)}
                  </span>
                </div>

                <div className="text-sm text-gray-600 space-y-1">
                  <div className="flex items-center" onClick={() => openMaps(item)} role="button">
                    <MapPin className="h-4 w-4 mr-1 text-blue-500" />
                    <span className="underline decoration-dotted">{buildFullAddress(item.installation_address || item.order?.address_json)}</span>
                  </div>
                  <div>Produto: <strong>{item.product_name}</strong></div>
                  <div>SKU: {item.product_sku}</div>

                  {item.observations && (
                    <div className="text-yellow-600 text-xs mt-1">
                      Note: {item.observations}
                    </div>
                  )}
                </div>

                {/* Return Form */}
                {item.status === 'pending' && (
                  <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                    <div className="grid grid-cols-1 gap-3">
                      <label className="block text-xs font-medium text-gray-700">
                        Se houver problema, informe o motivo do retorno:
                      </label>
                      <select
                        value={selectedReason}
                        onChange={(e) => setReturnReasonByOrder(prev => ({ ...prev, [item.id]: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      >
                        <option value="">Selecione...</option>
                        {returnReasons.map((r: any) => (
                          <option key={r.id || r.reason} value={r.reason || r.id}>{r.reason || r.reason_text}</option>
                        ))}
                      </select>
                      {selectedReason === 'other' && (
                        <input
                          type="text"
                          placeholder="Descreva o motivo..."
                          value={selectedObs}
                          onChange={(e) => setReturnObservationsByOrder(prev => ({ ...prev, [item.id]: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="ml-4 flex flex-col space-y-2 min-w-[120px]">
                {item.status === 'pending' && (
                  <>
                    <button
                      onClick={() => markAsCompleted(item)}
                      disabled={processingIds.has(item.id)}
                      className="flex items-center justify-center w-full px-4 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors text-sm font-bold shadow-sm"
                    >
                      <CheckCircle className="h-5 w-5 mr-1" />
                      MONTADO
                    </button>

                    <button
                      onClick={() => markAsReturned(item)}
                      disabled={!selectedReason || processingIds.has(item.id)}
                      className="flex items-center justify-center w-full px-4 py-3 bg-red-100 text-red-700 rounded-md hover:bg-red-200 disabled:opacity-50 transition-colors text-sm font-bold shadow-sm"
                    >
                      <XCircle className="h-5 w-5 mr-1" />
                      RETORNAR
                    </button>
                  </>
                )}

                {(item.status === 'completed' || item.status === 'cancelled') && (
                  <button
                    onClick={() => undoAction(item)}
                    disabled={processingIds.has(item.id)}
                    className="flex items-center justify-center px-3 py-2 bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 disabled:opacity-50 transition-colors text-xs font-medium w-full border border-gray-200 shadow-sm"
                    title="Desfazer ação"
                  >
                    Desfazer
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {assemblyItems.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          Nenhum item nesta rota.
        </div>
      )}
    </div>
  );
}
