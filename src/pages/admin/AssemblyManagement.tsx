import { useEffect, useState } from 'react';
import { Plus, Calendar, User as UserIcon, MapPin, Package, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';
import { AssemblyRoute, AssemblyProduct, AssemblyProductWithDetails, User } from '../../types/database';
import jsPDF from 'jspdf';
import { DeliverySheetGenerator, type DeliverySheetData } from '../../utils/pdf/deliverySheetGenerator';

export default function AssemblyManagement() {
  const [assemblyRoutes, setAssemblyRoutes] = useState<AssemblyRoute[]>([]);
  const [assemblyProducts, setAssemblyProducts] = useState<AssemblyProductWithDetails[]>([]);
  const [montadores, setMontadores] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRouteName, setNewRouteName] = useState('');
  const [newRouteDeadline, setNewRouteDeadline] = useState('');
  const [newRouteObservations, setNewRouteObservations] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [availableProducts, setAvailableProducts] = useState<any[]>([]);
  const [groupedProducts, setGroupedProducts] = useState<Record<string, any[]>>({});
  const [filterCidade, setFilterCidade] = useState('');
  const [filterBairro, setFilterBairro] = useState('');
  const [selectedLancamentos, setSelectedLancamentos] = useState<string[]>([]);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [detailsItem, setDetailsItem] = useState<any | null>(null);
  const [deliveryInfo, setDeliveryInfo] = useState<Record<string, { date?: string; driver?: string }>>({});
  const [showRouteEditModal, setShowRouteEditModal] = useState(false);
  const [routeBeingEdited, setRouteBeingEdited] = useState<AssemblyRoute | null>(null);
  const [editRouteName, setEditRouteName] = useState('');
  const [editRouteDeadline, setEditRouteDeadline] = useState('');
  const [editRouteObservations, setEditRouteObservations] = useState('');
  const [showRouteManageModal, setShowRouteManageModal] = useState(false);
  const [routeBeingManaged, setRouteBeingManaged] = useState<AssemblyRoute | null>(null);
  const [selectedToRemove, setSelectedToRemove] = useState<string[]>([]);
  const [selectedToAdd, setSelectedToAdd] = useState<string[]>([]);
  const [showRouteDetailsModal, setShowRouteDetailsModal] = useState(false);
  const [routeDetails, setRouteDetails] = useState<{ route: AssemblyRoute, products: any[] } | null>(null);

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

      // Montar informações de entrega (motorista e data) a partir das rotas entregues
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
      setAvailableProducts(pendingUnrouted || []);
      setGroupedProducts(groupedByLancamento);
      setDeliveryInfo(deliveryByOrderId);
      
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
      // Criar romaneio
      const { data: routeData, error: routeError } = await supabase
        .from('assembly_routes')
        .insert({
          name: newRouteName,
          deadline: newRouteDeadline || null,
          observations: newRouteObservations || null,
          status: 'pending'
        })
        .select()
        .single();

      if (routeError) throw routeError;

      // Atribuir assembly_products selecionados ao romaneio (sem criar duplicatas)
      const { error: updateError } = await supabase
        .from('assembly_products')
        .update({ assembly_route_id: routeData.id })
        .in('id', selectedProducts);

      if (updateError) throw updateError;

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
      setSelectedProducts([]);
      setSelectedLancamentos([]);
      fetchData();
      
    } catch (error) {
      console.error('Erro ao criar romaneio:', error);
      toast.error('Erro ao criar romaneio de montagem');
    }
  };

  const assignInstaller = async (productId: string, installerId: string) => {
    try {
      const { error } = await supabase
        .from('assembly_products')
        .update({
          installer_id: installerId,
          status: 'assigned',
          assembly_date: new Date().toISOString()
        })
        .eq('id', productId);

      if (error) throw error;
      
      toast.success('Montador atribuído com sucesso!');
      fetchData();
      try {
        const userId = (await supabase.auth.getUser()).data.user?.id || '';
        await supabase.from('audit_logs').insert({
          entity_type: 'assembly_product',
          entity_id: productId,
          action: 'assigned_installer',
          details: { installer_id: installerId },
          user_id: userId,
          timestamp: new Date().toISOString(),
        });
      } catch {}
      
    } catch (error) {
      console.error('Erro ao atribuir montador:', error);
      toast.error('Erro ao atribuir montador');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'assigned': return 'bg-blue-100 text-blue-800';
      case 'in_progress': return 'bg-orange-100 text-orange-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending': return 'Pendente';
      case 'assigned': return 'Atribuído';
      case 'in_progress': return 'Em Andamento';
      case 'completed': return 'Concluído';
      case 'cancelled': return 'Cancelado';
      default: return status;
    }
  };

  const handleLancamentoSelection = (lancamento: string, checked: boolean) => {
    if (checked) {
      const productsInLancamento = groupedProducts[lancamento] || [];
      const productIds = productsInLancamento.map((p: any) => p.id);
      setSelectedProducts([...selectedProducts, ...productIds]);
      setSelectedLancamentos([...selectedLancamentos, lancamento]);
    } else {
      const productsInLancamento = groupedProducts[lancamento] || [];
      const productIds = productsInLancamento.map((p: any) => p.id);
      setSelectedProducts(selectedProducts.filter(id => !productIds.includes(id)));
      setSelectedLancamentos(selectedLancamentos.filter(l => l !== lancamento));
    }
  };

  const handleProductSelection = (productId: string, checked: boolean) => {
    if (checked) {
      setSelectedProducts([...selectedProducts, productId]);
    } else {
      setSelectedProducts(selectedProducts.filter(id => id !== productId));
    }
  };

  const getFilteredProducts = () => {
    const filtered: Record<string, any[]> = {};
    Object.entries(groupedProducts).forEach(([lancamento, products]) => {
      const filteredProducts = (products || []).filter((ap: any) => {
        const addr = ap.order?.address_json || {};
        const city = (addr.city || '').toLowerCase();
        const bairro = (addr.neighborhood || '').toLowerCase();
        const matchCidade = filterCidade ? city.includes(filterCidade.toLowerCase()) : true;
        const matchBairro = filterBairro ? bairro.includes(filterBairro.toLowerCase()) : true;
        return matchCidade && matchBairro;
      });
      if (filteredProducts.length > 0) {
        filtered[lancamento] = filteredProducts;
      }
    });
    return filtered;
  };

  const getUniqueCidades = () => {
    const cidades = new Set<string>();
    Object.values(groupedProducts).forEach(products => {
      products.forEach((ap: any) => {
        const city = ap.order?.address_json?.city;
        if (city) cidades.add(city);
      });
    });
    return Array.from(cidades).sort();
  };

  const getUniqueBairros = () => {
    const bairros = new Set<string>();
    Object.values(groupedProducts).forEach(products => {
      products.forEach((ap: any) => {
        const bairro = ap.order?.address_json?.neighborhood;
        if (bairro) bairros.add(bairro);
      });
    });
    return Array.from(bairros).sort();
  };

  const saveEditedRoute = async () => {
    if (!routeBeingEdited) return;
    try {
      const { error } = await supabase
        .from('assembly_routes')
        .update({
          name: editRouteName,
          deadline: editRouteDeadline || null,
          observations: editRouteObservations || null
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

      const data: DeliverySheetData = {
        route: routeData,
        routeOrders: routeOrders as any,
        driver: { id: '', user_id: '', cpf: '', active: true, name: '—', user: { id: '', email: '', name: '—', role: 'driver', created_at: new Date().toISOString() } } as any,
        vehicle: undefined,
        orders: orders as any,
        generatedAt: new Date().toISOString(),
      };

      const pdfBytes = await DeliverySheetGenerator.generateDeliverySheet(data, 'Romaneio de Montagem');
      DeliverySheetGenerator.openPDFInNewTab(pdfBytes);
    } catch (e) {
      console.error(e);
      toast.error('Erro ao gerar PDF do romaneio');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center">
              <Package className="h-6 w-6 mr-2" />
              Gestão de Montagem
            </h1>
            <p className="text-gray-600 mt-1">
              Gerencie romaneios e atribua montadores para produtos que necessitam instalação
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={selectedProducts.length === 0}
          >
            <Plus className="h-4 w-4 mr-2" />
            Criar Romaneio ({selectedProducts.length} produtos)
          </button>
        </div>
      </div>

      {/* Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <Package className="h-8 w-8 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Total Produtos</p>
              <p className="text-2xl font-semibold text-gray-900">{assemblyProducts.length}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <Clock className="h-8 w-8 text-yellow-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Pendentes</p>
              <p className="text-2xl font-semibold text-gray-900">
                {assemblyProducts.filter(p => p.status === 'pending').length}
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <UserIcon className="h-8 w-8 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Em Andamento</p>
              <p className="text-2xl font-semibold text-gray-900">
                {assemblyProducts.filter(p => p.status === 'in_progress').length}
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Concluídos</p>
              <p className="text-2xl font-semibold text-gray-900">
                {assemblyProducts.filter(p => p.status === 'completed').length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Romaneios Criados */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 flex items-center">
            <Package className="h-5 w-5 mr-2" />
            Romaneios Criados
          </h2>
          <div className="text-sm text-gray-600">{assemblyRoutes.length} romaneio(s)</div>
        </div>
        {assemblyRoutes.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">
            <Package className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>Nenhum romaneio criado</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {assemblyRoutes.map(route => {
              const productsInRoute = assemblyProducts.filter(p => p.assembly_route_id === route.id);
              const total = productsInRoute.length;
              const pendingCount = productsInRoute.filter(p => p.status === 'pending').length;
              const inProgress = productsInRoute.filter(p => p.status === 'in_progress').length;
              const completed = productsInRoute.filter(p => p.status === 'completed').length;
              const statusClass = getStatusColor(route.status);
              const statusText = getStatusLabel(route.status);
              return (
                <div key={route.id} className="bg-white rounded-lg border hover:shadow transition p-6">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center">
                      <Package className="h-5 w-5 text-blue-600 mr-2" />
                      <h3 className="text-lg font-semibold text-gray-900">{route.name}</h3>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusClass}`}>{statusText}</span>
                  </div>
                  <div className="text-sm text-gray-700 space-y-1 mb-4">
                    <div>Produtos: {total} • Pendentes: {pendingCount} • Em Andamento: {inProgress} • Concluídos: {completed}</div>
                    <div>Criado em: {new Date(route.created_at).toLocaleDateString('pt-BR')}</div>
                    {route.deadline && (
                      <div>Prazo: {new Date(route.deadline).toLocaleDateString('pt-BR')}</div>
                    )}
                    {route.observations && (
                      <div>Obs: {route.observations}</div>
                    )}
                  </div>
                  <div className="grid grid-cols-1">
                    <button
                      onClick={() => {
                        setRouteDetails({ route, products: productsInRoute });
                        setShowRouteDetailsModal(true);
                      }}
                      className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center"
                    >
                      Ver detalhes
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Lista de Produtos para Montagem por Número de Lançamento */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Produtos para Montagem por Número de Lançamento</h2>
            <div className="text-sm text-gray-500">
              {selectedProducts.length} produtos selecionados
            </div>
          </div>
        </div>
        
        {/* Filtros */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Filtrar por Cidade
              </label>
              <select
                value={filterCidade}
                onChange={(e) => setFilterCidade(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Todas as Cidades</option>
                {getUniqueCidades().map(cidade => (
                  <option key={cidade} value={cidade}>{cidade}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Filtrar por Bairro
              </label>
              <select
                value={filterBairro}
                onChange={(e) => setFilterBairro(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Todos os Bairros</option>
                {getUniqueBairros().map(bairro => (
                  <option key={bairro} value={bairro}>{bairro}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        
        {/* Produtos Agrupados por Lançamento */}
        <div className="max-h-96 overflow-y-auto">
          {Object.keys(getFilteredProducts()).length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500">
              <Package className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p>Nenhum produto disponível para montagem</p>
              {filterCidade || filterBairro && (
                <p className="text-sm mt-2">Tente ajustar os filtros</p>
              )}
            </div>
          ) : (
            Object.entries(getFilteredProducts()).map(([lancamento, products]) => (
              <div key={lancamento} className="border-b border-gray-200">
                <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        checked={selectedLancamentos.includes(lancamento)}
                        onChange={(e) => handleLancamentoSelection(lancamento, e.target.checked)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mr-3"
                      />
                      <h3 className="text-sm font-semibold text-gray-900">
                        Número de Lançamento: {lancamento}
                      </h3>
                      <span className="ml-2 text-xs text-gray-500">
                        ({products.length} produtos)
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="divide-y divide-gray-100">
                  {products.map((ap: any) => {
                    const order = ap.order || {};
                    const addr = order.address_json || {};
                    return (
                      <div key={ap.id} className="px-6 py-3 hover:bg-gray-50">
                        <div className="flex items-start space-x-3">
                          <input
                            type="checkbox"
                            checked={selectedProducts.includes(ap.id)}
                            onChange={(e) => handleProductSelection(ap.id, e.target.checked)}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 text-sm">
                              {/* Produto e Cliente */}
                              <div className="space-y-1">
                                <div className="flex items-center space-x-2">
                                  <h4 className="text-sm font-medium text-gray-900">
                                    {ap.product_name || 'Produto para montagem'}
                                  </h4>
                                  {ap.product_sku && (
                                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                                      {ap.product_sku}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center text-xs text-gray-600">
                                  <UserIcon className="h-3 w-3 mr-1" />
                                  {ap.customer_name}
                                </div>
                              </div>
                              
                              {/* Endereço */}
                              <div className="space-y-1">
                                <div className="flex items-center text-xs text-gray-600">
                                  <MapPin className="h-3 w-3 mr-1" />
                                  {addr.city} - {addr.neighborhood}
                                </div>
                                {addr && (
                                  <div className="text-xs text-gray-500">
                                    {addr.street}, {addr.number} - {addr.neighborhood}
                                  </div>
                                )}
                              </div>
                              
                              {/* Datas e Motorista */}
                              <div className="space-y-1 text-xs text-gray-600">
                                {order.data_venda && (
                                  <div>
                                    <strong>Venda:</strong> {new Date(order.data_venda).toLocaleDateString('pt-BR')}
                                  </div>
                                )}
                                { (deliveryInfo[ap.order_id]?.date || order.previsao_entrega) && (
                                  <div>
                                    <strong>Entrega:</strong> {new Date(deliveryInfo[ap.order_id]?.date || order.previsao_entrega).toLocaleDateString('pt-BR')}
                                  </div>
                                )}
                                { (deliveryInfo[ap.order_id]?.driver) && (
                                  <div>
                                    <strong>Motorista:</strong> {deliveryInfo[ap.order_id]?.driver}
                                  </div>
                                )}
                              </div>
                               
                              {/* Observações */}
                              <div className="space-y-1">
                                {((order as any).observacoes_publicas || (order as any).raw_json?.observacoes) && (
                                  <div className="text-xs text-gray-600 bg-yellow-50 p-2 rounded border border-yellow-200">
                                    <strong>Obs:</strong> {(order as any).observacoes_publicas || (order as any).raw_json?.observacoes}
                                  </div>
                                )}
                                {order.observacoes_publicas && (
                                  <div className="text-xs text-gray-600 bg-yellow-50 p-2 rounded border border-yellow-200">
                                    <strong>Obs Públicas:</strong> {order.observacoes_publicas}
                                  </div>
                                )}
                                {order.observacoes_internas && (
                                  <div className="text-xs text-gray-600 bg-blue-50 p-2 rounded border border-blue-200">
                                    <strong>Obs Internas:</strong> {order.observacoes_internas}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex-shrink-0">
                            <button
                              onClick={() => { setDetailsItem(ap); setShowDetailsModal(true); }}
                              className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                            >
                              Ver detalhes
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Modal de Criação de Romaneio */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-[40]">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">
                  Criar Romaneio de Montagem ({selectedProducts.length} produtos selecionados)
                </h3>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="text-gray-400 hover:text-gray-500"
                >
                  <span className="sr-only">Fechar</span>
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome do Romaneio *
                </label>
                <input
                  type="text"
                  value={newRouteName}
                  onChange={(e) => setNewRouteName(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ex: Romaneio Montagem - Semana 1"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Prazo de Conclusão
                </label>
                <input
                  type="date"
                  value={newRouteDeadline}
                  onChange={(e) => setNewRouteDeadline(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Observações
                </label>
                <textarea
                  value={newRouteObservations}
                  onChange={(e) => setNewRouteObservations(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Observações sobre o romaneio..."
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Selecionar Produtos por Número de Lançamento *
                </label>
                <div className="max-h-60 overflow-y-auto border border-gray-300 rounded-md">
                  {Object.keys(groupedProducts).length === 0 ? (
                    <div className="p-4 text-center text-gray-500">
                      <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                      <p>Nenhum produto disponível para montagem</p>
                    </div>
                  ) : (
                    Object.entries(groupedProducts).map(([lancamento, products]) => (
                      <div key={lancamento} className="border-b border-gray-200 last:border-b-0">
                        <div className="p-3 bg-gray-50 border-b border-gray-100">
                          <div className="flex items-center">
                            <input
                              type="checkbox"
                              checked={selectedLancamentos.includes(lancamento)}
                              onChange={(e) => handleLancamentoSelection(lancamento, e.target.checked)}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mr-2"
                            />
                            <h4 className="text-sm font-semibold text-gray-900">
                              Número de Lançamento: {lancamento}
                            </h4>
                            <span className="ml-2 text-xs text-gray-500">
                              ({products.length} produtos)
                            </span>
                          </div>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {products.map((ap: any) => {
                            const order = ap.order || {};
                            const addr = order.address_json || {};
                            return (
                              <label key={ap.id} className="flex items-start p-3 hover:bg-gray-50">
                                <input
                                  type="checkbox"
                                  checked={selectedProducts.includes(ap.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedProducts([...selectedProducts, ap.id]);
                                    } else {
                                      setSelectedProducts(selectedProducts.filter(id => id !== ap.id));
                                    }
                                  }}
                                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mt-0.5"
                                />
                                <div className="ml-3 flex-1">
                                  <div className="text-sm font-medium text-gray-900">
                                    {ap.product_name || 'Produto para montagem'}
                                  </div>
                                  <div className="text-sm text-gray-500">
                                    {ap.customer_name} - {addr.city} - {addr.neighborhood}
                                  </div>
                                  <div className="mt-1 text-xs text-gray-600 space-y-1">
                                    {order.sale_date && (
                                      <div><strong>Venda:</strong> {new Date(order.sale_date).toLocaleDateString('pt-BR')}</div>
                                    )}
                                    {order.delivery_date && (
                                      <div><strong>Entrega:</strong> {new Date(order.delivery_date).toLocaleDateString('pt-BR')}</div>
                                    )}
                                    {order.driver_name && (
                                      <div><strong>Motorista:</strong> {order.driver_name}</div>
                                    )}
                                    {order.observations && (
                                      <div><strong>Obs:</strong> {order.observations}</div>
                                    )}
                                    {order.observacoes_internas && (
                                      <div><strong>Obs Internas:</strong> {order.observacoes_internas}</div>
                                    )}
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
              >
                Cancelar
              </button>
              <button
                onClick={createAssemblyRoute}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Criar Romaneio
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalhes do Pedido */}
      {showDetailsModal && detailsItem && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-[90]">
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Detalhes da Venda</h3>
                <button onClick={() => { setShowDetailsModal(false); setDetailsItem(null); }} className="text-gray-400 hover:text-gray-500">
                  <span className="sr-only">Fechar</span>
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="px-6 py-4 space-y-4">
              {(() => {
                const ap = detailsItem;
                const order = ap.order || {};
                const addr = order.address_json || {};
                return (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <h4 className="font-medium text-gray-900 mb-1">Produto</h4>
                        <p className="text-gray-600">{ap.product_name} {ap.product_sku ? `(${ap.product_sku})` : ''}</p>
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900 mb-1">Cliente</h4>
                        <p className="text-gray-600">{ap.customer_name}</p>
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900 mb-1">Nº Lançamento (ERP)</h4>
                        <p className="text-gray-600">{order.order_id_erp}</p>
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900 mb-1">Data da Venda</h4>
                        <p className="text-gray-600">{order.data_venda ? new Date(order.data_venda).toLocaleDateString('pt-BR') : '—'}</p>
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900 mb-1">Data da Entrega</h4>
                        <p className="text-gray-600">{(deliveryInfo[ap.order_id]?.date || order.previsao_entrega) ? new Date(deliveryInfo[ap.order_id]?.date || order.previsao_entrega).toLocaleDateString('pt-BR') : '—'}</p>
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900 mb-1">Motorista que Entregou</h4>
                        <p className="text-gray-600">{deliveryInfo[ap.order_id]?.driver ?? '—'}</p>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900 mb-1">Endereço Completo</h4>
                      <p className="text-gray-600">{addr.street} {addr.number ? `, ${addr.number}` : ''} - {addr.neighborhood} - {addr.city}</p>
                    </div>
                    {order.observations && (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-1">Observações</h4>
                        <p className="text-gray-600 bg-yellow-50 p-2 rounded border border-yellow-200">{order.observations}</p>
                      </div>
                    )}
                    {order.observacoes_publicas && (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-1">Observações Públicas</h4>
                        <p className="text-gray-600 bg-yellow-50 p-2 rounded border border-yellow-200">{order.observacoes_publicas}</p>
                      </div>
                    )}
                    {order.observacoes_internas && (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-1">Observações Internas</h4>
                        <p className="text-gray-600 bg-blue-50 p-2 rounded border border-blue-200">{order.observacoes_internas}</p>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button onClick={() => { setShowDetailsModal(false); setDetailsItem(null); }} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Editar Romaneio */}
      {showRouteEditModal && routeBeingEdited && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-[80]">
          <div className="bg-white rounded-lg max-w-xl w-full">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Editar Romaneio</h3>
              <button onClick={() => setShowRouteEditModal(false)} className="text-gray-400 hover:text-gray-500">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                <input value={editRouteName} onChange={(e) => setEditRouteName(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prazo</label>
                <input type="date" value={editRouteDeadline} onChange={(e) => setEditRouteDeadline(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
                <textarea value={editRouteObservations} onChange={(e) => setEditRouteObservations(e.target.value)} rows={3} className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <button onClick={() => setShowRouteEditModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Cancelar</button>
              <button onClick={saveEditedRoute} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700">Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Gerenciar Produtos do Romaneio */}
      {showRouteManageModal && routeBeingManaged && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-[85]">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Gerenciar Produtos — {routeBeingManaged.name}</h3>
              <button onClick={() => setShowRouteManageModal(false)} className="text-gray-400 hover:text-gray-500">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Produtos no Romaneio</h4>
                <div className="border rounded-md divide-y divide-gray-100">
                  {assemblyProducts.filter(p => p.assembly_route_id === routeBeingManaged.id).map(p => (
                    <label key={p.id} className="flex items-start p-3">
                      <input type="checkbox" checked={selectedToRemove.includes(p.id)} onChange={(e) => {
                        if (e.target.checked) setSelectedToRemove([...selectedToRemove, p.id]); else setSelectedToRemove(selectedToRemove.filter(id => id !== p.id));
                      }} className="h-4 w-4 text-red-600 border-gray-300 rounded mt-0.5" />
                      <div className="ml-3">
                        <div className="text-sm font-medium text-gray-900">{p.product_name}</div>
                        <div className="text-xs text-gray-600">{p.order?.customer_name} — {p.order?.address_json?.city}</div>
                      </div>
                    </label>
                  ))}
                  {assemblyProducts.filter(p => p.assembly_route_id === routeBeingManaged.id).length === 0 && (
                    <div className="p-3 text-sm text-gray-500">Nenhum produto no romaneio</div>
                  )}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Adicionar Produtos (Pendentes)</h4>
                <div className="border rounded-md divide-y divide-gray-100">
                  {assemblyProducts.filter(p => !p.assembly_route_id && p.status === 'pending').map(p => (
                    <label key={p.id} className="flex items-start p-3">
                      <input type="checkbox" checked={selectedToAdd.includes(p.id)} onChange={(e) => {
                        if (e.target.checked) setSelectedToAdd([...selectedToAdd, p.id]); else setSelectedToAdd(selectedToAdd.filter(id => id !== p.id));
                      }} className="h-4 w-4 text-blue-600 border-gray-300 rounded mt-0.5" />
                      <div className="ml-3">
                        <div className="text-sm font-medium text-gray-900">{p.product_name}</div>
                        <div className="text-xs text-gray-600">{p.order?.customer_name} — {p.order?.address_json?.city}</div>
                      </div>
                    </label>
                  ))}
                  {assemblyProducts.filter(p => !p.assembly_route_id && p.status === 'pending').length === 0 && (
                    <div className="p-3 text-sm text-gray-500">Nenhum produto pendente disponível</div>
                  )}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <button onClick={() => setShowRouteManageModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Fechar</button>
              <button onClick={removeSelectedProductsFromRoute} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700" disabled={selectedToRemove.length === 0}>Remover Selecionados</button>
              <button onClick={addSelectedProductsToRoute} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700" disabled={selectedToAdd.length === 0}>Adicionar Selecionados</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Detalhes do Romaneio */}
      {showRouteDetailsModal && routeDetails && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-[70]">
          <div className="bg-white rounded-lg max-w-5xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Romaneio de Montagem — {routeDetails.route.name}</h3>
              <button onClick={() => setShowRouteDetailsModal(false)} className="text-gray-400 hover:text-gray-500">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 py-4">
              <div className="mb-4 flex items-center justify-end space-x-2">
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
                  className="bg-indigo-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-indigo-700"
                >
                  Abrir rota no GPS
                </button>
                <button
                  onClick={() => generateRoutePdf(routeDetails.route)}
                  className="bg-green-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-green-700"
                >
                  Gerar PDF
                </button>
                <button
                  onClick={() => {
                    setRouteBeingEdited(routeDetails.route);
                    setEditRouteName(routeDetails.route.name);
                    setEditRouteDeadline(routeDetails.route.deadline ? routeDetails.route.deadline.substring(0, 10) : '');
                    setEditRouteObservations(routeDetails.route.observations || '');
                    setShowRouteEditModal(true);
                  }}
                  className="bg-gray-100 text-gray-800 py-2 px-4 rounded-lg font-medium hover:bg-gray-200"
                >
                  Editar
                </button>
                <button
                  onClick={() => {
                    setRouteBeingManaged(routeDetails.route);
                    setSelectedToRemove([]);
                    setSelectedToAdd([]);
                    setShowRouteManageModal(true);
                  }}
                  className="bg-purple-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-purple-700"
                >
                  Gerenciar Produtos
                </button>
              </div>
              {(() => {
                const products = routeDetails.products || [];
                const total = products.length;
                const pendingCount = products.filter((p: any) => p.status === 'pending').length;
                const inProgress = products.filter((p: any) => p.status === 'in_progress').length;
                const completed = products.filter((p: any) => p.status === 'completed').length;
                return (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm text-gray-700">
                      <div><strong>Total:</strong> {total}</div>
                      <div><strong>Pendentes:</strong> {pendingCount}</div>
                      <div><strong>Em Andamento:</strong> {inProgress}</div>
                      <div><strong>Concluídos:</strong> {completed}</div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nº Lançamento</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Endereço Completo</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Produto</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {products.map((ap: any) => {
                            const order = ap.order || {};
                            const addr = order.address_json || {};
                            const enderecoCompleto = `${addr.street || ''}${addr.number ? `, ${addr.number}` : ''} - ${addr.neighborhood || ''} - ${addr.city || ''}`;
                            return (
                              <tr key={ap.id} className="hover:bg-gray-50">
                                <td className="px-6 py-4 text-sm text-gray-900">{order.order_id_erp ?? '—'}</td>
                                <td className="px-6 py-4 text-sm text-gray-500">{order.customer_name}</td>
                                <td className="px-6 py-4 text-sm text-gray-500">{enderecoCompleto}</td>
                                <td className="px-6 py-4 text-sm text-gray-500">{ap.product_name}</td>
                                <td className="px-6 py-4 text-sm">
                                  <button
                                    onClick={() => { setDetailsItem(ap); setShowDetailsModal(true); }}
                                    className="text-blue-600 hover:text-blue-800 font-medium"
                                  >
                                    Ver mais
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button onClick={() => setShowRouteDetailsModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
