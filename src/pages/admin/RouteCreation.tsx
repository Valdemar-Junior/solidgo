import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import type { Order, DriverWithUser, Vehicle, RouteWithDetails } from '../../types/database';
import {
  Truck,
  Package,
  Trash2,
  Eye,
  FileText,
  FileSpreadsheet,
  MessageSquare,
  Settings,
  Info,
  Search,
  Filter,
  X,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Plus,
  ChevronDown,
  ChevronUp,
  MapPin,
  Calendar,
  User,
  RefreshCcw,
  ArrowLeft,
  Hammer,
  Zap,
  MessageCircle,
  ClipboardList,
  ClipboardCheck,
  FilePlus,
  RefreshCw,
  Wrench,
  Store,
  Ban,
  PackageX,
  Loader2,
  Edit2,
  Users,
  UserPlus,
  Check,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Replace
} from 'lucide-react';
import { toast } from 'sonner';
import { DeliverySheetGenerator } from '../../utils/pdf/deliverySheetGenerator';
import { RouteReportGenerator } from '../../utils/pdf/routeReportGenerator';
import { SeparationSheetGenerator } from '../../utils/pdf/separationSheetGenerator';
import { PDFDocument } from 'pdf-lib';
import { useAuthStore } from '../../stores/authStore';
import { useRouteDataStore } from '../../stores/routeDataStore';
import { saveUserPreference, loadUserPreference, mergeColumnsConfig, type ColumnConfig } from '../../utils/userPreferences';
import DatePicker, { registerLocale } from 'react-datepicker';
import { ptBR } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';

