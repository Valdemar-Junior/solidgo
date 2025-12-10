import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft,
  Plus, 
  Calendar, 
  User as UserIcon, 
  MapPin, 
  Package, 
  CheckCircle, 
  Clock, 
  AlertCircle,
  Search,
  Filter,
  FileText,
  MoreVertical,
  Truck,
  X,
  ChevronDown,
  ChevronUp,
  Edit,
  Trash2,
  Settings
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';
import { AssemblyRoute, AssemblyProductWithDetails, User, Vehicle } from '../../types/database';
import { DeliverySheetGenerator, type DeliverySheetData } from '../../utils/pdf/deliverySheetGenerator';

export default function AssemblyManagement() {
  const navigate = useNavigate();
  // State
  const [assemblyRoutes, setAssemblyRoutes] = useState<AssemblyRoute[]>([]);
  const [assemblyProducts, setAssemblyProducts] = useState<AssemblyProductWithDetails[]>([]);
  const [montadores, setMontadores] = useState<User[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showRouteEditModal, setShowRouteEditModal] = useState(false);
  const [showRouteManageModal, setShowRouteManageModal] = useState(false);
  const [showRouteDetailsModal, setShowRouteDetailsModal] = useState(false);

  // Form Data
  const [newRouteName, setNewRouteName] = useState('');
  const [newRouteDeadline, setNewRouteDeadline] = useState('');
  const [newRouteObservations, setNewRouteObservations] = useState('');
  const [selectedMontadorId, setSelectedMontadorId] = useState<string>('');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');
  
  // Edit Data
  const [routeBeingEdited, setRouteBeingEdited] = useState<AssemblyRoute | null>(null);
  const [editRouteName, setEditRouteName] = useState('');
  const [editRouteDeadline, setEditRouteDeadline] = useState('');
  const [editRouteObservations, setEditRouteObservations] = useState('');
  const [editAssemblerId, setEditAssemblerId] = useState('');
  const [editVehicleId, setEditVehicleId] = useState('');
  
  // Selection & Management
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [selectedLancamentos, setSelectedLancamentos] = useState<string[]>([]);
  const [routeBeingManaged, setRouteBeingManaged] = useState<AssemblyRoute | null>(null);
  const [selectedToRemove, setSelectedToRemove] = useState<string[]>([]);
  const [selectedToAdd, setSelectedToAdd] = useState<string[]>([]);
  const [routeDetails, setRouteDetails] = useState<{ route: AssemblyRoute, products: any[] } | null>(null);
  const [detailsItem, setDetailsItem] = useState<any | null>(null);

  // Filters
  const [filterCidade, setFilterCidade] = useState('');
  const [filterBairro, setFilterBairro] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Derived Data
  const [availableProducts, setAvailableProducts] = useState<any[]>([]);
  const [groupedProducts, setGroupedProducts] = useState<Record<string, any[]>>({});
  const [deliveryInfo, setDeliveryInfo] = useState<Record<string, { date?: string; driver?: string }>>({});

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '-';
      return d.toLocaleDateString('pt-BR');
    } catch {
      return '-';
    }
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Buscar romaneios de montagem
      const { data: routesData } = await supabase
        .from('assembly_routes')
        .select('*')
        .order('created_at', { ascending: false });
      
      // Buscar produtos de montagem com detalhes do pedido
      const { data: productsData } = await supabase
        .from('assembly_products')
        .select(`
          *,
          order:order_id (*),
          installer:installer_id (*)
        `)
        .order('created_at', { ascending: false });
      
      // Buscar montadores (usuários com perfil montador)
      const { data: montadoresData } = await supabase
        .from('users')
        .select('*')
        .eq('role', 'montador');

      const { data: vehiclesData } = await supabase
        .from('vehicles')
        .select('*')
        .eq('active', true);
      
      // Produtos pendentes e sem romaneio (assembly_route_id nulo)
      const pendingUnrouted = (productsData || []).filter((p: any) => p.status === 'pending' && !p.assembly_route_id);

      // Agrupar por número de lançamento do pedido (order_id_erp)
      const groupedByLancamento = pendingUnrouted.reduce((groups: any, ap: any) => {
        const order = ap.order || {};
        const numLancamento = order.order_id_erp || 'Sem Número';
        if (!groups[numLancamento]) groups[numLancamento] = [];
        groups[numLancamento].push(ap);
        return groups;
      }, {});

      // Montar informações de entrega
      const orderIds = pendingUnrouted.map((ap: any) => ap.order_id);
      let deliveryByOrderId: Record<string, { date?: string; driver?: string }> = {};
      if (orderIds.length > 0) {
        const { data: roDelivered } = await supabase
          .from('route_orders')
          .select('order_id, delivered_at, route_id, status')
          .in('order_id', orderIds)
          .eq('status', 'delivered');

        const routeIds = Array.from(new Set((roDelivered || []).map((r: any) => r.route_id).filter(Boolean)));
        let routesMap: Record<string, any> = {};
        if (routeIds.length > 0) {
          const { data: routes } = await supabase
            .from('routes')
            .select('id, driver_id')
            .in('id', routeIds);
          (routes || []).forEach((r: any) => { routesMap[r.id] = r; });

          const driverIds = Array.from(new Set((routes || []).map((r: any) => r.driver_id).filter(Boolean)));
          let driverNameById: Record<string, string> = {};
          if (driverIds.length > 0) {
            const { data: drivers } = await supabase
              .from('drivers')
              .select('id, name, user_id')
              .in('id', driverIds);
            const userIds = Array.from(new Set((drivers || []).map((d: any) => d.user_id).filter(Boolean)));
            const { data: users } = userIds.length > 0 ? await supabase
              .from('users')
              .select('id, name')
              .in('id', userIds) : { data: [] } as any;
            const userNameById: Record<string, string> = {};
            (users || []).forEach((u: any) => { userNameById[u.id] = u.name; });
            (drivers || []).forEach((d: any) => {
              driverNameById[d.id] = d.name || userNameById[d.user_id] || '—';
            });

            (roDelivered || []).forEach((ro: any) => {
              const route = routesMap[ro.route_id];
              const driverName = route ? driverNameById[route.driver_id] : undefined;
              deliveryByOrderId[ro.order_id] = { date: ro.delivered_at, driver: driverName };
            });
          }
        }
      }

      setAssemblyRoutes(routesData || []);
      setAssemblyProducts(productsData || []);
      setMontadores(montadoresData || []);
      setVehicles(vehiclesData || []);
      setAvailableProducts(pendingUnrouted || []);
      setGroupedProducts(groupedByLancamento);
      setDeliveryInfo(deliveryByOrderId);
      
      // Expand all groups by default
      const initialExpanded: Record<string, boolean> = {};
      Object.keys(groupedByLancamento).forEach(key => initialExpanded[key] = true);
      setExpandedGroups(initialExpanded);
      
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      toast.error('Erro ao carregar dados de montagem');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Realtime: when a delivery is marked as delivered, refresh assembly view
  useEffect(() => {
    try {
      const channel = supabase
        .channel('assembly-realtime')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'route_orders' }, (payload: any) => {
          const st = String((payload?.new || {})?.status || '').toLowerCase();
          if (st === 'delivered') {
            fetchData();
          }
        })
        .subscribe();

      return () => { try { channel.unsubscribe(); } catch {} };
    } catch {}
  }, []);

  // Actions
  const createAssemblyRoute = async () => {
    if (!newRouteName.trim()) {
      toast.error('Por favor, informe um nome para o romaneio');
      return;
    }
    
    if (selectedProducts.length === 0) {
      toast.error('Por favor, selecione pelo menos um produto');
      return;
    }

    try {
      const vehiclePlate = vehicles.find(v => v.id === selectedVehicleId)?.plate;
      const observationsJoined = [newRouteObservations?.trim() || '', vehiclePlate ? `Veículo: ${vehiclePlate}` : '']
        .filter(Boolean)
        .join('\n') || null;
      const { data: routeData, error: routeError } = await supabase
        .from('assembly_routes')
        .insert({
          name: newRouteName,
          deadline: newRouteDeadline || null,
          observations: observationsJoined,
          assembler_id: selectedMontadorId || null,
          vehicle_id: selectedVehicleId || null,
          status: 'pending'
        })
        .select()
        .single();

      if (routeError) throw routeError;

      if (selectedMontadorId) {
        const { error: updateError } = await supabase
          .from('assembly_products')
          .update({ assembly_route_id: routeData.id, installer_id: selectedMontadorId })
          .in('id', selectedProducts);
        if (updateError) throw updateError;
      } else {
        const { error: updateError } = await supabase
          .from('assembly_products')
          .update({ assembly_route_id: routeData.id })
          .in('id', selectedProducts);
        if (updateError) throw updateError;
      }

      

      try {
        const userId = (await supabase.auth.getUser()).data.user?.id || '';
        await supabase.from('audit_logs').insert({
          entity_type: 'assembly_route',
          entity_id: routeData.id,
          action: 'created',
          details: { products_count: selectedProducts.length, deadline: newRouteDeadline || null },
          user_id: userId,
          timestamp: new Date().toISOString(),
        });
      } catch {}

      toast.success('Romaneio de montagem criado com sucesso!');
      setShowCreateModal(false);
      setNewRouteName('');
      setNewRouteDeadline('');
      setNewRouteObservations('');
      setSelectedMontadorId('');
      setSelectedVehicleId('');
      setSelectedProducts([]);
      setSelectedLancamentos([]);
      fetchData();
      
    } catch (error) {
      console.error('Erro ao criar romaneio:', error);
      toast.error('Erro ao criar romaneio de montagem');
    }
  };

  const handleLancamentoSelection = (lancamento: string, checked: boolean) => {
    if (checked) {
      const productsInLancamento = groupedProducts[lancamento] || [];
      const productIds = productsInLancamento.map((p: any) => p.id);
      setSelectedProducts(prev => [...new Set([...prev, ...productIds])]);
      setSelectedLancamentos(prev => [...prev, lancamento]);
    } else {
      const productsInLancamento = groupedProducts[lancamento] || [];
      const productIds = productsInLancamento.map((p: any) => p.id);
      setSelectedProducts(prev => prev.filter(id => !productIds.includes(id)));
      setSelectedLancamentos(prev => prev.filter(l => l !== lancamento));
    }
  };

  const handleProductSelection = (productId: string, checked: boolean) => {
    if (checked) {
      setSelectedProducts(prev => [...prev, productId]);
    } else {
      setSelectedProducts(prev => prev.filter(id => id !== productId));
    }
  };

  const saveEditedRoute = async () => {
    if (!routeBeingEdited) return;
    try {
      const { error } = await supabase
        .from('assembly_routes')
        .update({
          name: editRouteName,
          deadline: editRouteDeadline || null,
          observations: editRouteObservations || null,
          assembler_id: editAssemblerId || null,
          vehicle_id: editVehicleId || null
        })
        .eq('id', routeBeingEdited.id);
      if (error) throw error;
      toast.success('Romaneio atualizado');
      setShowRouteEditModal(false);
      fetchData();
    } catch (e) {
      console.error(e);
      toast.error('Erro ao atualizar romaneio');
    }
  };

  const removeSelectedProductsFromRoute = async () => {
    if (!routeBeingManaged || selectedToRemove.length === 0) return;
    try {
      const { error } = await supabase
        .from('assembly_products')
        .update({ assembly_route_id: null })
        .in('id', selectedToRemove);
      if (error) throw error;
      toast.success('Produtos removidos do romaneio');
      setSelectedToRemove([]);
      fetchData();
    } catch (e) {
      console.error(e);
      toast.error('Erro ao remover produtos');
    }
  };

  const addSelectedProductsToRoute = async () => {
    if (!routeBeingManaged || selectedToAdd.length === 0) return;
    try {
      const { error } = await supabase
        .from('assembly_products')
        .update({ assembly_route_id: routeBeingManaged.id })
        .in('id', selectedToAdd);
      if (error) throw error;
      toast.success('Produtos adicionados ao romaneio');
      setSelectedToAdd([]);
      fetchData();
    } catch (e) {
      console.error(e);
      toast.error('Erro ao adicionar produtos');
    }
  };

  const generateRoutePdf = async (route: AssemblyRoute) => {
    try {
      const products = assemblyProducts.filter(p => p.assembly_route_id === route.id);
      const orders = products.map(p => p.order).filter(Boolean) as any[];

      const routeOrders = products.map((p, idx) => ({
        id: String(p.id),
        route_id: String(route.id),
        order_id: String(p.order_id),
        sequence: idx + 1,
        status: 'pending',
        created_at: route.created_at,
        updated_at: route.updated_at
      })) as any[];

      const routeData: any = {
        id: route.id,
        name: route.name,
        driver_id: '',
        vehicle_id: '',
        conferente: '',
        observations: route.observations,
        status: route.status as any,
        created_at: route.created_at,
        updated_at: route.updated_at,
      };

      // Derivar montador e veículo (placa) para o romaneio de montagem
      const installerNames = Array.from(new Set(products.map(p => (p as any)?.installer?.name).filter(Boolean))) as string[];
      const assemblyInstallerName = installerNames.length === 1 ? installerNames[0] : (installerNames.length > 1 ? 'Vários' : '—');
      const obsStr = String(route.observations || '');
      const plateMatch = obsStr.match(/Placa\s*:\s*([A-Za-z0-9-]+)/i) || obsStr.match(/Ve[ií]culo\s*:\s*([A-Za-z0-9-]+)/i);
      const assemblyVehiclePlate = plateMatch ? plateMatch[1] : '';
      const vehicleModel = assemblyVehiclePlate ? (vehicles.find(v => String(v.plate).toUpperCase() === String(assemblyVehiclePlate).toUpperCase())?.model || '') : '';
      const data: DeliverySheetData = {
        route: routeData,
        routeOrders: routeOrders as any,
        driver: { id: '', user_id: '', cpf: '', active: true, name: '—', user: { id: '', email: '', name: '—', role: 'driver', created_at: new Date().toISOString() } } as any,
        vehicle: undefined,
        orders: orders as any,
        generatedAt: new Date().toISOString(),
        assemblyInstallerName,
        assemblyVehicleModel: vehicleModel,
        assemblyVehiclePlate,
      };

      const pdfBytes = await DeliverySheetGenerator.generateDeliverySheet(data, 'Romaneio de Montagem');
      DeliverySheetGenerator.openPDFInNewTab(pdfBytes);
    } catch (e) {
      console.error(e);
      toast.error('Erro ao gerar PDF do romaneio');
    }
  };

  // Filter Logic
  const filteredProducts = useMemo(() => {
    const filtered: Record<string, any[]> = {};
    Object.entries(groupedProducts).forEach(([lancamento, products]) => {
      const filteredList = (products || []).filter((ap: any) => {
        const addr = ap.order?.address_json || {};
        const city = (addr.city || '').toLowerCase();
        const bairro = (addr.neighborhood || '').toLowerCase();
        const matchCidade = filterCidade ? city.includes(filterCidade.toLowerCase()) : true;
        const matchBairro = filterBairro ? bairro.includes(filterBairro.toLowerCase()) : true;
        return matchCidade && matchBairro;
      });
      if (filteredList.length > 0) {
        filtered[lancamento] = filteredList;
      }
    });
    return filtered;
  }, [groupedProducts, filterCidade, filterBairro]);

  const uniqueCidades = useMemo(() => {
    const cidades = new Set<string>();
    Object.values(groupedProducts).forEach(products => {
      products.forEach((ap: any) => {
        const city = ap.order?.address_json?.city;
        if (city) cidades.add(city);
      });
    });
    return Array.from(cidades).sort();
  }, [groupedProducts]);

  const uniqueBairros = useMemo(() => {
    const bairros = new Set<string>();
    Object.values(groupedProducts).forEach(products => {
      products.forEach((ap: any) => {
        const bairro = ap.order?.address_json?.neighborhood;
        if (bairro) bairros.add(bairro);
      });
    });
    return Array.from(bairros).sort();
  }, [groupedProducts]);

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  };

  // Render Helpers
  const StatusBadge = ({ status }: { status: string }) => {
    const styles = {
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      assigned: 'bg-blue-100 text-blue-800 border-blue-200',
      in_progress: 'bg-orange-100 text-orange-800 border-orange-200',
      completed: 'bg-green-100 text-green-800 border-green-200',
      cancelled: 'bg-red-100 text-red-800 border-red-200',
      default: 'bg-gray-100 text-gray-800 border-gray-200'
    };
    
    const labels = {
      pending: 'Pendente',
      assigned: 'Atribuído',
      in_progress: 'Em Andamento',
      completed: 'Concluído',
      cancelled: 'Cancelado'
    };

    const style = styles[status as keyof typeof styles] || styles.default;
    const label = labels[status as keyof typeof labels] || status;

    return (
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${style}`}>
        {label}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-500 font-medium">Carregando dados de montagem...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate(-1)} 
            className="p-2 -ml-2 hover:bg-gray-200 rounded-lg text-gray-600 transition-colors"
            title="Voltar"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Package className="h-7 w-7 text-blue-600" />
              Gestão de Montagem
            </h1>
            <p className="text-gray-600 mt-1">
              Gerencie romaneios, atribua montadores e acompanhe o status das montagens.
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          disabled={selectedProducts.length === 0}
          className="inline-flex items-center px-5 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all hover:shadow-md"
        >
          <Plus className="h-5 w-5 mr-2" />
          Criar Romaneio ({selectedProducts.length})
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {[
          { 
            label: 'Total Produtos', 
            value: assemblyProducts.length, 
            icon: Package, 
            color: 'text-blue-600', 
            bg: 'bg-blue-50' 
          },
          { 
            label: 'Pendentes', 
            value: assemblyProducts.filter(p => p.status === 'pending').length, 
            icon: Clock, 
            color: 'text-yellow-600', 
            bg: 'bg-yellow-50' 
          },
          { 
            label: 'Em Andamento', 
            value: assemblyProducts.filter(p => p.status === 'in_progress').length, 
            icon: UserIcon, 
            color: 'text-orange-600', 
            bg: 'bg-orange-50' 
          },
          { 
            label: 'Concluídos', 
            value: assemblyProducts.filter(p => p.status === 'completed').length, 
            icon: CheckCircle, 
            color: 'text-green-600', 
            bg: 'bg-green-50' 
          },
        ].map((stat, idx) => (
          <div key={idx} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center transition-transform hover:scale-[1.01]">
            <div className={`p-3 rounded-lg ${stat.bg} mr-4`}>
              <stat.icon className={`h-6 w-6 ${stat.color}`} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">{stat.label}</p>
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Products List (60% width on large screens) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-[800px]">
            {/* Filter Header */}
            <div className="p-5 border-b border-gray-100 bg-gray-50/50 rounded-t-xl space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Package className="h-5 w-5 text-gray-500" />
                  Produtos para Montagem
                </h2>
                <span className="text-sm font-medium px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full">
                  {Object.values(filteredProducts).reduce((acc, curr) => acc + curr.length, 0)} itens
                </span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <select
                    value={filterCidade}
                    onChange={(e) => setFilterCidade(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                  >
                    <option value="">Todas as Cidades</option>
                    {uniqueCidades.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="relative">
                  <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <select
                    value={filterBairro}
                    onChange={(e) => setFilterBairro(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                  >
                    <option value="">Todos os Bairros</option>
                    {uniqueBairros.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Products List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2 bg-gray-50">
              {Object.keys(filteredProducts).length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <Package className="h-16 w-16 mb-4 opacity-20" />
                  <p className="font-medium">Nenhum produto encontrado</p>
                  <p className="text-sm opacity-70">Ajuste os filtros ou aguarde novos pedidos</p>
                </div>
              ) : (
                Object.entries(filteredProducts).map(([lancamento, products]) => (
                  <div key={lancamento} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    {/* Group Header */}
                    <div 
                      className="px-4 py-3 bg-white border-b border-gray-100 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => toggleGroup(lancamento)}
                    >
                      <div className="flex items-center gap-3">
                        <div 
                          className="p-1 hover:bg-gray-200 rounded"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selectedLancamentos.includes(lancamento)}
                            onChange={(e) => handleLancamentoSelection(lancamento, e.target.checked)}
                            className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-900">Lançamento: {lancamento}</p>
                          <p className="text-xs text-gray-500">{products.length} produtos</p>
                        </div>
                      </div>
                      <button className="text-gray-400">
                        {expandedGroups[lancamento] ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                      </button>
                    </div>

                    {/* Group Items */}
                    {expandedGroups[lancamento] && (
                      <div className="divide-y divide-gray-100">
                        {products.map((ap: any) => {
                          const order = ap.order || {};
                          const addr = order.address_json || {};
                          return (
                            <div key={ap.id} className="p-4 hover:bg-blue-50/30 transition-colors flex gap-3 group">
                              <div className="pt-1">
                                <input
                                  type="checkbox"
                                  checked={selectedProducts.includes(ap.id)}
                                  onChange={(e) => handleProductSelection(ap.id, e.target.checked)}
                                  className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-start">
                                  <div>
                                    <h4 className="text-sm font-semibold text-gray-900 truncate pr-2">
                                      {ap.product_name}
                                    </h4>
                                    <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                                      <UserIcon className="h-3 w-3" />
                                      <span className="truncate max-w-[150px]">{ap.customer_name}</span>
                                    </div>
                                  </div>
                                  <button 
                                    onClick={() => { setDetailsItem(ap); setShowDetailsModal(true); }}
                                    className="text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <FileText className="h-4 w-4" />
                                  </button>
                                </div>

                                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600 bg-gray-50 p-2 rounded border border-gray-100">
                                  <div className="flex items-center gap-1">
                                    <MapPin className="h-3 w-3 text-gray-400" />
                                    <span className="truncate">{addr.city} - {addr.neighborhood}</span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Calendar className="h-3 w-3 text-gray-400" />
                                    <span>
                                      Entrega: {formatDate(deliveryInfo[ap.order_id]?.date || order.previsao_entrega)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Assembly Routes (40% width) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-[800px]">
             <div className="p-5 border-b border-gray-100 rounded-t-xl flex justify-between items-center bg-gray-50/50">
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Truck className="h-5 w-5 text-gray-500" />
                  Romaneios Criados
                </h2>
                <span className="text-sm font-medium px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full">
                  {assemblyRoutes.length}
                </span>
             </div>

             <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
                {assemblyRoutes.length === 0 ? (
                   <div className="flex flex-col items-center justify-center h-full text-gray-400">
                      <Truck className="h-16 w-16 mb-4 opacity-20" />
                      <p className="font-medium">Nenhum romaneio criado</p>
                   </div>
                ) : (
                  assemblyRoutes.map(route => {
                    const productsInRoute = assemblyProducts.filter(p => p.assembly_route_id === route.id);
                    const pendingCount = productsInRoute.filter(p => p.status === 'pending').length;
                    const installerNames = Array.from(new Set(productsInRoute.map(p => (p as any)?.installer?.name).filter(Boolean))) as string[];
                    let installerLabel = installerNames.length === 1 ? installerNames[0] : (installerNames.length > 1 ? 'Vários' : '—');
                    if ((route as any).assembler_id) {
                      const m = montadores.find(m => m.id === (route as any).assembler_id);
                      installerLabel = m?.name || m?.email || installerLabel;
                    }
                    let plate = '';
                    if ((route as any).vehicle_id) {
                      const v = vehicles.find(v => v.id === (route as any).vehicle_id);
                      plate = v?.plate || '';
                    } else {
                      const obsStr = String(route.observations || '');
                      const plateMatch = obsStr.match(/Placa\s*:\s*([A-Za-z0-9-]+)/i) || obsStr.match(/Ve[ií]culo\s*:\s*([A-Za-z0-9-]+)/i);
                      plate = plateMatch ? plateMatch[1] : '';
                    }
                    
                    return (
                      <div key={route.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow group">
                         <div className="flex justify-between items-start mb-3">
                            <div>
                               <h3 className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
                                 {route.name}
                               </h3>
                               <p className="text-xs text-gray-500 mt-1">
                                 Criado em {formatDate(route.created_at)}
                               </p>
                            </div>
                            <StatusBadge status={route.status} />
                         </div>
                         
                         <div className="flex flex-wrap items-center gap-2 mb-4 text-sm text-gray-600 bg-gray-50 p-2 rounded">
                            <Package className="h-4 w-4" />
                            <span>{productsInRoute.length} produtos</span>
                            <span className="text-gray-300">|</span>
                            <span className={pendingCount > 0 ? 'text-yellow-600 font-medium' : 'text-green-600'}>
                              {pendingCount} pendentes
                            </span>
                            <span className="text-gray-300">|</span>
                            <UserIcon className="h-4 w-4" />
                            <span>Montador: {installerLabel}</span>
                            {plate && (<>
                              <span className="text-gray-300">|</span>
                              <Truck className="h-4 w-4" />
                              <span>Veículo: {plate}</span>
                            </>)}
                         </div>

                         <div className="grid grid-cols-2 gap-2">
                           <button
                             onClick={() => {
                               setRouteDetails({ route, products: productsInRoute });
                               setShowRouteDetailsModal(true);
                             }}
                             className="w-full py-2 px-3 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                           >
                             Detalhes
                           </button>
                           <button
                             onClick={() => generateRoutePdf(route)}
                             className="w-full py-2 px-3 bg-blue-50 border border-blue-100 text-blue-700 text-sm font-medium rounded-lg hover:bg-blue-100 transition-colors flex items-center justify-center gap-2"
                           >
                             <FileText className="h-4 w-4" />
                             PDF
                           </button>
                         </div>
                      </div>
                    );
                  })
                )}
             </div>
          </div>
        </div>
      </div>

      {/* --- MODALS --- */}

      {/* Create Route Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">Criar Romaneio</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Romaneio</label>
                <input
                  type="text"
                  value={newRouteName}
                  onChange={(e) => setNewRouteName(e.target.value)}
                  placeholder="Ex: Montagem Zona Sul - 12/12"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prazo de Conclusão</label>
                <input
                  type="date"
                  value={newRouteDeadline}
                  onChange={(e) => setNewRouteDeadline(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
                <textarea
                  value={newRouteObservations}
                  onChange={(e) => setNewRouteObservations(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Montador</label>
                  <select
                    value={selectedMontadorId}
                    onChange={(e) => setSelectedMontadorId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                  >
                    <option value="">Selecionar montador</option>
                    {montadores.map(m => (
                      <option key={m.id} value={m.id}>{m.name || m.email}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Veículo</label>
                  <select
                    value={selectedVehicleId}
                    onChange={(e) => setSelectedVehicleId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                  >
                    <option value="">Selecionar veículo</option>
                    {vehicles.map(v => (
                      <option key={v.id} value={v.id}>{v.plate} — {v.model}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="bg-blue-50 p-3 rounded-lg flex items-center gap-3">
                 <Package className="h-5 w-5 text-blue-600" />
                 <span className="text-sm text-blue-800 font-medium">
                   {selectedProducts.length} produtos selecionados
                 </span>
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => { setShowCreateModal(false); setSelectedMontadorId(''); setSelectedVehicleId(''); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={createAssemblyRoute}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm"
              >
                Confirmar Criação
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product Details Modal */}
      {showDetailsModal && detailsItem && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
             <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
               <h3 className="text-lg font-bold text-gray-900">Detalhes do Produto</h3>
               <button onClick={() => { setShowDetailsModal(false); setDetailsItem(null); }} className="text-gray-400 hover:text-gray-600">
                 <X className="h-5 w-5" />
               </button>
             </div>
             
             <div className="p-6 overflow-y-auto max-h-[70vh]">
               {(() => {
                 const ap = detailsItem;
                 const order = ap.order || {};
                 const addr = order.address_json || {};
                 
                 return (
                   <div className="space-y-6">
                     <div className="flex items-center gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
                        <div className="p-3 bg-white rounded-lg border border-gray-200 shadow-sm">
                           <Package className="h-8 w-8 text-blue-600" />
                        </div>
                        <div>
                           <h4 className="text-lg font-bold text-gray-900">{ap.product_name}</h4>
                           <p className="text-sm text-gray-500">SKU: {ap.product_sku || '—'}</p>
                        </div>
                     </div>

                     <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-1">
                           <p className="text-xs font-medium text-gray-500 uppercase">Cliente</p>
                           <p className="text-sm font-medium text-gray-900">{ap.customer_name}</p>
                        </div>
                        <div className="space-y-1">
                           <p className="text-xs font-medium text-gray-500 uppercase">Lançamento ERP</p>
                           <p className="text-sm font-medium text-gray-900">{order.order_id_erp || '—'}</p>
                        </div>
                        <div className="space-y-1">
                           <p className="text-xs font-medium text-gray-500 uppercase">Data Venda</p>
                           <p className="text-sm font-medium text-gray-900">{formatDate(order.data_venda)}</p>
                        </div>
                        <div className="space-y-1">
                           <p className="text-xs font-medium text-gray-500 uppercase">Data Entrega</p>
                           <p className="text-sm font-medium text-gray-900">
                             {formatDate(deliveryInfo[ap.order_id]?.date || order.previsao_entrega)}
                           </p>
                        </div>
                     </div>

                     <div className="space-y-2">
                        <p className="text-xs font-medium text-gray-500 uppercase">Endereço de Montagem</p>
                        <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 text-sm text-gray-700 flex items-start gap-2">
                           <MapPin className="h-4 w-4 text-gray-400 mt-0.5" />
                           {addr.street} {addr.number ? `, ${addr.number}` : ''} - {addr.neighborhood} - {addr.city}
                        </div>
                     </div>

                     {order.observations && (
                       <div className="space-y-2">
                          <p className="text-xs font-medium text-gray-500 uppercase">Observações do Pedido</p>
                          <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-100 text-sm text-yellow-800">
                             {order.observations}
                          </div>
                       </div>
                     )}
                   </div>
                 );
               })()}
             </div>
          </div>
        </div>
      )}

      {/* Edit Route Modal */}
      {showRouteEditModal && routeBeingEdited && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">Editar Romaneio</h3>
              <button onClick={() => setShowRouteEditModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                <input value={editRouteName} onChange={(e) => setEditRouteName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prazo</label>
                <input type="date" value={editRouteDeadline} onChange={(e) => setEditRouteDeadline(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
                <textarea value={editRouteObservations} onChange={(e) => setEditRouteObservations(e.target.value)} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Montador</label>
                  <select
                    value={editAssemblerId}
                    onChange={(e) => setEditAssemblerId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">Selecionar montador</option>
                    {montadores.map(m => (
                      <option key={m.id} value={m.id}>{m.name || m.email}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Veículo</label>
                  <select
                    value={editVehicleId}
                    onChange={(e) => setEditVehicleId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">Selecionar veículo</option>
                    {vehicles.map(v => (
                      <option key={v.id} value={v.id}>{v.plate} — {v.model}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowRouteEditModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={saveEditedRoute} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">Salvar Alterações</button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Route Products Modal */}
      {showRouteManageModal && routeBeingManaged && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[65]">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 rounded-t-xl">
              <h3 className="text-lg font-bold text-gray-900">Gerenciar Produtos — {routeBeingManaged.name}</h3>
              <button onClick={() => setShowRouteManageModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-hidden p-6 grid grid-cols-2 gap-6">
              {/* Left: Products in Route */}
              <div className="flex flex-col border border-gray-200 rounded-xl overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 font-semibold text-gray-700 flex justify-between items-center">
                   <span>No Romaneio</span>
                   <span className="text-xs bg-gray-200 px-2 py-1 rounded-full">{assemblyProducts.filter(p => p.assembly_route_id === routeBeingManaged.id).length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                   {assemblyProducts.filter(p => p.assembly_route_id === routeBeingManaged.id).map(p => (
                      <label key={p.id} className="flex items-start p-3 bg-white border border-gray-100 rounded-lg hover:bg-red-50 cursor-pointer transition-colors group">
                        <input type="checkbox" checked={selectedToRemove.includes(p.id)} onChange={(e) => {
                          if (e.target.checked) setSelectedToRemove([...selectedToRemove, p.id]); else setSelectedToRemove(selectedToRemove.filter(id => id !== p.id));
                        }} className="h-4 w-4 text-red-600 border-gray-300 rounded mt-0.5 focus:ring-red-500" />
                        <div className="ml-3">
                          <div className="text-sm font-medium text-gray-900 group-hover:text-red-700">{p.product_name}</div>
                          <div className="text-xs text-gray-500">{p.order?.customer_name} — {p.order?.address_json?.city}</div>
                        </div>
                      </label>
                   ))}
                   {assemblyProducts.filter(p => p.assembly_route_id === routeBeingManaged.id).length === 0 && (
                     <div className="text-center p-8 text-gray-400">Nenhum produto</div>
                   )}
                </div>
                <div className="p-3 bg-gray-50 border-t border-gray-200">
                   <button 
                     onClick={removeSelectedProductsFromRoute} 
                     disabled={selectedToRemove.length === 0}
                     className="w-full py-2 bg-red-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-red-700 transition-colors"
                   >
                     Remover Selecionados ({selectedToRemove.length})
                   </button>
                </div>
              </div>

              {/* Right: Available Products */}
              <div className="flex flex-col border border-gray-200 rounded-xl overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 font-semibold text-gray-700 flex justify-between items-center">
                   <span>Disponíveis (Pendentes)</span>
                   <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                     {assemblyProducts.filter(p => !p.assembly_route_id && p.status === 'pending').length}
                   </span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                   {assemblyProducts.filter(p => !p.assembly_route_id && p.status === 'pending').map(p => (
                      <label key={p.id} className="flex items-start p-3 bg-white border border-gray-100 rounded-lg hover:bg-blue-50 cursor-pointer transition-colors group">
                        <input type="checkbox" checked={selectedToAdd.includes(p.id)} onChange={(e) => {
                          if (e.target.checked) setSelectedToAdd([...selectedToAdd, p.id]); else setSelectedToAdd(selectedToAdd.filter(id => id !== p.id));
                        }} className="h-4 w-4 text-blue-600 border-gray-300 rounded mt-0.5 focus:ring-blue-500" />
                        <div className="ml-3">
                          <div className="text-sm font-medium text-gray-900 group-hover:text-blue-700">{p.product_name}</div>
                          <div className="text-xs text-gray-500">{p.order?.customer_name} — {p.order?.address_json?.city}</div>
                        </div>
                      </label>
                   ))}
                </div>
                <div className="p-3 bg-gray-50 border-t border-gray-200">
                   <button 
                     onClick={addSelectedProductsToRoute} 
                     disabled={selectedToAdd.length === 0}
                     className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors"
                   >
                     Adicionar Selecionados ({selectedToAdd.length})
                   </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Route Details Modal (Main View) */}
      {showRouteDetailsModal && routeDetails && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-start bg-gray-50 rounded-t-xl">
              <div>
                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  {routeDetails.route.name}
                  <StatusBadge status={routeDetails.route.status} />
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Criado em {formatDate(routeDetails.route.created_at)}
                  {routeDetails.route.deadline && ` • Prazo: ${formatDate(routeDetails.route.deadline)}`}
                </p>
                {(() => {
                  const products = routeDetails.products || [];
                  const installerNames = Array.from(new Set(products.map((p: any) => (p as any)?.installer?.name).filter(Boolean))) as string[];
                  let installerLabel = installerNames.length === 1 ? installerNames[0] : (installerNames.length > 1 ? 'Vários' : '—');
                  const assemblerId = (routeDetails.route as any).assembler_id;
                  if (assemblerId) {
                    const m = montadores.find(m => m.id === assemblerId);
                    installerLabel = m?.name || m?.email || installerLabel;
                  }
                  let plate = '';
                  const vehicleId = (routeDetails.route as any).vehicle_id;
                  if (vehicleId) {
                    const v = vehicles.find(v => v.id === vehicleId);
                    plate = v?.plate || '';
                  } else {
                    const obsStr = String(routeDetails.route.observations || '');
                    const plateMatch = obsStr.match(/Placa\s*:\s*([A-Za-z0-9-]+)/i) || obsStr.match(/Ve[ií]culo\s*:\s*([A-Za-z0-9-]+)/i);
                    plate = plateMatch ? plateMatch[1] : '';
                  }
                  return (
                    <p className="text-sm text-gray-600 mt-1 flex items-center gap-2">
                      <UserIcon className="h-4 w-4" /> Montador: {installerLabel}
                      {plate && (<><span className="text-gray-300">•</span><Truck className="h-4 w-4" /> Veículo: {plate}</>)}
                    </p>
                  );
                })()}
              </div>
              <button onClick={() => setShowRouteDetailsModal(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Toolbar */}
            <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap gap-2 items-center bg-white">
               <button
                  onClick={() => {
                    const products = routeDetails.products || [];
                    const toAddr = (o: any) => {
                      const a = o?.address_json || {};
                      const n = a.number ? `, ${a.number}` : '';
                      return `${a.street || ''}${n} - ${a.neighborhood || ''} - ${a.city || ''}`.trim();
                    };
                    const stops = products.map((p: any) => p.order).filter(Boolean);
                    if (stops.length === 0) return;
                    const waypoints = stops.slice(0, Math.max(0, stops.length - 1)).map(toAddr);
                    const destination = toAddr(stops[stops.length - 1]);
                    const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent('Current Location')}&destination=${encodeURIComponent(destination)}&travelmode=driving${waypoints.length ? `&waypoints=${encodeURIComponent(waypoints.join('|'))}` : ''}`;
                    window.open(url, '_blank');
                  }}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50"
                >
                  <MapPin className="h-4 w-4 mr-2 text-gray-500" />
                  Abrir Rota GPS
                </button>
                <button
                  onClick={() => generateRoutePdf(routeDetails.route)}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50"
                >
                  <FileText className="h-4 w-4 mr-2 text-gray-500" />
                  Gerar PDF
                </button>
                <div className="h-6 w-px bg-gray-300 mx-2" />
                <button
                  onClick={() => {
                    setRouteBeingEdited(routeDetails.route);
                    setEditRouteName(routeDetails.route.name);
                    setEditRouteDeadline(routeDetails.route.deadline ? routeDetails.route.deadline.substring(0, 10) : '');
                    setEditRouteObservations(routeDetails.route.observations || '');
                    setEditAssemblerId((routeDetails.route as any).assembler_id || '');
                    setEditVehicleId((routeDetails.route as any).vehicle_id || '');
                    setShowRouteDetailsModal(false);
                    setShowRouteEditModal(true);
                  }}
                  className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-blue-700 bg-blue-50 hover:bg-blue-100"
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Editar
                </button>
                <button
                  onClick={() => {
                    setRouteBeingManaged(routeDetails.route);
                    setSelectedToRemove([]);
                    setSelectedToAdd([]);
                    setShowRouteDetailsModal(false);
                    setShowRouteManageModal(true);
                  }}
                  className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-purple-700 bg-purple-50 hover:bg-purple-100"
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Gerenciar Produtos
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
               {routeDetails.route.observations && (
                 <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                    <div>
                       <h4 className="text-sm font-bold text-yellow-800">Observações do Romaneio</h4>
                       <p className="text-sm text-yellow-700 mt-1">{routeDetails.route.observations}</p>
                    </div>
                 </div>
               )}

               <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Produto</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente / Endereço</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {routeDetails.products.map((ap: any) => {
                         const order = ap.order || {};
                         const addr = order.address_json || {};
                         return (
                           <tr key={ap.id} className="hover:bg-gray-50 transition-colors">
                              <td className="px-6 py-4">
                                 <div className="text-sm font-medium text-gray-900">{ap.product_name}</div>
                                 <div className="text-xs text-gray-500">Lançamento: {order.order_id_erp || '—'}</div>
                              </td>
                              <td className="px-6 py-4">
                                 <div className="text-sm text-gray-900">{order.customer_name}</div>
                                 <div className="text-xs text-gray-500 flex items-center gap-1">
                                   <MapPin className="h-3 w-3" />
                                   {addr.street}, {addr.number} - {addr.neighborhood}
                                 </div>
                              </td>
                              <td className="px-6 py-4">
                                 <StatusBadge status={ap.status} />
                              </td>
                              <td className="px-6 py-4 text-right">
                                 <button
                                    onClick={() => { setDetailsItem(ap); setShowDetailsModal(true); }}
                                    className="text-blue-600 hover:text-blue-900 text-sm font-medium"
                                 >
                                    Ver Detalhes
                                 </button>
                              </td>
                           </tr>
                         );
                      })}
                    </tbody>
                  </table>
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
