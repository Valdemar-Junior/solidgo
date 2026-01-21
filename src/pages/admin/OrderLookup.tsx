import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, MapPin, Phone, Search, Truck, Hammer, FileText, AlertTriangle, LogOut, Eye, ChevronDown, ChevronUp, Copy, Check, Briefcase } from 'lucide-react';
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
  const [assemblies, setAssemblies] = useState<AssemblyInfo[]>([]);
  const [showObservations, setShowObservations] = useState(false);

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