registerLocale('pt-BR', ptBR);
// --- ERROR BOUNDARY ---
class RouteCreationErrorBoundary extends React.Component<
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
    console.error('RouteCreation Error:', error, errorInfo);
  }

  handleReset = () => {
    try {
      localStorage.removeItem('rc_columns_conf');
      localStorage.removeItem('rc_showCreateModal');
      localStorage.removeItem('rc_showRouteModal');
      localStorage.removeItem('rc_selectedRouteId');
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
              Ocorreu um erro ao carregar a tela de rotas. Isso geralmente acontece devido a uma configuração antiga salva no navegador.
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

function RouteCreationContent() {
  const navigate = useNavigate();
  const { user: authUser } = useAuthStore();

  // --- LOCAL STATE ---
  const [orders, setOrders] = useState<Order[]>([]);
  const [drivers, setDrivers] = useState<DriverWithUser[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [conferentes, setConferentes] = useState<{ id: string, name: string }[]>([]);

  // Selection
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());

  // New Route Form
  const [selectedDriver, setSelectedDriver] = useState<string>('');
  const [selectedVehicle, setSelectedVehicle] = useState<string>('');
  const [routeName, setRouteName] = useState<string>('');
  const [conferente, setConferente] = useState<string>('');
  const [observations, setObservations] = useState<string>('');
  const [teams, setTeams] = useState<any[]>([]);
  const [helpers, setHelpers] = useState<any[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [selectedHelper, setSelectedHelper] = useState<string>(''); // helper_id
  const [pickupTeam, setPickupTeam] = useState<string>(''); // Novo estado para seleção de equipe na coleta

  // UI States
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [routesList, setRoutesList] = useState<RouteWithDetails[]>([]);

  // Modals
  // Edit Mode State
  const [isEditingRoute, setIsEditingRoute] = useState(false);
  const [editRouteName, setEditRouteName] = useState('');
  const [editRouteTeam, setEditRouteTeam] = useState('');
  const [editRouteDriver, setEditRouteDriver] = useState('');
  const [editRouteHelper, setEditRouteHelper] = useState('');
  const [editRouteVehicle, setEditRouteVehicle] = useState('');
  const [editRouteConferente, setEditRouteConferente] = useState('');

  const [showRouteModal, setShowRouteModal] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<RouteWithDetails | null>(null);
  const [showConferenceModal, setShowConferenceModal] = useState(false);
  const [conferenceRoute, setConferenceRoute] = useState<RouteWithDetails | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showColumnsModal, setShowColumnsModal] = useState(false);
  const [mixedConfirmOpen, setMixedConfirmOpen] = useState(false);
  const [requireConference, setRequireConference] = useState<boolean>(true);

  // Loading states for specific actions
  const [nfLoading, setNfLoading] = useState(false);
  const [waSending, setWaSending] = useState(false);
  const [groupSending, setGroupSending] = useState(false);
  const isLoadingRef = useRef(false);
  const isMountedRef = useRef(true);

  // --- PDF SORT OPTIONS MODAL ---
  const [showPdfSortModal, setShowPdfSortModal] = useState(false);
  const [pdfSortOption, setPdfSortOption] = useState<'data_venda' | 'cidade' | 'previsao_entrega' | 'cliente'>('data_venda');

  // Filters
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
  const [filterOperation, setFilterOperation] = useState<string>('');
  const [showFilters, setShowFilters] = useState(true); // Toggle filters visibility
  const [filterHasAssembly, setFilterHasAssembly] = useState<boolean>(false);
  const [filterSaleDateStart, setFilterSaleDateStart] = useState<string>('');
  const [filterSaleDateEnd, setFilterSaleDateEnd] = useState<string>('');
  const [strictLocal, setStrictLocal] = useState<boolean>(false);
  const [filterBrand, setFilterBrand] = useState<string>('');
  const [filterDeadline, setFilterDeadline] = useState<'all' | 'within' | 'out'>('all');
  const [filterReturnedOnly, setFilterReturnedOnly] = useState<boolean>(false);
  const [filterRetirada, setFilterRetirada] = useState<boolean>(false);
  const [filterServiceType, setFilterServiceType] = useState<string>(''); // 'troca', 'assistencia', 'normal'

  // Logic specific
  const [selectedExistingRouteId, setSelectedExistingRouteId] = useState<string>('');

  // ROUTE PAGINATION & FILTERS STATE (Moved here)
  const [dateFilter, setDateFilter] = useState<'today' | 'yesterday' | 'last7' | 'all'>('today');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [routeSearchQuery, setRouteSearchQuery] = useState<string>('');
  const [page, setPage] = useState(0);
  const [hasMoreRoutes, setHasMoreRoutes] = useState(true);
  const LIMIT = 50;
  const selectedRouteIdRef = useRef<string | null>(null);
  const showRouteModalRef = useRef<boolean>(false);
  const showCreateModalRef = useRef<boolean>(false);
  const [mixedConfirmOrders, setMixedConfirmOrders] = useState<Array<{ id: string, pedido: string, otherLocs: string[] }>>([]);
  const [mixedConfirmAction, setMixedConfirmAction] = useState<'create' | 'add' | 'none'>('none');

  // Realtime Refs (to access latest function version inside effect)
  const fetchRoutesRef = useRef<any>(null);
  const loadDataRef = useRef<any>(null);

  // Tabs State - expandido para incluir bloqueados e coletas
  const [activeRoutesTab, setActiveRoutesTab] = useState<'deliveries' | 'pickups' | 'blocked' | 'pickupOrders' | 'pickupRoutes'>('deliveries');

  // Sorting State
  const [sortColumn, setSortColumn] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // --- DERIVED STATE (DATA PROCESSING) ---

  const filteredRows = useMemo(() => {
    const isTrue = (v: any) => {
      if (typeof v === 'boolean') return v;
      const s = String(v || '').trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'sim' || s === 's' || s === 'y' || s === 'yes' || s === 't';
    };

    const hasFreteFull = (o: any) => {
      const raw = o.raw_json || {};
      // Verifica se existe tag "FULL" ou similar nas observações ou campo específico
      // Adapte conforme sua lógica original se "hasFreteFull" existir fora
      const obs = String(o.observacoes_internas || raw.observacoes_internas || '').toUpperCase();
      const obsPub = String(o.observacoes || raw.observacoes || '').toUpperCase();
      return (o.tem_frete_full === 'SIM') || obs.includes('FULL') || obsPub.includes('FULL');
    };

    const getPrazoStatusForOrder = (o: any): 'within' | 'out' | 'none' => {
      // Corrected logic to prioritize previsao_entrega
      const prev = o.previsao_entrega || o.raw_json?.previsao_entrega || o.raw_json?.data_prevista_entrega;
      if (!prev) return 'none';
      // ... existing date logic check ...
      // Need to replicate the check since I am replacing the variable assignment and the check follows
      const today = new Date().toISOString().slice(0, 10);
      try {
        const pDate = new Date(prev).toISOString().slice(0, 10);
        return pDate < today ? 'out' : 'within';
      } catch { return 'none'; }
    };

    const rows: Array<{ order: any; item: any; values?: any; idx?: number }> = [];

    // 1. Filter Orders
    const filteredOrders = orders.filter((o: any) => {
      const addr: any = o.address_json || {};
      const raw: any = o.raw_json || {};
      const city = String(addr.city || raw.destinatario_cidade || '').toLowerCase();
      const nb = String(addr.neighborhood || raw.destinatario_bairro || '').toLowerCase();
      const client = String(o.customer_name || '').toLowerCase();
      const filial = String(o.filial_venda || raw.filial_venda || '').toLowerCase();
      const seller = String(o.vendedor_nome || raw.vendedor || '').toLowerCase();

      // Data Venda parsing
      let saleDateStr = '';
      const saleDateRaw = o.data_venda || raw.data_venda;
      if (saleDateRaw) {
        try {
          saleDateStr = new Date(saleDateRaw).toISOString().slice(0, 10);
        } catch { }
      }

      const isReturnedFlag = Boolean(o.return_flag) || String(o.status) === 'returned';

      if (filterCity && !city.includes(filterCity.toLowerCase())) return false;
      if (filterNeighborhood && !nb.includes(filterNeighborhood.toLowerCase())) return false;

      // Busca rápida
      if (clientQuery) {
        const q = clientQuery.toLowerCase().trim();
        const orderIdErp = String(o.order_id_erp || raw.lancamento_venda || '').toLowerCase();
        const cpf = String(o.customer_cpf || raw.cpf_cnpj || '').replace(/\D/g, '');
        const queryDigits = q.replace(/\D/g, '');
        const matchClient = client.includes(q);
        const matchOrder = orderIdErp.includes(q);
        const matchCpf = queryDigits && cpf.includes(queryDigits);
        if (!matchClient && !matchOrder && !matchCpf) return false;
      }

      if (filterFreightFull && !hasFreteFull(o)) return false;
      if (filterOperation && !String(raw.operacoes || '').toLowerCase().includes(filterOperation.toLowerCase())) return false;
      if (filterFilialVenda && filial !== filterFilialVenda.toLowerCase()) return false;
      if (filterSeller && !seller.includes(filterSeller.toLowerCase())) return false;
      if (filterSaleDateStart && saleDateStr < filterSaleDateStart) return false;
      if (filterSaleDateEnd && saleDateStr > filterSaleDateEnd) return false;
      if (filterSaleDateEnd && saleDateStr > filterSaleDateEnd) return false;
      if (filterReturnedOnly && !isReturnedFlag) return false;

      const obsIntLower = String(o.observacoes_internas || raw.observacoes_internas || '').toLowerCase();
      if (filterRetirada && !obsIntLower.includes('*retirada*')) return false;

      if (filterDeadline !== 'all') {
        const st = getPrazoStatusForOrder(o);
        if (filterDeadline === 'within' && st !== 'within') return false;
        if (filterDeadline === 'out' && st !== 'out') return false;
      }

      if (filterServiceType) {
        const st = (o.service_type || 'normal').toLowerCase();
        if (filterServiceType === 'normal' && o.service_type) return false;
        if (filterServiceType !== 'normal' && st !== filterServiceType) return false;
      }


      return true;
    });

    // 2. Expand to Rows (Order + Item)
    for (const o of filteredOrders) {
      const items = Array.isArray(o.items_json) ? o.items_json : [];
      let itemsFiltered = items;

      if (strictLocal && filterLocalEstocagem) {
        const allInLocal = items.length > 0 && items.every((it: any) => String(it?.location || '').toLowerCase() === filterLocalEstocagem.toLowerCase());
        if (!allInLocal) continue;
      }

      // Strict Dept
      if (strictDepartment && filterDepartment) {
        const allInDept = items.length > 0 && items.every((it: any) => String(it?.department || '').toLowerCase() === filterDepartment.toLowerCase());
        if (!allInDept) continue;
      }

      // Item Level Filters
      if (filterLocalEstocagem) {
        itemsFiltered = itemsFiltered.filter((it: any) => String(it?.location || '').toLowerCase() === filterLocalEstocagem.toLowerCase());
      }
      if (filterDepartment) {
        itemsFiltered = itemsFiltered.filter((it: any) => String(it?.department || '').toLowerCase() === filterDepartment.toLowerCase());
      }
      if (filterBrand) {
        itemsFiltered = itemsFiltered.filter((it: any) => String(it?.brand || '').toLowerCase() === filterBrand.toLowerCase());
      }
      if (filterHasAssembly) {
        itemsFiltered = itemsFiltered.filter((it: any) => isTrue(it?.has_assembly));
      }

      // Skip order if all items filtered out BUT we are filtering by item properties
      // Note: Logic copied from original: if itemsFiltered.length === 0 && (filterLocal or HasAssembly or Brand or Department) continue
      if (itemsFiltered.length === 0 && (filterLocalEstocagem || filterHasAssembly || filterBrand || filterDepartment)) {
        continue;
      }

      // If no items but order passed main filters (and no item filters active), we might want to show it? 
      // Original logic loops over itemsFiltered. If empty, no rows added.
      // So if order has no items, it won't show up. This mimics original behavior.

      // Pre-calculate values for sorting
      const raw = o.raw_json || {};
      const addr = o.address_json || {};

      const parseDateSafe = (d: any) => {
        // Helper to standardize date parsing for sort values
        if (d instanceof Date) return d;
        if (!d) return null;
        try { return new Date(d); } catch { return null; }
      };

      const formatDate = (d: any) => {
        if (!d) return '-';
        try {
          const date = new Date(d);
          if (isNaN(date.getTime())) return '-';
          return date.toLocaleDateString('pt-BR');
        } catch { return '-'; }
      };

      const getPrevisaoEntrega = (order: any) => {
        const r = order?.raw_json || {};
        const prev = order?.previsao_entrega || r?.previsao_entrega || r?.data_prevista_entrega || '';
        return parseDateSafe(prev);
      };

      for (const it of itemsFiltered) {
        const v: any = {};
        // Populate values map for easy sorting access
        v['pedido'] = o.order_id_erp || raw?.lancamento_venda || o.id.slice(0, 8);
        v['data'] = formatDate(o.data_venda || raw?.data_venda);
        v['cliente'] = o.customer_name || raw?.destinatario_nome || '-';
        v['cpf'] = o.customer_cpf || raw?.cpf_cnpj || '-';
        v['telefone'] = o.phone || raw?.destinatario_telefone || '-';
        v['cidade'] = (addr as any)?.city || raw?.destinatario_cidade || '-';
        v['bairro'] = (addr as any)?.neighborhood || raw?.destinatario_bairro || '-';
        v['sku'] = (it as any)?.sku || '-';
        v['produto'] = (it as any)?.name || (it as any)?.descricao || '-';
        v['quantidade'] = (it as any)?.quantity || 1;
        v['department'] = (it as any)?.department || '-';
        v['brand'] = (it as any)?.brand || '-';
        v['localEstocagem'] = (it as any)?.location || '-';
        v['filialVenda'] = o.filial_venda || raw?.filial_venda || '-';
        v['operacao'] = raw?.operacoes || '-';
        v['vendedor'] = (o as any).vendedor_nome || raw?.vendedor || '-';
        v['situacao'] = o.status || '-';
        v['obsPublicas'] = (o as any).observacoes || raw?.observacoes || '-';
        v['obsInternas'] = o.observacoes_internas || raw?.observacoes_internas || '-';

        // --- NEW COLUMN: Prev. Entrega ---
        v['previsaoEntrega'] = formatDate(getPrevisaoEntrega(o));

        // Address
        const str = (addr as any)?.street || raw?.destinatario_endereco || '';
        const num = (addr as any)?.number || raw?.destinatario_numero || '';
        v['endereco'] = `${str}, ${num}`;

        // Other locations
        // Logic for otherLocs 
        // (Assuming simple logic or empty if not easily replicated here without more context)
        // Original logic was doing a complex mapping. 
        // For sorting purposes, we might just store a string representation if needed.
        // For rendering, we will access 'items' again.

        rows.push({ order: o, item: it, values: v });
      }
    }
    return rows;
  }, [
    orders, filterCity, filterNeighborhood, clientQuery, filterFreightFull, filterOperation,
    filterFilialVenda, filterSeller, filterSaleDateStart, filterSaleDateEnd, filterReturnedOnly,
    filterDeadline, filterServiceType, strictLocal, filterLocalEstocagem, strictDepartment,
    filterDepartment, filterBrand, filterHasAssembly, filterRetirada
  ]);

  const sortedRows = useMemo(() => {
    if (!sortColumn) return filteredRows;

    const parseDateStr = (str: string) => {
      if (!str || str === '-') return 0;
      try {
        const [d, m, y] = str.split('/').map(Number);
        return new Date(y, m - 1, d).getTime();
      } catch { return 0; }
    };

    return [...filteredRows].sort((a, b) => {
      let valA = a.values?.[sortColumn];
      let valB = b.values?.[sortColumn];

      if (valA === '-') valA = '';
      if (valB === '-') valB = '';

      const isDate = ['data', 'previsaoEntrega'].includes(sortColumn);

      if (isDate) {
        valA = parseDateStr(valA);
        valB = parseDateStr(valB);
      } else {
        valA = String(valA || '').toLowerCase();
        valB = String(valB || '').toLowerCase();
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredRows, sortColumn, sortDirection]);


  // Pickup Modal State
  const [showPickupModal, setShowPickupModal] = useState(false);
  const [pickupConferente, setPickupConferente] = useState(''); // Conferente ID for pickup
  const [pickupObservations, setPickupObservations] = useState('');
  const [pickupSaving, setPickupSaving] = useState(false);

  // Estados para pedidos bloqueados e coletas pendentes
  const [blockedOrders, setBlockedOrders] = useState<Order[]>([]);
  const [pickupPendingOrders, setPickupPendingOrders] = useState<Order[]>([]);

  // Estados para modal de coleta individual
  const [showPickupOrderModal, setShowPickupOrderModal] = useState(false);
  const [selectedPickupOrder, setSelectedPickupOrder] = useState<Order | null>(null);
  const [pickupOrderLoading, setPickupOrderLoading] = useState(false);
  const [pickupOrderConferente, setPickupOrderConferente] = useState('');

  const [pickupOrderObservations, setPickupOrderObservations] = useState('');

  // --- EDIT ROUTE LOGIC ---
  useEffect(() => {
    if (showRouteModal && selectedRoute && !isEditingRoute) {
      setEditRouteName(selectedRoute.name || '');
      setEditRouteTeam(selectedRoute.team_id || '');
      setEditRouteDriver(selectedRoute.driver_id || '');
      setEditRouteHelper(selectedRoute.helper_id || '');
      setEditRouteVehicle(selectedRoute.vehicle_id || '');
      setEditRouteConferente(selectedRoute.conferente_id || '');
    }
  }, [showRouteModal, selectedRoute, isEditingRoute]);

  const handleEditTeamChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const tid = e.target.value;
    setEditRouteTeam(tid);
    if (tid) {
      const t = teams.find(x => x.id === tid);
      if (t) {
        console.log('[EditTeamChange] Selected team:', t);
        // DEBUG: Debug driver finding logic
        console.log('[EditTeamChange] Team Data:', t);
        console.log('[EditTeamChange] Looking for driver w/ user_id:', t.driver_user_id, 'Type:', typeof t.driver_user_id);
        console.log('[EditTeamChange] Available Drivers (first 5):', drivers.slice(0, 5).map(d => ({ id: d.id, user_id: d.user_id, name: d.user?.name || d.name })));

        // Try to find driver by user_id matches
        let driver = drivers.find(d => String(d.user_id) === String(t.driver_user_id));

        if (!driver) {
          // Fallback check: maybe the team.driver_user_id IS the driver.id? (unlikely but checking)
          const fallback = drivers.find(d => String(d.id) === String(t.driver_user_id));
          if (fallback) {
            console.log('[EditTeamChange] Found driver by ID fallback!', fallback);
            driver = fallback;
          }
        }

        console.log('[EditTeamChange] Found Driver Result:', driver);

        if (driver) {
          setEditRouteDriver(String(driver.id));
        } else {
          console.warn('[EditTeamChange] Driver record NOT found for user_id:', t.driver_user_id);
          console.log('[EditTeamChange] All Driver User IDs:', drivers.map(d => d.user_id));
          // Don't clear driver immediately if not found, to preserve manual entry if needed, or clear?
          // User wants strict sync. So if team has driver, we should try to set it.
          // If not found, better to clear or keep previous? Clearing signals "not found".
          setEditRouteDriver('');
        }

        if (t.helper_user_id) setEditRouteHelper(t.helper_user_id);
        else setEditRouteHelper('');
      }
    } else {
      setEditRouteHelper('');
      // setEditRouteDriver(''); // Optional: clear driver when team is cleared
    }
  };

  const handleUpdateRoute = async () => {
    if (!selectedRoute) return;
    if (!editRouteName.trim()) { toast.error('Nome da rota é obrigatório'); return; }

    const updatePromise = (async () => {
      const { error } = await supabase
        .from('routes')
        .update({
          name: editRouteName,
          team_id: editRouteTeam || null,
          driver_id: editRouteDriver || null,
          helper_id: editRouteHelper || null,
          vehicle_id: editRouteVehicle || null,
          conferente_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(editRouteConferente) ? editRouteConferente : null,
          conferente: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(editRouteConferente)
            ? (conferentes.find(c => c.id === editRouteConferente)?.name || null)
            : (editRouteConferente || null)
        })
        .eq('id', selectedRoute.id);
      if (error) throw error;
      await loadData(false);

      const { data: refreshed } = await supabase.from('routes')
        .select(`*, driver:drivers!driver_id(*, user:users!user_id(*)), vehicle:vehicles!vehicle_id(*), route_orders(*, order:orders!order_id(*))`)
        .eq('id', selectedRoute.id)
        .single();
      if (refreshed) setSelectedRoute(refreshed as any);

      setIsEditingRoute(false);
    })();

    toast.promise(updatePromise, {
      pending: 'Salvando alterações...',
      success: 'Rota atualizada com sucesso!',
      error: 'Erro ao atualizar rota'
    } as any);
  };

  // Motorista placeholder para retiradas - não será mostrado na UI
  const PICKUP_PLACEHOLDER_DRIVER_ID = '6bb1d41b-0a88-4468-8902-c42402fc0aeb';

  const filteredRoutesList = useMemo(() => {
    return routesList.filter(r => {
      // Logic for tab filtering
      const name = String(r.name || '');
      const isRetirada = name.startsWith('RETIRADA');
      const isColeta = name.startsWith('COLETA-'); // Rotas de coleta iniciam com COLETA-

      if (activeRoutesTab === 'pickups') return isRetirada;
      if (activeRoutesTab === 'pickupRoutes') return isColeta;
      // Deliveries = Not Retirada AND Not Coleta
      if (activeRoutesTab === 'deliveries') return !isRetirada && !isColeta;

      return false;
    }).filter(r => {
      const isPkp = String(r.name || '').startsWith('RETIRADA');
      const tabMatch = activeRoutesTab === 'pickups' ? isPkp : !isPkp;
      if (!tabMatch) return false;

      // Busca rápida por nome, motorista ou código
      if (routeSearchQuery) {
        const q = routeSearchQuery.toLowerCase().trim();
        const routeName = String(r.name || '').toLowerCase();
        const driverName = String((r as any).driver_name || (r as any).driver?.user?.name || (r as any).driver?.name || '').toLowerCase();
        const routeCode = String((r as any).route_code || '').toLowerCase();
        if (!routeName.includes(q) && !driverName.includes(q) && !routeCode.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [routesList, activeRoutesTab, routeSearchQuery]);

  // --- SINGLE LAUNCH IMPORT (TROCAS/ASSISTENCIAS/VENDAS) ---
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [launchNumber, setLaunchNumber] = useState('');
  const [launchType, setLaunchType] = useState<'troca' | 'assistencia' | 'venda'>('troca');
  const [launchLoading, setLaunchLoading] = useState(false);

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
      // Sending basic payload as requested
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

      // Map to DB structure
      const toDb = items.map((o: any) => {
        const produtos = Array.isArray(o.produtos) ? o.produtos : (Array.isArray(o.produtos_locais) ? o.produtos_locais : []);
        const getVal = (v: any) => String(v ?? '').trim();

        const pickZip = (raw: any) => {
          const candidates = [raw?.destinatario_cep, raw?.cep, raw?.endereco_cep, raw?.codigo_postal, raw?.zip];
          for (const c of candidates) { const s = String(c || '').trim(); if (s) return s; }
          return '';
        };

        const obsVal = getVal(o.observacoes_internas).toLowerCase();
        const hasKeywordMontagem = obsVal.includes('*montagem*');
        console.log(`[Manual Import Debug] Lancamento ${o.numero_lancamento}: Obs="${obsVal}", Montagem=${hasKeywordMontagem}`);

        const itemsJson = produtos.length > 0 ? produtos.map((p: any) => {
          const explicitFlag = getVal(p.tem_montagem);
          // Restore checking for keywords or explicit flag

          // LOGIC: If explicit says yes OR keyword says yes -> Sim.
          // We can also use p.produto_e_montavel to HELP, but we must NOT filter the item out.
          // Let's keep it simple and safe: Revert to mixed logic.

          // Old logic + New Field Persistence
          const finalHasAssembly = (explicitFlag === 'Sim' || hasKeywordMontagem) ? 'Sim' : explicitFlag;

          return {
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
            has_assembly: finalHasAssembly,
            produto_e_montavel: getVal(p.produto_e_montavel), // Mantendo o mapeamento
            labels: Array.isArray(p.etiquetas) ? p.etiquetas : [],
            department: getVal(p.departamento),
            brand: getVal(p.marca),
          };
        }) : [];

        const xmlDanfe = o.xml_danfe_remessa || {};

        // Append type suffix to ensure uniqueness and identification
        // Para vendas, NÃO adiciona sufixo (é o pedido original)
        let erpId = String(o.numero_lancamento ?? o.lancamento_venda ?? o.codigo_cliente ?? launchNumber);
        if (launchType !== 'venda') {
          const suffix = launchType === 'troca' ? '-T' : '-A';
          if (!erpId.endsWith(suffix) && !erpId.endsWith('-T') && !erpId.endsWith('-A')) {
            erpId = `${erpId}${suffix}`;
          }
        }

        return {
          order_id_erp: erpId,
          customer_name: getVal(o.nome_cliente),
          phone: getVal(o.cliente_celular),
          customer_cpf: getVal(o.cpf_cliente),
          filial_venda: getVal(o.filial_venda),
          vendedor_nome: getVal(o.nome_vendedor ?? o.vendedor ?? o.vendedor_nome),
          data_venda: o.data_venda ? new Date(o.data_venda).toISOString() : new Date().toISOString(),
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
          status: 'pending',
          raw_json: o,
          service_type: launchType === 'venda' ? undefined : launchType,
          department: String(itemsJson[0]?.department || ''),
          brand: String(itemsJson[0]?.brand || ''),
          import_source: 'avulsa',
          xml_documento: xmlDanfe.conteudo_xml || null,
        };
      });

      // Para vendas, verificar se o pedido já existe ANTES de importar
      if (launchType === 'venda') {
        const erpIds = toDb.map((o: any) => o.order_id_erp);
        const { data: existingOrders } = await supabase
          .from('orders')
          .select('order_id_erp')
          .in('order_id_erp', erpIds);

        if (existingOrders && existingOrders.length > 0) {
          const existingIds = existingOrders.map((o: any) => o.order_id_erp).join(', ');
          toast.error(`Pedido(s) já existe(m) no sistema: ${existingIds}`);
          setLaunchLoading(false);
          return;
        }
      }

      let insertedCount = 0;
      let errors = 0;
      const importedOrderIds: string[] = []; // Rastrear IDs dos pedidos importados para seleção automática

      for (const order of toDb) {
        // Para vendas, usar insert ao invés de upsert para garantir que não sobrescreve
        if (launchType === 'venda') {
          const { data: insertedOrder, error } = await supabase.from('orders').insert(order).select('id').single();
          if (error) {
            console.error('Erro ao inserir', error);
            errors++;
          } else {
            insertedCount++;
            if (insertedOrder?.id) importedOrderIds.push(insertedOrder.id);
          }
        } else {
          const { data: upsertedOrder, error } = await supabase.from('orders').upsert(order, { onConflict: 'order_id_erp' }).select('id').single();
          if (error) {
            console.error('Erro ao inserir', error);
            errors++;
          } else {
            insertedCount++;
            if (upsertedOrder?.id) importedOrderIds.push(upsertedOrder.id);
          }
        }
      }

      if (errors > 0) {
        toast.warning(`${insertedCount} importado(s), ${errors} erro(s). Verifique duplicidades.`);
        // Mesmo com erros, selecionar os que foram importados com sucesso
        if (importedOrderIds.length > 0) {
          await loadData(false);
          setSelectedOrders(prev => {
            const newSet = new Set(prev);
            importedOrderIds.forEach(id => newSet.add(id));
            return newSet;
          });
        }
      } else if (insertedCount > 0) {
        const tipoLabel = launchType === 'venda' ? 'pedido(s) de venda' : `lançamento(s) avulso(s) de ${launchType}`;
        toast.success(`${insertedCount} ${tipoLabel} importado(s)!`);
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
        toast.info('Nenhum dado importado.');
      }

    } catch (e: any) {
      console.error(e);
      toast.error(`Erro: ${e.message}`);
    } finally {
      setLaunchLoading(false);
    }
  };

  // Table Config
  const [columnsConf, setColumnsConf] = useState<Array<{ id: string, label: string, visible: boolean }>>([
    { id: 'data', label: 'Data', visible: true },
    { id: 'pedido', label: 'Pedido', visible: true },
    { id: 'previsaoEntrega', label: 'Prev. Entrega', visible: true },
    { id: 'cliente', label: 'Cliente', visible: true },
    { id: 'cpf', label: 'CPF', visible: false },
    { id: 'telefone', label: 'Telefone', visible: true },
    { id: 'sku', label: 'SKU', visible: true },
    { id: 'flags', label: 'Sinais', visible: true },
    { id: 'produto', label: 'Produto', visible: true },
    { id: 'quantidade', label: 'Qtd.', visible: true },
    { id: 'department', label: 'Depto.', visible: true },
    { id: 'brand', label: 'Marca', visible: true },
    { id: 'localEstocagem', label: 'Local Saída', visible: true },
    { id: 'cidade', label: 'Cidade', visible: true },
    { id: 'bairro', label: 'Bairro', visible: true },
    { id: 'filialVenda', label: 'Filial', visible: true },
    { id: 'operacao', label: 'Operação', visible: true },
    { id: 'vendedor', label: 'Vendedor', visible: true },
    { id: 'situacao', label: 'Situação', visible: true },
    { id: 'obsPublicas', label: 'Obs.', visible: true },
    { id: 'obsInternas', label: 'Obs. Int.', visible: true },
    { id: 'endereco', label: 'Endereço', visible: true },
    { id: 'outrosLocs', label: 'Outros Locais', visible: true },
  ]);

  const [viewMode, setViewMode] = useState<'products' | 'orders'>('products');
  const ordersSectionRef = useRef<HTMLDivElement>(null);
  const routesSectionRef = useRef<HTMLDivElement>(null);

  const WhatsAppIcon = ({ className }: { className?: string }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="currentColor"
      className={className}
    >
      <path d="M16.01 2C8.83 2 2.99 7.75 2.99 14.92c0 2.51.76 4.84 2.08 6.79L3 29.03l7.54-1.97c1.84 1 3.95 1.55 6.16 1.55 7.18 0 13.01-5.75 13.01-12.92C29.71 7.75 23.19 2 16.01 2Zm0 22.57c-1.96 0-3.83-.53-5.45-1.54l-.39-.23-4.48 1.17 1.2-4.35-.26-.41a10.76 10.76 0 0 1-1.66-5.74c0-5.93 4.9-10.76 10.93-10.76 5.95 0 10.79 4.83 10.79 10.76 0 5.93-4.84 10.77-10.79 10.77Zm6.02-8.1c-.33-.16-1.94-.96-2.24-1.07-.3-.11-.52-.16-.74.16-.22.33-.85 1.07-1.05 1.29-.19.22-.39.25-.72.09-.33-.16-1.39-.54-2.65-1.73-.98-.91-1.64-2.04-1.83-2.38-.19-.33-.02-.5.14-.66.14-.14.33-.38.5-.57.17-.2.22-.33.33-.55.11-.22.05-.41-.03-.57-.09-.16-.72-1.73-.99-2.37-.26-.63-.52-.54-.72-.55l-.61-.01c-.2 0-.52.08-.8.37-.27.3-1.04 1.02-1.04 2.5s1.07 2.9 1.22 3.1c.16.21 2.11 3.22 5.1 4.51.71.31 1.26.49 1.69.63.71.23 1.35.2 1.86.12.57-.08 1.75-.72 2-1.41.25-.69.25-1.27.18-1.4-.07-.14-.29-.23-.62-.39Z" />
    </svg>
  );

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

  // --- EFFECTS ---

  // Load initial data and set up visibility change listener
  useEffect(() => {
    // Load data on mount
    loadData(true);

    // AUTO-OPEN LOGIC: Check for route details request from other screens
    const autoOpenId = localStorage.getItem('rc_selectedRouteId');
    const shouldOpen = localStorage.getItem('rc_showRouteModal');

    if (autoOpenId && shouldOpen === '1') {
      // Clear flags immediately
      localStorage.removeItem('rc_selectedRouteId');
      localStorage.removeItem('rc_showRouteModal');

      // Fetch route details to populate modal
      supabase
        .from('routes')
        .select(`*, driver:drivers!driver_id(*, user:users!user_id(*)), vehicle:vehicles!vehicle_id(*), route_orders(*, order:orders!order_id(*))`)
        .eq('id', autoOpenId)
        .single()
        .then(({ data, error }) => {
          if (!error && data) {
            setSelectedRoute(data as any);
            setShowRouteModal(true);
          }
        });
    }

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

  // Restore persisted selections and scroll position
  useEffect(() => {
    try {
      const saved = localStorage.getItem('rc_selectedOrders');
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr)) setSelectedOrders(new Set(arr.map(String)));
      }
      const sLeft = Number(localStorage.getItem('rc_productsScrollLeft') || '0');
      if (productsScrollRef.current && sLeft > 0) productsScrollRef.current.scrollLeft = sLeft;
    } catch { }
  }, []);

  useEffect(() => {
    try { localStorage.setItem('rc_selectedOrders', JSON.stringify(Array.from(selectedOrders))); } catch { }
  }, [selectedOrders]);

  const onProductsScroll = () => {
    try { if (productsScrollRef.current) localStorage.setItem('rc_productsScrollLeft', String(productsScrollRef.current.scrollLeft || 0)); } catch { }
  };

  useEffect(() => {
    const loadColumnsFromSupabase = async () => {
      const defaults: ColumnConfig[] = [
        { id: 'data', label: 'Data', visible: true },
        { id: 'pedido', label: 'Pedido', visible: true },
        { id: 'previsaoEntrega', label: 'Prev. Entrega', visible: true },
        { id: 'cliente', label: 'Cliente', visible: true },
        { id: 'cpf', label: 'CPF', visible: true },
        { id: 'telefone', label: 'Telefone', visible: true },
        { id: 'sku', label: 'SKU', visible: true },
        { id: 'flags', label: 'Sinais', visible: true },
        { id: 'produto', label: 'Produto', visible: true },
        { id: 'quantidade', label: 'Qtd.', visible: true },
        { id: 'department', label: 'Depto.', visible: true },
        { id: 'brand', label: 'Marca', visible: true },
        { id: 'localEstocagem', label: 'Local Saída', visible: true },
        { id: 'cidade', label: 'Cidade', visible: true },
        { id: 'bairro', label: 'Bairro', visible: true },
        { id: 'filialVenda', label: 'Filial', visible: true },
        { id: 'operacao', label: 'Operação', visible: true },
        { id: 'vendedor', label: 'Vendedor', visible: true },
        { id: 'situacao', label: 'Situação', visible: true },
        { id: 'obsPublicas', label: 'Obs.', visible: true },
        { id: 'obsInternas', label: 'Obs. Int.', visible: true },
        { id: 'endereco', label: 'Endereço', visible: true },
        { id: 'outrosLocs', label: 'Outros Locais', visible: true },
      ];

      try {
        // Load modal states
        const rid = localStorage.getItem('rc_selectedRouteId');
        const showRoutePref = localStorage.getItem('rc_showRouteModal');
        const showCreatePref = localStorage.getItem('rc_showCreateModal');
        if (showCreatePref === '1') {
          setShowCreateModal(true);
        }
        if (showRoutePref === '1' && rid) {
          selectedRouteIdRef.current = rid;
          showRouteModalRef.current = true;
          setShowRouteModal(true);
        }

        // Load columns config from Supabase (or localStorage fallback)
        if (authUser?.id) {
          const savedCols = await loadUserPreference<ColumnConfig[]>(authUser.id, 'rc_columns_conf');
          if (savedCols) {
            const merged = mergeColumnsConfig(savedCols, defaults);
            setColumnsConf(merged);
          }
        } else {
          // Fallback to localStorage if not authenticated
          const cols = localStorage.getItem('rc_columns_conf');
          if (cols) {
            const parsed = JSON.parse(cols);
            if (Array.isArray(parsed)) {
              const merged = mergeColumnsConfig(parsed, defaults);
              setColumnsConf(merged);
            }
          }
        }
        setViewMode('products');
      } catch (e) {
        console.warn('[RouteCreation] Error loading columns config:', e);
      }
    };

    loadColumnsFromSupabase();
  }, [authUser?.id]);

  // Persist filters across refresh/tab switch
  useEffect(() => {
    try {
      const data = localStorage.getItem('rc_filters');
      if (data) {
        const f = JSON.parse(data);
        if (f && typeof f === 'object') {
          if ('city' in f) setFilterCity(f.city || '');
          if ('neighborhood' in f) setFilterNeighborhood(f.neighborhood || '');
          if ('filial' in f) setFilterFilialVenda(f.filial || '');
          if ('local' in f) setFilterLocalEstocagem(f.local || '');
          if ('strictLocal' in f) setStrictLocal(!!f.strictLocal);
          if ('seller' in f) setFilterSeller(f.seller || '');
          if ('client' in f) { setFilterClient(f.client || ''); setClientQuery(f.client || ''); }
          if ('department' in f) setFilterDepartment(f.department || '');
          if ('strictDepartment' in f) setStrictDepartment(!!f.strictDepartment);
          if ('freightFull' in f) setFilterFreightFull(f.freightFull ? '1' : '');
          if ('hasAssembly' in f) setFilterHasAssembly(!!f.hasAssembly);
          if ('operation' in f) setFilterOperation(f.operation || '');
          if ('saleDateStart' in f) setFilterSaleDateStart(f.saleDateStart || '');
          if ('saleDateEnd' in f) setFilterSaleDateEnd(f.saleDateEnd || '');
          if ('brand' in f) setFilterBrand(f.brand || '');
          if ('brand' in f) setFilterBrand(f.brand || '');
          if ('serviceType' in f) setFilterServiceType(f.serviceType || '');
          if ('retirada' in f) setFilterRetirada(!!f.retirada);
        }
      }
    } catch { }
  }, []);

  useEffect(() => {
    try {
      const payload = {
        city: filterCity,
        neighborhood: filterNeighborhood,
        filial: filterFilialVenda,
        local: filterLocalEstocagem,
        strictLocal,
        seller: filterSeller,
        client: filterClient,
        department: filterDepartment,
        strictDepartment,
        freightFull: Boolean(filterFreightFull),
        hasAssembly: filterHasAssembly,
        operation: filterOperation,
        saleDateStart: filterSaleDateStart,
        saleDateEnd: filterSaleDateEnd,

        brand: filterBrand,
        serviceType: filterServiceType,
        retirada: filterRetirada
      };
      localStorage.setItem('rc_filters', JSON.stringify(payload));
    } catch { }
  }, [filterCity, filterNeighborhood, filterFilialVenda, filterLocalEstocagem, strictLocal, filterSeller, filterClient, filterDepartment, strictDepartment, filterFreightFull, filterHasAssembly, filterOperation, filterSaleDateStart, filterSaleDateEnd, filterBrand, filterServiceType, filterRetirada]);

  // --- DATE HELPER FUNCTIONS ---
  const stringToDate = (str: string): Date | null => {
    if (!str) return null;
    try {
      const [y, m, d] = str.split('-').map(Number);
      return new Date(y, m - 1, d);
    } catch { return null; }
  };

  const dateToString = (date: Date | null): string => {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // --- MEMOS (Options) ---
  const cityOptions = useMemo(
    () =>
      Array.from(
        new Set(
          (orders || [])
            .map((o: any) => String((o.address_json?.city || o.raw_json?.destinatario_cidade || '')).trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })),
    [orders]
  );

  const neighborhoodOptions = useMemo(() => {
    const selectedCity = String(filterCity || '').trim().toLowerCase();
    const scopedOrders = (orders || []).filter((o: any) => {
      if (!selectedCity) return true;
      const city = String((o.address_json?.city || o.raw_json?.destinatario_cidade || '')).trim().toLowerCase();
      return city === selectedCity;
    });

    return Array.from(
      new Set(
        scopedOrders
          .map((o: any) => String((o.address_json?.neighborhood || o.raw_json?.destinatario_bairro || '')).trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  }, [orders, filterCity]);

  useEffect(() => {
    if (!filterNeighborhood) return;
    const current = String(filterNeighborhood).trim().toLowerCase();
    const stillValid = neighborhoodOptions.some((n) => String(n).trim().toLowerCase() === current);
    if (!stillValid) {
      setFilterNeighborhood('');
    }
  }, [filterNeighborhood, neighborhoodOptions]);
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
    const fromRawLoc = (orders || []).flatMap((o: any) => Array.isArray(o.raw_json?.produtos_locais) ? o.raw_json.produtos_locais.map((p: any) => String(p?.departamento || '').trim()) : []);
    const fromRawProd = (orders || []).flatMap((o: any) => Array.isArray(o.raw_json?.produtos) ? o.raw_json.produtos.map((p: any) => String(p?.departamento || '').trim()) : []);
    return Array.from(new Set([...(fromItems || []), ...(fromRawLoc || []), ...(fromRawProd || [])].filter(Boolean))).sort();
  }, [orders]);
  const brandOptions = useMemo(() => {
    const fromItems = (orders || []).flatMap((o: any) => Array.isArray(o.items_json) ? o.items_json.map((it: any) => String(it?.brand || '').trim()) : []);
    const fromProdLoc = (orders || []).flatMap((o: any) => Array.isArray(o.raw_json?.produtos_locais) ? o.raw_json.produtos_locais.map((p: any) => String(p?.marca || '').trim()) : []);
    const fromProdRaw = (orders || []).flatMap((o: any) => Array.isArray(o.raw_json?.produtos) ? o.raw_json.produtos.map((p: any) => String(p?.marca || '').trim()) : []);
    const fromRawSingle = (orders || []).map((o: any) => String(o.raw_json?.marca || '').trim());
    return Array.from(new Set([...(fromItems || []), ...(fromProdLoc || []), ...(fromProdRaw || []), ...(fromRawSingle || [])].filter(Boolean))).sort();
  }, [orders]);

  const filteredClients = useMemo(() => {
    const q = clientQuery.toLowerCase().trim();
    const src = clientOptions || [];
    if (!q) return src.slice(0, 20);
    return src.filter((c) => c.toLowerCase().includes(q)).slice(0, 20);
  }, [clientOptions, clientQuery]);

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

  const getOrderLocations = (o: any) => {
    const itemsLocs = Array.isArray(o.items_json) ? o.items_json.map((it: any) => String(it?.location || '').trim()).filter(Boolean) : [];
    const rawLocs = Array.isArray(o.raw_json?.produtos_locais) ? o.raw_json.produtos_locais.map((p: any) => String(p?.local_estocagem || '').trim()).filter(Boolean) : [];
    return Array.from(new Set([...(itemsLocs || []), ...(rawLocs || [])].filter(Boolean)));
  };

  const parseDateSafe = (input: any): Date | null => {
    if (!input) return null;
    try {
      const s = String(input);
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    } catch { return null; }
  };

  const getPrevisaoEntrega = (o: any): Date | null => {
    const raw: any = o?.raw_json || {};
    const prev = o?.previsao_entrega || raw?.previsao_entrega || raw?.data_prevista_entrega || '';
    return parseDateSafe(prev);
  };

  const getPrazoStatusForOrder = (o: any): 'within' | 'out' | 'none' => {
    const prev = getPrevisaoEntrega(o);
    if (!prev) return 'none';
    const today = new Date();
    return today.getTime() <= prev.getTime() ? 'within' : 'out';
  };

  const selectedMixedOrders = useMemo(() => {
    if (!filterLocalEstocagem) return [] as Array<{ id: string, pedido: string, otherLocs: string[] }>;
    const cur = Array.from(selectedOrders);
    const result: Array<{ id: string, pedido: string, otherLocs: string[] }> = [];
    for (const oid of cur) {
      const o = (orders || []).find((x: any) => String(x.id) === String(oid));
      if (!o) continue;
      const locs = getOrderLocations(o).map(l => String(l));
      const other = locs.filter(l => l.toLowerCase() !== filterLocalEstocagem.toLowerCase());
      if (other.length > 0) {
        const pedido = String(o.raw_json?.lancamento_venda ?? o.order_id_erp ?? o.id ?? '');
        result.push({ id: String(o.id), pedido, otherLocs: Array.from(new Set(other)) });
      }
    }
    return result;
  }, [selectedOrders, orders, filterLocalEstocagem]);

  const selectedMixedOrdersPlus = useMemo(() => {
    const map = new Map<string, { id: string; pedido: string; otherLocs: string[]; reasons: string[] }>();
    // Base from local storage filter
    for (const m of selectedMixedOrders as any[]) {
      map.set(m.id, { id: m.id, pedido: m.pedido, otherLocs: m.otherLocs || [], reasons: ['outro local de saída'] });
    }
    const isTrue = (v: any) => { const s = String(v || '').toLowerCase(); return s === 'true' || s === '1' || s === 'sim' || s === 's' || s === 'y' || s === 'yes' || s === 't'; };
    // Assembly reason
    for (const oid of Array.from(selectedOrders)) {
      const o: any = (orders || []).find((x: any) => String(x.id) === String(oid));
      if (!o) continue;
      const pedido = String(o.raw_json?.lancamento_venda ?? o.order_id_erp ?? o.id ?? '');
      let items = Array.isArray(o.items_json) ? o.items_json : [];

      if (items.length > 0) {
        const rawProds = Array.isArray(o.raw_json?.produtos_locais) ? o.raw_json.produtos_locais : (Array.isArray(o.raw_json?.produtos) ? o.raw_json.produtos : []);
        if (rawProds.length === items.length) {
          items = items.map((it: any, idx: number) => ({
            ...it,
            department: it.department || rawProds[idx]?.departamento || '',
            brand: it.brand || rawProds[idx]?.marca || ''
          }));
        }
      }
      const byLocal = filterLocalEstocagem ? items.filter((it: any) => String(it?.location || '').toLowerCase() === filterLocalEstocagem.toLowerCase()) : items;
      let visibleItems = byLocal;
      if (filterHasAssembly) visibleItems = visibleItems.filter((it: any) => isTrue(it?.has_assembly));
      if (filterDepartment) visibleItems = visibleItems.filter((it: any) => String(it?.department || '').toLowerCase() === String(filterDepartment || '').toLowerCase());

      const allLocs: string[] = Array.from(new Set<string>(items.map((it: any) => String(it?.location || '').toLowerCase()).filter(Boolean)));
      const visibleLocs: string[] = Array.from(new Set<string>(visibleItems.map((it: any) => String(it?.location || '').toLowerCase()).filter(Boolean)));
      const otherLocs = allLocs.filter(l => !visibleLocs.includes(l));

      const cur = map.get(String(o.id)) || { id: String(o.id), pedido, otherLocs: [], reasons: [] };

      // If some items are filtered out by current combination, add a generic reason
      if (visibleItems.length < items.length) {
        if (!cur.reasons.includes('há itens fora dos filtros')) cur.reasons.push('há itens fora dos filtros');
      }
      // Specific reasons
      if (filterHasAssembly && items.some((it: any) => !isTrue(it?.has_assembly))) {
        if (!cur.reasons.includes('há itens sem montagem')) cur.reasons.push('há itens sem montagem');
      }
      if (filterDepartment && items.some((it: any) => String(it?.department || '').toLowerCase() !== String(filterDepartment || '').toLowerCase())) {
        if (!cur.reasons.includes('há itens de outro departamento')) cur.reasons.push('há itens de outro departamento');
      }
      if (otherLocs.length > 0) {
        const merged = Array.from(new Set<string>([...(cur.otherLocs || [] as string[]), ...otherLocs]));
        cur.otherLocs = merged;
        if (!cur.reasons.includes('outro local de saída')) cur.reasons.push('outro local de saída');
      }

      // Save
      if (cur.reasons.length > 0) map.set(String(o.id), cur);
    }
    return Array.from(map.values());
  }, [selectedMixedOrders, selectedOrders, orders, filterHasAssembly, filterDepartment, strictDepartment]);

  const openMixedConfirm = (action: 'create' | 'add') => {
    const list = selectedMixedOrdersPlus;
    if (list.length === 0) return false;
    setMixedConfirmOrders(list);
    setMixedConfirmAction(action);
    setMixedConfirmOpen(true);
    return true;
  };

  const isTrueGlobal = (v: any) => {
    if (typeof v === 'boolean') return v;
    const s = String(v || '').trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'sim' || s === 's' || s === 'y' || s === 'yes' || s === 't';
  };

  // Verifica se o pedido tem Frete Full
  // Prioridade 1: Campo tem_frete_full
  // Prioridade 2: Observações internas contendo *frete full* (entre asteriscos)
  const hasFreteFull = (order: any) => {
    const raw = order?.raw_json || {};
    // Prioridade 1: Campo direto
    if (isTrueGlobal(order?.tem_frete_full) || isTrueGlobal(raw?.tem_frete_full)) {
      return true;
    }
    // Prioridade 2: Observações internas com *frete full*
    const obsInternas = String(order?.observacoes_internas || raw?.observacoes_internas || '').toLowerCase();
    if (obsInternas.includes('*frete full*')) {
      return true;
    }
    return false;
  };

  const getFilteredOrderIds = (): Set<string> => {
    try {
      const filtered = (orders || []).filter((o: any) => {
        const addr: any = o.address_json || {};
        const raw: any = o.raw_json || {};
        const city = String(addr.city || raw.destinatario_cidade || '').toLowerCase();
        const nb = String(addr.neighborhood || raw.destinatario_bairro || '').toLowerCase();
        const client = String(o.customer_name || '').toLowerCase();
        const filial = String(o.filial_venda || raw.filial_venda || '').toLowerCase();
        const seller = String(o.vendedor_nome || raw.vendedor || '').toLowerCase();
        const isReturnedFlag = Boolean((o as any).return_flag) || String(o.status) === 'returned';
        if (filterCity && !city.includes(filterCity.toLowerCase())) return false;
        if (filterNeighborhood && !nb.includes(filterNeighborhood.toLowerCase())) return false;
        if (clientQuery && !client.includes(clientQuery.toLowerCase())) return false;
        if (filterFreightFull && !hasFreteFull(o)) return false;
        if (filterOperation && !String(raw.operacoes || '').toLowerCase().includes(filterOperation.toLowerCase())) return false;
        if (filterFilialVenda && filial !== filterFilialVenda.toLowerCase()) return false;
        if (filterSeller && !seller.includes(filterSeller.toLowerCase())) return false;
        if (filterReturnedOnly && !isReturnedFlag) return false;
        return true;
      });
      // Apply per-item filters
      const ids = new Set<string>();
      for (const o of filtered) {
        let items = Array.isArray(o.items_json) ? o.items_json : [];

        // Enrich items with department/brand from raw_json if missing
        if (items.length > 0) {
          const rawProds = Array.isArray(o.raw_json?.produtos_locais) ? o.raw_json.produtos_locais : (Array.isArray(o.raw_json?.produtos) ? o.raw_json.produtos : []);
          if (rawProds.length === items.length) {
            items = items.map((it: any, idx: number) => ({
              ...it,
              department: it.department || rawProds[idx]?.departamento || '',
              brand: it.brand || rawProds[idx]?.marca || ''
            }));
          }
        }
        if (strictDepartment && filterDepartment) {
          const allInDept = items.length > 0 && items.every((it: any) => String(it?.department || '').toLowerCase() === filterDepartment.toLowerCase());
          if (!allInDept) continue;
        }
        if (strictLocal && filterLocalEstocagem) {
          const allInLocal = items.length > 0 && items.every((it: any) => String(it?.location || '').toLowerCase() === filterLocalEstocagem.toLowerCase());
          if (!allInLocal) continue;
        }
        const byLocal = filterLocalEstocagem ? items.filter((it: any) => String(it?.location || '').toLowerCase() === filterLocalEstocagem.toLowerCase()) : items;
        let byOther = byLocal;
        if (filterHasAssembly) byOther = byOther.filter((it: any) => isTrueGlobal(it?.has_assembly));
        if (filterDepartment) byOther = byOther.filter((it: any) => String(it?.department || '').toLowerCase() === filterDepartment.toLowerCase());
        if (filterBrand) byOther = byOther.filter((it: any) => String(it?.brand || '').toLowerCase() === filterBrand.toLowerCase());
        if (byOther.length > 0) ids.add(String(o.id));
      }
      return ids;
    } catch { return new Set(); }
  };

  // --- ROUTE FETCHING ---
  const fetchRoutes = async (resetPage: boolean = false) => {
    try {
      const currentPage = resetPage ? 0 : page;
      const from = currentPage * LIMIT;
      const to = from + LIMIT - 1;

      console.log(`Fetching routes page ${currentPage} (${from}-${to}) with filter ${dateFilter}`);

      let query = supabase
        .from('routes')
        .select('*, vehicle:vehicles!vehicle_id(id,model,plate), route_orders:route_orders(id,status), driver:drivers!driver_id(id,user:users!user_id(name)), conferences:route_conferences!route_id(id,route_id,status,result_ok,finished_at,created_at,resolved_at,resolved_by,resolution,summary)', { count: 'exact' })
        .order('created_at', { ascending: false });

      // Apply Date Filters
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

      if (dateFilter === 'today') {
        query = query.gte('created_at', todayStart);
      } else if (dateFilter === 'yesterday') {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStart = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()).toISOString();
        query = query.gte('created_at', yesterdayStart).lt('created_at', todayStart);
      } else if (dateFilter === 'last7') {
        const last7 = new Date(now);
        last7.setDate(last7.getDate() - 7);
        const last7Start = new Date(last7.getFullYear(), last7.getMonth(), last7.getDate()).toISOString();
        query = query.gte('created_at', last7Start);
      }
      // 'all' applies no date filter

      // Apply Status Filters
      if (statusFilter.length > 0) {
        query = query.in('status', statusFilter);
      }

      // Apply Search Filter (Server-Side)
      if (routeSearchQuery.trim()) {
        const q = routeSearchQuery.trim();
        // Check if query is a valid UUID
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);

        if (isUuid) {
          query = query.eq('id', q);
        } else {
          // Search by Name or Route Code
          // Note: searching localized driver name is hard server-side without an RPC or complex join filter. 
          // We will search Name and Route Code server-side.
          // Syntax for OR with ILIKE:
          query = query.or(`name.ilike.%${q}%,route_code.ilike.%${q}%`);
        }
      }

      // Pagination
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) throw error;

      // Process Routes (Same logic as before)
      let processedRoutes: RouteWithDetails[] = data || [];

      // ... (Enrichment logic will be shared/copied here or handled via helper? 
      // For now, I will include the enrichment logic here to ensure it works, 
      // but I need access to drivers/users/vehicles which might not be set yet if called parallel.
      // However, fetchRoutes is usually called AFTER initial metadata load or independent of it.
      // BUT `loadData` calls this. If `loadData` hasn't finished setting `drivers` state, we might have issue.
      // Actually `loadData` waits for `Promise.all` including drivers. 
      // So if `fetchRoutes` is called inside `loadData` after `Promise.all`, we have the raw data in variables there?
      // No, `fetchRoutes` creates its own scope. It needs to access the *state* or fetch dependent data.
      // Easiest way: duplicate the enrichment fetching inside here slightly optimized, 
      // OR mostly rely on the fact that drivers/vehicles are likely static. 
      // Current architecture fetches enrichment data *in bulk* based on the routes returned.
      // I will copy the enrichment block logic into here.

      // ENRICHMENT LOGIC (Simplified: Map driver name and conference from nested object)
      if (processedRoutes.length > 0) {
        for (const r of processedRoutes as any[]) {
          // Conference sorting (if multiple returned, pick latest)
          if (Array.isArray(r.conferences) && r.conferences.length > 0) {
            const sorted = [...r.conferences].sort((a: any, b: any) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
            r.conference = sorted[0];
          }

          // Driver name flattening
          if (r.driver && r.driver.user) {
            r.driver_name = r.driver.user.name;
          }
        }
      }

      if (resetPage) {
        setRoutesList(processedRoutes);
      } else {
        setRoutesList(prev => [...prev, ...processedRoutes]);
      }

      setHasMoreRoutes((data?.length || 0) === LIMIT);
      if (resetPage) setPage(1); // Next page
      else setPage(prev => prev + 1);

      return processedRoutes; // Return for usage in loadData

    } catch (err) {
      console.error('Error fetching routes:', err);
      toast.error('Erro ao buscar rotas');
      return [];
    }
  };

  useEffect(() => {
    fetchRoutes(true);
  }, [dateFilter, statusFilter]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchRoutes(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [routeSearchQuery]);

  // --- DATA LOADING ---
  // This function loads data directly from Supabase with optimized parallel queries (METADATA ONLY)
  const loadData = async (silent: boolean = true) => {
    try {
      if (isLoadingRef.current) return;
      isLoadingRef.current = true;

      // Don't show loading if modals are open (preserve state) or if silent
      if (!silent && !showRouteModal && !showCreateModal) setLoading(true);

      // Parallel fetch for all data using Promise.all
      const [
        ordersRes,
        vehiclesRes,
        confSettingRes,
        driversRes,
        conferentesRes,
        // routesRes, (REMOVED)
        activeRouteOrdersRes,
        // Pedidos bloqueados (cancelados/devolvidos via n8n)
        blockedOrdersRes,
        // Pedidos que precisam de coleta (foram entregues e depois devolvidos)
        pickupPendingRes,
      ] = await Promise.all([
        // Orders (pending or returned OR assigned) - EXCLUINDO BLOQUEADOS
        supabase
          .from('orders')
          .select('*')
          .in('status', ['pending', 'returned', 'assigned'])
          .is('blocked_at', null)  // Só pedidos NÃO bloqueados
          .order('created_at', { ascending: false }),

        // Vehicles
        supabase
          .from('vehicles')
          .select('*')
          .order('model'), // Removed active filter to ensure team vehicles appear

        // Conference setting
        supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'require_route_conference')
          .single(),

        // Drivers
        supabase
          .from('drivers')
          .select('id, user_id, active')
          .order('id'), // Removed active filter to ensure team drivers appear

        // Conferentes
        supabase
          .from('users')
          .select('id,name,role')
          .eq('role', 'conferente'),

        // Routes fetch moved to separate fetchRoutes function for independent filtering
        // supabase.from('routes')...

        // Active route orders (SAFETY: prevent re-routing orders that are in active routes)
        supabase
          .from('route_orders')
          .select('order_id, route:routes!inner(status)')
          .neq('route.status', 'completed'),

        // Pedidos bloqueados (para aba "Bloqueados")
        supabase
          .from('orders')
          .select('*')
          .not('blocked_at', 'is', null)
          .order('blocked_at', { ascending: false })
          .limit(100),

        // Pedidos que precisam de coleta (para aba "Coletas Pendentes")
        supabase
          .from('orders')
          .select('*')
          .eq('requires_pickup', true)
          .is('pickup_created_at', null)
          .order('blocked_at', { ascending: false })
          .limit(100),
      ]);

      // Identify locked orders (belonging to active routes)
      const lockedOrderIds = new Set<string>();
      if (activeRouteOrdersRes.data) {
        activeRouteOrdersRes.data.forEach((ro: any) => {
          if (ro.order_id) lockedOrderIds.add(String(ro.order_id));
        });
      }

      // Process orders - normalize return flags and FILTER LOCKED ORDERS
      let processedOrders: Order[] = [];
      if (ordersRes.data) {
        const rawOrders = ordersRes.data as Order[];
        processedOrders = rawOrders
          .filter(o => !lockedOrderIds.has(o.id)) // SAFETY FILTER
          .map((o: any) => {
            let updated = { ...o };
            // Normalização de flags de retorno e auto-repair visual
            // Se tiver last_return_reason, deveríamos considerar como retornado para fins de UI
            if ((String(o.status) === 'returned' && !o.return_flag) || (o.last_return_reason && !o.return_flag)) {
              updated.return_flag = true;
            }
            // Recuperação de falhas: se estiver 'assigned' mas não bloqueado (passou filtro),
            // significa que está "solto" (ex: rota concluída mas status não atualizou).
            // Tratamos como pending para permitir nova roteirização.
            // TENTATIVA DE RECUPERAÇÃO REMOVIDA:
            // Anteriormente, se o pedido estava 'assigned' mas não bloqueado (rota concluída),
            // o sistema forçava 'pending'. Isso causava duplicidade se o sync falhasse.
            // Agora, se houver descompasso, o pedido fica 'assigned' e invisível aqui,
            // devendo ser tratado na tela de Auditoria.
            // if (String(o.status) === 'assigned') {
            //   updated.status = 'pending';
            // }
            return updated;
          });
        // DEBUG: Log orders with return data
        const withReturnData = processedOrders.filter((o: any) => o.return_flag || o.last_return_reason);
        if (withReturnData.length > 0) {
          console.log('[RouteCreation] Orders with return data:', withReturnData.map((o: any) => ({
            id: o.id,
            order_id_erp: o.order_id_erp,
            status: o.status,
            return_flag: o.return_flag,
            last_return_reason: o.last_return_reason
          })));
        }
        setOrders(processedOrders);
      }

      // Processar pedidos bloqueados
      if (blockedOrdersRes.data) {
        setBlockedOrders(blockedOrdersRes.data as Order[]);
      }

      // Processar pedidos que precisam de coleta
      if (pickupPendingRes.data) {
        setPickupPendingOrders(pickupPendingRes.data as Order[]);
      }

      // Conference setting
      const confSetting = confSettingRes.data as any;
      const flagEnabled = confSetting?.value?.enabled;
      setRequireConference(flagEnabled === false ? false : true);

      // Process drivers - enrich with user data
      let driverList: DriverWithUser[] = [];
      if (driversRes.data && driversRes.data.length > 0) {
        const uids = Array.from(new Set(driversRes.data.map((d: any) => String(d.user_id)).filter(Boolean)));
        if (uids.length > 0) {
          const { data: usersData } = await supabase
            .from('users')
            .select('id,name,email,role')
            .in('id', uids);

          const mapU = new Map<string, any>((usersData || []).map((u: any) => [String(u.id), u]));
          driverList = driversRes.data.map((d: any) => ({ ...d, user: mapU.get(String(d.user_id)) || null }));
        }
        // Filter only drivers - RELAXED: Trust 'drivers' table membership
        // driverList = driverList.filter((d: any) => String(d?.user?.role || '').toLowerCase() === 'driver');
      }
      setDrivers(driverList);

      // Vehicles
      if (vehiclesRes.data) setVehicles(vehiclesRes.data as Vehicle[]);

      // Conferentes
      setConferentes((conferentesRes.data || []).map((u: any) => ({
        id: String(u.id),
        name: String(u.name || u.id)
      })));

      // Teams and Helpers
      console.log('Fetching teams and helpers...');
      const { data: teamsData, error: teamsError } = await supabase
        .from('teams_user')
        .select(`
          id, 
          name, 
          driver_user_id, 
          helper_user_id,
          driver:users!teams_user_driver_user_id_fkey(id, name),
          helper:users!teams_user_helper_user_id_fkey(id, name)
        `);

      if (teamsError) {
        console.error('Error fetching teams:', teamsError);
        toast.error('Erro ao carregar equipes: ' + teamsError.message);
      } else {
        console.log('Teams loaded:', teamsData);
        if (teamsData) setTeams(teamsData);
      }

      const { data: helpersData, error: helpersError } = await supabase
        .from('users')
        .select('id, name')
        .eq('role', 'helper');
      if (helpersError) {
        console.error('Error fetching helpers:', helpersError);
        toast.error('Erro ao carregar ajudantes: ' + helpersError.message);
      } else {
        console.log('Helpers loaded:', helpersData);
        if (helpersData) setHelpers(helpersData);
      }

      // Trigger route fetch
      let processedRoutes: RouteWithDetails[] = [];
      if (!silent) {
        const res = await fetchRoutes(true);
        if (res) processedRoutes = res;
      }

      // Handle selected route restoration from localStorage
      // BUT: Don't overwrite if modal is already open to prevent background refresh issues
      if (selectedRouteIdRef.current && processedRoutes.length > 0) {
        const found = processedRoutes.find(r => String(r.id) === String(selectedRouteIdRef.current));
        if (found) {
          // UPDATE: Allow update even if modal is open, BUT ONLY if we are NOT editing
          // This allows Realtime updates to reflect in the modal (e.g. status change) while viewing details.
          // We use the ref or state to check if editing? We have isEditingRoute state.
          // Since we are inside loadData closure, we need to be careful about stale state.
          // Ideally we should trust the Realtime update to be "truth".

          // SAFETY: If `isEditingRoute` is true (state), we skip update to not lose typed text.
          // BUT: `isEditingRoute` state might be stale here if loadData is captured.
          // However, we are using `loadDataRef.current = loadData` in the render body, so `loadData` 
          // assumes the closure of the render it was defined in.
          // If the component re-rendered when `isEditingRoute` changed, `loadData` was recreated.
          // SO usage of `isEditingRoute` here is safe (it's from the current closure).

          if (!isEditingRoute) {
            setSelectedRoute(found);
          }

          if (showRouteModalRef.current && !showRouteModal) {
            setShowRouteModal(true);
          }
        }
      }

    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  };

  // --- REALTIME SETUP ---
  // Ensure refs always point to latest function versions (avoid stale closures)
  fetchRoutesRef.current = fetchRoutes;
  loadDataRef.current = loadData;

  useEffect(() => {
    // Realtime Subscription
    const channel = supabase
      .channel('route-creation-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          console.log('[Realtime] Orders changed');
          if (loadDataRef.current) loadDataRef.current(true);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'route_orders' },
        (payload) => {
          console.log('[Realtime] Route Orders changed');
          if (loadDataRef.current) loadDataRef.current(true);
          if (fetchRoutesRef.current) fetchRoutesRef.current(true); // Reset to page 0
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'routes' },
        (payload) => {
          console.log('[Realtime] Routes changed');
          if (fetchRoutesRef.current) fetchRoutesRef.current(true);
          if (loadDataRef.current) loadDataRef.current(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const toggleOrderSelection = (orderId: string) => {
    const newSelected = new Set(selectedOrders);
    const wasSelected = newSelected.has(orderId);

    // Logic for CPF Grouping (Only when selecting, not deselecting)
    if (!wasSelected) {
      const order = (orders || []).find((x: any) => String(x.id) === String(orderId));
      const cpf = order?.customer_cpf ? String(order.customer_cpf).trim() : '';

      if (cpf) {
        // 1. Check for other pending orders with same CPF
        const sameCpfPending = (orders || []).filter((o: any) =>
          String(o.id) !== String(orderId) &&
          String(o.customer_cpf || '').trim() === cpf &&
          !newSelected.has(o.id)
        );

        if (sameCpfPending.length > 0) {
          toast.message(`Este cliente possui mais ${sameCpfPending.length} pedido(s) pendente(s).`, {
            description: 'Deseja selecionar todos juntos?',
            action: {
              label: 'Selecionar Todos',
              onClick: () => {
                const updated = new Set(selectedOrders);
                updated.add(orderId);
                sameCpfPending.forEach((o: any) => updated.add(String(o.id)));
                setSelectedOrders(updated);
                toast.success(`${sameCpfPending.length + 1} pedidos selecionados!`);
              },
            },
            duration: 6000,
          });
        }

        // 2. Check for active routes with this CPF
        const existingRoutes: string[] = [];
        for (const r of routesList) {
          if (r.status === 'completed') continue;
          // Check route orders
          const hasCpf = r.route_orders?.some((ro: any) => String(ro.order?.customer_cpf || '').trim() === cpf);
          if (hasCpf) {
            existingRoutes.push(`${r.name} (${r.status === 'pending' ? 'Pendente' : 'Em Rota'})`);
          }
        }

        if (existingRoutes.length > 0) {
          toast.warning(`Atenção: Cliente com entregas em andamento!`, {
            description: `Rotas: ${existingRoutes.join(', ')}. Considere agrupar.`,
            duration: 8000,
          });
        }
      }
    }

    if (wasSelected) {
      newSelected.delete(orderId);
    } else {
      newSelected.add(orderId);
      if (filterLocalEstocagem) {
        try {
          const o = (orders || []).find((x: any) => String(x.id) === String(orderId));
          const locs = getOrderLocations(o || {}).map(l => String(l));
          const other = locs.filter(l => l.toLowerCase() !== filterLocalEstocagem.toLowerCase());
          if (other.length > 0) {
            toast.warning(`Pedido possui itens também em outros locais: ${Array.from(new Set(other)).join(', ')}`);
          }
        } catch { }
      }
    }
    setSelectedOrders(newSelected);
  };



  const createPickup = async () => {
    if (selectedOrders.size === 0) {
      toast.error('Selecione pelo menos um pedido para retirada.');
      return;
    }
    if (!pickupConferente) {
      toast.error('Selecione o conferente responsável pela entrega.');
      return;
    }

    // Buscar o nome do conferente selecionado
    const conferenteInfo = conferentes.find(c => c.id === pickupConferente);
    const conferenteName = conferenteInfo?.name || 'Não informado';

    setPickupSaving(true);
    try {
      const name = `RETIRADA - ${new Date().toLocaleString('pt-BR')}`;
      const { data: routeData, error: routeError } = await supabase
        .from('routes')
        .insert({
          name,
          driver_id: PICKUP_PLACEHOLDER_DRIVER_ID, // Motorista placeholder
          conferente: conferenteName, // Responsável pela entrega
          status: 'pending',
          observations: `Retirada em Loja.\nResponsável: ${conferenteName}\nObs: ${pickupObservations}`.trim()
        })
        .select()
        .single();

      if (routeError) throw routeError;

      const orderIds = Array.from(selectedOrders);
      // Create route_orders with 'pending' status
      const routeOrdersPayload = orderIds.map((oid, idx) => ({
        route_id: routeData.id,
        order_id: oid,
        sequence: idx + 1,
        status: 'pending',
        delivery_observations: `Retirada em Loja. Resp: ${conferenteName}. ${pickupObservations}`.trim().slice(0, 500)
      }));

      const { error: roError } = await supabase.from('route_orders').insert(routeOrdersPayload);
      if (roError) throw roError;

      // Update orders to 'assigned'
      const { error: ordError } = await supabase.from('orders').update({ status: 'assigned' }).in('id', orderIds);
      if (ordError) throw ordError;

      toast.success('Retirada registrada!');
      setSelectedOrders(new Set());
      setPickupConferente('');
      setPickupObservations('');
      setShowPickupModal(false);

      await loadData(false);

      setActiveRoutesTab('pickups');

      // Attempt to set route for modal
      const { data: fullRoute } = await supabase
        .from('routes')
        .select('*, route_orders(*, order:orders(*)), driver:drivers(*, user:users(*)), vehicle:vehicles(*)')
        .eq('id', routeData.id)
        .single();

      if (fullRoute) {
        setSelectedRoute(fullRoute as any);
        setShowRouteModal(true);
      }

    } catch (error: any) {
      console.error('Error creating pickup:', error);
      toast.error('Erro: ' + error.message);
    } finally {
      setPickupSaving(false);
    }
  };

  // Função para criar ordem de coleta de devolução
  const createPickupOrder = async () => {
    if (!selectedPickupOrder) return;
    if (!pickupTeam) {
      toast.error('Selecione uma equipe');
      return;
    }

    setPickupOrderLoading(true);
    try {
      const order = selectedPickupOrder;

      // Buscar dados da equipe selecionada
      let teamData = teams.find(t => t.id === pickupTeam);

      // Se não achou na lista local (raro), busca no banco
      if (!teamData) {
        const { data: t } = await supabase.from('teams_user').select('*').eq('id', pickupTeam).single();
        if (t) teamData = t;
      }

      // Definição de Motorista e Ajudante baseado na equipe
      let driverIdToUse = null;
      let helperIdToUse = null;
      let conferenteName = 'Conferente';

      // Se a equipe tem driver_user_id, precisamos achar o driver correspondente na tabela drivers
      if (teamData?.driver_user_id) {
        // Tenta achar driver com esse user_id na lista
        const drv = drivers.find(d => d.user_id === teamData.driver_user_id);
        if (drv) driverIdToUse = drv.id;
        else {
          // Fallback: se não achar na lista, pode ser que drivers não esteja carregado full, ou o user_id não bata. 
          // Tenta buscar driver pelo user_id
          const { data: dDB } = await supabase.from('drivers').select('id').eq('user_id', teamData.driver_user_id).single();
          if (dDB) driverIdToUse = dDB.id;
        }
      }

      helperIdToUse = teamData?.helper_user_id || null;

      // Se não achou motorista na equipe, usa o placeholder OU avisa (decisão: avisar/falhar é mais seguro, mas vou manter fallback para placeholder se crítico)
      if (!driverIdToUse) {
        console.warn('Motorista da equipe não encontrado na tabela drivers. Usando placeholder.');
        driverIdToUse = PICKUP_PLACEHOLDER_DRIVER_ID;
      }

      // Conferente Name (apenas visual para observação)
      if (pickupOrderConferente) {
        const c = conferentes.find(x => x.id === pickupOrderConferente);
        if (c) conferenteName = c.name;
      }

      // 1. Gerar DANFE da nota de devolução via webhook
      toast.info('Gerando nota fiscal de devolução...');

      let nfWebhook = 'https://n8n.lojaodosmoveis.shop/webhook-test/gera_nf';
      try {
        const { data: s } = await supabase.from('webhook_settings').select('url').eq('key', 'gera_nf').eq('active', true).single();
        if (s?.url) nfWebhook = s.url;
      } catch { }

      // Usar o XML de devolução que veio do ERP
      const xmlDevolucao = order.return_nfe_xml || '';
      if (!xmlDevolucao) {
        toast.warning('XML de devolução não encontrado. Continuando sem DANFE.');
      }

      let danfeBase64 = '';
      if (xmlDevolucao) {
        try {
          const resp = await fetch(nfWebhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              route_id: `COLETA-${order.order_id_erp}`,
              documentos: [{ order_id: order.id, numero: order.return_nfe_number || order.order_id_erp, xml: xmlDevolucao }],
              count: 1,
              tipo: 'devolucao'
            })
          });
          if (resp.ok) {
            const payload = await resp.json();
            const items = Array.isArray(payload) ? payload : [payload];
            if (items[0]?.pdf_base64) {
              danfeBase64 = items[0].pdf_base64;
            }
          }
        } catch (e) {
          console.warn('Falha ao gerar DANFE de devolução:', e);
        }
      }

      // 2. CRIAR NOVO PEDIDO DE COLETA (Prefixo C-)
      // Isso é necessário para evitar conflito com o pedido original que já está Entregue
      // e para ter um ciclo de vida independente na rota de coleta.

      const newOrderErpId = `C-${order.order_id_erp}`;

      // Preparar objeto do novo pedido copiando dados do original
      const newOrderPayload = {
        order_id_erp: newOrderErpId,
        customer_name: order.customer_name,
        phone: order.phone,
        customer_cpf: order.customer_cpf,
        address_json: order.address_json,
        items_json: (order.items_json || []).map((item: any) => ({
          ...item,
          // Importante: Remover flags de montagem para não disparar trigger de assembly product ao entregar
          tem_montagem: false,
          has_assembly: false,
          assembly_status: null
        })),
        status: 'pending', // Nasce pendente para poder ser roteirizado
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        raw_json: order.raw_json, // Mantém raw_json para referência

        // Campos específicos da coleta
        xml_documento: null, // Limpa XML de venda para evitar confusão
        return_nfe_xml: order.return_nfe_xml, // XML da devolução no campo correto
        return_nfe_number: order.return_nfe_number,

        danfe_base64: null,
        return_danfe_base64: danfeBase64, // Salva DANFE gerada no campo de retorno
        danfe_gerada_em: new Date().toISOString(),

        filial_venda: order.filial_venda,
        data_venda: order.data_venda,

        observacoes_internas: `PEDIDO DE COLETA GERADO AUTOMATICAMENTE.\nOrigem: ${order.order_id_erp}\nMotivo: ${order.blocked_reason || 'Devolução'}`.slice(0, 1000),

        // Limpar flags de controle anteriores
        return_flag: false,
        requires_pickup: false, // Este pedido JÁ É a execução da pickup
        pickup_created_at: null,
        blocked_at: null
      };



      // Inserir novo pedido
      const { data: newOrderData, error: newOrderError } = await supabase
        .from('orders')
        .insert(newOrderPayload)
        .select()
        .single();

      if (newOrderError) throw newOrderError;

      // 3. Criar rota de coleta
      const routeName = `COLETA-${order.return_nfe_number || order.order_id_erp}-${new Date().toLocaleDateString('pt-BR').replace(/\//g, '')}`;

      const { data: routeData, error: routeError } = await supabase
        .from('routes')
        .insert({
          name: routeName,
          team_id: pickupTeam, // ID da equipe
          driver_id: driverIdToUse, // ID do motorista da equipe
          helper_id: helperIdToUse, // ID do ajudante (user_id)
          vehicle_id: null,
          status: 'pending',
          observations: `Coleta de devolução. NF: ${order.return_nfe_number || '-'}. Resp: ${conferenteName}. ${pickupOrderObservations}`.trim()
        })
        .select()
        .single();

      if (routeError) throw routeError;

      // 4. Criar route_order vinculada ao NOVO pedido de coleta
      const { error: roError } = await supabase.from('route_orders').insert({
        route_id: routeData.id,
        order_id: newOrderData.id, // ID do novo pedido C-
        sequence: 1,
        status: 'pending',
        delivery_observations: `Coleta de devolução. NF: ${order.return_nfe_number || '-'}. Motivo: ${order.blocked_reason || '-'}`
      });
      if (roError) throw roError;

      // 5. Atualizar o pedido ORIGINAL marcando que a coleta foi criada
      // Isso faz ele sumir da lista de "Coletas Pendentes"
      const updateData: any = {
        pickup_created_at: new Date().toISOString()
      };

      // Opcional: Salvar DANFE no original também para histórico, se desejar
      if (danfeBase64) {
        updateData.return_danfe_base64 = danfeBase64;
      }

      const { error: ordError } = await supabase.from('orders').update(updateData).eq('id', order.id);
      if (ordError) throw ordError;

      toast.success(`Coleta criada! Pedido gerado: ${newOrderErpId}`);

      // Limpar e fechar modal
      setShowPickupOrderModal(false);
      setSelectedPickupOrder(null);
      setPickupOrderConferente('');
      setPickupTeam(''); // Limpar equipe
      setPickupOrderObservations('');

      // Recarregar dados
      await loadData(false);

      // Mudar para aba de retiradas (onde a rota vai aparecer)
      setActiveRoutesTab('pickups');

    } catch (error: any) {
      console.error('Error creating pickup order:', error);
      toast.error('Erro ao criar coleta: ' + error.message);
    } finally {
      setPickupOrderLoading(false);
    }
  };

  // Generate unique route code: RE-DDMMYY-XXX (delivery) or RM-DDMMYY-XXX (assembly)
  const generateRouteCode = async (type: 'delivery' | 'assembly' = 'delivery'): Promise<string> => {
    const prefix = type === 'delivery' ? 'RE' : 'RM';
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2); // Last 2 digits of year
    const dateCode = `${day}${month}${year}`;

    // Query existing codes for today to get next sequence
    const pattern = `${prefix}-${dateCode}-%`;
    const { data: existingRoutes } = await supabase
      .from('routes')
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

  const createRoute = async (forceProceed: boolean = false) => {
    if (!forceProceed && openMixedConfirm('create')) return;
    if (!selectedExistingRouteId) {
      if (!routeName.trim()) { toast.error('Por favor, informe um nome para a rota'); return; }
      if (!selectedDriver) { toast.error('Por favor, selecione um motorista'); return; }
    }
    if (selectedOrders.size === 0) { toast.error('Por favor, selecione pelo menos um pedido'); return; }

    setSaving(true);

    try {
      let targetRouteId = selectedExistingRouteId;
      if (!selectedExistingRouteId) {
        // Generate unique route code
        const routeCode = await generateRouteCode('delivery');

        const { data: routeData, error: routeError } = await supabase
          .from('routes')
          .insert({
            name: routeName.trim(),
            driver_id: selectedDriver,
            vehicle_id: selectedVehicle || null,
            // We need to save BOTH correctly (conferente name string and conferente_id uuid)
            // Check if conferente value is UUID (selection) or Text (free input/legacy)
            conferente_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conferente) ? conferente : null,
            conferente: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conferente)
              ? (conferentes.find(c => c.id === conferente)?.name || null)
              : (conferente || null),
            observations: observations.trim() || null,
            team_id: selectedTeam || null,
            helper_id: selectedHelper || null,
            status: 'pending',
            route_code: routeCode,
          })
          .select()
          .single();
        if (routeError) throw routeError;
        targetRouteId = routeData.id;
      }
      // If adding to existing route, persist assignments if provided
      if (selectedExistingRouteId) {
        const updatePayload: any = {};
        if (selectedDriver) updatePayload.driver_id = selectedDriver;
        if (selectedVehicle) updatePayload.vehicle_id = selectedVehicle;
        if (selectedTeam) updatePayload.team_id = selectedTeam;
        if (selectedHelper) updatePayload.helper_id = selectedHelper;
        if (conferente) updatePayload.conferente = conferente.trim();
        if (Object.keys(updatePayload).length > 0) {
          const { error: updErr } = await supabase.from('routes').update(updatePayload).eq('id', targetRouteId);
          if (updErr) throw updErr;
        }
      }

      const { data: existingRO } = await supabase
        .from('route_orders')
        .select('order_id,sequence')
        .eq('route_id', targetRouteId)
        .order('sequence');
      const existingIds = new Set<string>((existingRO || []).map((r: any) => String(r.order_id)));
      const startSeq = (existingRO && existingRO.length > 0) ? Math.max(...existingRO.map((r: any) => Number(r.sequence || 0))) + 1 : 1;

      // Filter out stale IDs (e.g. from localStorage after DB wipe)
      const validOrderIds = new Set((orders || []).map((o) => String(o.id)));
      const toAdd = Array.from(selectedOrders)
        .filter((id) => !existingIds.has(String(id)))
        .filter((id) => validOrderIds.has(String(id)));

      if (toAdd.length === 0 && selectedOrders.size > 0) {
        toast.error('Pedidos selecionados não são mais válidos. A seleção será limpa.');
        setSelectedOrders(new Set());
        setSaving(false);
        return;
      }

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
      setSelectedTeam('');
      setSelectedHelper('');
      setSelectedOrders(new Set());
      setSelectedExistingRouteId('');
      showCreateModalRef.current = false;
      localStorage.removeItem('rc_showCreateModal');
      setShowCreateModal(false);

      // Reload data
      loadData(false);

    } catch (error: any) {
      console.error('Error creating route:', error);
      if (error?.code === '23505' || error?.status === 409) {
        toast.error('Já existe uma rota com este nome. Por favor, escolha outro.');
      } else {
        toast.error('Erro ao criar rota: ' + (error?.message || 'Erro desconhecido'));
      }
    } finally {
      setSaving(false);
    }
  };

  // --- RENDER ---

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {loading && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-white/70">
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <span className="text-gray-700 font-medium">Carregando plataforma de rotas...</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-4">
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
                  <MapPin className="h-6 w-6 text-blue-600" />
                  Gestão de Entrega
                </h1>
                <p className="text-sm text-gray-500">Crie, monitore e gerencie entregas e romaneios</p>
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
            </div>
          </div>
        </div>
      </div>

      <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">

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
                Ir para rotas
              </button>
            </div>
          </div>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 animate-in slide-in-from-top-2 duration-200">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase">Data da Venda (Período)</label>
                <div className="w-full">
                  <DatePicker
                    selectsRange={true}
                    startDate={stringToDate(filterSaleDateStart)}
                    endDate={stringToDate(filterSaleDateEnd)}
                    onChange={(update) => {
                      const [start, end] = update;
                      setFilterSaleDateStart(dateToString(start));
                      setFilterSaleDateEnd(dateToString(end));
                    }}
                    isClearable={true}
                    locale="pt-BR"
                    dateFormat="dd/MM/yyyy"
                    placeholderText="Selecione o período"
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-700 text-sm"
                    wrapperClassName="w-full"
                  />
                </div>
              </div>
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
                <label className="text-xs font-semibold text-gray-500 uppercase">Filial</label>
                <select value={filterFilialVenda} onChange={(e) => setFilterFilialVenda(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all">
                  <option value="">Todas</option>
                  {filialOptions.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase">Local de Saída</label>
                <select value={filterLocalEstocagem} onChange={(e) => setFilterLocalEstocagem(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all">
                  <option value="">Todos</option>
                  {localOptions.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
                <div className="flex items-center mt-1">
                  <input type="checkbox" id="strictLocal" className="h-3 w-3 text-blue-600 rounded border-gray-300" checked={strictLocal} onChange={(e) => setStrictLocal(e.currentTarget.checked)} />
                  <label htmlFor="strictLocal" className="ml-2 text-xs text-gray-500">Apenas local exclusivo</label>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase">Vendedor</label>
                <select value={filterSeller} onChange={(e) => setFilterSeller(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all">
                  <option value="">Todos</option>
                  {sellerOptions.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              </div>
              <div className="relative space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase">Busca Rápida</label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={clientQuery}
                    onChange={(e) => { const v = e.target.value; setClientQuery(v); setFilterClient(v); }}
                    placeholder="Pedido, cliente ou CPF..."
                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase">Departamento</label>
                <select value={filterDepartment} onChange={(e) => setFilterDepartment(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all">
                  <option value="">Todos</option>
                  {departmentOptions.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
                <div className="flex items-center mt-1">
                  <input type="checkbox" id="strictDept" className="h-3 w-3 text-blue-600 rounded border-gray-300" checked={strictDepartment} onChange={(e) => setStrictDepartment(e.currentTarget.checked)} />
                  <label htmlFor="strictDept" className="ml-2 text-xs text-gray-500">Apenas dept. exclusivo</label>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase">Marca</label>
                <select value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all">
                  <option value="">Todas</option>
                  {brandOptions.map((c) => (<option key={c} value={c}>{c}</option>))}
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
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase">Operação</label>
                <select value={filterOperation} onChange={(e) => setFilterOperation(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all">
                  <option value="">Todas</option>
                  {operationOptions.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase">Frete Full</label>
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                  <input id="ffull" type="checkbox" className="h-4 w-4" checked={Boolean(filterFreightFull)} onChange={(e) => setFilterFreightFull(e.target.checked ? '1' : '')} />
                  <label htmlFor="ffull" className="text-sm text-gray-700">Apenas pedidos com Frete Full</label>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase">Tem Montagem</label>
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                  <input id="fmont" type="checkbox" className="h-4 w-4" checked={filterHasAssembly} onChange={(e) => setFilterHasAssembly(e.target.checked)} />
                  <label htmlFor="fmont" className="text-sm text-gray-700">Apenas produtos com Montagem</label>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase">Retorno</label>
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                  <input id="freturned" type="checkbox" className="h-4 w-4" checked={filterReturnedOnly} onChange={(e) => setFilterReturnedOnly(e.target.checked)} />
                  <label htmlFor="freturned" className="text-sm text-gray-700">Apenas pedidos retornados</label>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase">Retirada</label>
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                  <input id="fretirada" type="checkbox" className="h-4 w-4" checked={filterRetirada} onChange={(e) => setFilterRetirada(e.target.checked)} />
                  <label htmlFor="fretirada" className="text-sm text-gray-700">Apenas pedidos para Retirada</label>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase">Tipo Serviço</label>
                <select value={filterServiceType} onChange={(e) => setFilterServiceType(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all">
                  <option value="">Todos</option>
                  <option value="normal">Venda Normal</option>
                  <option value="troca">Troca</option>
                  <option value="assistencia">Assistência</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end mt-4 pt-4 border-t border-gray-100">
              <button
                onClick={() => { setFilterCity(''); setFilterNeighborhood(''); setFilterFilialVenda(''); setFilterLocalEstocagem(''); setStrictLocal(false); setFilterSeller(''); setFilterClient(''); setClientQuery(''); setFilterFreightFull(''); setFilterOperation(''); setFilterDepartment(''); setFilterHasAssembly(false); setFilterSaleDateStart(''); setFilterSaleDateEnd(''); setFilterBrand(''); setFilterReturnedOnly(false); setFilterServiceType(''); setFilterRetirada(false); }}
                className="text-sm text-red-600 hover:text-red-800 font-medium flex items-center"
              >
                <X className="h-3 w-3 mr-1" /> Limpar filtros
              </button>
            </div>
          </div>
        )}

        {/* Action Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <button
            onClick={() => setShowLaunchModal(true)}
            className="flex items-center justify-center px-4 py-3 rounded-xl border border-orange-200 text-orange-700 bg-orange-50 hover:bg-orange-100 font-bold transition-all shadow-sm hover:shadow"
            title="Lançar Troca ou Assistência Avulsa"
          >
            <FilePlus className="h-5 w-5 mr-2" />
            Lançamento Avulso
          </button>

          <button
            onClick={() => setShowPickupModal(true)}
            disabled={selectedOrders.size === 0}
            className="flex items-center justify-center px-4 py-3 rounded-xl border border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 font-bold transition-all shadow-sm hover:shadow disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none"
            title="Registrar Retirada em Loja"
          >
            <Store className="h-5 w-5 mr-2" />
            Registrar Retirada
          </button>

          <button
            onClick={() => loadData(false)}
            disabled={loading}
            className="flex items-center justify-center px-4 py-3 rounded-xl border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 font-bold transition-all shadow-sm hover:shadow disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCcw className={`h-5 w-5 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Recarregar Dados
          </button>

          <button
            onClick={() => { showCreateModalRef.current = true; localStorage.setItem('rc_showCreateModal', '1'); setShowCreateModal(true); }}
            disabled={selectedOrders.size === 0}
            className="flex items-center justify-center px-4 py-3 rounded-xl bg-blue-600 text-white hover:bg-blue-700 font-bold transition-all shadow-sm hover:shadow disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none transform active:scale-95"
          >
            <Plus className="h-5 w-5 mr-2" />
            Criar Rota ({selectedOrders.size})
          </button>
        </div>

        {/* Orders Selection Card */}
        <div ref={ordersSectionRef} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="bg-blue-100 p-2 rounded-lg">
                <Package className="h-5 w-5 text-blue-700" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Pedidos Disponíveis</h2>
                <p className="text-xs text-gray-500">{orders.length} pedidos aguardando roteirização</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center px-3 py-2 bg-white border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                  onChange={(e) => {
                    if (e.currentTarget.checked) {
                      const ids = getFilteredOrderIds();
                      setSelectedOrders(ids);
                    } else {
                      setSelectedOrders(new Set());
                    }
                  }}
                  checked={getFilteredOrderIds().size > 0 && selectedOrders.size === getFilteredOrderIds().size}
                />
                <span className="ml-2 text-sm font-medium text-gray-700">Selecionar Todos</span>
              </label>
              <button onClick={() => setShowColumnsModal(true)} className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors" title="Configurar Colunas">
                <Settings className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Warning for Mixed selection across filters */}
          {selectedMixedOrdersPlus.length > 0 && (
            <div className="bg-yellow-50 border-b border-yellow-100 px-6 py-3 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-800">
                <span className="font-bold">Atenção:</span> Alguns pedidos selecionados possuem itens fora dos filtros atuais.
                <div className="mt-1 font-mono text-xs">
                  {selectedMixedOrdersPlus.map((m) => `${m.pedido}${m.otherLocs.length ? ` (${m.otherLocs.join(', ')})` : ''} — ${m.reasons.join(', ')}`).join(' • ')}
                </div>
              </div>
            </div>
          )}

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
            {orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="bg-gray-50 p-4 rounded-full mb-4">
                  <Package className="h-8 w-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900">Nenhum pedido disponível</h3>
                <p className="text-gray-500 mt-1 max-w-sm">Todos os pedidos já foram roteirizados ou não há retornos/importações recentes.</p>
              </div>
            ) : (
              <table className="min-w-max w-full text-sm divide-y divide-gray-100">
                <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-4 py-3 w-10 text-left"></th>
                    {columnsConf.filter(c => c.visible).map(c => (
                      <th
                        key={c.id}
                        onClick={() => {
                          if (sortColumn === c.id) {
                            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
                          } else {
                            setSortColumn(c.id);
                            // Default directions: Dates -> desc, Text -> asc
                            const isDate = ['data', 'previsaoEntrega'].includes(c.id);
                            setSortDirection(isDate ? 'desc' : 'asc');
                          }
                        }}
                        className="px-4 py-3 text-left font-semibold text-gray-600 uppercase text-xs tracking-wider cursor-pointer hover:bg-gray-100 transition-colors select-none"
                      >
                        <div className="flex items-center gap-1">
                          {c.label}
                          {sortColumn === c.id ? (
                            sortDirection === 'asc' ? <ArrowUp className="h-3 w-3 text-blue-600" /> : <ArrowDown className="h-3 w-3 text-blue-600" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 text-gray-300 opacity-0 group-hover:opacity-100" />
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {/* Reuse the massive mapping logic here but cleaner */}
                  {sortedRows.map(({ order: o, item: it, values }, idx) => {
                    const isSelected = selectedOrders.has(o.id);
                    const raw: any = o.raw_json || {};
                    const obsIntLower = String(o.observacoes_internas || raw.observacoes_internas || '').toLowerCase();
                    const obsLower = String(o.observacoes || raw.observacoes || '').toLowerCase();
                    const temFreteFull = hasFreteFull(o);
                    const hasAssembly = isTrueGlobal(it?.has_assembly) || obsIntLower.includes('*montagem*');

                    // Flags Logic
                    const isReturned = Boolean(o.return_flag) || String(o.status) === 'returned';
                    const returnReason = (o.last_return_reason || (raw as any).return_reason || '') as string;
                    const returnNotes = (o.last_return_notes || (raw as any).return_notes || '') as string;
                    const returnTitle = [returnReason, returnNotes].filter(Boolean).join(' • ');

                    const waLink = (() => {
                      const p = String(o.phone || '').replace(/\D/g, '');
                      const e164 = p ? (p.startsWith('55') ? p : '55' + p) : '';
                      return e164 ? `https://wa.me/${e164}` : '';
                    })();

                    const getPrazoStatusForOrder = (ord: any) => {
                      const p = ord.previsao_entrega || ord.raw_json?.previsao_entrega || ord.raw_json?.data_prevista_entrega;
                      if (!p) return 'none';
                      const today = new Date().toISOString().slice(0, 10);
                      try {
                        const pd = new Date(p).toISOString().slice(0, 10);
                        return pd < today ? 'out' : 'within';
                      } catch { return 'none'; }
                    };

                    return (
                      <tr
                        key={`${o.id}-${it.sku}-${idx}`}
                        className={`group hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50/60 hover:bg-blue-100/50' : ''}`}
                      >
                        <td
                          className="px-4 py-3 cursor-pointer"
                          onClick={() => toggleOrderSelection(o.id)}
                        >
                          <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'}`}>
                            {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
                          </div>
                        </td>
                        {columnsConf.filter(c => c.visible).map(c => (
                          <td
                            key={c.id}
                            className={`px-4 py-3 text-gray-700 ${['obsPublicas', 'obsInternas', 'endereco', 'outrosLocs'].includes(c.id)
                              ? 'min-w-[200px] max-w-[300px] whitespace-normal leading-relaxed text-xs'
                              : 'whitespace-nowrap'
                              }`}
                          >
                            {c.id === 'telefone' ? (
                              <div className="flex items-center gap-2">
                                {waLink && (
                                  <a href={waLink} target="_blank" rel="noreferrer" className="p-1 rounded text-green-600 hover:bg-green-50" title="Abrir WhatsApp">
                                    <MessageCircle className="h-4 w-4" />
                                  </a>
                                )}
                                <span>{values?.[c.id] || '-'}</span>
                              </div>
                            ) : c.id === 'flags' ? (
                              <div className="flex items-center gap-2">
                                {isReturned && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 border border-red-200" title={returnTitle || 'Pedido retornado'}>
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                    Retornado
                                    {returnReason ? ` · ${returnReason}` : ''}
                                  </span>
                                )}
                                {o.service_type === 'troca' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-800 border border-orange-200 uppercase tracking-wide" title="Pedido de Troca">
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    Troca
                                  </span>
                                )}
                                {o.service_type === 'assistencia' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200 uppercase tracking-wide" title="Pedido de Assistência">
                                    <Wrench className="h-3.5 w-3.5" />
                                    Assistência
                                  </span>
                                )}
                                {hasAssembly && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700 border border-orange-200" title="Produto com montagem">
                                    <Hammer className="h-3.5 w-3.5" />
                                    Montagem
                                  </span>
                                )}
                                {temFreteFull && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800 border border-yellow-200" title="Frete Full">
                                    <Zap className="h-3.5 w-3.5" />
                                    Full
                                  </span>
                                )}
                                {obsIntLower.includes('*retirada*') && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200" title="Retirada em Loja/Fábrica">
                                    <Store className="h-3.5 w-3.5" />
                                    Retirada
                                  </span>
                                )}
                                {(() => {
                                  const st = getPrazoStatusForOrder(o);
                                  const cls = st === 'within' ? 'bg-green-100 text-green-800 border-green-200' : st === 'out' ? 'bg-red-100 text-red-800 border-red-200' : 'bg-gray-100 text-gray-700 border-gray-200';
                                  const label = st === 'within' ? 'Dentro do prazo' : st === 'out' ? 'Fora do prazo' : 'Sem previsão';
                                  return (
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}`} title="Prazo vs previsão">
                                      <Calendar className="h-3.5 w-3.5" />
                                      {label}
                                    </span>
                                  );
                                })()}
                              </div>
                            ) : c.id === 'produto' ? (
                              <div className="flex items-center gap-2">
                                <span className="truncate max-w-[420px]">{values?.[c.id]}</span>
                              </div>
                            ) : (
                              values?.[c.id] || '-'
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Routes List Section */}
        <div ref={routesSectionRef} className="space-y-4">
          {/* FILTERS BAR */}
          <div className="flex flex-col md:flex-row gap-6 justify-between items-start md:items-center bg-gray-50 px-6 py-4 rounded-xl border border-gray-100">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Período</label>
              <div className="flex items-center gap-2">
                {[
                  { id: 'today', label: 'Hoje' },
                  { id: 'yesterday', label: 'Ontem' },
                  { id: 'last7', label: '7 Dias' },
                  { id: 'all', label: 'Tudo' }
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setDateFilter(opt.id as any)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${dateFilter === opt.id
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                      }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Status</label>
              <div className="flex items-center gap-2 flex-wrap">
                {[
                  { id: 'pending', label: 'Em Separação', color: 'text-yellow-700 bg-yellow-50 border-yellow-200' },
                  { id: 'in_progress', label: 'Em Rota', color: 'text-blue-700 bg-blue-50 border-blue-200' },
                  { id: 'completed', label: 'Finalizada', color: 'text-green-700 bg-green-50 border-green-200' }
                ].map(opt => {
                  const isActive = statusFilter.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        setStatusFilter(prev =>
                          prev.includes(opt.id)
                            ? prev.filter(p => p !== opt.id)
                            : [...prev, opt.id]
                        );
                      }}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors flex items-center gap-1.5 ${isActive
                        ? `ring-2 ring-offset-1 ring-blue-500 ${opt.color}`
                        : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 grayscale opacity-70 hover:grayscale-0 hover:opacity-100'
                        }`}
                    >
                      {isActive && <CheckCircle2 className="h-3 w-3" />}
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Buscar Rota</label>
              <div className="relative">
                <Search className="absolute left-3 top-2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={routeSearchQuery}
                  onChange={(e) => setRouteSearchQuery(e.target.value)}
                  placeholder="Nome, motorista ou ID da rota..."
                  className="pl-9 pr-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all w-72"
                />
              </div>
            </div>
          </div>


          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 pb-2">
            <div className="flex items-center gap-1 bg-gray-100/80 p-1 rounded-xl flex-wrap">
              <button
                onClick={() => setActiveRoutesTab('deliveries')}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${activeRoutesTab === 'deliveries' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <Truck className="h-4 w-4" />
                Rotas de Entrega
              </button>
              <button
                onClick={() => setActiveRoutesTab('pickups')}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${activeRoutesTab === 'pickups' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <Store className="h-4 w-4" />
                Retiradas em Loja
              </button>
              <button
                onClick={() => setActiveRoutesTab('blocked')}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${activeRoutesTab === 'blocked' ? 'bg-white shadow-sm text-red-700' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <Ban className="h-4 w-4" />
                Bloqueados
                {blockedOrders.length > 0 && (
                  <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">{blockedOrders.length}</span>
                )}
              </button>
              <button
                onClick={() => setActiveRoutesTab('pickupOrders')}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${activeRoutesTab === 'pickupOrders' ? 'bg-white shadow-sm text-orange-700' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <PackageX className="h-4 w-4" />
                Coletas Pendentes
                {pickupPendingOrders.length > 0 && (
                  <span className="bg-orange-500 text-white text-xs px-1.5 py-0.5 rounded-full">{pickupPendingOrders.length}</span>
                )}
              </button>
              <button
                onClick={() => setActiveRoutesTab('pickupRoutes')}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${activeRoutesTab === 'pickupRoutes' ? 'bg-white shadow-sm text-teal-700' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <Replace className="h-4 w-4" />
                Rotas de Coleta
              </button>
            </div>

            {(() => {
              let count = 0;
              if (activeRoutesTab === 'deliveries' || activeRoutesTab === 'pickups' || activeRoutesTab === 'pickupRoutes') {
                const filtered = routesList.filter(r => {
                  const name = String(r.name || '');
                  const isRetirada = name.startsWith('RETIRADA');
                  const isColeta = name.startsWith('COLETA-');

                  if (activeRoutesTab === 'pickups') return isRetirada;
                  if (activeRoutesTab === 'pickupRoutes') return isColeta;
                  return !isRetirada && !isColeta;
                });
                count = filtered.length;
              } else if (activeRoutesTab === 'blocked') {
                count = blockedOrders.length;
              } else if (activeRoutesTab === 'pickupOrders') {
                count = pickupPendingOrders.length;
              }
              return (
                <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-xs font-bold self-start sm:self-center">
                  {count} registros
                </span>
              );
            })()}
          </div>

          {/* Conteúdo condicional baseado na aba ativa */}
          {(activeRoutesTab === 'deliveries' || activeRoutesTab === 'pickups' || activeRoutesTab === 'pickupRoutes') && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredRoutesList.length === 0 ? (
                <div className="col-span-full bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
                  <div className="mx-auto w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                    {activeRoutesTab === 'pickups' ? <Store className="h-8 w-8 text-gray-400" /> :
                      activeRoutesTab === 'pickupRoutes' ? <Replace className="h-8 w-8 text-gray-400" /> : <Truck className="h-8 w-8 text-gray-400" />}
                  </div>
                  <h3 className="text-lg font-medium text-gray-900">Nenhum registro encontrado</h3>
                  <p className="text-gray-500">
                    {activeRoutesTab === 'pickups' ? 'Nenhuma retirada registrada recentemente.' :
                      activeRoutesTab === 'pickupRoutes' ? 'Nenhuma rota de coleta registrada recentemente.' : 'Crie sua primeira rota selecionando pedidos acima.'}
                  </p>
                </div>
              ) : (
                filteredRoutesList.map(route => {
                  const total = route.route_orders?.length || 0;
                  const pending = route.route_orders?.filter(r => r.status === 'pending').length || 0;
                  const delivered = route.route_orders?.filter(r => r.status === 'delivered').length || 0;
                  const returned = route.route_orders?.filter(r => r.status === 'returned').length || 0;

                  const statusColors = {
                    pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
                    in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
                    completed: 'bg-green-50 text-green-700 border-green-200'
                  };
                  const statusLabel = {
                    pending: 'Em Separação',
                    in_progress: 'Em Rota',
                    completed: 'Finalizada'
                  };

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
                            {(() => {
                              const conf: any = (route as any).conference;
                              const cStatus = String(conf?.status || '').toLowerCase();
                              const ok = conf?.result_ok === true || cStatus === 'completed';
                              const badgeClass = ok
                                ? 'bg-green-50 text-green-700 border-green-200'
                                : (cStatus === 'in_progress' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200');
                              const label = ok ? 'Conferência: Finalizada' : (cStatus === 'in_progress' ? 'Conferência: Em curso' : 'Conferência: Aguardando');
                              return (
                                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border inline-flex items-center gap-1 ${badgeClass}`} title="Status de conferência">
                                  {ok ? <ClipboardCheck className="h-3 w-3" /> : <ClipboardList className="h-3 w-3" />}
                                  {label}
                                </span>
                              );
                            })()}
                          </div>
                        </div>

                        <div className="space-y-3 mb-6">
                          {/* Para retiradas: mostrar conferente como Responsável, esconder motorista e veículo */}
                          {(() => {
                            const isPickupRoute = String(route.name || '').startsWith('RETIRADA');

                            if (isPickupRoute) {
                              return (
                                <div className="flex items-center text-sm text-gray-600">
                                  <ClipboardList className="h-4 w-4 mr-2 text-gray-400" />
                                  <span className="font-medium text-purple-700">Responsável:</span>&nbsp;
                                  {String((route as any)?.conferente || '').trim() || 'Não informado'}
                                </div>
                              );
                            }

                            // Para rotas normais de entrega
                            return (
                              <>
                                <div className="flex items-center text-sm text-gray-600">
                                  <User className="h-4 w-4 mr-2 text-gray-400" />
                                  {(route as any)?.driver_name || (route as any)?.driver?.user?.name || (route as any)?.driver?.name || 'Sem motorista'}
                                </div>
                                <div className="flex items-center text-sm text-gray-600">
                                  <ClipboardList className="h-4 w-4 mr-2 text-gray-400" />
                                  {String((route as any)?.conferente || '').trim() || 'Sem conferente'}
                                </div>
                                <div className="flex items-center text-sm text-gray-600">
                                  <Truck className="h-4 w-4 mr-2 text-gray-400" />
                                  {route.vehicle ? `${route.vehicle.model} (${route.vehicle.plate})` : 'Sem veículo'}
                                </div>
                              </>
                            );
                          })()}
                        </div>

                        {/* Mini Stats */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                          <div className="bg-gray-50 rounded-lg p-2 text-center">
                            <span className="block text-lg font-bold text-gray-900">{total}</span>
                            <span className="text-[10px] uppercase text-gray-500 font-bold">Total</span>
                          </div>
                          <div className="bg-blue-50 rounded-lg p-2 text-center">
                            <span className="block text-lg font-bold text-blue-700">{delivered}</span>
                            <span className="text-[10px] uppercase text-blue-600 font-bold">Entregues</span>
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
                          onClick={async () => {
                            const toastId = toast.loading('Carregando detalhes da rota...');
                            try {
                              // Fetch Full Route Details On-Demand
                              const { data, error } = await supabase
                                .from('routes')
                                .select(`*, driver:drivers!driver_id(*, user:users!user_id(*)), vehicle:vehicles!vehicle_id(*), route_orders(*, order:orders!order_id(*))`)
                                .eq('id', route.id)
                                .single();

                              if (error) throw error;

                              // Sort route orders by sequence manually since nested ordering can be tricky
                              if (data && data.route_orders) {
                                (data.route_orders as any[]).sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

                                // Enrich conference if needed (though main query didn't fetch it here, let's keep it simple or fetch if missing)
                                // Actually the list route object has 'conferences' property populated from the list query.
                                // We should merge or preserve it, OR fetch it again. 
                                // The best way is to fetch it again or merge. 
                                // For simplicity/speed, let's just fetch it in the query above if we can, or just omit if not critical for modal?
                                // Modal likely uses conference status. 
                                // Let's adding conferences to the query above.
                              }

                              // Re-fetch conference specifically to be safe
                              const { data: confData } = await supabase.from('route_conferences').select('*').eq('route_id', route.id).order('created_at', { ascending: false }).limit(1).maybeSingle();

                              const finalRoute = { ...data, conference: confData || null };

                              selectedRouteIdRef.current = String(route.id);
                              localStorage.setItem('rc_selectedRouteId', String(route.id));
                              setSelectedRoute(finalRoute as any);
                              showRouteModalRef.current = true;
                              localStorage.setItem('rc_showRouteModal', '1');
                              setShowRouteModal(true);
                              toast.dismiss(toastId);
                            } catch (err) {
                              console.error(err);
                              toast.error('Erro ao carregar detalhes da rota', { id: toastId });
                            }
                          }}
                          className="flex-1 inline-flex items-center justify-center px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                        >
                          <Eye className="h-4 w-4 mr-2" /> Detalhes
                        </button>
                      </div>
                    </div>
                  );
                })
              )}


              {/* Load More Button */}
              {(activeRoutesTab === 'deliveries' || activeRoutesTab === 'pickups' || activeRoutesTab === 'pickupRoutes') && hasMoreRoutes && filteredRoutesList.length > 0 && (
                <div className="col-span-full flex justify-center mt-4">
                  <button
                    onClick={() => fetchRoutes(false)}
                    className="px-6 py-2 bg-white border border-gray-300 rounded-full shadow-sm text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors flex items-center gap-2"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
                    Carregar Mais Rotas
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Aba: Pedidos Bloqueados */}
          {activeRoutesTab === 'blocked' && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {blockedOrders.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="mx-auto w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-4">
                    <CheckCircle2 className="h-8 w-8 text-green-500" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900">Nenhum pedido bloqueado</h3>
                  <p className="text-gray-500">Todos os pedidos estão disponíveis para roteamento.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Pedido</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Cliente</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Status ERP</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Motivo</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Data Bloqueio</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">NF Devolução</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {blockedOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{order.order_id_erp}</td>
                          <td className="px-4 py-3 text-gray-600">{order.customer_name}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${order.erp_status === 'devolvido' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                              }`}>
                              {order.erp_status?.toUpperCase() || '-'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-600 text-sm">{order.blocked_reason || '-'}</td>
                          <td className="px-4 py-3 text-gray-500 text-sm">
                            {order.blocked_at ? new Date(order.blocked_at).toLocaleString('pt-BR') : '-'}
                          </td>
                          <td className="px-4 py-3 text-gray-600">{order.return_nfe_number || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Aba: Coletas Pendentes */}
          {activeRoutesTab === 'pickupOrders' && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {pickupPendingOrders.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="mx-auto w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-4">
                    <CheckCircle2 className="h-8 w-8 text-green-500" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900">Nenhuma coleta pendente</h3>
                  <p className="text-gray-500">Não há pedidos aguardando coleta no momento.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Pedido</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Cliente</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Endereço</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">NF Devolução</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Data Devolução</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pickupPendingOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{order.order_id_erp}</td>
                          <td className="px-4 py-3 text-gray-600">{order.customer_name}</td>
                          <td className="px-4 py-3 text-gray-600 text-sm">
                            {order.address_json?.street}, {order.address_json?.neighborhood} - {order.address_json?.city}
                          </td>
                          <td className="px-4 py-3">
                            <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded-full text-xs font-bold">
                              NF {order.return_nfe_number || '-'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-sm">
                            {order.return_date ? new Date(order.return_date).toLocaleDateString('pt-BR') : '-'}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => {
                                setSelectedPickupOrder(order);
                                setPickupOrderConferente('');
                                setPickupOrderObservations('');
                                setShowPickupOrderModal(true);
                              }}
                              className="inline-flex items-center px-3 py-1.5 bg-orange-500 text-white text-xs font-bold rounded-lg hover:bg-orange-600 transition-colors"
                            >
                              <PackageX className="h-3 w-3 mr-1" />
                              Criar Coleta
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

      </div>

      {/* --- MODALS --- */}

      {/* Modal de Coleta de Devolução */}
      {showPickupOrderModal && selectedPickupOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-orange-50">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <PackageX className="h-5 w-5 text-orange-600" />
                  Criar Coleta de Devolução
                </h3>
                <p className="text-sm text-gray-500 mt-1">Pedido #{selectedPickupOrder.order_id_erp}</p>
              </div>
              <button
                onClick={() => { setShowPickupOrderModal(false); setSelectedPickupOrder(null); }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Info do Pedido */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Cliente:</span>
                  <span className="text-sm font-medium text-gray-900">{selectedPickupOrder.customer_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Endereço:</span>
                  <span className="text-sm text-gray-900">
                    {selectedPickupOrder.address_json?.street}, {selectedPickupOrder.address_json?.neighborhood}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">NF Devolução:</span>
                  <span className="text-sm font-bold text-blue-600">{selectedPickupOrder.return_nfe_number || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Motivo:</span>
                  <span className="text-sm text-red-600">{selectedPickupOrder.blocked_reason || '-'}</span>
                </div>
              </div>

              {/* Seleção de Equipe (Substitui motorista fixo) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Equipe de Coleta *
                </label>
                <select
                  value={pickupTeam}
                  onChange={(e) => setPickupTeam(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all"
                >
                  <option value="">Selecione a equipe...</option>
                  {teams.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">Motorista e ajudante serão definidos automaticamente pela equipe.</p>
              </div>

              {/* Conferente */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Conferente (Opcional)
                </label>
                <select
                  value={pickupOrderConferente}
                  onChange={(e) => setPickupOrderConferente(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all"
                >
                  <option value="">Selecione...</option>
                  {conferentes.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Observações */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Observações (opcional)
                </label>
                <textarea
                  value={pickupOrderObservations}
                  onChange={(e) => setPickupOrderObservations(e.target.value)}
                  placeholder="Ex: Entrar em contato antes de ir..."
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all resize-none"
                  rows={3}
                />
              </div>

              {/* Info sobre DANFE */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
                <Info className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-700">
                  <p className="font-medium">Nota Fiscal de Devolução</p>
                  <p className="text-blue-600">O sistema irá gerar automaticamente a DANFE de devolução para ser levada na coleta.</p>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => { setShowPickupOrderModal(false); setSelectedPickupOrder(null); }}
                className="px-4 py-2 text-gray-700 font-medium rounded-lg hover:bg-gray-100 transition-colors"
                disabled={pickupOrderLoading}
              >
                Cancelar
              </button>
              <button
                onClick={createPickupOrder}
                disabled={pickupOrderLoading || !pickupOrderConferente}
                className="px-6 py-2 bg-orange-600 text-white font-bold rounded-lg hover:bg-orange-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pickupOrderLoading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Criando...
                  </>
                ) : (
                  <>
                    <PackageX className="h-4 w-4" />
                    Criar Coleta
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Route Modal */}
      {
        showCreateModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 flex-shrink-0">
                <h3 className="text-lg font-bold text-gray-900">Nova Rota / Romaneio</h3>
                <button onClick={() => { setShowCreateModal(false); showCreateModalRef.current = false; localStorage.setItem('rc_showCreateModal', '0'); }} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
              </div>
              <div className="p-6 space-y-6 overflow-y-auto flex-1">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Adicionar a romaneio existente?</label>
                  <select
                    value={selectedExistingRouteId}
                    onChange={(e) => setSelectedExistingRouteId(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  >
                    <option value="">Não, criar novo romaneio</option>
                    {routesList.filter(r => r.status === 'pending').map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>

                {!selectedExistingRouteId && (
                  <div className="space-y-4">
                    {/* Team Selection */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Equipe (Opcional)</label>
                      <select
                        value={selectedTeam}
                        onChange={async (e) => {
                          const tid = e.target.value;
                          setSelectedTeam(tid);
                          if (tid) {
                            const t = teams.find(x => String(x.id) === String(tid));
                            if (t) {
                              console.log('Select Team Change:', t);
                              // teams_user has driver_user_id (users.id) and helper_user_id (users.id)
                              // But driver dropdown expects drivers.id, so we need to convert
                              if (t.driver_user_id) {
                                // Find the driver record that corresponds to this user_id
                                console.log('Looking for driver with user_id:', t.driver_user_id);
                                const driver = drivers.find(d => String(d.user_id) === String(t.driver_user_id));
                                if (driver) {
                                  console.log('Found Driver:', driver);
                                  setSelectedDriver(String(driver.id));
                                } else {
                                  console.warn('Driver not found for user_id:', t.driver_user_id);
                                }
                              }
                              // Helper uses user.id directly (no conversion needed)
                              if (t.helper_user_id) setSelectedHelper(String(t.helper_user_id));
                            }
                          } else {
                            setSelectedHelper('');
                          }
                        }}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      >
                        <option value="">Sem equipe definida (Avulso)</option>
                        {teams.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Nome da Rota <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        value={routeName}
                        onChange={(e) => setRouteName(e.target.value)}
                        placeholder="Ex: Rota Zona Sul - Manhã"
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Motorista <span className="text-red-500">*</span></label>
                        <select
                          value={selectedDriver}
                          onChange={(e) => setSelectedDriver(e.target.value)}
                          disabled={!!selectedTeam}
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <option value="">Selecione...</option>
                          {drivers.map(d => <option key={d.id} value={d.id}>{d.user?.name || d.name || d.id}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Ajudante</label>
                        <div className="relative">
                          <select
                            value={selectedHelper}
                            onChange={(e) => setSelectedHelper(e.target.value)}
                            disabled={!!selectedTeam}
                            className={`w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all ${!!selectedTeam ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-gray-50'} disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            <option value="">Sem ajudante</option>
                            {helpers.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                          </select>
                          {selectedTeam && <Info className="absolute right-3 top-3.5 h-4 w-4 text-gray-400" />}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Veículo <span className="text-red-500">*</span></label>
                        <select
                          value={selectedVehicle}
                          onChange={(e) => setSelectedVehicle(e.target.value)}
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                        >
                          <option value="">Selecione...</option>
                          {vehicles.map(v => <option key={v.id} value={v.id}>{v.model} - {v.plate}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Conferente <span className="text-red-500">*</span></label>
                      <select
                        value={conferente}
                        onChange={(e) => setConferente(e.target.value)}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      >
                        <option value="">Selecione...</option>
                        {conferentes.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                <div className="bg-blue-50 p-4 rounded-xl flex items-center justify-between">
                  <span className="text-blue-900 font-medium">Pedidos Selecionados</span>
                  <span className="bg-blue-200 text-blue-800 px-3 py-1 rounded-lg font-bold">{selectedOrders.size}</span>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 flex-shrink-0">
                <button onClick={() => setShowCreateModal(false)} className="px-6 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-white transition-colors">Cancelar</button>
                <button
                  onClick={() => createRoute()}
                  disabled={saving || (!selectedExistingRouteId && (!routeName || !selectedDriver || !selectedVehicle || !conferente))}
                  className="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 disabled:opacity-50 disabled:shadow-none transition-all transform active:scale-95"
                >
                  {saving ? 'Salvando...' : 'Confirmar Rota'}
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* --- LAUNCH AVULSO MODAL --- */}
      {
        showLaunchModal && (
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
                        <Hammer className="h-5 w-5" />
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
        )
      }

      {/* --- PICKUP MODAL --- */}
      {
        showPickupModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Store className="h-5 w-5 text-purple-600" />
                  Registrar Retirada
                </h3>
                <button onClick={() => setShowPickupModal(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm text-gray-600 bg-purple-50 p-3 rounded-lg border border-purple-100">
                  Você está prestes a marcar <strong>{selectedOrders.size}</strong> pedido(s) como <strong>RETIRADO</strong>.
                  Isso baixará os pedidos do sistema imediatamente e gerará um comprovante.
                </p>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Responsável pela Entrega *</label>
                  <select
                    value={pickupConferente}
                    onChange={e => setPickupConferente(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none bg-white"
                    autoFocus
                  >
                    <option value="">Selecione o conferente...</option>
                    {conferentes.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Quem entregou a mercadoria ao cliente na loja</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Observações (Opcional)</label>
                  <textarea
                    value={pickupObservations}
                    onChange={e => setPickupObservations(e.target.value)}
                    placeholder="Ex: Cliente conferiu mercadoria no local."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none h-24 resize-none"
                  />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                <button onClick={() => setShowPickupModal(false)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-white transition-colors">Cancelar</button>
                <button
                  onClick={createPickup}
                  disabled={pickupSaving}
                  className="px-6 py-2 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-700 shadow-md transition-all flex items-center gap-2"
                >
                  {pickupSaving && <RefreshCw className="animate-spin h-4 w-4" />}
                  Confirmar Retirada
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* --- PICKUP MODAL --- */}
      {
        showPickupModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Store className="h-5 w-5 text-purple-600" />
                  Registrar Retirada
                </h3>
                <button onClick={() => setShowPickupModal(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm text-gray-600 bg-purple-50 p-3 rounded-lg border border-purple-100">
                  Você está prestes a marcar <strong>{selectedOrders.size}</strong> pedido(s) como <strong>RETIRADO</strong>.
                  Isso baixará os pedidos do sistema imediatamente e gerará um comprovante.
                </p>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Responsável pela Entrega *</label>
                  <select
                    value={pickupConferente}
                    onChange={e => setPickupConferente(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none bg-white"
                    autoFocus
                  >
                    <option value="">Selecione o conferente...</option>
                    {conferentes.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Quem entregou a mercadoria ao cliente na loja</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Observações (Opcional)</label>
                  <textarea
                    value={pickupObservations}
                    onChange={e => setPickupObservations(e.target.value)}
                    placeholder="Ex: Cliente conferiu mercadoria no local."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none h-24 resize-none"
                  />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                <button onClick={() => setShowPickupModal(false)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-white transition-colors">Cancelar</button>
                <button
                  onClick={createPickup}
                  disabled={pickupSaving}
                  className="px-6 py-2 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-700 shadow-md transition-all flex items-center gap-2"
                >
                  {pickupSaving && <RefreshCw className="animate-spin h-4 w-4" />}
                  Confirmar Retirada
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Columns Modal */}
      {
        showColumnsModal && (
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
                      const success = await saveUserPreference(authUser.id, 'rc_columns_conf', columnsConf);
                      if (success) {
                        toast.success('Configuração de colunas salva com sucesso!');
                      } else {
                        toast.error('Erro ao salvar configuração. Tente novamente.');
                      }
                    } else {
                      // Fallback to localStorage if not authenticated
                      localStorage.setItem('rc_columns_conf', JSON.stringify(columnsConf));
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
        )
      }

      {/* Conference Review Modal */}
      {
        showConferenceModal && conferenceRoute && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden">
              <div className="px-6 py-4 border-b flex items-center justify-between bg-gray-50">
                <h4 className="text-lg font-bold text-gray-900">Revisão de Conferência — {conferenceRoute.name}</h4>
                <button onClick={() => setShowConferenceModal(false)} className="text-gray-500 hover:text-gray-700"><X className="h-5 w-5" /></button>
              </div>
              <div className="p-6 overflow-y-auto flex-1">
                {(() => {
                  const conf = (conferenceRoute as any).conference;
                  const missing: Array<{ code: string; orderId?: string }> = conf?.summary?.missing || [];
                  const notBiped: Array<{ orderId?: string; productCode?: string; reason?: string; notes?: string }> = conf?.summary?.notBipedProducts || [];
                  const byOrder: Record<string, { codes: string[], order: any }> = {};
                  (conferenceRoute.route_orders || []).forEach((ro: any) => {
                    byOrder[String(ro.order_id)] = byOrder[String(ro.order_id)] || { codes: [], order: ro.order };
                  });
                  missing.forEach((m) => {
                    const k = String(m.orderId || '');
                    if (!byOrder[k]) byOrder[k] = { codes: [], order: null } as any;
                    byOrder[k].codes.push(m.code);
                  });
                  const byOrderProducts: Record<string, Array<{ productCode?: string; reason?: string; notes?: string }>> = {};
                  notBiped.forEach((p) => {
                    const k = String(p.orderId || '');
                    byOrderProducts[k] = byOrderProducts[k] || [];
                    byOrderProducts[k].push({ productCode: p.productCode, reason: p.reason, notes: p.notes });
                  });
                  const authUser = useAuthStore.getState().user;
                  const markResolved = async (removedIds: string[]) => {
                    try {
                      if (!conf?.id) { toast.error('Conferência não encontrada'); return; }
                      const resolutionPayload = { removedOrderIds: removedIds, missingLabelsByOrder: Object.keys(byOrder).reduce((acc: any, k) => { if ((byOrder[k]?.codes || []).length > 0) acc[k] = byOrder[k].codes; return acc; }, {}), notBipedByOrder: byOrderProducts };
                      const { error: updErr } = await supabase
                        .from('route_conferences')
                        .update({ resolved_at: new Date().toISOString(), resolved_by: authUser?.id || null, resolution: resolutionPayload })
                        .eq('id', conf.id);
                      if (updErr) throw updErr;
                      toast.success('Divergência marcada como resolvida');
                      setShowConferenceModal(false);
                      loadData();
                    } catch (e: any) {
                      console.error(e);
                      toast.error('Erro ao marcar divergência como resolvida');
                    }
                  };
                  const orderIds = Object.keys(byOrder).filter(k => byOrder[k].codes.length > 0);
                  if (orderIds.length === 0) {
                    const pIds = Object.keys(byOrderProducts).filter(k => (byOrderProducts[k] || []).length > 0);
                    if (pIds.length === 0) return <div className="text-center py-8 text-gray-500 font-medium">Sem faltantes. Conferência OK.</div>;
                    return (
                      <div className="space-y-4">
                        {pIds.map((oid) => {
                          const info = byOrder[String(oid)] || { order: null, codes: [] } as any;
                          const cliente = info.order?.customer_name || '—';
                          const pedido = info.order?.order_id_erp || '—';
                          const products = byOrderProducts[oid] || [];
                          return (
                            <div key={oid} className="border rounded-lg overflow-hidden">
                              <div className="px-4 py-2 bg-gray-50 border-b flex justify-between items-center">
                                <div>
                                  <span className="font-bold text-gray-900">Pedido: {pedido}</span>
                                  <span className="mx-2 text-gray-400">|</span>
                                  <span className="text-gray-700">{cliente}</span>
                                </div>
                              </div>
                              <div className="p-4 bg-white">
                                <div className="text-sm font-bold text-red-600 mb-2">Produtos não bipados ({products.length}):</div>
                                <ul className="space-y-2">
                                  {products.map((p, idx) => (
                                    <li key={idx} className="text-sm text-gray-700 bg-red-50 p-2 rounded border border-red-100">
                                      <span className="font-semibold">Produto:</span> {p.productCode || '—'} • <span className="font-semibold">Motivo:</span> {p.reason || '—'} {p.notes ? `• ${p.notes}` : ''}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          );
                        })}
                        <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
                          <button
                            onClick={async () => {
                              try {
                                const ids = pIds.filter(Boolean);
                                if (ids.length === 0) return;
                                const rid = String(conferenceRoute.id);
                                const { error: delErr } = await supabase.from('route_orders').delete().eq('route_id', rid).in('order_id', ids);
                                if (delErr) throw delErr;
                                const { error: updErr } = await supabase.from('orders').update({ status: 'pending' }).in('id', ids);
                                if (updErr) throw updErr;
                                toast.success('Pedidos removidos da rota');
                                setShowConferenceModal(false);
                                loadData();
                              } catch (e: any) {
                                toast.error('Erro ao remover pedidos da rota');
                              }
                            }}
                            className="px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg font-medium transition-colors"
                          >Remover pedidos não bipados</button>
                          <button
                            onClick={() => { const ids = pIds.filter(Boolean); markResolved(ids); }}
                            className="px-4 py-2 bg-teal-600 text-white hover:bg-teal-700 rounded-lg font-medium shadow-sm transition-colors"
                          >Resolver Divergência</button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-4">
                      {orderIds.map((oid) => {
                        const info = byOrder[oid];
                        const cliente = info.order?.customer_name || '—';
                        const pedido = info.order?.order_id_erp || '—';
                        return (
                          <div key={oid} className="border rounded-lg overflow-hidden">
                            <div className="px-4 py-2 bg-gray-50 border-b">
                              <div className="font-bold text-gray-900">Pedido: {pedido} • {cliente}</div>
                            </div>
                            <div className="p-4 bg-white">
                              <div className="text-sm font-bold text-red-600 mb-2">Volumes faltantes ({info.codes.length}):</div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                {info.codes.map((c, idx) => (
                                  <div key={`${c}-${idx}`} className="text-xs px-2 py-1.5 rounded bg-red-50 text-red-700 border border-red-100 font-mono text-center">{c}</div>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
                        <button
                          onClick={async () => {
                            try {
                              const ids = orderIds.filter(Boolean);
                              if (ids.length === 0) return;
                              const rid = String(conferenceRoute.id);
                              const { error: delErr } = await supabase.from('route_orders').delete().eq('route_id', rid).in('order_id', ids);
                              if (delErr) throw delErr;
                              const { error: updErr } = await supabase.from('orders').update({ status: 'pending' }).in('id', ids);
                              if (updErr) throw updErr;
                              toast.success('Pedidos faltantes removidos da rota');
                              setShowConferenceModal(false);
                              loadData();
                            } catch (e: any) {
                              toast.error('Erro ao remover pedidos da rota');
                            }
                          }}
                          className="px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg font-medium transition-colors"
                        >Remover pedidos faltantes</button>
                        <button
                          onClick={() => { const ids = orderIds.filter(Boolean); markResolved(ids); }}
                          className="px-4 py-2 bg-teal-600 text-white hover:bg-teal-700 rounded-lg font-medium shadow-sm transition-colors"
                        >Resolver Divergência</button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )
      }

      {/* Route Details Modal */}

      {
        showRouteModal && selectedRoute && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in zoom-in-95 duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
              {/* Re-implementing the header and actions cleanly */}
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {isEditingRoute ? (
                      <div className="w-full max-w-md">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Nome da Rota</label>
                        <input
                          type="text"
                          value={editRouteName}
                          onChange={(e) => setEditRouteName(e.target.value)}
                          className="w-full text-lg font-bold border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 px-3 py-1"
                        />
                      </div>
                    ) : (
                      <h2 className="text-xl font-bold text-gray-900">
                        {selectedRoute.name}
                        {(selectedRoute as any).route_code && (
                          <span className="ml-2 px-2 py-0.5 bg-gray-100 text-gray-600 text-sm font-mono rounded">
                            {(selectedRoute as any).route_code}
                          </span>
                        )}
                        <span className={`ml-3 text-sm px-2 py-1 rounded-full ${selectedRoute.status === 'completed' ? 'bg-green-100 text-green-700' :
                          selectedRoute.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                          {selectedRoute.status === 'completed' ? 'Concluída' :
                            selectedRoute.status === 'in_progress' ? 'Em Rota' : 'Pendente'}
                        </span>
                      </h2>
                    )}
                  </div>
                  {!isEditingRoute && String(selectedRoute.name || '').startsWith('RETIRADA') && (
                    <p className="text-sm text-gray-500 mt-1">
                      {`Responsável: ${selectedRoute.conferente || 'Não informado'}`}
                    </p>
                  )}
                </div>
                <button onClick={() => { setShowRouteModal(false); setIsEditingRoute(false); showRouteModalRef.current = false; localStorage.setItem('rc_showRouteModal', '0'); }} className="p-2 hover:bg-gray-200 rounded-full text-gray-500"><X className="h-6 w-6" /></button>
              </div>

              {/* Toolbar */}
              <div className="px-6 py-3 border-b border-gray-100 bg-white flex flex-col md:flex-row items-center gap-3">
                {isEditingRoute ? (
                  <div className="flex gap-2 w-full">
                    <button
                      onClick={handleUpdateRoute}
                      className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      <Check className="h-4 w-4 mr-2" />
                      Salvar
                    </button>
                    <button
                      onClick={() => {
                        setIsEditingRoute(false);
                        // Reset optional, useEffect handles re-init or just re-render
                      }}
                      className="flex items-center px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                    >
                      <X className="h-4 w-4 mr-2" />
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 w-full">
                    {selectedRoute.status !== 'completed' && (
                      <button
                        onClick={() => setIsEditingRoute(true)}
                        className="flex items-center px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 border border-blue-200 transition-colors"
                      >
                        <Edit2 className="h-4 w-4 mr-2" />
                        Editar
                      </button>
                    )}

                    {/* Delete Button for Empty Routes */}
                    {(!selectedRoute.route_orders || selectedRoute.route_orders.length === 0) && (
                      <button
                        onClick={async () => {
                          if (confirm('Tem certeza que deseja EXCLUIR esta rota vazia?')) {
                            try {
                              const { error, count } = await supabase.from('routes').delete({ count: 'exact' }).eq('id', selectedRoute.id);
                              if (error) throw error;
                              if (count === 0) {
                                toast.error('Não foi possível excluir. Rota não encontrada ou permissão negada.');
                                return;
                              }
                              toast.success('Rota excluída com sucesso');
                              // Optimistic update: remove from list immediately
                              setRoutesList(prev => prev.filter(r => r.id !== selectedRoute.id));
                              setShowRouteModal(false);
                              loadData();
                            } catch (e: any) {
                              console.error('Erro ao excluir rota:', e);
                              toast.error('Erro ao excluir rota: ' + (e.message || 'Erro desconhecido'));
                            }
                          }
                        }}
                        className="flex items-center px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 border border-red-200 transition-colors"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Excluir
                      </button>
                    )}

                    {/* Custom Buttons for Pickup Routes vs Standard Routes */}
                    {(() => {
                      const isPickup = String(selectedRoute.name || '').startsWith('RETIRADA');

                      if (isPickup) {
                        // --- PICKUP BUTTONS ---
                        return (
                          <>
                            {/* Confirmar Retirada Button */}
                            <button
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (!selectedRoute) return;
                                if (selectedRoute.status === 'completed') return; // Already completed
                                try {
                                  if (confirm('Confirma a retirada destes pedidos? Isso marcará a rota como concluída e os pedidos como entregues.')) {
                                    setSaving(true);

                                    // 1. Update Route Status
                                    const { error: rErr } = await supabase.from('routes').update({ status: 'completed' }).eq('id', selectedRoute.id);
                                    if (rErr) throw rErr;

                                    const now = new Date().toISOString();

                                    // Update route_orders one by one
                                    const routeOrdersToUpdate = selectedRoute.route_orders || [];

                                    for (const ro of routeOrdersToUpdate) {
                                      await supabase
                                        .from('route_orders')
                                        .update({ status: 'delivered', delivered_at: now })
                                        .eq('id', ro.id);
                                    }

                                    // Update orders
                                    const oIds = routeOrdersToUpdate.map((ro: any) => ro.order_id);
                                    if (oIds.length > 0) {
                                      await supabase.from('orders').update({ status: 'delivered' }).in('id', oIds);
                                    }

                                    // 3. Check for assembly products (SAME LOGIC AS DeliveryMarking.tsx)
                                    // This creates assembly_products for orders with has_assembly = 'SIM'
                                    try {
                                      for (const orderId of oIds) {
                                        // Fetch full order data with items_json
                                        const { data: orderData, error: orderError } = await supabase
                                          .from('orders')
                                          .select('id, items_json, customer_name, phone, address_json, order_id_erp')
                                          .eq('id', orderId)
                                          .single();

                                        if (orderError || !orderData?.items_json) continue;

                                        // Find products with assembly
                                        const produtosComMontagem = (orderData.items_json || []).filter((item: any) =>
                                          item.has_assembly === 'SIM' || item.has_assembly === 'sim' ||
                                          item.possui_montagem === true || item.possui_montagem === 'true'
                                        );

                                        if (produtosComMontagem.length === 0) continue;

                                        // Check if assembly_products already exist for this order
                                        const { data: existing } = await supabase
                                          .from('assembly_products')
                                          .select('id')
                                          .eq('order_id', orderData.id);

                                        // Only insert if NO existing records for this order
                                        if (!existing || existing.length === 0) {
                                          const assemblyProducts = produtosComMontagem.map((item: any) => ({
                                            order_id: orderData.id,
                                            product_name: item.name || item.produto || item.descricao || 'Produto',
                                            product_sku: item.sku || item.codigo || '',
                                            customer_name: orderData.customer_name,
                                            customer_phone: orderData.phone,
                                            installation_address: orderData.address_json,
                                            status: 'pending',
                                            created_at: new Date().toISOString(),
                                            updated_at: new Date().toISOString()
                                          }));

                                          const { error: insertError } = await supabase.from('assembly_products').insert(assemblyProducts);

                                          if (!insertError) {
                                            console.log('[Pickup] Created', assemblyProducts.length, 'assembly products for order', orderData.order_id_erp);
                                            toast.info(`Pedido ${orderData.order_id_erp} tem ${produtosComMontagem.length} produto(s) com montagem!`);
                                          }
                                        }
                                      }
                                    } catch (assemblyError) {
                                      // Log but don't fail the pickup - assembly is secondary
                                      console.error('[Pickup] Error creating assembly products:', assemblyError);
                                    }

                                    // 4. Local State Update (Optimistic)
                                    const updated = { ...selectedRoute, status: 'completed' };
                                    updated.route_orders = (updated.route_orders || []).map((ro: any) => ({
                                      ...ro,
                                      status: 'delivered',
                                      delivered_at: now
                                    }));
                                    setSelectedRoute(updated as any);

                                    toast.success('Retirada confirmada com sucesso!');
                                    await loadData(false);
                                    setShowRouteModal(false);
                                    if (showRouteModalRef && showRouteModalRef.current) showRouteModalRef.current = false;
                                  }
                                } catch (e) {
                                  console.error(e);
                                  toast.error('Erro ao confirmar retirada');
                                } finally {
                                  setSaving(false);
                                }
                              }}
                              disabled={selectedRoute.status === 'completed'}
                              className="flex items-center justify-center px-4 py-2 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg font-medium text-sm transition-colors border border-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <CheckCircle2 className="h-4 w-4 mr-2" />
                              {selectedRoute.status === 'completed' ? 'Retirada Concluída' : 'Confirmar Retirada'}
                            </button>
                          </>
                        );
                      }

                      // --- STANDARD BUTTONS ---
                      return (
                        <>
                          {/* Add Orders Button */}
                          {selectedRoute?.status === 'pending' && (
                            <button
                              onClick={async () => {
                                try {
                                  const route = selectedRoute as any;
                                  const { data: roData } = await supabase.from('route_orders').select('order_id,sequence,id').eq('route_id', route.id).order('sequence');
                                  const existingIds = new Set((roData || []).map((r) => String(r.order_id)));
                                  const toAddIds = Array.from(selectedOrders).filter((id) => !existingIds.has(String(id)));
                                  if (toAddIds.length === 0) { toast.info('Nenhum novo pedido selecionado'); return; }
                                  const startSeq = (roData && roData.length > 0) ? Math.max(...(roData || []).map((r) => Number(r.sequence || 0))) + 1 : 1;
                                  const rows = toAddIds.map((orderId, idx) => ({ route_id: route.id, order_id: orderId, sequence: startSeq + idx, status: 'pending' }));
                                  const { error: insErr } = await supabase.from('route_orders').insert(rows);
                                  if (insErr) throw insErr;
                                  const { error: updErr } = await supabase.from('orders').update({ status: 'assigned' }).in('id', toAddIds);
                                  if (updErr) throw updErr;
                                  toast.success('Pedidos adicionados à rota');

                                  // Recarregar dados e atualizar selectedRoute para refletir os novos pedidos no modal
                                  await loadData();

                                  // Buscar a rota atualizada com os novos pedidos
                                  const { data: updatedRouteData } = await supabase
                                    .from('routes')
                                    .select(`
                                  *,
                                  driver:drivers!driver_id(*, user:users!user_id(*)),
                                  vehicle:vehicles!vehicle_id(*),
                                  route_orders(*, order:orders!order_id(*))
                                `)
                                    .eq('id', route.id)
                                    .single();

                                  if (updatedRouteData) {
                                    setSelectedRoute(updatedRouteData as any);
                                  }

                                  // Limpar seleção de pedidos
                                  setSelectedOrders(new Set());
                                } catch {
                                  toast.error('Falha ao adicionar pedidos');
                                }
                              }}
                              className="flex items-center justify-center px-4 py-2 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg font-medium text-sm transition-colors border border-green-200"
                            >
                              <Plus className="h-4 w-4 mr-2" /> Adicionar Pedidos
                            </button>
                          )}

                          {/* Start Route Button */}
                          <button
                            onClick={async () => {
                              if (!selectedRoute) return;
                              try {
                                if (selectedRoute.status !== 'pending') { toast.error('A rota ja foi iniciada'); return; }
                                const conf = (selectedRoute as any).conference;
                                const cStatus = String(conf?.status || '').toLowerCase();
                                const ok = conf?.result_ok === true || cStatus === 'completed';
                                if (requireConference && !ok) { toast.error('Finalize a conferencia para iniciar a rota'); return; }
                                const { error } = await supabase.from('routes').update({ status: 'in_progress' }).eq('id', selectedRoute.id);
                                if (error) throw error;
                                const updated = { ...selectedRoute, status: 'in_progress' };
                                setSelectedRoute(updated as any);
                                toast.success('Rota iniciada');
                                loadData();
                              } catch (e) {
                                toast.error('Falha ao iniciar rota');
                              }
                            }}
                            disabled={
                              selectedRoute.status !== 'pending' ||
                              (requireConference && !(((selectedRoute as any)?.conference?.result_ok === true) || String((selectedRoute as any)?.conference?.status || '').toLowerCase() === 'completed'))
                            }
                            title={
                              selectedRoute.status !== 'pending'
                                ? 'A rota ja foi iniciada'
                                : ((requireConference && !(((selectedRoute as any)?.conference?.result_ok === true) || String((selectedRoute as any)?.conference?.status || '').toLowerCase() === 'completed')) ? 'Finalize a conferencia para iniciar' : '')
                            }
                            className="flex items-center justify-center px-4 py-2 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 rounded-lg font-medium text-sm transition-colors border border-yellow-200 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Clock className="h-4 w-4 mr-2" /> Iniciar Rota
                          </button>


                          {/* Print Separation Button */}
                          <button
                            onClick={async () => {
                              if (!selectedRoute) return;
                              if (!selectedRoute.route_orders || selectedRoute.route_orders.length === 0) {
                                toast.error('Rota vazia não pode gerar romaneio');
                                return;
                              }

                              const toastId = toast.loading('Gerando Romaneio de Separação...');
                              try {
                                const orders = selectedRoute.route_orders
                                  .map((ro: any) => ro.order)
                                  .filter(Boolean) as Order[];

                                const pdfBytes = await SeparationSheetGenerator.generate({
                                  route: selectedRoute,
                                  routeOrders: selectedRoute.route_orders,
                                  orders,
                                  generatedAt: new Date().toISOString(),
                                });

                                DeliverySheetGenerator.openPDFInNewTab(pdfBytes);
                                toast.success('Romaneio gerado com sucesso!', { id: toastId });
                              } catch (e) {
                                console.error(e);
                                toast.error('Erro ao gerar romaneio', { id: toastId });
                              }
                            }}
                            className="flex items-center justify-center px-4 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg font-medium text-sm transition-colors border border-indigo-200"
                          >
                            <FileText className="h-4 w-4 mr-2" /> Imprimir Separação
                          </button>

                          {/* WhatsApp Button (cliente) */}
                          <button
                            onClick={async () => {
                              if (!selectedRoute) return;
                              setWaSending(true);
                              try {
                                const route = selectedRoute;
                                const { data: roForNotify } = await supabase.from('route_orders').select('*, order:orders(*)').eq('route_id', route.id).order('sequence');
                                const contatos = (roForNotify || []).map((ro) => {
                                  const o = ro.order || {};
                                  const address = o.address_json || {};
                                  const zip = String(address.zip || o.raw_json?.destinatario_cep || '');
                                  const street = String(address.street || o.raw_json?.destinatario_endereco || '');
                                  const neighborhood = String(address.neighborhood || o.raw_json?.destinatario_bairro || '');
                                  const city = String(address.city || o.raw_json?.destinatario_cidade || '');
                                  const endereco_completo = [zip, street, neighborhood && `- ${neighborhood}`, city].filter(Boolean).join(', ').replace(', -', ' -');
                                  const items = Array.isArray(o.items_json) ? o.items_json : [];
                                  const produtos = items.map((it) => `${String(it.sku || '')} - ${String(it.name || '')}`).join(', ');
                                  return {
                                    lancamento_venda: Number(o.order_id_erp || ro.order_id || 0),
                                    cliente_nome: String(o.customer_name || o.raw_json?.nome_cliente || ''),
                                    cliente_celular: String(o.phone || o.raw_json?.cliente_celular || ''),
                                    endereco_completo,
                                    produtos,
                                  };
                                });
                                let webhookUrl = import.meta.env.VITE_WEBHOOK_WHATSAPP_URL;
                                if (!webhookUrl) {
                                  const { data } = await supabase.from('webhook_settings').select('url').eq('key', 'envia_mensagem').eq('active', true).single();
                                  webhookUrl = data?.url || 'https://n8n.lojaodosmoveis.shop/webhook-test/envia_mensagem';
                                }
                                const payload = { contatos, tipo_de_romaneio: 'entrega' };
                                try {
                                  await fetch(String(webhookUrl), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
                            disabled={waSending || selectedRoute?.status === 'completed'}
                            className="flex items-center justify-center px-4 py-2 bg-gray-50 text-gray-700 hover:bg-gray-100 rounded-lg font-medium text-sm transition-colors border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <WhatsAppIcon className="h-4 w-4 mr-2" /> {waSending ? 'Enviando...' : 'Enviar cliente'}
                          </button>

                          {/* Group Button */}
                          <button
                            onClick={async () => {
                              if (!selectedRoute) return;
                              setGroupSending(true);
                              try {
                                const route = selectedRoute;
                                const { data: roForGroup } = await supabase.from('route_orders').select('*, order:orders(*)').eq('route_id', route.id).order('sequence');
                                const route_name = String(route.name || '');

                                // Lógica para buscar nome da equipe (prioridade) ou manter nome do motorista
                                const driverUserId = (route.driver as any)?.user_id;
                                let finalDriverName = String((route.driver as any)?.user?.name || '');

                                if (driverUserId) {
                                  try {
                                    const { data: teamData } = await supabase
                                      .from('teams_user')
                                      .select('name')
                                      .or(`driver_user_id.eq.${driverUserId},helper_user_id.eq.${driverUserId}`)
                                      .order('created_at', { ascending: false })
                                      .limit(1)
                                      .maybeSingle();

                                    if (teamData && teamData.name) {
                                      finalDriverName = teamData.name;
                                    }
                                  } catch (err) {
                                    console.error('Erro ao buscar equipe para rota:', err);
                                  }
                                }

                                const conferente_name = String(route.conferente || '');
                                const status = String(route.status || '');
                                let vehicle_text = '';
                                try {
                                  let v = route.vehicle || null;
                                  if (!v && route.vehicle_id) {
                                    const { data: vData } = await supabase.from('vehicles').select('*').eq('id', route.vehicle_id).single();
                                    v = vData || null;
                                  }
                                  if (v) vehicle_text = `${String(v.model || '')}${v.plate ? ' • ' + String(v.plate) : ''}`;
                                } catch { }
                                const observations = String(route.observations || '');
                                const documentos = (roForGroup || []).map((ro) => String(ro.order?.order_id_erp || ro.order_id || '')).filter(Boolean);
                                if (documentos.length === 0) { toast.error('Nenhum número de lançamento encontrado'); setGroupSending(false); return; }
                                let webhookUrl = import.meta.env.VITE_WEBHOOK_ENVIA_GRUPO_URL;
                                if (!webhookUrl) {
                                  try {
                                    const { data } = await supabase.from('webhook_settings').select('url').eq('key', 'envia_grupo').eq('active', true).single();
                                    webhookUrl = data?.url || 'https://n8n.lojaodosmoveis.shop/webhook/envia_grupo';
                                  } catch {
                                    webhookUrl = 'https://n8n.lojaodosmoveis.shop/webhook/envia_grupo';
                                  }
                                }
                                // Payload atualizado com finalDriverName e route_id (usando route_code)
                                const payload = { route_id: (route as any).route_code, route_name, driver_name: finalDriverName, conferente: conferente_name, documentos, status, vehicle: vehicle_text, observations, tipo_de_romaneio: 'entrega' };
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
                                  fd.append('driver_name', finalDriverName);
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
                            disabled={groupSending || selectedRoute?.status === 'completed'}
                            className="flex items-center justify-center px-4 py-2 bg-gray-50 text-gray-700 hover:bg-gray-100 rounded-lg font-medium text-sm transition-colors border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <WhatsAppIcon className="h-4 w-4 mr-2" /> {groupSending ? 'Enviando...' : 'Enviar grupo'}
                          </button>
                        </>
                      );
                    })()}

                    {/* PDF Romaneio Button */}
                    <button
                      onClick={() => setShowPdfSortModal(true)}
                      className="flex items-center justify-center px-4 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg font-medium text-sm transition-colors border border-blue-200"
                    >
                      <FileText className="h-4 w-4 mr-2" /> Romaneio
                    </button>

                    {/* DANFE Button */}
                    <button
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!selectedRoute) return;
                        if (nfLoading) return; // Prevent double-clicks

                        // Capture route ID at the start to avoid stale closure issues
                        const routeId = selectedRoute.id;

                        setNfLoading(true);
                        try {
                          const { data: roData, error: roErr } = await supabase.from('route_orders').select('*, order:orders(*)').eq('route_id', routeId).order('sequence');
                          if (roErr) throw roErr;

                          // Verificar se é rota de coleta (usa DANFE de devolução)
                          const isPickupRoute = String(selectedRoute.name || '').startsWith('COLETA-');

                          // Para coletas, usar return_danfe_base64; se não tiver, tenta danfe_base64 (retrocompatibilidade ou caso tenha salvo no padrão)
                          const getDanfe = (order: any) => isPickupRoute ? (order?.return_danfe_base64 || order?.danfe_base64) : order?.danfe_base64;
                          const getXml = (order: any) => isPickupRoute ? order?.return_nfe_xml : (order?.xml_documento || '');

                          const allHaveDanfe = (roData || []).every((ro: any) => !!getDanfe(ro.order));
                          if (allHaveDanfe) {
                            const base64Existing = (roData || []).map((ro: any) => String(getDanfe(ro.order))).filter((b: string) => b && b.startsWith('JVBER'));
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
                          const missing = (roData || []).filter((ro: any) => !getDanfe(ro.order));
                          const docs = missing.map((ro: any) => {
                            let xmlText = getXml(ro.order);
                            if (!xmlText && !isPickupRoute) {
                              // Fallback para entregas normais
                              if (ro.order?.raw_json?.xmls_documentos || ro.order?.raw_json?.xmls) {
                                const arr = ro.order.raw_json.xmls_documentos || ro.order.raw_json.xmls || [];
                                const first = Array.isArray(arr) ? arr[0] : null;
                                xmlText = first ? (typeof first === 'string' ? first : (first?.xml || '')) : '';
                              }
                            }
                            return { order_id: ro.order_id, numero: String(ro.order?.order_id_erp || ro.order_id || ''), xml: xmlText };
                          }).filter((d: any) => d.xml && d.xml.includes('<'));
                          if (docs.length === 0) { toast.error('Nenhum XML encontrado nos pedidos faltantes'); setNfLoading(false); return; }
                          let nfWebhook = 'https://n8n.lojaodosmoveis.shop/webhook-test/gera_nf';
                          try {
                            const { data: s } = await supabase.from('webhook_settings').select('url').eq('key', 'gera_nf').eq('active', true).single();
                            if (s?.url) nfWebhook = s.url;
                          } catch { }
                          const resp = await fetch(nfWebhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ route_id: routeId, documentos: docs, count: docs.length }) });
                          const text = await resp.text();
                          let payload: any = null; try { payload = JSON.parse(text); } catch { payload = { error: text }; }
                          if (!resp.ok) { toast.error('Erro ao gerar notas fiscais'); setNfLoading(false); return; }
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
                          try {
                            // Salvar DANFE no campo correto baseado no tipo de rota
                            const danfeField = isPickupRoute ? 'return_danfe_base64' : 'danfe_base64';
                            if (mapByOrderId.size > 0) {
                              for (const [orderId, b64] of mapByOrderId.entries()) {
                                const updateData: any = { [danfeField]: b64 };
                                if (!isPickupRoute) updateData.danfe_gerada_em = new Date().toISOString();
                                await supabase.from('orders').update(updateData).eq('id', orderId);
                              }
                            } else if (base64List.length === docs.length) {
                              for (let i = 0; i < docs.length; i++) {
                                const orderId = docs[i].order_id; const b64 = base64List[i];
                                const updateData: any = { [danfeField]: b64 };
                                if (!isPickupRoute) updateData.danfe_gerada_em = new Date().toISOString();
                                await supabase.from('orders').update(updateData).eq('id', orderId);
                              }
                            }
                          } catch (e) { console.warn('Falha ao salvar DANFE:', e); }
                          // Buscar DANFEs existentes do campo correto
                          const existing = (roData || []).map((ro: any) => String(getDanfe(ro.order))).filter((b: string) => b && b.startsWith('JVBER'));
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
                      className="flex items-center justify-center px-4 py-2 bg-gray-50 text-gray-700 hover:bg-gray-100 rounded-lg font-medium text-sm transition-colors border border-gray-200 disabled:opacity-50"
                    >
                      <FileSpreadsheet className="h-4 w-4 mr-2" /> {nfLoading ? '...' : ((selectedRoute?.route_orders || []).every((ro: any) => !!ro.order?.danfe_base64) ? 'Imprimir Notas' : 'Gerar Notas')}
                    </button>

                    {/* Relatório de Fechamento Button */}
                    <button
                      onClick={async () => {
                        if (!selectedRoute) return;
                        try {
                          const toastId = toast.loading('Gerando resumo...');
                          const route = selectedRoute as any;
                          const { data: roData, error: roErr } = await supabase.from('route_orders').select('*, order:orders(*)').eq('route_id', route.id).order('sequence');
                          if (roErr) throw roErr;

                          // Ensure we have driver details
                          let driverName = route.driver?.user?.name || route.driver?.name || 'Não informado';
                          if (!route.driver && route.driver_id) {
                            const { data: d } = await supabase.from('drivers').select('*, user:users(*)').eq('id', route.driver_id).single();
                            if (d) driverName = d.user?.name || d.name || driverName;
                          }

                          // Vehicle
                          let vehicleInfo = route.vehicle ? `${route.vehicle.model} - ${route.vehicle.plate}` : '-';
                          if (!route.vehicle && route.vehicle_id) {
                            const { data: v } = await supabase.from('vehicles').select('*').eq('id', route.vehicle_id).single();
                            if (v) vehicleInfo = `${v.model} - ${v.plate}`;
                          }

                          // Populate orders and ensure typing
                          const routeOrders = (roData || []).map((ro: any) => ({
                            ...ro,
                            order: ro.order
                          }));

                          // Resolve names
                          let teamName = '';
                          if (route.team_id) {
                            const t = teams.find((x: any) => String(x.id) === String(route.team_id));
                            if (t) teamName = t.name;
                            else {
                              const { data: tData } = await supabase.from('teams_user').select('name').eq('id', route.team_id).single();
                              if (tData) teamName = tData.name;
                            }
                          }

                          let helperName = '';
                          if (route.helper_id) {
                            const h = helpers.find((x: any) => String(x.id) === String(route.helper_id));
                            if (h) helperName = h.name;
                            else {
                              const { data: hData } = await supabase.from('users').select('name').eq('id', route.helper_id).single();
                              if (hData) helperName = hData.name;
                            }
                          }

                          const data = {
                            route: { ...route, route_orders: routeOrders },
                            driverName,
                            supervisorName: route.conferente || 'Não informado',
                            vehicleInfo,
                            teamName: teamName || 'Não informada',
                            helperName: helperName || 'Não informado',
                            generatedAt: new Date().toISOString()
                          };

                          const pdfBytes = await RouteReportGenerator.generateRouteReport(data);
                          DeliverySheetGenerator.openPDFInNewTab(pdfBytes);
                          toast.dismiss(toastId);
                          toast.success('Resumo gerado!');

                        } catch (e: any) {
                          console.error(e);
                          toast.error('Erro ao gerar resumo da rota');
                        }
                      }}
                      className="flex items-center justify-center px-4 py-2 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg font-medium text-sm transition-colors border border-purple-200"
                      title="Gerar Resumo da Rota"
                    >
                      <ClipboardCheck className="h-4 w-4 mr-2" /> Resumo da Rota
                    </button>

                    {/* Complete Route Button REMOVED as per user request (auto-complete logic exists) */}
                  </div>
                )}
              </div>

              {/* Route Info Cards (Editable) */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 p-6 bg-white border-b border-gray-100">
                {/* Team */}
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-purple-100 rounded-lg"><Users className="h-5 w-5 text-purple-600" /></div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-500">Equipe</p>
                    {isEditingRoute ? (
                      <select
                        value={editRouteTeam}
                        onChange={handleEditTeamChange}
                        className="mt-1 block w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-purple-500 focus:ring-purple-500 p-1"
                      >
                        <option value="">Selecione...</option>
                        {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    ) : (
                      <p className="text-base font-semibold text-gray-900">{teams.find(t => t.id === selectedRoute.team_id)?.name || (selectedRoute as any).teamName || '-'}</p>
                    )}
                  </div>
                </div>

                {/* Driver */}
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-blue-100 rounded-lg"><User className="h-5 w-5 text-blue-600" /></div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-500">Motorista</p>
                    {isEditingRoute ? (
                      <select
                        value={editRouteDriver}
                        onChange={(e) => setEditRouteDriver(e.target.value)}
                        disabled={!!editRouteTeam}
                        className={`mt-1 block w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 p-1 ${!!editRouteTeam ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                      >
                        <option value="">Selecione...</option>
                        {drivers.map(d => <option key={d.id} value={d.id}>{d.user?.name || d.name}</option>)}
                      </select>
                    ) : (
                      <p className="text-base font-semibold text-gray-900">
                        {(selectedRoute.driver as any)?.user?.name || selectedRoute.driver?.name || drivers.find(d => d.id === selectedRoute.driver_id)?.name || '-'}
                      </p>
                    )}
                  </div>
                </div>

                {/* Helper */}
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-indigo-100 rounded-lg"><UserPlus className="h-5 w-5 text-indigo-600" /></div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-500">Ajudante</p>
                    {isEditingRoute ? (
                      <select
                        value={editRouteHelper}
                        onChange={(e) => setEditRouteHelper(e.target.value)}
                        disabled={!!editRouteTeam}
                        className={`mt-1 block w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-1 ${!!editRouteTeam ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                      >
                        <option value="">Selecione...</option>
                        {helpers.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                      </select>
                    ) : (
                      <p className="text-base font-semibold text-gray-900">{helpers.find(h => h.id === selectedRoute.helper_id)?.name || (selectedRoute as any).helperName || '-'}</p>
                    )}
                  </div>
                </div>

                {/* Vehicle */}
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-orange-100 rounded-lg"><Truck className="h-5 w-5 text-orange-600" /></div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-500">Veículo</p>
                    {isEditingRoute ? (
                      <select
                        value={editRouteVehicle}
                        onChange={(e) => setEditRouteVehicle(e.target.value)}
                        className="mt-1 block w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-orange-500 focus:ring-orange-500 p-1"
                      >
                        <option value="">Selecione...</option>
                        {vehicles.map(v => <option key={v.id} value={v.id}>{v.name} ({v.plate})</option>)}
                      </select>
                    ) : (
                      <p className="text-base font-semibold text-gray-900">
                        {selectedRoute.vehicle?.name ? `${selectedRoute.vehicle.name} (${selectedRoute.vehicle.plate})` :
                          (selectedRoute.vehicle?.model ? `${selectedRoute.vehicle.model} (${selectedRoute.vehicle.plate})` :
                            vehicles.find(v => v.id === selectedRoute.vehicle_id)?.name || '-')}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Conferente Field Row */}
              {isEditingRoute && (
                <div className="px-6 pb-4 bg-white border-b border-gray-100 pt-2">
                  <div className="flex items-center space-x-3 max-w-sm">
                    <div className="p-2 bg-teal-100 rounded-lg"><ClipboardCheck className="h-5 w-5 text-teal-600" /></div>
                    <div className="flex-1">
                      <label className="text-sm font-medium text-gray-500 block mb-1">Conferente (Opcional)</label>
                      <select
                        value={editRouteConferente}
                        onChange={(e) => setEditRouteConferente(e.target.value)}
                        className="block w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-teal-500 focus:ring-teal-500 p-1"
                      >
                        <option value="">Selecione...</option>
                        {conferentes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-auto p-6 bg-gray-50">
                {/* Table of items in route */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-gray-600">Seq</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-600">Pedido</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-600">Cliente</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                        <th className="px-4 py-3 text-right font-semibold text-gray-600">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {selectedRoute.route_orders?.map(ro => {
                        const returnReason = (ro as any)?.return_reason?.reason || (ro as any)?.return_reason || (ro as any)?.order?.last_return_reason || '';
                        const returnNotes = (ro as any)?.return_notes || (ro as any)?.order?.last_return_notes || '';
                        const returnInfo = [returnReason, returnNotes].filter(Boolean).join(' • ');
                        return (
                          <tr key={ro.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3">{ro.sequence}</td>
                            <td className="px-4 py-3 font-medium">{ro.order?.order_id_erp || '—'}</td>
                            <td className="px-4 py-3">{ro.order?.customer_name || '—'}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-1">
                                <span className={`px-2 py-1 rounded text-xs font-bold ${ro.status === 'delivered' ? 'bg-green-100 text-green-700' :
                                  ro.status === 'returned' ? 'bg-red-100 text-red-700' :
                                    'bg-yellow-100 text-yellow-700'
                                  }`}>
                                  {(() => {
                                    if (ro.status === 'delivered') {
                                      const isPkp = String(selectedRoute.name || '').startsWith('RETIRADA');
                                      const dt = ro.delivered_at
                                        ? new Date(ro.delivered_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                                        : '';
                                      return isPkp ? `Retirado ${dt}` : `Entregue ${dt}`;
                                    }
                                    if (ro.status === 'returned') {
                                      const dtReturned = (ro as any).returned_at || ro.delivered_at;
                                      const dt = dtReturned
                                        ? new Date(dtReturned).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                                        : '';
                                      return `Retornado ${dt}`;
                                    }
                                    return 'Pendente';
                                  })()}
                                </span>
                                {ro.status === 'returned' && (returnReason || returnNotes) && (
                                  <span className="text-xs text-red-700" title={returnInfo}>
                                    {returnReason || 'Retornado'}{returnNotes ? ` · ${returnNotes}` : ''}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right flex items-center justify-end gap-2">
                              {selectedRoute?.status === 'pending' && (
                                <button
                                  className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                                  title="Remover da rota"
                                  onClick={async () => {
                                    try {
                                      // LÓGICA DE EXCLUSÃO COM ROLLBACK PARA COLETAS
                                      const orderERP = String(ro.order?.order_id_erp || '');
                                      const isPickupOrder = orderERP.startsWith('C-');

                                      if (isPickupOrder) {
                                        // 1. Extrair ID original
                                        const originalErpInfo = orderERP.substring(2); // remove "C-"
                                        // Tenta achar o pedido original. Como não temos o ID original fácil aqui no objeto ro, 
                                        // vamos buscar pelo order_id_erp se possível, ou assumir que o 'C-' foi criado corretamente.
                                        // O ideal seria ter salvo o original_id no pedido de coleta, mas usamos o ERP ID como chave lógica.

                                        // Buscar pedido original pelo ERP ID
                                        const { data: originalOrder } = await supabase
                                          .from('orders')
                                          .select('id')
                                          .eq('order_id_erp', originalErpInfo)
                                          .single();

                                        if (originalOrder) {
                                          // Atualiza pedido original limpando pickup_created_at
                                          await supabase.from('orders').update({ pickup_created_at: null }).eq('id', originalOrder.id);
                                        }

                                        // Excluir o pedido da rota
                                        const { error: delErr } = await supabase.from('route_orders').delete().eq('id', ro.id);
                                        if (delErr) throw delErr;

                                        // EXCLUIR O PEDIDO "C-" (limpeza)
                                        // Como ele foi criado só pra essa rota, se saiu da rota, deve sumir.
                                        await supabase.from('orders').delete().eq('id', ro.order_id);

                                        toast.success('Coleta cancelada. Pedido voltou para pendências.');

                                      } else {
                                        // LÓGICA PADRÃO PARA ENTREGAS NORMAIS
                                        const { error: delErr } = await supabase.from('route_orders').delete().eq('id', ro.id);
                                        if (delErr) throw delErr;
                                        const { error: updErr } = await supabase.from('orders').update({ status: 'pending' }).eq('id', ro.order_id);
                                        if (updErr) throw updErr;
                                        toast.success('Pedido removido da rota');
                                      }

                                      const updated = { ...selectedRoute } as any;
                                      updated.route_orders = (updated.route_orders || []).filter((x: any) => x.id !== ro.id);
                                      setSelectedRoute(updated);

                                      // Optimistic update for background list
                                      setRoutesList(current => current.map(r =>
                                        r.id === selectedRoute.id
                                          ? { ...r, route_orders: (r.route_orders || []).filter((orderItem: any) => orderItem.id !== ro.id) }
                                          : r
                                      ));
                                      loadData();
                                    } catch (err: any) {
                                      console.error(err);
                                      toast.error('Falha ao remover pedido: ' + err.message);
                                    }
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}

                              {/* Individual Separation Print */}
                              <button
                                className="p-1 text-orange-600 hover:text-orange-800 hover:bg-orange-50 rounded transition-colors"
                                title="Imprimir Separação Individual"
                                onClick={async () => {
                                  const toastId = toast.loading('Gerando...');
                                  try {
                                    const order = ro.order;
                                    if (!order) throw new Error("Pedido não encontrado");

                                    const pdfBytes = await SeparationSheetGenerator.generate({
                                      route: selectedRoute,
                                      routeOrders: [ro],
                                      orders: [order],
                                      generatedAt: new Date().toISOString()
                                    });
                                    DeliverySheetGenerator.openPDFInNewTab(pdfBytes);
                                    toast.success('Gerado!', { id: toastId });
                                  } catch (e) {
                                    console.error(e);
                                    toast.error('Erro ao gerar', { id: toastId });
                                  }
                                }}
                              >
                                <FileText className="h-4 w-4" />
                              </button>

                              {/* Individual Delivery Romaneio Print */}
                              <button
                                className="p-1 text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded transition-colors"
                                title="Imprimir Romaneio de Entrega Individual"
                                onClick={async () => {
                                  const toastId = toast.loading('Gerando Romaneio de Entrega...');
                                  try {
                                    const order = ro.order;
                                    if (!order) throw new Error("Pedido não encontrado");

                                    // Lógica de mapeamento igual ao romaneio geral, mas para UM pedido
                                    const address = order.address_json || {};
                                    const itemsRaw = Array.isArray(order.items_json) ? order.items_json : [];
                                    const prodLoc = order.raw_json?.produtos_locais || [];
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

                                    const mappedOrder = {
                                      id: (order as any).id || ro.order_id,
                                      order_id_erp: String((order as any).order_id_erp || ro.order_id || ''),
                                      customer_name: String((order as any).customer_name || ((order as any).raw_json?.nome_cliente ?? '')),
                                      phone: String((order as any).phone || ((order as any).raw_json?.cliente_celular ?? '')),
                                      address_json: {
                                        street: String((address as any).street || (order as any).raw_json?.destinatario_endereco || ''),
                                        neighborhood: String((address as any).neighborhood || (order as any).raw_json?.destinatario_bairro || ''),
                                        city: String((address as any).city || (order as any).raw_json?.destinatario_cidade || ''),
                                        state: String((address as any).state || ''),
                                        zip: String((address as any).zip || (order as any).raw_json?.destinatario_cep || ''),
                                        complement: (address as any).complement || (order as any).raw_json?.destinatario_complemento || '',
                                      },
                                      items_json: items,
                                      raw_json: order.raw_json || null,
                                      total: Number((order as any).total || 0),
                                      status: order.status || 'imported',
                                      observations: (order as any).observations || '',
                                      created_at: order.created_at || new Date().toISOString(),
                                      updated_at: order.updated_at || new Date().toISOString(),
                                    } as any;

                                    // Resolve Motorista e Equipe (pode usar os da rota ou vazios)
                                    let driverObj = selectedRoute.driver || { id: '', user_id: '', cpf: '', active: true, user: { id: '', email: '', name: '', role: 'driver', created_at: '' } };
                                    let vehicleObj = selectedRoute.vehicle || undefined;

                                    // Tentar resolver nomes da equipe (igual ao geral)
                                    let teamName = '';
                                    let helperName = '';

                                    if (selectedRoute.team_id) {
                                      const t = teams.find((x: any) => String(x.id) === String(selectedRoute.team_id));
                                      if (t) teamName = t.name;
                                    }
                                    if (selectedRoute.helper_id) {
                                      const h = helpers.find((x: any) => String(x.id) === String(selectedRoute.helper_id));
                                      if (h) helperName = h.name;
                                    }

                                    const data = {
                                      route: {
                                        id: selectedRoute.id,
                                        name: selectedRoute.name,
                                        route_code: (selectedRoute as any).route_code,
                                        driver_id: selectedRoute.driver_id,
                                        vehicle_id: selectedRoute.vehicle_id,
                                        conferente: selectedRoute.conferente,
                                        observations: selectedRoute.observations,
                                        status: selectedRoute.status,
                                        created_at: selectedRoute.created_at,
                                        updated_at: selectedRoute.updated_at,
                                      },
                                      routeOrders: [ro], // Passa só esta routeOrder
                                      driver: driverObj as any,
                                      vehicle: vehicleObj,
                                      orders: [mappedOrder], // Passa só este pedido
                                      generatedAt: new Date().toISOString(),
                                      teamName,
                                      helperName,
                                    };

                                    const pdfBytes = await DeliverySheetGenerator.generateDeliverySheet(data);
                                    DeliverySheetGenerator.openPDFInNewTab(pdfBytes);
                                    toast.success('Romaneio de Entrega gerado!', { id: toastId });
                                  } catch (e) {
                                    console.error(e);
                                    toast.error('Erro ao gerar', { id: toastId });
                                  }
                                }}
                              >
                                <FileSpreadsheet className="h-4 w-4" />
                              </button>

                              {ro.order?.danfe_base64 ? (
                                <button
                                  className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
                                  title="Imprimir DANFE"
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
                                  <FileSpreadsheet className="h-4 w-4" />
                                </button>
                              ) : (
                                <button
                                  className="p-1 text-green-600 hover:text-green-800 hover:bg-green-50 rounded transition-colors"
                                  title="Gerar DANFE individual"
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
                                      await supabase.from('orders').update({ danfe_base64: b64, danfe_gerada_em: new Date().toISOString() }).eq('id', ro.order_id);
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
                                  <FileSpreadsheet className="h-4 w-4" />
                                </button>
                              )}
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
        )
      }

      {/* Mixed Confirm Modal */}
      {
        mixedConfirmOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
              <div className="flex items-center gap-3 mb-4 text-yellow-600">
                <AlertTriangle className="h-8 w-8" />
                <h3 className="text-lg font-bold text-gray-900">Confirmação Necessária</h3>
              </div>
              <p className="text-gray-600 mb-4">
                Alguns pedidos selecionados possuem itens em locais diferentes do filtro atual (<strong>{filterLocalEstocagem}</strong>).
                Deseja continuar e incluir todos os itens destes pedidos na rota?
              </p>
              <div className="bg-gray-50 rounded-lg p-3 mb-6 max-h-40 overflow-auto text-sm">
                {mixedConfirmOrders.map(m => (
                  <div key={m.id} className="flex justify-between py-1 border-b border-gray-200 last:border-0">
                    <span className="font-medium">#{m.pedido}</span>
                    <span className="text-gray-500">{m.otherLocs.join(', ')}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setMixedConfirmOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
                <button
                  onClick={() => { setMixedConfirmOpen(false); if (mixedConfirmAction === 'create') createRoute(true); }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  Sim, Continuar
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Modal de Ordenação do PDF */}
      {showPdfSortModal && selectedRoute && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
              <h3 className="text-lg font-bold text-white">Gerar Romaneio de Entrega</h3>
              <p className="text-blue-100 text-sm">Escolha a ordenação dos pedidos</p>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-3">
                <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                  <input
                    type="radio"
                    name="pdfSort"
                    value="data_venda"
                    checked={pdfSortOption === 'data_venda'}
                    onChange={() => setPdfSortOption('data_venda')}
                    className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <div className="ml-3">
                    <span className="font-medium text-gray-900">Por Data de Venda</span>
                    <p className="text-sm text-gray-500">Da mais antiga para a mais recente</p>
                  </div>
                </label>
                <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                  <input
                    type="radio"
                    name="pdfSort"
                    value="cidade"
                    checked={pdfSortOption === 'cidade'}
                    onChange={() => setPdfSortOption('cidade')}
                    className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <div className="ml-3">
                    <span className="font-medium text-gray-900">Por Cidade</span>
                    <p className="text-sm text-gray-500">Ordem alfabética (A-Z)</p>
                  </div>
                </label>
                <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                  <input
                    type="radio"
                    name="pdfSort"
                    value="previsao_entrega"
                    checked={pdfSortOption === 'previsao_entrega'}
                    onChange={() => setPdfSortOption('previsao_entrega')}
                    className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <div className="ml-3">
                    <span className="font-medium text-gray-900">Por Previsão de Entrega</span>
                    <p className="text-sm text-gray-500">Da mais antiga para a mais recente</p>
                  </div>
                </label>
                <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                  <input
                    type="radio"
                    name="pdfSort"
                    value="cliente"
                    checked={pdfSortOption === 'cliente'}
                    onChange={() => setPdfSortOption('cliente')}
                    className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <div className="ml-3">
                    <span className="font-medium text-gray-900">Por Cliente</span>
                    <p className="text-sm text-gray-500">Ordem alfabética (A-Z)</p>
                  </div>
                </label>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3">
              <button
                onClick={() => setShowPdfSortModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  try {
                    const route = selectedRoute as any;
                    const { data: roData, error: roErr } = await supabase.from('route_orders').select('*, order:orders(*)').eq('route_id', route.id).order('sequence');
                    if (roErr) throw roErr;

                    let orders = (roData || []).map((ro: any) => {
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
                        data_venda: o.data_venda || o.raw_json?.data_venda,
                        previsao_entrega: o.previsao_entrega || o.raw_json?.previsao_entrega,
                        total: Number(o.total || 0),
                        status: o.status || 'imported',
                        observations: o.observations || '',
                        created_at: o.created_at || new Date().toISOString(),
                        updated_at: o.updated_at || new Date().toISOString(),
                      } as any;
                    });

                    // Ordenar pedidos conforme opção selecionada
                    const parseDate = (d: any) => {
                      if (!d) return new Date(0);
                      try { return new Date(d); } catch { return new Date(0); }
                    };

                    if (pdfSortOption === 'data_venda') {
                      orders.sort((a, b) => {
                        const dateA = parseDate(a.data_venda || a.raw_json?.data_venda);
                        const dateB = parseDate(b.data_venda || b.raw_json?.data_venda);
                        return dateA.getTime() - dateB.getTime();
                      });
                    } else if (pdfSortOption === 'cidade') {
                      orders.sort((a, b) => {
                        const cityA = (a.address_json?.city || a.raw_json?.cidade || '').toLowerCase();
                        const cityB = (b.address_json?.city || b.raw_json?.cidade || '').toLowerCase();
                        return cityA.localeCompare(cityB);
                      });
                    } else if (pdfSortOption === 'previsao_entrega') {
                      orders.sort((a, b) => {
                        const dateA = parseDate(a.previsao_entrega || a.raw_json?.previsao_entrega);
                        const dateB = parseDate(b.previsao_entrega || b.raw_json?.previsao_entrega);
                        return dateA.getTime() - dateB.getTime();
                      });
                    } else if (pdfSortOption === 'cliente') {
                      orders.sort((a, b) => {
                        const clientA = (a.customer_name || a.raw_json?.nome_cliente || '').toLowerCase();
                        const clientB = (b.customer_name || b.raw_json?.nome_cliente || '').toLowerCase();
                        return clientA.localeCompare(clientB);
                      });
                    }

                    // Criar routeOrders na ordem dos orders ordenados
                    const routeOrders = orders.map((order, idx) => {
                      const ro = (roData || []).find((r: any) => r.order_id === order.id || r.order?.id === order.id);
                      return {
                        id: ro?.id || '',
                        route_id: ro?.route_id || route.id,
                        order_id: order.id,
                        sequence: idx + 1,
                        status: ro?.status || 'pending',
                        created_at: ro?.created_at || route.created_at,
                        updated_at: ro?.updated_at || route.updated_at,
                      };
                    });

                    let driverObj = route.driver;
                    if (!driverObj) {
                      const { data: dData } = await supabase.from('drivers').select('*, user:users!user_id(*)').eq('id', route.driver_id).single();
                      driverObj = dData || null;
                    }
                    let vehicleObj = route.vehicle;
                    if (!vehicleObj && route.vehicle_id) {
                      const { data: vData } = await supabase.from('vehicles').select('*').eq('id', route.vehicle_id).single();
                      vehicleObj = vData || null;
                    }

                    let teamName = '';
                    let helperName = '';
                    if (route.team_id) {
                      const t = teams.find((x: any) => String(x.id) === String(route.team_id));
                      if (t) teamName = t.name;
                      else {
                        const { data: tData } = await supabase.from('teams_user').select('name').eq('id', route.team_id).single();
                        if (tData) teamName = tData.name;
                      }
                    }
                    if (route.helper_id) {
                      const h = helpers.find((x: any) => String(x.id) === String(route.helper_id));
                      if (h) helperName = h.name;
                      else {
                        const { data: hData } = await supabase.from('users').select('name').eq('id', route.helper_id).single();
                        if (hData) helperName = hData.name;
                      }
                    }

                    const data = {
                      route: { id: route.id, name: route.name, route_code: (route as any).route_code, driver_id: route.driver_id, vehicle_id: route.vehicle_id, conferente: route.conferente, observations: route.observations, status: route.status, created_at: route.created_at, updated_at: route.updated_at },
                      routeOrders,
                      driver: driverObj || { id: '', user_id: '', cpf: '', active: true, user: { id: '', email: '', name: '', role: 'driver', created_at: '' } },
                      vehicle: vehicleObj || undefined,
                      orders,
                      generatedAt: new Date().toISOString(),
                      teamName,
                      helperName,
                    };
                    const pdfBytes = await DeliverySheetGenerator.generateDeliverySheet(data);
                    DeliverySheetGenerator.openPDFInNewTab(pdfBytes);
                    setShowPdfSortModal(false);
                  } catch (e: any) {
                    console.error(e);
                    toast.error('Erro ao gerar romaneio em PDF');
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                Gerar PDF
              </button>
            </div>
          </div>
        </div>
      )}

    </div >
  );
}

export default function RouteCreation() {
  return (
    <RouteCreationErrorBoundary>
      <RouteCreationContent />
    </RouteCreationErrorBoundary>
  );
}
