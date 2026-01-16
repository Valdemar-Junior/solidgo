import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, MapPin, Phone, Search, Truck, Hammer, FileText, AlertTriangle, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import { useAuthStore } from '../../stores/authStore';
import type { Order } from '../../types/database';
import { toast } from 'sonner';

interface RouteOrderInfo {
  id: string;
  route_id: string;
  status: string;
  sequence?: number;
  delivered_at?: string;
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
  updated_at?: string;
}

export default function OrderLookup() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [routeOrders, setRouteOrders] = useState<RouteOrderInfo[]>([]);
  const [assemblies, setAssemblies] = useState<AssemblyInfo[]>([]);

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

      const { data, error } = await supabase
        .from('orders')
        .select('*')
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
      setAssemblies([]);

      const results = await fetchOrders(q);
      if (results.length === 0) {
        if (!fromTyping) toast.error('Nenhum pedido encontrado');
        setOrders([]);
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

  useEffect(() => {
    const fetchDetails = async () => {
      if (!selectedOrder) return;
      try {
        setLoading(true);
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
        if (roData && roData.length > 0) {
          const driverIds = Array.from(new Set((roData as any[]).map((ro: any) => ro.route?.driver_id).filter(Boolean)));

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
                  .select('id, name')
                  .in('id', userIds);

                const mapU = new Map<string, any>((usersData || []).map((u: any) => [String(u.id), u]));
                const enrichedDrivers = drvBulk.map((d: any) => ({ ...d, user: mapU.get(String(d.user_id)) || null }));
                const mapDrv = new Map<string, any>(enrichedDrivers.map((d: any) => [String(d.id), d]));

                // Enriquecer cada route_order com driver
                roData = (roData as any[]).map((ro: any) => {
                  const route = ro.route || {};
                  const d = route.driver_id ? mapDrv.get(String(route.driver_id)) : null;
                  return {
                    ...ro,
                    route: {
                      ...route,
                      driver: d,
                      driver_name: d?.user?.name || d?.name || ''
                    }
                  };
                });
              }
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

        const { data: apData } = await supabase
          .from('assembly_products')
          .select('*, assembly_route:assembly_routes(*)')
          .eq('order_id', selectedOrder.id)
          .order('created_at', { ascending: false });

        let finalAssemblies = (apData || []) as any[];

        // Buscar nomes dos montadores manualmente
        const asmIds = Array.from(new Set(finalAssemblies.map(a => a.assembly_route?.assembler_id).filter(Boolean)));
        if (asmIds.length > 0) {
          const { data: uData } = await supabase.from('users').select('id, name').in('id', asmIds);
          const uMap: Record<string, string> = {};
          (uData || []).forEach((u: any) => { uMap[u.id] = u.name; });

          finalAssemblies = finalAssemblies.map(a => ({
            ...a,
            assembly_route: {
              ...(a.assembly_route || {}),
              assembler: { name: a.assembly_route?.assembler_id ? uMap[a.assembly_route.assembler_id] : null }
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
    const latestRO = routeOrders[0];
    const routeStatus = latestRO?.route?.status;

    if (!latestRO) return 'imported'; // Nenhuma rota atribuída
    if (routeStatus === 'in_progress') return 'in_route'; // Rota em andamento
    if (routeStatus === 'pending' || routeStatus === 'assigned') return 'separating'; // Em separação
    if (routeStatus === 'completed') return 'completed'; // Rota finalizada
    return 'imported';
  }, [routeOrders]);

  // Status específico do pedido (exibido dentro do card da rota)
  const derivedStatus = useMemo(() => {
    const base = selectedOrder?.status || '';
    const latestRO = routeOrders[0];
    const routeStatus = latestRO?.route?.status;
    const roStatus = latestRO?.status;
    const routeName = String(latestRO?.route?.name || '');

    let entrega = base;
    if (routeName.startsWith('RETIRADA')) {
      entrega = 'pickup';
    }
    else if (roStatus === 'returned' || selectedOrder?.return_flag) entrega = 'returned';
    else if (routeStatus === 'in_progress') entrega = 'in_progress';
    else if (roStatus === 'delivered') entrega = 'delivered';
    else if (routeStatus === 'pending') entrega = 'pending';
    return entrega;
  }, [selectedOrder, routeOrders]);

  const assemblyStatus = useMemo(() => {
    if (!assemblies.length) return 'none';
    const st = assemblies[0].status;
    return st;
  }, [assemblies]);

  const formatDate = (d?: string | null) => {
    if (!d) return '-';
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? '-' : dt.toLocaleDateString('pt-BR');
  };

  const statusLabelEntrega: Record<string, string> = {
    pending: 'Pendente',
    imported: 'Importado',
    assigned: 'Em separação',
    in_progress: 'Em rota',
    delivered: 'Entregue',
    returned: 'Retornado',
    pickup: 'Retirado em Loja',
  };

  const statusLabelMontagem: Record<string, string> = {
    pending: 'Pendente',
    assigned: 'Atribuído',
    in_progress: 'Em andamento',
    completed: 'Concluído',
    cancelled: 'Cancelado',
    none: 'Sem montagem',
  };

  // Labels para etapa do processo (cabeçalho do card)
  const processStageLabel: Record<string, string> = {
    imported: 'Pedido Importado do ERP',
    separating: 'Em Separação',
    in_route: 'Em Rota',
    completed: 'Rota Finalizada',
  };

  // Cores/estilos para cada etapa do processo
  const processStageStyle: Record<string, string> = {
    imported: 'text-gray-600',
    separating: 'text-orange-600',
    in_route: 'text-blue-600',
    completed: 'text-green-600',
  };

  // Labels para status específico do pedido (dentro do card)
  const orderStatusLabel: Record<string, string> = {
    pending: 'Pendente',
    in_progress: 'Pendente',
    delivered: 'Entregue',
    returned: 'Retornado',
    pickup: 'Retirado em Loja',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-3">
          {!isConsultor && (
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Search className="h-5 w-5 text-blue-600" /> Consulta de Pedido
            </h1>
          </div>
          {isConsultor && (
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Sair
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex flex-col gap-4">
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
                    setAssemblies([]);
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
                <p className="text-lg font-bold text-gray-900">{selectedOrder.order_id_erp}</p>
                <p className="text-sm text-gray-600 mt-1">{selectedOrder.customer_name}</p>
                <div className="mt-2 text-sm text-gray-600 flex items-center gap-2">
                  <Phone className="h-4 w-4 text-gray-400" />
                  {selectedOrder.phone || '-'}
                </div>
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
                    const prev = raw.previsao_entrega || selectedOrder.delivery_date || (selectedOrder as any).previsao_entrega;
                    if (!prev) return null;
                    return <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">Prev. {formatDate(prev)}</span>;
                  })()}
                </div>
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
                {routeOrders.length === 0 ? (
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
                      const orderStatusColor = orderStatus === 'delivered' ? 'text-green-600'
                        : orderStatus === 'returned' ? 'text-red-600'
                          : 'text-yellow-600';

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
                            <p className="text-xs text-green-600 font-medium">
                              Entregue em: {ro.delivered_at ? formatDate(ro.delivered_at) : formatDate(ro.route?.updated_at)}
                            </p>
                          )}
                          {ro.status === 'returned' && (
                            <p className="text-xs text-red-600 font-medium">
                              Retornado em: {ro.delivered_at ? formatDate(ro.delivered_at) : formatDate(ro.route?.updated_at)}
                            </p>
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
                    <p className="text-sm font-bold text-gray-900 capitalize">{statusLabelMontagem[assemblyStatus] || statusLabelMontagem.none}</p>
                  </div>
                </div>
                {assemblies.length === 0 ? (
                  <p className="text-sm text-gray-500">Nenhum romaneio de montagem.</p>
                ) : (
                  <div className="space-y-2">
                    {assemblies.map((ap) => (
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
                        <p className="text-xs text-gray-500 capitalize">Status: {statusLabelMontagem[(ap.status || '').toLowerCase()] || ap.status}</p>
                        <p className="text-xs text-gray-500">Montador: {ap.assembly_route?.assembler?.name || '-'}</p>

                        {ap.status === 'completed' ? (
                          <p className="text-xs text-green-600 font-medium">Montado em: {formatDate(ap.completion_date || ap.assembly_date || ap.updated_at)}</p>
                        ) : (
                          <p className="text-xs text-gray-500">Prazo: {formatDate(ap.assembly_route?.deadline)}</p>
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
                            className="w-full mt-1 text-xs px-2 py-1.5 rounded border border-purple-200 text-purple-700 hover:bg-purple-50 transition-colors flex items-center justify-center gap-1"
                          >
                            Detalhes da rota
                          </button>
                        )}
                      </div>
                    ))}
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
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{it.name}</p>
                        <p className="text-xs text-gray-500">SKU: {it.sku}</p>
                      </div>
                      <div className="text-right text-sm text-gray-600">
                        <p>Qtd: {it.purchased_quantity}</p>
                        {it.location && <p className="text-xs text-gray-500">Local: {it.location}</p>}
                        {String(it.has_assembly || '').toLowerCase() === 'true' && (
                          <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 text-xs">Montagem</span>
                        )}
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
