import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, MapPin, Phone, Search, Truck, Hammer, FileText, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
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
  assembly_route_id?: string;
  assembly_route?: any;
  assembly_date?: string;
}

export default function OrderLookup() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [routeOrders, setRouteOrders] = useState<RouteOrderInfo[]>([]);
  const [assemblies, setAssemblies] = useState<AssemblyInfo[]>([]);

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
        // Busca route_orders vinculados ao pedido (sem join de conference para evitar erro de schema)
        const selectRouteOrder = '*, route:routes(*), order:orders(id, order_id_erp)';

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

        // Enriquecer rota com motorista/veículo
        if (roData && roData.length > 0) {
          const routeIds = Array.from(new Set(roData.map((r: any) => r.route_id).filter(Boolean)));
          const { data: routesInfo } = await supabase
            .from('routes')
            .select('id, name, status, driver_id, vehicle_id, conferente, updated_at')
            .in('id', routeIds);

          const driverIds = Array.from(new Set((routesInfo || []).map((r: any) => r.driver_id).filter(Boolean)));
          const { data: driversInfo } = driverIds.length
            ? await supabase.from('drivers').select('id, name, user_id').in('id', driverIds)
            : { data: [] as any[] };
          const userIds = Array.from(new Set((driversInfo || []).map((d: any) => d.user_id).filter(Boolean)));
          const { data: usersInfo } = userIds.length
            ? await supabase.from('users').select('id, name').in('id', userIds)
            : { data: [] as any[] };

          const vehicleIds = Array.from(new Set((routesInfo || []).map((r: any) => r.vehicle_id).filter(Boolean)));
          const { data: vehiclesInfo } = vehicleIds.length
            ? await supabase.from('vehicles').select('id, plate, model').in('id', vehicleIds)
            : { data: [] as any[] };

          const mapRoute: Record<string, any> = {};
          (routesInfo || []).forEach((r: any) => { mapRoute[r.id] = r; });
          const mapDriver: Record<string, any> = {};
          (driversInfo || []).forEach((d: any) => {
            const user = (usersInfo || []).find((u: any) => u.id === d.user_id);
            mapDriver[d.id] = { ...d, user };
          });
          const mapVehicle: Record<string, any> = {};
          (vehiclesInfo || []).forEach((v: any) => { mapVehicle[v.id] = v; });

          roData = (roData as any[]).map((r: any) => {
            const rt = mapRoute[r.route_id] || r.route || {};
            const drv = rt.driver_id ? mapDriver[rt.driver_id] : null;
            const veh = rt.vehicle_id ? mapVehicle[rt.vehicle_id] : null;
            return {
              ...r,
              route: { ...rt, driver: drv, vehicle: veh },
            };
          });
        }

        setRouteOrders(roData as RouteOrderInfo[] || []);

        const { data: apData } = await supabase
          .from('assembly_products')
          .select('*, assembly_route:assembly_routes(*)')
          .eq('order_id', selectedOrder.id)
          .order('created_at', { ascending: false });
        setAssemblies(apData as AssemblyInfo[] || []);
      } catch (err) {
        console.error(err);
        toast.error('Erro ao carregar detalhes do pedido');
      } finally {
        setLoading(false);
      }
    };
    fetchDetails();
  }, [selectedOrder]);

  const derivedStatus = useMemo(() => {
    const base = selectedOrder?.status || '';
    const latestRO = routeOrders[0];
    const routeStatus = latestRO?.route?.status;
    const roStatus = latestRO?.status;
    let entrega = base;
    if (roStatus === 'returned' || selectedOrder?.return_flag) entrega = 'returned';
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
  };

  const statusLabelMontagem: Record<string, string> = {
    pending: 'Pendente',
    assigned: 'Atribuído',
    in_progress: 'Em andamento',
    completed: 'Concluído',
    cancelled: 'Cancelado',
    none: 'Sem montagem',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <p className="text-xs text-gray-500">Consulta</p>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Search className="h-5 w-5 text-blue-600" /> Consulta de Pedido
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex flex-col gap-4">
          <div className="flex flex-col md:flex-row gap-3 md:items-center">
            <div className="flex-1">
              <label className="text-sm font-medium text-gray-700">Pedido, CPF ou cliente</label>
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
                placeholder="Ex: 115675 ou 8499..."
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
                  {(() => {
                    const raw = selectedOrder.raw_json || {};
                    const prev = raw.previsao_entrega || selectedOrder.delivery_date || selectedOrder.previsao_entrega;
                    if (!prev) return null;
                    return <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">Prev. {formatDate(prev)}</span>;
                  })()}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <Truck className="h-5 w-5 text-blue-600" />
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase">Entrega</p>
                    <p className="text-sm font-bold text-gray-900 capitalize">{statusLabelEntrega[derivedStatus] || '-'}</p>
                  </div>
                </div>
                {routeOrders.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    {derivedStatus === 'delivered'
                      ? 'Entregue, mas rota não foi encontrada no histórico.'
                      : 'Nenhuma rota encontrada.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {routeOrders.map((ro) => (
                      <div key={ro.id} className="border border-gray-100 rounded-lg p-3">
                        <p className="text-sm font-semibold text-gray-900">{ro.route?.name || ro.route_id}</p>
                        <p className="text-xs text-gray-500 capitalize">Status rota: {statusLabelEntrega[ro.route?.status || ''] || ro.route?.status || '-'}</p>
                        <p className="text-xs text-gray-500">Motorista: {ro.route?.driver?.user?.name || ro.route?.driver?.name || '-'}</p>
                        <p className="text-xs text-gray-500">Veículo: {ro.route?.vehicle ? `${ro.route?.vehicle?.model || ''} ${ro.route?.vehicle?.plate || ''}`.trim() : '-'}</p>
                        <p className="text-xs text-gray-500">Conferente: {ro.route?.conferente || '-'}</p>
                        <p className="text-xs text-gray-500">Entregue em: {ro.delivered_at ? formatDate(ro.delivered_at) : formatDate(ro.route?.updated_at)}</p>
                        <p className="text-xs text-gray-500">Conferência: {ro.route?.conference_status || 'N/A'}</p>
                      </div>
                    ))}
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
                      <div key={ap.id} className="border border-gray-100 rounded-lg p-3">
                        <p className="text-sm font-semibold text-gray-900">{ap.assembly_route?.name || ap.assembly_route_id}</p>
                        <p className="text-xs text-gray-500 capitalize">Status: {ap.status}</p>
                        <p className="text-xs text-gray-500">Montador: {ap.assembly_route?.assembler_id || ap.assembly_route?.assembler?.name || '-'}</p>
                        <p className="text-xs text-gray-500">Prazo: {formatDate(ap.assembly_route?.deadline)}</p>
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
                        <p>Qtd: {it.quantity || it.purchased_quantity || 1}</p>
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
