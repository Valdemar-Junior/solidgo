import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, MapPin, Phone, Search, Truck, Hammer, FileText, FileSpreadsheet, AlertTriangle, LogOut, Eye, ChevronDown, ChevronUp, Copy, Check, Briefcase } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import { useAuthStore } from '../../stores/authStore';
import type { Order, OrderWithdrawal } from '../../types/database';
import { toast } from 'sonner';
import { AssemblyPhotosViewer, DeliveryPhotosViewer } from '../../components/photos';
import { DeliveryProofPdfGenerator } from '../../utils/pdf/deliveryProofPdfGenerator';
import { DeliverySheetGenerator } from '../../utils/pdf/deliverySheetGenerator';
import { PDFDocument } from 'pdf-lib';

interface RouteOrderInfo {
  id: string;
  route_id: string;
  status: string;
  sequence?: number;
  delivered_at?: string;
  returned_at?: string;
  return_reason?: string | null;
  return_notes?: string | null;
  route?: any;
  conference?: any;
}

interface AssemblyInfo {
  id: string;
  status: string;
  product_name?: string;
  assembly_route_id?: string;
  assembly_route?: any;
  assembly_date?: string;
  completion_date?: string;
  returned_at?: string;
  return_reason?: string | null;
  observations?: string | null;
  technical_notes?: string | null;
  updated_at?: string;
}

interface DeliveryReceiptInfo {
  id: string;
  route_order_id: string;
  delivered_by_user_id?: string | null;
  delivered_at_server?: string | null;
  device_timestamp?: string | null;
  gps_lat?: number | string | null;
  gps_lng?: number | string | null;
  gps_accuracy_m?: number | string | null;
  gps_status?: string | null;
  gps_failure_reason?: string | null;
  recipient_name?: string | null;
  recipient_relation?: string | null;
  recipient_notes?: string | null;
  photo_count?: number | null;
  sync_status?: string | null;
  network_mode?: string | null;
  proof_hash?: string | null;
  created_at?: string | null;
}

interface DeliveryPhotoRow {
  id: string;
  storage_path: string;
  file_name?: string | null;
  photo_type?: string | null;
  created_at?: string | null;
}

interface WithdrawalInfo extends OrderWithdrawal {}

// Legacy only: older customer pickups were represented by routes named "RETIRADA...".
// The current pickup workflow reads from order_withdrawals.
const isLegacyPickupRouteName = (value: any) => String(value || '').trim().toUpperCase().startsWith('RETIRADA');

function mapOrderToPickupSheetOrder(order: any, routeOrder: any) {
  const address = order?.address_json || {};
  const prodLoc = order?.raw_json?.produtos_locais || [];
  const items = (Array.isArray(order?.items_json) ? order.items_json : []).map((item: any, idx: number) => {
    if (!item || item.location) return item;

    let location = '';
    if (Array.isArray(prodLoc) && prodLoc.length > 0) {
      const sku = String(item?.sku || '').trim().toLowerCase();
      const name = String(item?.name || '').trim().toLowerCase();
      const byCode = prodLoc.find((product: any) => String(product?.codigo_produto || '').trim().toLowerCase() === sku);
      const byName = prodLoc.find((product: any) => String(product?.nome_produto || '').trim().toLowerCase() === name);
      if (byCode?.local_estocagem) location = String(byCode.local_estocagem);
      else if (byName?.local_estocagem) location = String(byName.local_estocagem);
      else if (prodLoc[idx]?.local_estocagem) location = String(prodLoc[idx].local_estocagem);
      else if (prodLoc[0]?.local_estocagem) location = String(prodLoc[0].local_estocagem);
    }

    return { ...item, location };
  });

  const saleDate = order?.data_venda
    || order?.raw_json?.data_venda
    || order?.raw_json?.data_emissao
    || order?.sale_date
    || '';

  return {
    id: order?.id || routeOrder?.order_id,
    order_id_erp: String(order?.order_id_erp || routeOrder?.order_id || ''),
    customer_name: String(order?.customer_name || (order?.raw_json?.nome_cliente ?? '')),
    phone: String(order?.phone || (order?.raw_json?.cliente_celular ?? '')),
    address_json: {
      street: String(address.street || order?.raw_json?.destinatario_endereco || ''),
      neighborhood: String(address.neighborhood || order?.raw_json?.destinatario_bairro || ''),
      city: String(address.city || order?.raw_json?.destinatario_cidade || ''),
      state: String(address.state || ''),
      zip: String(address.zip || order?.raw_json?.destinatario_cep || ''),
      complement: address.complement || order?.raw_json?.destinatario_complemento || '',
    },
    items_json: items,
    raw_json: order?.raw_json || null,
    data_venda: saleDate,
    sale_date: order?.sale_date || saleDate,
    previsao_entrega: order?.previsao_entrega || order?.raw_json?.previsao_entrega || order?.raw_json?.data_prevista_entrega,
    observacoes_publicas: order?.observacoes_publicas ?? order?.raw_json?.observacoes_publicas ?? order?.raw_json?.Observacoes_publicas ?? order?.raw_json?.observacoes ?? '',
    observacoes_internas: order?.observacoes_internas ?? order?.raw_json?.observacoes_internas ?? order?.raw_json?.Observacoes_internas ?? '',
    total: Number(order?.total || 0),
    status: order?.status || 'delivered',
    observations: order?.observations || '',
    created_at: order?.created_at || new Date().toISOString(),
    updated_at: order?.updated_at || new Date().toISOString(),
  } as any;
}

// Pequeno componente auxiliar para botão de copiar
function CopyButton({ text, label = "Copiado!" }: { text: string, label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(label);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 hover:bg-gray-100 rounded-md transition-all ml-1 group relative"
      title="Copiar"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-600" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-gray-400 group-hover:text-blue-600" />
      )}
    </button>
  );
}

