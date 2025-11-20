import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabase/client';
import type { Order, DriverWithUser, Vehicle, Route, RouteWithDetails } from '../../types/database';
import { Truck, User, Package, Plus, Trash2, Save, Eye, FileText, FileSpreadsheet, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { DeliverySheetGenerator } from '../../utils/pdf/deliverySheetGenerator';
import { PDFDocument } from 'pdf-lib';

export default function RouteCreation() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [drivers, setDrivers] = useState<DriverWithUser[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [selectedDriver, setSelectedDriver] = useState<string>('');
  const [selectedVehicle, setSelectedVehicle] = useState<string>('');
  const [routeName, setRouteName] = useState<string>('');
  const [conferente, setConferente] = useState<string>('');
  const [observations, setObservations] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [routesList, setRoutesList] = useState<RouteWithDetails[]>([]);
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<RouteWithDetails | null>(null);
  const [nfLoading, setNfLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedExistingRouteId, setSelectedExistingRouteId] = useState<string>('');
  const [filterCity, setFilterCity] = useState<string>('');
  const [filterNeighborhood, setFilterNeighborhood] = useState<string>('');
  const [filterFilialVenda, setFilterFilialVenda] = useState<string>('');
  const [filterLocalEstocagem, setFilterLocalEstocagem] = useState<string>('');
  const [filterSeller, setFilterSeller] = useState<string>('');
  const [filterClient, setFilterClient] = useState<string>('');
  const [waSending, setWaSending] = useState(false);
  const [groupSending, setGroupSending] = useState(false);
  const selectedRouteIdRef = useRef<string | null>(null);
  const showRouteModalRef = useRef<boolean>(false);
  const showCreateModalRef = useRef<boolean>(false);

  

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const handler = async () => {
      if (document.visibilityState === 'visible') {
        await loadData();
        if (showRouteModalRef.current) setShowRouteModal(true);
        if (showCreateModalRef.current) setShowCreateModal(true);
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  useEffect(() => {
    try {
      const sCreate = localStorage.getItem('rc_showCreateModal');
      const sRoute = localStorage.getItem('rc_showRouteModal');
      const rid = localStorage.getItem('rc_selectedRouteId');
      if (sCreate === '1') { showCreateModalRef.current = true; setShowCreateModal(true); }
      if (sRoute === '1' && rid) { selectedRouteIdRef.current = rid; showRouteModalRef.current = true; setShowRouteModal(true); }
    } catch {}
  }, []);

  const cityOptions = useMemo(() => Array.from(new Set((orders || []).map((o: any) => String((o.address_json?.city || o.raw_json?.destinatario_cidade || '')).trim()).filter(Boolean))).sort(), [orders]);
  const neighborhoodOptions = useMemo(() => Array.from(new Set((orders || []).map((o: any) => String((o.address_json?.neighborhood || o.raw_json?.destinatario_bairro || '')).trim()).filter(Boolean))).sort(), [orders]);
  const filialOptions = useMemo(() => Array.from(new Set((orders || []).map((o: any) => String((o.raw_json?.filial_venda || '')).trim()).filter(Boolean))).sort(), [orders]);
  const localOptions = useMemo(() => Array.from(new Set((orders || []).flatMap((o: any) => Array.isArray(o.raw_json?.produtos_locais) ? o.raw_json.produtos_locais.map((p: any) => String(p?.local_estocagem || '').trim()) : []).filter(Boolean))).sort(), [orders]);
  const sellerOptions = useMemo(() => Array.from(new Set((orders || []).map((o: any) => String((o.raw_json?.vendedor || o.raw_json?.vendedor_nome || '')).trim()).filter(Boolean))).sort(), [orders]);
  const clientOptions = useMemo(() => Array.from(new Set((orders || []).map((o: any) => String((o.customer_name || '')).trim()).filter(Boolean))).sort(), [orders]);

  const loadData = async () => {
    try {
      if (!showRouteModal && !showCreateModal) setLoading(true);

      // Load available orders (pending status)
      const { data: ordersData } = await supabase
        .from('orders')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      // Prefer RPC que bypassa RLS para listar nomes dos motoristas
      let driversData: any[] | null = null;
      try {
        const { data: rpcDrivers } = await supabase.rpc('list_drivers');
        if (rpcDrivers) {
          driversData = rpcDrivers.map((d: any) => ({ id: d.driver_id, user_id: null, active: true, name: d.name }));
        }
      } catch (e) {
        driversData = null;
      }

      // Load active vehicles
      const { data: vehiclesData } = await supabase
        .from('vehicles')
        .select('*')
        .eq('active', true);

      if (ordersData) setOrders(ordersData as Order[]);
      if (driversData && driversData.length > 0) {
        setDrivers(driversData as DriverWithUser[]);
      } else {
        const { data: driverUsers } = await supabase
          .from('users')
          .select('id,name,role')
          .eq('role', 'driver');
        if (driverUsers && driverUsers.length > 0) {
          for (const u of driverUsers) {
            const { data: existing } = await supabase
              .from('drivers')
              .select('id')
              .eq('user_id', u.id)
              .single();
            if (!existing) {
              await supabase
                .from('drivers')
                .insert({ user_id: u.id, active: true, name: (u as any).name || null });
            }
          }
          const { data: driversReload } = await supabase
            .rpc('list_drivers');
          if (driversReload) setDrivers((driversReload as any[]).map((d: any) => ({ id: d.driver_id, name: d.name })) as any);
        }
      }
      if (vehiclesData) setVehicles(vehiclesData as Vehicle[]);

      const { data: routesData } = await supabase
        .from('routes')
        .select(`
          *,
          driver:drivers!driver_id(
            id, active,
            user:users!user_id(id,name,email)
          ),
          vehicle:vehicles!vehicle_id(id,model,plate),
          route_orders:route_orders(*, order:orders(*))
        `)
        .order('created_at', { ascending: false })
        .limit(50);
      if (routesData) {
        setRoutesList(routesData as RouteWithDetails[]);
        if (selectedRouteIdRef.current) {
          const found = (routesData as RouteWithDetails[]).find(r => String(r.id) === String(selectedRouteIdRef.current));
          if (found) setSelectedRoute(found);
        }
      }
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const toggleOrderSelection = (orderId: string) => {
    const newSelected = new Set(selectedOrders);
    if (newSelected.has(orderId)) {
      newSelected.delete(orderId);
    } else {
      newSelected.add(orderId);
    }
    setSelectedOrders(newSelected);
  };

  const createRoute = async () => {
    if (!selectedExistingRouteId) {
      if (!routeName.trim()) { toast.error('Por favor, informe um nome para a rota'); return; }
      if (!selectedDriver) { toast.error('Por favor, selecione um motorista'); return; }
    }
    if (selectedOrders.size === 0) { toast.error('Por favor, selecione pelo menos um pedido'); return; }

    setSaving(true);

    try {
      let targetRouteId = selectedExistingRouteId;
      if (!selectedExistingRouteId) {
        const { data: routeData, error: routeError } = await supabase
          .from('routes')
          .insert({
            name: routeName.trim(),
            driver_id: selectedDriver,
            vehicle_id: selectedVehicle || null,
            conferente: conferente.trim() || null,
            observations: observations.trim() || null,
            status: 'pending',
          })
          .select()
          .single();
        if (routeError) throw routeError;
        targetRouteId = routeData.id;
      }

      const { data: existingRO } = await supabase
        .from('route_orders')
        .select('order_id,sequence')
        .eq('route_id', targetRouteId)
        .order('sequence');
      const existingIds = new Set<string>((existingRO || []).map((r:any)=>String(r.order_id)));
      const startSeq = (existingRO && existingRO.length > 0) ? Math.max(...existingRO.map((r:any)=>Number(r.sequence||0))) + 1 : 1;
      const toAdd = Array.from(selectedOrders).filter((id)=> !existingIds.has(String(id)));
      const routeOrders = toAdd.map((orderId, idx) => ({ route_id: targetRouteId, order_id: orderId, sequence: startSeq + idx, status: 'pending' }));
      if (routeOrders.length > 0) {
        const { error: routeOrdersError } = await supabase.from('route_orders').insert(routeOrders);
        if (routeOrdersError) throw routeOrdersError;
        const { error: ordersError } = await supabase.from('orders').update({ status: 'assigned' }).in('id', toAdd);
        if (ordersError) throw ordersError;
      }

      toast.success(selectedExistingRouteId ? 'Pedidos adicionados ao romaneio' : 'Rota criada com sucesso!');
      
      // Reset form
      setRouteName('');
      setSelectedDriver('');
      setSelectedVehicle('');
      setConferente('');
      setObservations('');
      setSelectedOrders(new Set());
      setSelectedExistingRouteId('');
      showCreateModalRef.current = false;
      localStorage.removeItem('rc_showCreateModal');
      setShowCreateModal(false);
      
      // Reload data
      loadData();
      
    } catch (error) {
      console.error('Error creating route:', error);
      toast.error('Erro ao criar rota');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-2 text-gray-600">Carregando...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filtros de Pedidos */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Filtros</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Cidade</label>
            <select value={filterCity} onChange={(e)=>setFilterCity(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md">
              <option value="">Todas</option>
              {cityOptions.map((c)=> (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Bairro</label>
            <select value={filterNeighborhood} onChange={(e)=>setFilterNeighborhood(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md">
              <option value="">Todos</option>
              {neighborhoodOptions.map((c)=> (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Filial de venda</label>
            <select value={filterFilialVenda} onChange={(e)=>setFilterFilialVenda(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md">
              <option value="">Todas</option>
              {filialOptions.map((c)=> (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Local de estocagem</label>
            <select value={filterLocalEstocagem} onChange={(e)=>setFilterLocalEstocagem(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md">
              <option value="">Todos</option>
              {localOptions.map((c)=> (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Vendedor</label>
            <select value={filterSeller} onChange={(e)=>setFilterSeller(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md">
              <option value="">Todos</option>
              {sellerOptions.map((c)=> (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Cliente</label>
            <select value={filterClient} onChange={(e)=>setFilterClient(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md">
              <option value="">Todos</option>
              {clientOptions.map((c)=> (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex justify-between items-center">
          <button onClick={()=>{setFilterCity('');setFilterNeighborhood('');setFilterFilialVenda('');setFilterLocalEstocagem('');setFilterSeller('');setFilterClient('');}} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">Limpar filtros</button>
          <button onClick={()=> { showCreateModalRef.current = true; localStorage.setItem('rc_showCreateModal','1'); setShowCreateModal(true); }} disabled={selectedOrders.size === 0} className="px-4 py-2 bg-blue-600 text-white rounded-md disabled:opacity-50">Criar Rota</button>
        </div>
      </div>

      {/* Orders Selection */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 flex items-center">
            <Package className="h-5 w-5 mr-2" />
            Selecionar Pedidos ({selectedOrders.size} selecionados)
          </h2>
          
          <div className="flex items-center space-x-4">
            <label className="text-sm text-gray-700 flex items-center">
              <input
                type="checkbox"
                onChange={(e) => {
                  const filtered = (orders || []).filter((order)=>{
                    const o:any = order; const addr = o.address_json || {};
                    const city = String(addr.city || o.raw_json?.destinatario_cidade || '').toLowerCase();
                    const nb = String(addr.neighborhood || o.raw_json?.destinatario_bairro || '').toLowerCase();
                    const filialVenda = String(o.raw_json?.filial_venda || '').toLowerCase();
                    const seller = String(o.raw_json?.vendedor || o.raw_json?.vendedor_nome || '').toLowerCase();
                    const client = String(o.customer_name || '').toLowerCase();
                    const locais = Array.isArray(o.raw_json?.produtos_locais) ? o.raw_json.produtos_locais.map((p:any)=>String(p?.local_estocagem||'').toLowerCase()) : [];
                    const okCity = !filterCity || city.includes(filterCity.toLowerCase());
                    const okNb = !filterNeighborhood || nb.includes(filterNeighborhood.toLowerCase());
                    const okFilial = !filterFilialVenda || filialVenda.includes(filterFilialVenda.toLowerCase());
                    const okSeller = !filterSeller || seller.includes(filterSeller.toLowerCase());
                    const okClient = !filterClient || client.includes(filterClient.toLowerCase());
                    const okLocal = !filterLocalEstocagem || locais.some((l:string)=>l.includes(filterLocalEstocagem.toLowerCase()));
                    return okCity && okNb && okFilial && okLocal && okSeller && okClient;
                  });
                  if (e.currentTarget.checked) {
                    const allIds = new Set(filtered.map((o:any)=>o.id));
                    setSelectedOrders(allIds);
                  } else {
                    setSelectedOrders(new Set());
                  }
                }}
                className="h-4 w-4 mr-2 border-gray-300 rounded"
              />
              Selecionar todos
            </label>
            <div className="text-sm text-gray-600">{orders.length} pedidos disponíveis</div>
          </div>
        </div>

        {orders.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Nenhum pedido disponível para criar rotas.</p>
            <p className="text-sm mt-1">Importe pedidos primeiro na tela de importação.</p>
          </div>
        ) : (
          <div className="max-h-[480px] overflow-y-auto overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="px-2 py-2 text-left w-8"></th>
                  <th className="px-2 py-2 text-left">Data</th>
                  <th className="px-2 py-2 text-left">Cliente</th>
                  <th className="px-2 py-2 text-left">Telefone</th>
                  <th className="px-2 py-2 text-left">Pedido</th>
                  <th className="px-2 py-2 text-left">Situação</th>
                  <th className="px-2 py-2 text-left">Observações Internas</th>
                  <th className="px-2 py-2 text-left">Observações</th>
                  <th className="px-2 py-2 text-left">Endereço de Entrega</th>
                  <th className="px-2 py-2 text-left">Quantidade</th>
                  <th className="px-2 py-2 text-left">Valor</th>
                  <th className="px-2 py-2 text-left">Cidade</th>
                  <th className="px-2 py-2 text-left">Bairro</th>
                  <th className="px-2 py-2 text-left">Filial de Venda</th>
                  <th className="px-2 py-2 text-left">Local de Estocagem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {orders.filter((order)=>{
                  const o:any = order;
                  const addr = o.address_json || {};
                  const city = String(addr.city || o.raw_json?.destinatario_cidade || '').toLowerCase();
                  const nb = String(addr.neighborhood || o.raw_json?.destinatario_bairro || '').toLowerCase();
                  const filialVenda = String(o.raw_json?.filial_venda || '').toLowerCase();
                  const seller = String(o.raw_json?.vendedor || o.raw_json?.vendedor_nome || '').toLowerCase();
                  const client = String(o.customer_name || '').toLowerCase();
                  const locais = Array.isArray(o.raw_json?.produtos_locais) ? o.raw_json.produtos_locais.map((p:any)=>String(p?.local_estocagem||'').toLowerCase()) : [];
                  const okCity = !filterCity || city.includes(filterCity.toLowerCase());
                  const okNb = !filterNeighborhood || nb.includes(filterNeighborhood.toLowerCase());
                  const okFilial = !filterFilialVenda || filialVenda.includes(filterFilialVenda.toLowerCase());
                  const okSeller = !filterSeller || seller.includes(filterSeller.toLowerCase());
                  const okClient = !filterClient || client.includes(filterClient.toLowerCase());
                  const okLocal = !filterLocalEstocagem || locais.some((l:string)=>l.includes(filterLocalEstocagem.toLowerCase()));
                  return okCity && okNb && okFilial && okLocal && okSeller && okClient;
                }).map((order)=>{
                  const o:any = order;
                  const addr = o.address_json || {};
                  const raw = o.raw_json || {};
                  const data = new Date(o.created_at).toLocaleDateString('pt-BR');
                  const pedido = String(raw.lancamento_venda ?? o.order_id_erp ?? '');
                  const situacao = String(raw.situacao ?? 'Pendente');
                  const obsInternas = String(raw.observacoes_internas ?? '');
                  const endereco = [
                    String(addr.street || raw.destinatario_endereco || ''),
                    String(addr.neighborhood || raw.destinatario_bairro || ''),
                    String(addr.city || raw.destinatario_cidade || ''),
                    String(addr.state || ''),
                    String(addr.zip || raw.destinatario_cep || '')
                  ].filter(Boolean).join(', ').replace(', ,', ',');
                  const quantidade = Array.isArray(o.items_json) ? o.items_json.reduce((sum:any,it:any)=>sum + Number(it.quantity||0),0) : 0;
                  const valor = Number(o.total||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                  const cidade = String(addr.city || raw.destinatario_cidade || '');
                  const bairro = String(addr.neighborhood || raw.destinatario_bairro || '');
                  const filialVendaText = String(raw.filial_venda || '');
                  const locaisText = Array.isArray(raw.produtos_locais) ? raw.produtos_locais.map((p:any)=>String(p?.local_estocagem||'')).filter(Boolean).join(' • ') : '';
                  return (
                    <tr key={o.id} className={selectedOrders.has(o.id) ? 'bg-blue-50' : ''} onClick={()=>toggleOrderSelection(o.id)}>
                      <td className="px-2 py-2">
                        <input type="checkbox" className="h-4 w-4" checked={selectedOrders.has(o.id)} onChange={()=>toggleOrderSelection(o.id)} />
                      </td>
                      <td className="px-2 py-2">{data}</td>
                      <td className="px-2 py-2">{o.customer_name}</td>
                      <td className="px-2 py-2">{o.phone}</td>
                      <td className="px-2 py-2">{pedido}</td>
                      <td className="px-2 py-2">{situacao}</td>
                      <td className="px-2 py-2 whitespace-pre-wrap">{obsInternas}</td>
                      <td className="px-2 py-2 whitespace-pre-wrap">{o.observations || ''}</td>
                      <td className="px-2 py-2">{endereco}</td>
                      <td className="px-2 py-2 text-center">{quantidade}</td>
                      <td className="px-2 py-2">R$ {valor}</td>
                      <td className="px-2 py-2">{cidade}</td>
                      <td className="px-2 py-2">{bairro}</td>
                      <td className="px-2 py-2">{filialVendaText}</td>
                      <td className="px-2 py-2">{locaisText}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Routes List */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 flex items-center">
            <Truck className="h-5 w-5 mr-2" />
            Rotas Criadas
          </h2>
          <div className="text-sm text-gray-600">{routesList.length} rota(s)</div>
        </div>

        {routesList.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Truck className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Nenhuma rota criada ainda.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {routesList.map((route) => {
              const total = route.route_orders?.length || 0;
              const delivered = route.route_orders?.filter(r => r.status === 'delivered').length || 0;
              const pendingCount = route.route_orders?.filter(r => r.status === 'pending').length || 0;
              const returned = route.route_orders?.filter(r => r.status === 'returned').length || 0;
              const statusClass = route.status === 'pending'
                ? 'bg-yellow-100 text-yellow-800'
                : route.status === 'in_progress'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-green-100 text-green-800';
              const statusText = route.status === 'pending' ? 'Em Separação' : route.status === 'in_progress' ? 'Em Rota' : 'Concluída';
              return (
                <div key={route.id} className="bg-white rounded-lg border hover:shadow transition p-6">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center">
                      <Truck className="h-5 w-5 text-blue-600 mr-2" />
                      <h3 className="text-lg font-semibold text-gray-900">{route.name}</h3>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusClass}`}>{statusText}</span>
                  </div>
                  <div className="text-sm text-gray-700 space-y-1 mb-4">
                    <div>Motorista: {route.driver?.user?.name || '—'}</div>
                    {route.vehicle && (
                      <div>Veículo: {route.vehicle.model} • {route.vehicle.plate}</div>
                    )}
                    <div>Pedidos: {total} • Pendentes: {pendingCount} • Entregues: {delivered} • Retornos: {returned}</div>
                    <div>Criada em: {new Date(route.created_at).toLocaleDateString('pt-BR')}</div>
                  </div>
                  <button
                    onClick={() => { setSelectedRoute(route); selectedRouteIdRef.current = String(route.id); localStorage.setItem('rc_selectedRouteId', String(route.id)); showRouteModalRef.current = true; localStorage.setItem('rc_showRouteModal','1'); setShowRouteModal(true); }}
                    className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center"
                  >
                    <Eye className="h-4 w-4 mr-2" /> Ver detalhes
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      

      {showRouteModal && selectedRoute && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b">
              <h4 className="text-lg font-semibold text-gray-900">Detalhes da Rota</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-3">
                {selectedRoute?.status === 'pending' && (
                  <button
                    onClick={async () => {
                      try {
                        const route = selectedRoute as any;
                        const { data: roData } = await supabase
                          .from('route_orders')
                          .select('order_id,sequence,id')
                          .eq('route_id', route.id)
                          .order('sequence');
                        const existingIds = new Set<string>((roData || []).map((r:any)=>String(r.order_id)));
                        const toAddIds = Array.from(selectedOrders).filter((id)=> !existingIds.has(String(id)));
                        if (toAddIds.length === 0) { toast.info('Nenhum novo pedido selecionado'); return; }
                        const startSeq = (roData && roData.length > 0) ? Math.max(...(roData || []).map((r:any)=>Number(r.sequence||0))) + 1 : 1;
                        const rows = toAddIds.map((orderId, idx)=> ({ route_id: route.id, order_id: orderId, sequence: startSeq + idx, status: 'pending' }));
                        const { error: insErr } = await supabase.from('route_orders').insert(rows);
                        if (insErr) throw insErr;
                        const { error: updErr } = await supabase.from('orders').update({ status: 'assigned' }).in('id', toAddIds);
                        if (updErr) throw updErr;
                        toast.success('Pedidos adicionados à rota');
                        loadData();
                      } catch {
                        toast.error('Falha ao adicionar pedidos');
                      }
                    }}
                    className="h-11 w-full inline-flex items-center justify-center bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
                  >
                    Adicionar pedidos selecionados
                  </button>
                )}
                <button
                  onClick={async () => {
                    if (!selectedRoute) return;
                    try {
                      if (selectedRoute.status !== 'pending') { toast.error('A rota já foi iniciada'); return; }
                      const { error } = await supabase
                        .from('routes')
                        .update({ status: 'in_progress' })
                        .eq('id', selectedRoute.id);
                      if (error) throw error;
                      const updated = { ...selectedRoute, status: 'in_progress' } as any;
                      setSelectedRoute(updated);
                      toast.success('Rota iniciada');
                      loadData();
                    } catch (e) {
                      toast.error('Falha ao iniciar rota');
                    }
                  }}
                  disabled={selectedRoute.status !== 'pending'}
                  className="h-11 w-full inline-flex items-center justify-center bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 text-sm font-medium"
                >
                  Iniciar Rota
                </button>
                <button
                  onClick={async () => {
                    if (!selectedRoute) return;
                    setWaSending(true);
                    try {
                      const route = selectedRoute as any;
                      const { data: roForNotify } = await supabase
                        .from('route_orders')
                        .select('*, order:orders(*)')
                        .eq('route_id', route.id)
                        .order('sequence');
                      const driverName = route.driver?.user?.name || '';
                      const vehicleObj = route.vehicle || null;
                      const status = route.status;
                      const status_label = status === 'pending' ? 'Em Separação' : status === 'in_progress' ? 'Em Rota' : 'Concluída';
                      const status_code = status === 'pending' ? 'separacao' : status === 'in_progress' ? 'rota' : 'concluida';
                      const contatos = (roForNotify || []).map((ro: any) => {
                        const o = ro.order || {};
                        const address = o.address_json || {};
                        const zip = String(address.zip || o.raw_json?.destinatario_cep || '');
                        const street = String(address.street || o.raw_json?.destinatario_endereco || '');
                        const neighborhood = String(address.neighborhood || o.raw_json?.destinatario_bairro || '');
                        const city = String(address.city || o.raw_json?.destinatario_cidade || '');
                        const endereco_completo = [zip, street, neighborhood && `- ${neighborhood}`, city].filter(Boolean).join(', ').replace(', -', ' -');
                        const items = Array.isArray(o.items_json) ? o.items_json : [];
                        const produtos = items.map((it: any) => `${String(it.sku || '')} - ${String(it.name || '')}`).join(', ');
                        return {
                          lancamento_venda: Number(o.order_id_erp || ro.order_id || 0),
                          cliente_nome: String(o.customer_name || o.raw_json?.nome_cliente || ''),
                          cliente_celular: String(o.phone || o.raw_json?.cliente_celular || ''),
                          endereco_completo,
                          produtos,
                        };
                      });
                      let webhookUrl = import.meta.env.VITE_WEBHOOK_WHATSAPP_URL as string | undefined;
                      if (!webhookUrl) {
                        const { data } = await supabase.from('webhook_settings').select('url').eq('key', 'envia_mensagem').eq('active', true).single();
                        webhookUrl = data?.url || 'https://n8n.lojaodosmoveis.shop/webhook-test/envia_mensagem';
                      }
                      const payload = { contatos };
                      try {
                        await fetch(String(webhookUrl), {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(payload)
                        });
                      } catch {
                        const fd = new FormData();
                        for (const c of contatos) fd.append('contatos[]', JSON.stringify(c));
                        await fetch(String(webhookUrl), { method: 'POST', body: fd });
                      }
                      toast.success('WhatsApp solicitado');
                    } catch (e) {
                      toast.error('Erro ao enviar WhatsApp');
                    } finally {
                      setWaSending(false);
                    }
                  }}
                  disabled={waSending}
                  className="h-11 w-full inline-flex items-center justify-center bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
                >
                  <MessageSquare className="h-4 w-4 mr-2" /> Enviar WhatsApp
                </button>
                <button
                  onClick={async () => {
                    if (!selectedRoute) return;
                    setGroupSending(true);
                    try {
                      const route = selectedRoute as any;
                      const { data: roForGroup } = await supabase
                        .from('route_orders')
                        .select('*, order:orders(*)')
                        .eq('route_id', route.id)
                        .order('sequence');
                      const route_name = String(route.name || '');
                      const driver_name = String(route.driver?.user?.name || '');
                      const conferente_name = String(route.conferente || '');
                      const status = String(route.status || '');
                      let vehicle_text = '';
                      try {
                        let v = route.vehicle || null;
                        if (!v && route.vehicle_id) {
                          const { data: vData } = await supabase
                            .from('vehicles')
                            .select('*')
                            .eq('id', route.vehicle_id)
                            .single();
                          v = vData || null;
                        }
                        if (v) vehicle_text = `${String(v.model || '')}${v.plate ? ' • ' + String(v.plate) : ''}`;
                      } catch {}
                      const observations = String(route.observations || '');
                      const documentos = (roForGroup || []).map((ro: any) => String(ro.order?.order_id_erp || ro.order_id || '')).filter(Boolean);
                      if (documentos.length === 0) { toast.error('Nenhum número de lançamento encontrado'); setGroupSending(false); return; }
                      let webhookUrl = import.meta.env.VITE_WEBHOOK_ENVIA_GRUPO_URL as string | undefined;
                      if (!webhookUrl) {
                        try {
                          const { data } = await supabase.from('webhook_settings').select('url').eq('key', 'envia_grupo').eq('active', true).single();
                          webhookUrl = data?.url || 'https://n8n.lojaodosmoveis.shop/webhook-test/envia_grupo';
                        } catch {
                          webhookUrl = 'https://n8n.lojaodosmoveis.shop/webhook-test/envia_grupo';
                        }
                      }
                      const payload = { route_name, driver_name, conferente: conferente_name, documentos, status, vehicle: vehicle_text, observations };
                      try {
                        const resp = await fetch(String(webhookUrl), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                        if (!resp.ok) {
                          const text = await resp.text();
                          if (resp.status === 404 && text.includes('envia_grupo')) {
                            toast.error('Webhook de teste não está ativo. Clique em "Execute workflow" no n8n e tente novamente.');
                          } else {
                            toast.error('Falha ao enviar informativo da rota');
                          }
                          setGroupSending(false);
                          return;
                        }
                      } catch {
                        const fd = new FormData();
                        fd.append('route_name', route_name);
                        fd.append('driver_name', driver_name);
                        fd.append('conferente', conferente_name);
                        fd.append('status', status);
                        fd.append('vehicle', vehicle_text);
                        fd.append('observations', observations);
                        for (const d of documentos) fd.append('documentos[]', d);
                        await fetch(String(webhookUrl), { method: 'POST', body: fd });
                      }
                      toast.success('Rota enviada ao grupo');
                    } catch (e) {
                      toast.error('Erro ao enviar rota em grupo');
                    } finally {
                      setGroupSending(false);
                    }
                  }}
                  disabled={groupSending}
                  className="h-11 w-full inline-flex items-center justify-center bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm font-medium"
                >
                  <MessageSquare className="h-4 w-4 mr-2" /> {groupSending ? 'Enviando...' : 'Enviar rota em grupo'}
                </button>
                <button
                  onClick={async () => {
                    if (!selectedRoute) return;
                    setNfLoading(true);
                    try {
                      const route = selectedRoute as any;
                      const { data: roData, error: roErr } = await supabase
                        .from('route_orders')
                        .select('*, order:orders(*)')
                        .eq('route_id', route.id)
                        .order('sequence');
                      if (roErr) throw roErr;

                      const allHaveDanfe = (roData || []).every((ro: any) => !!ro.order?.danfe_base64);
                      if (allHaveDanfe) {
                        const base64Existing = (roData || []).map((ro: any) => String(ro.order.danfe_base64)).filter((b: string) => b && b.startsWith('JVBER'));
                        const merged1 = await PDFDocument.create();
                        for (const b64 of base64Existing) {
                          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
                          const src = await PDFDocument.load(bytes);
                          const pages = await merged1.copyPages(src, src.getPageIndices());
                          pages.forEach((p) => merged1.addPage(p));
                        }
                        const result = await merged1.save();
                        DeliverySheetGenerator.openPDFInNewTab(result);
                        setNfLoading(false);
                        return;
                      }

                      const missing = (roData || []).filter((ro: any) => !ro.order?.danfe_base64);
                      const docs = missing.map((ro: any) => {
                        let xmlText = '';
                        if (ro.order?.xml_documento) xmlText = String(ro.order.xml_documento);
                        else if (ro.order?.raw_json?.xmls_documentos || ro.order?.raw_json?.xmls) {
                          const arr = ro.order.raw_json.xmls_documentos || ro.order.raw_json.xmls || [];
                          const first = Array.isArray(arr) ? arr[0] : null;
                          xmlText = first ? (typeof first === 'string' ? first : (first?.xml || '')) : '';
                        }
                        return { order_id: ro.order_id, numero: String(ro.order?.order_id_erp || ro.order_id || ''), xml: xmlText };
                      }).filter((d: any) => d.xml && d.xml.includes('<'));

                      if (docs.length === 0) {
                        toast.error('Nenhum XML encontrado nos pedidos faltantes');
                        setNfLoading(false);
                        return;
                      }

                      let nfWebhook = 'https://n8n.lojaodosmoveis.shop/webhook-test/gera_nf';
                      try {
                        const { data: s } = await supabase.from('webhook_settings').select('url').eq('key', 'gera_nf').eq('active', true).single();
                        if (s?.url) nfWebhook = s.url;
                      } catch {}
                      const resp = await fetch(nfWebhook, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ route_id: route.id, documentos: docs, count: docs.length })
                      });

                      const text = await resp.text();
                      let payload: any = null;
                      try { payload = JSON.parse(text); } catch { payload = { error: text }; }
                      if (!resp.ok) {
                        toast.error('Erro ao gerar notas fiscais'); setNfLoading(false); return;
                      }

                      const base64List: string[] = [];
                      const mapByOrderId = new Map<string, string>();
                      const pushData = (val: any) => { if (typeof val === 'string' && val.startsWith('JVBER')) base64List.push(val); };
                      if (payload?.pdf) pushData(payload.pdf);
                      if (payload?.data) pushData(payload.data);
                      if (Array.isArray(payload?.pdfs)) payload.pdfs.forEach((b: any) => pushData(b));
                      if (Array.isArray(payload)) payload.forEach((d: any) => { if (d?.data?.startsWith('JVBER')) pushData(d.data); if (d?.order_id && d?.data?.startsWith('JVBER')) mapByOrderId.set(String(d.order_id), d.data); });
                      if (Array.isArray(payload?.documentos)) payload.documentos.forEach((d: any) => { if (d?.data?.startsWith('JVBER')) pushData(d.data); if (d?.order_id) mapByOrderId.set(String(d.order_id), d.data); });
                      if (Array.isArray(payload?.arquivos)) payload.arquivos.forEach((d: any) => { if (d?.data?.startsWith('JVBER')) pushData(d.data); if (d?.order_id) mapByOrderId.set(String(d.order_id), d.data); });
                      if (base64List.length === 0) { toast.error('Resposta não contém PDFs em base64'); setNfLoading(false); return; }

                      // Persistir por pedido
                      try {
                        if (mapByOrderId.size > 0) {
                          for (const [orderId, b64] of mapByOrderId.entries()) {
                            await supabase.from('orders').update({ danfe_base64: b64, danfe_gerada_em: new Date().toISOString() }).eq('id', orderId);
                            // atualizar selectedRoute em memória
                            const updated = { ...selectedRoute } as any;
                            updated.route_orders = (updated.route_orders || []).map((ro: any) => ro.order_id === orderId ? { ...ro, order: { ...(ro.order || {}), danfe_base64: b64, danfe_gerada_em: new Date().toISOString() } } : ro);
                            setSelectedRoute(updated);
                          }
                        } else if (base64List.length === docs.length) {
                          for (let i = 0; i < docs.length; i++) {
                            const orderId = docs[i].order_id; const b64 = base64List[i];
                            await supabase.from('orders').update({ danfe_base64: b64, danfe_gerada_em: new Date().toISOString() }).eq('id', orderId);
                          }
                        }
                      } catch (e) { console.warn('Falha ao salvar DANFE:', e); }

                      // Montar lista final: existentes + novas
                      const existing = (roData || []).map((ro: any) => String(ro.order?.danfe_base64)).filter((b: string) => b && b.startsWith('JVBER'));
                      const allB64 = [...existing, ...base64List];
                      const merged = await PDFDocument.create();
                      for (const b64 of allB64) {
                        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
                        const src = await PDFDocument.load(bytes);
                        const pages = await merged.copyPages(src, src.getPageIndices()); pages.forEach((p) => merged.addPage(p));
                      }
                      const result = await merged.save(); DeliverySheetGenerator.openPDFInNewTab(result);
                    } catch (e: any) {
                      console.error('Erro ao gerar/imprimir NFs:', e); toast.error('Erro ao gerar notas fiscais');
                    } finally { setNfLoading(false); }
                  }}
                  disabled={nfLoading}
                  className="h-11 w-full inline-flex items-center justify-center bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" /> {nfLoading ? 'Processando...' : ((selectedRoute?.route_orders || []).every((ro: any) => !!ro.order?.danfe_base64) ? 'Imprimir Notas Fiscais' : 'Gerar Notas Fiscais')}
                </button>
                <button
                  onClick={async () => {
                    try {
                      const route = selectedRoute as any;

                      // Buscar route_orders + orders do banco para garantir dados completos
                      const { data: roData, error: roErr } = await supabase
                        .from('route_orders')
                        .select('*, order:orders(*)')
                        .eq('route_id', route.id)
                        .order('sequence');
                      if (roErr) throw roErr;

                      const routeOrders = (roData || []).map((ro: any) => ({
                        id: ro.id,
                        route_id: ro.route_id,
                        order_id: ro.order_id,
                        sequence: ro.sequence,
                        status: ro.status,
                        created_at: ro.created_at,
                        updated_at: ro.updated_at,
                      }));

                      // Normalizar pedidos para o gerador de PDF
                      const orders = (roData || []).map((ro: any) => {
                        const o = ro.order || {};
                        const address = o.address_json || {};
                        const itemsRaw = Array.isArray(o.items_json) ? o.items_json : [];
                        const prodLoc = o.raw_json?.produtos_locais || [];
                        const norm = (s: any) => String(s ?? '').toLowerCase().trim();
                        const items = itemsRaw.map((it: any, idx: number) => {
                          if (it && !it.location) {
                            let loc = '';
                            if (Array.isArray(prodLoc) && prodLoc.length > 0) {
                              const byCode = prodLoc.find((p: any) => norm(p?.codigo_produto) === norm(it?.sku));
                              const byName = prodLoc.find((p: any) => norm(p?.nome_produto) === norm(it?.name));
                              if (byCode?.local_estocagem) loc = String(byCode.local_estocagem);
                              else if (byName?.local_estocagem) loc = String(byName.local_estocagem);
                              else if (prodLoc[idx]?.local_estocagem) loc = String(prodLoc[idx].local_estocagem);
                              else if (prodLoc[0]?.local_estocagem) loc = String(prodLoc[0].local_estocagem);
                            }
                            return { ...it, location: loc };
                          }
                          return it;
                        });
                        return {
                          id: o.id || ro.order_id,
                          order_id_erp: String(o.order_id_erp || ro.order_id || ''),
                          customer_name: String(o.customer_name || (o.raw_json?.nome_cliente ?? '')),
                          phone: String(o.phone || (o.raw_json?.cliente_celular ?? '')),
                          address_json: {
                            street: String(address.street || o.raw_json?.destinatario_endereco || ''),
                            neighborhood: String(address.neighborhood || o.raw_json?.destinatario_bairro || ''),
                            city: String(address.city || o.raw_json?.destinatario_cidade || ''),
                            state: String(address.state || ''),
                            zip: String(address.zip || o.raw_json?.destinatario_cep || ''),
                            complement: address.complement || o.raw_json?.destinatario_complemento || '',
                          },
                          items_json: items,
                          raw_json: o.raw_json || null,
                          total: Number(o.total || 0),
                          status: o.status || 'imported',
                          observations: o.observations || '',
                          created_at: o.created_at || new Date().toISOString(),
                          updated_at: o.updated_at || new Date().toISOString(),
                        } as any;
                      });

                      // Garantir driver e vehicle
                      let driverObj = route.driver;
                      if (!driverObj) {
                        const { data: dData } = await supabase
                          .from('drivers')
                          .select('*, user:users!user_id(*)')
                          .eq('id', route.driver_id)
                          .single();
                        driverObj = dData || null;
                      }

                      let vehicleObj = route.vehicle;
                      if (!vehicleObj && route.vehicle_id) {
                        const { data: vData } = await supabase
                          .from('vehicles')
                          .select('*')
                          .eq('id', route.vehicle_id)
                          .single();
                        vehicleObj = vData || null;
                      }

                      const data = {
                        route: {
                          id: route.id,
                          name: route.name,
                          driver_id: route.driver_id,
                          vehicle_id: route.vehicle_id,
                          conferente: route.conferente,
                          observations: route.observations,
                          status: route.status,
                          created_at: route.created_at,
                          updated_at: route.updated_at,
                        },
                        routeOrders,
                        driver: driverObj || { id: '', user_id: '', cpf: '', active: true, user: { id: '', email: '', name: '', role: 'driver', created_at: '' } },
                        vehicle: vehicleObj || undefined,
                        orders,
                        generatedAt: new Date().toISOString(),
                      };
                      const pdfBytes = await DeliverySheetGenerator.generateDeliverySheet(data);
                      DeliverySheetGenerator.openPDFInNewTab(pdfBytes);
                    } catch (e: any) {
                      console.error('Erro ao gerar PDF:', e);
                      toast.error('Erro ao gerar romaneio em PDF');
                    }
                  }}
                  className="h-11 w-full inline-flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                >
                  <FileText className="h-4 w-4 mr-2" /> Romaneio (PDF)
                </button>
                <button
                  onClick={async () => {
                    try {
                      const route = selectedRoute as any;
                      const { data: roData, error: roErr } = await supabase
                        .from('route_orders')
                        .select('order_id,status')
                        .eq('route_id', route.id);
                      if (roErr) throw roErr;
                      if (!roData || roData.length === 0) { toast.error('Nenhum pedido na rota'); return; }
                      const allDelivered = (roData || []).every((ro: any) => ro.status === 'delivered');
                      if (!allDelivered) { toast.error('Existem pedidos pendentes ou retornados'); return; }
                      const { error: rErr } = await supabase
                        .from('routes')
                        .update({ status: 'completed' })
                        .eq('id', route.id);
                      if (rErr) throw rErr;
                      const orderIds = (roData || []).map((ro: any) => ro.order_id);
                      await supabase
                        .from('orders')
                        .update({ status: 'delivered' })
                        .in('id', orderIds);
                      const updated = { ...selectedRoute, status: 'completed' } as any;
                      setSelectedRoute(updated);
                      toast.success('Rota concluída');
                      loadData();
                    } catch (e) {
                      toast.error('Falha ao concluir rota');
                    }
                  }}
                  disabled={selectedRoute.status !== 'in_progress'}
                  className="h-11 w-full inline-flex items-center justify-center bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:opacity-50 text-sm font-medium"
                >
                  Concluir Rota
                </button>
                <button className="text-gray-600 hover:text-gray-900" onClick={() => { showRouteModalRef.current = false; localStorage.removeItem('rc_showRouteModal'); localStorage.removeItem('rc_selectedRouteId'); setShowRouteModal(false); }}>Fechar</button>
              </div>
            </div>
            <div className="p-6 space-y-4 overflow-auto max-h-[65vh]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div><span className="font-medium">Nome:</span> {selectedRoute.name}</div>
                <div>
                  <span className="font-medium">Status:</span> {(() => {
                    const allDone = (selectedRoute.route_orders || []).every((r:any)=> r.status !== 'pending');
                    const s = selectedRoute.status;
                    if (allDone) return 'Concluída';
                    return s === 'in_progress' ? 'Em Rota' : 'Em Separação';
                  })()}
                </div>
                <div><span className="font-medium">Motorista:</span> {selectedRoute.driver?.user?.name || '—'}</div>
                <div><span className="font-medium">Veículo:</span> {selectedRoute.vehicle ? `${selectedRoute.vehicle.model} • ${selectedRoute.vehicle.plate}` : '—'}</div>
                <div><span className="font-medium">Criada em:</span> {new Date(selectedRoute.created_at).toLocaleString('pt-BR')}</div>
              </div>
              {selectedRoute.route_orders && selectedRoute.route_orders.length > 0 ? (
                <div>
                  <div className="text-sm font-semibold text-gray-900 mb-2">Pedidos da Rota</div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left">
                          <th className="px-2 py-1">Seq</th>
                          <th className="px-2 py-1">Nº Documento</th>
                          <th className="px-2 py-1">Cliente</th>
                          <th className="px-2 py-1">Status</th>
                          <th className="px-2 py-1 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedRoute.route_orders.map((ro) => {
                          const formatDT = (s?: string) => s ? new Date(s).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
                          const statusPT = ro.status === 'delivered' ? `Entregue ${formatDT(ro.delivered_at)}` : ro.status === 'returned' ? `Retornado ${formatDT(ro.returned_at)}` : 'Pendente';
                          return (
                          <tr key={ro.id} className="border-t">
                            <td className="px-2 py-1">{ro.sequence}</td>
                            <td className="px-2 py-1">{ro.order?.order_id_erp ?? '—'}</td>
                            <td className="px-2 py-1">{ro.order?.customer_name ?? '—'}</td>
                            <td className="px-2 py-1">{statusPT}</td>
                          <td className="px-2 py-1 text-right">
                              {selectedRoute?.status === 'pending' && (
                                <button
                                  className="inline-flex items-center px-2 py-1 text-red-600 hover:text-red-800"
                                  onClick={async () => {
                                    try {
                                      const { error: delErr } = await supabase.from('route_orders').delete().eq('id', ro.id);
                                      if (delErr) throw delErr;
                                      const { error: updErr } = await supabase.from('orders').update({ status: 'pending' }).eq('id', ro.order_id);
                                      if (updErr) throw updErr;
                                      toast.success('Pedido removido da rota');
                                      const updated = { ...selectedRoute } as any;
                                      updated.route_orders = (updated.route_orders || []).filter((x: any) => x.id !== ro.id);
                                      setSelectedRoute(updated);
                                      loadData();
                                    } catch {
                                      toast.error('Falha ao remover pedido');
                                    }
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                              {ro.order?.danfe_base64 ? (
                                <button
                                  className="inline-flex items-center px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                                  onClick={async () => {
                                    try {
                                      const b64 = String(ro.order?.danfe_base64);
                                      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
                                      const doc = await PDFDocument.load(bytes);
                                      const merged = await PDFDocument.create();
                                      const pages = await merged.copyPages(doc, doc.getPageIndices());
                                      pages.forEach((p) => merged.addPage(p));
                                      const out = await merged.save();
                                      DeliverySheetGenerator.openPDFInNewTab(out);
                                    } catch {
                                      toast.error('Falha ao abrir DANFE');
                                    }
                                  }}
                                >
                                  Imprimir DANFE
                                </button>
                              ) : (
                                <button
                                  className="inline-flex items-center px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                                  onClick={async () => {
                                    try {
                                      const xml = ro.order?.xml_documento
                                        ? String(ro.order.xml_documento)
                                        : (() => {
                                            const arr = ro.order?.raw_json?.xmls_documentos || ro.order?.raw_json?.xmls || [];
                                            const first = Array.isArray(arr) ? arr[0] : null;
                                            return first ? (typeof first === 'string' ? first : (first?.xml || '')) : '';
                                          })();
                                      if (!xml || !xml.includes('<')) { toast.error('XML não encontrado'); return; }
                                      const webhookUrl = 'https://n8n.lojaodosmoveis.shop/webhook-test/gera_nf';
                                      const resp = await fetch(webhookUrl, {
                                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ route_id: selectedRoute.id, documentos: [{ order_id: ro.order_id, numero: String(ro.order?.order_id_erp || ro.order_id || ''), xml }], count: 1 })
                                      });
                                      const text = await resp.text();
                                      let payload: any = null; try { payload = JSON.parse(text); } catch { payload = { error: text }; }
                                      if (!resp.ok) { toast.error('Erro ao gerar DANFE'); return; }
                                      let b64: string | null = null;
                                      if (typeof payload?.data === 'string' && payload.data.startsWith('JVBER')) b64 = payload.data;
                                      else if (Array.isArray(payload?.documentos)) { const item = payload.documentos.find((d: any) => String(d?.order_id) === String(ro.order_id)); if (item?.data?.startsWith('JVBER')) b64 = item.data; }
                                      else if (Array.isArray(payload)) { const item = payload.find((d: any) => String(d?.order_id) === String(ro.order_id)); if (item?.data?.startsWith('JVBER')) b64 = item.data; }
                                      if (!b64) { toast.error('DANFE não retornada pelo webhook'); return; }
                                      await supabase
                                        .from('orders')
                                        .update({ danfe_base64: b64, danfe_gerada_em: new Date().toISOString() })
                                        .eq('id', ro.order_id);
                                      const updated = { ...selectedRoute } as any;
                                      updated.route_orders = (updated.route_orders || []).map((x: any) => x.id === ro.id ? { ...x, order: { ...(x.order || {}), danfe_base64: b64, danfe_gerada_em: new Date().toISOString() } } : x);
                                      setSelectedRoute(updated);
                                      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
                                      const doc = await PDFDocument.load(bytes);
                                      const merged = await PDFDocument.create();
                                      const pages = await merged.copyPages(doc, doc.getPageIndices());
                                      pages.forEach((p) => merged.addPage(p));
                                      const out = await merged.save();
                                      DeliverySheetGenerator.openPDFInNewTab(out);
                                      toast.success('DANFE gerada e salva');
                                    } catch (e) {
                                      console.error(e);
                                      toast.error('Falha ao gerar DANFE');
                                    }
                                  }}
                                >
                                  Gerar DANFE
                                </button>
                              )}
                          </td>
                          </tr>
                        )})}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-600">Nenhum pedido vinculado.</div>
              )}
            </div>
          </div>
        </div>
      )}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h4 className="text-lg font-semibold text-gray-900">Nova Rota</h4>
              <button className="text-gray-600 hover:text-gray-900" onClick={()=>{ showCreateModalRef.current = false; localStorage.removeItem('rc_showCreateModal'); setShowCreateModal(false); }}>Fechar</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Usar romaneio existente (Em Separação)</label>
                <select value={selectedExistingRouteId} onChange={(e)=>setSelectedExistingRouteId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md">
                  <option value="">Não, criar novo</option>
                  {routesList.filter(r=>r.status==='pending').map(r=> (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              {!selectedExistingRouteId && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Nome do Romaneio *</label>
                  <input type="text" value={routeName} onChange={(e)=>setRouteName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="Ex: Rota Centro - Manhã" />
                </div>
              )}
              {!selectedExistingRouteId && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Motorista *</label>
                    <select value={selectedDriver} onChange={(e)=>setSelectedDriver(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md">
                      <option value="">Selecione</option>
                      {drivers.map((d)=> (<option key={d.id} value={d.id}>{d.name || d.user?.name || 'Motorista'}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Veículo</label>
                    <select value={selectedVehicle} onChange={(e)=>setSelectedVehicle(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md">
                      <option value="">Selecione</option>
                      {vehicles.map((v)=> (<option key={v.id} value={v.id}>{v.model} - {v.plate}</option>))}
                    </select>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Conferente</label>
                  <input type="text" value={conferente} onChange={(e)=>setConferente(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="Nome do conferente" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Observações</label>
                  <input type="text" value={observations} onChange={(e)=>setObservations(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="Observações sobre a rota" />
                </div>
              </div>
              <div className="text-sm text-gray-600">Pedidos selecionados: {selectedOrders.size}</div>
              <div className="flex justify-end space-x-3">
                <button onClick={()=>{ showCreateModalRef.current = false; localStorage.removeItem('rc_showCreateModal'); setShowCreateModal(false); }} className="px-4 py-2 border border-gray-300 rounded-md">Cancelar</button>
                <button onClick={createRoute} disabled={saving || (!selectedExistingRouteId && (!routeName.trim() || !selectedDriver)) || selectedOrders.size===0} className="px-4 py-2 bg-blue-600 text-white rounded-md disabled:opacity-50">Confirmar</button>
              </div>
            </div>
          </div>
        </div>
      )}
      
    </div>
  );
}
