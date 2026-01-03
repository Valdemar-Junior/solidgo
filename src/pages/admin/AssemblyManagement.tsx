import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import type { AssemblyRoute, AssemblyProductWithDetails, User, Vehicle } from '../../types/database';
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
  Filter,
  FileText,
  Truck,
  X,
  Edit,
  Trash2,
  Settings,
  Search,
  RefreshCcw,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Eye,
  MessageSquare,
  Zap,
  Hammer,
  ClipboardList,
  ClipboardCheck,
  Pencil,
  Save,
  FilePlus,
  RefreshCw,
  Wrench
} from 'lucide-react';
import { toast } from 'sonner';
import { DeliverySheetGenerator } from '../../utils/pdf/deliverySheetGenerator';
import { AssemblyReportGenerator } from '../../utils/pdf/assemblyReportGenerator';
import { useAssemblyDataStore } from '../../stores/assemblyDataStore';
import { useAuthStore } from '../../stores/authStore';
import { saveUserPreference, loadUserPreference, mergeColumnsConfig, type ColumnConfig } from '../../utils/userPreferences';

// --- ERROR BOUNDARY ---
class AssemblyManagementErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('AssemblyManagement Error:', error, errorInfo);
  }

  handleReset = () => {
    try {
      localStorage.removeItem('am_columns_conf');
      localStorage.removeItem('am_showCreateModal');
      window.location.reload();
    } catch (e) {
      console.error('Failed to clear storage', e);
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
          <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
            <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6">
              <AlertTriangle className="h-8 w-8 text-red-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Ops! Algo deu errado.</h2>
            <p className="text-gray-500 mb-6">
              Ocorreu um erro ao carregar a tela de montagem. Isso geralmente acontece devido a uma configuração antiga salva no navegador.
            </p>
            <div className="bg-red-50 p-3 rounded-lg text-left text-xs font-mono text-red-700 mb-6 overflow-auto max-h-32">
              {this.state.error?.message || 'Erro desconhecido'}
            </div>
            <button
              onClick={this.handleReset}
              className="w-full flex items-center justify-center px-4 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors shadow-sm"
            >
              <RefreshCcw className="h-4 w-4 mr-2" />
              Limpar Configurações e Recarregar
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function AssemblyManagementContent() {
  const navigate = useNavigate();
  const { user: authUser } = useAuthStore();

  // --- LOCAL STATE ---
  const [assemblyRoutes, setAssemblyRoutes] = useState<AssemblyRoute[]>([]);
  const [assemblyProducts, setAssemblyProducts] = useState<AssemblyProductWithDetails[]>([]);
  const [assemblyPending, setAssemblyPending] = useState<AssemblyProductWithDetails[]>([]);
  const [assemblyInRoutes, setAssemblyInRoutes] = useState<AssemblyProductWithDetails[]>([]);
  const [montadores, setMontadores] = useState<User[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  // Selection
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());

  // New Route Form
  const [routeName, setRouteName] = useState<string>('');
  const [selectedMontador, setSelectedMontador] = useState<string>('');
  const [selectedVehicle, setSelectedVehicle] = useState<string>('');
  const [observations, setObservations] = useState<string>('');
  const [deadline, setDeadline] = useState<string>('');
  const [selectedExistingRoute, setSelectedExistingRoute] = useState<string>(''); // '' = criar nova, route_id = adicionar a existente

  // UI States
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showColumnsModal, setShowColumnsModal] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<AssemblyRoute | null>(null);
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [showOrderProductsModal, setShowOrderProductsModal] = useState(false);
  const [orderProductsModal, setOrderProductsModal] = useState<{ orderId: string; products: AssemblyProductWithDetails[] } | null>(null);
  const [waSending, setWaSending] = useState(false);
  const [groupSending, setGroupSending] = useState(false);
  // Edit route states
  const [isEditingRoute, setIsEditingRoute] = useState(false);
  const [editRouteName, setEditRouteName] = useState('');
  const [editRouteMontador, setEditRouteMontador] = useState('');
  const [editRouteVehicle, setEditRouteVehicle] = useState('');
  const [editRouteDeadline, setEditRouteDeadline] = useState('');
  const [editRouteObservations, setEditRouteObservations] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  // Add orders to route states
  const [showAddOrdersModal, setShowAddOrdersModal] = useState(false);
  const [ordersToAdd, setOrdersToAdd] = useState<Set<string>>(new Set());
  const [addingOrders, setAddingOrders] = useState(false);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersPageSize, setOrdersPageSize] = useState(200);
  const isLoadingRef = useRef(false);
  const isMountedRef = useRef(true);
  const [deliveryInfo, setDeliveryInfo] = useState<Record<string, string>>({});

  // --- SINGLE LAUNCH IMPORT (TROCAS/ASSISTENCIAS/VENDAS) ---
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [launchNumber, setLaunchNumber] = useState('');
  const [launchType, setLaunchType] = useState<'troca' | 'assistencia' | 'venda'>('troca');
  const [launchLoading, setLaunchLoading] = useState(false);

  // Filters
  const [filterCity, setFilterCity] = useState<string>('');
  const [filterNeighborhood, setFilterNeighborhood] = useState<string>('');
  const [filterDeadline, setFilterDeadline] = useState<'all' | 'within' | 'out'>('all');
  const [showFilters, setShowFilters] = useState(true);

  // Table Config
  const [columnsConf, setColumnsConf] = useState<Array<{ id: string, label: string, visible: boolean }>>([
    { id: 'dataVenda', label: 'Data Venda', visible: true },
    { id: 'entrega', label: 'Entrega', visible: true },
    { id: 'previsao', label: 'Previsão', visible: true },
    { id: 'pedido', label: 'Pedido', visible: true },
    { id: 'cliente', label: 'Cliente', visible: true },
    { id: 'telefone', label: 'Telefone', visible: true },
    { id: 'sinais', label: 'Sinais', visible: true },
    { id: 'produto', label: 'Produto', visible: true },
    { id: 'sku', label: 'SKU', visible: true },
    { id: 'obsPublicas', label: 'Obs. Públicas', visible: true },
    { id: 'obsInternas', label: 'Obs. Internas', visible: true },
    { id: 'cidade', label: 'Cidade', visible: true },
    { id: 'bairro', label: 'Bairro', visible: true },
    { id: 'endereco', label: 'Endereço', visible: true },
  ]);

  const ordersSectionRef = useRef<HTMLDivElement>(null);
  const routesSectionRef = useRef<HTMLDivElement>(null);

  // Drag logic
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

  const scrollToSection = (ref: React.RefObject<HTMLElement>) => {
    if (ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };



  // Restore persisted selections and scroll position
  useEffect(() => {
    const loadColumnsFromSupabase = async () => {
      const defaults: ColumnConfig[] = [
        { id: 'dataVenda', label: 'Data Venda', visible: true },
        { id: 'entrega', label: 'Entrega', visible: true },
        { id: 'previsao', label: 'Previsão', visible: true },
        { id: 'pedido', label: 'Pedido', visible: true },
        { id: 'cliente', label: 'Cliente', visible: true },
        { id: 'telefone', label: 'Telefone', visible: true },
        { id: 'sinais', label: 'Sinais', visible: true },
        { id: 'produto', label: 'Produto', visible: true },
        { id: 'sku', label: 'SKU', visible: true },
        { id: 'obsPublicas', label: 'Obs. Públicas', visible: true },
        { id: 'obsInternas', label: 'Obs. Internas', visible: true },
        { id: 'cidade', label: 'Cidade', visible: true },
        { id: 'bairro', label: 'Bairro', visible: true },
        { id: 'endereco', label: 'Endereço', visible: true },
      ];

      try {
        // Load columns config from Supabase (or localStorage fallback)
        if (authUser?.id) {
          const savedCols = await loadUserPreference<ColumnConfig[]>(authUser.id, 'am_columns_conf');
          if (savedCols) {
            const merged = mergeColumnsConfig(savedCols, defaults);
            setColumnsConf(merged);
          }
        } else {
          // Fallback to localStorage if not authenticated
          const cols = localStorage.getItem('am_columns_conf');
          if (cols) {
            const parsed = JSON.parse(cols);
            if (Array.isArray(parsed)) {
              const merged = mergeColumnsConfig(parsed, defaults);
              setColumnsConf(merged);
            }
          }
        }
      } catch (e) {
        console.warn('[AssemblyManagement] Error loading columns config:', e);
      }
    };

    loadColumnsFromSupabase();
  }, [authUser?.id]);

  // Restore persisted selections and scroll position (original logic)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('am_selectedOrders');
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr)) setSelectedOrders(new Set(arr.map(String)));
      }
      const rid = localStorage.getItem('am_selectedRouteId');
      const showCreatePref = localStorage.getItem('am_showCreateModal');
      const showRoutePref = localStorage.getItem('am_showRouteModal');
      if (showCreatePref === '1') setShowCreateModal(true);
      if (showRoutePref === '1' && rid) {
        const found = (assemblyRoutes || []).find(r => String(r.id) === String(rid));
        setSelectedRoute(found || null);
        setShowRouteModal(true);
      }
      const sLeft = Number(localStorage.getItem('am_productsScrollLeft') || '0');
      if (productsScrollRef.current && sLeft > 0) productsScrollRef.current.scrollLeft = sLeft;
    } catch { }
  }, []);

  useEffect(() => {
    try { localStorage.setItem('am_selectedOrders', JSON.stringify(Array.from(selectedOrders))); } catch { }
  }, [selectedOrders]);

  const onProductsScroll = () => {
    try { if (productsScrollRef.current) localStorage.setItem('am_productsScrollLeft', String(productsScrollRef.current.scrollLeft || 0)); } catch { }
  };

  // Persist filters across refresh/tab switch
  useEffect(() => {
    try {
      const data = localStorage.getItem('am_filters');
      if (data) {
        const f = JSON.parse(data);
        if (f && typeof f === 'object') {
          if ('city' in f) setFilterCity(f.city || '');
          if ('neighborhood' in f) setFilterNeighborhood(f.neighborhood || '');
          if ('deadline' in f) setFilterDeadline(f.deadline || 'all');
        }
      }
    } catch { }
  }, []);

  useEffect(() => {
    try {
      const payload = {
        city: filterCity,
        neighborhood: filterNeighborhood,
        deadline: filterDeadline,
      };
      localStorage.setItem('am_filters', JSON.stringify(payload));
    } catch { }
  }, [filterCity, filterNeighborhood, filterDeadline]);

  // --- MEMOS (Options) ---
  const cityOptions = useMemo(() => {
    const cities = new Set<string>();
    assemblyPending.forEach(ap => {
      const city = ap.order?.address_json?.city;
      if (city) cities.add(city);
    });
    return Array.from(cities).sort();
  }, [assemblyPending]);

  const neighborhoodOptions = useMemo(() => {
    const neighborhoods = new Set<string>();
    assemblyPending.forEach(ap => {
      const neighborhood = ap.order?.address_json?.neighborhood;
      if (neighborhood) neighborhoods.add(neighborhood);
    });
    return Array.from(neighborhoods).sort();
  }, [assemblyPending]);

  // --- HELPERS ---
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

  const parseDateSafe = (input: any): Date | null => {
    if (!input) return null;
    try { const d = new Date(String(input)); return isNaN(d.getTime()) ? null : d; } catch { return null; }
  };

  const getPrevisaoEntrega = (order: any): Date | null => {
    const raw: any = order?.raw_json || {};
    const prev = order?.previsao_entrega || raw?.previsao_entrega || raw?.data_prevista_entrega || '';
    return parseDateSafe(prev);
  };

  const getPrazoStatusForOrder = (o: any): 'within' | 'out' | 'none' => {
    const prev = getPrevisaoEntrega(o);
    if (!prev) return 'none';
    const today = new Date();
    return today.getTime() <= prev.getTime() ? 'within' : 'out';
  };

  // --- DATA LOADING ---
  const loadData = async (silent: boolean = true) => {
    try {
      if (isLoadingRef.current) return;
      isLoadingRef.current = true;
      if (!silent) setLoading(true);

      // Load assembly routes
      const { data: routesData } = await supabase
        .from('assembly_routes')
        .select('*')
        .order('created_at', { ascending: false });

      // Load assembly products (split queries for performance)
      const { data: productsPending } = await supabase
        .from('assembly_products')
        .select(`
          id, order_id, product_name, product_sku, status, assembly_route_id, created_at, updated_at, was_returned,
          order:order_id (id, order_id_erp, customer_name, phone, address_json, raw_json, data_venda, previsao_entrega, observacoes_publicas, observacoes_internas),
          installer:installer_id (id, name)
        `)
        .eq('status', 'pending')
        .is('assembly_route_id', null)
        .order('created_at', { ascending: false });

      let productsInRoutes: any[] = [];
      try {
        const routeIds = Array.from(new Set((routesData || []).map((r: any) => r.id))).filter(Boolean);
        if (routeIds.length > 0) {
          const { data: productsR } = await supabase
            .from('assembly_products')
            .select(`
              id, order_id, product_name, product_sku, status, assembly_route_id, created_at, updated_at, was_returned, completion_date, returned_at,
              order:order_id (id, order_id_erp, customer_name, phone, address_json, raw_json, items_json, data_venda, previsao_entrega),
              installer:installer_id (id, name)
            `)
            .in('assembly_route_id', routeIds);
          productsInRoutes = productsR || [];
        }
      } catch { }

      // Load montadores
      const { data: montadoresData } = await supabase
        .from('users')
        .select('*')
        .eq('role', 'montador');

      // Load vehicles
      const { data: vehiclesData } = await supabase
        .from('vehicles')
        .select('*')
        .eq('active', true);

      // Always set state - React handles unmounted components internally
      console.log('[AssemblyManagement] Setting state - routes:', (routesData || []).length, 'pending:', (productsPending || []).length);
      setAssemblyRoutes(routesData || []);
      setAssemblyProducts((productsPending || []) as any);
      setAssemblyPending((productsPending || []) as any);
      setAssemblyInRoutes((productsInRoutes || []) as any);
      setMontadores(montadoresData || []);
      setVehicles(vehiclesData || []);
      try {
        const rid = localStorage.getItem('am_selectedRouteId');
        const showPref = localStorage.getItem('am_showRouteModal');
        if (showPref === '1' && rid && isMountedRef.current) {
          const found = (routesData || []).find((r: any) => String(r.id) === String(rid));
          if (found) {
            setSelectedRoute(found);
            setShowRouteModal(true);
          }
        }
      } catch { }
      try {
        const orderIds = Array.from(new Set(((productsPending || []) as any[]).map((ap: any) => String(ap.order_id)).filter(Boolean)));
        if (orderIds.length > 0) {
          const { data: roDelivered } = await supabase
            .from('route_orders')
            .select('order_id, delivered_at, status')
            .in('order_id', orderIds)
            .eq('status', 'delivered');
          const map: Record<string, string> = {};
          (roDelivered || []).forEach((r: any) => { if (r.delivered_at) map[String(r.order_id)] = String(r.delivered_at); });
          console.log('[AssemblyManagement] deliveryInfo map:', Object.keys(map).length, 'items, orderIds searched:', orderIds.length);
          setDeliveryInfo(map);
        } else {
          setDeliveryInfo({});
        }
      } catch { }

    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  };

  // --- EFFECTS ---

  // Load initial data and set up visibility change listener
  useEffect(() => {
    // Load data on mount
    loadData(true);

    // Set up visibility change listener for background refresh (without resetting state)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Only refresh in background, don't show loading or reset modal state
        loadData(true); // silent=true to not show loading and preserve modals
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMountedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const toggleOrderSelection = (orderId: string) => {
    const newSelected = new Set(selectedOrders);
    const wasSelected = newSelected.has(orderId);
    if (wasSelected) {
      newSelected.delete(orderId);
    } else {
      newSelected.add(orderId);
    }
    setSelectedOrders(newSelected);
  };

  // Generate unique route code: RM-DDMMYY-XXX for assembly routes
  const generateRouteCode = async (): Promise<string> => {
    const prefix = 'RM';
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const dateCode = `${day}${month}${year}`;

    // Query existing codes for today to get next sequence
    const pattern = `${prefix}-${dateCode}-%`;
    const { data: existingRoutes } = await supabase
      .from('assembly_routes')
      .select('route_code')
      .like('route_code', pattern)
      .order('route_code', { ascending: false })
      .limit(1);

    let nextSeq = 1;
    if (existingRoutes && existingRoutes.length > 0 && existingRoutes[0].route_code) {
      const lastCode = existingRoutes[0].route_code as string;
      const lastSeq = parseInt(lastCode.split('-')[2], 10);
      if (!isNaN(lastSeq)) {
        nextSeq = lastSeq + 1;
      }
    }

    return `${prefix}-${dateCode}-${String(nextSeq).padStart(3, '0')}`;
  };

  const createAssemblyRoute = async () => {
    // If creating new route, name is required
    if (!selectedExistingRoute && !routeName.trim()) {
      toast.error('Por favor, informe um nome para o romaneio');
      return;
    }

    if (selectedOrders.size === 0) {
      toast.error('Por favor, selecione pelo menos um pedido');
      return;
    }

    // If creating new route, montador is required
    if (!selectedExistingRoute && !selectedMontador) {
      toast.error('Por favor, selecione um montador - o montador é obrigatório');
      return;
    }

    // If creating new route, vehicle is required
    if (!selectedExistingRoute && !selectedVehicle) {
      toast.error('Por favor, selecione um veículo - o veículo é obrigatório');
      return;
    }

    // If creating new route, deadline is required
    if (!selectedExistingRoute && !deadline) {
      toast.error('Por favor, informe o prazo de conclusão');
      return;
    }

    setSaving(true);

    try {
      // Get products for selected orders
      const selectedOrderIds = Array.from(selectedOrders);
      const productsForRoute = assemblyPending.filter(ap =>
        selectedOrderIds.includes(String(ap.order_id)) &&
        !ap.assembly_route_id &&
        ap.status === 'pending'
      );

      if (productsForRoute.length === 0) {
        toast.error('Nenhum produto disponível para os pedidos selecionados');
        return;
      }

      let targetRouteId: string;
      let targetInstallerId: string | null = null;

      if (selectedExistingRoute) {
        // Adding to existing route
        targetRouteId = selectedExistingRoute;
        // Get the existing route's assembler_id
        const existingRoute = assemblyRoutes.find(r => r.id === selectedExistingRoute);
        targetInstallerId = (existingRoute as any)?.assembler_id || null;
      } else {
        // Create new route
        // Generate unique route code
        const routeCode = await generateRouteCode();

        const { data: routeData, error: routeError } = await supabase
          .from('assembly_routes')
          .insert({
            name: routeName.trim(),
            deadline: deadline || null,
            observations: observations.trim() || null,
            assembler_id: selectedMontador || null,
            vehicle_id: selectedVehicle || null,
            status: 'pending',
            route_code: routeCode,
          })
          .select()
          .single();

        if (routeError) throw routeError;
        targetRouteId = routeData.id;
        targetInstallerId = selectedMontador || null;
      }

      // Update products with route and installer
      const productIds = productsForRoute.map(p => p.id);
      const { error: updateError } = await supabase
        .from('assembly_products')
        .update({
          assembly_route_id: targetRouteId,
          installer_id: targetInstallerId
        })
        .in('id', productIds);

      if (updateError) throw updateError;

      toast.success(selectedExistingRoute
        ? 'Pedidos adicionados ao romaneio existente!'
        : 'Romaneio de montagem criado com sucesso!');

      // Reset form
      setRouteName('');
      setSelectedMontador('');
      setSelectedVehicle('');
      setObservations('');
      setDeadline('');
      setSelectedExistingRoute('');
      setSelectedOrders(new Set());
      setShowCreateModal(false);

      // Reload data
      loadData(false);

    } catch (error) {
      console.error('Error creating assembly route:', error);
      toast.error('Erro ao criar romaneio de montagem');
    } finally {
      setSaving(false);
    }
  };

  const saveRouteEdits = async () => {
    if (!selectedRoute) return;
    if (!editRouteName.trim()) {
      toast.error('Por favor, informe um nome para o romaneio');
      return;
    }
    if (!editRouteMontador) {
      toast.error('Por favor, selecione um montador - o montador é obrigatório');
      return;
    }

    setSavingEdit(true);
    try {
      const { error } = await supabase
        .from('assembly_routes')
        .update({
          name: editRouteName.trim(),
          assembler_id: editRouteMontador || null,
          vehicle_id: editRouteVehicle || null,
          deadline: editRouteDeadline || null,
          observations: editRouteObservations.trim() || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedRoute.id);

      if (error) throw error;

      toast.success('Romaneio atualizado com sucesso!');
      setIsEditingRoute(false);

      // Update the selectedRoute in state
      setSelectedRoute({
        ...selectedRoute,
        name: editRouteName.trim(),
        assembler_id: editRouteMontador || null,
        vehicle_id: editRouteVehicle || null,
        deadline: editRouteDeadline || null,
        observations: editRouteObservations.trim() || null,
      } as any);

      // Reload data to refresh the list
      loadData(true);
    } catch (error) {
      console.error('Error updating assembly route:', error);
      toast.error('Erro ao atualizar romaneio');
    } finally {
      setSavingEdit(false);
    }
  };

  // Remove all products of an order from the current route (return to pending)
  const removeOrderFromRoute = async (orderId: string) => {
    if (!selectedRoute) return;
    if ((selectedRoute as any).status !== 'pending') {
      toast.error('Não é possível remover pedidos de rotas finalizadas');
      return;
    }

    try {
      // Get all products for this order in this route
      const productsToRemove = assemblyInRoutes.filter(
        ap => ap.assembly_route_id === selectedRoute.id && String(ap.order_id) === String(orderId)
      );

      if (productsToRemove.length === 0) {
        toast.error('Nenhum produto encontrado para remover');
        return;
      }

      // Update products to remove them from the route (set assembly_route_id to null)
      const productIds = productsToRemove.map(p => p.id);
      const { error } = await supabase
        .from('assembly_products')
        .update({ assembly_route_id: null, updated_at: new Date().toISOString() })
        .in('id', productIds);

      if (error) throw error;

      toast.success('Pedido removido da rota');
      loadData(true);
    } catch (error) {
      console.error('Error removing order from route:', error);
      toast.error('Erro ao remover pedido da rota');
    }
  };

  // Delete an empty route
  const deleteEmptyRoute = async () => {
    if (!selectedRoute) return;
    if ((selectedRoute as any).status !== 'pending') {
      toast.error('Não é possível excluir rotas finalizadas');
      return;
    }

    // Check if route has any products
    const productsInRoute = assemblyInRoutes.filter(ap => ap.assembly_route_id === selectedRoute.id);
    if (productsInRoute.length > 0) {
      toast.error('Não é possível excluir rota com pedidos. Remova todos os pedidos primeiro.');
      return;
    }

    try {
      const { error } = await supabase
        .from('assembly_routes')
        .delete()
        .eq('id', selectedRoute.id);

      if (error) throw error;

      toast.success('Rota excluída com sucesso');
      setShowRouteModal(false);
      setSelectedRoute(null);
      loadData(true);
    } catch (error) {
      console.error('Error deleting route:', error);
      toast.error('Erro ao excluir rota');
    }
  };

  // --- SINGLE LAUNCH IMPORT HANDLER ---
  // Esta função importa lançamentos avulsos (troca/assistência) diretamente para a tabela assembly_products,
  // pulando o gatilho normal de entrega. O pedido é salvo em orders com status 'delivered' 
  // e os produtos são inseridos diretamente em assembly_products com status 'pending'.
  const handleLaunchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!launchNumber.trim()) { toast.error('Digite o número do lançamento'); return; }

    setLaunchLoading(true);
    try {
      let webhookUrl = import.meta.env.VITE_WEBHOOK_URL_CONSULTA as string | undefined;
      if (!webhookUrl) {
        const { data } = await supabase.from('webhook_settings').select('url').eq('key', 'consulta_lancamento').eq('active', true).single();
        webhookUrl = data?.url;
      }

      if (!webhookUrl) {
        webhookUrl = 'https://n8n.lojaodosmoveis.shop/webhook-test/ca7881e9-b639-452c-8eca-33f410358530'; // Fallback
      }

      const body = {
        lancamento: launchNumber.trim(),
        tipo: launchType,
        timestamp: new Date().toISOString()
      };

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) throw new Error(`Erro ${response.status}: ${response.statusText}`);

      const text = await response.text();
      let data: any;
      try { data = JSON.parse(text); } catch { throw new Error('Resposta inválida do servidor (não é JSON)'); }

      const items = Array.isArray(data) ? data : [data];
      if (items.length === 0 || !items[0]) {
        toast.error('Nenhum pedido encontrado com este lançamento');
        setLaunchLoading(false);
        return;
      }

      let insertedProductsCount = 0;
      let errors = 0;
      const now = new Date().toISOString();
      const importedOrderIds: string[] = []; // Rastrear IDs dos pedidos importados para seleção automática

      for (const o of items) {
        const produtos = Array.isArray(o.produtos) ? o.produtos : (Array.isArray(o.produtos_locais) ? o.produtos_locais : []);
        const getVal = (v: any) => String(v ?? '').trim();

        const pickZip = (raw: any) => {
          const candidates = [raw?.destinatario_cep, raw?.cep, raw?.endereco_cep, raw?.codigo_postal, raw?.zip];
          for (const c of candidates) { const s = String(c || '').trim(); if (s) return s; }
          return '';
        };

        // Construir ID do pedido com sufixo para troca/assistência
        let erpId = String(o.numero_lancamento ?? o.lancamento_venda ?? o.codigo_cliente ?? launchNumber);
        if (launchType !== 'venda') {
          const suffix = launchType === 'troca' ? '-T' : '-A';
          if (!erpId.endsWith(suffix) && !erpId.endsWith('-T') && !erpId.endsWith('-A')) {
            erpId = `${erpId}${suffix}`;
          }
        }

        // Verificar se o pedido já existe no sistema
        const { data: existingOrder } = await supabase
          .from('orders')
          .select('id, order_id_erp')
          .eq('order_id_erp', erpId)
          .single();

        let orderId: string;

        if (existingOrder) {
          // Se o pedido já existe, verificar se já tem produtos de montagem
          const { data: existingProducts } = await supabase
            .from('assembly_products')
            .select('id')
            .eq('order_id', existingOrder.id);

          if (existingProducts && existingProducts.length > 0) {
            toast.warning(`Pedido ${erpId} já possui produtos de montagem cadastrados. Pulando...`);
            continue;
          }
          orderId = existingOrder.id;
        } else {
          // Criar o pedido na tabela orders com status 'delivered' (pula a roteirização de entrega)
          const itemsJson = produtos.map((p: any) => ({
            sku: getVal(p.codigo_produto),
            name: getVal(p.nome_produto),
            quantity: Number(p.quantidade_volumes ?? 1),
            volumes_per_unit: Number(p.quantidade_volumes ?? 1),
            purchased_quantity: Number(p.quantidade_comprada ?? 1),
            unit_price_real: Number(p.valor_unitario_real ?? p.valor_unitario ?? 0),
            total_price_real: Number(p.valor_total_real ?? p.valor_total_item ?? 0),
            unit_price: Number(p.valor_unitario_real ?? p.valor_unitario ?? 0),
            total_price: Number(p.valor_total_real ?? p.valor_total_item ?? 0),
            price: Number(p.valor_unitario_real ?? p.valor_unitario ?? 0),
            location: getVal(p.local_estocagem),
            has_assembly: 'SIM', // Forçar montagem para importação avulsa
            labels: Array.isArray(p.etiquetas) ? p.etiquetas : [],
            department: getVal(p.departamento),
            brand: getVal(p.marca),
          }));

          const orderRecord = {
            order_id_erp: erpId,
            customer_name: getVal(o.nome_cliente),
            phone: getVal(o.cliente_celular),
            customer_cpf: getVal(o.cpf_cliente),
            filial_venda: getVal(o.filial_venda),
            vendedor_nome: getVal(o.nome_vendedor ?? o.vendedor ?? o.vendedor_nome),
            data_venda: o.data_venda ? new Date(o.data_venda).toISOString() : now,
            previsao_entrega: o.previsao_entrega ? new Date(o.previsao_entrega).toISOString() : null,
            observacoes_publicas: getVal(o.observacoes_publicas),
            observacoes_internas: getVal(o.observacoes_internas),
            tem_frete_full: getVal(o.tem_frete_full),
            address_json: {
              street: getVal(o.destinatario_endereco),
              neighborhood: getVal(o.destinatario_bairro),
              city: getVal(o.destinatario_cidade),
              state: '',
              zip: pickZip(o),
              complement: getVal(o.destinatario_complemento),
              lat: o.lat ?? o.latitude ?? null,
              lng: o.lng ?? o.longitude ?? o.long ?? null
            },
            items_json: itemsJson,
            status: 'delivered', // IMPORTANTE: Status 'delivered' para pular roteirização de entrega
            raw_json: o,
            service_type: launchType === 'venda' ? undefined : launchType,
            department: String(itemsJson[0]?.department || ''),
            brand: String(itemsJson[0]?.brand || '')
          };

          const { data: insertedOrder, error: orderError } = await supabase
            .from('orders')
            .insert(orderRecord)
            .select('id')
            .single();

          if (orderError) {
            console.error('Erro ao inserir pedido:', orderError);
            errors++;
            continue;
          }

          orderId = insertedOrder.id;
        }

        // Agora inserir os produtos diretamente na tabela assembly_products (pulando o gatilho de entrega)
        const addressJson = {
          street: getVal(o.destinatario_endereco),
          neighborhood: getVal(o.destinatario_bairro),
          city: getVal(o.destinatario_cidade),
          state: '',
          zip: pickZip(o),
          complement: getVal(o.destinatario_complemento)
        };

        const assemblyProducts = produtos.map((p: any) => ({
          order_id: orderId,
          product_name: getVal(p.nome_produto) || 'Produto sem nome',
          product_sku: getVal(p.codigo_produto) || null,
          customer_name: getVal(o.nome_cliente),
          customer_phone: getVal(o.cliente_celular),
          installation_address: addressJson,
          status: 'pending',
          created_at: now,
          updated_at: now
        }));

        if (assemblyProducts.length > 0) {
          const { error: assemblyError } = await supabase
            .from('assembly_products')
            .insert(assemblyProducts);

          if (assemblyError) {
            console.error('Erro ao inserir produtos de montagem:', assemblyError);
            errors++;
          } else {
            insertedProductsCount += assemblyProducts.length;
            importedOrderIds.push(orderId); // Adicionar para seleção automática
            console.log(`[AssemblyManagement] Inseridos ${assemblyProducts.length} produtos de montagem para pedido ${erpId}`);
          }
        }
      }

      if (errors > 0 && insertedProductsCount === 0) {
        toast.error(`Erro ao importar. Verifique se o pedido já existe.`);
      } else if (errors > 0) {
        toast.warning(`${insertedProductsCount} produto(s) importado(s), ${errors} erro(s).`);
        // Mesmo com erros, selecionar os que foram importados com sucesso
        if (importedOrderIds.length > 0) {
          await loadData(false);
          setSelectedOrders(prev => {
            const newSet = new Set(prev);
            importedOrderIds.forEach(id => newSet.add(id));
            return newSet;
          });
        }
      } else if (insertedProductsCount > 0) {
        const tipoLabel = launchType === 'troca' ? 'Troca' : launchType === 'assistencia' ? 'Assistência' : 'Pedido';
        toast.success(`${tipoLabel} importado(s) com sucesso! ${insertedProductsCount} produto(s) disponíveis para montagem.`);
        setShowLaunchModal(false);
        setLaunchNumber('');
        await loadData(false);

        // Selecionar automaticamente os pedidos importados
        setSelectedOrders(prev => {
          const newSet = new Set(prev);
          importedOrderIds.forEach(id => newSet.add(id));
          return newSet;
        });
      } else {
        toast.info('Nenhum produto importado. Verifique se o pedido possui produtos.');
      }

    } catch (e: any) {
      console.error(e);
      toast.error(`Erro: ${e.message}`);
    } finally {
      setLaunchLoading(false);
    }
  };

  // --- RENDER ---


  // Group products by order for display
  const groupedProducts = useMemo(() => {
    const grouped: Record<string, AssemblyProductWithDetails[]> = {};

    assemblyPending.forEach(ap => {
      if (ap.status === 'pending' && !ap.assembly_route_id) {
        const orderId = String(ap.order_id);
        if (!grouped[orderId]) grouped[orderId] = [];
        grouped[orderId].push(ap);
      }
    });

    return grouped;
  }, [assemblyPending]);

  // Filter grouped products
  const filteredGroupedProducts = useMemo(() => {
    const filtered: Record<string, AssemblyProductWithDetails[]> = {};

    Object.entries(groupedProducts).forEach(([orderId, products]) => {
      const firstProduct = products[0];
      const order = firstProduct?.order;
      const addr = (order?.address_json || {}) as any;

      const city = (addr.city || '').toLowerCase();
      const neighborhood = (addr.neighborhood || '').toLowerCase();

      const matchCity = filterCity ? city.includes(filterCity.toLowerCase()) : true;
      const matchNeighborhood = filterNeighborhood ? neighborhood.includes(filterNeighborhood.toLowerCase()) : true;

      const prazo = getPrazoStatusForOrder(order);
      const matchPrazo = filterDeadline === 'all' ? true : filterDeadline === prazo;

      if (matchCity && matchNeighborhood && matchPrazo) {
        filtered[orderId] = products;
      }
    });

    return filtered;
  }, [groupedProducts, filterCity, filterNeighborhood, filterDeadline]);

  const orderRows = useMemo(() => {
    const rows: Array<{ key: string; orderId: string; dataVenda: string; entrega: string; previsao: string; pedido: string; cliente: string; telefone: string; produto: string; sku: string; obsPublicas: string; obsInternas: string; cidade: string; bairro: string; endereco: string; selected: boolean; wasReturned: boolean; isForaPrazo: boolean; }> = [];
    Object.entries(filteredGroupedProducts).forEach(([orderId, products]) => {
      const order = products[0]?.order || {} as any;
      const raw = order?.raw_json || {};
      const addr = order?.address_json || {};
      const dataVenda = formatDate(order?.data_venda || order?.created_at);
      const entrega = formatDate(deliveryInfo[orderId] || null);
      const previsao = formatDate(order?.previsao_entrega || raw?.previsao_entrega || raw?.data_prevista_entrega);
      const pedido = order?.order_id_erp || orderId;
      const cliente = order?.customer_name || '-';
      const telefone = String(order?.phone || raw?.cliente_celular || '-');
      const obsPublicas = order?.observacoes_publicas || raw?.observacoes || '-';
      const obsInternas = order?.observacoes_internas || raw?.observacoes_internas || '-';
      const cidade = addr.city || '-';
      const bairro = addr.neighborhood || '-';
      const endereco = [addr.street, addr.number, addr.complement].filter(Boolean).join(', ') || '-';
      const selected = selectedOrders.has(orderId);
      const prazoStatus = getPrazoStatusForOrder(order);
      const isForaPrazo = prazoStatus === 'out';
      products.forEach((ap, idx) => {
        const wasReturned = (ap as any).was_returned === true;
        rows.push({ key: `${orderId}-${ap.id}-${idx}`, orderId, dataVenda, entrega, previsao, pedido, cliente, telefone, produto: ap.product_name || '-', sku: ap.product_sku || '-', obsPublicas, obsInternas, cidade, bairro, endereco, selected, wasReturned, isForaPrazo });
      });
    });
    return rows;
  }, [filteredGroupedProducts, deliveryInfo, selectedOrders]);

  const totalOrderRows = orderRows.length;
  const totalPages = Math.max(1, Math.ceil(totalOrderRows / ordersPageSize));
  const visibleRows = useMemo(() => {
    const start = (ordersPage - 1) * ordersPageSize;
    return orderRows.slice(start, start + ordersPageSize);
  }, [orderRows, ordersPage, ordersPageSize]);

  return (
    <div className="min-h-screen bg-gray-50 pb-20">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate(-1)}
                className="p-2 -ml-2 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors"
                title="Voltar"
              >
                <ArrowLeft className="h-6 w-6" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                  <Hammer className="h-6 w-6 text-blue-600" />
                  Gestão de Montagem
                </h1>
                <p className="text-sm text-gray-500">Crie, monitore e gerencie montagens e romaneios</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`inline-flex items-center px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${showFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
              >
                <Filter className="h-4 w-4 mr-2" />
                Filtros
              </button>
              <button
                onClick={() => setShowLaunchModal(true)}
                className="inline-flex items-center px-4 py-2 rounded-lg border text-sm font-medium transition-colors bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100"
                title="Lançar Troca ou Assistência Avulsa"
              >
                <FilePlus className="h-4 w-4 mr-2" />
                Lançamento Avulso
              </button>
              <button
                onClick={() => loadData(false)}
                disabled={loading}
                className="inline-flex items-center px-4 py-2 rounded-lg border text-sm font-medium transition-colors bg-white border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCcw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Recarregar
              </button>
              <button
                onClick={() => { try { localStorage.setItem('am_showCreateModal', '1'); } catch { } setShowCreateModal(true); }}
                disabled={selectedOrders.size === 0}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all transform active:scale-95"
              >
                <Plus className="h-4 w-4 mr-2" />
                Criar Romaneio ({selectedOrders.size})
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

        {!loading && (
          <>

            {/* Quick navigation */}
            <div className="sticky top-[72px] z-10">
              <div className="bg-white/90 backdrop-blur shadow-sm border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <MapPin className="h-4 w-4 text-blue-500" />
                  Acesso rápido
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => scrollToSection(ordersSectionRef)}
                    className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700"
                  >
                    Ir para pedidos
                  </button>
                  <button
                    onClick={() => scrollToSection(routesSectionRef)}
                    className="px-3 py-2 text-sm font-medium rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                  >
                    Ir para romaneios
                  </button>
                </div>
              </div>
            </div>

            {/* Filters Panel */}
            {showFilters && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 animate-in slide-in-from-top-2 duration-200">
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-500 uppercase">Cidade</label>
                    <select value={filterCity} onChange={(e) => setFilterCity(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all">
                      <option value="">Todas</option>
                      {cityOptions.map((c) => (<option key={c} value={c}>{c}</option>))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-500 uppercase">Bairro</label>
                    <select value={filterNeighborhood} onChange={(e) => setFilterNeighborhood(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all">
                      <option value="">Todos</option>
                      {neighborhoodOptions.map((c) => (<option key={c} value={c}>{c}</option>))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-500 uppercase">Prazo</label>
                    <select value={filterDeadline} onChange={(e) => setFilterDeadline(e.target.value as any)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all">
                      <option value="all">Todos</option>
                      <option value="within">Dentro do prazo</option>
                      <option value="out">Fora do prazo</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end mt-4 pt-4 border-t border-gray-100">
                  <button
                    onClick={() => { setFilterCity(''); setFilterNeighborhood(''); setFilterDeadline('all'); }}
                    className="text-sm text-red-600 hover:text-red-800 font-medium flex items-center"
                  >
                    <X className="h-3 w-3 mr-1" /> Limpar filtros
                  </button>
                </div>
              </div>
            )}

            {/* Orders Selection Card */}
            <div ref={ordersSectionRef} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <div className="bg-blue-100 p-2 rounded-lg">
                    <Package className="h-5 w-5 text-blue-700" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">Pedidos Disponíveis</h2>
                    <p className="text-xs text-gray-500">{Object.values(filteredGroupedProducts).reduce((acc, list) => acc + (list?.length || 0), 0)} itens aguardando montagem</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <label className="flex items-center px-3 py-2 bg-white border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                    <input
                      type="checkbox"
                      className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                      onChange={(e) => {
                        if (e.currentTarget.checked) {
                          const ids = new Set(Object.keys(filteredGroupedProducts));
                          setSelectedOrders(ids);
                        } else {
                          setSelectedOrders(new Set());
                        }
                      }}
                      checked={Object.keys(filteredGroupedProducts).length > 0 && selectedOrders.size === Object.keys(filteredGroupedProducts).length}
                    />
                    <span className="ml-2 text-sm font-medium text-gray-700">Selecionar Todos</span>
                  </label>
                  <button onClick={() => setShowColumnsModal(true)} className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors" title="Configurar Colunas">
                    <Settings className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Table Area */}
              <div
                ref={productsScrollRef}
                onScroll={onProductsScroll}
                onMouseDown={onProductsMouseDown}
                onMouseMove={onProductsMouseMove}
                onMouseUp={endProductsDrag}
                onMouseLeave={endProductsDrag}
                className={`overflow-auto max-h[500px] ${draggingProducts ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
              >
                {Object.keys(filteredGroupedProducts).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="bg-gray-50 p-4 rounded-full mb-4">
                      <Package className="h-8 w-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900">Nenhum pedido disponível</h3>
                    <p className="text-gray-500 mt-1 max-w-sm">Todos os pedidos já foram montados ou não há produtos pendentes.</p>
                  </div>
                ) : (
                  <table className="min-w-max w-full text-sm divide-y divide-gray-100">
                    <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                      <tr>
                        <th className="px-4 py-3 w-10 text-left"></th>
                        {columnsConf.filter(c => c.visible).map(c => (
                          <th key={c.id} className="px-4 py-3 text-left font-semibold text-gray-600 uppercase text-xs tracking-wider">{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {visibleRows.length === 0 ? (
                        <tr><td colSpan={13} className="px-4 py-8 text-center text-gray-500">Nenhum pedido encontrado</td></tr>
                      ) : (
                        visibleRows.map((row) => {
                          const waLink = (() => {
                            const p = String(row.telefone || '').replace(/\D/g, '');
                            const e164 = p ? (p.startsWith('55') ? p : '55' + p) : '';
                            return e164 ? `https://wa.me/${e164}` : '';
                          })();
                          return (
                            <tr key={row.key} onClick={() => toggleOrderSelection(row.orderId)} className={`group hover:bg-gray-50 transition-colors cursor-pointer ${row.selected ? 'bg-blue-50/60 hover:bg-blue-100/50' : ''}`}>
                              <td className="px-4 py-3">
                                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${row.selected ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'}`}>{row.selected && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}</div>
                              </td>
                              {columnsConf.filter(c => c.visible).map(c => (
                                <td key={c.id} className="px-4 py-3 text-gray-700 whitespace-nowrap">
                                  {c.id === 'dataVenda' ? row.dataVenda :
                                    c.id === 'entrega' ? row.entrega :
                                      c.id === 'previsao' ? row.previsao :
                                        c.id === 'pedido' ? row.pedido :
                                          c.id === 'cliente' ? row.cliente :
                                            c.id === 'telefone' ? (
                                              <div className="flex items-center gap-2">
                                                {waLink && (
                                                  <a href={waLink} target="_blank" rel="noreferrer" className="p-1 rounded text-green-600 hover:bg-green-50" title="Abrir WhatsApp">
                                                    <MessageSquare className="h-4 w-4" />
                                                  </a>
                                                )}
                                                <span>{row.telefone}</span>
                                              </div>
                                            ) :
                                              c.id === 'sinais' ? (
                                                <div className="flex items-center gap-1 flex-wrap">
                                                  {row.wasReturned && (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
                                                      🔄 Retornado
                                                    </span>
                                                  )}
                                                  {row.isForaPrazo ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                                      ⏰ Fora do Prazo
                                                    </span>
                                                  ) : (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                                      ✅ No Prazo
                                                    </span>
                                                  )}
                                                </div>
                                              ) :
                                                c.id === 'produto' ? row.produto :
                                                  c.id === 'sku' ? row.sku :
                                                    c.id === 'obsPublicas' ? row.obsPublicas :
                                                      c.id === 'obsInternas' ? row.obsInternas :
                                                        c.id === 'cidade' ? row.cidade :
                                                          c.id === 'bairro' ? row.bairro :
                                                            c.id === 'endereco' ? row.endereco : '-'}
                                </td>
                              ))}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="px-6 py-3 border-t bg-gray-50 flex items-center justify-between">
                <div className="text-xs text-gray-600">Mostrando {(ordersPage - 1) * ordersPageSize + (totalOrderRows ? 1 : 0)}–{Math.min(ordersPage * ordersPageSize, totalOrderRows)} de {totalOrderRows} itens</div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setOrdersPage(Math.max(1, ordersPage - 1))} disabled={ordersPage <= 1} className="px-3 py-1.5 text-xs rounded-lg border bg-white disabled:opacity-50">Anterior</button>
                  <select value={ordersPageSize} onChange={(e) => { setOrdersPageSize(Number(e.target.value)); setOrdersPage(1); }} className="text-xs border rounded px-2 py-1 bg-white">
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                    <option value={500}>500</option>
                  </select>
                  <button onClick={() => setOrdersPage(Math.min(totalPages, ordersPage + 1))} disabled={ordersPage >= totalPages} className="px-3 py-1.5 text-xs rounded-lg border bg-white disabled:opacity-50">Próxima</button>
                </div>
              </div>
            </div>

            {/* Routes List Section */}
            <div ref={routesSectionRef} className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <Truck className="h-6 w-6 text-gray-700" />
                  Romaneios de Montagem Ativos
                </h2>
                <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-xs font-bold">
                  {assemblyRoutes.length}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {assemblyRoutes.length === 0 ? (
                  <div className="col-span-full bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
                    <div className="mx-auto w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                      <Truck className="h-8 w-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900">Nenhum romaneio encontrado</h3>
                    <p className="text-gray-500">Crie seu primeiro romaneio selecionando pedidos acima.</p>
                  </div>
                ) : (
                  assemblyRoutes.map(route => {
                    const productsInRoute = assemblyInRoutes.filter(ap => ap.assembly_route_id === route.id);

                    // Contar PRODUTOS (não pedidos) por status
                    const totalProducts = productsInRoute.length;
                    const completed = productsInRoute.filter(p => p.status === 'completed').length;
                    const pending = productsInRoute.filter(p => p.status === 'pending' || p.status === 'assigned' || p.status === 'in_progress').length;
                    const returned = productsInRoute.filter(p => p.status === 'cancelled').length;
                    console.log(`Route ${(route as any).route_code}: Total=${totalProducts}, Pending=${pending}, Returned=${returned}`);

                    const statusColors = {
                      pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
                      in_progress: 'bg-yellow-50 text-yellow-700 border-yellow-200',
                      completed: 'bg-green-50 text-green-700 border-green-200'
                    };
                    const statusLabel = {
                      pending: 'Pendente',
                      in_progress: 'Pendente',
                      completed: 'Concluído'
                    };

                    const montador = montadores.find(m => m.id === route.assembler_id);
                    const vehicle = vehicles.find(v => v.id === route.vehicle_id);

                    return (
                      <div key={route.id} className="bg-white rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow group flex flex-col">
                        <div className="p-5 flex-1">
                          <div className="flex flex-col items-center gap-2 mb-4">
                            <div className="text-center">
                              <h3 className="font-bold text-gray-900 text-lg group-hover:text-blue-600 transition-colors">{route.name}</h3>
                              {(route as any).route_code && (
                                <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-mono rounded mt-1">
                                  {(route as any).route_code}
                                </span>
                              )}
                              <p className="text-xs text-gray-500 mt-1 flex items-center justify-center">
                                <Calendar className="h-3 w-3 mr-1" />
                                {formatDate(route.created_at)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${statusColors[route.status] || 'bg-gray-100'}`}>
                                {statusLabel[route.status] || route.status}
                              </span>
                            </div>
                          </div>

                          <div className="space-y-3 mb-6">
                            <div className="flex items-center text-sm text-gray-600">
                              <UserIcon className="h-4 w-4 mr-2 text-gray-400" />
                              {montador?.name || montador?.email || 'Sem montador'}
                            </div>
                            {vehicle && (
                              <div className="flex items-center text-sm text-gray-600">
                                <Truck className="h-4 w-4 mr-2 text-gray-400" />
                                {vehicle.model} ({vehicle.plate})
                              </div>
                            )}
                            {route.deadline && (
                              <div className="flex items-center text-sm text-gray-600">
                                <Calendar className="h-4 w-4 mr-2 text-gray-400" />
                                Prazo: {formatDate(route.deadline)}
                              </div>
                            )}
                          </div>

                          {/* Mini Stats */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                            <div className="bg-gray-50 rounded-lg p-2 text-center">
                              <span className="block text-lg font-bold text-gray-900">{totalProducts}</span>
                              <span className="text-[10px] uppercase text-gray-500 font-bold">Total</span>
                            </div>
                            <div className="bg-green-50 rounded-lg p-2 text-center">
                              <span className="block text-lg font-bold text-green-700">{completed}</span>
                              <span className="text-[10px] uppercase text-green-600 font-bold">Concluídos</span>
                            </div>
                            <div className="bg-yellow-50 rounded-lg p-2 text-center">
                              <span className="block text-lg font-bold text-yellow-700">{pending}</span>
                              <span className="text-[10px] uppercase text-yellow-600 font-bold">Pendentes</span>
                            </div>
                            <div className="bg-red-50 rounded-lg p-2 text-center">
                              <span className="block text-lg font-bold text-red-700">{returned}</span>
                              <span className="text-[10px] uppercase text-red-600 font-bold">Retornados</span>
                            </div>
                          </div>
                        </div>

                        <div className="p-4 border-t border-gray-100 bg-gray-50/50 rounded-b-xl flex gap-3">
                          <button
                            onClick={() => {
                              try { localStorage.setItem('am_selectedRouteId', String(route.id)); localStorage.setItem('am_showRouteModal', '1'); } catch { }
                              setSelectedRoute(route);
                              setShowRouteModal(true);
                            }}
                            className="flex-1 inline-flex items-center justify-center px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                          >
                            <Eye className="h-4 w-4 mr-2" /> Detalhes
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                const products = assemblyInRoutes.filter(ap => ap.assembly_route_id === route.id);
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
                                  route_code: (route as any).route_code,
                                };

                                const data = {
                                  route: routeData,
                                  routeOrders,
                                  driver: { id: '', user_id: '', cpf: '', active: true, name: '—', user: { id: '', email: '', name: '—', role: 'driver', created_at: new Date().toISOString() } } as any,
                                  vehicle: undefined,
                                  orders: orders as any,
                                  generatedAt: new Date().toISOString(),
                                  assemblyInstallerName: montador?.name || montador?.email || '—',
                                  assemblyVehicleModel: vehicle?.model || '',
                                  assemblyVehiclePlate: vehicle?.plate || '',
                                };

                                const pdfBytes = await DeliverySheetGenerator.generateDeliverySheet(data, 'Romaneio de Montagem');
                                DeliverySheetGenerator.openPDFInNewTab(pdfBytes);
                              } catch (e) {
                                console.error(e);
                                toast.error('Erro ao gerar PDF do romaneio');
                              }
                            }}
                            className="flex-1 inline-flex items-center justify-center px-4 py-2 bg-blue-50 border border-blue-100 text-blue-700 text-sm font-medium rounded-lg hover:bg-blue-100 transition-colors"
                          >
                            <FileText className="h-4 w-4 mr-2" /> PDF
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

          </>)}
      </div>

      {/* --- MODALS --- */}

      {/* Create Route Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 flex-shrink-0">
              <h3 className="text-lg font-bold text-gray-900">Novo Romaneio de Montagem</h3>
              <button onClick={() => { try { localStorage.setItem('am_showCreateModal', '0'); } catch { } setShowCreateModal(false); }} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-6 overflow-y-auto flex-1">
              {/* Select existing route or create new */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Adicionar a romaneio existente?</label>
                <select
                  value={selectedExistingRoute}
                  onChange={(e) => setSelectedExistingRoute(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                >
                  <option value="">Não, criar novo romaneio</option>
                  {assemblyRoutes
                    .filter(r => r.status === 'pending')
                    .map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))
                  }
                </select>
              </div>

              {/* Only show name field if creating new route */}
              {!selectedExistingRoute && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Nome do Romaneio <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={routeName}
                    onChange={(e) => setRouteName(e.target.value)}
                    placeholder="Ex: Montagem Zona Sul - Manhã"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  />
                </div>
              )}

              {/* Only show these fields if creating new route */}
              {!selectedExistingRoute && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Montador <span className="text-red-500">*</span></label>
                      <select
                        value={selectedMontador}
                        onChange={(e) => setSelectedMontador(e.target.value)}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      >
                        <option value="">Selecione...</option>
                        {montadores.map(m => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Veículo <span className="text-red-500">*</span></label>
                      <select
                        value={selectedVehicle}
                        onChange={(e) => setSelectedVehicle(e.target.value)}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      >
                        <option value="">Selecione...</option>
                        {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate} - {v.model}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Prazo de Conclusão <span className="text-red-500">*</span></label>
                    <input
                      type="date"
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Observações</label>
                    <textarea
                      value={observations}
                      onChange={(e) => setObservations(e.target.value)}
                      rows={3}
                      placeholder="Observações sobre a montagem..."
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    />
                  </div>
                </>
              )}

              <div className="bg-blue-50 p-4 rounded-xl flex items-center justify-between">
                <span className="text-blue-900 font-medium">Pedidos Selecionados</span>
                <span className="bg-blue-200 text-blue-800 px-3 py-1 rounded-lg font-bold">{selectedOrders.size}</span>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setShowCreateModal(false)} className="px-6 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-white transition-colors">Cancelar</button>
              <button
                onClick={() => createAssemblyRoute()}
                disabled={saving || (selectedOrders.size === 0) || (!selectedExistingRoute && !routeName.trim())}
                className="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 disabled:opacity-50 disabled:shadow-none transition-all transform active:scale-95"
              >
                {saving ? 'Salvando...' : (selectedExistingRoute ? 'Adicionar à Rota' : 'Confirmar Romaneio')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Columns Modal */}
      {showColumnsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-gray-900">Configurar Colunas</h3>
              <button onClick={() => setShowColumnsModal(false)}><X className="h-5 w-5 text-gray-400" /></button>
            </div>
            <div className="p-2 overflow-y-auto max-h-[60vh]">
              {columnsConf.map((c, idx) => (
                <div key={c.id} className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg group">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={c.visible}
                      onChange={() => {
                        const newCols = [...columnsConf];
                        newCols[idx].visible = !newCols[idx].visible;
                        setColumnsConf(newCols);
                      }}
                      className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <span className="text-gray-700">{c.label}</span>
                  </label>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => {
                        if (idx === 0) return;
                        const newCols = [...columnsConf];
                        [newCols[idx - 1], newCols[idx]] = [newCols[idx], newCols[idx - 1]];
                        setColumnsConf(newCols);
                      }}
                      className="p-1 hover:bg-gray-200 rounded"
                    ><ChevronUp className="h-4 w-4" /></button>
                    <button
                      onClick={() => {
                        if (idx === columnsConf.length - 1) return;
                        const newCols = [...columnsConf];
                        [newCols[idx + 1], newCols[idx]] = [newCols[idx], newCols[idx + 1]];
                        setColumnsConf(newCols);
                      }}
                      className="p-1 hover:bg-gray-200 rounded"
                    ><ChevronDown className="h-4 w-4" /></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-gray-100 bg-gray-50 text-right">
              <button
                onClick={async () => {
                  if (authUser?.id) {
                    const success = await saveUserPreference(authUser.id, 'am_columns_conf', columnsConf);
                    if (success) {
                      toast.success('Configuração de colunas salva com sucesso!');
                    } else {
                      toast.error('Erro ao salvar configuração. Tente novamente.');
                    }
                  } else {
                    // Fallback to localStorage if not authenticated
                    localStorage.setItem('am_columns_conf', JSON.stringify(columnsConf));
                    toast.success('Configuração salva localmente.');
                  }
                  setShowColumnsModal(false);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
              >
                Salvar Configuração
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Route Details Modal */}
      {showRouteModal && selectedRoute && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in zoom-in-95 duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
              {/* Header with Edit Toggle */}
              <div className="flex justify-between items-start">
                {!isEditingRoute ? (
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">
                      {selectedRoute.name}
                      {(selectedRoute as any).route_code && (
                        <span className="ml-2 px-2 py-0.5 bg-gray-100 text-gray-600 text-sm font-mono rounded">
                          {(selectedRoute as any).route_code}
                        </span>
                      )}
                    </h2>
                    <p className="text-sm text-gray-500">
                      {selectedRoute.status === 'pending' ? 'Pendente' : selectedRoute.status === 'in_progress' ? 'Pendente' : 'Concluído'}
                      • {formatDate(selectedRoute.created_at)}
                      {(selectedRoute as any).assembler_id && (() => {
                        const m = montadores.find(m => m.id === (selectedRoute as any).assembler_id);
                        return m ? ` • Montador: ${m.name || m.email}` : '';
                      })()}
                      {(selectedRoute as any).vehicle_id && (() => {
                        const v = vehicles.find(v => v.id === (selectedRoute as any).vehicle_id);
                        return v ? ` • ${v.model} (${v.plate})` : '';
                      })()}
                    </p>
                    {selectedRoute.observations && (
                      <p className="text-sm text-gray-500 mt-1">Obs: {selectedRoute.observations}</p>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 mr-4">
                    <h3 className="text-lg font-bold text-gray-900 mb-3">Editar Romaneio</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Nome do Romaneio *</label>
                        <input
                          type="text"
                          value={editRouteName}
                          onChange={(e) => setEditRouteName(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="Nome do romaneio"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Montador *</label>
                        <select
                          value={editRouteMontador}
                          onChange={(e) => setEditRouteMontador(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="">Selecione um montador</option>
                          {montadores.map(m => (
                            <option key={m.id} value={m.id}>{m.name || m.email}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Veículo</label>
                        <select
                          value={editRouteVehicle}
                          onChange={(e) => setEditRouteVehicle(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="">Selecione um veículo</option>
                          {vehicles.map(v => (
                            <option key={v.id} value={v.id}>{v.model} ({v.plate})</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Prazo</label>
                        <input
                          type="date"
                          value={editRouteDeadline}
                          onChange={(e) => setEditRouteDeadline(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-gray-700 mb-1">Observações</label>
                        <input
                          type="text"
                          value={editRouteObservations}
                          onChange={(e) => setEditRouteObservations(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="Observações sobre a rota"
                        />
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Edit / Save / Cancel buttons */}
                  {!isEditingRoute ? (
                    <button
                      onClick={() => {
                        const r = selectedRoute as any;
                        setEditRouteName(r.name || '');
                        setEditRouteMontador(r.assembler_id || '');
                        setEditRouteVehicle(r.vehicle_id || '');
                        setEditRouteDeadline(r.deadline ? r.deadline.split('T')[0] : '');
                        setEditRouteObservations(r.observations || '');
                        setIsEditingRoute(true);
                      }}
                      disabled={(selectedRoute as any).status === 'completed'}
                      className="inline-flex items-center px-3 py-2 border border-yellow-200 shadow-sm text-sm font-medium rounded-lg text-yellow-700 bg-yellow-50 hover:bg-yellow-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Pencil className="h-4 w-4 mr-2" /> Editar
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => saveRouteEdits()}
                        disabled={savingEdit}
                        className="inline-flex items-center px-3 py-2 border border-green-200 shadow-sm text-sm font-medium rounded-lg text-green-700 bg-green-50 hover:bg-green-100 disabled:opacity-50"
                      >
                        <Save className="h-4 w-4 mr-2" /> {savingEdit ? 'Salvando...' : 'Salvar'}
                      </button>
                      <button
                        onClick={() => setIsEditingRoute(false)}
                        disabled={savingEdit}
                        className="inline-flex items-center px-3 py-2 border border-gray-200 shadow-sm text-sm font-medium rounded-lg text-gray-700 bg-gray-50 hover:bg-gray-100 disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    </>
                  )}
                  <button
                    onClick={async () => {
                      try {
                        if (!selectedRoute) return;
                        const route = selectedRoute as any;
                        const products = assemblyInRoutes.filter(ap => ap.assembly_route_id === route.id);
                        const orders = products.map(p => p.order).filter(Boolean) as any[];
                        const routeOrders = products.map((p, idx) => ({ id: String(p.id), route_id: String(route.id), order_id: String(p.order_id), sequence: idx + 1, status: 'pending', created_at: route.created_at, updated_at: route.updated_at })) as any[];
                        const routeData: any = { id: route.id, name: route.name, driver_id: '', vehicle_id: '', conferente: '', observations: route.observations, status: route.status as any, created_at: route.created_at, updated_at: route.updated_at, route_code: (route as any).route_code };
                        const m = montadores.find(m => m.id === (route as any).assembler_id);
                        const v = vehicles.find(v => v.id === (route as any).vehicle_id);
                        const data = { route: routeData, routeOrders, driver: { id: '', user_id: '', cpf: '', active: true, name: '—', user: { id: '', email: '', name: '—', role: 'driver', created_at: new Date().toISOString() } } as any, vehicle: undefined, orders: orders as any, generatedAt: new Date().toISOString(), assemblyInstallerName: m?.name || m?.email || '—', assemblyVehicleModel: v?.model || '', assemblyVehiclePlate: v?.plate || '' };
                        const pdfBytes = await DeliverySheetGenerator.generateDeliverySheet(data, 'Romaneio de Montagem');
                        DeliverySheetGenerator.openPDFInNewTab(pdfBytes);
                      } catch (e) {
                        console.error(e);
                        toast.error('Erro ao gerar PDF do romaneio');
                      }
                    }}
                    className="inline-flex items-center px-3 py-2 border border-blue-200 shadow-sm text-sm font-medium rounded-lg text-blue-700 bg-blue-50 hover:bg-blue-100"
                  >
                    <FileText className="h-4 w-4 mr-2" /> PDF
                  </button>
                  <button
                    onClick={async () => {
                      if (!selectedRoute) return;
                      setWaSending(true);
                      try {
                        const route = selectedRoute as any;
                        const produtosDaRota = assemblyInRoutes.filter(p => p.assembly_route_id === route.id);
                        const mapByOrder = new Map<string, any>();
                        produtosDaRota.forEach((p: any) => {
                          const o = p.order || {};
                          if (!o.id) return;
                          if (!mapByOrder.has(o.id)) {
                            const addr = o.address_json || {};
                            const num = addr.number ? `, ${addr.number}` : '';
                            const endereco_completo = `${addr.street || ''}${num} - ${addr.neighborhood || ''}${addr.city ? ', ' + addr.city : ''}`.trim();
                            mapByOrder.set(o.id, {
                              lancamento_venda: Number(o.order_id_erp || o.id || 0),
                              cliente_nome: String(o.customer_name || ''),
                              cliente_celular: String(o.phone || o.raw_json?.cliente_celular || ''),
                              endereco_completo,
                              produtos: [] as string[],
                            });
                          }
                          const entry = mapByOrder.get(o.id);
                          const sku = String(p.product_sku || '');
                          const nome = String(p.product_name || '');
                          entry.produtos.push(`${sku} - ${nome}`);
                        });
                        const contatos = Array.from(mapByOrder.values()).map((c: any) => ({
                          lancamento_venda: c.lancamento_venda,
                          cliente_nome: c.cliente_nome,
                          cliente_celular: c.cliente_celular,
                          endereco_completo: c.endereco_completo,
                          produtos: (c.produtos || []).join(', '),
                        }));
                        if (contatos.length === 0) { toast.error('Nenhum pedido para envio'); setWaSending(false); return; }
                        let webhookUrl = import.meta.env.VITE_WEBHOOK_WHATSAPP_URL as string | undefined;
                        if (!webhookUrl) {
                          try {
                            const { data } = await supabase.from('webhook_settings').select('url').eq('key', 'envia_mensagem').eq('active', true).single();
                            webhookUrl = data?.url || 'https://n8n.lojaodosmoveis.shop/webhook-test/envia_mensagem';
                          } catch {
                            webhookUrl = 'https://n8n.lojaodosmoveis.shop/webhook-test/envia_mensagem';
                          }
                        }
                        const payload = { contatos, tipo_de_romaneio: 'montagem' } as any;
                        try {
                          await fetch(String(webhookUrl), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                        } catch {
                          const fd = new FormData();
                          for (const c of contatos) fd.append('contatos[]', JSON.stringify(c));
                          fd.append('tipo_de_romaneio', 'montagem');
                          await fetch(String(webhookUrl), { method: 'POST', body: fd });
                        }
                        toast.success('WhatsApp solicitado');
                      } catch (e) {
                        console.error(e);
                        toast.error('Erro ao enviar WhatsApp');
                      } finally {
                        setWaSending(false);
                      }
                    }}
                    disabled={waSending || (selectedRoute as any).status === 'completed'}
                    className="inline-flex items-center px-3 py-2 border border-green-200 shadow-sm text-sm font-medium rounded-lg text-green-700 bg-green-50 hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Enviar cliente
                  </button>
                  <button
                    onClick={async () => {
                      if (!selectedRoute) return;
                      setGroupSending(true);
                      try {
                        const route = selectedRoute as any;
                        const produtos = assemblyInRoutes.filter(p => p.assembly_route_id === route.id);
                        const documentos = Array.from(new Set(produtos.map((p: any) => String(p.order?.order_id_erp || '')).filter(Boolean)));
                        if (documentos.length === 0) { toast.error('Nenhum número de lançamento encontrado'); setGroupSending(false); return; }
                        const assemblerId = (route as any).assembler_id;
                        let assemblerName = '';
                        if (assemblerId) {
                          const m = montadores.find(m => m.id === assemblerId);
                          assemblerName = m?.name || m?.email || '';
                        }

                        // Na montagem não tem equipe, enviar sempre o nome do montador
                        // Usar variável 'finalName' para manter consistência com o bloco anterior se necessário, ou usar assemblerName direto
                        const finalName = assemblerName;

                        let vehicle_text = '';
                        const vehicleId = (route as any).vehicle_id;
                        if (vehicleId) {
                          const v = vehicles.find(v => v.id === vehicleId);
                          if (v) vehicle_text = `${String(v.model || '')}${v.plate ? ' | ' + String(v.plate) : ''}`;
                        }
                        const route_name = String(route.name || '');
                        const status = String(route.status || '');
                        const observations = String(route.observations || '');
                        let webhookUrl = import.meta.env.VITE_WEBHOOK_ENVIA_GRUPO_URL as string | undefined;
                        if (!webhookUrl) {
                          try {
                            const { data } = await supabase.from('webhook_settings').select('url').eq('key', 'envia_grupo').eq('active', true).single();
                            webhookUrl = data?.url || 'https://n8n.lojaodosmoveis.shop/webhook/envia_grupo';
                          } catch {
                            webhookUrl = 'https://n8n.lojaodosmoveis.shop/webhook/envia_grupo';
                          }
                        }
                        // Envia o nome do montador no campo driver_name e route_code como route_id
                        const payload = { route_id: (route as any).route_code, route_name, driver_name: finalName, conferente: finalName, documentos, status, vehicle: vehicle_text, observations, tipo_de_romaneio: 'montagem' } as any;
                        try {
                          const resp = await fetch(String(webhookUrl), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                          if (!resp.ok) {
                            const text = await resp.text();
                            if (resp.status === 404 && text.includes('envia_grupo')) {
                              toast.error('Webhook não está ativo.');
                            } else {
                              toast.error('Falha ao enviar informativo');
                            }
                            setGroupSending(false);
                            return;
                          }
                        } catch {
                          const fd = new FormData();
                          fd.append('route_id', (route as any).route_code);
                          fd.append('route_name', route_name);
                          fd.append('driver_name', finalName);
                          fd.append('conferente', finalName);
                          fd.append('status', status);
                          fd.append('vehicle', vehicle_text);
                          fd.append('observations', observations);
                          fd.append('tipo_de_romaneio', 'montagem');
                          for (const d of documentos) fd.append('documentos[]', d);
                          await fetch(String(webhookUrl), { method: 'POST', body: fd });
                        }
                        toast.success('Rota enviada ao grupo');
                      } catch (e) {
                        console.error(e);
                        toast.error('Erro ao enviar rota em grupo');
                      } finally {
                        setGroupSending(false);
                      }
                    }}
                    disabled={groupSending || (selectedRoute as any).status === 'completed'}
                    className="inline-flex items-center px-3 py-2 border border-green-200 shadow-sm text-sm font-medium rounded-lg text-green-700 bg-green-50 hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Enviar grupo
                  </button>
                  <button
                    onClick={async () => {
                      if (!selectedRoute) return;
                      const toastId = toast.loading('Gerando resumo...');
                      try {
                        const route = selectedRoute as any;
                        const products = assemblyInRoutes.filter(ap => ap.assembly_route_id === route.id);

                        // Get Installer Name
                        let installerName = '';
                        if (route.assembler_id) {
                          const m = montadores.find(u => u.id === route.assembler_id);
                          installerName = m ? (m.name || m.email || '') : '';
                        }

                        // Get Vehicle Info
                        let vehicleInfo = '';
                        if (route.vehicle_id) {
                          const v = vehicles.find(veh => veh.id === route.vehicle_id);
                          vehicleInfo = v ? `${v.model} (${v.plate})` : '';
                        }

                        // Use existing products data which already has 'order' details populated from loadData
                        const pdfBytes = await AssemblyReportGenerator.generateAssemblyReport({
                          route: route,
                          products: products,
                          installerName,
                          supervisorName: '', // Conferente left blank for signature or could be logged in user
                          vehicleInfo,
                          generatedAt: new Date().toISOString()
                        });

                        const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
                        const url = URL.createObjectURL(blob);
                        window.open(url, '_blank');
                        toast.success('Resumo gerado!', { id: toastId });
                      } catch (error) {
                        console.error('Error generating assembly report:', error);
                        toast.error('Erro ao gerar resumo da montagem', { id: toastId });
                      }
                    }}
                    disabled={(selectedRoute as any).status !== 'completed' && (selectedRoute as any).status !== 'in_progress' && (selectedRoute as any).status !== 'pending'}
                    className="inline-flex items-center px-3 py-2 border border-purple-200 shadow-sm text-sm font-medium rounded-lg text-purple-700 bg-purple-50 hover:bg-purple-100"
                  >
                    <ClipboardCheck className="h-4 w-4 mr-2" /> Resumo
                  </button>
                  <button onClick={() => { try { localStorage.setItem('am_showRouteModal', '0'); } catch { } setShowRouteModal(false); }} className="p-2 hover:bg-gray-200 rounded-full text-gray-500"><X className="h-6 w-6" /></button>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-6 bg-gray-50">
                {/* Orders grouped */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-gray-600">Pedido</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-600">Cliente / Endereço</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                        <th className="px-4 py-3 text-right font-semibold text-gray-600">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {(() => {
                        const byOrder: Record<string, AssemblyProductWithDetails[]> = {};
                        assemblyInRoutes.filter(ap => ap.assembly_route_id === selectedRoute.id).forEach(ap => {
                          const k = String(ap.order_id);
                          if (!byOrder[k]) byOrder[k] = [];
                          byOrder[k].push(ap);
                        });
                        const statusColors = {
                          pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
                          completed: 'bg-green-100 text-green-800 border-green-200',
                          cancelled: 'bg-red-100 text-red-800 border-red-200'
                        } as Record<string, string>;
                        const statusLabel = {
                          pending: 'Pendente',
                          completed: 'Concluído',
                          cancelled: 'Retornado'
                        } as Record<string, string>;
                        return Object.entries(byOrder).map(([orderId, list]) => {
                          const order = list[0]?.order || {} as any;
                          const addr = order.address_json || {};
                          const statuses = list.map(i => i.status);
                          const derived = statuses.every(s => s === 'cancelled') ? 'cancelled' : (statuses.every(s => s === 'completed') ? 'completed' : 'pending');

                          // Get timestamp from first item (assuming batch update essentially gives same time, or we take latest)
                          const firstItem = list[0];
                          const timestamp = firstItem?.completion_date || firstItem?.returned_at;
                          const formattedTime = timestamp ? new Date(timestamp).toLocaleString('pt-BR') : '-';

                          return (
                            <tr key={orderId} className="hover:bg-gray-50">
                              <td className="px-4 py-3 font-medium">{order.order_id_erp || orderId}</td>
                              <td className="px-4 py-3">
                                <div className="text-sm text-gray-900">{order.customer_name}</div>
                                <div className="text-xs text-gray-500 flex items-center gap-1">
                                  <MapPin className="h-3 w-3" />
                                  {addr.street}, {addr.number} - {addr.neighborhood}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-col items-start gap-1">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${statusColors[derived]}`}>{statusLabel[derived]}</span>
                                  {timestamp && (
                                    <span className="text-[10px] text-gray-500 font-medium flex items-center gap-1">
                                      <Clock className="w-3 h-3" /> {new Date(timestamp).toLocaleString('pt-BR')}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => { setOrderProductsModal({ orderId, products: list }); setShowOrderProductsModal(true); }}
                                    className="inline-flex items-center px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100"
                                  >
                                    Ver Produtos
                                  </button>
                                  {(selectedRoute as any)?.status === 'pending' && (
                                    <button
                                      onClick={() => {
                                        if (confirm(`Deseja remover o pedido ${order.order_id_erp || orderId} da rota?`)) {
                                          removeOrderFromRoute(orderId);
                                        }
                                      }}
                                      className="inline-flex items-center px-2 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100"
                                      title="Remover pedido da rota"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>

                {/* Delete Empty Route Button - only shows when route has no orders and is pending */}
                {(() => {
                  const productsInRoute = assemblyInRoutes.filter(ap => ap.assembly_route_id === selectedRoute.id);
                  const isPending = (selectedRoute as any)?.status === 'pending';
                  if (productsInRoute.length === 0 && isPending) {
                    return (
                      <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-red-800">Esta rota está vazia</p>
                            <p className="text-xs text-red-600">Você pode excluir esta rota pois ela não possui nenhum pedido.</p>
                          </div>
                          <button
                            onClick={() => {
                              if (confirm('Tem certeza que deseja excluir esta rota vazia?')) {
                                deleteEmptyRoute();
                              }
                            }}
                            className="inline-flex items-center px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700"
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Excluir Rota
                          </button>
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Order Products Modal */}
      {showOrderProductsModal && orderProductsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[55] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              {(() => { const erp = orderProductsModal.products[0]?.order?.order_id_erp || orderProductsModal.orderId; return (<h3 className="text-lg font-bold text-gray-900">Produtos do Pedido {erp}</h3>); })()}
              <button onClick={() => { setShowOrderProductsModal(false); setOrderProductsModal(null); }} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 overflow-y-auto">
              <ul className="divide-y divide-gray-200">
                {orderProductsModal.products.map((p) => (
                  <li key={p.id} className="py-3">
                    <div className="text-sm font-medium text-gray-900">{p.product_name}</div>
                    <div className="text-xs text-gray-500">SKU: {p.product_sku || '-'}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* --- LAUNCH AVULSO MODAL --- */}
      {showLaunchModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative">
            <button
              onClick={() => setShowLaunchModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="p-8">
              <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center mb-6 mx-auto">
                <FilePlus className="h-8 w-8 text-orange-600" />
              </div>

              <h3 className="text-2xl font-bold text-gray-900 text-center mb-2">Lançamento Avulso</h3>
              <p className="text-center text-gray-500 mb-8">
                Importe uma Troca, Assistência ou Pedido de Venda antigo usando o número do lançamento.
              </p>

              <form onSubmit={handleLaunchSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Número do Lançamento (ERP)</label>
                  <input
                    type="text"
                    value={launchNumber}
                    onChange={(e) => setLaunchNumber(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all text-lg font-mono placeholder:font-sans"
                    placeholder="Ex: 123456"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de Serviço</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setLaunchType('troca')}
                      className={`px-3 py-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all ${launchType === 'troca' ? 'bg-orange-50 border-orange-500 text-orange-700 ring-1 ring-orange-500' : 'bg-white border-gray-200 text-gray-600 hover:border-orange-200 hover:bg-orange-50/50'}`}
                    >
                      <RefreshCw className="h-5 w-5" />
                      <span className="font-semibold text-xs">Troca</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setLaunchType('assistencia')}
                      className={`px-3 py-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all ${launchType === 'assistencia' ? 'bg-blue-50 border-blue-500 text-blue-700 ring-1 ring-blue-500' : 'bg-white border-gray-200 text-gray-600 hover:border-blue-200 hover:bg-blue-50/50'}`}
                    >
                      <Wrench className="h-5 w-5" />
                      <span className="font-semibold text-xs">Assistência</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setLaunchType('venda')}
                      className={`px-3 py-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all ${launchType === 'venda' ? 'bg-emerald-50 border-emerald-500 text-emerald-700 ring-1 ring-emerald-500' : 'bg-white border-gray-200 text-gray-600 hover:border-emerald-200 hover:bg-emerald-50/50'}`}
                    >
                      <Package className="h-5 w-5" />
                      <span className="font-semibold text-xs">Pedido Venda</span>
                    </button>
                  </div>
                  {launchType === 'venda' && (
                    <p className="mt-2 text-xs text-emerald-600 bg-emerald-50 p-2 rounded-lg border border-emerald-100">
                      💡 Use para pedidos antigos aguardando liberação do cliente (reformas, etc.)
                    </p>
                  )}
                </div>

                <div className="pt-4">
                  <button
                    type="submit"
                    disabled={launchLoading || !launchNumber}
                    className="w-full px-6 py-4 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-all flex items-center justify-center shadow-lg disabled:opacity-70 disabled:cursor-not-allowed group"
                  >
                    {launchLoading ? (
                      <>
                        <RefreshCw className="animate-spin h-5 w-5 mr-2" />
                        Buscando...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-5 w-5 mr-2 group-hover:rotate-180 transition-transform duration-500" />
                        Buscar e Importar
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default function AssemblyManagement() {
  return (
    <AssemblyManagementErrorBoundary>
      <AssemblyManagementContent />
    </AssemblyManagementErrorBoundary>
  );
}
