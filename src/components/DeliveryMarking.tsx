import { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabase/client';
import { OfflineStorage, SyncQueue, NetworkStatus } from '../utils/offline/storage';
import { backgroundSync } from '../utils/offline/backgroundSync';
import type { RouteOrderItem, RouteOrderWithDetails, Order, ReturnReason } from '../types/database';
import { Package, CheckCircle, XCircle, MapPin, Users, Search, Camera } from 'lucide-react';
import { buildFullAddress, geocodeAddress, openWazeWithLL } from '../utils/maps';
import { toast } from 'sonner';
import { useDeliveryPhotos } from '../hooks/useDeliveryPhotos';
import { syncAssemblyProductsForRoute } from '../utils/assembly/syncAssemblyProducts';
import ProcessingOverlay from './ProcessingOverlay';
import {
  getRouteOrderItemStatusLabel,
  getRouteOrderItemStatusClasses,
  isBlockedRouteOrderItem,
  isDeliverableRouteOrderItem,
  isVisibleRouteOrderItem,
  computeDeliverableOrderValue,
} from '../utils/delivery/itemLogic';

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

const RECIPIENT_RELATION_OPTIONS = ['Titular', 'Familiar', 'Porteiro', 'Vizinho', 'Outro'];

const GPS_FAILURE_OPTIONS = [
  { id: 'permission_denied', label: 'Permissão de localização negada' },
  { id: 'gps_disabled', label: 'GPS do aparelho desligado' },
  { id: 'signal_weak', label: 'Sinal GPS fraco' },
  { id: 'indoor_no_fix', label: 'Área interna sem sinal de satélite' },
  { id: 'timeout', label: 'Timeout de localização' },
  { id: 'device_error', label: 'Falha temporária de dispositivo/app' },
];

type GpsCaptureStatus = 'idle' | 'capturing' | 'ok' | 'failed';
type CapturedGps = {
  lat: number;
  lng: number;
  accuracy: number | null;
  captured_at: string;
};

type DeliveryProofConfig = {
  enabled: boolean;
  requireRecipient: boolean;
  requireGps: boolean;
};

interface DeliveryMarkingProps {
  routeId: string;
  onUpdated?: () => void;
}

type StatusFilter = 'pending' | 'delivered' | 'returned';

export default function DeliveryMarking({ routeId, onUpdated }: DeliveryMarkingProps) {
  const [routeOrders, setRouteOrders] = useState<RouteOrderWithDetails[]>([]);
  const [routeOrderItemsByRouteOrder, setRouteOrderItemsByRouteOrder] = useState<Record<string, RouteOrderItem[]>>({});
  const [returnReasons, setReturnReasons] = useState<ReturnReason[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(NetworkStatus.isOnline());
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  // Mensagem do overlay de processamento ("Buscando sua localização...", "Registrando a entrega...").
  // Null = sem overlay. Público leigo precisa VER o que está acontecendo, senão toca de novo.
  const [savingLabel, setSavingLabel] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  // Seleção por pedido para evitar pré-seleção global
  const [returnReasonByOrder, setReturnReasonByOrder] = useState<Record<string, string>>({});
  const [returnObservationsByOrder, setReturnObservationsByOrder] = useState<Record<string, string>>({});
  const [recipientNameByOrder, setRecipientNameByOrder] = useState<Record<string, string>>({});
  const [recipientRelationByOrder, setRecipientRelationByOrder] = useState<Record<string, string>>({});
  const [recipientNotesByOrder, setRecipientNotesByOrder] = useState<Record<string, string>>({});
  // Entrega parcial: itens que o motorista marcou para RETORNAR (nao coube). Chave: routeOrderId -> { itemId: true }.
  // Decisão do motorista por item: 'deliver' (entregar) ou 'return' (não coube, volta pra fila).
  // Um item só está "decidido" quando tem entrada aqui — é assim que a tela sabe que a parada
  // ficou pronta pra concluir (todos os itens decididos) e dispara a foto sozinha.
  const [itemDecisionByOrder, setItemDecisionByOrder] = useState<Record<string, Record<string, 'deliver' | 'return'>>>({});
  // Paradas que já dispararam a foto automática (pra não reabrir a câmera em loop).
  const autoConcludedRef = useRef<Record<string, boolean>>({});
  // Pedido com o modal de "Retornar pedido completo" (motivo) aberto.
  const [returnAllModalOrderId, setReturnAllModalOrderId] = useState<string | null>(null);
  const [gpsDataByOrder, setGpsDataByOrder] = useState<Record<string, CapturedGps>>({});
  const [gpsFailureReasonByOrder, setGpsFailureReasonByOrder] = useState<Record<string, string>>({});
  const [gpsStatusByOrder, setGpsStatusByOrder] = useState<Record<string, GpsCaptureStatus>>({});
  const [deliveryProofConfig, setDeliveryProofConfig] = useState<DeliveryProofConfig>({
    enabled: false,
    requireRecipient: false,
    requireGps: false,
  });
  const [routeDetails, setRouteDetails] = useState<any>(null);

  // Hook de fotos isolado
  const { renderModal, capturePhotos, isProcessing: isPhotoProcessing } = useDeliveryPhotos();

  useEffect(() => {
    loadRouteOrders();
    loadRouteOrderItems();
    loadReturnReasons();
    loadDeliveryProofConfig();
    loadRouteDetails();

    const listener = (online: boolean) => {
      setIsOnline(online);
    };
    NetworkStatus.addListener(listener);

    return () => {
      NetworkStatus.removeListener(listener);
    };
  }, [routeId]);

  // Sync silencioso com debounce ao voltar online — NÃO recarrega a tela
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Limpar timer anterior para evitar múltiplas execuções
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }

    if (isOnline) {
      // Esperar 3 segundos para garantir que a conexão estabilizou
      syncTimerRef.current = setTimeout(async () => {
        try {
          await backgroundSync.forceSync(true); // sync silencioso, sem toast
        } catch (e) {
          console.warn('[DeliveryMarking] Silent sync failed, will retry later:', e);
        }
      }, 3000);
    }

    return () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
      }
    };
  }, [isOnline]);

  const loadRouteOrders = async () => {
    try {
      setLoading(true);

      // Tenta carregar do servidor se online
      if (NetworkStatus.isOnline()) {
        try {
          const DRIVER_SAFE_COLS = 'id,order_id_erp,customer_name,phone,address_json,items_json,status,created_at,updated_at,raw_json,danfe_gerada_em,filial_venda,data_venda,previsao_entrega,tem_frete_full,observacoes_publicas,observacoes_internas,customer_cpf,vendedor_nome,return_flag,last_return_reason,last_return_notes,brand,department,service_type,erp_status,blocked_at,blocked_reason,requires_pickup,pickup_created_at,return_nfe_number,return_nfe_key,return_date,return_type,import_source,previsao_montagem,product_group,product_subgroup';
          const { data, error } = await supabase
            .from('route_orders')
            .select(`
              *,
              order:orders!order_id(${DRIVER_SAFE_COLS})
            `)
            .eq('route_id', routeId)
            .order('sequence', { ascending: true });

          if (error) throw error;
          if (data) {
            setRouteOrders(data as RouteOrderWithDetails[]);
            await OfflineStorage.setItem(`route_orders_${routeId}`, data);
          }
        } catch (onlineError) {
          // FALLBACK: Se falhar online, carrega do cache sem mostrar erro
          console.warn('[DeliveryMarking] Online fetch failed, falling back to cache:', onlineError);
          const cached = await OfflineStorage.getItem(`route_orders_${routeId}`);
          if (cached) {
            setRouteOrders(cached);
          }
        }
      } else {
        // Offline: carrega do cache
        const cached = await OfflineStorage.getItem(`route_orders_${routeId}`);
        if (cached) {
          setRouteOrders(cached);
        }
      }
    } catch (error) {
      console.error('Error loading route orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadRouteOrderItems = async () => {
    try {
      if (NetworkStatus.isOnline()) {
        try {
          const { data, error } = await supabase
            .from('route_order_items')
            .select('*')
            .eq('route_id', routeId)
            .order('created_at', { ascending: true });

          if (error) throw error;

          const grouped = ((data || []) as RouteOrderItem[]).reduce<Record<string, RouteOrderItem[]>>((acc, item: any) => {
            const key = String(item.route_order_id || '');
            if (!key) return acc;
            if (!acc[key]) acc[key] = [];
            acc[key].push(item as RouteOrderItem);
            return acc;
          }, {});

          setRouteOrderItemsByRouteOrder(grouped);
          await OfflineStorage.setItem(`route_order_items_${routeId}`, grouped);
          return;
        } catch (onlineError) {
          console.warn('[DeliveryMarking] Online route_order_items fetch failed, falling back to cache:', onlineError);
        }
      }

      const cached = await OfflineStorage.getItem(`route_order_items_${routeId}`);
      if (cached) {
        setRouteOrderItemsByRouteOrder(cached as Record<string, RouteOrderItem[]>);
      } else {
        setRouteOrderItemsByRouteOrder({});
      }
    } catch (error) {
      console.error('Error loading route order items:', error);
      setRouteOrderItemsByRouteOrder({});
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

  const buildDeliveredRouteOrderItems = (items: RouteOrderItem[], returnSelection: Record<string, boolean> = {}) =>
    items.map((item) => {
      if (!isDeliverableRouteOrderItem(item)) return item;
      if (returnSelection[item.id]) {
        // Item marcado "nao coube": retornado nesta rota (volta pra fila na finalizacao).
        return {
          ...item,
          delivered_quantity: 0,
          returned_quantity: item.deliverable_quantity_snapshot,
          status: 'returned' as const,
        };
      }
      return {
        ...item,
        delivered_quantity: item.deliverable_quantity_snapshot,
        status: 'delivered' as const,
      };
    });

  // Alterna a marcacao de RETORNAR ("nao coube") de um item na entrega parcial.
  // Marca UM item como entregue ou retornado (na hora, reversível). Muda a marcação
  // re-arma a foto automática (a parada pode ter deixado de estar pronta).
  const setItemDecision = (routeOrderId: string, itemId: string, decision: 'deliver' | 'return') => {
    autoConcludedRef.current[routeOrderId] = false;
    setItemDecisionByOrder((prev) => {
      const cur = { ...(prev[routeOrderId] || {}) };
      cur[itemId] = decision;
      return { ...prev, [routeOrderId]: cur };
    });
  };

  // Marca TODOS os itens entregáveis de uma parada de uma vez (só pro visual;
  // o "Entregar/Retornar pedido completo" conclui direto).
  const setAllItemsDecision = (order: RouteOrderWithDetails, decision: 'deliver' | 'return') => {
    const items = (routeOrderItemsByRouteOrder[order.id] || []).filter(isDeliverableRouteOrderItem);
    autoConcludedRef.current[order.id] = false;
    setItemDecisionByOrder((prev) => {
      const cur: Record<string, 'deliver' | 'return'> = { ...(prev[order.id] || {}) };
      for (const it of items) cur[it.id] = decision;
      return { ...prev, [order.id]: cur };
    });
  };

  // A parada está pronta pra concluir? (todos os itens decididos + motivo, se houver retorno)
  const getStopReadyInfo = (order: RouteOrderWithDetails) => {
    const items = (routeOrderItemsByRouteOrder[order.id] || []).filter(isDeliverableRouteOrderItem);
    const decisions = itemDecisionByOrder[order.id] || {};
    const decidedCount = items.filter((it) => decisions[it.id]).length;
    const allDecided = items.length > 0 && decidedCount === items.length;
    const returns = items.filter((it) => decisions[it.id] === 'return');
    const hasReturn = returns.length > 0;
    const allReturn = hasReturn && returns.length === items.length;
    const reason = returnReasonByOrder[order.id] || '';
    const isOther = reason === 'other' || reason === 'Outro' || reason === '99';
    const obs = returnObservationsByOrder[order.id] || '';
    const reasonOk = !hasReturn || (isOther ? obs.trim().length > 0 : reason.length > 0);
    return { items, allDecided, hasReturn, allReturn, reasonOk, ready: allDecided && reasonOk };
  };

  const buildPendingRouteOrderItemsAfterUndo = (items: RouteOrderItem[]) =>
    items.map((item) => {
      if (isBlockedRouteOrderItem(item)) {
        return {
          ...item,
          delivered_quantity: 0,
          status: 'returned' as const,
        };
      }

      return {
        ...item,
        delivered_quantity: 0,
        status: item.returned_quantity_snapshot > 0 ? 'partial' as const : 'pending' as const,
      };
    });

  const replaceRouteOrderItems = (routeOrderId: string, nextItems: RouteOrderItem[]) => {
    setRouteOrderItemsByRouteOrder((prev) => ({
      ...prev,
      [routeOrderId]: nextItems,
    }));
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
      const { data: geoSession } = await supabase.auth.getSession();
      const svc = await fetch('/api/geocode-order', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${geoSession.session?.access_token ?? ''}` }, body: JSON.stringify({ orderId: routeOrder.order_id, debug: true }) })
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

  const loadDeliveryProofConfig = async () => {
    try {
      const defaults: DeliveryProofConfig = {
        enabled: false,
        requireRecipient: false,
        requireGps: false,
      };

      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'delivery_proof_settings')
        .single();

      const value = (data as any)?.value || {};
      const next: DeliveryProofConfig = {
        enabled: Boolean(value.enabled),
        requireRecipient: Boolean(value.requireRecipient),
        requireGps: Boolean(value.requireGps),
      };

      setDeliveryProofConfig(next);
      await OfflineStorage.setItem('delivery_proof_settings', next);
    } catch {
      const cached = await OfflineStorage.getItem('delivery_proof_settings');
      if (cached) {
        setDeliveryProofConfig(cached as DeliveryProofConfig);
      }
    }
  };

  const clearDeliveryProofState = (routeOrderId: string) => {
    setRecipientNameByOrder((prev) => {
      const copy = { ...prev };
      delete copy[routeOrderId];
      return copy;
    });
    setRecipientRelationByOrder((prev) => {
      const copy = { ...prev };
      delete copy[routeOrderId];
      return copy;
    });
    setRecipientNotesByOrder((prev) => {
      const copy = { ...prev };
      delete copy[routeOrderId];
      return copy;
    });
    setGpsDataByOrder((prev) => {
      const copy = { ...prev };
      delete copy[routeOrderId];
      return copy;
    });
    setGpsFailureReasonByOrder((prev) => {
      const copy = { ...prev };
      delete copy[routeOrderId];
      return copy;
    });
    setGpsStatusByOrder((prev) => {
      const copy = { ...prev };
      delete copy[routeOrderId];
      return copy;
    });
  };

  const captureGpsForOrder = async (
    routeOrderId: string
  ): Promise<{ ok: true; data: CapturedGps } | { ok: false; reason: string }> => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsStatusByOrder((prev) => ({ ...prev, [routeOrderId]: 'failed' }));
      setGpsFailureReasonByOrder((prev) => ({ ...prev, [routeOrderId]: prev[routeOrderId] || 'device_error' }));
      toast.warning('GPS não disponível neste dispositivo');
      return { ok: false, reason: 'device_error' };
    }

    setGpsStatusByOrder((prev) => ({ ...prev, [routeOrderId]: 'capturing' }));

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 0,
        });
      });

      const gpsData: CapturedGps = {
        lat: Number(position.coords.latitude),
        lng: Number(position.coords.longitude),
        accuracy: Number.isFinite(position.coords.accuracy) ? Number(position.coords.accuracy) : null,
        captured_at: new Date().toISOString(),
      };

      setGpsDataByOrder((prev) => ({ ...prev, [routeOrderId]: gpsData }));
      setGpsStatusByOrder((prev) => ({ ...prev, [routeOrderId]: 'ok' }));
      setGpsFailureReasonByOrder((prev) => {
        const copy = { ...prev };
        delete copy[routeOrderId];
        return copy;
      });
      toast.success('GPS capturado');
      return { ok: true, data: gpsData };
    } catch (error: any) {
      let reason = 'device_error';
      if (error?.code === 1) reason = 'permission_denied';
      else if (error?.code === 2) reason = 'signal_weak';
      else if (error?.code === 3) reason = 'timeout';

      setGpsStatusByOrder((prev) => ({ ...prev, [routeOrderId]: 'failed' }));
      setGpsFailureReasonByOrder((prev) => ({ ...prev, [routeOrderId]: prev[routeOrderId] || reason }));
      toast.warning('Não foi possível capturar GPS. Informe motivo técnico para continuar.');
      return { ok: false, reason };
    }
  };

  const saveDeliveryReceiptShadow = async (
    routeOrder: RouteOrderWithDetails,
    deliveredByUserId: string,
    deviceTimestamp: string,
    metadata: {
      recipientName: string;
      recipientRelation: string;
      recipientNotes: string;
      gpsData: CapturedGps | null;
      gpsFailureReason: string | null;
      gpsStatus: 'ok' | 'failed';
    }
  ) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const sessionUserId = sessionData.session?.user?.id || deliveredByUserId;

      const { data: photos } = await supabase
        .from('delivery_photos')
        .select('id, storage_path, photo_type')
        .eq('route_order_id', routeOrder.id);

      const photoRefs = (photos || []).map((p: any) => ({
        id: p.id,
        path: p.storage_path,
        type: p.photo_type,
      }));

      const payload = {
        orderId: routeOrder.order_id,
        routeId,
        routeOrderId: routeOrder.id,
        deliveredByUserId: sessionUserId,
        deviceTimestamp,
        recipientName: metadata.recipientName,
        recipientRelation: metadata.recipientRelation,
        recipientNotes: metadata.recipientNotes || null,
        gpsLat: metadata.gpsData?.lat ?? null,
        gpsLng: metadata.gpsData?.lng ?? null,
        gpsAccuracyM: metadata.gpsData?.accuracy ?? null,
        gpsStatus: metadata.gpsStatus,
        gpsFailureReason: metadata.gpsFailureReason || null,
        photoCount: photoRefs.length,
        photoRefs,
        networkMode: isOnline ? 'online' : 'offline',
        deviceInfo: {
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
          platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
        },
        appVersion: import.meta.env.VITE_APP_VERSION || null,
      };

      const response = await fetch('/api/delivery-proof', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const responseBody = await response.json().catch(() => null);
      if (!response.ok || (responseBody && responseBody.ok === false)) {
        console.warn('[DeliveryMarking] Delivery proof shadow save failed:', responseBody || response.statusText);
        const message = String(
          responseBody?.error ||
          responseBody?.warning ||
          responseBody?.reason ||
          response.statusText ||
          'Falha ao salvar comprovante digital'
        );
        toast.warning(`Comprovante digital: ${message}`);
      } else if (responseBody?.ok === true && responseBody?.receiptId) {
        toast.success('Comprovante digital salvo');
      }
    } catch (error) {
      console.warn('[DeliveryMarking] Delivery proof shadow save error:', error);
      toast.warning('Comprovante digital: erro de comunicação com o servidor');
    }
  };

  const markAsDelivered = async (order: RouteOrderWithDetails) => {
    try {
      if (processingIds.has(order.id)) return;
      // Trava JÁ no primeiro toque: antes ela só armava depois das fotos, e o vão
      // (GPS pode levar segundos) deixava um segundo toque disparar o fluxo de novo.
      setProcessingIds(prev => { const n = new Set(prev); n.add(order.id); return n; });

      let routeOrderItems = routeOrderItemsByRouteOrder[order.id] || [];

      // Antes de confirmar online, compara com o snapshot atual do banco.
      // Se uma devolução chegou enquanto a tela estava aberta, atualiza a
      // lista e pede que o motorista revise os produtos antes de continuar.
      if (isOnline && routeOrderItems.length > 0) {
        const { data: currentServerItems, error: currentServerItemsError } = await supabase
          .from('route_order_items')
          .select('*')
          .eq('route_order_id', order.id)
          .order('created_at', { ascending: true });

        if (currentServerItemsError) throw currentServerItemsError;

        const serverItems = (currentServerItems || []) as RouteOrderItem[];
        const localSignature = routeOrderItems
          .map((item) => `${item.id}:${item.status}:${item.deliverable_quantity_snapshot}:${item.returned_quantity_snapshot}`)
          .sort()
          .join('|');
        const serverSignature = serverItems
          .map((item) => `${item.id}:${item.status}:${item.deliverable_quantity_snapshot}:${item.returned_quantity_snapshot}`)
          .sort()
          .join('|');

        if (localSignature !== serverSignature) {
          await loadRouteOrderItems();
          toast.warning('Atenção: houve alteração ou devolução no ERP. Confira os produtos e marque a entrega novamente.');
          return;
        }

        routeOrderItems = serverItems;
      }

      const deliverableItems = routeOrderItems.filter(isDeliverableRouteOrderItem);
      const hasStructuredItems = routeOrderItems.length > 0;
      const hasBlockedItems = routeOrderItems.some(isBlockedRouteOrderItem);

      // Entrega parcial: separa os itens marcados para RETORNAR ("nao coube") dos que serao entregues.
      // O retorno por item reaproveita o MOTIVO do pedido (mesmo campo do retorno total).
      const decisions = itemDecisionByOrder[order.id] || {};
      const returnSelection: Record<string, boolean> = {};
      for (const it of deliverableItems) if (decisions[it.id] === 'return') returnSelection[it.id] = true;
      const itemsToReturnList = deliverableItems.filter((item) => returnSelection[item.id]);
      const itemsToDeliver = deliverableItems.filter((item) => !returnSelection[item.id]);
      const hasPartialReturn = itemsToReturnList.length > 0;

      if (hasStructuredItems && deliverableItems.length === 0) {
        toast.error('Não existe item disponível para entrega neste pedido.');
        return;
      }

      if (hasStructuredItems && itemsToDeliver.length === 0) {
        toast.error('Nenhum item para entregar. Para devolver tudo, use "Retornar pedido completo".');
        return;
      }

      const partialReturnReasonRaw = returnReasonByOrder[order.id] || '';
      const partialReturnIsOther = partialReturnReasonRaw === 'other' || partialReturnReasonRaw === 'Outro' || partialReturnReasonRaw === '99';
      const partialReturnNotes = returnObservationsByOrder[order.id] || '';
      const partialReturnReason = partialReturnIsOther ? partialReturnNotes.trim() : partialReturnReasonRaw;
      if (hasPartialReturn && !partialReturnReason) {
        toast.error('Selecione o motivo para os itens que não couberam (voltam pra fila).');
        return;
      }

      const recipientName = String(recipientNameByOrder[order.id] || '').trim();
      const recipientRelation = String(recipientRelationByOrder[order.id] || '').trim();
      const recipientNotes = String(recipientNotesByOrder[order.id] || '').trim();

      let gpsData: CapturedGps | null = gpsDataByOrder[order.id] || null;
      let gpsStatus: 'ok' | 'failed' = gpsData ? 'ok' : 'failed';
      let gpsFailureReason: string | null = null;

      if (deliveryProofConfig.enabled) {
        if (deliveryProofConfig.requireRecipient) {
          if (!recipientName) {
            toast.error('Informe o nome de quem recebeu');
            return;
          }
          if (!recipientRelation) {
            toast.error('Selecione a relação de quem recebeu');
            return;
          }
        }

        if (deliveryProofConfig.requireGps && !gpsData) {
          setSavingLabel('Buscando sua localização...');
          const gpsResult = await captureGpsForOrder(order.id);
          setSavingLabel(null);
          if (gpsResult.ok) {
            gpsData = gpsResult.data;
            gpsStatus = 'ok';
          } else {
            gpsStatus = 'failed';
            const fallbackReason = 'reason' in gpsResult ? gpsResult.reason : '';
            gpsFailureReason = String(gpsFailureReasonByOrder[order.id] || fallbackReason || '').trim() || null;
          }
        }

        if (deliveryProofConfig.requireGps && !gpsData) {
          gpsFailureReason = String(gpsFailureReasonByOrder[order.id] || gpsFailureReason || '').trim() || null;
          if (!gpsFailureReason) {
            toast.error('GPS indisponível. Selecione um motivo técnico para continuar.');
            return;
          }
        }
      }

      // 1. Capturar Fotos (Obrigatório se configurado)
      // Se user cancelar ou não tirar min fotos, retorna false e aborta o fluxo.
      const photosCaptured = await capturePhotos('delivered', order.order_id, order.id);
      if (!photosCaptured) return;

      // Fase de gravação: o modal fechou e sem isso a tela ficaria parada.
      setSavingLabel('Registrando a entrega...');
      const confirmation = {
        order_id: order.order_id,
        route_id: routeId,
        route_order_id: order.id,
        action: 'delivered' as const,
        local_timestamp: new Date().toISOString(),
        user_id: (await supabase.auth.getUser()).data.user?.id || '',
        recipient_name: recipientName,
        recipient_relation: recipientRelation,
        recipient_notes: recipientNotes || null,
        gps_status: gpsStatus,
        gps_failure_reason: gpsFailureReason,
        gps_lat: gpsData?.lat ?? null,
        gps_lng: gpsData?.lng ?? null,
        gps_accuracy_m: gpsData?.accuracy ?? null,
        route_order_item_delivery: hasStructuredItems ? {
          delivered_item_ids: itemsToDeliver.map((item) => item.id),
          returned_item_ids: itemsToReturnList.map((item) => item.id),
          blocked_item_ids: routeOrderItems.filter(isBlockedRouteOrderItem).map((item) => item.id),
          partial_return_reason: hasPartialReturn ? partialReturnReason : null,
          partial_return_notes: hasPartialReturn ? partialReturnNotes : null,
        } : null,
      };

      if (isOnline) {
        try {
          if (hasStructuredItems) {
            for (const item of itemsToDeliver) {
              const { error: routeOrderItemsError } = await supabase
                .from('route_order_items')
                .update({
                  status: 'delivered',
                  delivered_quantity: item.deliverable_quantity_snapshot,
                })
                .eq('id', item.id);

              if (routeOrderItemsError) throw routeOrderItemsError;
            }
            // Itens que nao couberam: marcados como retornados NESTA rota (delivered=0).
            // Nao cria order_returns (nao e devolucao do ERP) — o item volta pra fila na finalizacao.
            for (const item of itemsToReturnList) {
              const { error: returnItemError } = await supabase
                .from('route_order_items')
                .update({
                  status: 'returned',
                  delivered_quantity: 0,
                  returned_quantity: item.deliverable_quantity_snapshot,
                })
                .eq('id', item.id);

              if (returnItemError) throw returnItemError;
            }
          }

          const { error } = await supabase
            .from('route_orders')
            .update({
              status: 'delivered',
              delivered_at: confirmation.local_timestamp,
              ...(hasPartialReturn ? { return_reason: partialReturnReason, return_notes: partialReturnNotes || null } : {}),
            })
            .eq('id', order.id);
          if (error) throw error;

          // ATUALIZAÇÃO NO MOMENTO DA ENTREGA (ONLINE)
          // Entrega parcial: marca return_flag para a finalizacao re-enfileirar o item que nao coube.
          const { error: orderError } = await supabase
            .from('orders')
            .update({
              status: 'delivered',
              ...(hasPartialReturn ? { return_flag: true, last_return_reason: partialReturnReason, last_return_notes: partialReturnNotes || null } : {}),
            })
            .eq('id', order.order_id);

          if (orderError) throw orderError;

          const { error: reconcileReturnError } = await supabase.rpc('reconcile_order_return_state', {
            p_order_id: order.order_id,
          });
          if (reconcileReturnError) throw reconcileReturnError;

          toast.success(hasBlockedItems ? 'Itens disponíveis marcados como entregues!' : 'Pedido marcado como entregue!');
          setRouteOrders(prev => prev.map(ro => ro.id === order.id ? { ...ro, status: 'delivered', delivered_at: confirmation.local_timestamp } : ro));
          if (hasStructuredItems) {
            replaceRouteOrderItems(order.id, buildDeliveredRouteOrderItems(routeOrderItems, returnSelection));
          }

          if (deliveryProofConfig.enabled) {
            void saveDeliveryReceiptShadow(order, confirmation.user_id, confirmation.local_timestamp, {
              recipientName: confirmation.recipient_name,
              recipientRelation: confirmation.recipient_relation,
              recipientNotes: confirmation.recipient_notes || '',
              gpsData,
              gpsFailureReason: confirmation.gps_failure_reason,
              gpsStatus: confirmation.gps_status,
            });

            clearDeliveryProofState(order.id);
          }

          // NOTA: Montagem NÃO é criada aqui. Só é gerada na finalização da rota (handleFinalizeRoute),
          // quando os status são definitivos e o motorista não pode mais alterar.

          if (onUpdated) onUpdated();
        } catch (onlineError) {
          // FALLBACK: Internet caiu durante request → enfileira offline
          console.warn('[DeliveryMarking] Online delivery failed, falling back to offline queue:', onlineError);
          await SyncQueue.addItem({ type: 'delivery_confirmation', data: confirmation });
          const updated = routeOrders.map(ro => ro.id === order.id ? { ...ro, status: 'delivered' as const, delivered_at: confirmation.local_timestamp } : ro);
          setRouteOrders(updated);
          if (hasStructuredItems) {
            replaceRouteOrderItems(order.id, buildDeliveredRouteOrderItems(routeOrderItems, returnSelection));
          }
          await OfflineStorage.setItem(`route_orders_${routeId}`, updated);
          toast.success(hasBlockedItems ? 'Itens disponíveis marcados como entregues (será sincronizado)!' : 'Pedido marcado como entregue (será sincronizado)!');
          if (deliveryProofConfig.enabled) {
            clearDeliveryProofState(order.id);
          }
        }
      } else {
        await SyncQueue.addItem({ type: 'delivery_confirmation', data: confirmation });
        const updated = routeOrders.map(ro => ro.id === order.id ? { ...ro, status: 'delivered' as const, delivered_at: confirmation.local_timestamp } : ro);
        setRouteOrders(updated);
        if (hasStructuredItems) {
          replaceRouteOrderItems(order.id, buildDeliveredRouteOrderItems(routeOrderItems, returnSelection));
        }
        await OfflineStorage.setItem(`route_orders_${routeId}`, updated);
        toast.success(hasBlockedItems ? 'Itens disponíveis marcados como entregues (offline)!' : 'Pedido marcado como entregue (offline)!');
        if (deliveryProofConfig.enabled) {
          clearDeliveryProofState(order.id);
        }
      }
    } catch (error) {
      console.error('Error marking as delivered:', error);
      toast.error('Erro ao marcar pedido como entregue');
    } finally {
      setSavingLabel(null);
      setProcessingIds(prev => { const n = new Set(prev); n.delete(order.id); return n; });
      setItemDecisionByOrder((prev) => { const copy = { ...prev }; delete copy[order.id]; return copy; });
    }
  };


  const markAsReturned = async (order: RouteOrderWithDetails, reasonOverride?: string, obsOverride?: string) => {
    const currentReason = reasonOverride ?? (returnReasonByOrder[order.id] || '');
    const currentObs = obsOverride ?? (returnObservationsByOrder[order.id] || '');

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
      // Trava já no primeiro toque, como na entrega.
      setProcessingIds(prev => { const n = new Set(prev); n.add(order.id); return n; });
      const routeOrderItems = routeOrderItemsByRouteOrder[order.id] || [];

      // 1. Capturar Fotos (Opcional, mas oferecido)
      const photosCaptured = await capturePhotos('returned', order.order_id, order.id);
      // Se cancelou mas era opcional, photosCaptured pode ser true (depende da impl do hook).
      // Se o hook retornar false, significa "user cancelou ação inteira".
      if (!photosCaptured) return;

      setSavingLabel('Registrando o retorno...');
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
        try {
          if (routeOrderItems.length > 0) {
            for (const item of routeOrderItems) {
              const { error: routeOrderItemsError } = await supabase
                .from('route_order_items')
                .update({
                  delivered_quantity: 0,
                  returned_quantity: item.deliverable_quantity_snapshot,
                  status: 'returned',
                })
                .eq('id', item.id);

              if (routeOrderItemsError) throw routeOrderItemsError;
            }
          }

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

          const { error: orderUpdateError } = await supabase
            .from('orders')
            .update({
              return_flag: true,
              last_return_reason: confirmation.return_reason,
              last_return_notes: confirmation.observations || null,
            })
            .eq('id', order.order_id);

          if (orderUpdateError) {
            console.error('[DeliveryMarking] Falha ao atualizar return_flag na tabela orders:', orderUpdateError);
            toast.warning('Retorno registrado na rota, mas flag de retorno pode não ter sido salva.');
          }

          toast.success('Pedido marcado como retornado!');
          setRouteOrders(prev => prev.map(ro => ro.id === order.id ? { ...ro, status: 'returned', returned_at: confirmation.local_timestamp, return_reason: { reason: reasonValue } as any, return_notes: currentObs } : ro));
          if (routeOrderItems.length > 0) {
            replaceRouteOrderItems(order.id, routeOrderItems.map((item) => ({
              ...item,
              delivered_quantity: 0,
              returned_quantity: item.deliverable_quantity_snapshot,
              status: 'returned',
            })));
          }

          if (onUpdated) onUpdated();
        } catch (onlineError) {
          // FALLBACK: Internet caiu durante request → enfileira offline
          console.warn('[DeliveryMarking] Online return failed, falling back to offline queue:', onlineError);
          await SyncQueue.addItem({ type: 'delivery_confirmation', data: confirmation });
          await OfflineStorage.setItem(`order_return_${order.order_id}`, {
            return_flag: true,
            last_return_reason: confirmation.return_reason,
            last_return_notes: confirmation.observations || null,
          });
          const returnReasonObj = returnReasons.find(r => r.reason === currentReason || r.reason === reasonValue);
          const updatedOrders = routeOrders.map(ro =>
            ro.id === order.id
              ? { ...ro, status: 'returned' as const, returned_at: confirmation.local_timestamp, return_reason: returnReasonObj || null, return_notes: currentObs }
              : ro
          );
          setRouteOrders(updatedOrders);
          if (routeOrderItems.length > 0) {
            replaceRouteOrderItems(order.id, routeOrderItems.map((item) => ({
              ...item,
              delivered_quantity: 0,
              returned_quantity: item.deliverable_quantity_snapshot,
              status: 'returned',
            })));
          }
          await OfflineStorage.setItem(`route_orders_${routeId}`, updatedOrders);
          toast.success('Pedido marcado como retornado (será sincronizado)!');
        }
      } else {
        // Queue for offline sync
        await SyncQueue.addItem({
          type: 'delivery_confirmation',
          data: confirmation,
        });

        await OfflineStorage.setItem(`order_return_${order.order_id}`, {
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
        if (routeOrderItems.length > 0) {
          replaceRouteOrderItems(order.id, routeOrderItems.map((item) => ({
            ...item,
            delivered_quantity: 0,
            returned_quantity: item.deliverable_quantity_snapshot,
            status: 'returned',
          })));
        }

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
      setSavingLabel(null);
      setProcessingIds(prev => { const n = new Set(prev); n.delete(order.id); return n; });
      setItemDecisionByOrder((prev) => { const copy = { ...prev }; delete copy[order.id]; return copy; });
    }
  };

  // Conclui a parada com base nas marcações: tudo retornado → retorno total;
  // caso contrário → entrega (com os itens que não couberam voltando pra fila).
  // Ambos abrem a câmera (foto obrigatória) por dentro.
  const concludeStop = (order: RouteOrderWithDetails) => {
    const info = getStopReadyInfo(order);
    if (!info.ready || processingIds.has(order.id)) return;
    if (info.allReturn) void markAsReturned(order);
    else void markAsDelivered(order);
  };

  // FOTO AUTOMÁTICA: assim que a parada fica pronta (todos os itens decididos e,
  // se houver retorno, o motivo preenchido), abre a câmera sozinha — sem o antigo
  // "Confirmar entrega". Cada parada só dispara uma vez (autoConcludedRef); mudar
  // uma marcação re-arma. Se o motorista cancelar a foto, o botão "Concluir e tirar
  // foto" fica disponível pra tentar de novo.
  useEffect(() => {
    // Uma foto por vez: se já tem câmera aberta ou parada processando, espera.
    if (isPhotoProcessing || processingIds.size > 0) return;
    for (const ro of routeOrders) {
      if (ro.status !== 'pending') continue;
      if (autoConcludedRef.current[ro.id]) continue;
      if (getStopReadyInfo(ro).ready) {
        autoConcludedRef.current[ro.id] = true;
        concludeStop(ro);
        break; // dispara uma parada por vez
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemDecisionByOrder, returnReasonByOrder, returnObservationsByOrder, routeOrders, processingIds, isPhotoProcessing]);

  const undoReturn = async (routeOrderId: string) => {
    const current = routeOrders.find(ro => ro.id === routeOrderId);
    if (!current) return;
    const routeOrderItems = routeOrderItemsByRouteOrder[routeOrderId] || [];

    try {
      if (processingIds.has(routeOrderId)) return;
      setProcessingIds(prev => { const n = new Set(prev); n.add(routeOrderId); return n; });

      if (isOnline) {
        // ReCheck global status to prevent double processing
        const { data: orderData } = await supabase.from('orders').select('status, id').eq('id', current.order_id).single();
        // If order is delivered or actively in another route, we should normally block.
        // But here assumption is user clicked undo immediately. 
        // For safety: force status back to 'assigned' to LOCK it from Admin Dashboard.

        // ===== LIMPAR FOTOS AO DESFAZER =====
        // Deletar fotos do storage e da tabela delivery_photos (específico para este pedido)
        try {
          // 1. Buscar fotos deste route_order específico
          const { data: photos } = await supabase
            .from('delivery_photos')
            .select('id, storage_path')
            .eq('route_order_id', routeOrderId);

          if (photos && photos.length > 0) {
            // 2. Deletar arquivos do Storage
            const paths = photos.map(p => p.storage_path);
            await supabase.storage.from('delivery-photos').remove(paths);

            // 3. Deletar registros da tabela
            await supabase
              .from('delivery_photos')
              .delete()
              .eq('route_order_id', routeOrderId);

            console.log(`[undoReturn] Deletadas ${photos.length} fotos do pedido ${routeOrderId}`);
          }
        } catch (photoError) {
          console.error(`[undoReturn] Erro ao deletar fotos do pedido ${routeOrderId}:`, photoError);
          // Não interrompe o fluxo, apenas loga o erro
        }

        if (routeOrderItems.length > 0) {
          for (const item of routeOrderItems) {
            const { error: routeOrderItemsError } = await supabase
              .from('route_order_items')
              .update({
                delivered_quantity: 0,
                returned_quantity: 0,
                status: isBlockedRouteOrderItem(item) ? 'returned' : (item.returned_quantity_snapshot > 0 ? 'partial' : 'pending'),
              })
              .eq('id', item.id);

            if (routeOrderItemsError) throw routeOrderItemsError;
          }
        }

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

        const { error: orderUpdateError } = await supabase
          .from('orders')
          .update({
            status: 'assigned', // LOCK: Back to driver, removed from admin routing list
            return_flag: false,
            last_return_reason: null,
            last_return_notes: null,
          })
          .eq('id', current.order_id);
        if (orderUpdateError) throw orderUpdateError;

        const { error: reconcileReturnError } = await supabase.rpc('reconcile_order_return_state', {
          p_order_id: current.order_id,
        });
        if (reconcileReturnError) throw reconcileReturnError;

        const updated = routeOrders.map(ro => ro.id === routeOrderId ? { ...ro, status: 'pending' as const, returned_at: null, return_reason: null } : ro);
        setRouteOrders(updated);
        if (routeOrderItems.length > 0) {
          replaceRouteOrderItems(routeOrderId, buildPendingRouteOrderItemsAfterUndo(routeOrderItems));
        }
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
        if (routeOrderItems.length > 0) {
          replaceRouteOrderItems(routeOrderId, buildPendingRouteOrderItemsAfterUndo(routeOrderItems));
        }
        await OfflineStorage.setItem(`route_orders_${routeId}`, updated);
        setReturnReasonByOrder(prev => { const copy = { ...prev }; delete copy[routeOrderId]; return copy; });
        setReturnObservationsByOrder(prev => { const copy = { ...prev }; delete copy[routeOrderId]; return copy; });
        toast.success('Retorno desfeito (offline)');
      }
    } catch (error) {
      console.error('Error undoing return:', error);
      toast.error('Erro ao desfazer retorno');
    } finally {
      setProcessingIds(prev => { const n = new Set(prev); n.delete(routeOrderId); return n; });
      setItemDecisionByOrder(prev => { const copy = { ...prev }; delete copy[routeOrderId]; return copy; });
      autoConcludedRef.current[routeOrderId] = false;
    }
  };

  const undoDelivery = async (routeOrderId: string) => {
    const current = routeOrders.find(ro => ro.id === routeOrderId);
    if (!current) return;
    const routeOrderItems = routeOrderItemsByRouteOrder[routeOrderId] || [];

    try {
      if (processingIds.has(routeOrderId)) return;
      setProcessingIds(prev => { const n = new Set(prev); n.add(routeOrderId); return n; });

      if (isOnline) {
        if (routeOrderItems.length > 0) {
          for (const item of routeOrderItems) {
            const { error: routeOrderItemsError } = await supabase
              .from('route_order_items')
              .update({
                delivered_quantity: 0,
                returned_quantity: 0,
                status: isBlockedRouteOrderItem(item) ? 'returned' : (item.returned_quantity_snapshot > 0 ? 'partial' : 'pending'),
              })
              .eq('id', item.id);

            if (routeOrderItemsError) throw routeOrderItemsError;
          }
        }

        const { error } = await supabase
          .from('route_orders')
          .update({
            status: 'pending',
            delivered_at: null,
            signature_url: null
          })
          .eq('id', routeOrderId);
        if (error) throw error;

        const { error: orderUpdateError } = await supabase
          .from('orders')
          .update({
            status: 'assigned', // LOCK: Back to driver
            return_flag: false
          })
          .eq('id', current.order_id);
        if (orderUpdateError) throw orderUpdateError;

        const { error: reconcileReturnError } = await supabase.rpc('reconcile_order_return_state', {
          p_order_id: current.order_id,
        });
        if (reconcileReturnError) throw reconcileReturnError;

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

        // ===== LIMPAR FOTOS AO DESFAZER =====
        // Deletar fotos do storage e da tabela delivery_photos (específico para este pedido)
        try {
          // 1. Buscar fotos deste route_order específico
          const { data: photos } = await supabase
            .from('delivery_photos')
            .select('id, storage_path')
            .eq('route_order_id', routeOrderId);

          if (photos && photos.length > 0) {
            // 2. Deletar arquivos do Storage
            const paths = photos.map(p => p.storage_path);
            await supabase.storage.from('delivery-photos').remove(paths);

            // 3. Deletar registros da tabela
            await supabase
              .from('delivery_photos')
              .delete()
              .eq('route_order_id', routeOrderId);

            console.log(`[undoDelivery] Deletadas ${photos.length} fotos do pedido ${routeOrderId}`);
          }
        } catch (photoError) {
          console.error(`[undoDelivery] Erro ao deletar fotos do pedido ${routeOrderId}:`, photoError);
          // Não interrompe o fluxo, apenas loga o erro
        }

        const updated = routeOrders.map(ro => ro.id === routeOrderId ? { ...ro, status: 'pending' as const, delivered_at: null } : ro);
        setRouteOrders(updated);
        if (routeOrderItems.length > 0) {
          replaceRouteOrderItems(routeOrderId, buildPendingRouteOrderItemsAfterUndo(routeOrderItems));
        }
        await OfflineStorage.setItem(`route_orders_${routeId}`, updated);
        toast.success('Entrega desfeita');

      } else {
        await SyncQueue.addItem({
          type: 'delivery_revert',
          data: { order_id: current.order_id, route_id: routeId, user_id: current.route_id },
        });
        const updated = routeOrders.map(ro => ro.id === routeOrderId ? { ...ro, status: 'pending' as const, delivered_at: null } : ro);
        setRouteOrders(updated);
        if (routeOrderItems.length > 0) {
          replaceRouteOrderItems(routeOrderId, buildPendingRouteOrderItemsAfterUndo(routeOrderItems));
        }
        await OfflineStorage.setItem(`route_orders_${routeId}`, updated);
        toast.success('Entrega desfeita (offline)');
      }
    } catch (error) {
      console.error('Error undoing delivery:', error);
      toast.error('Erro ao desfazer entrega');
    } finally {
      setProcessingIds(prev => { const n = new Set(prev); n.delete(routeOrderId); return n; });
      setItemDecisionByOrder(prev => { const copy = { ...prev }; delete copy[routeOrderId]; return copy; });
      autoConcludedRef.current[routeOrderId] = false;
    }
  };

  const handleFinalizeRoute = async () => {
    // Offline ainda depende do estado local; online valida novamente no banco.
    if (!isOnline) {
      const pending = routeOrders.filter(r => r.status === 'pending');
      if (pending.length > 0) {
        toast.error(`Ainda existem ${pending.length} pedidos pendentes na rota.`);
        return;
      }
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
        type FinalizeRouteOrderRow = {
          id: string;
          order_id: string;
          status: RouteOrderWithDetails['status'];
          order: { id: string } | { id: string }[] | null;
        };

        await backgroundSync.forceSync(true);

        const pendingSyncItems = await SyncQueue.getPendingItems();
        const routePendingSyncItems = pendingSyncItems.filter((item) =>
          String(item.data?.route_id || '') === String(routeId) &&
          ['delivery_confirmation', 'return_revert', 'delivery_revert'].includes(item.type)
        );

        if (routePendingSyncItems.length > 0) {
          toast.error('Ainda existem alterações desta rota aguardando sincronização. Tente novamente em alguns segundos.');
          return;
        }

        const { data: dbRouteOrders, error: dbRouteOrdersError } = await supabase
          .from('route_orders')
          .select(`
            id,
            order_id,
            status,
            order:orders!order_id (id)
          `)
          .eq('route_id', routeId);

        if (dbRouteOrdersError) throw dbRouteOrdersError;

        const routeOrdersFromDb = (dbRouteOrders || []) as FinalizeRouteOrderRow[];
        const pendingFromDb = routeOrdersFromDb.filter((ro) => ro.status === 'pending');

        if (pendingFromDb.length > 0) {
          toast.error(`Ainda existem ${pendingFromDb.length} pedidos pendentes na rota.`);
          return;
        }

        const returnedIds = routeOrdersFromDb
          .filter((ro) => ro.status === 'returned')
          .map((ro) => ro.order_id);

        const deliveredRouteOrders = routeOrdersFromDb.filter((ro) => ro.status === 'delivered');
        const deliveredIds = deliveredRouteOrders.map((ro) => ro.order_id);

        // Se uma devolução entrou depois da última atualização da tela,
        // avisa antes do encerramento para o motorista poder desfazer Entregue.
        if (deliveredRouteOrders.length > 0) {
          const deliveredRouteOrderIds = deliveredRouteOrders.map((ro) => ro.id);
          const { data: currentBlockedItems, error: currentBlockedItemsError } = await supabase
            .from('route_order_items')
            .select('id, route_order_id, product_name_snapshot, returned_quantity_snapshot, deliverable_quantity_snapshot')
            .in('route_order_id', deliveredRouteOrderIds)
            .gt('returned_quantity_snapshot', 0)
            .lte('deliverable_quantity_snapshot', 0);

          if (currentBlockedItemsError) throw currentBlockedItemsError;

          const knownBlockedIds = new Set(
            Object.values(routeOrderItemsByRouteOrder)
              .flat()
              .filter(isBlockedRouteOrderItem)
              .map((item) => String(item.id)),
          );
          const newlyBlockedItems = (currentBlockedItems || []).filter(
            (item: any) => !knownBlockedIds.has(String(item.id)),
          );

          if (newlyBlockedItems.length > 0) {
            await loadRouteOrderItems();
            const productNames = newlyBlockedItems
              .map((item: any) => String(item.product_name_snapshot || 'Produto'))
              .slice(0, 3)
              .join(', ');
            const keepDelivered = window.confirm(
              `Atenção: houve devolução no ERP durante a rota (${productNames}).\n\n` +
              'Se esses produtos foram realmente entregues, confirme para finalizar e gerar a pendência de coleta. ' +
              'Se não foram entregues, cancele e desfaça a marcação de entrega.'
            );

            if (!keepDelivered) return;
          }
        }

        // Garante o status final do pedido antes de concluir a rota e rodar a sincronizacao central de montagem.
        if (deliveredIds.length > 0) {
          await supabase
            .from('orders')
            .update({ status: 'delivered' })
            .in('id', deliveredIds)
            .neq('status', 'delivered');
        }

        // 1. Marcar rota como concluída
        const completedAt = new Date().toISOString();
        const { error } = await supabase
          .from('routes')
          .update({ status: 'completed', completed_at: completedAt, updated_at: completedAt })
          .eq('id', routeId);
        if (error) throw error;

        try {
          const { data: mdfeData, error: mdfeError } = await supabase.functions.invoke('auto-close-route-mdfe', {
            body: { routeId },
          });

          if (mdfeError) {
            console.warn('[FinalizeRoute] Falha ao encerrar MDF-e automaticamente:', mdfeError);
            toast.warning('Rota finalizada, mas o MDF-e nao foi encerrado automaticamente. Revise o historico MDF-e.');
          } else if (mdfeData?.closed) {
            toast.success('MDF-e encerrado automaticamente ao finalizar a rota.');
          } else if (mdfeData?.reason === 'manifest_not_issued') {
            toast.warning('Rota finalizada, mas o MDF-e ainda nao estava autorizado para encerramento automatico.');
          }
        } catch (mdfeAutoCloseError) {
          console.warn('[FinalizeRoute] Erro no encerramento automatico do MDF-e:', mdfeAutoCloseError);
          toast.warning('Rota finalizada, mas houve falha ao encerrar o MDF-e automaticamente.');
        }

        if (returnedIds.length > 0) {
          await supabase
            .from('orders')
            .update({
              status: 'pending',
              return_flag: true // GARANTIA: Se estava como retornado na rota, tem que ter a flag
            })
            .in('id', returnedIds);
        }

        // Último passo operacional: restaura a verdade fiscal e consolida
        // as coletas somente depois dos resultados definitivos da rota.
        for (const routeOrder of routeOrdersFromDb) {
          const { error: reconcileReturnError } = await supabase.rpc('reconcile_order_return_state', {
            p_order_id: routeOrder.order_id,
          });
          if (reconcileReturnError) throw reconcileReturnError;
        }

        // 4. Gerar tarefas de montagem pela RPC única do banco
        try {
          const assemblySyncResult = await syncAssemblyProductsForRoute(routeId);
          console.log('[FinalizeRoute] Assembly sync result:', assemblySyncResult);
        } catch (assemblyError) {
          console.error('[FinalizeRoute] Erro ao sincronizar tarefas de montagem:', assemblyError);
          toast.error('Rota finalizada, mas houve falha ao gerar as tarefas de montagem.');
        }

        // ENTREGA PARCIAL: pedidos entregues que ainda tem item faltando (o que "nao coube")
        // voltam pra fila (status pending). O item entregue ja gerou montagem acima; o snapshot
        // da proxima rota (Fase 1B) traz so o item que falta.
        //
        // SO vale para pedidos que esta rota acompanhou POR ITEM (tem linha em
        // route_order_items). Em rota legada — criada com a entrega por item desligada, ou
        // anterior a ela — nao existe registro de item, entao delivered_quantity do saldo fica
        // em ZERO mesmo com o pedido entregue por inteiro. Sem este recorte, todo pedido
        // entregue em rota legada era lido como "sobrou item" e voltava para a fila marcado
        // como devolvido. Em rota legada a entrega e tudo-ou-nada: entregue e entregue.
        const { data: routeItemRows, error: routeItemRowsError } = await supabase
          .from('route_order_items')
          .select('order_id')
          .eq('route_id', routeId);

        if (routeItemRowsError) {
          // Sem saber quais pedidos foram acompanhados por item, nao da para afirmar que houve
          // entrega parcial. Nao re-enfileira nada: manter entregue e o lado seguro do erro.
          console.warn('[FinalizeRoute] Falha ao ler os itens da rota; parciais nao avaliados:', routeItemRowsError);
        }

        const itemizedOrderIds = new Set(
          (routeItemRows || []).map((row: any) => String(row.order_id))
        );
        const deliveredItemizedIds = deliveredIds.filter((id) => itemizedOrderIds.has(String(id)));

        if (!routeItemRowsError && deliveredItemizedIds.length > 0) {
          const { data: partialBalances, error: partialBalancesError } = await supabase
            .from('order_item_shadow_balances')
            .select('order_id')
            .in('order_id', deliveredItemizedIds)
            .eq('source_present', true)
            .gt('remaining_deliverable_quantity', 0);

          if (partialBalancesError) {
            console.warn('[FinalizeRoute] Falha ao detectar pedidos parciais:', partialBalancesError);
          } else {
            const partialOrderIds = Array.from(new Set((partialBalances || []).map((b: any) => String(b.order_id))));
            if (partialOrderIds.length > 0) {
              const { error: requeueError } = await supabase
                .from('orders')
                .update({ status: 'pending', return_flag: true })
                .in('id', partialOrderIds);
              if (requeueError) {
                console.warn('[FinalizeRoute] Falha ao re-enfileirar pedidos parciais:', requeueError);
              } else {
                console.log('[FinalizeRoute] Pedidos parciais re-enfileirados:', partialOrderIds);
              }
            }
          }
        }

        toast.success('Rota finalizada com sucesso!');
        setRouteDetails((prev: any) => ({ ...prev, status: 'completed', completed_at: completedAt, updated_at: completedAt }));
        if (onUpdated) onUpdated();
      } else {
        // Offline: Queue route completion
        await SyncQueue.addItem({
          type: 'route_completion',
          data: confirmation,
        });

        // Local update
        setRouteDetails((prev: any) => ({ ...prev, status: 'completed', completed_at: confirmation.local_timestamp, updated_at: confirmation.local_timestamp }));
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

  const normalizeText = (value: unknown) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  const normalizedSearch = normalizeText(searchTerm);

  const statusCounts = {
    pending: routeOrders.filter((ro) => ro.status === 'pending').length,
    delivered: routeOrders.filter((ro) => ro.status === 'delivered').length,
    returned: routeOrders.filter((ro) => ro.status === 'returned').length,
  };

  const filteredRouteOrders = routeOrders.filter((routeOrder) => {
    if (routeOrder.status !== statusFilter) return false;
    if (!normalizedSearch) return true;

    const order = routeOrder.order as any;
    const launchNumber =
      order?.numero_lancamento ??
      order?.raw_json?.numero_lancamento ??
      order?.raw_json?.lancamento_venda ??
      order?.raw_json?.lancamento ??
      order?.raw_json?.pedido;

    const fields = [
      order?.order_id_erp,
      order?.customer_name,
      launchNumber,
    ];

    return fields.some((field) => normalizeText(field).includes(normalizedSearch));
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-gray-600">Carregando pedidos...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 overflow-x-hidden">
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

      <div className="bg-white rounded-lg shadow p-4 space-y-3">
        <div className="relative">
          <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Buscar por lançamento, pedido ou cliente"
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setStatusFilter('pending')}
            className={`px-3 py-2 rounded-md text-sm font-medium border transition-colors ${statusFilter === 'pending'
              ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
          >
            Pendentes ({statusCounts.pending})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('delivered')}
            className={`px-3 py-2 rounded-md text-sm font-medium border transition-colors ${statusFilter === 'delivered'
              ? 'bg-green-100 text-green-800 border-green-300'
              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
          >
            Entregues ({statusCounts.delivered})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('returned')}
            className={`px-3 py-2 rounded-md text-sm font-medium border transition-colors ${statusFilter === 'returned'
              ? 'bg-red-100 text-red-800 border-red-300'
              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
          >
            Retornados ({statusCounts.returned})
          </button>
        </div>
      </div>

      {/* Orders List */}
      {filteredRouteOrders.length === 0 && (
        <div className="bg-white rounded-lg shadow p-6 text-center text-sm text-gray-500">
          Nenhum pedido encontrado para o filtro atual.
        </div>
      )}

      {filteredRouteOrders.map((routeOrder) => {
        const order = routeOrder.order;
        if (!order) return null;
        const routeOrderItems = routeOrderItemsByRouteOrder[routeOrder.id] || [];
        const selectedReason = returnReasonByOrder[routeOrder.id] || '';
        const selectedObs = returnObservationsByOrder[routeOrder.id] || '';
        const recipientName = recipientNameByOrder[routeOrder.id] || '';
        const recipientRelation = recipientRelationByOrder[routeOrder.id] || '';
        const recipientNotes = recipientNotesByOrder[routeOrder.id] || '';
        const gpsData = gpsDataByOrder[routeOrder.id];
        const gpsStatus = gpsStatusByOrder[routeOrder.id] || 'idle';
        const gpsFailureReason = gpsFailureReasonByOrder[routeOrder.id] || '';
        const visibleRouteOrderItems = routeOrderItems.filter(isVisibleRouteOrderItem);
        const hasBlockedItems = visibleRouteOrderItems.some(
          isBlockedRouteOrderItem
        );

        return (
          <div key={routeOrder.id} className="bg-white rounded-lg shadow p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <Package className="h-5 w-5 text-blue-600 mr-2" />
                  <span className="font-semibold text-gray-900">
                    {order.customer_name}
                  </span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(routeOrder.status)}`}>
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
                  <div>
                    Pedido:{' '}
                    <span className="font-bold text-blue-600">{order.order_id_erp}</span>
                  </div>
                  {(() => {
                    const v = computeDeliverableOrderValue(order, routeOrderItems);
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

                {hasBlockedItems && (
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    Existe produto devolvido no ERP nesta entrega. Não entregue esse item ao cliente.
                  </div>
                )}

                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-sm font-semibold text-gray-800">Itens desta entrega</p>
                    <span className="text-xs text-gray-500">
                      {visibleRouteOrderItems.length > 0 ? `${visibleRouteOrderItems.length} item(ns) estruturado(s)` : 'Modo legado'}
                    </span>
                  </div>

                  {visibleRouteOrderItems.length > 0 ? (
                    <div className="space-y-2">
                      {visibleRouteOrderItems.map((item) => (
                        <div key={item.id} className="rounded-md border border-gray-200 bg-white px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900">{item.product_name_snapshot}</p>
                              <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-gray-500">
                                <span>SKU: {item.sku_snapshot || '-'}</span>
                                <span>Chave: {item.source_line_key}</span>
                                <span>Local: {item.storage_location_snapshot || '-'}</span>
                              </div>
                            </div>
                            <div className="text-right text-xs text-gray-700">
                              <p>Alocado: <span className="font-semibold">{item.allocated_quantity}</span></p>
                              <p>Saldo entrega: <span className="font-semibold">{item.deliverable_quantity_snapshot}</span></p>
                            </div>
                          </div>

                          {isBlockedRouteOrderItem(item) && (
                            <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-2 text-xs font-medium text-red-700">
                              Produto devolvido no ERP e bloqueado para entrega nesta rota.
                            </div>
                          )}

                          <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-gray-700">
                              Comprado: {item.purchased_quantity}
                            </span>
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
                              Devolvido antes da rota: {item.returned_quantity_snapshot}
                            </span>
                            <span className={`rounded-full border px-2 py-1 ${getRouteOrderItemStatusClasses(item)}`}>
                              {getRouteOrderItemStatusLabel(item)}
                            </span>
                          </div>

                          {routeOrder.status === 'pending' && isDeliverableRouteOrderItem(item) && (() => {
                            const decision = itemDecisionByOrder[routeOrder.id]?.[item.id];
                            return (
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setItemDecision(routeOrder.id, item.id, 'deliver')}
                                  className={`text-xs px-3 py-1 rounded-md border font-medium transition-colors ${decision === 'deliver' ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'}`}
                                >
                                  {decision === 'deliver' ? '✓ Entregar' : 'Entregar'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setItemDecision(routeOrder.id, item.id, 'return')}
                                  className={`text-xs px-3 py-1 rounded-md border font-medium transition-colors ${decision === 'return' ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'}`}
                                >
                                  {decision === 'return' ? '✓ Retornar' : 'Retornar'}
                                </button>
                                {!decision && (
                                  <span className="text-[11px] text-gray-400">marque este item</span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500">
                      Este pedido ainda está usando somente os dados legados de itens nesta tela.
                    </div>
                  )}
                </div>

                {routeOrder.status === 'pending' && (() => {
                  const returnCount = Object.values(itemDecisionByOrder[routeOrder.id] || {}).filter((d) => d === 'return').length;
                  if (returnCount === 0) return null;
                  return (
                    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      Você marcou {returnCount} item(ns) para <strong>retornar</strong>.
                      Selecione o <strong>Motivo do Retorno</strong> abaixo. Quando todos os itens estiverem
                      marcados, a <strong>câmera abre sozinha</strong> pra você tirar a foto e concluir.
                    </div>
                  );
                })()}

                {/* Formulário só aparece quando precisa: comprovante ligado OU há item marcado pra retornar. */}
                {routeOrder.status === 'pending' && (deliveryProofConfig.enabled || Object.values(itemDecisionByOrder[routeOrder.id] || {}).some((d) => d === 'return')) && (
                  <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {deliveryProofConfig.enabled && (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Nome de quem recebeu
                            </label>
                            <input
                              type="text"
                              value={recipientName}
                              onChange={(e) => setRecipientNameByOrder(prev => ({ ...prev, [routeOrder.id]: e.target.value }))}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                              placeholder="Ex.: Maria da Silva"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Relação com destinatário
                            </label>
                            <select
                              value={recipientRelation}
                              onChange={(e) => setRecipientRelationByOrder(prev => ({ ...prev, [routeOrder.id]: e.target.value }))}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                            >
                              <option value="">Selecione</option>
                              {RECIPIENT_RELATION_OPTIONS.map((option) => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Observação do recebimento (opcional)
                            </label>
                            <input
                              type="text"
                              value={recipientNotes}
                              onChange={(e) => setRecipientNotesByOrder(prev => ({ ...prev, [routeOrder.id]: e.target.value }))}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                              placeholder="Portaria, vizinho, bloco/apto, etc."
                            />
                          </div>
                          <div className="md:col-span-2 border-t border-gray-200 pt-3">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <button
                                type="button"
                                onClick={() => { void captureGpsForOrder(routeOrder.id); }}
                                disabled={gpsStatus === 'capturing'}
                                className="inline-flex items-center px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60 text-sm"
                              >
                                {gpsStatus === 'capturing' ? 'Capturando GPS...' : 'Capturar GPS'}
                              </button>
                              {gpsData && (
                                <span className="text-xs text-green-700 bg-green-100 px-2 py-1 rounded">
                                  GPS OK: {gpsData.lat.toFixed(5)}, {gpsData.lng.toFixed(5)} (±{gpsData.accuracy ? Math.round(gpsData.accuracy) : '-'}m)
                                </span>
                              )}
                              {!gpsData && gpsStatus === 'failed' && (
                                <span className="text-xs text-amber-700 bg-amber-100 px-2 py-1 rounded">
                                  GPS indisponível. Informe motivo técnico.
                                </span>
                              )}
                            </div>
                            {!gpsData && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  Motivo técnico (se GPS falhar)
                                </label>
                                <select
                                  value={gpsFailureReason}
                                  onChange={(e) => setGpsFailureReasonByOrder(prev => ({ ...prev, [routeOrder.id]: e.target.value }))}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                                >
                                  <option value="">Selecione o motivo técnico</option>
                                  {GPS_FAILURE_OPTIONS.map((option) => (
                                    <option key={option.id} value={option.id}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                      {Object.values(itemDecisionByOrder[routeOrder.id] || {}).some((d) => d === 'return') && (
                        <>
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
                        </>
                      )}
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
              <div className="w-full md:w-auto ml-0 flex gap-2 md:ml-4 md:flex-col md:space-y-2 md:gap-0">
                {routeOrder.status === 'pending' && (() => {
                  const info = getStopReadyInfo(routeOrder);
                  const busy = processingIds.has(routeOrder.id) || isPhotoProcessing;
                  return (
                    <>
                      {/* Botão de concluir (foto). Aparece quando a parada está pronta —
                          normalmente a câmera já abriu sozinha; este fica de reserva
                          (ex.: se cancelou a foto) e pra quem prefere um toque. */}
                      {info.ready && (
                        <button
                          onClick={() => concludeStop(routeOrder)}
                          disabled={busy}
                          className="flex flex-1 md:flex-none items-center justify-center px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                        >
                          <Camera className="h-4 w-4 mr-1" />
                          Concluir e tirar foto
                        </button>
                      )}

                      {/* Atalho: entregar tudo de uma vez */}
                      <button
                        onClick={() => markAsDelivered(routeOrder)}
                        disabled={busy}
                        className="flex flex-1 md:flex-none items-center justify-center px-3 py-2 bg-white border border-green-600 text-green-700 rounded-md hover:bg-green-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Entregar pedido completo
                      </button>

                      {/* Atalho: retornar tudo (abre o modal do motivo) */}
                      <button
                        onClick={() => setReturnAllModalOrderId(routeOrder.id)}
                        disabled={busy}
                        className="flex flex-1 md:flex-none items-center justify-center px-3 py-2 bg-white border border-red-600 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Retornar pedido completo
                      </button>
                    </>
                  );
                })()}


              </div>
            </div>
          </div>
        );
      })}

      <div className="mt-8 pt-4 border-t border-gray-200 sticky bottom-0 bg-gray-50 pb-4 px-2 sm:px-4 z-10">
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

      {/* Modal do "Retornar pedido completo": pede UM motivo pra devolver o pedido inteiro. */}
      {returnAllModalOrderId && (() => {
        const order = routeOrders.find((ro) => ro.id === returnAllModalOrderId);
        if (!order) return null;
        const reason = returnReasonByOrder[order.id] || '';
        const isOther = reason === 'other' || reason === 'Outro' || reason === '99';
        const obs = returnObservationsByOrder[order.id] || '';
        const canConfirm = !!reason && (!isOther || obs.trim().length > 0) && !processingIds.has(order.id);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-600" />
                <h3 className="text-lg font-bold text-gray-900">Retornar pedido completo</h3>
              </div>
              <p className="mt-1 text-sm text-gray-600">
                Pedido <span className="font-semibold">{order.order?.order_id_erp}</span> — {order.order?.customer_name}
              </p>
              <p className="mt-2 text-xs text-gray-500">
                Todos os itens deste pedido voltam. Depois de confirmar, a câmera abre pra você tirar a foto.
              </p>

              <label className="mt-4 block text-sm font-medium text-gray-700">Motivo do retorno</label>
              <select
                value={reason}
                onChange={(e) => setReturnReasonByOrder((prev) => ({ ...prev, [order.id]: e.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
              >
                <option value="">Selecione um motivo</option>
                {returnReasons.map((r) => {
                  const label = (r as any).reason_text || (r as any).reason || r.id;
                  const value = (r as any).reason || (r as any).reason_text || r.id;
                  return <option key={r.id || value} value={value}>{label}</option>;
                })}
              </select>

              <label className="mt-3 block text-sm font-medium text-gray-700">
                Observações {isOther ? '(obrigatório para "Outro")' : '(opcional)'}
              </label>
              <input
                type="text"
                value={obs}
                onChange={(e) => setReturnObservationsByOrder((prev) => ({ ...prev, [order.id]: e.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                placeholder="Ex.: cliente ausente, endereço errado..."
              />

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReturnAllModalOrderId(null)}
                  className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!canConfirm}
                  onClick={() => { const o = order; setReturnAllModalOrderId(null); void markAsReturned(o); }}
                  className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Camera className="h-4 w-4" />
                  Confirmar e tirar foto
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {renderModal()}
      {savingLabel && <ProcessingOverlay message={savingLabel} />}
    </div>
  );
}
