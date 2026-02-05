import { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabase/client';
import { OfflineStorage, SyncQueue, NetworkStatus } from '../utils/offline/storage';
import { backgroundSync } from '../utils/offline/backgroundSync';
import type { ReturnReason } from '../types/database';
import { Package, CheckCircle, XCircle, Clock, MapPin, Search } from 'lucide-react';
import { buildFullAddress } from '../utils/maps';
import { toast } from 'sonner';

// ===== FOTOS DE MONTAGEM (Fase 3 - Integração) =====
import { PhotoCaptureModal, CapturedPhoto } from './photos';
import { PhotoStorage } from '../utils/offline/photoStorage';
import { PhotoService } from '../services/photoService';
import { blobToBase64, compressImage, base64ToBlob } from '../utils/imageCompression';

const FALLBACK_RETURN_REASONS: ReturnReason[] = [
  { id: '1', reason: 'Cliente ausente', type: 'both' },
  { id: '2', reason: 'Endereço incorreto / não localizado', type: 'both' },
  { id: '3', reason: 'Cliente sem contato', type: 'both' },
  { id: '4', reason: 'Cliente recusou / cancelou', type: 'both' },
  { id: '5', reason: 'Horário excedido', type: 'both' },
  { id: '6', reason: 'Próxima rota', type: 'both' },
  { id: '7', reason: 'Cliente vai avisar', type: 'both' },
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
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'completed' | 'error'>('idle');
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [returnReasonByProduct, setReturnReasonByProduct] = useState<Record<string, string>>({});
  const [returnObservationsByProduct, setReturnObservationsByProduct] = useState<Record<string, string>>({});
  const [routeStatus, setRouteStatus] = useState<string>('pending');
  const [searchQuery, setSearchQuery] = useState('');

  // ===== ESTADOS PARA FOTOS DE MONTAGEM =====
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [pendingPhotoItems, setPendingPhotoItems] = useState<any[]>([]);
  const [requirePhotos, setRequirePhotos] = useState(false);

  // Realtime Ref
  const loadItemsRef = useRef<any>(null); // To access latest load function
  useEffect(() => { loadItemsRef.current = loadRouteItems; }); // Always keep ref updated

  useEffect(() => {
    loadRouteItems();
    loadReturnReasons();

    const listener = (online: boolean) => {
      setIsOnline(online);
    };
    NetworkStatus.addListener(listener);

    // ===== CARREGAR CONFIG DE FOTOS =====
    const loadPhotoConfig = async () => {
      try {
        const { data } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'require_assembly_photos')
          .single();
        if (data?.value?.enabled) {
          setRequirePhotos(true);
          console.log('[AssemblyMarking] Fotos obrigatórias: ATIVADO');
        }
      } catch (err) {
        console.log('[AssemblyMarking] Config de fotos não encontrada, usando padrão (desativado)');
      }
    };
    loadPhotoConfig();

    // Realtime Subscription
    const channel = supabase
      .channel(`assembly-marking-${routeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assembly_products', filter: `assembly_route_id=eq.${routeId}` },
        (payload) => {
          console.log('[Realtime] Assembly Items changed for route', routeId);
          if (loadItemsRef.current) loadItemsRef.current();
        }
      )
      .subscribe();

    return () => {
      NetworkStatus.removeListener(listener);
      supabase.removeChannel(channel);
    };
  }, [routeId]);

  useEffect(() => {
    const run = async () => {
      if (isOnline) {
        setSyncStatus('syncing');
        try {
          await backgroundSync.forceSync(true); // Silent sync
          // Atualizar dados antes de verificar estado
          await loadRouteItems();

          // VERIFICAR SE O SYNC REALMENTE FUNCIONOU
          // Se ainda houver itens na fila, significa que falharam
          const pendingItems = await SyncQueue.getPendingItems();
          const hasFailures = pendingItems.some(p => String(p.data?.route_id) === String(routeId));

          if (hasFailures) {
            setSyncStatus('error');
            // Mantém erro visível por um tempo
            setTimeout(() => {
              setSyncStatus('idle');
            }, 3000);
          } else {
            setSyncStatus('completed');
            setTimeout(() => {
              setSyncStatus('idle');
            }, 700);
          }
        } catch (e) {
          console.error(e);
          setSyncStatus('error');
          setTimeout(() => setSyncStatus('idle'), 3000);
          await loadRouteItems();
        }
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
        // MERGE LOCAL PENDING ACTIONS
        // Sempre aplicar merge se houver itens na fila (pendentes ou falhos),
        // garantindo que a UI mostre a intenção do usuário mesmo se o sync falhar.
        try {
          const pendingSync = await SyncQueue.getPendingItems();

          // Apply pending actions to data
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

  // ===== HANDLER PARA MARCAR COMO MONTADO (COM OU SEM FOTOS) =====
  const handleMarkAsCompleted = (itemsToMark: any[]) => {
    if (requirePhotos) {
      // Abre modal de fotos antes de marcar como montado
      setPendingPhotoItems(itemsToMark);
      setShowPhotoModal(true);
    } else {
      // Comportamento original: marca direto
      markAsCompleted(itemsToMark);
    }
  };

  // ===== CALLBACK QUANDO FOTOS SÃO CONFIRMADAS =====
  const handlePhotosConfirmed = async (photos: CapturedPhoto[]) => {
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id || '';

      // Processar cada item pendente
      for (const item of pendingPhotoItems) {
        // Salvar fotos localmente (serão sincronizadas depois)
        for (const photo of photos) {
          await PhotoStorage.saveLocal(
            item.id,                    // assembly_product_id
            photo.base64,
            photo.fileName,
            photo.fileSize,
            photo.mimeType,
            userId
          );
        }

        // Se online, tentar fazer upload imediato
        if (isOnline) {
          try {
            for (const photo of photos) {
              const blob = base64ToBlob(photo.base64);
              await PhotoService.uploadComplete(blob, item.id, photo.fileName, userId);
            }
            // Limpar fotos locais já sincronizadas
            await PhotoStorage.cleanSynced();
          } catch (uploadErr) {
            console.error('[AssemblyMarking] Erro no upload, fotos salvas localmente:', uploadErr);
            toast.info('Fotos salvas localmente. Serão sincronizadas quando possível.');
          }
        } else {
          toast.info('Modo offline. Fotos serão sincronizadas quando houver conexão.');
        }
      }

      // Agora marcar os itens como montados
      await markAsCompleted(pendingPhotoItems);

      // Fechar modal e limpar estado
      setShowPhotoModal(false);
      setPendingPhotoItems([]);

    } catch (error: any) {
      console.error('[AssemblyMarking] Erro ao processar fotos:', error);
      toast.error('Erro ao processar fotos');
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

  const markAsReturned = async (itemsToMark: any[]) => {
    // Check reasons for ALL items individually
    for (const item of itemsToMark) {
      const reason = returnReasonByProduct[item.id];
      const obsPromise = returnObservationsByProduct[item.id];
      if (!reason) {
        toast.error(`Selecione um motivo para o produto: ${item.product_name}`);
        return;
      }
      const isOther = reason === 'other' || reason === '99' || reason === 'Outro';
      if (isOther && !obsPromise?.trim()) {
        toast.error(`Informe o motivo nas observações para: ${item.product_name}`);
        return;
      }
    }



    try {
      const ids = itemsToMark.map(i => i.id);
      if (ids.some(id => processingIds.has(id))) return;
      const next = new Set(processingIds); ids.forEach(id => next.add(id)); setProcessingIds(next);

      const now = new Date().toISOString();
      const userId = (await supabase.auth.getUser()).data.user?.id || '';

      if (isOnline) {
        // Update each item individually
        for (const item of itemsToMark) {
          const reason = returnReasonByProduct[item.id];
          const obs = returnObservationsByProduct[item.id] || '';
          const isOther = reason === 'other' || reason === '99' || reason === 'Outro';
          const reasonValue = isOther ? obs.trim() : reason;
          const fullObs = obs ? `(Retorno: ${reasonValue}) ${obs}` : `Retorno: ${reasonValue}`;

          const { error } = await supabase
            .from('assembly_products')
            .update({
              status: 'cancelled',
              returned_at: now,
              observations: fullObs
            })
            .eq('id', item.id);

          if (error) throw error;
        }

        // CORREÇÃO: Atualizar estado local após sucesso no Supabase
        // CORREÇÃO: Atualizar estado local após sucesso no Supabase
        const updated = assemblyItems.map(it => {
          if (ids.includes(it.id)) {
            const reason = returnReasonByProduct[it.id];
            const obs = returnObservationsByProduct[it.id] || '';
            const isOther = reason === 'other' || reason === '99' || reason === 'Outro';
            const reasonValue = isOther ? obs.trim() : reason;
            const fullObs = obs ? `(Retorno: ${reasonValue}) ${obs}` : `Retorno: ${reasonValue}`;

            return {
              ...it,
              status: 'cancelled',
              returned_at: now,
              observations: fullObs
            };
          }
          return it;
        });
        setAssemblyItems(updated);
        await OfflineStorage.setItem(`assembly_items_${routeId}`, updated);

        toast.success('Pedido marcado como RETORNADO!');

        if (onUpdated) onUpdated();
      } else {
        // Offline
        // Offline
        for (const item of itemsToMark) {
          const reason = returnReasonByProduct[item.id];
          const obs = returnObservationsByProduct[item.id] || '';
          const isOther = reason === 'other' || reason === '99' || reason === 'Outro';
          const reasonValue = isOther ? obs.trim() : reason;

          const confirmation = {
            item_id: item.id,
            route_id: routeId,
            action: 'returned',
            return_reason: reasonValue,
            observations: obs,
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

      setReturnReasonByProduct(prev => { const copy = { ...prev }; ids.forEach(id => delete copy[id]); return copy; });
      setReturnObservationsByProduct(prev => { const copy = { ...prev }; ids.forEach(id => delete copy[id]); return copy; });

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

        // ===== LIMPAR FOTOS AO DESFAZER =====
        // Deletar fotos do storage e da tabela assembly_photos
        for (const itemId of ids) {
          try {
            // Buscar fotos do produto
            const { data: photos } = await supabase
              .from('assembly_photos')
              .select('id, storage_path')
              .eq('assembly_product_id', itemId);

            if (photos && photos.length > 0) {
              // Deletar arquivos do Storage
              const paths = photos.map(p => p.storage_path);
              await supabase.storage.from('assembly-photos').remove(paths);

              // Deletar registros da tabela
              await supabase
                .from('assembly_photos')
                .delete()
                .eq('assembly_product_id', itemId);

              console.log(`[undoAction] Deletadas ${photos.length} fotos do item ${itemId}`);
            }
          } catch (photoError) {
            console.error(`[undoAction] Erro ao deletar fotos do item ${itemId}:`, photoError);
            // Não interrompe o fluxo, apenas loga o erro
          }
        }

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

      setReturnReasonByProduct(prev => { const copy = { ...prev }; ids.forEach(id => delete copy[id]); return copy; });
      setReturnObservationsByProduct(prev => { const copy = { ...prev }; ids.forEach(id => delete copy[id]); return copy; });

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
    <div className="space-y-4 relative">
      {/* Overlay de Sincronização */}
      {syncStatus !== 'idle' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 shadow-2xl flex flex-col items-center min-w-[200px]">
            {syncStatus === 'syncing' ? (
              <>
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mb-4"></div>
                <span className="text-lg font-semibold text-gray-800">Sincronizando...</span>
                <span className="text-sm text-gray-500 mt-1">Enviando dados...</span>
              </>
            ) : syncStatus === 'completed' ? (
              <>
                <CheckCircle className="h-12 w-12 text-green-500 mb-4 animate-bounce" />
                <span className="text-lg font-bold text-gray-800">Sincronizado!</span>
                <span className="text-sm text-gray-500 mt-1">Tudo atualizado</span>
              </>
            ) : (
              <>
                <XCircle className="h-12 w-12 text-red-500 mb-4 animate-pulse" />
                <span className="text-lg font-bold text-gray-800">Erro no Sync</span>
                <span className="text-sm text-gray-500 mt-1">Alguns itens não foram enviados.</span>
                <span className="text-xs text-red-400 mt-1">Ainda visíveis localmente.</span>
              </>
            )}
          </div>
        </div>
      )}
      <div className={`p-3 rounded-lg flex items-center justify-between ${isOnline ? 'bg-green-50 text-green-800' : 'bg-yellow-50 text-yellow-800'}`}>
        <div className="flex items-center">
          <div className={`w-2 h-2 rounded-full mr-2 ${isOnline ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
          <span className="text-sm font-medium">
            {isOnline ? 'Online' : 'Modo Offline'}
          </span>
        </div>
      </div>

      {/* Search Input */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-gray-400" />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm shadow-sm"
          placeholder="Buscar por pedido ou cliente..."
        />
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

        const filteredGroups = Object.values(groups).filter((groupItems) => {
          if (!searchQuery.trim()) return true;
          const firstItem = groupItems[0];
          const query = searchQuery.toLowerCase();

          const orderId = String(firstItem.order?.order_id_erp || firstItem.order_id || '').toLowerCase();
          const clientName = String(firstItem.customer_name || '').toLowerCase();
          const products = groupItems.map(i => String(i.product_name || '').toLowerCase()).join(' ');

          return orderId.includes(query) || clientName.includes(query) || products.includes(query);
        });

        if (filteredGroups.length === 0) {
          return <div className="text-center py-10 text-gray-500">Nenhum pedido encontrado.</div>;
        }

        return filteredGroups.map((groupItems) => {
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
                    {/* Telefone com link WhatsApp */}
                    {(() => {
                      const phone = firstItem.customer_phone || firstItem.order?.phone || firstItem.order?.raw_json?.cliente_celular;
                      if (!phone) return null;
                      // Limpar telefone para formato internacional
                      const cleanPhone = String(phone).replace(/\D/g, '');
                      const waPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;
                      return (
                        <div className="flex items-center text-sm text-gray-600">
                          <span>Telefone: {phone}</span>
                          <a
                            href={`https://wa.me/${waPhone}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-green-600 hover:text-green-700"
                            title="Abrir WhatsApp"
                          >
                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                            </svg>
                          </a>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Lista de Produtos do Pedido */}
                  <div className="bg-gray-50 rounded p-3 text-sm space-y-3 border border-gray-100">
                    {groupItems.map(item => {
                      const itemStatus = item.status || 'pending';
                      const isPending = itemStatus === 'pending';
                      const isCompleted = itemStatus === 'completed';
                      const isCancelled = itemStatus === 'cancelled';

                      const reason = returnReasonByProduct[item.id] || '';
                      const obs = returnObservationsByProduct[item.id] || '';

                      return (
                        <div key={item.id} className="border-b border-gray-200 last:border-0 pb-3 last:pb-0">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex-1 pr-2">
                              <div className="font-medium text-gray-700">{item.product_name}</div>
                              <div className="text-xs text-gray-500">SKU: {item.product_sku}</div>
                              {item.observations && (
                                <div className="text-yellow-600 text-xs mt-0.5">Note: {item.observations}</div>
                              )}
                            </div>

                            {/* Badge de Status Individual */}
                            <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${isCompleted ? 'bg-green-100 text-green-700' :
                              isCancelled ? 'bg-red-100 text-red-700' :
                                'bg-yellow-100 text-yellow-700'
                              }`}>
                              {isCompleted ? 'Montado' : isCancelled ? 'Retornado' : 'Pendente'}
                            </span>
                          </div>

                          {/* Ações por Produto */}
                          {routeStatus !== 'completed' && (
                            <div className="mt-2 space-y-2">
                              {isPending && (
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => handleMarkAsCompleted([item])}
                                    disabled={processingIds.has(item.id)}
                                    className="flex-1 flex items-center justify-center py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 text-xs font-bold shadow-sm"
                                  >
                                    <CheckCircle className="h-4 w-4 mr-1" />
                                    MONTAR
                                  </button>

                                  <button
                                    onClick={() => {
                                      if (reason) {
                                        markAsReturned([item]);
                                      } else {
                                        toast.error('Selecione o motivo do retorno abaixo');
                                      }
                                    }}
                                    disabled={!reason || processingIds.has(item.id)}
                                    className="flex-1 flex items-center justify-center py-2 bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50 text-xs font-bold shadow-sm"
                                  >
                                    <XCircle className="h-4 w-4 mr-1" />
                                    RETORNAR
                                  </button>
                                </div>
                              )}

                              {isPending && (
                                <div className="bg-white p-2 rounded border border-gray-200 text-xs space-y-2">
                                  <p className="font-semibold text-gray-500">Motivo (se retornar):</p>
                                  <select
                                    value={reason}
                                    onChange={(e) => setReturnReasonByProduct(prev => ({ ...prev, [item.id]: e.target.value }))}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                                  >
                                    <option value="">Selecione...</option>
                                    {returnReasons.map((r: any) => (
                                      <option key={r.id || r.reason} value={r.reason || r.id}>{r.reason || r.reason_text}</option>
                                    ))}
                                  </select>
                                  {(reason === 'Outro' || reason === '99' || reason === 'other') && (
                                    <input
                                      type="text"
                                      placeholder="Descreva o motivo..."
                                      value={obs}
                                      onChange={(e) => setReturnObservationsByProduct(prev => ({ ...prev, [item.id]: e.target.value }))}
                                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                                    />
                                  )}
                                </div>
                              )}

                              {(isCompleted || isCancelled) && (
                                <div className="flex justify-end">
                                  <button
                                    onClick={() => undoAction([item], groupId)}
                                    disabled={processingIds.has(item.id)}
                                    className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 disabled:opacity-50 text-xs font-medium border border-gray-200 shadow-sm flex items-center"
                                  >
                                    <Clock className="w-3 h-3 mr-1" /> Desfazer
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
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

      {/* ===== MODAL DE CAPTURA DE FOTOS ===== */}
      <PhotoCaptureModal
        isOpen={showPhotoModal}
        onClose={() => {
          setShowPhotoModal(false);
          setPendingPhotoItems([]);
        }}
        onConfirm={handlePhotosConfirmed}
        minPhotos={1}
        maxPhotos={3}
        productName={pendingPhotoItems.length > 0 ? pendingPhotoItems[0].product_name : undefined}
        isOffline={!isOnline}
      />
    </div>
  );
}
