import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarRange, FileSpreadsheet, Filter, Loader2, MapPin, RotateCcw, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';
import { DeliverySheetGenerator } from '../../utils/pdf/deliverySheetGenerator';
import {
  DeliveryOperationalReportGenerator,
  type DeliveryOperationalReportData,
  type DeliveryOperationalReportRow,
} from '../../utils/pdf/deliveryOperationalReportGenerator';

type DriverOption = {
  id: string;
  name: string;
};

type RouteOption = {
  id: string;
  label: string;
  driverId: string | null;
};

type FiltersState = {
  includeDelivered: boolean;
  deliveredStart: string;
  deliveredEnd: string;
  pendingStart: string;
  pendingEnd: string;
  city: string;
  neighborhood: string;
  filial: string;
  importSource: string;
  serviceType: string;
  driverId: string;
  routeId: string;
  sortBy: 'sale_date_asc' | 'sale_date_desc';
};

type DeliveryQueryRow = {
  id: string;
  status: string;
  delivered_at?: string | null;
  return_reason?: string | null;
  return_notes?: string | null;
  route?: {
    id: string;
    name?: string | null;
    route_code?: string | null;
    status?: string | null;
    driver_id?: string | null;
    created_at?: string | null;
    driver?: {
      user?: {
        name?: string | null;
      } | null;
    } | null;
  } | null;
  order?: {
    id: string;
    order_id_erp?: string | null;
    customer_name?: string | null;
    address_json?: {
      city?: string | null;
      neighborhood?: string | null;
    } | null;
    filial_venda?: string | null;
    data_venda?: string | null;
    previsao_entrega?: string | null;
    status?: string | null;
    import_source?: string | null;
    service_type?: string | null;
  } | null;
};

type PendingOrderRow = {
  id: string;
  order_id_erp?: string | null;
  customer_name?: string | null;
  items_json?: any[] | null;
  address_json?: {
    city?: string | null;
    neighborhood?: string | null;
  } | null;
  filial_venda?: string | null;
  data_venda?: string | null;
  previsao_entrega?: string | null;
  status?: string | null;
  import_source?: string | null;
  service_type?: string | null;
};

type PendingRouteOrderRow = {
  id: string;
  order_id: string;
  status: string;
  created_at?: string | null;
  route?: {
    id: string;
    name?: string | null;
    route_code?: string | null;
    status?: string | null;
    driver_id?: string | null;
    created_at?: string | null;
    driver?: {
      user?: {
        name?: string | null;
      } | null;
    } | null;
  } | null;
};

const getToday = () => new Date().toISOString().slice(0, 10);

const createInitialFilters = (): FiltersState => {
  const today = getToday();
  return {
    includeDelivered: true,
    deliveredStart: today,
    deliveredEnd: today,
    pendingStart: '',
    pendingEnd: '',
    city: '',
    neighborhood: '',
    filial: '',
    importSource: '',
    serviceType: '',
    driverId: '',
    routeId: '',
    sortBy: 'sale_date_asc',
  };
};

const toStartOfDayIso = (value: string) => `${value}T00:00:00.000`;
const toEndOfDayIso = (value: string) => `${value}T23:59:59.999`;

const normalizeText = (value: unknown) => String(value || '').trim();

const formatRouteLabel = (route: { route_code?: string | null; name?: string | null }) => {
  const code = normalizeText(route.route_code);
  const name = normalizeText(route.name);
  if (code && name) return `${code} - ${name}`;
  return code || name || 'Rota sem identificacao';
};

const buildReportRow = (params: {
  orderIdErp?: string | null;
  customerName?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  filial?: string | null;
  saleDate?: string | null;
  forecastDate?: string | null;
  routeName?: string | null;
  routeCode?: string | null;
  driverName?: string | null;
  deliveredAt?: string | null;
  notes?: string | null;
}): DeliveryOperationalReportRow => ({
  orderIdErp: normalizeText(params.orderIdErp) || '-',
  customerName: normalizeText(params.customerName) || '-',
  city: normalizeText(params.city) || '-',
  neighborhood: normalizeText(params.neighborhood) || '-',
  filial: normalizeText(params.filial) || '-',
  saleDate: params.saleDate || null,
  forecastDate: params.forecastDate || null,
  routeName: params.routeName || null,
  routeCode: params.routeCode || null,
  driverName: params.driverName || null,
  deliveredAt: params.deliveredAt || null,
  notes: normalizeText(params.notes) || null,
});

