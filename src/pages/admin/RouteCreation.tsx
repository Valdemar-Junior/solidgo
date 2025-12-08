import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabase/client';
import type { Order, DriverWithUser, Vehicle, Route, RouteWithDetails } from '../../types/database';
import { Truck, User, Package, Plus, Trash2, Save, Eye, FileText, FileSpreadsheet, MessageSquare, Settings, Info } from 'lucide-react';
import { toast } from 'sonner';
import { DeliverySheetGenerator } from '../../utils/pdf/deliverySheetGenerator';
import { PDFDocument } from 'pdf-lib';
import { useAuthStore } from '../../stores/authStore';

export default function RouteCreation() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [drivers, setDrivers] = useState<DriverWithUser[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [conferentes, setConferentes] = useState<{id:string,name:string}[]>([]);
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
  const [showConferenceModal, setShowConferenceModal] = useState(false);
  const [conferenceRoute, setConferenceRoute] = useState<RouteWithDetails | null>(null);
  const [nfLoading, setNfLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedExistingRouteId, setSelectedExistingRouteId] = useState<string>('');
  const [filterCity, setFilterCity] = useState<string>('');
  const [filterNeighborhood, setFilterNeighborhood] = useState<string>('');
  const [filterFilialVenda, setFilterFilialVenda] = useState<string>('');
  const [filterLocalEstocagem, setFilterLocalEstocagem] = useState<string>('');
  const [filterSeller, setFilterSeller] = useState<string>('');
  const [filterClient, setFilterClient] = useState<string>('');
  const [clientQuery, setClientQuery] = useState<string>('');
  const [showClientList, setShowClientList] = useState<boolean>(false);
  const [filterFreightFull, setFilterFreightFull] = useState<string>('');
  const [filterDepartment, setFilterDepartment] = useState<string>('');
  const [strictDepartment, setStrictDepartment] = useState<boolean>(false);
  const [waSending, setWaSending] = useState(false);
  const [filterOperation, setFilterOperation] = useState<string>('');
  const [groupSending, setGroupSending] = useState(false);
  const selectedRouteIdRef = useRef<string | null>(null);
  const showRouteModalRef = useRef<boolean>(false);
  const showCreateModalRef = useRef<boolean>(false);
  const [showColumnsModal, setShowColumnsModal] = useState(false);
  const [columnsConf, setColumnsConf] = useState<Array<{id:string,label:string,visible:boolean}>>([
    { id: 'data', label: 'Data', visible: true },
    { id: 'pedido', label: 'Pedido', visible: true },
    { id: 'cliente', label: 'Cliente', visible: true },
    { id: 'telefone', label: 'Telefone', visible: true },
    { id: 'sku', label: 'SKU', visible: true },
    { id: 'produto', label: 'Produto', visible: true },
    { id: 'quantidade', label: 'Quantidade Comprada', visible: true },
    { id: 'department', label: 'Departamento', visible: true },
    { id: 'brand', label: 'Marca', visible: true },
    { id: 'localEstocagem', label: 'Local de Saída', visible: true },
    { id: 'cidade', label: 'Cidade', visible: true },
    { id: 'bairro', label: 'Bairro', visible: true },
    { id: 'filialVenda', label: 'Filial de Venda', visible: true },
    { id: 'operacao', label: 'Operação', visible: true },
    { id: 'vendedor', label: 'Vendedor', visible: true },
    { id: 'situacao', label: 'Situação', visible: true },
    { id: 'obsPublicas', label: 'Observações', visible: true },
    { id: 'obsInternas', label: 'Observações Internas', visible: true },
    { id: 'endereco', label: 'Endereço de Entrega', visible: true },
    { id: 'outrosLocs', label: 'Outros Locais (pedido)', visible: true },
  ]);
  const [viewMode, setViewMode] = useState<'products'|'orders'>(()=> 'products');
  const productsScrollRef = useRef<HTMLDivElement>(null);
  const [draggingProducts, setDraggingProducts] = useState(false);
  const dragStartXRef = useRef(0);
  const dragScrollLeftRef = useRef(0);

  const onProductsMouseDown = (e: any) => {
    if (!productsScrollRef.current) return;
    setDraggingProducts(true);
    dragStartXRef.current = e.clientX;
    dragScrollLeftRef.current = productsScrollRef.current.scrollLeft;
  };
  const onProductsMouseMove = (e: any) => {
    if (!draggingProducts || !productsScrollRef.current) return;
    const dx = e.clientX - dragStartXRef.current;
    productsScrollRef.current.scrollLeft = dragScrollLeftRef.current - dx;
  };
  const endProductsDrag = () => { setDraggingProducts(false); };
  const [mixedConfirmOpen, setMixedConfirmOpen] = useState(false);
  const [mixedConfirmOrders, setMixedConfirmOrders] = useState<Array<{id:string,pedido:string,otherLocs:string[]}>>([]);
  const [mixedConfirmAction, setMixedConfirmAction] = useState<'create'|'add'|'none'>('none');

  

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
      const cols = localStorage.getItem('rc_columns_conf');
      if (cols) {
        const parsed = JSON.parse(cols);
        if (Array.isArray(parsed)) {
          const migrated = parsed.map((c:any)=> c?.id === 'localEstocagem' ? { ...c, label: 'Local de Saída' } : c);
          setColumnsConf(migrated);
        }
      }
      setViewMode('products');
    } catch {}
  }, []);

  const cityOptions = useMemo(() => Array.from(new Set((orders || []).map((o: any) => String((o.address_json?.city || o.raw_json?.destinatario_cidade || '')).trim()).filter(Boolean))).sort(), [orders]);
  const neighborhoodOptions = useMemo(() => Array.from(new Set((orders || []).map((o: any) => String((o.address_json?.neighborhood || o.raw_json?.destinatario_bairro || '')).trim()).filter(Boolean))).sort(), [orders]);
  const filialOptions = useMemo(() => Array.from(new Set((orders || []).map((o: any) => String((o.filial_venda || o.raw_json?.filial_venda || '')).trim()).filter(Boolean))).sort(), [orders]);
  const localOptions = useMemo(() => {
    const fromItems = (orders || []).flatMap((o: any) => Array.isArray(o.items_json) ? o.items_json.map((it: any) => String(it?.location || '').trim()) : []);
    const fromRaw = (orders || []).flatMap((o: any) => Array.isArray(o.raw_json?.produtos_locais) ? o.raw_json.produtos_locais.map((p: any) => String(p?.local_estocagem || '').trim()) : []);
    return Array.from(new Set([...fromItems, ...fromRaw].filter(Boolean))).sort();
  }, [orders]);
  const sellerOptions = useMemo(() => Array.from(new Set((orders || []).map((o: any) => String((o.vendedor_nome || o.raw_json?.vendedor || o.raw_json?.vendedor_nome || '')).trim()).filter(Boolean))).sort(), [orders]);
  const operationOptions = useMemo(() => Array.from(new Set((orders || []).map((o: any) => String((o.raw_json?.operacoes || '')).trim()).filter(Boolean))).sort(), [orders]);
  const clientOptions = useMemo(() => Array.from(new Set((orders || []).map((o: any) => String((o.customer_name || '')).trim()).filter(Boolean))).sort(), [orders]);
  const departmentOptions = useMemo(() => {
    const fromItems = (orders || []).flatMap((o: any) => Array.isArray(o.items_json) ? o.items_json.map((it: any) => String(it?.department || '').trim()) : []);
    const fromRaw = (orders || []).flatMap((o: any) => Array.isArray(o.raw_json?.produtos_locais) ? o.raw_json.produtos_locais.map((p: any) => String(p?.departamento || '').trim()) : []);
    return Array.from(new Set([...(fromItems||[]), ...(fromRaw||[])] .filter(Boolean))).sort();
  }, [orders]);
  const filteredClients = useMemo(() => {
    const q = clientQuery.toLowerCase().trim();
    const src = clientOptions || [];
    if (!q) return src.slice(0, 20);
    return src.filter((c)=> c.toLowerCase().includes(q)).slice(0, 20);
  }, [clientOptions, clientQuery]);

  const getOrderLocations = (o:any) => {
    const itemsLocs = Array.isArray(o.items_json) ? o.items_json.map((it:any)=> String(it?.location||'').trim()).filter(Boolean) : [];
    const rawLocs = Array.isArray(o.raw_json?.produtos_locais) ? o.raw_json.produtos_locais.map((p:any)=> String(p?.local_estocagem||'').trim()).filter(Boolean) : [];
    return Array.from(new Set([...(itemsLocs||[]), ...(rawLocs||[])].filter(Boolean)));
  };

  const selectedMixedOrders = useMemo(()=>{
    if (!filterLocalEstocagem) return [] as Array<{id:string,pedido:string,otherLocs:string[]}>;
    const cur = Array.from(selectedOrders);
    const result: Array<{id:string,pedido:string,otherLocs:string[]}> = [];
    for (const oid of cur) {
      const o = (orders || []).find((x:any)=> String(x.id) === String(oid));
      if (!o) continue;
      const locs = getOrderLocations(o).map(l=> String(l));
      const other = locs.filter(l=> l.toLowerCase() !== filterLocalEstocagem.toLowerCase());
      if (other.length > 0) {
        const pedido = String(o.raw_json?.lancamento_venda ?? o.order_id_erp ?? o.id ?? '');
        result.push({ id: String(o.id), pedido, otherLocs: Array.from(new Set(other)) });
      }
    }
    return result;
  }, [selectedOrders, orders, filterLocalEstocagem]);

  const openMixedConfirm = (action:'create'|'add') => {
    if (!filterLocalEstocagem) return false;
    const list = selectedMixedOrders;
    if (list.length === 0) return false;
    setMixedConfirmOrders(list);
    setMixedConfirmAction(action);
    setMixedConfirmOpen(true);
    return true;
  };

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
          driversData = rpcDrivers.map((d: any) => ({ id: d.driver_id, active: true, user: { id: null, name: d.name } }));
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
      try {
        // Persistir marca/departamento nos items_json quando vierem do ERP em raw_json.produtos_locais/produtos
        const toUpdate: Array<{ id: string; items_json: any[] }> = [];
        for (const o of (ordersData || [])) {
          const order: any = o;
          const items = Array.isArray(order.items_json) ? order.items_json : [];
          const rawLocais = Array.isArray(order.raw_json?.produtos_locais) ? order.raw_json.produtos_locais : [];
          const rawProdutos = Array.isArray(order.raw_json?.produtos) ? order.raw_json.produtos : [];
          const rawList = [...rawLocais, ...rawProdutos];
          if (items.length === 0 || rawList.length === 0) continue;
          const byCode = new Map<string, any>(rawList.map((p: any) => [String(p?.codigo_produto || '').toLowerCase(), p]));
          const byName = new Map<string, any>(rawList.map((p: any) => [String(p?.nome_produto || '').toLowerCase(), p]));
          let changed = false;
          const nextItems = items.map((it: any) => {
            const sku = String(it?.sku || '').toLowerCase();
            const name = String(it?.name || '').toLowerCase();
            const raw = byCode.get(sku) || byName.get(name) || null;
            if (!raw) return it;
            const curDept = it?.department;
            const curBrand = it?.brand;
            const dept = raw?.departamento;
            const brand = raw?.marca;
            if ((!curDept && dept) || (!curBrand && brand)) {
              changed = true;
              return { ...it, department: curDept || dept || '', brand: curBrand || brand || '' };
            }
            return it;
          });
          if (changed) toUpdate.push({ id: String(order.id), items_json: nextItems });
        }
        if (toUpdate.length > 0) {
          for (const row of toUpdate) {
            await supabase.from('orders').update({ items_json: row.items_json }).eq('id', row.id);
          }
        }
      } catch {}
      if (driversData && driversData.length > 0) {
        setDrivers(driversData as DriverWithUser[]);
      } else {
        // Fallback direto na tabela drivers caso RPC não esteja disponível
        const { data: directDrivers } = await supabase
          .from('drivers')
          .select('id, active, user:users!user_id(id,name,email)')
          .eq('active', true);
        if (directDrivers && directDrivers.length > 0) {
          setDrivers(directDrivers as any);
          // Reconciliar: garantir que todo usuário com role=driver tenha um registro em drivers
          try {
            const { data: driverUsers } = await supabase
              .from('users')
              .select('id,name,role')
              .eq('role', 'driver');
            const existingUserIds = new Set((directDrivers || []).map((d: any) => String(d.user?.id)));
            const toCreate = (driverUsers || []).filter((u: any) => !existingUserIds.has(String(u.id)));
            if (toCreate.length > 0) {
              await supabase.from('drivers').insert(toCreate.map((u: any) => ({ user_id: u.id, active: true })));
              const { data: driversReload } = await supabase
                .from('drivers')
                .select('id, active, user:users!user_id(id,name,email)')
                .eq('active', true);
              if (driversReload) setDrivers(driversReload as any);
            }
          } catch {}
        } else {
          // Criar registros de drivers para usuários com role=driver e recarregar
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
                  .insert({ user_id: u.id, active: true });
              }
            }
            const { data: driversReload } = await supabase
              .from('drivers')
              .select('id, active, user:users!user_id(id,name,email)')
              .eq('active', true);
            if (driversReload) setDrivers(driversReload as any);
          } else {
            // Nenhum motorista encontrado
            setDrivers([]);
          }
        }
      }
      if (vehiclesData) setVehicles(vehiclesData as Vehicle[]);

      // Load conferentes
      const { data: conferentesData } = await supabase
        .from('users')
        .select('id,name,role')
        .eq('role', 'conferente');
      setConferentes((conferentesData || []).map((u: any) => ({ id: String(u.id), name: String(u.name || u.id) })));

      let routesData: any[] | null = null;
      try {
        const res = await supabase
          .from('routes')
          .select('*, driver:drivers!driver_id(id,active,user:users!user_id(id,name,email)), vehicle:vehicles!vehicle_id(id,model,plate), route_orders:route_orders(*, order:orders!order_id(*)), conferences:route_conferences!route_id(id,route_id,status,result_ok,finished_at,created_at,resolved_at,resolved_by,resolution,summary)')
          .order('created_at', { ascending: false })
          .limit(50);
        routesData = res.data || null;
      } catch {}
      if (!routesData) {
        const fallback = await supabase
          .from('routes')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);
        routesData = fallback.data || [];
      }
      if (routesData) {
        const enriched = [...(routesData as any[])];
        const routeIds = enriched.map(r => r.id).filter(Boolean);
        if (routeIds.length > 0) {
          const { data: roBulk } = await supabase
            .from('route_orders')
            .select('*, order:orders!order_id(*)')
            .in('route_id', routeIds)
            .order('sequence');
          const byRoute: Record<string, any[]> = {};
          for (const ro of (roBulk || [])) {
            const k = String(ro.route_id);
            if (!byRoute[k]) byRoute[k] = [];
            byRoute[k].push(ro);
          }
          for (const r of enriched) {
            const k = String(r.id);
            r.route_orders = byRoute[k] || r.route_orders || [];
            if (Array.isArray(r.conferences) && r.conferences.length > 0) {
              const sorted = [...r.conferences].sort((a:any,b:any)=> new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
              (r as any).conference = sorted[0];
            }
          }

          const driverIds = Array.from(new Set(enriched.map(r => r.driver_id).filter(Boolean)));
          if (driverIds.length > 0) {
            const { data: drvBulk } = await supabase
              .from('drivers')
              .select('id, active, user:users!user_id(id,name,email)')
              .in('id', driverIds);
            const mapDrv = new Map<string, any>((drvBulk || []).map((d: any) => [String(d.id), d]));
            for (const r of enriched) {
              const d = mapDrv.get(String(r.driver_id));
              if (d) r.driver = d;
            }

            // Fallback via RPC list_drivers para garantir nome do motorista
            const missingName = enriched.filter(r => !r.driver || !r.driver.user || !r.driver.user.name);
            if (missingName.length > 0) {
              try {
                const { data: drvsRpc } = await supabase.rpc('list_drivers');
                const mapName = new Map<string, string>((drvsRpc || []).map((x: any) => [String(x.driver_id), String(x.name || '')]));
                for (const r of missingName) {
                  const nm = mapName.get(String(r.driver_id));
                  if (nm) {
                    r.driver = r.driver || { id: r.driver_id, active: true };
                    r.driver.user = r.driver.user || { id: null, name: nm };
                    if (!r.driver.user.name) r.driver.user.name = nm;
                  }
                }
              } catch {}
            }
          }

          const vehicleIds = Array.from(new Set(enriched.map(r => r.vehicle_id).filter(Boolean)));
          if (vehicleIds.length > 0) {
            const { data: vehBulk } = await supabase
              .from('vehicles')
              .select('id,model,plate')
              .in('id', vehicleIds);
            const mapVeh = new Map<string, any>((vehBulk || []).map((v: any) => [String(v.id), v]));
            for (const r of enriched) {
              const v = mapVeh.get(String(r.vehicle_id));
              if (v) r.vehicle = v;
            }
          }
        }

        if (routeIds.length > 0) {
          const missingConf = enriched.filter(r=> !(r as any).conference).map(r=> r.id);
          if (missingConf.length > 0) {
            const { data: confBulk } = await supabase
              .from('latest_route_conferences')
              .select('id, route_id, status, result_ok, finished_at, created_at, summary, resolved_at, resolved_by, resolution')
              .in('route_id', missingConf);
            const mapConf = new Map<string, any>();
            (confBulk || []).forEach((c: any) => { mapConf.set(String(c.route_id), c); });
            for (const r of enriched) {
              if (!(r as any).conference) {
                const c = mapConf.get(String(r.id));
                if (c) (r as any).conference = c;
              }
            }
          }
        }
        setRoutesList(enriched as RouteWithDetails[]);
        if (selectedRouteIdRef.current) {
          const found = (enriched as RouteWithDetails[]).find(r => String(r.id) === String(selectedRouteIdRef.current));
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
    if (openMixedConfirm('create')) return;
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
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-2">Cliente</label>
            <input
              type="text"
              value={clientQuery}
              onFocus={()=> setShowClientList(true)}
              onBlur={()=> setTimeout(()=> setShowClientList(false), 150)}
              onChange={(e)=>{ const v = e.target.value; setClientQuery(v); setFilterClient(v); setShowClientList(true); }}
              placeholder="Pesquisar cliente..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
            {showClientList && (
              <div className="absolute left-0 right-0 mt-1 max-h-48 overflow-auto bg-white border border-gray-200 rounded-md shadow z-20">
                <button onMouseDown={(e)=> e.preventDefault()} onClick={()=>{ setFilterClient(''); setClientQuery(''); setShowClientList(false); }} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Todos</button>
                {filteredClients.map((c)=> (
                  <button key={c} onMouseDown={(e)=> e.preventDefault()} onClick={()=>{ setFilterClient(c); setClientQuery(c); setShowClientList(false); }} className="w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-gray-50">
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Frete Full</label>
            <select value={filterFreightFull} onChange={(e)=>setFilterFreightFull(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md">
              <option value="">Todos</option>
              <option value="com">Com Frete Full</option>
              <option value="sem">Sem Frete Full</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Operação</label>
            <select value={filterOperation} onChange={(e)=>setFilterOperation(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md">
              <option value="">Todas</option>
              {operationOptions.map((c)=> (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">Departamento
              <span title="Filtro por Departamento:
- Desligado (100%): mostra itens do departamento, mas seleção é por pedido.
- Ligado (100%): mostra apenas pedidos cujos itens são todos do departamento selecionado." className="ml-2 inline-flex items-center text-gray-500"><Info className="h-4 w-4" /></span>
            </label>
            <select value={filterDepartment} onChange={(e)=>setFilterDepartment(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md">
              <option value="">Todos</option>
              {departmentOptions.map((c)=> (<option key={c} value={c}>{c}</option>))}
            </select>
            <label className="mt-2 inline-flex items-center text-sm text-gray-700">
              <input type="checkbox" className="h-4 w-4 mr-2" checked={strictDepartment} onChange={(e)=> setStrictDepartment(e.currentTarget.checked)} />
              Exigir 100% do departamento
            </label>
          </div>
        </div>
        <div className="mt-4 flex justify-between items-center">
          <button onClick={()=>{setFilterCity('');setFilterNeighborhood('');setFilterFilialVenda('');setFilterLocalEstocagem('');setFilterSeller('');setFilterClient('');setClientQuery('');setFilterFreightFull('');setFilterOperation('');}} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">Limpar filtros</button>
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
            <div className="flex items-center border rounded-md overflow-hidden"></div>
            <label className="text-sm text-gray-700 flex items-center">
              <input
                type="checkbox"
                onChange={(e) => {
                  const rows:any[] = [];
                  for (const order of (orders||[])) {
                    const o:any = order; const addr = o.address_json || {};
                    const city = String(addr.city || o.raw_json?.destinatario_cidade || '').toLowerCase();
                    const nb = String(addr.neighborhood || o.raw_json?.destinatario_bairro || '').toLowerCase();
                    const filialVenda = String(o.raw_json?.filial_venda || '').toLowerCase();
                    const seller = String(o.vendedor_nome || o.raw_json?.vendedor || o.raw_json?.vendedor_nome || '').toLowerCase();
                    const client = String(o.customer_name || '').toLowerCase();
                    const locMap = new Map<string,string>([
                      ...(Array.isArray(o.raw_json?.produtos_locais)? o.raw_json.produtos_locais.map((p:any)=> [String(p?.codigo_produto||'').toLowerCase(), String(p?.local_estocagem||'')]) : []),
                      ...(Array.isArray(o.raw_json?.produtos)? o.raw_json.produtos.map((p:any)=> [String(p?.codigo_produto||'').toLowerCase(), String(p?.local_estoque||'')]) : [])
                    ]);
                    const items = Array.isArray(o.items_json) ? o.items_json : [];
                    for (const it of items) {
                      const sku = String(it?.sku||'').toLowerCase();
                      const loc = String(it?.location || locMap.get(sku) || '').toLowerCase();
                      const okCity = !filterCity || city.includes(filterCity.toLowerCase());
                      const okNb = !filterNeighborhood || nb.includes(filterNeighborhood.toLowerCase());
                      const okFilial = !filterFilialVenda || filialVenda.includes(filterFilialVenda.toLowerCase());
                      const okSeller = !filterSeller || seller.includes(filterSeller.toLowerCase());
                      const okClient = !filterClient || client.includes(filterClient.toLowerCase());
                      const okLocal = !filterLocalEstocagem || (!!loc && loc.includes(filterLocalEstocagem.toLowerCase()));
                      const freteRaw = String(o.tem_frete_full || o.raw_json?.tem_frete_full || '').toLowerCase();
                      const isFreteFull = ['sim','true','1','y','yes'].some((v)=>freteRaw.includes(v));
                      const okFrete = !filterFreightFull || (filterFreightFull==='com' ? isFreteFull : !isFreteFull);
                      if (okCity && okNb && okFilial && okSeller && okClient && okLocal && okFrete) rows.push({ orderId: o.id });
                    }
                  }
                  if (e.currentTarget.checked) {
                    const ids = new Set(rows.map(r=> r.orderId));
                    setSelectedOrders(ids as any);
                  } else {
                    setSelectedOrders(new Set());
                  }
                }}
                className="h-4 w-4 mr-2 border-gray-300 rounded"
              />
              Selecionar todos
            </label>
            <div className="text-sm text-gray-600">{orders.length} pedidos disponíveis</div>
            <button onClick={()=> setShowColumnsModal(true)} className="ml-2 inline-flex items-center px-2 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50" title="Configurar colunas">
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>

        {filterLocalEstocagem && selectedMixedOrders.length > 0 && (
          <div className="mb-3 px-3 py-2 rounded border border-yellow-300 bg-yellow-50 text-sm text-yellow-900">
            {`Pedidos selecionados com itens fora de ${filterLocalEstocagem}: `}
            {selectedMixedOrders.map((m,idx)=> `${m.pedido} (${m.otherLocs.join(' / ')})`).join(', ')}
          </div>
        )}

        {orders.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Nenhum pedido disponível para criar rotas.</p>
            <p className="text-sm mt-1">Importe pedidos primeiro na tela de importação.</p>
          </div>
        ) : (
          viewMode === 'orders' ? (
            <div ref={productsScrollRef} onMouseDown={onProductsMouseDown} onMouseMove={onProductsMouseMove} onMouseUp={endProductsDrag} onMouseLeave={endProductsDrag} className={`max-h-[480px] overflow-y-auto overflow-x-auto ${draggingProducts ? 'cursor-grabbing' : 'cursor-grab'}`}>
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-2 py-2 text-left w-8"></th>
                    {columnsConf.filter(c=>c.visible).map(c=> (
                      <th key={c.id} className="px-2 py-2 text-left">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {orders.filter((order)=>{
                    const o:any = order;
                    const addr = o.address_json || {};
                    const city = String(addr.city || o.raw_json?.destinatario_cidade || '').toLowerCase();
                    const nb = String(addr.neighborhood || o.raw_json?.destinatario_bairro || '').toLowerCase();
                    const filialVenda = String(o.filial_venda || o.raw_json?.filial_venda || '').toLowerCase();
                    const seller = String(o.vendedor_nome || o.raw_json?.vendedor || o.raw_json?.vendedor_nome || '').toLowerCase();
                    const client = String(o.customer_name || '').toLowerCase();
                    const locaisFromItems = Array.isArray(o.items_json) ? o.items_json.map((it:any)=> String(it?.location||'').toLowerCase()).filter(Boolean) : [];
                    const locaisLocais = Array.isArray(o.raw_json?.produtos_locais) ? o.raw_json.produtos_locais.map((p:any)=>String(p?.local_estocagem||'').toLowerCase()) : [];
                    const locaisProdutos = Array.isArray(o.raw_json?.produtos) ? o.raw_json.produtos.map((p:any)=>String(p?.local_estoque||'').toLowerCase()) : [];
                    const deptsFromItems = Array.isArray(o.items_json) ? o.items_json.map((it:any)=> String(it?.department||'').toLowerCase()).filter(Boolean) : [];
                    const deptsFromRawLocais = Array.isArray(o.raw_json?.produtos_locais) ? o.raw_json.produtos_locais.map((p:any)=> String(p?.departamento||'').toLowerCase()).filter(Boolean) : [];
                    const deptsFromRawProdutos = Array.isArray(o.raw_json?.produtos) ? o.raw_json.produtos.map((p:any)=> String(p?.departamento||'').toLowerCase()).filter(Boolean) : [];
                    const okCity = !filterCity || city.includes(filterCity.toLowerCase());
                    const okNb = !filterNeighborhood || nb.includes(filterNeighborhood.toLowerCase());
                    const okFilial = !filterFilialVenda || filialVenda.includes(filterFilialVenda.toLowerCase());
                    const okSeller = !filterSeller || seller.includes(filterSeller.toLowerCase());
                    const okClient = !filterClient || client.includes(filterClient.toLowerCase());
                    const okLocal = !filterLocalEstocagem || (
                      locaisFromItems.length > 0
                        ? locaisFromItems.some((l:string)=> l.includes(filterLocalEstocagem.toLowerCase()))
                        : (locaisLocais.some((l:string)=> l.includes(filterLocalEstocagem.toLowerCase())) || locaisProdutos.some((l:string)=> l.includes(filterLocalEstocagem.toLowerCase())))
                    );
                    const allDeptList = deptsFromItems.length > 0
                      ? Array.from(new Set(deptsFromItems))
                      : Array.from(new Set([...(deptsFromRawLocais||[]), ...(deptsFromRawProdutos||[])]));
                    const okDept = !filterDepartment || (
                      strictDepartment
                        ? (allDeptList.length>0 && allDeptList.every((d)=> d === filterDepartment.toLowerCase()))
                        : (
                          (deptsFromItems.length > 0
                            ? deptsFromItems.some((d)=> d === filterDepartment.toLowerCase())
                            : (deptsFromRawLocais.some((d)=> d === filterDepartment.toLowerCase()) || deptsFromRawProdutos.some((d)=> d === filterDepartment.toLowerCase()))
                          )
                        )
                    );
                    const freteRaw = String(o.tem_frete_full || o.raw_json?.tem_frete_full || '').toLowerCase();
                    const isFreteFull = ['sim','true','1','y','yes'].some((v)=>freteRaw.includes(v));
                    const okFrete = !filterFreightFull || (filterFreightFull==='com' ? isFreteFull : !isFreteFull);
                    const operacao = String(o.raw_json?.operacoes || '').toLowerCase();
                    const okOper = !filterOperation || operacao.includes(filterOperation.toLowerCase());
                    return okCity && okNb && okFilial && okLocal && okSeller && okClient && okDept && okFrete && okOper;
                  }).map((order)=>{
                    const o:any = order;
                    const addr = o.address_json || {};
                    const raw = o.raw_json || {};
                    const data = new Date(o.created_at).toLocaleDateString('pt-BR');
                    const pedido = String(raw.lancamento_venda ?? o.order_id_erp ?? '');
                    const situacao = String(raw.situacao ?? 'Pendente');
                    const obsInternas = String(raw.observacoes_internas ?? '');
                    const obsPublicas = String((o as any).observacoes_publicas || raw.observacoes || '');
                    const endereco = [
                      String(addr.street || raw.destinatario_endereco || ''),
                      String(addr.neighborhood || raw.destinatario_bairro || ''),
                      String(addr.city || raw.destinatario_cidade || ''),
                      String(addr.state || ''),
                      String(addr.zip || raw.destinatario_cep || '')
                    ].filter(Boolean).join(', ').replace(', ,', ',');
                    const quantidade = Array.isArray(o.items_json) ? o.items_json.reduce((sum:any,it:any)=>sum + Number(it.quantity||0),0) : 0;
                    const valorNum = (Array.isArray(o.items_json) ? o.items_json.reduce((sum:any,it:any)=> sum + Number(it.total_price_real ?? it.total_price ?? (Number(it.unit_price_real ?? it.unit_price ?? 0) * Number(it.purchased_quantity ?? 1))), 0) : 0);
                    const valor = Number(valorNum||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    const cidade = String(addr.city || raw.destinatario_cidade || '');
                    const bairro = String(addr.neighborhood || raw.destinatario_bairro || '');
                    const filialVendaText = String(o.filial_venda || raw.filial_venda || '');
                    const locaisText = [
                      ...(Array.isArray(raw.produtos_locais) ? raw.produtos_locais.map((p:any)=>String(p?.local_estocagem||'')).filter(Boolean) : []),
                      ...(Array.isArray(raw.produtos) ? raw.produtos.map((p:any)=>String(p?.local_estoque||'')).filter(Boolean) : [])
                    ].join(' • ');
                    const values: Record<string, any> = {
                      data,
                      cliente: o.customer_name,
                      telefone: o.phone,
                      pedido,
                      situacao,
                      obsInternas,
                      obsPublicas,
                      endereco,
                      quantidade,
                      valor: `R$ ${valor}`,
                      cidade,
                      bairro,
                      filialVenda: filialVendaText,
                      localEstocagem: locaisText,
                    };
                    return (
                      <tr key={o.id} className={selectedOrders.has(o.id) ? 'bg-blue-50' : ''} onClick={()=>toggleOrderSelection(o.id)}>
                        <td className="px-2 py-2">
                          <input type="checkbox" className="h-4 w-4" checked={selectedOrders.has(o.id)} onChange={()=>toggleOrderSelection(o.id)} />
                        </td>
                        {columnsConf.filter(c=>c.visible).map(c=> (
                          <td key={`${o.id}-${c.id}`} className={`px-2 py-2 ${c.id==='obsInternas' || c.id==='obsPublicas' ? 'whitespace-pre-wrap' : ''}`}>{values[c.id]}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div ref={productsScrollRef} onMouseDown={onProductsMouseDown} onMouseMove={onProductsMouseMove} onMouseUp={endProductsDrag} onMouseLeave={endProductsDrag} className={`max-h-[480px] overflow-y-auto overflow-x-auto ${draggingProducts ? 'cursor-grabbing select-none' : 'cursor-grab'}`}>
              <table className="min-w-max text-sm whitespace-nowrap">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-2 py-2 text-left w-8"></th>
                    {columnsConf.filter(c=>c.visible).map(c=> (
                      <th key={c.id} className="px-2 py-2 text-left">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {(() => {
                    const rows: any[] = [];
                    for (const order of (orders||[])) {
                      const o:any = order; const addr = o.address_json || {}; const raw = o.raw_json || {};
                      const city = String(addr.city || raw.destinatario_cidade || '');
                      const nb = String(addr.neighborhood || raw.destinatario_bairro || '');
                      const filialVenda = String(o.filial_venda || raw.filial_venda || '');
                      const seller = String(o.vendedor_nome || raw.vendedor || raw.vendedor_nome || '');
                      const client = String(o.customer_name || '');
                      const okCity = !filterCity || city.toLowerCase().includes(filterCity.toLowerCase());
                      const okNb = !filterNeighborhood || nb.toLowerCase().includes(filterNeighborhood.toLowerCase());
                      const okFilial = !filterFilialVenda || filialVenda.toLowerCase().includes(filterFilialVenda.toLowerCase());
                      const okSeller = !filterSeller || seller.toLowerCase().includes(filterSeller.toLowerCase());
                      const okClient = !filterClient || client.toLowerCase().includes(filterClient.toLowerCase());
                      const freteRaw = String(o.tem_frete_full || raw.tem_frete_full || '').toLowerCase();
                      const isFreteFull = ['sim','true','1','y','yes'].some((v)=>freteRaw.includes(v));
                      const okFrete = !filterFreightFull || (filterFreightFull==='com' ? isFreteFull : !isFreteFull);
                      const operacao = String(raw.operacoes || '');
                      const okOper = !filterOperation || operacao.toLowerCase().includes(filterOperation.toLowerCase());
                      if (!(okCity && okNb && okFilial && okSeller && okClient && okFrete && okOper)) continue;
                      const locMap = new Map<string,string>(Array.isArray(raw.produtos_locais)? raw.produtos_locais.map((p:any)=> [String(p?.codigo_produto||'').toLowerCase(), String(p?.local_estocagem||'')]) : []);
                      const deptMap = new Map<string,string>(Array.isArray(raw.produtos_locais)? raw.produtos_locais.map((p:any)=> [String(p?.codigo_produto||'').toLowerCase(), String(p?.departamento||'')]) : []);
                      const brandMap = new Map<string,string>(Array.isArray(raw.produtos)? raw.produtos.map((p:any)=> [String(p?.codigo_produto||'').toLowerCase(), String(p?.marca||'')]) : []);
                      const items = Array.isArray(o.items_json) ? o.items_json : [];
                      const orderLocs = getOrderLocations(o);
                      for (const it of items) {
                        const sku = String(it?.sku||'');
                        const produto = String(it?.name || '');
                        const location = String(it?.location || locMap.get(sku.toLowerCase()) || '');
                        const dept = String(it?.department || deptMap.get(sku.toLowerCase()) || '');
                        const brand = String((it as any)?.brand || brandMap.get(sku.toLowerCase()) || '');
                        const quantidade = Number(it?.purchased_quantity ?? it?.quantity ?? 0);
                        const otherLocs = orderLocs.filter((l:string)=> l.toLowerCase() !== (filterLocalEstocagem||'').toLowerCase());
                        const okLocal = !filterLocalEstocagem || (!!location && location.toLowerCase().includes(filterLocalEstocagem.toLowerCase()));
                        const okDept = !filterDepartment || (!!dept && dept.toLowerCase().includes(filterDepartment.toLowerCase()));
                        if (!okLocal || !okDept) continue;
                        rows.push({
                          orderId: o.id,
                          data: new Date(o.created_at).toLocaleDateString('pt-BR'),
                          pedido: String(raw.lancamento_venda ?? o.order_id_erp ?? ''),
                          cliente: client,
                          telefone: String(o.phone || ''),
                          sku,
                          produto,
                          quantidade,
                          department: dept,
                          brand,
                          localEstocagem: location,
                          cidade: city,
                          bairro: nb,
                          filialVenda: filialVenda,
                          operacao,
                          vendedor: String(o.vendedor_nome || raw.vendedor || raw.vendedor_nome || ''),
                          situacao: String(raw.situacao || ''),
                          obsPublicas: String((o as any).observacoes_publicas || raw.observacoes || ''),
                          obsInternas: String(raw.observacoes_internas || ''),
                          endereco: [
                            String(addr.street || raw.destinatario_endereco || ''),
                            String(addr.neighborhood || raw.destinatario_bairro || ''),
                            String(addr.city || raw.destinatario_cidade || ''),
                            String(addr.state || ''),
                            String(addr.zip || raw.destinatario_cep || '')
                          ].filter(Boolean).join(', ').replace(', ,', ','),
                          outrosLocs: otherLocs,
                        });
                      }
                    }
                    return rows.map((r)=> {
                      const values: Record<string, any> = r;
                      return (
                        <tr key={`${r.orderId}-${r.sku}-${r.produto}`} className={selectedOrders.has(r.orderId) ? 'bg-blue-50' : ''} onClick={()=>toggleOrderSelection(r.orderId)}>
                          <td className="px-2 py-2">
                            <input type="checkbox" className="h-4 w-4" checked={selectedOrders.has(r.orderId)} onChange={()=>toggleOrderSelection(r.orderId)} />
                          </td>
                          {columnsConf.filter(c=>c.visible).map(c=> (
                            <td key={`${r.orderId}-${c.id}`} className={`px-2 py-2 ${c.id==='obsInternas' || c.id==='obsPublicas' ? 'whitespace-pre-wrap' : ''}`}>{Array.isArray(values[c.id]) ? values[c.id].join(' / ') : values[c.id]}</td>
                          ))}
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          )
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
              const conf = (route as any).conference;
              const confResolved = conf && conf.status === 'completed' && !conf.result_ok && conf.resolved_at;
              const confText = conf
                ? (conf.status === 'in_progress'
                    ? 'Em Conferência'
                    : (conf.result_ok
                        ? 'Conferência OK'
                        : (confResolved ? 'Divergência resolvida' : 'Conferência c/ divergência')))
                : 'Aguardando Conferência';
              const confClass = conf
                ? (conf.status === 'in_progress'
                    ? 'bg-indigo-100 text-indigo-800'
                    : (conf.result_ok
                        ? 'bg-green-100 text-green-800'
                        : (confResolved ? 'bg-teal-100 text-teal-800' : 'bg-red-100 text-red-800')))
                : 'bg-gray-100 text-gray-700';
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
                    <div>Motorista: {(route.driver as DriverWithUser)?.user?.name || route.driver?.name || '—'}</div>
                    {route.vehicle && (
                      <div>Veículo: {route.vehicle.model} • {route.vehicle.plate}</div>
                    )}
                    <div>Pedidos: {total} • Pendentes: {pendingCount} • Entregues: {delivered} • Retornos: {returned}</div>
                    <div>Criada em: {new Date(route.created_at).toLocaleDateString('pt-BR')}</div>
                    <div>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${confClass}`}>{confText}</span>
                      {conf?.finished_at && (
                        <span className="ml-2 text-xs text-gray-600">Finalizada: {new Date(conf.finished_at).toLocaleDateString('pt-BR')}</span>
                      )}
                    </div>
                  </div>
                  {conf && conf.status === 'completed' && (
                    <div className="mb-2">
                      <button
                        onClick={async () => {
                          try {
                            const { data: latest } = await supabase
                              .from('route_conferences')
                              .select('id, route_id, status, result_ok, finished_at, summary, created_at')
                              .eq('route_id', route.id)
                              .order('created_at', { ascending: false })
                              .limit(1)
                              .maybeSingle();
                            const enrichedRoute: any = { ...(route as any), conference: latest || conf };
                            setConferenceRoute(enrichedRoute);
                            setShowConferenceModal(true);
                          } catch {
                            const enrichedRoute: any = { ...(route as any), conference: conf };
                            setConferenceRoute(enrichedRoute);
                            setShowConferenceModal(true);
                          }
                        }}
                        className="w-full bg-purple-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-purple-700 transition-colors"
                      >
                        Revisar Conferência
                      </button>
                    </div>
                  )}
                  <button
                    onClick={async () => {
                      try {
                        selectedRouteIdRef.current = String(route.id);
                        localStorage.setItem('rc_selectedRouteId', String(route.id));
                        // fetch fresh route details to ensure delivered_at/returned_at
                        const { data: freshRO } = await supabase
                          .from('route_orders')
                          .select(`*, order:orders!order_id(*)`)
                          .eq('route_id', route.id)
                          .order('sequence');
                        const merged = { ...route } as any;
                        merged.route_orders = (freshRO || []) as any;
                        setSelectedRoute(merged as RouteWithDetails);
                      } catch {
                        setSelectedRoute(route);
                      }
                      showRouteModalRef.current = true;
                      localStorage.setItem('rc_showRouteModal','1');
                      setShowRouteModal(true);
                    }}
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

      {/* Conference Review Modal */}
      {showConferenceModal && conferenceRoute && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h4 className="text-lg font-semibold text-gray-900">Revisão de Conferência — {conferenceRoute.name}</h4>
              <button onClick={()=>setShowConferenceModal(false)} className="text-gray-500 hover:text-gray-700">Fechar</button>
            </div>
            <div className="p-6 overflow-y-auto">
              {(() => {
                const conf = (conferenceRoute as any).conference;
                const missing: Array<{ code: string; orderId?: string }> = conf?.summary?.missing || [];
                const notBiped: Array<{ orderId?: string; productCode?: string; reason?: string; notes?: string }> = conf?.summary?.notBipedProducts || [];
                const byOrder: Record<string, { codes: string[], order: any }> = {};
                (conferenceRoute.route_orders || []).forEach((ro:any)=>{
                  byOrder[String(ro.order_id)] = byOrder[String(ro.order_id)] || { codes: [], order: ro.order };
                });
                missing.forEach((m)=>{
                  const k = String(m.orderId || '');
                  if (!byOrder[k]) byOrder[k] = { codes: [], order: null } as any;
                  byOrder[k].codes.push(m.code);
                });
                // Append not-biped products info textually
                const byOrderProducts: Record<string, Array<{ productCode?: string; reason?: string; notes?: string }>> = {};
                notBiped.forEach((p)=>{
                  const k = String(p.orderId || '');
                  byOrderProducts[k] = byOrderProducts[k] || [];
                  byOrderProducts[k].push({ productCode: p.productCode, reason: p.reason, notes: p.notes });
                });
                const authUser = useAuthStore.getState().user;
                const markResolved = async (removedIds: string[]) => {
                  try {
                    if (!conf?.id) { toast.error('Conferência não encontrada'); return; }
                    const resolutionPayload = { removedOrderIds: removedIds, missingLabelsByOrder: Object.keys(byOrder).reduce((acc:any,k)=>{ if ((byOrder[k]?.codes||[]).length>0) acc[k] = byOrder[k].codes; return acc; }, {}), notBipedByOrder: byOrderProducts };
                    const { error: updErr } = await supabase
                      .from('route_conferences')
                      .update({ resolved_at: new Date().toISOString(), resolved_by: authUser?.id || null, resolution: resolutionPayload })
                      .eq('id', conf.id);
                    if (updErr) throw updErr;
                    toast.success('Divergência marcada como resolvida');
                    setShowConferenceModal(false);
                    loadData();
                  } catch (e:any) {
                    console.error(e);
                    toast.error('Erro ao marcar divergência como resolvida');
                  }
                };
                const orderIds = Object.keys(byOrder).filter(k => byOrder[k].codes.length > 0);
                if (orderIds.length === 0) {
                  // Se não há etiquetas faltantes, pode haver produtos não bipados
                  const pIds = Object.keys(byOrderProducts).filter(k => (byOrderProducts[k] || []).length > 0);
                  if (pIds.length === 0) return <div className="text-sm text-gray-700">Sem faltantes. Conferência OK.</div>;
                  return (
                    <div className="space-y-4">
                      {pIds.map((oid)=>{
                        const info = byOrder[String(oid)] || { order: null, codes: [] } as any;
                        const cliente = info.order?.customer_name || '—';
                        const pedido = info.order?.order_id_erp || '—';
                        const endereco = info.order?.address_json ? `${info.order.address_json.street || ''}${info.order.address_json.number ? ', '+info.order.address_json.number : ''} - ${info.order.address_json.neighborhood || ''} - ${info.order.address_json.city || ''}` : '—';
                        const products = byOrderProducts[oid] || [];
                        return (
                          <div key={oid} className="border rounded-md">
                            <div className="px-4 py-2 bg-gray-50 border-b">
                              <div className="font-semibold text-gray-900">Pedido: {pedido} • Cliente: {cliente}</div>
                              <div className="text-xs text-gray-600">Endereço: {endereco}</div>
                            </div>
                            <div className="p-4">
                              <div className="text-sm font-medium text-gray-900 mb-2">Produtos não bipados ({products.length}):</div>
                              <ul className="text-sm text-gray-700 list-disc ml-5">
                                {products.map((p, idx)=>(
                                  <li key={idx}>Produto: {p.productCode || '—'} • Motivo: {p.reason || '—'} {p.notes ? `• Obs: ${p.notes}` : ''}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex justify-end space-x-3">
                        <button
                          onClick={async ()=>{
                            try {
                              const ids = pIds.filter(Boolean);
                              if (ids.length === 0) return;
                              const rid = String(conferenceRoute.id);
                              const { error: delErr } = await supabase
                                .from('route_orders')
                                .delete()
                                .eq('route_id', rid)
                                .in('order_id', ids);
                              if (delErr) throw delErr;
                              const { error: updErr } = await supabase
                                .from('orders')
                                .update({ status: 'pending' })
                                .in('id', ids);
                              if (updErr) throw updErr;
                              toast.success('Pedidos removidos da rota');
                              setShowConferenceModal(false);
                              loadData();
                            } catch (e:any) {
                              console.error(e);
                              toast.error('Erro ao remover pedidos da rota');
                            }
                          }}
                          className="px-4 py-2 bg-red-600 text-white rounded-md"
                        >Remover pedidos não bipados da rota</button>
                        <button
                          onClick={()=>{
                            const ids = pIds.filter(Boolean);
                            markResolved(ids);
                          }}
                          className="px-4 py-2 bg-teal-600 text-white rounded-md"
                        >Resolver Divergência</button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div className="space-y-4">
                    {orderIds.map((oid)=>{
                      const info = byOrder[oid];
                      const cliente = info.order?.customer_name || '—';
                      const pedido = info.order?.order_id_erp || '—';
                      const endereco = info.order?.address_json ? `${info.order.address_json.street || ''}${info.order.address_json.number ? ', '+info.order.address_json.number : ''} - ${info.order.address_json.neighborhood || ''} - ${info.order.address_json.city || ''}` : '—';
                      return (
                        <div key={oid} className="border rounded-md">
                          <div className="px-4 py-2 bg-gray-50 border-b">
                            <div className="font-semibold text-gray-900">Pedido: {pedido} • Cliente: {cliente}</div>
                            <div className="text-xs text-gray-600">Endereço: {endereco}</div>
                          </div>
                          <div className="p-4">
                            <div className="text-sm font-medium text-gray-900 mb-2">Volumes faltantes ({info.codes.length}):</div>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                              {info.codes.map((c, idx)=>(
                                <div key={`${c}-${idx}`} className="text-xs px-2 py-2 rounded border bg-red-50 border-red-200 text-red-700">{c}</div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex justify-end space-x-3">
                      <button
                        onClick={async ()=>{
                          try {
                            const ids = orderIds.filter(Boolean);
                            if (ids.length === 0) return;
                            const rid = String(conferenceRoute.id);
                            const { error: delErr } = await supabase
                              .from('route_orders')
                              .delete()
                              .eq('route_id', rid)
                              .in('order_id', ids);
                            if (delErr) throw delErr;
                            const { error: updErr } = await supabase
                              .from('orders')
                              .update({ status: 'pending' })
                              .in('id', ids);
                            if (updErr) throw updErr;
                            toast.success('Pedidos faltantes removidos da rota');
                            setShowConferenceModal(false);
                            loadData();
                          } catch (e:any) {
                            console.error(e);
                            toast.error('Erro ao remover pedidos da rota');
                          }
                        }}
                        className="px-4 py-2 bg-red-600 text-white rounded-md"
                      >Remover pedidos faltantes da rota</button>
                      <button
                        onClick={()=>{
                          const ids = orderIds.filter(Boolean);
                          markResolved(ids);
                        }}
                        className="px-4 py-2 bg-teal-600 text-white rounded-md"
                      >Resolver Divergência</button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      

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
                <div><span className="font-medium">Motorista:</span> {(selectedRoute.driver as DriverWithUser)?.user?.name || selectedRoute.driver?.name || '—'}</div>
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
                          const formatDT = (s?: string) => s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
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
                  <select value={conferente} onChange={(e)=>setConferente(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md">
                    <option value="">Selecione</option>
                    {conferentes.map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                  </select>
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
      {mixedConfirmOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h4 className="text-lg font-semibold text-gray-900">Pedidos com outros locais</h4>
              <button className="text-gray-600 hover:text-gray-900" onClick={()=> setMixedConfirmOpen(false)}>Fechar</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="text-sm text-gray-700">{`Os pedidos selecionados abaixo possuem itens fora de ${filterLocalEstocagem}. A rota e o romaneio incluirão todos os itens do pedido.`}</div>
              <div className="space-y-2">
                {mixedConfirmOrders.map((m)=> (
                  <div key={m.id} className="flex items-center justify-between border rounded px-3 py-2 text-sm">
                    <div>{`Pedido ${m.pedido}`}</div>
                    <div className="text-gray-600">{m.otherLocs.join(' / ')}</div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end space-x-3">
                <button className="px-4 py-2 border border-gray-300 rounded-md" onClick={()=> setMixedConfirmOpen(false)}>Voltar</button>
                <button className="px-4 py-2 bg-blue-600 text-white rounded-md" onClick={()=>{ setMixedConfirmOpen(false); if (mixedConfirmAction==='create') createRoute(); }}>Entendi, continuar</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showColumnsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow w-full max-w-lg max-h-[85vh] overflow-hidden">
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <div className="font-semibold text-gray-900">Configurar colunas</div>
              <button className="text-gray-600 hover:text-gray-900" onClick={()=> setShowColumnsModal(false)}>Fechar</button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto max-h-[65vh]">
              {columnsConf.map((c, idx)=> (
                <div key={c.id} className="flex items-center justify-between border rounded px-3 py-2">
                  <label className="flex items-center space-x-2">
                    <input type="checkbox" checked={c.visible} onChange={()=>{
                      const next = [...columnsConf];
                      next[idx] = { ...next[idx], visible: !next[idx].visible };
                      setColumnsConf(next);
                    }} />
                    <span className="text-sm text-gray-800">{c.label}</span>
                  </label>
                  <div className="space-x-2">
                    <button className="px-2 py-1 border rounded" onClick={()=>{
                      if (idx === 0) return;
                      const next = [...columnsConf];
                      const [cur] = next.splice(idx,1);
                      next.splice(idx-1,0,cur);
                      setColumnsConf(next);
                    }}>↑</button>
                    <button className="px-2 py-1 border rounded" onClick={()=>{
                      if (idx === columnsConf.length-1) return;
                      const next = [...columnsConf];
                      const [cur] = next.splice(idx,1);
                      next.splice(idx+1,0,cur);
                      setColumnsConf(next);
                    }}>↓</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t flex justify-end">
              <button className="px-3 py-2 border rounded" onClick={()=>{
                localStorage.setItem('rc_columns_conf', JSON.stringify(columnsConf));
                setShowColumnsModal(false);
              }}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      </div>
  );
}