export default function OrderLookup() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [routeOrders, setRouteOrders] = useState<RouteOrderInfo[]>([]);
  const [withdrawal, setWithdrawal] = useState<WithdrawalInfo | null>(null);
  const [assemblies, setAssemblies] = useState<AssemblyInfo[]>([]);
  const [deliveryReceiptsByRouteOrder, setDeliveryReceiptsByRouteOrder] = useState<Record<string, DeliveryReceiptInfo>>({});
  const [deliveryReceiptUserNames, setDeliveryReceiptUserNames] = useState<Record<string, string>>({});
  const [proofPdfLoadingByRouteOrder, setProofPdfLoadingByRouteOrder] = useState<Record<string, boolean>>({});
  const [showObservations, setShowObservations] = useState(false);
  const [withdrawalActionLoading, setWithdrawalActionLoading] = useState<'receipt' | 'danfe' | null>(null);

  // Check if user is consultor to hide certain elements
  const { user, logout } = useAuthStore();
  const isConsultor = user?.role === 'consultor';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const fetchOrders = async (term: string) => {
    const q = term.trim();
    if (!q) return [];
    try {
      const numeric = q.replace(/\D/g, '');
      const formatCpf = (digits: string) => {
        if (digits.length !== 11) return null;
        return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
      };
      const formattedCpf = formatCpf(numeric);
      const likeTerm = `%${q}%`;
      const likeNum = numeric ? `%${numeric}%` : '';
      const filters: string[] = [
        `order_id_erp.ilike.${likeTerm}`,
        `customer_name.ilike.${likeTerm}`,
      ];
      if (numeric) {
        filters.push(`customer_cpf.ilike.${likeNum}`);
        if (formattedCpf) filters.push(`customer_cpf.ilike.%${formattedCpf}%`);
        filters.push(`raw_json->>destinatario_cpf.ilike.${likeNum}`);
        filters.push(`raw_json->>cliente_cpf.ilike.${likeNum}`);
        filters.push(`raw_json->>cpf.ilike.${likeNum}`);
      }
      const filterStr = filters.join(',');

      // OTIMIZAÇÃO: Excluindo campos pesados (danfe_base64, return_danfe_base64, xml_documento, return_nfe_xml)
      const ORDERS_LOOKUP_COLS = 'id,order_id_erp,customer_name,phone,address_json,items_json,status,created_at,updated_at,filial_venda,data_venda,previsao_entrega,tem_frete_full,observacoes_publicas,observacoes_internas,customer_cpf,vendedor_nome,return_flag,last_return_reason,last_return_notes,brand,department,service_type,erp_status,blocked_at,blocked_reason,requires_pickup,pickup_created_at,return_nfe_number,return_nfe_key,return_date,return_type,import_source,previsao_montagem,product_group,product_subgroup,danfe_gerada_em,raw_json';
      const { data, error } = await supabase
        .from('orders')
        .select(ORDERS_LOOKUP_COLS)
        .or(filterStr)
        .limit(10);

      if (error) throw error;
      if (!data || data.length === 0) return [];

      const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
      const final = (data as Order[]).filter((o) => {
        const name = String(o.customer_name || '').toLowerCase();
        const orderId = String(o.order_id_erp || '').toLowerCase();
        const cpf = String(o.customer_cpf || '').toLowerCase();
        const cpfDigits = cpf.replace(/\D/g, '');
        const rawCpf1 = String((o as any).raw_json?.destinatario_cpf || '').toLowerCase();
        const rawCpf2 = String((o as any).raw_json?.cliente_cpf || '').toLowerCase();
        const rawCpf3 = String((o as any).raw_json?.cpf || '').toLowerCase();
        const rawDigits = [rawCpf1, rawCpf2, rawCpf3].join(' ').replace(/\D/g, '');
        const haystack = [name, orderId, cpf, rawCpf1, rawCpf2, rawCpf3].join(' ').trim();
        return tokens.every((t) => {
          const isNum = /^\d+$/.test(t);
          if (isNum) {
            return (
              cpfDigits.includes(t) ||
              rawDigits.includes(t) ||
              orderId.includes(t) ||
              cpf.includes(t)
            );
          }
          return haystack.includes(t);
        });
      });
      return final;
    } catch {
      return [];
    }
  };

  const handleSearch = async (term?: string, fromTyping: boolean = false) => {
    const q = (term ?? query).trim();
    if (!q) {
      if (!fromTyping) toast.error('Digite algo para pesquisar (pedido ou CPF)');
      return;
    }
    try {
      setLoading(true);
      setSelectedOrder(null);
      setRouteOrders([]);
      setWithdrawal(null);
      setAssemblies([]);
      setDeliveryReceiptsByRouteOrder({});
      setDeliveryReceiptUserNames({});
      setProofPdfLoadingByRouteOrder({});

      const results = await fetchOrders(q);
      if (results.length === 0) {
        if (!fromTyping) toast.error('Nenhum pedido encontrado');
        setOrders([]);
        setDeliveryReceiptsByRouteOrder({});
        setDeliveryReceiptUserNames({});
        setProofPdfLoadingByRouteOrder({});
        return;
      }
      setOrders(results);
      setSelectedOrder(results[0]);
    } catch (e: any) {
      console.error(e);
      toast.error('Erro ao buscar pedido');
    } finally {
      setLoading(false);
    }
  };

  const fetchUserNamesByIds = async (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)));
    if (uniqueIds.length === 0) return {} as Record<string, string>;

    const namesMap: Record<string, string> = {};

    // Tentativa direta (respeita RLS). Em perfis restritos pode vir vazio.
    const { data: directData, error: directError } = await supabase
      .from('users')
      .select('id, name')
      .in('id', uniqueIds);

    if (!directError && directData) {
      for (const row of directData as Array<{ id: string; name: string }>) {
        namesMap[String(row.id)] = String(row.name || '').trim();
      }
    }

    const missingIds = uniqueIds.filter((id) => !namesMap[id]);
    if (missingIds.length > 0) {
      // Fallback via RPC SECURITY DEFINER para cenários com RLS restrita.
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_users_names_by_ids', {
        p_user_ids: missingIds,
      });

      if (rpcError) {
        console.warn('[OrderLookup] Falha ao buscar nomes de usuários via RPC:', rpcError.message);
      } else {
        for (const row of (rpcData || []) as Array<{ id: string; name: string }>) {
          namesMap[String(row.id)] = String(row.name || '').trim();
        }
      }
    }

    const stillMissingIds = uniqueIds.filter((id) => !namesMap[id]);
    if (stillMissingIds.length > 0) {
      // Fallback extra sem migration: tenta mapear por list_drivers (SECURITY DEFINER já existente).
      const { data: driversRpcData, error: driversRpcError } = await supabase.rpc('list_drivers');
      if (driversRpcError) {
        console.warn('[OrderLookup] Falha ao buscar nomes via list_drivers:', driversRpcError.message);
      } else {
        for (const row of (driversRpcData || []) as Array<{ driver_id?: string; user_id?: string; name?: string }>) {
          const userId = String((row as any).user_id || '').trim();
          const name = String((row as any).name || '').trim();
          if (userId && name && stillMissingIds.includes(userId) && !namesMap[userId]) {
            namesMap[userId] = name;
          }
        }
      }
    }

    return namesMap;
  };

  const extractPersonNameFromRouteName = (routeName: string) => {
    const text = String(routeName || '').trim();
    if (!text) return '';

    // Exemplos:
    // "07/01-ROTA MOSSORÓ, ADRIANO-10:58"
    // "11/21- ROTA PARAU. THIAGO-11:22"
    const commaMatch = text.match(/,\s*([^-.,]+?)\s*(?:-\d{1,2}:\d{2})?$/);
    if (commaMatch) return String(commaMatch[1] || '').trim();

    const dotMatch = text.match(/\.\s*([^-.,]+?)\s*(?:-\d{1,2}:\d{2})?$/);
    if (dotMatch) return String(dotMatch[1] || '').trim();

    return '';
  };

  const reprintWithdrawalReceipt = async () => {
    if (!selectedOrder || !withdrawal) return;

    try {
      setWithdrawalActionLoading('receipt');
      const routeId = `withdrawal-${withdrawal.id}`;
      const routeName = `RETIRADA - ${new Date(withdrawal.withdrawn_at || new Date().toISOString()).toLocaleDateString('pt-BR')}`;
      const routeOrder = {
        id: withdrawal.id,
        route_id: routeId,
        order_id: String(selectedOrder.id),
        sequence: 1,
        status: 'delivered',
        delivered_at: withdrawal.withdrawn_at || new Date().toISOString(),
        delivery_observations: withdrawal.notes || `Conferente: ${withdrawal.responsible_name || '-'}`,
      } as any;

      const mappedOrder = mapOrderToPickupSheetOrder(selectedOrder, routeOrder);
      const pdfBytes = await DeliverySheetGenerator.generateDeliverySheet({
        route: {
          id: routeId,
          name: routeName,
          route_code: `RET-${String(withdrawal.id).slice(0, 8).toUpperCase()}`,
          driver_id: '',
          vehicle_id: '',
          conferente: withdrawal.registered_by_name || user?.name || user?.email || 'Não informado',
          observations: `Conferente: ${withdrawal.responsible_name}${withdrawal.notes ? `\nObs: ${withdrawal.notes}` : ''}`,
          status: 'completed',
          created_at: withdrawal.created_at,
          updated_at: withdrawal.updated_at,
          completed_at: withdrawal.withdrawn_at,
        } as any,
        routeOrders: [routeOrder],
        driver: {
          id: 'withdrawal',
          user_id: '',
          cpf: '',
          active: true,
          user: {
            id: '',
            email: '',
            name: 'Retirada pelo cliente',
            role: 'driver',
            active: true,
            created_at: withdrawal.created_at,
          },
        } as any,
        orders: [mappedOrder],
        generatedAt: new Date().toISOString(),
        teamName: 'Retirada pelo cliente',
        helperName: withdrawal.responsible_name,
        pickupResponsibleName: withdrawal.responsible_name,
        pickupRegisteredByName: withdrawal.registered_by_name || user?.name || user?.email || '-',
        pickupWithdrawnAt: withdrawal.withdrawn_at,
        pickupObservations: withdrawal.notes || '',
      }, 'Comprovante de Retirada');

      DeliverySheetGenerator.openPDFInNewTab(pdfBytes);
      toast.success('Comprovante de retirada reimpresso com sucesso!');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao reimprimir comprovante de retirada');
    } finally {
      setWithdrawalActionLoading(null);
    }
  };

  const reprintWithdrawalDanfe = async () => {
    if (!selectedOrder || !withdrawal) return;

    try {
      setWithdrawalActionLoading('danfe');
      const { data: orderData, error } = await supabase
        .from('orders')
        .select('danfe_base64')
        .eq('id', selectedOrder.id)
        .single();

      if (error) throw error;

      const base64 = String(orderData?.danfe_base64 || '');
      if (!base64.startsWith('JVBER')) {
        toast.error('Nenhuma nota fiscal encontrada para este pedido.');
        return;
      }

      const merged = await PDFDocument.create();
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const source = await PDFDocument.load(bytes);
      const pages = await merged.copyPages(source, source.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
      const out = await merged.save();
      DeliverySheetGenerator.openPDFInNewTab(out);
      toast.success('Nota fiscal reimpressa com sucesso!');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao reimprimir nota fiscal');
    } finally {
      setWithdrawalActionLoading(null);
    }
  };

  useEffect(() => {
    const fetchDetails = async () => {
      if (!selectedOrder) return;
      try {
        setLoading(true);
        setWithdrawal(null);
        // Query com vehicle via join (igual RouteCreation)
        const selectRouteOrder = '*, route:routes(*, route_code, vehicle:vehicles!vehicle_id(id, model, plate)), order:orders(id, order_id_erp)';

        // Primeiro tenta pelo order_id (uuid do pedido)
        const { data: roById, error: roErrById } = await supabase
          .from('route_orders')
          .select(selectRouteOrder)
          .eq('order_id', selectedOrder.id)
          .order('created_at', { ascending: false });
        if (roErrById) throw roErrById;
        let roData = roById || [];

        // Se não encontrar, tenta por outros pedidos com o mesmo order_id_erp
        if ((!roData || roData.length === 0) && selectedOrder.order_id_erp) {
          const { data: sameOrders, error: ordersErr } = await supabase
            .from('orders')
            .select('id')
            .eq('order_id_erp', selectedOrder.order_id_erp);
          if (ordersErr) throw ordersErr;
          const ids = (sameOrders || []).map((o: any) => o.id);
          if (ids.length) {
            const { data: roByErp, error: roErrByErp } = await supabase
              .from('route_orders')
              .select(selectRouteOrder)
              .in('order_id', ids)
              .order('created_at', { ascending: false });
            if (roErrByErp) throw roErrByErp;
            roData = roByErp || [];
          }
        }

        // Enriquecer com driver (mesma lógica do RouteCreation.tsx)
        const { data: withdrawalData, error: withdrawalError } = await supabase
          .from('order_withdrawals')
          .select('*')
          .eq('order_id', selectedOrder.id)
          .maybeSingle();
        if (withdrawalError) throw withdrawalError;
        setWithdrawal((withdrawalData || null) as WithdrawalInfo | null);

        if (roData && roData.length > 0) {
          const driverIds = Array.from(new Set((roData as any[]).map((ro: any) => ro.route?.driver_id).filter(Boolean)));

          if (driverIds.length > 0) {
            const { data: drvBulk } = await supabase
              .from('drivers')
              .select('id, user_id, active, name')
              .in('id', driverIds);

            const listDriversByDriverId: Record<string, string> = {};
            const { data: listDriversData, error: listDriversError } = await supabase.rpc('list_drivers');
            if (listDriversError) {
              console.warn('[OrderLookup] Falha ao buscar nomes via list_drivers:', listDriversError.message);
            } else {
              for (const row of (listDriversData || []) as Array<{ driver_id?: string; name?: string }>) {
                const driverId = String((row as any).driver_id || '').trim();
                const driverName = String((row as any).name || '').trim();
                if (driverId && driverName) {
                  listDriversByDriverId[driverId] = driverName;
                }
              }
            }

            if (drvBulk && drvBulk.length > 0) {
              const userIds = Array.from(new Set(drvBulk.map((d: any) => String(d.user_id)).filter(Boolean))) as string[];
              const userNamesMap = await fetchUserNamesByIds(userIds);
              const enrichedDrivers = drvBulk.map((d: any) => {
                const resolvedName =
                  userNamesMap[String(d.user_id)] ||
                  listDriversByDriverId[String(d.id)] ||
                  d?.name ||
                  '';
                return {
                  ...d,
                  user: resolvedName ? { id: d.user_id, name: resolvedName } : null,
                };
              });
              const mapDrv = new Map<string, any>(enrichedDrivers.map((d: any) => [String(d.id), d]));

              // Enriquecer cada route_order com driver
              roData = (roData as any[]).map((ro: any) => {
                const route = ro.route || {};
                const driverId = String(route.driver_id || '').trim();
                const d = driverId ? mapDrv.get(driverId) : null;
                const fallbackName = driverId
                  ? (listDriversByDriverId[driverId] || extractPersonNameFromRouteName(route.name || ''))
                  : extractPersonNameFromRouteName(route.name || '');
                return {
                  ...ro,
                  route: {
                    ...route,
                    driver: d,
                    driver_name: d?.user?.name || d?.name || fallbackName || ''
                  }
                };
              });
            } else {
              // Se drivers vier vazio (dado legado/inconsistente), tenta ao menos resolver pelo list_drivers.
              roData = (roData as any[]).map((ro: any) => {
                const route = ro.route || {};
                const driverId = String(route.driver_id || '').trim();
                const fallbackName = driverId
                  ? (listDriversByDriverId[driverId] || extractPersonNameFromRouteName(route.name || ''))
                  : extractPersonNameFromRouteName(route.name || '');
                return {
                  ...ro,
                  route: {
                    ...route,
                    driver_name: fallbackName || ''
                  }
                };
              });
            }
          }

          // Ordenar por data
          roData = (roData as any[]).sort((a: any, b: any) => {
            const da = new Date(a.delivered_at || a.updated_at || a.created_at || 0).getTime();
            const db = new Date(b.delivered_at || b.updated_at || b.created_at || 0).getTime();
            return db - da;
          });
        }

        setRouteOrders(roData as RouteOrderInfo[] || []);

        const routeOrderIds = Array.from(new Set((roData || []).map((r: any) => String(r.id || '').trim()).filter(Boolean)));
        let receiptsQuery = supabase
          .from('delivery_receipts')
          .select(`
            id,
            route_order_id,
            delivered_by_user_id,
            delivered_at_server,
            device_timestamp,
            gps_lat,
            gps_lng,
            gps_accuracy_m,
            gps_status,
            gps_failure_reason,
            recipient_name,
            recipient_relation,
            recipient_notes,
            photo_count,
            sync_status,
            network_mode,
            proof_hash,
            created_at
          `)
          .order('delivered_at_server', { ascending: false });

        if (routeOrderIds.length > 0) {
          receiptsQuery = receiptsQuery.in('route_order_id', routeOrderIds);
        } else {
          receiptsQuery = receiptsQuery.eq('order_id', selectedOrder.id);
        }

        const { data: receiptsData, error: receiptsError } = await receiptsQuery;

        if (receiptsError) {
          console.warn('[OrderLookup] Falha ao carregar comprovantes digitais:', receiptsError.message);
          setDeliveryReceiptsByRouteOrder({});
          setDeliveryReceiptUserNames({});
          setProofPdfLoadingByRouteOrder({});
        } else {
          const byRouteOrder: Record<string, DeliveryReceiptInfo> = {};
          for (const row of (receiptsData || []) as DeliveryReceiptInfo[]) {
            if (!row.route_order_id) continue;
            if (!byRouteOrder[row.route_order_id]) {
              byRouteOrder[row.route_order_id] = row;
            }
          }
          setDeliveryReceiptsByRouteOrder(byRouteOrder);

          const userIds = Array.from(
            new Set(
              Object.values(byRouteOrder)
                .map((r) => String(r.delivered_by_user_id || '').trim())
                .filter(Boolean)
            )
          );

          if (userIds.length > 0) {
            const namesMap = await fetchUserNamesByIds(userIds);
            setDeliveryReceiptUserNames(namesMap);
          } else {
            setDeliveryReceiptUserNames({});
          }
        }

        const { data: apData } = await supabase
          .from('assembly_products')
          .select('*, assembly_route:assembly_routes(*)')
          .eq('order_id', selectedOrder.id)
          .order('created_at', { ascending: false });

        let finalAssemblies = (apData || []) as any[];

        // Buscar nomes dos montadores manualmente
        const asmIds = Array.from(new Set(finalAssemblies.map(a => a.assembly_route?.assembler_id).filter(Boolean)));
        if (asmIds.length > 0) {
          const uMap = await fetchUserNamesByIds(asmIds.map((id: any) => String(id)));

          finalAssemblies = finalAssemblies.map(a => ({
            ...a,
            assembly_route: {
              ...(a.assembly_route || {}),
              assembler: {
                name: a.assembly_route?.assembler_id
                  ? (uMap[a.assembly_route.assembler_id] || extractPersonNameFromRouteName(a.assembly_route?.name || ''))
                  : extractPersonNameFromRouteName(a.assembly_route?.name || '')
              }
            }
          }));
        } else {
          finalAssemblies = finalAssemblies.map(a => ({
            ...a,
            assembly_route: {
              ...(a.assembly_route || {}),
              assembler: { name: extractPersonNameFromRouteName(a.assembly_route?.name || '') }
            }
          }));
        }

        setAssemblies(finalAssemblies as AssemblyInfo[]);
      } catch (err) {
        console.error(err);
        toast.error('Erro ao carregar detalhes do pedido');
      } finally {
        setLoading(false);
      }
    };
    fetchDetails();
  }, [selectedOrder]);

  // Etapa do processo (exibida no cabeçalho do card)
  const processStage = useMemo(() => {
    if (withdrawal) return 'withdrawn';
    const latestRO = routeOrders[0];
    const routeStatus = latestRO?.route?.status;

    if (!latestRO) return 'imported'; // Nenhuma rota atribuída
    if (routeStatus === 'in_progress') return 'in_route'; // Rota em andamento
    if (routeStatus === 'pending' || routeStatus === 'assigned') return 'separating'; // Em separação
    if (routeStatus === 'completed') return 'completed'; // Rota finalizada
    return 'imported';
  }, [routeOrders, withdrawal]);

  // Status específico do pedido (exibido dentro do card da rota)
  const derivedStatus = useMemo(() => {
    if (withdrawal) return 'pickup';
    const base = selectedOrder?.status || '';
    const latestRO = routeOrders[0];
    const routeStatus = latestRO?.route?.status;
    const roStatus = latestRO?.status;
    const routeName = String(latestRO?.route?.name || '');

    let entrega = base;
    if (isLegacyPickupRouteName(routeName)) {
      entrega = 'pickup';
    }
    else if (roStatus === 'returned' || selectedOrder?.return_flag) entrega = 'returned';
    else if (routeStatus === 'in_progress') entrega = 'in_progress';
    else if (roStatus === 'delivered') entrega = 'delivered';
    else if (routeStatus === 'pending') entrega = 'pending';
    return entrega;
  }, [selectedOrder, routeOrders, withdrawal]);

  const assemblyStatus = useMemo(() => {
    if (!assemblies.length) return 'none';
    const firstAssembly = assemblies[0];
    const status = String(firstAssembly.status || '').toLowerCase();

    if (status === 'completed') return 'completed';
    if (status === 'cancelled') return 'cancelled';
    if (firstAssembly.assembly_route_id || (firstAssembly as any).assembly_route?.id) return 'in_route';
    return 'none';
  }, [assemblies]);

  const formatDate = (d?: string | null) => {
    if (!d) return '-';
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? '-' : dt.toLocaleDateString('pt-BR');
  };

  const formatDateTime = (d?: string | null) => {
    if (!d) return '-';
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? '-' : dt.toLocaleString('pt-BR');
  };

  const normalizeText = (value: unknown) => {
    if (value === null || typeof value === 'undefined') return '';
    return String(value).trim();
  };

  const normalizeReturnReason = (value: unknown) => {
    if (!value) return '';
    if (typeof value === 'object') {
      const reasonFromObject = normalizeText((value as any).reason);
      if (reasonFromObject) return reasonFromObject;
    }
    return normalizeText(value);
  };

  const normalizeCompareText = (value: string) => {
    return normalizeText(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();
  };

  const isOtherReasonValue = (value: string) => {
    const normalized = normalizeCompareText(value);
    return normalized === 'outro' || normalized === 'other' || normalized === '99';
  };

  const buildReturnDisplay = (reasonInput: unknown, notesInput: unknown) => {
    const rawReason = normalizeReturnReason(reasonInput);
    const rawNotes = normalizeText(notesInput);

    // Se o motivo for "Outro", mostramos o texto digitado como motivo principal.
    const displayReason = isOtherReasonValue(rawReason) && rawNotes
      ? rawNotes
      : (rawReason || rawNotes);

    // Evita repetir exatamente o mesmo texto em "Motivo" e "Observação".
    const sameReasonAndNotes = Boolean(displayReason) &&
      normalizeCompareText(displayReason) === normalizeCompareText(rawNotes);

    return {
      reason: displayReason,
      notes: rawNotes && !sameReasonAndNotes ? rawNotes : '',
    };
  };

  const normalizeWithdrawalNotes = (notesInput: unknown) => {
    const notes = normalizeText(notesInput);
    return notes ? notes.replace(/\s+/g, ' ').trim() : '';
  };
  const parseAssemblyReturnDetails = (assembly: AssemblyInfo) => {
    const directReason = normalizeReturnReason(assembly.return_reason);
    const observations = normalizeText(assembly.observations);
    let reasonFromObs = '';
    let notesFromObs = '';

    if (observations) {
      const matchParens = observations.match(/^\(Retorno:\s*(.+?)\)\s*(.*)/i);
      if (matchParens) {
        reasonFromObs = normalizeText(matchParens[1]);
        notesFromObs = normalizeText(matchParens[2]);
      } else {
        const matchSimple = observations.match(/^Retorno:\s*(.+)$/i);
        if (matchSimple) {
          reasonFromObs = normalizeText(matchSimple[1]);
        } else {
          notesFromObs = observations;
        }
      }
    }

    return {
      reason: directReason || reasonFromObs,
      notes: notesFromObs,
    };
  };

  const asNumber = (value: unknown): number | null => {
    if (value === null || typeof value === 'undefined' || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const getProofStatus = (receipt?: DeliveryReceiptInfo) => {
    if (!receipt) {
      return {
        label: 'Sem comprovante',
        className: 'bg-gray-100 text-gray-600 border-gray-200',
      };
    }

    if (String(receipt.sync_status || '').toLowerCase() === 'pending_sync') {
      return {
        label: 'Pendente sync',
        className: 'bg-amber-100 text-amber-700 border-amber-200',
      };
    }

    const hasRecipient = Boolean(String(receipt.recipient_name || '').trim()) && Boolean(String(receipt.recipient_relation || '').trim());
    const hasPhoto = Number(receipt.photo_count || 0) >= 1;
    const gpsOk = String(receipt.gps_status || '').toLowerCase() === 'ok';
    const hasGpsReason = Boolean(String(receipt.gps_failure_reason || '').trim());

    if (hasRecipient && hasPhoto && (gpsOk || hasGpsReason)) {
      return {
        label: 'Completo',
        className: 'bg-green-100 text-green-700 border-green-200',
      };
    }

    return {
      label: 'Parcial',
      className: 'bg-blue-100 text-blue-700 border-blue-200',
    };
  };

  const openMapFromReceipt = (receipt?: DeliveryReceiptInfo) => {
    if (!receipt) return;
    const lat = asNumber(receipt.gps_lat);
    const lng = asNumber(receipt.gps_lng);
    if (lat === null || lng === null) {
      toast.error('Comprovante sem coordenadas GPS');
      return;
    }
    window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank', 'noopener,noreferrer');
  };

  const fetchDeliveryPhotosForPdf = async (routeOrderId: string) => {
    const { data, error } = await supabase
      .from('delivery_photos')
      .select('id, storage_path, file_name, photo_type, created_at')
      .eq('route_order_id', routeOrderId)
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('[OrderLookup] Falha ao buscar fotos para PDF do comprovante:', error.message);
      return [];
    }

    const rows = (data || []) as DeliveryPhotoRow[];
    const withUrls = await Promise.all(
      rows.map(async (photo) => {
        const { data: signed } = await supabase.storage
          .from('delivery-photos')
          .createSignedUrl(photo.storage_path, 3600);

        return {
          id: photo.id,
          url: signed?.signedUrl || '',
          label: `${photo.photo_type || 'foto'}${photo.file_name ? ` - ${photo.file_name}` : ''}`,
          createdAt: photo.created_at || null,
        };
      })
    );

    return withUrls.filter((p) => p.url);
  };

  const generateProofPdf = async (ro: RouteOrderInfo, receipt?: DeliveryReceiptInfo) => {
    if (!selectedOrder) return;

    const routeOrderId = String(ro.id);
    setProofPdfLoadingByRouteOrder((prev) => ({ ...prev, [routeOrderId]: true }));

    try {
      let currentReceipt = receipt;
      if (!currentReceipt) {
        const { data: fetchedReceipts, error: receiptError } = await supabase
          .from('delivery_receipts')
          .select(`
            id,
            route_order_id,
            delivered_by_user_id,
            delivered_at_server,
            device_timestamp,
            gps_lat,
            gps_lng,
            gps_accuracy_m,
            gps_status,
            gps_failure_reason,
            recipient_name,
            recipient_relation,
            recipient_notes,
            photo_count,
            sync_status,
            network_mode,
            proof_hash,
            created_at
          `)
          .eq('route_order_id', routeOrderId)
          .order('delivered_at_server', { ascending: false })
          .limit(1);

        if (receiptError) {
          console.warn('[OrderLookup] Falha ao buscar comprovante para PDF:', receiptError.message);
        } else if (fetchedReceipts && fetchedReceipts.length > 0) {
          currentReceipt = fetchedReceipts[0] as DeliveryReceiptInfo;
          setDeliveryReceiptsByRouteOrder((prev) => ({ ...prev, [routeOrderId]: currentReceipt as DeliveryReceiptInfo }));
        }
      }

      if (!currentReceipt) {
        toast.error('Ainda nao existe comprovante digital para esta entrega');
        return;
      }

      const photos = await fetchDeliveryPhotosForPdf(routeOrderId);
      const driverName = (ro.route as any)?.driver_name || (ro.route as any)?.driver?.user?.name || (ro.route as any)?.driver?.name || '';
      const vehicleInfo = ro.route?.vehicle
        ? `${(ro.route?.vehicle as any)?.model || ''} ${(ro.route?.vehicle as any)?.plate || ''}`.trim()
        : '';
      const proofUserId = String(currentReceipt.delivered_by_user_id || '').trim();
      const deliveredByName = proofUserId ? (deliveryReceiptUserNames[proofUserId] || driverName || '-') : (driverName || '-');

      const pdfBytes = await DeliveryProofPdfGenerator.generate({
        order: selectedOrder,
        route: {
          routeName: ro.route?.name || '-',
          routeCode: (ro.route as any)?.route_code || null,
          routeId: ro.route_id,
          routeOrderId: ro.id,
          routeOrderStatus: ro.status,
          deliveredAt: ro.delivered_at || null,
          driverName: driverName || '-',
          vehicleInfo: vehicleInfo || '-',
        },
        receipt: {
          id: currentReceipt.id,
          deliveredAtServer: currentReceipt.delivered_at_server || currentReceipt.created_at || null,
          deviceTimestamp: currentReceipt.device_timestamp || null,
          recipientName: currentReceipt.recipient_name || null,
          recipientRelation: currentReceipt.recipient_relation || null,
          recipientNotes: currentReceipt.recipient_notes || null,
          gpsStatus: currentReceipt.gps_status || null,
          gpsLat: asNumber(currentReceipt.gps_lat),
          gpsLng: asNumber(currentReceipt.gps_lng),
          gpsAccuracyM: asNumber(currentReceipt.gps_accuracy_m),
          gpsFailureReason: currentReceipt.gps_failure_reason || null,
          syncStatus: currentReceipt.sync_status || null,
          networkMode: currentReceipt.network_mode || null,
          photoCount: Number(currentReceipt.photo_count || photos.length || 0),
          proofHash: currentReceipt.proof_hash || null,
        },
        deliveredByName,
        photos,
        generatedAt: new Date().toISOString(),
      });

      DeliveryProofPdfGenerator.openPDFInNewTab(pdfBytes);
    } catch (error) {
      console.error('[OrderLookup] Erro ao gerar PDF do comprovante:', error);
      toast.error('Erro ao gerar PDF do comprovante digital');
    } finally {
      setProofPdfLoadingByRouteOrder((prev) => ({ ...prev, [routeOrderId]: false }));
    }
  };

  const statusLabelEntrega: Record<string, string> = {
    pending: 'Pendente',
    imported: 'Importado',
    assigned: 'Em separação',
    in_progress: 'Em rota',
    delivered: 'Entregue',
    returned: 'Retornado',
    pickup: 'Retirado pelo cliente',
  };

  const statusLabelMontagem: Record<string, string> = {
    pending: 'Aguardando rota',
    assigned: 'Em rota',
    in_progress: 'Em rota',
    in_route: 'Em rota',
    completed: 'Concluído',
    cancelled: 'Retornado',
    none: 'Aguardando rota',
  };

  // Labels para etapa do processo (cabeçalho do card)
  const processStageLabel: Record<string, string> = {
    imported: 'Pedido Importado do ERP',
    separating: 'Em Separação',
    in_route: 'Em Rota',
    completed: 'Rota Finalizada',
    withdrawn: 'Retirado pelo cliente',
  };

  // Cores/estilos para cada etapa do processo
  const processStageStyle: Record<string, string> = {
    imported: 'text-gray-600',
    separating: 'text-orange-600',
    in_route: 'text-blue-600',
    completed: 'text-green-600',
    withdrawn: 'text-purple-600',
  };

  // Labels para status específico do pedido (dentro do card)
  const orderStatusLabel: Record<string, string> = {
    pending: 'Pendente',
    in_progress: 'Pendente',
    delivered: 'Entregue',
    returned: 'Retornado',
    pickup: 'Retirado pelo cliente',
  };

  return (
    <div className="w-full">
      <main className="w-full p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex flex-col gap-4">
          {isConsultor && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleLogout}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-semibold flex items-center justify-center gap-2"
              >
                <LogOut className="h-4 w-4" />
                Sair
              </button>
            </div>
          )}
          <div className="flex flex-col md:flex-row gap-3 md:items-end">
            <div className="flex-1">
              <label className="text-xs font-bold text-gray-500 uppercase">Busca Rápida</label>
              <input
                type="text"
                value={query}
                onChange={async (e) => {
                  const val = e.target.value;
                  setQuery(val);
                  if (val.trim().length >= 3) {
                    await handleSearch(val, true);
                  } else {
                    setOrders([]);
                    setSelectedOrder(null);
                    setRouteOrders([]);
                    setWithdrawal(null);
                    setAssemblies([]);
                    setDeliveryReceiptsByRouteOrder({});
                    setDeliveryReceiptUserNames({});
                    setProofPdfLoadingByRouteOrder({});
                  }
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch(query)}
                placeholder="Pedido, cliente ou CPF..."
                className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              onClick={() => handleSearch(query)}
              disabled={loading}
              className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Buscar
            </button>
          </div>
          {orders.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {orders.map(o => (
                <button
                  key={o.id}
                  onClick={() => setSelectedOrder(o)}
                  className={`px-3 py-2 rounded-lg border text-sm ${selectedOrder?.id === o.id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-gray-50 text-gray-700'}`}
                >
                  {o.order_id_erp} — {o.customer_name}
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedOrder && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                <p className="text-xs font-semibold text-gray-500 uppercase">Pedido</p>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-bold text-gray-900">{selectedOrder.order_id_erp}</p>
                  {/* Badge FULL */}
                  {(() => {
                    const raw = selectedOrder.raw_json || {};
                    const isFullFlag = String(raw.tem_frete_full || (selectedOrder as any).tem_frete_full || '').toUpperCase() === 'SIM';
                    const obsInternas = String(raw.observacoes_internas || (selectedOrder as any).observacoes_internas || '').toLowerCase();
                    const hasKeyword = obsInternas.includes('*frete full*');

                    if (isFullFlag || hasKeyword) {
                      return (
                        <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 text-xs font-bold">
                          FULL
                        </span>
                      );
                    }
                    return null;
                  })()}
                  <CopyButton text={selectedOrder.order_id_erp} label="Número do pedido copiado!" />
                </div>
                <p className="text-sm text-gray-600 mt-1">{selectedOrder.customer_name}</p>
                {/* CPF do cliente */}
                <div className="mt-2 text-sm text-gray-600 flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-500">CPF:</span>
                  <span>{selectedOrder.customer_cpf || (selectedOrder.raw_json as any)?.destinatario_cpf || (selectedOrder.raw_json as any)?.cliente_cpf || '-'}</span>
                  {(selectedOrder.customer_cpf || (selectedOrder.raw_json as any)?.destinatario_cpf || (selectedOrder.raw_json as any)?.cliente_cpf) && (
                    <CopyButton text={selectedOrder.customer_cpf || (selectedOrder.raw_json as any)?.destinatario_cpf || (selectedOrder.raw_json as any)?.cliente_cpf} label="CPF copiado!" />
                  )}
                </div>
                {/* Telefone com link WhatsApp */}
                <div className="mt-2 text-sm text-gray-600 flex items-center gap-2">
                  <Phone className="h-4 w-4 text-gray-400" />
                  <span>{selectedOrder.phone || '-'}</span>
                  {selectedOrder.phone && (
                    <a
                      href={`https://wa.me/55${selectedOrder.phone.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 p-1.5 rounded-full bg-green-100 hover:bg-green-200 transition-colors"
                      title="Abrir conversa no WhatsApp"
                    >
                      <svg className="h-4 w-4 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                      </svg>
                    </a>
                  )}
                </div>
                {/* Vendedor */}
                {(() => {
                  const raw = selectedOrder.raw_json || {};
                  const vendedor = raw.nome_vendedor || (selectedOrder as any).nome_vendedor;
                  if (vendedor) {
                    return (
                      <div className="mt-2 text-sm text-gray-600 flex items-center gap-2">
                        <Briefcase className="h-4 w-4 text-gray-400" />
                        <span className="text-xs font-medium text-gray-500">Vendedor:</span>
                        <span className="font-medium uppercase">{vendedor}</span>
                      </div>
                    );
                  }
                  return null;
                })()}
                <div className="mt-2 text-sm text-gray-600 flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-gray-400 mt-0.5" />
                  <span>{selectedOrder.address_json?.street}, {selectedOrder.address_json?.neighborhood} - {selectedOrder.address_json?.city}</span>
                </div>
                <div className="mt-3 flex gap-2 flex-wrap text-xs">
                  {selectedOrder.return_flag && (
                    <span className="px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Retornado
                    </span>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {(() => {
                    const raw = selectedOrder.raw_json || {};
                    const saleDate = (selectedOrder as any).data_venda || raw.data_venda;
                    if (!saleDate) return null;
                    return <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700 border border-gray-200 font-medium">Venda: {formatDate(saleDate)}</span>;
                  })()}
                  {(() => {
                    const raw = selectedOrder.raw_json || {};
                    const prevEntrega = selectedOrder.previsao_entrega || raw.previsao_entrega || selectedOrder.delivery_date;
                    const prevMontagem = selectedOrder.previsao_montagem;

                    return (
                      <>
                        {prevEntrega && (
                          <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200" title="Previsão de Entrega">
                            Prev. Entrega: {formatDate(prevEntrega)}
                          </span>
                        )}

                        {prevMontagem ? (
                          <span className="px-2 py-1 rounded-full bg-purple-50 text-purple-700 border border-purple-200" title="Previsão Final com Montagem">
                            Prev. Montagem: {formatDate(prevMontagem)}
                          </span>
                        ) : (
                          <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-500 border border-gray-200" title="Este pedido não possui previsão de montagem">
                            Sem Montagem
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* Botão Ver Observações */}
                {(() => {
                  const raw = selectedOrder.raw_json || {};
                  const obsInternas = raw.observacoes_internas || (selectedOrder as any).observacoes_internas;
                  const obsPublicas = raw.observacoes_publicas || (selectedOrder as any).observacoes_publicas;
                  if (!obsInternas && !obsPublicas) return null;

                  return (
                    <>
                      <button
                        onClick={() => setShowObservations(!showObservations)}
                        className="mt-3 flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Ver Observações</span>
                        {showObservations ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>

                      {showObservations && (
                        <div className="mt-2 space-y-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                          {obsInternas && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Obs. Internas</p>
                              <p className="text-xs text-gray-700 whitespace-pre-wrap">{obsInternas}</p>
                            </div>
                          )}
                          {obsPublicas && (
                            <div className={obsInternas ? 'pt-2 border-t border-gray-200' : ''}>
                              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Obs. Públicas</p>
                              <p className="text-xs text-gray-700 whitespace-pre-wrap">{obsPublicas}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <Truck className={`h-5 w-5 ${processStageStyle[processStage] || 'text-blue-600'}`} />
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase">Entrega</p>
                    <p className={`text-sm font-bold capitalize ${processStageStyle[processStage] || 'text-gray-900'}`}>
                      {processStageLabel[processStage] || 'Pedido Importado do ERP'}
                    </p>
                  </div>
                </div>
                {/* ... Delivery Card Logic ... */}
                {withdrawal ? (
                  <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 space-y-2">
                    <p className="text-xs text-purple-800">
                      <span className="font-semibold">Conferente:</span> {withdrawal.responsible_name || '-'}
                    </p>
                    <p className="text-xs text-purple-800">
                      <span className="font-semibold">Data:</span> {formatDateTime(withdrawal.withdrawn_at)}
                    </p>
                    <p className="text-xs text-purple-800">
                      <span className="font-semibold">Registrado por:</span> {withdrawal.registered_by_name || withdrawal.registered_by_user_id || '-'}
                    </p>
                    {withdrawal.source !== 'legacy_route' && (() => {
                      const normalizedNotes = normalizeWithdrawalNotes(withdrawal.notes);
                      if (!normalizedNotes) return null;
                      return (
                        <p className="text-xs text-purple-800">
                          <span className="font-semibold">Obs.:</span> {normalizedNotes}
                        </p>
                      );
                    })()}
                    {withdrawal.source === 'legacy_route' && (
                      <p className="text-[11px] text-purple-700">
                        Origem: fluxo legado de retirada.
                      </p>
                    )}
                    <div className="pt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={reprintWithdrawalReceipt}
                        disabled={withdrawalActionLoading !== null}
                        className="inline-flex items-center rounded-lg border border-purple-200 bg-white px-3 py-2 text-xs font-semibold text-purple-700 transition-colors hover:bg-purple-100 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {withdrawalActionLoading === 'receipt' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <FileText className="mr-2 h-3.5 w-3.5" />}
                        Reimprimir comprovante
                      </button>
                      <button
                        type="button"
                        onClick={reprintWithdrawalDanfe}
                        disabled={withdrawalActionLoading !== null}
                        className="inline-flex items-center rounded-lg border border-purple-200 bg-white px-3 py-2 text-xs font-semibold text-purple-700 transition-colors hover:bg-purple-100 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {withdrawalActionLoading === 'danfe' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />}
                        Reimprimir nota fiscal
                      </button>
                    </div>
                  </div>
                ) : routeOrders.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    {derivedStatus === 'delivered'
                      ? 'Entregue, mas rota não foi encontrada no histórico.'
                      : 'Aguardando atribuição a uma rota de entrega.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {routeOrders.map((ro) => {
                      // Calcular status específico deste pedido nesta rota
                      const orderStatus = ro.status === 'returned' ? 'returned'
                        : ro.status === 'delivered' ? 'delivered'
                          : 'pending';
                      const returnInfo = buildReturnDisplay(
                        (ro as any)?.return_reason || (selectedOrder as any)?.last_return_reason,
                        (ro as any)?.return_notes || (selectedOrder as any)?.last_return_notes
                      );
                      const returnReason = returnInfo.reason;
                      const returnNotes = returnInfo.notes;
                      const receipt = deliveryReceiptsByRouteOrder[ro.id];
                      const proofStatus = getProofStatus(receipt);
                      const proofUserId = String(receipt?.delivered_by_user_id || '').trim();
                      const proofUserName = proofUserId ? (deliveryReceiptUserNames[proofUserId] || '-') : '-';
                      const gpsLat = asNumber(receipt?.gps_lat);
                      const gpsLng = asNumber(receipt?.gps_lng);
                      const hasGpsPoint = gpsLat !== null && gpsLng !== null;
                      const isGeneratingProofPdf = proofPdfLoadingByRouteOrder[ro.id] === true;

                      return (
                        <div key={ro.id} className="border border-gray-100 rounded-lg p-3 relative group hover:border-blue-200 transition-colors">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-sm font-semibold text-gray-900">{ro.route?.name || 'Rota sem nome'}</p>
                              {(ro.route?.route_code || ro.route_id) && (
                                <p className="text-[10px] items-center text-gray-400 font-mono mt-0.5">
                                  ID: {ro.route?.route_code || ro.route_id?.slice(0, 8) + '...'}
                                </p>
                              )}
                            </div>
                            {/* Status do pedido como badge */}
                            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${orderStatus === 'delivered' ? 'bg-green-100 text-green-700 border border-green-200'
                              : orderStatus === 'returned' ? 'bg-red-100 text-red-700 border border-red-200'
                                : 'bg-yellow-100 text-yellow-700 border border-yellow-200'
                              }`}>
                              {orderStatusLabel[orderStatus] || 'Pendente'}
                            </span>
                          </div>

                          <p className="text-xs text-gray-500 mt-2">Motorista: {(ro.route as any)?.driver_name || (ro.route as any)?.driver?.user?.name || (ro.route as any)?.driver?.name || '-'}</p>
                          <p className="text-xs text-gray-500">Veículo: {ro.route?.vehicle ? `${(ro.route?.vehicle as any)?.model || ''} ${(ro.route?.vehicle as any)?.plate || ''}`.trim() || '-' : '-'}</p>
                          {ro.status === 'delivered' && (
                            <div className="flex items-center gap-2 mt-1">
                              <p className="text-xs text-green-600 font-medium">
                                Entregue em: {ro.delivered_at ? formatDate(ro.delivered_at) : formatDate(ro.route?.updated_at)}
                              </p>
                            </div>
                          )}
                          {ro.status === 'returned' && (
                            <div className="flex items-center gap-2 mt-1">
                              <p className="text-xs text-red-600 font-medium">
                                Retornado em: {formatDateTime(ro.returned_at || ro.delivered_at || ro.route?.updated_at)}
                              </p>
                            </div>
                          )}
                          {ro.status === 'returned' && (returnReason || returnNotes) && (
                            <div className="mt-2 p-2 rounded-lg border border-red-200 bg-red-50 space-y-1">
                              {returnReason && (
                                <p className="text-xs text-red-700">
                                  <span className="font-semibold">Motivo do retorno:</span> {returnReason}
                                </p>
                              )}
                              {returnNotes && (
                                <p className="text-xs text-red-700">
                                  <span className="font-semibold">Observação:</span> {returnNotes}
                                </p>
                              )}
                            </div>
                          )}
                          {(ro.status === 'delivered' || ro.status === 'returned') && (
                            <div className="mt-2 p-2 rounded-lg border border-gray-200 bg-gray-50">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-semibold text-gray-700 uppercase">Comprovante digital</p>
                                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${proofStatus.className}`}>
                                  {proofStatus.label}
                                </span>
                              </div>

                              {receipt ? (
                                <div className="mt-2 space-y-1">
                                  <p className="text-xs text-gray-600">
                                    Servidor: <span className="font-medium text-gray-800">{formatDateTime(receipt.delivered_at_server || receipt.created_at)}</span>
                                  </p>
                                  <p className="text-xs text-gray-600">
                                    Recebedor: <span className="font-medium text-gray-800">{receipt.recipient_name || '-'}</span>
                                    {receipt.recipient_relation ? ` (${receipt.recipient_relation})` : ''}
                                  </p>
                                  <p className="text-xs text-gray-600">
                                    Entregador: <span className="font-medium text-gray-800">{proofUserName}</span>
                                  </p>
                                  <p className="text-xs text-gray-600">
                                    Fotos: <span className="font-medium text-gray-800">{Number(receipt.photo_count || 0)}</span>
                                  </p>
                                  {hasGpsPoint ? (
                                    <p className="text-xs text-gray-600">
                                      GPS: <span className="font-medium text-gray-800">{gpsLat?.toFixed(5)}, {gpsLng?.toFixed(5)}</span>
                                      {receipt.gps_accuracy_m ? ` (±${Math.round(Number(receipt.gps_accuracy_m))}m)` : ''}
                                    </p>
                                  ) : (
                                    <p className="text-xs text-amber-700">
                                      GPS: sem coordenadas
                                      {receipt.gps_failure_reason ? ` (motivo: ${receipt.gps_failure_reason})` : ''}
                                    </p>
                                  )}
                                  {!!receipt.recipient_notes && (
                                    <p className="text-xs text-gray-600">
                                      Obs. recebedor: <span className="font-medium text-gray-800">{receipt.recipient_notes}</span>
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <p className="mt-2 text-xs text-gray-500">
                                  Este pedido ainda nao possui comprovante digital gravado para esta rota.
                                </p>
                              )}

                              <div className="mt-2 flex items-center gap-2">
                                <DeliveryPhotosViewer routeOrderId={ro.id} size="sm" />
                                <button
                                  type="button"
                                  onClick={() => generateProofPdf(ro, receipt)}
                                  disabled={isGeneratingProofPdf}
                                  className="text-xs px-2 py-1 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                                >
                                  {isGeneratingProofPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                                  PDF
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openMapFromReceipt(receipt)}
                                  disabled={!hasGpsPoint}
                                  className="text-xs px-2 py-1 rounded border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  Abrir no mapa
                                </button>
                              </div>
                            </div>
                          )}
                          {(selectedOrder as any).import_source && (
                            <p className="text-xs text-gray-400 mb-2">
                              Origem: {(selectedOrder as any).import_source === 'avulsa' ? 'Avulsa' : 'Lote'}
                            </p>
                          )}

                          {!isConsultor && (
                            <button
                              onClick={() => {
                                try {
                                  if (ro.route_id) {
                                    localStorage.setItem('rc_selectedRouteId', String(ro.route_id));
                                    localStorage.setItem('rc_showRouteModal', '1');
                                    window.open('/admin/routes', '_blank');
                                  }
                                } catch { }
                              }}
                              className="w-full mt-1 text-xs px-2 py-1.5 rounded border border-blue-200 text-blue-700 hover:bg-blue-50 transition-colors flex items-center justify-center gap-1"
                            >
                              Detalhes da rota
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <Hammer className="h-5 w-5 text-purple-600" />
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase">Montagem</p>
                    <p className={`text-sm font-bold capitalize ${(assemblyStatus || '').toLowerCase() === 'cancelled' ? 'text-red-600' : 'text-gray-900'}`}>
                      {statusLabelMontagem[assemblyStatus] || statusLabelMontagem.none}
                    </p>
                  </div>
                </div>
                {assemblies.length === 0 ? (
                  <p className="text-sm text-gray-500">Nenhum romaneio de montagem.</p>
                ) : (
                  <div className="space-y-2">
                    {assemblies.map((ap) => {
                      const parsedAssemblyReturn = parseAssemblyReturnDetails(ap);
                      const assemblyReturnInfo = buildReturnDisplay(
                        parsedAssemblyReturn.reason || (selectedOrder as any)?.last_return_reason,
                        parsedAssemblyReturn.notes || (selectedOrder as any)?.last_return_notes
                      );
                      const assemblyReturnReason = assemblyReturnInfo.reason;
                      const assemblyReturnNotes = assemblyReturnInfo.notes;

                      return (
                      <div key={ap.id} className="border border-gray-100 rounded-lg p-3 hover:border-purple-200 transition-colors">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{ap.assembly_route?.name || 'Sem Rota'}</p>
                            {(ap.assembly_route?.route_code || ap.assembly_route_id) && (
                              <p className="text-[10px] items-center text-gray-400 font-mono mt-0.5">
                                ID: {ap.assembly_route?.route_code || ap.assembly_route_id?.slice(0, 8) + '...'}
                              </p>
                            )}
                          </div>
                        </div>

                        <p className="text-xs font-medium text-gray-700 mt-2 mb-1">{ap.product_name || 'Produto não identificado'}</p>
                        <p className="text-xs text-gray-500">Montador: {ap.assembly_route?.assembler?.name || '-'}</p>

                        {ap.status === 'completed' ? (
                          <p className="text-xs text-green-600 font-medium">Montado em: {formatDate(ap.completion_date || ap.assembly_date || ap.updated_at)}</p>
                        ) : ap.status === 'cancelled' ? (
                          <p className="text-xs text-red-600 font-medium">Retornado em: {formatDateTime(ap.returned_at || ap.updated_at)}</p>
                        ) : null}
                        {ap.status === 'cancelled' && (assemblyReturnReason || assemblyReturnNotes) && (
                          <div className="mt-2 p-2 rounded-lg border border-red-200 bg-red-50 space-y-1">
                            {assemblyReturnReason && (
                              <p className="text-xs text-red-700">
                                <span className="font-semibold">Motivo do retorno:</span> {assemblyReturnReason}
                              </p>
                            )}
                            {assemblyReturnNotes && (
                              <p className="text-xs text-red-700">
                                <span className="font-semibold">Observação:</span> {assemblyReturnNotes}
                              </p>
                            )}
                          </div>
                        )}
                        {(ap as any).import_source && (
                          <p className="text-xs text-gray-400 mb-2">
                            Origem: {(ap as any).import_source === 'avulsa' ? 'Avulsa' : 'Lote'}
                          </p>
                        )}

                        {!isConsultor && (
                          <button
                            onClick={() => {
                              try {
                                if (ap.assembly_route_id) {
                                  localStorage.setItem('am_selectedRouteId', String(ap.assembly_route_id));
                                  localStorage.setItem('am_showRouteModal', '1');
                                  window.open('/admin/assembly', '_blank');
                                }
                              } catch { }
                            }}
                            className="w-full mt-2 text-xs px-2 py-1.5 rounded border border-purple-200 text-purple-700 hover:bg-purple-50 transition-colors flex items-center justify-center gap-1"
                          >
                            Detalhes da rota
                          </button>
                        )}

                        {/* Botão Ver Fotos - TODOS podem ver (admin e consultor) */}
                        {(ap.status || '').toLowerCase() === 'completed' && (
                          <div className="mt-2">
                            <AssemblyPhotosViewer
                              assemblyProductId={ap.id}
                              size="sm"
                            />
                          </div>
                        )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="h-5 w-5 text-gray-600" />
                <p className="text-sm font-semibold text-gray-700">Itens</p>
              </div>
              {Array.isArray(selectedOrder.items_json) && selectedOrder.items_json.length > 0 ? (
                <div className="divide-y divide-gray-100">
                  {selectedOrder.items_json.map((it, idx) => (
                    <div key={idx} className="py-2 flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-gray-900">{it.name}</p>
                          {/* Badge de montagem ao lado do nome */}
                          {(['true', 'sim', '1'].includes(String(it.has_assembly || '').toLowerCase()) ||
                            ['true', 'sim', '1'].includes(String((it as any).produto_e_montavel || '').toLowerCase())) && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200 text-xs font-medium">
                                <Hammer className="h-3 w-3" />
                                Montagem
                              </span>
                            )}
                        </div>
                        <p className="text-xs text-gray-500">SKU: {it.sku}</p>
                      </div>
                      <div className="text-right text-sm text-gray-600">
                        <p>Qtd: {it.purchased_quantity}</p>
                        {it.location && <p className="text-xs text-gray-500">Local: {it.location}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">Itens não informados.</p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