export default function Reports() {
  const [filters, setFilters] = useState<FiltersState>(() => createInitialFilters());
  const [cities, setCities] = useState<string[]>([]);
  const [neighborhoods, setNeighborhoods] = useState<string[]>([]);
  const [filiais, setFiliais] = useState<string[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    const loadOptions = async () => {
      try {
        setLoadingOptions(true);

        const [ordersRes, driversRes, routesRes] = await Promise.all([
          supabase.from('orders').select('address_json, filial_venda').limit(5000),
          supabase
            .from('drivers')
            .select('id, user:users!user_id(name)')
            .eq('active', true),
          supabase
            .from('routes')
            .select('id, name, route_code, driver_id')
            .order('created_at', { ascending: false })
            .limit(1000),
        ]);

        if (ordersRes.error) throw ordersRes.error;
        if (driversRes.error) throw driversRes.error;
        if (routesRes.error) throw routesRes.error;

        const citySet = new Set<string>();
        const neighborhoodSet = new Set<string>();
        const filialSet = new Set<string>();

        (ordersRes.data || []).forEach((row: any) => {
          const city = normalizeText(row?.address_json?.city);
          const neighborhood = normalizeText(row?.address_json?.neighborhood);
          const filial = normalizeText(row?.filial_venda);
          if (city) citySet.add(city);
          if (neighborhood) neighborhoodSet.add(neighborhood);
          if (filial) filialSet.add(filial);
        });

        setCities(Array.from(citySet).sort((a, b) => a.localeCompare(b)));
        setNeighborhoods(Array.from(neighborhoodSet).sort((a, b) => a.localeCompare(b)));
        setFiliais(Array.from(filialSet).sort((a, b) => a.localeCompare(b)));

        setDrivers(
          ((driversRes.data || []) as any[])
            .map((row) => ({
              id: String(row.id),
              name: normalizeText(row?.user?.name) || 'Motorista sem nome',
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
        );

        setRoutes(
          ((routesRes.data || []) as any[]).map((route) => ({
            id: String(route.id),
            label: formatRouteLabel(route),
            driverId: route.driver_id ? String(route.driver_id) : null,
          }))
        );
      } catch (error) {
        console.error('Erro ao carregar filtros do relatorio:', error);
        toast.error('Nao foi possivel carregar os filtros do relatorio');
      } finally {
        setLoadingOptions(false);
      }
    };

    loadOptions();
  }, []);

  const neighborhoodsFiltered = useMemo(() => {
    if (!filters.city) return neighborhoods;
    return neighborhoods;
  }, [filters.city, neighborhoods]);

  const routeOptionsFiltered = useMemo(() => {
    if (!filters.driverId) return routes;
    return routes.filter((route) => route.driverId === filters.driverId);
  }, [filters.driverId, routes]);

  const selectedDriver = drivers.find((driver) => driver.id === filters.driverId);
  const selectedRoute = routes.find((route) => route.id === filters.routeId);

  const updateFilter = (key: keyof FiltersState, value: string) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'driverId' && prev.routeId) {
        const selected = routes.find((route) => route.id === prev.routeId);
        if (selected && selected.driverId && selected.driverId !== value) {
          next.routeId = '';
        }
      }
      return next;
    });
  };

  const updateBooleanFilter = (key: keyof FiltersState, value: boolean) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const validateFilters = () => {
    if (filters.includeDelivered && (!filters.deliveredStart || !filters.deliveredEnd)) {
      toast.error('Preencha o periodo de entregas antes de gerar o PDF');
      return false;
    }

    if (filters.includeDelivered && filters.deliveredStart > filters.deliveredEnd) {
      toast.error('O periodo de entregas esta invalido');
      return false;
    }

    if (filters.pendingStart && filters.pendingEnd && filters.pendingStart > filters.pendingEnd) {
      toast.error('O periodo de pendencias esta invalido');
      return false;
    }

    return true;
  };

  const generatePdf = async () => {
    if (!validateFilters()) return;

    try {
      setGenerating(true);

      const deliveredRows = filters.includeDelivered ? await fetchDeliveredRows(filters) : [];
      const pendingData = await fetchPendingRows(filters);

      const reportData: DeliveryOperationalReportData = {
        filters: {
          deliveredStart: filters.includeDelivered ? filters.deliveredStart : '',
          deliveredEnd: filters.includeDelivered ? filters.deliveredEnd : '',
          pendingStart: filters.pendingStart,
          pendingEnd: filters.pendingEnd,
          city: filters.city || undefined,
          neighborhood: filters.neighborhood || undefined,
          filial: filters.filial || undefined,
          importSourceLabel: getImportSourceLabel(filters.importSource),
          serviceTypeLabel: getServiceTypeLabel(filters.serviceType),
          driverName: selectedDriver?.name,
          routeLabel: selectedRoute?.label,
          includeDelivered: filters.includeDelivered,
          sortLabel:
            filters.sortBy === 'sale_date_asc'
              ? 'Data da venda: mais velha para mais nova'
              : 'Data da venda: mais nova para mais velha',
          generatedAt: new Date().toISOString(),
        },
        deliveredRows: deliveredRows.sort((a, b) => sortRows(a, b, filters.sortBy)),
        awaitingRouteRows: pendingData.awaitingRouteRows.sort((a, b) => sortRows(a, b, filters.sortBy)),
        separatingRows: pendingData.separatingRows.sort((a, b) => sortRows(a, b, filters.sortBy)),
        inRouteRows: pendingData.inRouteRows.sort((a, b) => sortRows(a, b, filters.sortBy)),
      };

      const pdfBytes = await DeliveryOperationalReportGenerator.generate(reportData);
      DeliverySheetGenerator.openPDFInNewTab(pdfBytes);
    } catch (error) {
      console.error('Erro ao gerar relatorio operacional:', error);
      toast.error('Nao foi possivel gerar o PDF do relatorio');
    } finally {
      setGenerating(false);
    }
  };

  const resetFilters = () => {
    setFilters(createInitialFilters());
  };

  return (
    <div className="w-full pb-10">
      <main className="w-full p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Relatorio operacional de entregas</h1>
              <p className="mt-1 text-sm text-gray-500">
                Gere um PDF unico com contagem por pedidos unicos, filtrado por cidade, rota e motorista.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={resetFilters}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                <RotateCcw className="h-4 w-4" />
                Limpar filtros
              </button>
              <button
                onClick={generatePdf}
                disabled={loadingOptions || generating}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                Gerar PDF
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <FilterCard
              icon={<CalendarRange className="h-5 w-5 text-blue-600" />}
              title="Periodo de entregas"
              description="Conta o que foi entregue no periodo pela data real da entrega."
            >
              <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={filters.includeDelivered}
                  onChange={(event) => updateBooleanFilter('includeDelivered', event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Considerar pedidos entregues no relatorio
              </label>
              <DateField
                label="Inicio"
                value={filters.deliveredStart}
                onChange={(value) => updateFilter('deliveredStart', value)}
                disabled={!filters.includeDelivered}
              />
              <DateField
                label="Fim"
                value={filters.deliveredEnd}
                onChange={(value) => updateFilter('deliveredEnd', value)}
                disabled={!filters.includeDelivered}
              />
            </FilterCard>

            <FilterCard
              icon={<CalendarRange className="h-5 w-5 text-amber-600" />}
              title="Periodo de pendencias"
              description="Conta aguardando rota, em separacao e em rota. Se ficar em branco, usa toda a fila atual."
            >
              <DateField
                label="Inicio"
                value={filters.pendingStart}
                onChange={(value) => updateFilter('pendingStart', value)}
              />
              <DateField
                label="Fim"
                value={filters.pendingEnd}
                onChange={(value) => updateFilter('pendingEnd', value)}
              />
            </FilterCard>

            <FilterCard
              icon={<MapPin className="h-5 w-5 text-emerald-600" />}
              title="Recorte geografico"
              description="Os filtros desta coluna valem para todo o relatorio."
            >
              <SelectField
                label="Cidade"
                value={filters.city}
                onChange={(value) => updateFilter('city', value)}
                options={cities}
                placeholder="Todas as cidades"
                disabled={loadingOptions}
              />
              <SelectField
                label="Bairro"
                value={filters.neighborhood}
                onChange={(value) => updateFilter('neighborhood', value)}
                options={neighborhoodsFiltered}
                placeholder="Todos os bairros"
                disabled={loadingOptions}
              />
              <SelectField
                label="Filial"
                value={filters.filial}
                onChange={(value) => updateFilter('filial', value)}
                options={filiais}
                placeholder="Todas as filiais"
                disabled={loadingOptions}
              />
              <SelectField
                label="Origem"
                value={filters.importSource}
                onChange={(value) => updateFilter('importSource', value)}
                options={[
                  { value: 'lote', label: 'Somente lote' },
                  { value: 'avulsa', label: 'Somente avulsa' },
                ]}
                placeholder="Todas as origens"
                disabled={loadingOptions}
              />
              <SelectField
                label="Tipo servico"
                value={filters.serviceType}
                onChange={(value) => updateFilter('serviceType', value)}
                options={[
                  { value: 'normal', label: 'Venda normal' },
                  { value: 'troca', label: 'Troca' },
                  { value: 'assistencia', label: 'Assistencia' },
                ]}
                placeholder="Todos os tipos"
                disabled={loadingOptions}
              />
            </FilterCard>

            <FilterCard
              icon={<Truck className="h-5 w-5 text-violet-600" />}
              title="Rota e motorista"
              description="Se filtrar por rota ou motorista, os grupos sem rota naturalmente ficam zerados."
            >
              <SelectField
                label="Motorista"
                value={filters.driverId}
                onChange={(value) => updateFilter('driverId', value)}
                options={drivers.map((driver) => ({ value: driver.id, label: driver.name }))}
                placeholder="Todos os motoristas"
                disabled={loadingOptions}
              />
              <SelectField
                label="Rota"
                value={filters.routeId}
                onChange={(value) => updateFilter('routeId', value)}
                options={routeOptionsFiltered.map((route) => ({ value: route.id, label: route.label }))}
                placeholder="Todas as rotas"
                disabled={loadingOptions}
              />
              <SelectField
                label="Ordenacao"
                value={filters.sortBy}
                onChange={(value) => updateFilter('sortBy', value as FiltersState['sortBy'])}
                options={[
                  { value: 'sale_date_asc', label: 'Data da venda: mais velha primeiro' },
                  { value: 'sale_date_desc', label: 'Data da venda: mais nova primeiro' },
                ]}
                placeholder="Selecione"
                disabled={loadingOptions}
              />
            </FilterCard>
          </div>
        </div>
      </main>
    </div>
  );
}

function FilterCard({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="rounded-lg bg-white p-2 shadow-sm">{icon}</div>
        <div>
          <h2 className="text-sm font-bold text-gray-900">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-gray-500">{description}</p>
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <input
        type="date"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-100"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[] | { value: string; label: string }[];
  placeholder: string;
  disabled?: boolean;
}) {
  const normalizedOptions = options.map((option) =>
    typeof option === 'string' ? { value: option, label: option } : option
  );

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-100"
      >
        <option value="">{placeholder}</option>
        {normalizedOptions.map((option) => (
          <option key={`${label}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

async function fetchDeliveredRows(filters: FiltersState): Promise<DeliveryOperationalReportRow[]> {
  const { data, error } = await supabase
    .from('route_orders')
    .select(`
      id,
      status,
      delivered_at,
      return_reason,
      return_notes,
      route:routes!inner(
        id,
        name,
        route_code,
        status,
        driver_id,
        created_at,
        driver:drivers!driver_id(
          user:users!user_id(name)
        )
      ),
      order:orders!inner(
        id,
        order_id_erp,
        customer_name,
        address_json,
        filial_venda,
        data_venda,
        previsao_entrega,
        status,
        import_source,
        service_type
      )
    `)
    .eq('status', 'delivered')
    .gte('delivered_at', toStartOfDayIso(filters.deliveredStart))
    .lte('delivered_at', toEndOfDayIso(filters.deliveredEnd))
    .order('delivered_at', { ascending: false });

  if (error) throw error;

  return ((data || []) as DeliveryQueryRow[])
    .filter((row) => matchesGlobalFilters({
      filters,
      city: row.order?.address_json?.city,
      neighborhood: row.order?.address_json?.neighborhood,
      filial: row.order?.filial_venda,
      importSource: row.order?.import_source,
      serviceType: row.order?.service_type,
      driverId: row.route?.driver_id,
      routeId: row.route?.id,
    }))
    .map((row) =>
      buildReportRow({
        orderIdErp: row.order?.order_id_erp,
        customerName: row.order?.customer_name,
        city: row.order?.address_json?.city,
        neighborhood: row.order?.address_json?.neighborhood,
        filial: row.order?.filial_venda,
        saleDate: row.order?.data_venda,
        forecastDate: row.order?.previsao_entrega,
        routeName: row.route?.name,
        routeCode: row.route?.route_code,
        driverName: row.route?.driver?.user?.name,
        deliveredAt: row.delivered_at,
        notes: row.return_notes || row.return_reason,
      })
    );
}

async function fetchPendingRows(filters: FiltersState): Promise<{
  awaitingRouteRows: DeliveryOperationalReportRow[];
  separatingRows: DeliveryOperationalReportRow[];
  inRouteRows: DeliveryOperationalReportRow[];
}> {
  const [ordersRes, activeRouteOrdersRes] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_id_erp, customer_name, items_json, address_json, filial_venda, data_venda, previsao_entrega, status, blocked_at, import_source, service_type')
      .in('status', ['pending', 'imported', 'returned', 'assigned'])
      .is('blocked_at', null)
      .order('previsao_entrega', { ascending: true }),
    supabase
      .from('route_orders')
      .select(`
        id,
        order_id,
        status,
        created_at,
        route:routes!inner(
          id,
          name,
          route_code,
          status,
          driver_id,
          created_at,
          driver:drivers!driver_id(
            user:users!user_id(name)
          )
        )
      `)
      .neq('route.status', 'completed'),
  ]);

  if (ordersRes.error) throw ordersRes.error;
  if (activeRouteOrdersRes.error) throw activeRouteOrdersRes.error;

  const rawOrders = (ordersRes.data || []) as PendingOrderRow[];
  const activeRouteOrders = (activeRouteOrdersRes.data || []) as PendingRouteOrderRow[];

  const lockedOrderIds = new Set<string>();
  activeRouteOrders.forEach((routeOrder) => {
    if (routeOrder.order_id) lockedOrderIds.add(String(routeOrder.order_id));
  });

  const orders = rawOrders.filter((order) => {
    if (!hasSelectableItems(order)) return false;

    return matchesGlobalFilters({
      filters,
      city: order.address_json?.city,
      neighborhood: order.address_json?.neighborhood,
      filial: order.filial_venda,
      importSource: order.import_source,
      serviceType: order.service_type,
      driverId: null,
      routeId: null,
      ignoreRouteDriver: true,
    });
  });

  const assignedIds = orders
    .filter((order) => normalizeText(order.status) === 'assigned')
    .map((order) => order.id);

  const routeOrders = activeRouteOrders.filter((routeOrder) => assignedIds.includes(routeOrder.order_id));

  const activeRouteByOrderId = new Map<string, PendingRouteOrderRow>();
  routeOrders.forEach((routeOrder) => {
    const routeStatus = normalizeText(routeOrder.route?.status);
    if (routeStatus !== 'pending' && routeStatus !== 'in_progress') return;

    const current = activeRouteByOrderId.get(routeOrder.order_id);
    const currentDate = current?.route?.created_at || current?.created_at || '';
    const candidateDate = routeOrder.route?.created_at || routeOrder.created_at || '';

    if (!current || candidateDate > currentDate) {
      activeRouteByOrderId.set(routeOrder.order_id, routeOrder);
    }
  });

  const awaitingRouteRows: DeliveryOperationalReportRow[] = [];
  const separatingRows: DeliveryOperationalReportRow[] = [];
  const inRouteRows: DeliveryOperationalReportRow[] = [];

  orders.forEach((order) => {
    const status = normalizeText(order.status);
    const activeRoute = activeRouteByOrderId.get(order.id);

    if (status !== 'assigned' && !lockedOrderIds.has(order.id)) {
      if (!matchesPendingDate(order.previsao_entrega, filters.pendingStart, filters.pendingEnd)) return;
      if (filters.routeId || filters.driverId) return;

      awaitingRouteRows.push(
        buildReportRow({
          orderIdErp: order.order_id_erp,
          customerName: order.customer_name,
          city: order.address_json?.city,
          neighborhood: order.address_json?.neighborhood,
          filial: order.filial_venda,
          saleDate: order.data_venda,
          forecastDate: order.previsao_entrega,
          notes: status === 'returned' ? 'Pedido retornado aguardando nova roteirizacao' : null,
        })
      );
      return;
    }

    if (status !== 'assigned' || !activeRoute) return;
    if (!matchesPendingDate(order.previsao_entrega, filters.pendingStart, filters.pendingEnd)) return;

    if (!matchesGlobalFilters({
      filters,
      city: order.address_json?.city,
      neighborhood: order.address_json?.neighborhood,
      filial: order.filial_venda,
      importSource: order.import_source,
      serviceType: order.service_type,
      driverId: activeRoute.route?.driver_id,
      routeId: activeRoute.route?.id,
    })) {
      return;
    }

    const baseRow = buildReportRow({
      orderIdErp: order.order_id_erp,
      customerName: order.customer_name,
      city: order.address_json?.city,
      neighborhood: order.address_json?.neighborhood,
      filial: order.filial_venda,
      saleDate: order.data_venda,
      forecastDate: order.previsao_entrega,
      routeName: activeRoute.route?.name,
      routeCode: activeRoute.route?.route_code,
      driverName: activeRoute.route?.driver?.user?.name,
    });

    if (normalizeText(activeRoute.route?.status) === 'pending') {
      separatingRows.push(baseRow);
      return;
    }

    if (normalizeText(activeRoute.route?.status) === 'in_progress' && normalizeText(activeRoute.status) === 'pending') {
      inRouteRows.push(baseRow);
    }
  });

  return {
    awaitingRouteRows,
    separatingRows,
    inRouteRows,
  };
}

function matchesGlobalFilters(params: {
  filters: FiltersState;
  city?: string | null;
  neighborhood?: string | null;
  filial?: string | null;
  importSource?: string | null;
  serviceType?: string | null;
  driverId?: string | null;
  routeId?: string | null;
  ignoreRouteDriver?: boolean;
}) {
  const { filters, city, neighborhood, filial, importSource, serviceType, driverId, routeId, ignoreRouteDriver } = params;

  if (filters.city && normalizeText(city) !== filters.city) return false;
  if (filters.neighborhood && normalizeText(neighborhood) !== filters.neighborhood) return false;
  if (filters.filial && normalizeText(filial) !== filters.filial) return false;
  if (!matchesImportSourceFilter(filters.importSource, importSource)) return false;
  if (!matchesServiceTypeFilter(filters.serviceType, serviceType)) return false;

  if (!ignoreRouteDriver) {
    if (filters.driverId && normalizeText(driverId) !== filters.driverId) return false;
    if (filters.routeId && normalizeText(routeId) !== filters.routeId) return false;
  }

  return true;
}

function matchesPendingDate(value: string | null | undefined, start: string, end: string) {
  if (!start && !end) return true;
  if (!value) return true;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return true;
  const dateOnly = parsed.toISOString().slice(0, 10);

  if (start && dateOnly < start) return false;
  if (end && dateOnly > end) return false;
  return true;
}

function hasSelectableItems(order: PendingOrderRow) {
  return Array.isArray(order.items_json) && order.items_json.length > 0;
}

function matchesImportSourceFilter(filterValue: string, importSource?: string | null) {
  if (!filterValue) return true;

  const normalized = normalizeText(importSource).toLowerCase();
  if (filterValue === 'avulsa') return normalized === 'avulsa';
  if (filterValue === 'lote') return normalized !== 'avulsa';
  return true;
}

function matchesServiceTypeFilter(filterValue: string, serviceType?: string | null) {
  if (!filterValue) return true;

  const normalized = normalizeText(serviceType).toLowerCase();
  if (filterValue === 'normal') return !normalized || normalized === 'venda' || normalized === 'normal';
  return normalized === filterValue;
}

function getImportSourceLabel(value: string) {
  if (value === 'avulsa') return 'Somente avulsa';
  if (value === 'lote') return 'Somente lote';
  return undefined;
}

function getServiceTypeLabel(value: string) {
  if (value === 'normal') return 'Venda normal';
  if (value === 'troca') return 'Troca';
  if (value === 'assistencia') return 'Assistencia';
  return undefined;
}

function sortRows(
  a: DeliveryOperationalReportRow,
  b: DeliveryOperationalReportRow,
  sortBy: FiltersState['sortBy']
) {
  const aDate = a.saleDate || '';
  const bDate = b.saleDate || '';

  if (aDate !== bDate) {
    return sortBy === 'sale_date_desc' ? bDate.localeCompare(aDate) : aDate.localeCompare(bDate);
  }

  const aForecast = a.forecastDate || '';
  const bForecast = b.forecastDate || '';
  if (aForecast !== bForecast) return aForecast.localeCompare(bForecast);

  return a.customerName.localeCompare(b.customerName);
}
