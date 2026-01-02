import { useState, useEffect } from 'react';
import { supabase } from '../supabase/client';
import { OfflineStorage, SyncQueue, NetworkStatus } from '../utils/offline/storage';
import { backgroundSync } from '../utils/offline/backgroundSync';
import type { ReturnReason } from '../types/database';
import { Package, CheckCircle, XCircle, Clock, MapPin } from 'lucide-react';
import { buildFullAddress } from '../utils/maps';
import { toast } from 'sonner';

const FALLBACK_RETURN_REASONS: ReturnReason[] = [
  { id: '1', reason: 'Cliente ausente', type: 'both' },
  { id: '2', reason: 'Endereço incorreto / não localizado', type: 'both' },
  { id: '3', reason: 'Cliente sem contato', type: 'both' },
  { id: '4', reason: 'Cliente recusou / cancelou', type: 'both' },
  { id: '5', reason: 'Horário excedido', type: 'both' },
  { id: '99', reason: 'Outro', type: 'both' }
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
  const [routeStatus, setRouteStatus] = useState<string>('pending');

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

      let data: any[] | null = null;
      let status: string | null = null;

      if (isOnline) {
        const { data: serverData, error } = await supabase
          .from('assembly_products')
          .select(`
            *,
            order:order_id(*)
          `)
          .eq('assembly_route_id', routeId)
          .order('created_at', { ascending: true });

        if (error) throw error;
        data = serverData;

        // Fetch route status
        const { data: routeData, error: routeError } = await supabase
          .from('assembly_routes')
          .select('status')
          .eq('id', routeId)
          .single();

        if (!routeError && routeData) {
          status = routeData.status;
        }
      } else {
        const cached = await OfflineStorage.getItem(`assembly_items_${routeId}`);
        if (cached) {
          data = cached;
        }
        // Load cached route status for offline
        const cachedStatus = await OfflineStorage.getItem(`assembly_route_status_${routeId}`);
        if (cachedStatus) {
          status = cachedStatus;
        }
      }

      if (data) {
        // MERGE LOCAL PENDING ACTIONS - APENAS QUANDO OFFLINE
        // Quando online, o servidor é a fonte da verdade (após sync)
        // Quando offline, precisamos mostrar o estado local baseado nas ações pendentes
        if (!isOnline) {
          try {
            const pendingSync = await SyncQueue.getPendingItems();

            // Apply pending actions to data (ONLY OFFLINE)
            data = data.map(item => {
              // Find pending update for this item - STRICT CHECK
              const itemActions = pendingSync.filter(p =>
                (p.type === 'assembly_confirmation' || p.type === 'assembly_return' || p.type === 'assembly_undo') &&
                p.data?.item_id === item.id &&
                String(p.data?.route_id) === String(routeId) // Ensure action belongs to this route
              );

              // Apply them in order
              let tempItem = { ...item };
              for (const action of itemActions) {
                if (action.type === 'assembly_confirmation') {
                  tempItem.status = 'completed';
                  tempItem.completion_date = action.data.local_timestamp;
                } else if (action.type === 'assembly_return') {
                  tempItem.status = 'cancelled';
                  tempItem.returned_at = action.data.local_timestamp;
                  if (action.data.observations) {
                    tempItem.observations = action.data.observations;
                  }
                } else if (action.type === 'assembly_undo') {
                  tempItem.status = 'pending';
                  tempItem.completion_date = null;
                  tempItem.returned_at = null;
                }
              }
              return tempItem;
            });

            // Also check for pending route completion (ONLY OFFLINE)
            const pendingCompletion = pendingSync.find(p =>
              (p.type === 'route_completion' || p.type === 'assembly_route_completion') &&
              p.data?.route_id === routeId
            );
            if (pendingCompletion) {
              status = 'completed';
            }

          } catch (mergeErr) {
            console.error('Error merging pending items:', mergeErr);
          }
        }

        setAssemblyItems(data);
        await OfflineStorage.setItem(`assembly_items_${routeId}`, data);
      }

      if (status) {
        setRouteStatus(status);
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
        const filtered = data.filter((r: any) => r.type === 'assembly' || r.type === 'both' || !r.type);
        setReturnReasons(filtered.length ? filtered : FALLBACK_RETURN_REASONS);
        await OfflineStorage.setItem('return_reasons', data);
      } else {
        setReturnReasons(FALLBACK_RETURN_REASONS);
        await OfflineStorage.setItem('return_reasons', FALLBACK_RETURN_REASONS);
      }
    } catch (error: any) {
      console.error('Error loading return reasons:', error);
    }
  };

  const markAsCompleted = async (itemsToMark: any[]) => {
    try {
      const ids = itemsToMark.map(i => i.id);
      if (ids.some(id => processingIds.has(id))) return;
      const next = new Set(processingIds); ids.forEach(id => next.add(id)); setProcessingIds(next);

      const now = new Date().toISOString();
      const userId = (await supabase.auth.getUser()).data.user?.id || '';

      if (isOnline) {
        const { error } = await supabase
          .from('assembly_products')
          .update({
            status: 'completed',
            completion_date: now,
          })
          .in('id', ids);

        if (error) throw error;
        toast.success('Pedido marcado como MONTADO!');

        // Atualiza estado local
        const updated = assemblyItems.map(it => ids.includes(it.id) ? { ...it, status: 'completed', completion_date: now } : it);
        setAssemblyItems(updated);
        await OfflineStorage.setItem(`assembly_items_${routeId}`, updated);

        // Auto-complete logic removed - Manual finalization required

        if (onUpdated) onUpdated();
      } else {
        // Offline - Enfileirar ações individuais para manter consistencia
        for (const item of itemsToMark) {
          const confirmation = {
            item_id: item.id,
            route_id: routeId,
            action: 'completed',
            local_timestamp: now,
            user_id: userId,
          };
          await SyncQueue.addItem({ type: 'assembly_confirmation', data: confirmation });
        }

        const updated = assemblyItems.map(it => ids.includes(it.id) ? { ...it, status: 'completed', completion_date: now } : it);
        setAssemblyItems(updated);
        await OfflineStorage.setItem(`assembly_items_${routeId}`, updated);
        toast.success('Marcado como MONTADO (offline)!');
      }
    } catch (error) {
      console.error('Error marking as completed:', error);
      toast.error('Erro ao marcar serviço');
    } finally {
      const ids = itemsToMark.map(i => i.id);
      const next2 = new Set(processingIds); ids.forEach(id => next2.delete(id)); setProcessingIds(next2);
    }
  };

  const markAsReturned = async (itemsToMark: any[], groupId: string) => {
    const currentReason = returnReasonByOrder[groupId] || '';
    const currentObs = returnObservationsByOrder[groupId] || '';

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
      const ids = itemsToMark.map(i => i.id);
      if (ids.some(id => processingIds.has(id))) return;
      const next = new Set(processingIds); ids.forEach(id => next.add(id)); setProcessingIds(next);

      const now = new Date().toISOString();
      const userId = (await supabase.auth.getUser()).data.user?.id || '';

      if (isOnline) {
        const { error } = await supabase
          .from('assembly_products')
          .update({
            status: 'cancelled', // Retornado
            returned_at: now,
            observations: currentObs ? `(Retorno: ${reasonValue}) ${currentObs}` : `Retorno: ${reasonValue}`
          })
          .in('id', ids);

        if (error) throw error;

        // CORREÇÃO: Atualizar estado local após sucesso no Supabase
        const updated = assemblyItems.map(it =>
          ids.includes(it.id)
            ? {
              ...it,
              status: 'cancelled',
              returned_at: now,
              observations: currentObs ? `(Retorno: ${reasonValue}) ${currentObs}` : `Retorno: ${reasonValue}`
            }
            : it
        );
        setAssemblyItems(updated);
        await OfflineStorage.setItem(`assembly_items_${routeId}`, updated);

        toast.success('Pedido marcado como RETORNADO!');

        if (onUpdated) onUpdated();
      } else {
        // Offline
        for (const item of itemsToMark) {
          const confirmation = {
            item_id: item.id,
            route_id: routeId,
            action: 'returned',
            return_reason: reasonValue,
            observations: currentObs,
            local_timestamp: now,
            user_id: userId,
          };
          await SyncQueue.addItem({ type: 'assembly_return', data: confirmation });
        }

        const updated = assemblyItems.map(it => ids.includes(it.id) ? { ...it, status: 'cancelled' } : it);
        setAssemblyItems(updated);
        OfflineStorage.setItem(`assembly_items_${routeId}`, updated);

        toast.success('Marcado como RETORNADO (offline)!');
      }

      setReturnReasonByOrder(prev => { const copy = { ...prev }; delete copy[groupId]; return copy; });
      setReturnObservationsByOrder(prev => { const copy = { ...prev }; delete copy[groupId]; return copy; });

    } catch (error) {
      console.error('Error marking return:', error);
      toast.error('Erro ao registrar retorno');
    } finally {
      const ids = itemsToMark.map(i => i.id);
      const next2 = new Set(processingIds); ids.forEach(id => next2.delete(id)); setProcessingIds(next2);
    }
  };

  const undoAction = async (itemsToMark: any[], groupId: string) => {
    try {
      const ids = itemsToMark.map(i => i.id);
      if (ids.some(id => processingIds.has(id))) return;
      const next = new Set(processingIds); ids.forEach(id => next.add(id)); setProcessingIds(next);

      const userId = (await supabase.auth.getUser()).data.user?.id || '';
      const now = new Date().toISOString();

      if (isOnline) {
        // CORREÇÃO: Se estiver desfazendo um retorno, apagar cópias fantasmas para CADA item
        // Precisamos verificar item a item se era cancelled
        for (const item of itemsToMark) {
          if (item.status === 'cancelled') {
            try {
              let query = supabase
                .from('assembly_products')
                .select('id')
                .eq('order_id', item.order_id)
                .eq('status', 'pending')
                .eq('was_returned', true)
                .is('assembly_route_id', null)
                .order('created_at', { ascending: false })
                .limit(1);

              if (item.product_sku) {
                query = query.eq('product_sku', item.product_sku);
              }

              const { data: ghosts } = await query;

              if (ghosts && ghosts.length > 0) {
                await supabase.from('assembly_products').delete().eq('id', ghosts[0].id);
              }
            } catch (err) {
              console.error('Error cleaning up return duplicate:', err);
            }
          }
        }

        // Resetar items para pendente
        const { error } = await supabase
          .from('assembly_products')
          .update({
            status: 'pending',
            completion_date: null,
            // Limpeza simplificada da obs para todos
          })
          .in('id', ids);

        // Obs: Limpar strings de obs no banco exigiria raw SQL ou update individual se forem diferentes.
        // Por simplificação aqui, estamos apenas resetando status. Se quiser limpar texto exato, ideal seria loop ou refresh.

        if (error) throw error;

        toast.success('Ação desfeita!');

        const updated = assemblyItems.map(it => ids.includes(it.id) ? {
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
        for (const item of itemsToMark) {
          const confirmation = {
            item_id: item.id,
            route_id: routeId,
            action: 'undo',
            local_timestamp: now,
            user_id: userId,
          };
          await SyncQueue.addItem({ type: 'assembly_undo', data: confirmation });
        }

        const updated = assemblyItems.map(it => ids.includes(it.id) ? {
          ...it,
          status: 'pending',
          completion_date: null,
          observations: it.observations ? it.observations.replace(/\(Retorno: .*\)\s*/, '').replace(/^Retorno: .*/, '').trim() : it.observations
        } : it);

        setAssemblyItems(updated);
        await OfflineStorage.setItem(`assembly_items_${routeId}`, updated);

        toast.success('Ação desfeita (offline)!');
      }

      setReturnReasonByOrder(prev => { const copy = { ...prev }; delete copy[groupId]; return copy; });
      setReturnObservationsByOrder(prev => { const copy = { ...prev }; delete copy[groupId]; return copy; });

    } catch (error) {
      console.error('Error undoing action:', error);
      toast.error('Erro ao desfazer ação');
    } finally {
      const ids = itemsToMark.map(i => i.id);
      const next2 = new Set(processingIds); ids.forEach(id => next2.delete(id)); setProcessingIds(next2);
    }
  };

  const finalizeRoute = async () => {
    if (processingIds.size > 0) return;
    if (routeStatus === 'completed') return;

    // Safety check
    const pending = assemblyItems.filter(i => i.status === 'pending');
    if (pending.length > 0) {
      toast.error('Ainda há itens pendentes!');
      return;
    }

    if (!window.confirm('Tem certeza que deseja finalizar esta rota? Os itens retornados serão liberados para nova rota.')) {
      return;
    }

    try {
      const next = new Set(processingIds); next.add('finalizing'); setProcessingIds(next);

      const now = new Date().toISOString();

      // PROTEÇÃO DE INTEGRIDADE: Verificar se há ações pendentes na fila de sync para esta rota
      // Se houver, DEVEMOS usar o fluxo offline (fila) para garantir a ordem de execução
      let hasPendingSync = false;
      try {
        const pendingSync = await SyncQueue.getPendingItems();
        hasPendingSync = pendingSync.some(p =>
          (p.type === 'assembly_confirmation' || p.type === 'assembly_return' || p.type === 'assembly_undo') &&
          p.data?.route_id === routeId
        );
      } catch (e) {
        console.warn('Failed to check sync queue, assuming clean:', e);
      }

      if (isOnline && !hasPendingSync) {
        // 1. Mark status completed
        const { error } = await supabase.from('assembly_routes').update({ status: 'completed' }).eq('id', routeId);
        if (error) throw error;

        // 2. Find returned items to re-insert
        const returnedItems = assemblyItems.filter(i => i.status === 'cancelled');

        if (returnedItems.length > 0) {
          // Para cada item retornado, verificar se já existe clone pendente
          for (const item of returnedItems) {
            const { data: existingClone } = await supabase
              .from('assembly_products')
              .select('id')
              .eq('order_id', item.order_id)
              .eq('product_sku', item.product_sku)
              .eq('status', 'pending')
              .is('assembly_route_id', null)
              .limit(1);

            if (existingClone && existingClone.length > 0) {
              console.log('[FinalizeRoute] Clone already exists for', item.product_sku, '- skipping');
              continue;
            }

            const newItem = {
              order_id: item.order_id,
              product_name: item.product_name,
              product_sku: item.product_sku,
              customer_name: item.customer_name,
              customer_phone: item.customer_phone,
              installation_address: item.installation_address,
              status: 'pending',
              observations: item.observations,
              assembly_route_id: null,
              was_returned: true
            };

            await supabase.from('assembly_products').insert(newItem);
          }
        }

        toast.success('Rota finalizada com sucesso!');
        setRouteStatus('completed');
        if (onUpdated) onUpdated();
      } else {
        // Offline Finalization - use assembly_route_completion type
        await SyncQueue.addItem({
          type: 'assembly_route_completion',
          data: {
            route_id: routeId,
            local_timestamp: now
          },
        });

        // Persist status offline
        await OfflineStorage.setItem(`assembly_route_status_${routeId}`, 'completed');

        toast.success('Rota finalizada (offline). Será sincronizada quando online.');
        setRouteStatus('completed');
      }

    } catch (err) {
      console.error(err);
      toast.error('Erro ao finalizar rota');
    } finally {
      const next = new Set(processingIds); next.delete('finalizing'); setProcessingIds(next);
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

      {/* Lógica de Agrupamento */}
      {(() => {
        // Agrupar itens por order_id (ou customer_name + address se order_id for nulo/repetido indevidamente, mas order_id é safer)
        const groups: Record<string, any[]> = {};
        assemblyItems.forEach(item => {
          // Tentar agrupar pelo ID de Lançamento (ERP) pois é o que define o "Pedido" para o usuário
          // item.order é o objeto expandido pelo Supabase
          const launchId = item.order?.order_id_erp;

          // Chave de agrupamento: Lançamento > OrderID > Nome Cliente > ID Item (fallback final)
          // Se tiver nomes iguais, assume mesmo grupo visual para facilitar montador
          let key = launchId;
          if (!key) key = item.order_id;
          if (!key) key = item.customer_name;
          if (!key) key = `temp_${item.id}`;

          // Refinamento: Se for usar nome, adicionar endereço para não misturar Josés diferentes
          if (key === item.customer_name) {
            const addr = item.installation_address || item.order?.address_json;
            if (addr) key += JSON.stringify(addr);
          }

          if (!groups[key]) groups[key] = [];
          groups[key].push(item);
        });

        return Object.values(groups).map((groupItems) => {
          const firstItem = groupItems[0];
          const groupId = firstItem.order_id || firstItem.id; // Chave de controle para estados locais (motivo retorno)

          // Status do GRUPO:
          // Se todos completed -> completed
          // Se todos cancelled -> cancelled
          // Se misto -> pending ou in_progress (vamos tratar misto como pending para forçar ação em lote ou individual, mas o pedido user quer lote)
          // Lógica do user: "ou monta tudo ou não monta nada". Vamos assumir status baseado no primeiro item para exibição do card, 
          // mas verificar consistência. Se houver inconsistência, prevalece 'pending' para forçar atenção.
          const allCompleted = groupItems.every(i => i.status === 'completed');
          const allCancelled = groupItems.every(i => i.status === 'cancelled');

          let groupStatus = 'pending';
          if (allCompleted) groupStatus = 'completed';
          else if (allCancelled) groupStatus = 'cancelled';

          const selectedReason = returnReasonByOrder[groupId] || '';
          const selectedObs = returnObservationsByOrder[groupId] || '';

          return (
            <div key={groupId} className="bg-white rounded-lg shadow p-4 mb-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center mb-2">
                    <Package className="h-5 w-5 text-indigo-600 mr-2" />
                    <span className="font-semibold text-gray-900">
                      {firstItem.customer_name} ({groupItems.length} itens)
                    </span>
                    <span className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(groupStatus)}`}>
                      {getStatusText(groupStatus)}
                    </span>
                  </div>

                  {/* Número do Pedido */}
                  {firstItem.order?.order_id_erp && (
                    <div className="text-sm font-medium text-indigo-600 mb-2">
                      📋 Pedido Nº: {firstItem.order.order_id_erp}
                    </div>
                  )}

                  {/* Data/Hora da Montagem (quando concluído) */}
                  {groupStatus === 'completed' && firstItem.completion_date && (
                    <div className="text-sm text-green-600 mb-2 flex items-center">
                      <Clock className="h-4 w-4 mr-1" />
                      Montado em: {new Date(firstItem.completion_date).toLocaleString('pt-BR')}
                    </div>
                  )}

                  {groupStatus === 'cancelled' && (
                    <div className="text-sm text-red-600 mb-2 flex items-center">
                      <Clock className="h-4 w-4 mr-1" />
                      Retornado em: {firstItem.returned_at ? new Date(firstItem.returned_at).toLocaleString('pt-BR') : new Date(firstItem.updated_at).toLocaleString('pt-BR')}
                    </div>
                  )}

                  <div className="text-sm text-gray-600 space-y-1 mb-3">
                    <div className="flex items-center">
                      <MapPin className="h-4 w-4 mr-1 text-blue-500" />
                      <span>{buildFullAddress(firstItem.installation_address || firstItem.order?.address_json)}</span>
                    </div>
                  </div>

                  {/* Lista de Produtos do Pedido */}
                  <div className="bg-gray-50 rounded p-3 text-sm space-y-2 border border-gray-100">
                    {groupItems.map(item => (
                      <div key={item.id} className="flex justify-between items-start border-b border-gray-200 last:border-0 pb-1 last:pb-0">
                        <div>
                          <div className="font-medium text-gray-700">{item.product_name}</div>
                          <div className="text-xs text-gray-500">SKU: {item.product_sku}</div>
                          {item.observations && (
                            <div className="text-yellow-600 text-xs mt-0.5">Note: {item.observations}</div>
                          )}
                        </div>
                        {/* Status individual se precisar debug, mas visualmente o card domina */}
                      </div>
                    ))}
                  </div>

                  {/* Return Form (Group Level) */}
                  {groupStatus === 'pending' && (
                    <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                      <div className="grid grid-cols-1 gap-3">
                        <label className="block text-xs font-medium text-gray-700">
                          Se houver problema com o pedido, informe o motivo:
                        </label>
                        <select
                          value={selectedReason}
                          onChange={(e) => setReturnReasonByOrder(prev => ({ ...prev, [groupId]: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        >
                          <option value="">Selecione...</option>
                          {returnReasons.map((r: any) => (
                            <option key={r.id || r.reason} value={r.reason || r.id}>{r.reason || r.reason_text}</option>
                          ))}
                        </select>
                        {(selectedReason === 'Outro' || selectedReason === '99' || selectedReason === 'other') && (
                          <input
                            type="text"
                            placeholder="Descreva o motivo..."
                            value={selectedObs}
                            onChange={(e) => setReturnObservationsByOrder(prev => ({ ...prev, [groupId]: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="ml-4 flex flex-col space-y-2 min-w-[120px]">
                  {groupStatus === 'pending' && (
                    <>
                      <button
                        onClick={() => markAsCompleted(groupItems)}
                        disabled={groupItems.some(i => processingIds.has(i.id))}
                        className="flex items-center justify-center w-full px-4 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors text-sm font-bold shadow-sm"
                      >
                        <CheckCircle className="h-5 w-5 mr-1" />
                        MONTADO
                      </button>

                      <button
                        onClick={() => markAsReturned(groupItems, groupId)}
                        disabled={!selectedReason || groupItems.some(i => processingIds.has(i.id))}
                        className="flex items-center justify-center w-full px-4 py-3 bg-red-100 text-red-700 rounded-md hover:bg-red-200 disabled:opacity-50 transition-colors text-sm font-bold shadow-sm"
                      >
                        <XCircle className="h-5 w-5 mr-1" />
                        RETORNAR
                      </button>
                    </>
                  )}

                  {(groupStatus === 'completed' || groupStatus === 'cancelled') && (
                    <button
                      onClick={() => undoAction(groupItems, groupId)}
                      disabled={groupItems.some(i => processingIds.has(i.id))}
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
        });
      })()}

      <div className="mt-8 pt-4 border-t border-gray-200 pb-8">
        <button
          onClick={finalizeRoute}
          disabled={processingIds.size > 0 || assemblyItems.some(i => i.status === 'pending') || routeStatus === 'completed'}
          className={`w-full flex items-center justify-center px-4 py-4 text-white font-bold text-lg rounded-xl shadow-lg transition-all active:scale-95 ${routeStatus === 'completed'
            ? 'bg-gray-400 cursor-not-allowed opacity-100 hover:bg-gray-400'
            : 'bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
        >
          {routeStatus === 'completed' || processingIds.has('finalizing') ? (
            <>
              {processingIds.has('finalizing') ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  Finalizando...
                </>
              ) : (
                <>
                  <CheckCircle className="h-6 w-6 mr-2" />
                  Rota Finalizada
                </>
              )}
            </>
          ) : (
            <>
              <CheckCircle className="h-6 w-6 mr-2" />
              Finalizar Rota
            </>
          )}
        </button>
        {assemblyItems.some(i => i.status === 'pending') && (
          <p className="text-center text-sm text-gray-500 mt-2 bg-yellow-50 p-2 rounded border border-yellow-100">
            ⚠️ Conclua ou retorne todos os itens para finalizar a rota.
          </p>
        )}
      </div>

      {assemblyItems.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          Nenhum item nesta rota.
        </div>
      )}
    </div>
  );
}
