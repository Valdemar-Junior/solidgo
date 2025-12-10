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
  ClipboardCheck
} from 'lucide-react';
import { toast } from 'sonner';
import { DeliverySheetGenerator } from '../../utils/pdf/deliverySheetGenerator';
import { PDFDocument } from 'pdf-lib';
import { useAuthStore } from '../../stores/authStore';

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
  // --- STATE ---
  const [orders, setOrders] = useState<Order[]>([]);
  const [drivers, setDrivers] = useState<DriverWithUser[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [conferentes, setConferentes] = useState<{id:string,name:string}[]>([]);
  
  // Selection
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  
  // New Route Form
  const [selectedDriver, setSelectedDriver] = useState<string>('');
  const [selectedVehicle, setSelectedVehicle] = useState<string>('');
  const [routeName, setRouteName] = useState<string>('');
  const [conferente, setConferente] = useState<string>('');
  const [observations, setObservations] = useState<string>('');
  
  // UI States
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [routesList, setRoutesList] = useState<RouteWithDetails[]>([]);
  
  // Modals
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<RouteWithDetails | null>(null);
  const [showConferenceModal, setShowConferenceModal] = useState(false);
  const [conferenceRoute, setConferenceRoute] = useState<RouteWithDetails | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showColumnsModal, setShowColumnsModal] = useState(false);
  const [mixedConfirmOpen, setMixedConfirmOpen] = useState(false);
  
  // Loading states for specific actions
  const [nfLoading, setNfLoading] = useState(false);
  const [waSending, setWaSending] = useState(false);
  const [groupSending, setGroupSending] = useState(false);

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
  const [filterSaleDate, setFilterSaleDate] = useState<string>('');
  const [strictLocal, setStrictLocal] = useState<boolean>(false);
  const [filterBrand, setFilterBrand] = useState<string>('');

  // Logic specific
  const [selectedExistingRouteId, setSelectedExistingRouteId] = useState<string>('');
  const selectedRouteIdRef = useRef<string | null>(null);
  const showRouteModalRef = useRef<boolean>(false);
  const showCreateModalRef = useRef<boolean>(false);
  const [mixedConfirmOrders, setMixedConfirmOrders] = useState<Array<{id:string,pedido:string,otherLocs:string[]}>>([]);
  const [mixedConfirmAction, setMixedConfirmAction] = useState<'create'|'add'|'none'>('none');

  // Table Config
  const [columnsConf, setColumnsConf] = useState<Array<{id:string,label:string,visible:boolean}>>([
    { id: 'data', label: 'Data', visible: true },
    { id: 'pedido', label: 'Pedido', visible: true },
    { id: 'cliente', label: 'Cliente', visible: true },
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

  const [viewMode, setViewMode] = useState<'products'|'orders'>('products');
  
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

  // --- EFFECTS ---

  useEffect(() => {
    loadData(true);
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
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem('rc_selectedOrders', JSON.stringify(Array.from(selectedOrders))); } catch {}
  }, [selectedOrders]);

  const onProductsScroll = () => {
    try { if (productsScrollRef.current) localStorage.setItem('rc_productsScrollLeft', String(productsScrollRef.current.scrollLeft || 0)); } catch {}
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    try {
      const rid = localStorage.getItem('rc_selectedRouteId');
      // Do not auto-open create modal on load
      localStorage.setItem('rc_showCreateModal', '0');
      // Do NOT auto-open route modal on load; only open when user clicks
      localStorage.setItem('rc_showRouteModal', '0');
      const cols = localStorage.getItem('rc_columns_conf');
      if (cols) {
        const parsed = JSON.parse(cols);
        if (Array.isArray(parsed)) {
          const migrated = parsed
            .filter((c: any) => c && typeof c === 'object' && 'id' in c)
            .map((c: any) => c.id === 'localEstocagem' ? { ...c, label: 'Local de Saída' } : c);
          if (migrated.length > 0) {
             // Merge with defaults to ensure no missing columns
             const defaults = [
                { id: 'data', label: 'Data', visible: true },
                { id: 'pedido', label: 'Pedido', visible: true },
                { id: 'cliente', label: 'Cliente', visible: true },
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
             // Update visibility based on saved, keep default structure
             const merged = defaults.map(d => {
                const found = migrated.find((m: any) => m.id === d.id);
                return found ? { ...d, visible: found.visible, label: found.label || d.label } : d;
             });
             setColumnsConf(merged);
          }
        }
      }
      setViewMode('products');
    } catch {}
  }, []);

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
          if ('saleDate' in f) setFilterSaleDate(f.saleDate || '');
          if ('brand' in f) setFilterBrand(f.brand || '');
        }
      }
    } catch {}
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
        saleDate: filterSaleDate,
        brand: filterBrand,
      };
      localStorage.setItem('rc_filters', JSON.stringify(payload));
    } catch {}
  }, [filterCity, filterNeighborhood, filterFilialVenda, filterLocalEstocagem, strictLocal, filterSeller, filterClient, filterDepartment, strictDepartment, filterFreightFull, filterHasAssembly, filterOperation, filterSaleDate, filterBrand]);

  // --- MEMOS (Options) ---
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
  const brandOptions = useMemo(() => {
    const fromItems = (orders || []).flatMap((o: any) => Array.isArray(o.items_json) ? o.items_json.map((it: any) => String(it?.brand || '').trim()) : []);
    const fromProdLoc = (orders || []).flatMap((o: any) => Array.isArray(o.raw_json?.produtos_locais) ? o.raw_json.produtos_locais.map((p: any) => String(p?.marca || '').trim()) : []);
    const fromRawSingle = (orders || []).map((o: any) => String(o.raw_json?.marca || '').trim());
    return Array.from(new Set([...(fromItems||[]), ...(fromProdLoc||[]), ...(fromRawSingle||[])].filter(Boolean))).sort();
  }, [orders]);
  
  const filteredClients = useMemo(() => {
    const q = clientQuery.toLowerCase().trim();
    const src = clientOptions || [];
    if (!q) return src.slice(0, 20);
    return src.filter((c)=> c.toLowerCase().includes(q)).slice(0, 20);
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

  const selectedMixedOrdersPlus = useMemo(()=>{
    const map = new Map<string, { id:string; pedido:string; otherLocs:string[]; reasons:string[] }>();
    // Base from local storage filter
    for (const m of selectedMixedOrders as any[]) {
      map.set(m.id, { id: m.id, pedido: m.pedido, otherLocs: m.otherLocs || [], reasons: ['outro local de saída'] });
    }
    const isTrue = (v:any) => { const s = String(v||'').toLowerCase(); return s==='true'||s==='1'||s==='sim'||s==='s'||s==='y'||s==='yes'||s==='t'; };
    // Assembly reason
    for (const oid of Array.from(selectedOrders)) {
      const o: any = (orders || []).find((x:any)=> String(x.id) === String(oid));
      if (!o) continue;
      const pedido = String(o.raw_json?.lancamento_venda ?? o.order_id_erp ?? o.id ?? '');
      const items = Array.isArray(o.items_json) ? o.items_json : [];
      const byLocal = filterLocalEstocagem ? items.filter((it:any)=> String(it?.location||'').toLowerCase() === filterLocalEstocagem.toLowerCase()) : items;
      let visibleItems = byLocal;
      if (filterHasAssembly) visibleItems = visibleItems.filter((it:any)=> isTrue(it?.has_assembly));
      if (filterDepartment) visibleItems = visibleItems.filter((it:any)=> String(it?.department||'').toLowerCase() === String(filterDepartment||'').toLowerCase());

      const allLocs: string[] = Array.from(new Set<string>(items.map((it:any)=> String(it?.location||'').toLowerCase()).filter(Boolean)));
      const visibleLocs: string[] = Array.from(new Set<string>(visibleItems.map((it:any)=> String(it?.location||'').toLowerCase()).filter(Boolean)));
      const otherLocs = allLocs.filter(l => !visibleLocs.includes(l));

      const cur = map.get(String(o.id)) || { id: String(o.id), pedido, otherLocs: [], reasons: [] };

      // If some items are filtered out by current combination, add a generic reason
      if (visibleItems.length < items.length) {
        if (!cur.reasons.includes('há itens fora dos filtros')) cur.reasons.push('há itens fora dos filtros');
      }
      // Specific reasons
      if (filterHasAssembly && items.some((it:any)=> !isTrue(it?.has_assembly))) {
        if (!cur.reasons.includes('há itens sem montagem')) cur.reasons.push('há itens sem montagem');
      }
      if (filterDepartment && items.some((it:any)=> String(it?.department||'').toLowerCase() !== String(filterDepartment||'').toLowerCase())) {
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

  const openMixedConfirm = (action:'create'|'add') => {
    const list = selectedMixedOrdersPlus;
    if (list.length === 0) return false;
    setMixedConfirmOrders(list);
    setMixedConfirmAction(action);
    setMixedConfirmOpen(true);
    return true;
  };

  const isTrueGlobal = (v:any) => {
    if (typeof v === 'boolean') return v;
    const s = String(v || '').trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'sim' || s === 's' || s === 'y' || s === 'yes' || s === 't';
  };

  const getFilteredOrderIds = (): Set<string> => {
    try {
      const filtered = (orders || []).filter((o:any) => {
        const addr: any = o.address_json || {};
        const raw: any = o.raw_json || {};
        const city = String(addr.city || raw.destinatario_cidade || '').toLowerCase();
        const nb = String(addr.neighborhood || raw.destinatario_bairro || '').toLowerCase();
        const client = String(o.customer_name || '').toLowerCase();
        const filial = String(o.filial_venda || raw.filial_venda || '').toLowerCase();
        const seller = String(o.vendedor_nome || raw.vendedor || '').toLowerCase();
        if (filterCity && !city.includes(filterCity.toLowerCase())) return false;
        if (filterNeighborhood && !nb.includes(filterNeighborhood.toLowerCase())) return false;
        if (clientQuery && !client.includes(clientQuery.toLowerCase())) return false;
        if (filterFreightFull && !isTrueGlobal(o.tem_frete_full || raw?.tem_frete_full)) return false;
        if (filterOperation && !String(raw.operacoes || '').toLowerCase().includes(filterOperation.toLowerCase())) return false;
        if (filterFilialVenda && filial !== filterFilialVenda.toLowerCase()) return false;
        if (filterSeller && !seller.includes(filterSeller.toLowerCase())) return false;
        return true;
      });
      // Apply per-item filters
      const ids = new Set<string>();
      for (const o of filtered) {
        const items = Array.isArray(o.items_json) ? o.items_json : [];
        if (strictDepartment && filterDepartment) {
          const allInDept = items.length > 0 && items.every((it:any)=> String(it?.department||'').toLowerCase() === filterDepartment.toLowerCase());
          if (!allInDept) continue;
        }
        if (strictLocal && filterLocalEstocagem) {
          const allInLocal = items.length > 0 && items.every((it:any)=> String(it?.location||'').toLowerCase() === filterLocalEstocagem.toLowerCase());
          if (!allInLocal) continue;
        }
        const byLocal = filterLocalEstocagem ? items.filter((it:any)=> String(it?.location||'').toLowerCase() === filterLocalEstocagem.toLowerCase()) : items;
        let byOther = byLocal;
        if (filterHasAssembly) byOther = byOther.filter((it:any)=> isTrueGlobal(it?.has_assembly));
        if (filterDepartment) byOther = byOther.filter((it:any)=> String(it?.department||'').toLowerCase() === filterDepartment.toLowerCase());
        if (filterBrand) byOther = byOther.filter((it:any)=> String(it?.brand||'').toLowerCase() === filterBrand.toLowerCase());
        if (byOther.length > 0) ids.add(String(o.id));
      }
      return ids;
    } catch { return new Set(); }
  };

  // --- DATA LOADING ---
  const loadData = async (silent: boolean = true) => {
    try {
      if (!silent && !showRouteModal && !showCreateModal) setLoading(true);

      // Load available orders (pending status)
      const { data: ordersData } = await supabase
        .from('orders')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      // Load active vehicles
      const { data: vehiclesData } = await supabase
        .from('vehicles')
        .select('*')
        .eq('active', true);

      if (ordersData) setOrders(ordersData as Order[]);
      
      // Update item logic (same as original)
      try {
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

      // Drivers Logic: ensure mapping from users(role=driver) exists, then load join
      // Try RPC first (respects RLS via stored procedure), then fallback to table
      let driverList: any[] = [];
      try {
        const { data: rpcDrivers } = await supabase.rpc('list_drivers');
        if (Array.isArray(rpcDrivers) && rpcDrivers.length > 0) {
          driverList = rpcDrivers.map((d: any) => ({ id: String(d.driver_id), user: { id: String(d.user_id || ''), name: String(d.name || '') }, active: true }));
        }
      } catch {}
      if (driverList.length === 0) {
        const { data: directDrivers } = await supabase
          .from('drivers')
          .select('id, user_id, name, active, user:users!user_id(id,name,email)');
        driverList = (directDrivers || []) as any[];
        // If still empty, attempt to map from users(role=driver) and insert missing
        if (driverList.length === 0) {
          const { data: driverUsers } = await supabase
            .from('users')
            .select('id,name,email')
            .eq('role', 'driver');
          if (Array.isArray(driverUsers) && driverUsers.length > 0) {
            const rows = driverUsers.map((u: any)=> ({ user_id: u.id, name: u.name || u.email || 'Motorista', active: true }));
            try { await supabase.from('drivers').insert(rows); } catch {}
            const { data: directDrivers2 } = await supabase
              .from('drivers')
              .select('id, user_id, name, active, user:users!user_id(id,name,email)');
            driverList = (directDrivers2 || []) as any[];
          }
        }
      }
      setDrivers(driverList as any[]);
      
      if (vehiclesData) setVehicles(vehiclesData as Vehicle[]);

      // Load conferentes
      const { data: conferentesData } = await supabase.from('users').select('id,name,role').eq('role', 'conferente');
      setConferentes((conferentesData || []).map((u: any) => ({ id: String(u.id), name: String(u.name || u.id) })));

      // Routes
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
        const fallback = await supabase.from('routes').select('*').order('created_at', { ascending: false }).limit(50);
        routesData = fallback.data || [];
      }
      
      if (routesData) {
        const enriched = [...(routesData as any[])];
        // ... (Route enrichment logic preserved from original) ...
        const routeIds = enriched.map(r => r.id).filter(Boolean);
        if (routeIds.length > 0) {
            const { data: roBulk } = await supabase.from('route_orders').select('*, order:orders!order_id(*)').in('route_id', routeIds).order('sequence');
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
        }
        
        // ... (Driver enrichment logic preserved) ...
        const driverIds = Array.from(new Set(enriched.map(r => r.driver_id).filter(Boolean)));
        if (driverIds.length > 0) {
             const { data: drvBulk } = await supabase.from('drivers').select('id, active, user:users!user_id(id,name,email)').in('id', driverIds);
             const mapDrv = new Map<string, any>((drvBulk || []).map((d: any) => [String(d.id), d]));
             for (const r of enriched) {
                 const d = mapDrv.get(String(r.driver_id));
                 if (d) r.driver = d;
             }
        }

        // ... (Vehicle enrichment logic preserved) ...
        const vehicleIds = Array.from(new Set(enriched.map(r => r.vehicle_id).filter(Boolean)));
        if (vehicleIds.length > 0) {
            const { data: vehBulk } = await supabase.from('vehicles').select('id,model,plate').in('id', vehicleIds);
            const mapVeh = new Map<string, any>((vehBulk || []).map((v: any) => [String(v.id), v]));
            for (const r of enriched) {
                const v = mapVeh.get(String(r.vehicle_id));
                if (v) r.vehicle = v;
            }
        }

        // ... (Conference enrichment fallback) ...
        if (routeIds.length > 0) {
             const missingConf = enriched.filter(r=> !(r as any).conference).map(r=> r.id);
             if (missingConf.length > 0) {
                 const { data: confBulk } = await supabase.from('latest_route_conferences').select('*').in('route_id', missingConf);
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
    const wasSelected = newSelected.has(orderId);
    if (wasSelected) {
      newSelected.delete(orderId);
    } else {
      newSelected.add(orderId);
      if (filterLocalEstocagem) {
        try {
          const o = (orders || []).find((x:any)=> String(x.id) === String(orderId));
          const locs = getOrderLocations(o || {}).map(l=> String(l));
          const other = locs.filter(l=> l.toLowerCase() !== filterLocalEstocagem.toLowerCase());
          if (other.length > 0) {
            toast.warning(`Pedido possui itens também em outros locais: ${Array.from(new Set(other)).join(', ')}`);
          }
        } catch {}
      }
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
      // If adding to existing route, persist assignments if provided
      if (selectedExistingRouteId) {
        const updatePayload: any = {};
        if (selectedDriver) updatePayload.driver_id = selectedDriver;
        if (selectedVehicle) updatePayload.vehicle_id = selectedVehicle;
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
      loadData(false);
      
    } catch (error) {
      console.error('Error creating route:', error);
      toast.error('Erro ao criar rota');
    } finally {
      setSaving(false);
    }
  };

  // --- RENDER ---
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <span className="text-gray-500 font-medium">Carregando plataforma de rotas...</span>
        </div>
      </div>
    );
  }

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
                  <MapPin className="h-6 w-6 text-blue-600" />
                  Gestão de Rotas
                </h1>
                <p className="text-sm text-gray-500">Crie, monitore e gerencie entregas e romaneios</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
               <button 
                onClick={()=> setShowFilters(!showFilters)}
                className={`inline-flex items-center px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${showFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
              >
                <Filter className="h-4 w-4 mr-2" />
                Filtros
              </button>
            <button 
              onClick={()=> loadData(false)} 
              disabled={loading}
              className="inline-flex items-center px-4 py-2 rounded-lg border text-sm font-medium transition-colors bg-white border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
                <RefreshCcw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Recarregar
              </button>
              <button 
                onClick={()=> { showCreateModalRef.current = true; localStorage.setItem('rc_showCreateModal','1'); setShowCreateModal(true); }} 
                disabled={selectedOrders.size === 0}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all transform active:scale-95"
              >
                <Plus className="h-4 w-4 mr-2" />
                Criar Rota ({selectedOrders.size})
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        
        {/* Filters Panel */}
        {showFilters && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 animate-in slide-in-from-top-2 duration-200">
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Data da Venda</label>
                        <input 
                          type="date" 
                          value={filterSaleDate}
                          onChange={(e)=> setFilterSaleDate(e.target.value)}
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all" 
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Cidade</label>
                        <select value={filterCity} onChange={(e)=>setFilterCity(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all">
                            <option value="">Todas</option>
                            {cityOptions.map((c)=> (<option key={c} value={c}>{c}</option>))}
                        </select>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Bairro</label>
                        <select value={filterNeighborhood} onChange={(e)=>setFilterNeighborhood(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all">
                            <option value="">Todos</option>
                            {neighborhoodOptions.map((c)=> (<option key={c} value={c}>{c}</option>))}
                        </select>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Filial</label>
                        <select value={filterFilialVenda} onChange={(e)=>setFilterFilialVenda(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all">
                            <option value="">Todas</option>
                            {filialOptions.map((c)=> (<option key={c} value={c}>{c}</option>))}
                        </select>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Local de Saída</label>
                        <select value={filterLocalEstocagem} onChange={(e)=>setFilterLocalEstocagem(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all">
                            <option value="">Todos</option>
                            {localOptions.map((c)=> (<option key={c} value={c}>{c}</option>))}
                        </select>
                        <div className="flex items-center mt-1">
                             <input type="checkbox" id="strictLocal" className="h-3 w-3 text-blue-600 rounded border-gray-300" checked={strictLocal} onChange={(e)=> setStrictLocal(e.currentTarget.checked)} />
                             <label htmlFor="strictLocal" className="ml-2 text-xs text-gray-500">Apenas local exclusivo</label>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Vendedor</label>
                        <select value={filterSeller} onChange={(e)=>setFilterSeller(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all">
                            <option value="">Todos</option>
                            {sellerOptions.map((c)=> (<option key={c} value={c}>{c}</option>))}
                        </select>
                    </div>
                    <div className="relative space-y-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Cliente</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                            <input
                                type="text"
                                value={clientQuery}
                                onFocus={()=> setShowClientList(true)}
                                onBlur={()=> setTimeout(()=> setShowClientList(false), 200)}
                                onChange={(e)=>{ const v = e.target.value; setClientQuery(v); setFilterClient(v); setShowClientList(true); }}
                                placeholder="Buscar cliente..."
                                className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                            />
                        </div>
                        {showClientList && (
                        <div className="absolute left-0 right-0 mt-1 max-h-48 overflow-auto bg-white border border-gray-200 rounded-lg shadow-xl z-30">
                            <button onMouseDown={(e)=> e.preventDefault()} onClick={()=>{ setFilterClient(''); setClientQuery(''); setShowClientList(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100">Todos</button>
                            {filteredClients.map((c)=> (
                            <button key={c} onMouseDown={(e)=> e.preventDefault()} onClick={()=>{ setFilterClient(c); setClientQuery(c); setShowClientList(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-800 hover:bg-blue-50 hover:text-blue-700">
                                {c}
                            </button>
                            ))}
                        </div>
                        )}
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Departamento</label>
                        <select value={filterDepartment} onChange={(e)=>setFilterDepartment(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all">
                            <option value="">Todos</option>
                            {departmentOptions.map((c)=> (<option key={c} value={c}>{c}</option>))}
                        </select>
                        <div className="flex items-center mt-1">
                             <input type="checkbox" id="strictDept" className="h-3 w-3 text-blue-600 rounded border-gray-300" checked={strictDepartment} onChange={(e)=> setStrictDepartment(e.currentTarget.checked)} />
                             <label htmlFor="strictDept" className="ml-2 text-xs text-gray-500">Apenas dept. exclusivo</label>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Marca</label>
                        <select value={filterBrand} onChange={(e)=>setFilterBrand(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all">
                            <option value="">Todas</option>
                            {brandOptions.map((c)=> (<option key={c} value={c}>{c}</option>))}
                        </select>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Operação</label>
                        <select value={filterOperation} onChange={(e)=>setFilterOperation(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all">
                            <option value="">Todas</option>
                            {operationOptions.map((c)=> (<option key={c} value={c}>{c}</option>))}
                        </select>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Frete Full</label>
                        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                            <input id="ffull" type="checkbox" className="h-4 w-4" checked={Boolean(filterFreightFull)} onChange={(e)=> setFilterFreightFull(e.target.checked ? '1' : '')} />
                            <label htmlFor="ffull" className="text-sm text-gray-700">Apenas pedidos com Frete Full</label>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Tem Montagem</label>
                        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                            <input id="fmont" type="checkbox" className="h-4 w-4" checked={filterHasAssembly} onChange={(e)=> setFilterHasAssembly(e.target.checked)} />
                            <label htmlFor="fmont" className="text-sm text-gray-700">Apenas produtos com Montagem</label>
                        </div>
                    </div>
                </div>
                
                <div className="flex justify-end mt-4 pt-4 border-t border-gray-100">
                     <button 
                        onClick={()=>{setFilterCity('');setFilterNeighborhood('');setFilterFilialVenda('');setFilterLocalEstocagem('');setStrictLocal(false);setFilterSeller('');setFilterClient('');setClientQuery('');setFilterFreightFull('');setFilterOperation('');setFilterDepartment('');setFilterHasAssembly(false);setFilterSaleDate('');setFilterBrand('');}} 
                        className="text-sm text-red-600 hover:text-red-800 font-medium flex items-center"
                     >
                        <X className="h-3 w-3 mr-1" /> Limpar filtros
                     </button>
                </div>
            </div>
        )}

        {/* Orders Selection Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
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
                    <button onClick={()=> setShowColumnsModal(true)} className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors" title="Configurar Colunas">
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
                             {selectedMixedOrdersPlus.map((m)=> `${m.pedido}${m.otherLocs.length?` (${m.otherLocs.join(', ')})`:''} — ${m.reasons.join(', ')}`).join(' • ')}
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
                        <h3 className="text-lg font-medium text-gray-900">Nenhum pedido pendente</h3>
                        <p className="text-gray-500 mt-1 max-w-sm">Todos os pedidos já foram roteirizados ou não há importações recentes.</p>
                    </div>
                ) : (
                    <table className="min-w-max w-full text-sm divide-y divide-gray-100">
                        <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="px-4 py-3 w-10 text-left"></th>
                                {columnsConf.filter(c=>c.visible).map(c=> (
                                    <th key={c.id} className="px-4 py-3 text-left font-semibold text-gray-600 uppercase text-xs tracking-wider">{c.label}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                             {/* Reuse the massive mapping logic here but cleaner */}
                             {(() => {
                               const rows: Array<{ order: any; item: any }> = [];
                               const isTrue = (v:any) => {
                                 if (typeof v === 'boolean') return v;
                                 const s = String(v || '').trim().toLowerCase();
                                 return s === 'true' || s === '1' || s === 'sim' || s === 's' || s === 'y' || s === 'yes' || s === 't';
                               };
                               const filteredOrders = orders.filter((o:any) => {
                                 const addr: any = o.address_json || {};
                                 const raw: any = o.raw_json || {};
                                 const city = String(addr.city || raw.destinatario_cidade || '').toLowerCase();
                                 const nb = String(addr.neighborhood || raw.destinatario_bairro || '').toLowerCase();
                                 const client = String(o.customer_name || '').toLowerCase();
                                 const filial = String(o.filial_venda || raw.filial_venda || '').toLowerCase();
                                 const seller = String(o.vendedor_nome || raw.vendedor || '').toLowerCase();
                                 const saleDateISO = (o.data_venda || raw.data_venda || '') as string;
                                 const saleDateStr = saleDateISO ? new Date(saleDateISO).toISOString().slice(0,10) : '';
                                 if (filterCity && !city.includes(filterCity.toLowerCase())) return false;
                                 if (filterNeighborhood && !nb.includes(filterNeighborhood.toLowerCase())) return false;
                                 if (clientQuery && !client.includes(clientQuery.toLowerCase())) return false;
                                 if (filterFreightFull && !isTrue(o.tem_frete_full || raw?.tem_frete_full)) return false;
                                 if (filterOperation && !String(raw.operacoes || '').toLowerCase().includes(filterOperation.toLowerCase())) return false;
                                 if (filterFilialVenda && filial !== filterFilialVenda.toLowerCase()) return false;
                                 if (filterSeller && !seller.includes(filterSeller.toLowerCase())) return false;
                                 if (filterSaleDate && saleDateStr !== filterSaleDate) return false;
                                 return true;
                               });

                               for (const o of filteredOrders) {
                                 const items = Array.isArray(o.items_json) ? o.items_json : [];
                                 // Strict department: require ALL items in the order to match selected department
                                 if (strictDepartment && filterDepartment) {
                                   const allInDept = items.length > 0 && items.every((it:any)=> String(it?.department||'').toLowerCase() === filterDepartment.toLowerCase());
                                   if (!allInDept) continue;
                                 }
                                 if (strictLocal && filterLocalEstocagem) {
                                   const allInLocal = items.length > 0 && items.every((it:any)=> String(it?.location||'').toLowerCase() === filterLocalEstocagem.toLowerCase());
                                   if (!allInLocal) continue;
                                 }
                                 const itemsByLocal = filterLocalEstocagem
                                   ? items.filter((it:any)=> String(it?.location||'').toLowerCase() === filterLocalEstocagem.toLowerCase())
                                   : items;
                                 let itemsFiltered = itemsByLocal;
                                 if (filterHasAssembly) itemsFiltered = itemsFiltered.filter((it:any)=> isTrue(it?.has_assembly));
                                 if (filterDepartment) itemsFiltered = itemsFiltered.filter((it:any)=> String(it?.department||'').toLowerCase() === filterDepartment.toLowerCase());
                                 if (filterBrand) itemsFiltered = itemsFiltered.filter((it:any)=> String(it?.brand||'').toLowerCase() === filterBrand.toLowerCase());
                                 if (itemsFiltered.length === 0 && (filterLocalEstocagem || filterHasAssembly || filterBrand || filterDepartment)) continue;
                                 for (const it of itemsFiltered) rows.push({ order: o, item: it });
                               }

                               

                               return rows.map(({ order: o, item: it }, idx) => {
                                 const isSelected = selectedOrders.has(o.id);
                                 const raw: any = o.raw_json || {};
                                 const addr: any = o.address_json || {};
                                 const temFreteFull = isTrue(o.tem_frete_full) || isTrue(raw?.tem_frete_full);
                                 const hasAssembly = isTrue(it?.has_assembly);
                                 const waLink = (() => {
                                   const p = String(o.phone || '').replace(/\D/g, '');
                                   const e164 = p ? (p.startsWith('55') ? p : '55' + p) : '';
                                   return e164 ? `https://wa.me/${e164}` : '';
                                 })();

                                 const values: any = {
                                   data: formatDate(o.data_venda || raw.data_venda || o.created_at),
                                   pedido: o.order_id_erp || raw.lancamento_venda || '-',
                                   cliente: o.customer_name,
                                   telefone: o.phone,
                                   sku: it.sku || '-',
                                   produto: it.name || '-',
                                   quantidade: Number(it.purchased_quantity ?? it.quantity ?? 1),
                                   department: it.department || raw.departamento || '-',
                                   brand: it.brand || raw.marca || '-',
                                   localEstocagem: it.location || raw.local_estocagem || '-',
                                   cidade: addr.city || raw.destinatario_cidade,
                                   bairro: addr.neighborhood || raw.destinatario_bairro,
                                   filialVenda: o.filial_venda || raw.filial_venda || '-',
                                   operacao: raw.operacoes || '-',
                                   vendedor: o.vendedor_nome || raw.vendedor || raw.vendedor_nome || '-',
                                   situacao: o.status === 'pending' ? 'Pendente' : o.status === 'assigned' ? 'Atribuído' : o.status,
                                   obsPublicas: o.observacoes_publicas || raw.observacoes || '-',
                                   obsInternas: o.observacoes_internas || raw.observacoes_internas || '-',
                                   endereco: [addr.street, addr.number, addr.complement].filter(Boolean).join(', ') || raw.destinatario_endereco || '-',
                                   outrosLocs: getOrderLocations(o).join(', ') || '-'
                                 };

                                 return (
                                   <tr
                                     key={`${o.id}-${it.sku}-${idx}`}
                                     onClick={()=> toggleOrderSelection(o.id)}
                                     className={`group hover:bg-gray-50 transition-colors cursor-pointer ${isSelected ? 'bg-blue-50/60 hover:bg-blue-100/50' : ''}`}
                                   >
                                     <td className="px-4 py-3">
                                       <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'}`}>
                                         {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
                                       </div>
                                     </td>
                                        {columnsConf.filter(c=>c.visible).map(c=> (
                                          <td key={c.id} className="px-4 py-3 text-gray-700 whitespace-nowrap">
                                            {c.id === 'telefone' ? (
                                              <div className="flex items-center gap-2">
                                                {waLink && (
                                                  <a href={waLink} target="_blank" rel="noreferrer" className="p-1 rounded text-green-600 hover:bg-green-50" title="Abrir WhatsApp">
                                                    <MessageCircle className="h-4 w-4" />
                                                  </a>
                                                )}
                                                <span>{values[c.id] || '-'}</span>
                                              </div>
                                            ) : c.id === 'flags' ? (
                                              <div className="flex items-center gap-2">
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
                                              </div>
                                            ) : c.id === 'produto' ? (
                                              <div className="flex items-center gap-2">
                                                <span className="truncate max-w-[420px]">{values[c.id]}</span>
                                              </div>
                                            ) : (
                                              values[c.id] || '-'
                                            )}
                                          </td>
                                        ))}
                                   </tr>
                                 );
                               });
                             })()}
                        </tbody>
                    </table>
                )}
            </div>
        </div>

        {/* Routes List Section */}
        <div className="space-y-4">
             <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <Truck className="h-6 w-6 text-gray-700" />
                    Romaneios Ativos
                </h2>
                <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-xs font-bold">
                    {routesList.length}
                </span>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                 {routesList.length === 0 ? (
                     <div className="col-span-full bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
                         <div className="mx-auto w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                             <Truck className="h-8 w-8 text-gray-400" />
                         </div>
                         <h3 className="text-lg font-medium text-gray-900">Nenhuma rota encontrada</h3>
                         <p className="text-gray-500">Crie sua primeira rota selecionando pedidos acima.</p>
                     </div>
                 ) : (
                     routesList.map(route => {
                        const total = route.route_orders?.length || 0;
                        const pending = route.route_orders?.filter(r => r.status === 'pending').length || 0;
                        const delivered = route.route_orders?.filter(r => r.status === 'delivered').length || 0;
                        
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
                                                {ok ? <ClipboardCheck className="h-3 w-3"/> : <ClipboardList className="h-3 w-3"/>}
                                                {label}
                                              </span>
                                            );
                                          })()}
                                        </div>
                                    </div>
                                    
                                    <div className="space-y-3 mb-6">
                                        <div className="flex items-center text-sm text-gray-600">
                                            <User className="h-4 w-4 mr-2 text-gray-400" />
                                            {((route.driver as any)?.user?.name) || (route.driver as any)?.name || 'Sem motorista'}
                                        </div>
                                        <div className="flex items-center text-sm text-gray-600">
                                            <ClipboardList className="h-4 w-4 mr-2 text-gray-400" />
                                            {String((route as any)?.conferente || '').trim() || 'Sem conferente'}
                                        </div>
                                        <div className="flex items-center text-sm text-gray-600">
                                            <Truck className="h-4 w-4 mr-2 text-gray-400" />
                                            {route.vehicle ? `${route.vehicle.model} (${route.vehicle.plate})` : 'Sem veículo'}
                                        </div>
                                    </div>

                                    {/* Mini Stats */}
                                    <div className="grid grid-cols-3 gap-2 mb-2">
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
                                    </div>
                                </div>

                                <div className="p-4 border-t border-gray-100 bg-gray-50/50 rounded-b-xl flex gap-3">
                                    <button 
                                        onClick={() => {
                                            selectedRouteIdRef.current = String(route.id);
                                            localStorage.setItem('rc_selectedRouteId', String(route.id));
                                            setSelectedRoute(route);
                                            showRouteModalRef.current = true;
                                            localStorage.setItem('rc_showRouteModal','1');
                                            setShowRouteModal(true);
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
             </div>
        </div>

      </div>

      {/* --- MODALS --- */}
      
      {/* Create Route Modal */}
      {showCreateModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                      <h3 className="text-lg font-bold text-gray-900">Nova Rota / Romaneio</h3>
                      <button onClick={()=>{ setShowCreateModal(false); showCreateModalRef.current = false; localStorage.setItem('rc_showCreateModal','0'); }} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5"/></button>
                  </div>
                  <div className="p-6 space-y-6">
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Adicionar a romaneio existente?</label>
                          <select 
                            value={selectedExistingRouteId} 
                            onChange={(e)=>setSelectedExistingRouteId(e.target.value)}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                          >
                              <option value="">Não, criar novo romaneio</option>
                              {routesList.filter(r=>r.status==='pending').map(r=> (
                                  <option key={r.id} value={r.id}>{r.name}</option>
                              ))}
                          </select>
                      </div>

                      {!selectedExistingRouteId && (
                          <div className="space-y-4">
                              <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">Nome da Rota <span className="text-red-500">*</span></label>
                                  <input 
                                    type="text" 
                                    value={routeName} 
                                    onChange={(e)=>setRouteName(e.target.value)} 
                                    placeholder="Ex: Rota Zona Sul - Manhã"
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                  />
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                  <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">Motorista <span className="text-red-500">*</span></label>
                                      <select 
                                        value={selectedDriver} 
                                        onChange={(e)=>setSelectedDriver(e.target.value)}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                      >
                                          <option value="">Selecione...</option>
                                          {drivers.map(d => <option key={d.id} value={d.id}>{d.user?.name || d.name || d.id}</option>)}
                                      </select>
                                  </div>
                                  <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">Veículo</label>
                                      <select 
                                        value={selectedVehicle} 
                                        onChange={(e)=>setSelectedVehicle(e.target.value)}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                      >
                                          <option value="">Selecione...</option>
                                          {vehicles.map(v => <option key={v.id} value={v.id}>{v.model} - {v.plate}</option>)}
                                      </select>
                                  </div>
                              </div>
                              <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">Conferente</label>
                                  <select 
                                    value={conferente} 
                                    onChange={(e)=>setConferente(e.target.value)}
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
                  <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                      <button onClick={()=>setShowCreateModal(false)} className="px-6 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-white transition-colors">Cancelar</button>
                      <button 
                        onClick={createRoute}
                        disabled={saving || (!selectedExistingRouteId && (!routeName || !selectedDriver))}
                        className="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 disabled:opacity-50 disabled:shadow-none transition-all transform active:scale-95"
                      >
                        {saving ? 'Salvando...' : 'Confirmar Rota'}
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
                      <button onClick={()=>setShowColumnsModal(false)}><X className="h-5 w-5 text-gray-400"/></button>
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
                                    onClick={()=>{
                                        if (idx===0) return;
                                        const newCols = [...columnsConf];
                                        [newCols[idx-1], newCols[idx]] = [newCols[idx], newCols[idx-1]];
                                        setColumnsConf(newCols);
                                    }}
                                    className="p-1 hover:bg-gray-200 rounded"
                                  ><ChevronUp className="h-4 w-4"/></button>
                                  <button 
                                     onClick={()=>{
                                        if (idx===columnsConf.length-1) return;
                                        const newCols = [...columnsConf];
                                        [newCols[idx+1], newCols[idx]] = [newCols[idx], newCols[idx+1]];
                                        setColumnsConf(newCols);
                                    }}
                                    className="p-1 hover:bg-gray-200 rounded"
                                  ><ChevronDown className="h-4 w-4"/></button>
                              </div>
                          </div>
                      ))}
                  </div>
                  <div className="p-4 border-t border-gray-100 bg-gray-50 text-right">
                      <button 
                        onClick={() => {
                            localStorage.setItem('rc_columns_conf', JSON.stringify(columnsConf));
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

      {/* Conference Review Modal */}
      {showConferenceModal && conferenceRoute && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b flex items-center justify-between bg-gray-50">
              <h4 className="text-lg font-bold text-gray-900">Revisão de Conferência — {conferenceRoute.name}</h4>
              <button onClick={()=>setShowConferenceModal(false)} className="text-gray-500 hover:text-gray-700"><X className="h-5 w-5"/></button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
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
                  const pIds = Object.keys(byOrderProducts).filter(k => (byOrderProducts[k] || []).length > 0);
                  if (pIds.length === 0) return <div className="text-center py-8 text-gray-500 font-medium">Sem faltantes. Conferência OK.</div>;
                  return (
                    <div className="space-y-4">
                      {pIds.map((oid)=>{
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
                                {products.map((p, idx)=>(
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
                          onClick={async ()=>{
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
                            } catch (e:any) {
                              toast.error('Erro ao remover pedidos da rota');
                            }
                          }}
                          className="px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg font-medium transition-colors"
                        >Remover pedidos não bipados</button>
                        <button
                          onClick={()=>{ const ids = pIds.filter(Boolean); markResolved(ids); }}
                          className="px-4 py-2 bg-teal-600 text-white hover:bg-teal-700 rounded-lg font-medium shadow-sm transition-colors"
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
                      return (
                        <div key={oid} className="border rounded-lg overflow-hidden">
                          <div className="px-4 py-2 bg-gray-50 border-b">
                             <div className="font-bold text-gray-900">Pedido: {pedido} • {cliente}</div>
                          </div>
                          <div className="p-4 bg-white">
                            <div className="text-sm font-bold text-red-600 mb-2">Volumes faltantes ({info.codes.length}):</div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                              {info.codes.map((c, idx)=>(
                                <div key={`${c}-${idx}`} className="text-xs px-2 py-1.5 rounded bg-red-50 text-red-700 border border-red-100 font-mono text-center">{c}</div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
                      <button
                        onClick={async ()=>{
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
                          } catch (e:any) {
                            toast.error('Erro ao remover pedidos da rota');
                          }
                        }}
                        className="px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg font-medium transition-colors"
                      >Remover pedidos faltantes</button>
                      <button
                        onClick={()=>{ const ids = orderIds.filter(Boolean); markResolved(ids); }}
                        className="px-4 py-2 bg-teal-600 text-white hover:bg-teal-700 rounded-lg font-medium shadow-sm transition-colors"
                      >Resolver Divergência</button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Route Details Modal */}

      {showRouteModal && selectedRoute && (
         <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in zoom-in-95 duration-200">
             <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
                 {/* Re-implementing the header and actions cleanly */}
                 <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                     <div>
                        <h2 className="text-xl font-bold text-gray-900">{selectedRoute.name}</h2>
                        <p className="text-sm text-gray-500">
                            {selectedRoute.status === 'pending' ? 'Em Separação' : selectedRoute.status === 'in_progress' ? 'Em Rota' : 'Concluída'} 
                            • {(selectedRoute.driver as any)?.user?.name || selectedRoute.driver?.name}
                        </p>
                     </div>
                    <button onClick={()=>{ setShowRouteModal(false); showRouteModalRef.current = false; localStorage.setItem('rc_showRouteModal','0'); }} className="p-2 hover:bg-gray-200 rounded-full text-gray-500"><X className="h-6 w-6"/></button>
                 </div>
                 
                 {/* Toolbar */}
                <div className="px-6 py-3 border-b border-gray-100 bg-white grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                     {/* Add Orders Button */}
                     {selectedRoute?.status === 'pending' && (
                        <button
                            onClick={async () => {
                                try {
                                    const route = selectedRoute as any;
                                    const { data: roData } = await supabase.from('route_orders').select('order_id,sequence,id').eq('route_id', route.id).order('sequence');
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
                                if (selectedRoute.status !== 'pending') { toast.error('A rota já foi iniciada'); return; }
                                const conf: any = (selectedRoute as any).conference;
                                const cStatus = String(conf?.status || '').toLowerCase();
                                const ok = conf?.result_ok === true || cStatus === 'completed';
                                if (!ok) { toast.error('Finalize a conferência para iniciar a rota'); return; }
                                const { error } = await supabase.from('routes').update({ status: 'in_progress' }).eq('id', selectedRoute.id);
                                if (error) throw error;
                                const updated = { ...selectedRoute, status: 'in_progress' } as any;
                                setSelectedRoute(updated);
                                toast.success('Rota iniciada');
                                loadData();
                            } catch (e) {
                                toast.error('Falha ao iniciar rota');
                            }
                        }}
                        disabled={selectedRoute.status !== 'pending' || !((selectedRoute as any)?.conference?.result_ok === true || String((selectedRoute as any)?.conference?.status || '').toLowerCase() === 'completed')}
                        title={selectedRoute.status !== 'pending' ? 'A rota já foi iniciada' : (!((selectedRoute as any)?.conference?.result_ok === true || String((selectedRoute as any)?.conference?.status || '').toLowerCase() === 'completed') ? 'Finalize a conferência para iniciar' : '')}
                        className="flex items-center justify-center px-4 py-2 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 rounded-lg font-medium text-sm transition-colors border border-yellow-200 disabled:opacity-50 disabled:cursor-not-allowed"
                     >
                        <Clock className="h-4 w-4 mr-2" /> Iniciar Rota
                     </button>

                     {/* WhatsApp Button */}
                     <button
                        onClick={async () => {
                            if (!selectedRoute) return;
                            setWaSending(true);
                            try {
                                const route = selectedRoute as any;
                                const { data: roForNotify } = await supabase.from('route_orders').select('*, order:orders(*)').eq('route_id', route.id).order('sequence');
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
                        disabled={waSending}
                        className="flex items-center justify-center px-4 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg font-medium text-sm transition-colors border border-indigo-200 disabled:opacity-50"
                     >
                         <MessageSquare className="h-4 w-4 mr-2" /> {waSending ? 'Enviando...' : 'WhatsApp'}
                     </button>

                     {/* Group Button */}
                     <button
                        onClick={async () => {
                            if (!selectedRoute) return;
                            setGroupSending(true);
                            try {
                                const route = selectedRoute as any;
                                const { data: roForGroup } = await supabase.from('route_orders').select('*, order:orders(*)').eq('route_id', route.id).order('sequence');
                                const route_name = String(route.name || '');
                                const driver_name = String(route.driver?.user?.name || '');
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
                                            toast.error('Webhook de teste não está ativo.');
                                        } else {
                                            toast.error('Falha ao enviar informativo');
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
                        className="flex items-center justify-center px-4 py-2 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg font-medium text-sm transition-colors border border-purple-200 disabled:opacity-50"
                     >
                         <MessageSquare className="h-4 w-4 mr-2" /> {groupSending ? 'Enviando...' : 'Grupo'}
                     </button>

                     {/* PDF Romaneio Button */}
                     <button
                        onClick={async () => {
                            try {
                                const route = selectedRoute as any;
                                const { data: roData, error: roErr } = await supabase.from('route_orders').select('*, order:orders(*)').eq('route_id', route.id).order('sequence');
                                if (roErr) throw roErr;
                                const routeOrders = (roData || []).map((ro: any) => ({
                                    id: ro.id, route_id: ro.route_id, order_id: ro.order_id, sequence: ro.sequence, status: ro.status, created_at: ro.created_at, updated_at: ro.updated_at,
                                }));
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
                                const data = {
                                    route: { id: route.id, name: route.name, driver_id: route.driver_id, vehicle_id: route.vehicle_id, conferente: route.conferente, observations: route.observations, status: route.status, created_at: route.created_at, updated_at: route.updated_at, },
                                    routeOrders,
                                    driver: driverObj || { id: '', user_id: '', cpf: '', active: true, user: { id: '', email: '', name: '', role: 'driver', created_at: '' } },
                                    vehicle: vehicleObj || undefined,
                                    orders,
                                    generatedAt: new Date().toISOString(),
                                };
                                const pdfBytes = await DeliverySheetGenerator.generateDeliverySheet(data);
                                DeliverySheetGenerator.openPDFInNewTab(pdfBytes);
                            } catch (e: any) {
                                toast.error('Erro ao gerar romaneio em PDF');
                            }
                        }}
                        className="flex items-center justify-center px-4 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg font-medium text-sm transition-colors border border-blue-200"
                     >
                         <FileText className="h-4 w-4 mr-2" /> Romaneio
                     </button>

                     {/* DANFE Button */}
                     <button
                        onClick={async () => {
                            if (!selectedRoute) return;
                            setNfLoading(true);
                            try {
                                const route = selectedRoute as any;
                                const { data: roData, error: roErr } = await supabase.from('route_orders').select('*, order:orders(*)').eq('route_id', route.id).order('sequence');
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
                                if (docs.length === 0) { toast.error('Nenhum XML encontrado nos pedidos faltantes'); setNfLoading(false); return; }
                                let nfWebhook = 'https://n8n.lojaodosmoveis.shop/webhook-test/gera_nf';
                                try {
                                    const { data: s } = await supabase.from('webhook_settings').select('url').eq('key', 'gera_nf').eq('active', true).single();
                                    if (s?.url) nfWebhook = s.url;
                                } catch {}
                                const resp = await fetch(nfWebhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ route_id: route.id, documentos: docs, count: docs.length }) });
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
                                    if (mapByOrderId.size > 0) {
                                        for (const [orderId, b64] of mapByOrderId.entries()) {
                                            await supabase.from('orders').update({ danfe_base64: b64, danfe_gerada_em: new Date().toISOString() }).eq('id', orderId);
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
                        className="flex items-center justify-center px-4 py-2 bg-gray-50 text-gray-700 hover:bg-gray-100 rounded-lg font-medium text-sm transition-colors border border-gray-200 disabled:opacity-50"
                     >
                         <FileSpreadsheet className="h-4 w-4 mr-2" /> {nfLoading ? '...' : ((selectedRoute?.route_orders || []).every((ro: any) => !!ro.order?.danfe_base64) ? 'Imprimir Notas' : 'Gerar Notas')}
                     </button>

                     {/* Complete Route Button */}
                     <button
                        onClick={async () => {
                            try {
                                const route = selectedRoute as any;
                                const { data: roData, error: roErr } = await supabase.from('route_orders').select('order_id,status').eq('route_id', route.id);
                                if (roErr) throw roErr;
                                if (!roData || roData.length === 0) { toast.error('Nenhum pedido na rota'); return; }
                                const allDelivered = (roData || []).every((ro: any) => ro.status === 'delivered');
                                if (!allDelivered) { toast.error('Existem pedidos pendentes ou retornados'); return; }
                                const { error: rErr } = await supabase.from('routes').update({ status: 'completed' }).eq('id', route.id);
                                if (rErr) throw rErr;
                                const orderIds = (roData || []).map((ro: any) => ro.order_id);
                                await supabase.from('orders').update({ status: 'delivered' }).in('id', orderIds);
                                const updated = { ...selectedRoute, status: 'completed' } as any;
                                setSelectedRoute(updated);
                                toast.success('Rota concluída');
                                loadData();
                            } catch (e) {
                                toast.error('Falha ao concluir rota');
                            }
                        }}
                        disabled={selectedRoute.status !== 'in_progress'}
                        className="flex items-center justify-center px-4 py-2 bg-gray-800 text-white hover:bg-gray-900 rounded-lg font-medium text-sm transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                     >
                         <CheckCircle2 className="h-4 w-4 mr-2" /> Concluir
                     </button>
                </div>

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
                                 {selectedRoute.route_orders?.map(ro => (
                                     <tr key={ro.id} className="hover:bg-gray-50">
                                         <td className="px-4 py-3">{ro.sequence}</td>
                                         <td className="px-4 py-3 font-medium">{ro.order?.order_id_erp || '—'}</td>
                                         <td className="px-4 py-3">{ro.order?.customer_name || '—'}</td>
                                         <td className="px-4 py-3">
                                             <span className={`px-2 py-1 rounded text-xs font-bold ${
                                                 ro.status === 'delivered' ? 'bg-green-100 text-green-700' : 
                                                 ro.status === 'returned' ? 'bg-red-100 text-red-700' : 
                                                 'bg-yellow-100 text-yellow-700'
                                             }`}>
                                                 {ro.status === 'delivered' ? 'Entregue' : ro.status === 'returned' ? 'Devolvido' : 'Pendente'}
                                             </span>
                                         </td>
                                        <td className="px-4 py-3 text-right flex items-center justify-end gap-2">
                                            {selectedRoute?.status === 'pending' && (
                                                <button
                                                    className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                                                    title="Remover da rota"
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
                                 ))}
                             </tbody>
                         </table>
                     </div>
                 </div>
             </div>
         </div>
      )}

      {/* Mixed Confirm Modal */}
      {mixedConfirmOpen && (
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
                      <button onClick={()=>setMixedConfirmOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
                      <button 
                        onClick={()=>{ setMixedConfirmOpen(false); if (mixedConfirmAction==='create') createRoute(); }}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                      >
                          Sim, Continuar
                      </button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
}

export default function RouteCreation() {
  return (
    <RouteCreationErrorBoundary>
      <RouteCreationContent />
    </RouteCreationErrorBoundary>
  );
}
