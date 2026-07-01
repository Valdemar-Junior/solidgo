import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, CalendarRange, FileSpreadsheet, Hammer, Loader2, MapPin, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';
import { MultiSelect } from '../../components/ui/MultiSelect';
import { DeliverySheetGenerator } from '../../utils/pdf/deliverySheetGenerator';
import {
  AssemblyOperationalReportGenerator,
  type AssemblyOperationalReportData,
  type AssemblyOperationalReportRow,
} from '../../utils/pdf/assemblyOperationalReportGenerator';

type InstallerOption = {
  id: string;
  name: string;
};

type AssemblyRouteOption = {
  id: string;
  label: string;
  installerId: string | null;
};

type FiltersState = {
  includeCompleted: boolean;
  completedStart: string;
  completedEnd: string;
  pendingStart: string;
  pendingEnd: string;
  city: string[];
  neighborhood: string;
  filial: string;
  importSource: string;
  serviceType: string;
  installerId: string;
  routeId: string;
  sortBy: 'sale_date_asc' | 'sale_date_desc';
};

type AssemblyCompletedQueryRow = {
  order_id: string;
  status: string;
  completion_date?: string | null;
  observations?: string | null;
  assembly_route?: {
    id?: string | null;
    name?: string | null;
    route_code?: string | null;
    status?: string | null;
    assembler_id?: string | null;
    assembler?: {
      name?: string | null;
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
    previsao_montagem?: string | null;
    import_source?: string | null;
    service_type?: string | null;
  } | null;
};

type AssemblyPendingProductRow = {
  order_id: string;
  status: string;
  assembly_route_id?: string | null;
  created_at?: string | null;
  observations?: string | null;
  assembly_route?: {
    id?: string | null;
    name?: string | null;
    route_code?: string | null;
    status?: string | null;
    assembler_id?: string | null;
    created_at?: string | null;
    assembler?: {
      name?: string | null;
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
    previsao_montagem?: string | null;
    import_source?: string | null;
    service_type?: string | null;
  } | null;
};

const getToday = () => new Date().toISOString().slice(0, 10);

const createInitialFilters = (): FiltersState => {
  const today = getToday();
  return {
    includeCompleted: true,
    completedStart: today,
    completedEnd: today,
    pendingStart: '',
    pendingEnd: '',
    city: [],
    neighborhood: '',
    filial: '',
    importSource: '',
    serviceType: '',
    installerId: '',
    routeId: '',
    sortBy: 'sale_date_asc',
  };
};

const toStartOfDayIso = (value: string) => `${value}T00:00:00.000`;
const toEndOfDayIso = (value: string) => `${value}T23:59:59.999`;
const normalizeText = (value: unknown) => String(value || '').trim();
const normalizeRouteName = (value: unknown) =>
  normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
const EXCLUDED_ASSEMBLY_ROUTE_NAMES = new Set([
  'aguardando montagem',
  'sem montagem',
  'cidade sem montagem',
  'montado',
]);
const isExcludedAssemblyRoute = (routeName: unknown) =>
  EXCLUDED_ASSEMBLY_ROUTE_NAMES.has(normalizeRouteName(routeName));

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
  installerName?: string | null;
  referenceDate?: string | null;
  notes?: string | null;
}): AssemblyOperationalReportRow => ({
  orderIdErp: normalizeText(params.orderIdErp) || '-',
  customerName: normalizeText(params.customerName) || '-',
  city: normalizeText(params.city) || '-',
  neighborhood: normalizeText(params.neighborhood) || '-',
  filial: normalizeText(params.filial) || '-',
  saleDate: params.saleDate || null,
  forecastDate: params.forecastDate || null,
  routeName: params.routeName || null,
  routeCode: params.routeCode || null,
  installerName: params.installerName || null,
  referenceDate: params.referenceDate || null,
  notes: normalizeText(params.notes) || null,
});

export default function ReportsAssemblyOperational() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FiltersState>(() => createInitialFilters());
  const [cities, setCities] = useState<string[]>([]);
  const [neighborhoods, setNeighborhoods] = useState<string[]>([]);
  const [filiais, setFiliais] = useState<string[]>([]);
  const [installers, setInstallers] = useState<InstallerOption[]>([]);
  const [routes, setRoutes] = useState<AssemblyRouteOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    const loadOptions = async () => {
      try {
        setLoadingOptions(true);

        const [assemblyProductsRes, installersRes, routesRes] = await Promise.all([
          supabase
            .from('assembly_products')
            .select('order:order_id(address_json, filial_venda)')
            .limit(5000),
          supabase
            .from('users')
            .select('id, name')
            .eq('role', 'montador')
            .eq('active', true),
          supabase
            .from('assembly_routes')
            .select('id, name, route_code, assembler_id')
            .order('created_at', { ascending: false })
            .limit(1000),
        ]);

        if (assemblyProductsRes.error) throw assemblyProductsRes.error;
        if (installersRes.error) throw installersRes.error;
        if (routesRes.error) throw routesRes.error;

        const citySet = new Set<string>();
        const neighborhoodSet = new Set<string>();
        const filialSet = new Set<string>();

        ((assemblyProductsRes.data || []) as any[]).forEach((row) => {
          const city = normalizeText(row?.order?.address_json?.city);
          const neighborhood = normalizeText(row?.order?.address_json?.neighborhood);
          const filial = normalizeText(row?.order?.filial_venda);
          if (city) citySet.add(city);
          if (neighborhood) neighborhoodSet.add(neighborhood);
          if (filial) filialSet.add(filial);
        });

        setCities(Array.from(citySet).sort((a, b) => a.localeCompare(b)));
        setNeighborhoods(Array.from(neighborhoodSet).sort((a, b) => a.localeCompare(b)));
        setFiliais(Array.from(filialSet).sort((a, b) => a.localeCompare(b)));

        setInstallers(
          ((installersRes.data || []) as any[])
            .map((row) => ({
              id: String(row.id),
              name: normalizeText(row.name) || 'Montador sem nome',
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
        );

        setRoutes(
          ((routesRes.data || []) as any[])
            .filter((route) => !isExcludedAssemblyRoute(route.name))
            .map((route) => ({
              id: String(route.id),
              label: formatRouteLabel(route),
              installerId: route.assembler_id ? String(route.assembler_id) : null,
            }))
        );
      } catch (error) {
        console.error('Erro ao carregar filtros do relatorio de montagem:', error);
        toast.error('Nao foi possivel carregar os filtros do relatorio de montagem');
      } finally {
        setLoadingOptions(false);
      }
    };

    loadOptions();
  }, []);

  const routeOptionsFiltered = useMemo(() => {
    if (!filters.installerId) return routes;
    return routes.filter((route) => route.installerId === filters.installerId);
  }, [filters.installerId, routes]);

  const selectedInstaller = installers.find((installer) => installer.id === filters.installerId);
  const selectedRoute = routes.find((route) => route.id === filters.routeId);

  const updateFilter = (key: keyof FiltersState, value: string) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'installerId' && prev.routeId) {
        const selected = routes.find((route) => route.id === prev.routeId);
        if (selected && selected.installerId && selected.installerId !== value) {
          next.routeId = '';
        }
      }
      return next;
    });
  };

  const updateBooleanFilter = (key: keyof FiltersState, value: boolean) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const updateCitiesFilter = (values: string[]) => {
    setFilters((prev) => ({ ...prev, city: values }));
  };

  const validateFilters = () => {
    if (filters.includeCompleted && (!filters.completedStart || !filters.completedEnd)) {
      toast.error('Preencha o periodo de montagens concluidas antes de gerar o PDF');
      return false;
    }

    if (filters.includeCompleted && filters.completedStart > filters.completedEnd) {
      toast.error('O periodo de montagens concluidas esta invalido');
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

      const completedRows = filters.includeCompleted ? await fetchCompletedRows(filters) : [];
      const pendingData = await fetchPendingRows(filters);

      const reportData: AssemblyOperationalReportData = {
        filters: {
          includeCompleted: filters.includeCompleted,
          completedStart: filters.includeCompleted ? filters.completedStart : '',
          completedEnd: filters.includeCompleted ? filters.completedEnd : '',
          pendingStart: filters.pendingStart,
          pendingEnd: filters.pendingEnd,
          city: filters.city.length > 0 ? filters.city.join(', ') : undefined,
          neighborhood: filters.neighborhood || undefined,
          filial: filters.filial || undefined,
          importSourceLabel: getImportSourceLabel(filters.importSource),
          serviceTypeLabel: getServiceTypeLabel(filters.serviceType),
          installerName: selectedInstaller?.name,
          routeLabel: selectedRoute?.label,
          sortLabel:
            filters.sortBy === 'sale_date_asc'
              ? 'Data da venda: mais velha para mais nova'
              : 'Data da venda: mais nova para mais velha',
          generatedAt: new Date().toISOString(),
        },
        completedRows: completedRows.sort((a, b) => sortRows(a, b, filters.sortBy)),
        awaitingRouteRows: pendingData.awaitingRouteRows.sort((a, b) => sortRows(a, b, filters.sortBy)),
        routeCreatedRows: pendingData.routeCreatedRows.sort((a, b) => sortRows(a, b, filters.sortBy)),
        inProgressRows: pendingData.inProgressRows.sort((a, b) => sortRows(a, b, filters.sortBy)),
      };

      const pdfBytes = await AssemblyOperationalReportGenerator.generate(reportData);
      DeliverySheetGenerator.openPDFInNewTab(pdfBytes);
    } catch (error) {
      console.error('Erro ao gerar relatorio operacional de montagem:', error);
      toast.error('Nao foi possivel gerar o PDF do relatorio de montagem');
    } finally {
      setGenerating(false);
    }
  };

  const resetFilters = () => {
    setFilters(createInitialFilters());
  };

  return (
    <div className="w-full pb-10">
      <main className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => navigate('/admin/reports')}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para relatorios
          </button>
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Relatorio operacional de montagens</h1>
              <p className="mt-1 text-sm text-gray-500">
                Gere um PDF unico com contagem por pedidos unicos, filtrado por cidade, rota e montador.
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
                className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-orange-300"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                Gerar PDF
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <FilterCard
              icon={<CalendarRange className="h-5 w-5 text-orange-600" />}
              title="Montagens concluidas"
              description="Conta os pedidos totalmente montados no periodo pela data real de conclusao."
            >
              <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={filters.includeCompleted}
                  onChange={(event) => updateBooleanFilter('includeCompleted', event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                />
                Considerar montagens concluidas no relatorio
              </label>
              <DateField
                label="Inicio"
                value={filters.completedStart}
                onChange={(value) => updateFilter('completedStart', value)}
                disabled={!filters.includeCompleted}
              />
              <DateField
                label="Fim"
                value={filters.completedEnd}
                onChange={(value) => updateFilter('completedEnd', value)}
                disabled={!filters.includeCompleted}
              />
            </FilterCard>

            <FilterCard
              icon={<CalendarRange className="h-5 w-5 text-amber-600" />}
              title="Periodo de pendencias"
              description="Conta aguardando rota, rota criada e montagem em andamento. Se ficar em branco, usa toda a fila atual."
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
              <div className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Cidade</span>
                <MultiSelect
                  options={cities}
                  selected={filters.city}
                  onChange={updateCitiesFilter}
                  placeholder="Todas as cidades"
                  disabled={loadingOptions}
                />
              </div>
              <SelectField
                label="Bairro"
                value={filters.neighborhood}
                onChange={(value) => updateFilter('neighborhood', value)}
                options={neighborhoods}
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
              icon={<Hammer className="h-5 w-5 text-violet-600" />}
              title="Rota e montador"
              description="Se filtrar por rota ou montador, os grupos sem rota naturalmente ficam zerados."
            >
              <SelectField
                label="Montador"
                value={filters.installerId}
                onChange={(value) => updateFilter('installerId', value)}
                options={installers.map((installer) => ({ value: installer.id, label: installer.name }))}
                placeholder="Todos os montadores"
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
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:cursor-not-allowed disabled:bg-gray-100"
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
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:cursor-not-allowed disabled:bg-gray-100"
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

async function fetchCompletedRows(filters: FiltersState): Promise<AssemblyOperationalReportRow[]> {
  const { data, error } = await supabase
    .from('assembly_products')
    .select(`
      order_id,
      status,
      completion_date,
      observations,
      assembly_route:assembly_routes!assembly_route_id(
        id,
        name,
        route_code,
        status,
        assembler_id,
        assembler:users!assembler_id(name)
      ),
      order:orders!order_id(
        id,
        order_id_erp,
        customer_name,
        address_json,
        filial_venda,
        data_venda,
        previsao_montagem,
        import_source,
        service_type
      )
    `)
    .eq('status', 'completed')
    .gte('completion_date', toStartOfDayIso(filters.completedStart))
    .lte('completion_date', toEndOfDayIso(filters.completedEnd))
    .order('completion_date', { ascending: false });

  if (error) throw error;

  const completedRows = (data || []) as AssemblyCompletedQueryRow[];
  const completedOrderIds = Array.from(new Set(completedRows.map((row) => String(row.order_id || '')).filter(Boolean)));

  if (completedOrderIds.length === 0) return [];

  const { data: siblingsData, error: siblingsError } = await supabase
    .from('assembly_products')
    .select('order_id, status')
    .in('order_id', completedOrderIds);

  if (siblingsError) throw siblingsError;

  const statusesByOrder = new Map<string, string[]>();
  ((siblingsData || []) as Array<{ order_id: string; status: string }>).forEach((row) => {
    const orderId = String(row.order_id || '');
    const current = statusesByOrder.get(orderId) || [];
    current.push(normalizeText(row.status).toLowerCase());
    statusesByOrder.set(orderId, current);
  });

  const latestCompletedByOrder = new Map<string, AssemblyCompletedQueryRow>();
  completedRows.forEach((row) => {
    const orderId = String(row.order_id || '');
    const current = latestCompletedByOrder.get(orderId);
    const currentDate = current?.completion_date || '';
    const candidateDate = row.completion_date || '';
    if (!current || candidateDate > currentDate) {
      latestCompletedByOrder.set(orderId, row);
    }
  });

  return Array.from(latestCompletedByOrder.values())
    .filter((row) => {
      if (isExcludedAssemblyRoute(row.assembly_route?.name)) return false;

      const statuses = statusesByOrder.get(String(row.order_id || '')) || [];
      if (statuses.length === 0) return false;
      if (!statuses.every((status) => status === 'completed')) return false;

      return matchesGlobalFilters({
        filters,
        city: row.order?.address_json?.city,
        neighborhood: row.order?.address_json?.neighborhood,
        filial: row.order?.filial_venda,
        importSource: row.order?.import_source,
        serviceType: row.order?.service_type,
        installerId: row.assembly_route?.assembler_id,
        routeId: row.assembly_route?.id,
      });
    })
    .map((row) =>
      buildReportRow({
        orderIdErp: row.order?.order_id_erp,
        customerName: row.order?.customer_name,
        city: row.order?.address_json?.city,
        neighborhood: row.order?.address_json?.neighborhood,
        filial: row.order?.filial_venda,
        saleDate: row.order?.data_venda,
        forecastDate: row.order?.previsao_montagem,
        routeName: row.assembly_route?.name,
        routeCode: row.assembly_route?.route_code,
        installerName: row.assembly_route?.assembler?.name,
        referenceDate: row.completion_date,
        notes: row.observations,
      })
    );
}

async function fetchPendingRows(filters: FiltersState): Promise<{
  awaitingRouteRows: AssemblyOperationalReportRow[];
  routeCreatedRows: AssemblyOperationalReportRow[];
  inProgressRows: AssemblyOperationalReportRow[];
}> {
  const { data, error } = await supabase
    .from('assembly_products')
    .select(`
      order_id,
      status,
      assembly_route_id,
      created_at,
      observations,
      assembly_route:assembly_routes!assembly_route_id(
        id,
        name,
        route_code,
        status,
        assembler_id,
        created_at,
        assembler:users!assembler_id(name)
      ),
      order:orders!order_id(
        id,
        order_id_erp,
        customer_name,
        address_json,
        filial_venda,
        data_venda,
        previsao_montagem,
        import_source,
        service_type
      )
    `)
    .in('status', ['pending', 'assigned', 'in_progress'])
    .order('created_at', { ascending: false });

  if (error) throw error;

  const pendingProducts = (data || []) as AssemblyPendingProductRow[];
  const groupedByOrder = new Map<string, AssemblyPendingProductRow[]>();

  pendingProducts.forEach((row) => {
    const orderId = String(row.order_id || '');
    if (!orderId || !row.order) return;
    const current = groupedByOrder.get(orderId) || [];
    current.push(row);
    groupedByOrder.set(orderId, current);
  });

  const awaitingRouteRows: AssemblyOperationalReportRow[] = [];
  const routeCreatedRows: AssemblyOperationalReportRow[] = [];
  const inProgressRows: AssemblyOperationalReportRow[] = [];

  groupedByOrder.forEach((products) => {
    const order = products[0].order;
    if (!order) return;

    if (!matchesGlobalFilters({
      filters,
      city: order.address_json?.city,
      neighborhood: order.address_json?.neighborhood,
      filial: order.filial_venda,
      importSource: order.import_source,
      serviceType: order.service_type,
      installerId: null,
      routeId: null,
      ignoreRouteInstaller: true,
    })) {
      return;
    }

    if (!matchesPendingDate(order.previsao_montagem, filters.pendingStart, filters.pendingEnd)) return;

    const productWithoutRoute = products.find((product) => !product.assembly_route_id);
    if (productWithoutRoute) {
      if (filters.routeId || filters.installerId) return;
      awaitingRouteRows.push(
        buildReportRow({
          orderIdErp: order.order_id_erp,
          customerName: order.customer_name,
          city: order.address_json?.city,
          neighborhood: order.address_json?.neighborhood,
          filial: order.filial_venda,
          saleDate: order.data_venda,
          forecastDate: order.previsao_montagem,
          notes: null,
        })
      );
      return;
    }

    const activeRoute = products
      .map((product) => product.assembly_route)
      .filter(Boolean)
      .sort((a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')))[0];

    if (!activeRoute) return;
    if (isExcludedAssemblyRoute(activeRoute.name)) return;

    if (!matchesGlobalFilters({
      filters,
      city: order.address_json?.city,
      neighborhood: order.address_json?.neighborhood,
      filial: order.filial_venda,
      importSource: order.import_source,
      serviceType: order.service_type,
      installerId: activeRoute.assembler_id,
      routeId: activeRoute.id,
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
      forecastDate: order.previsao_montagem,
      routeName: activeRoute.name,
      routeCode: activeRoute.route_code,
      installerName: activeRoute.assembler?.name,
    });

    const routeStatus = normalizeText(activeRoute.status).toLowerCase();
    if (routeStatus === 'pending') {
      routeCreatedRows.push(baseRow);
      return;
    }

    if (routeStatus === 'in_progress') {
      inProgressRows.push(baseRow);
    }
  });

  return {
    awaitingRouteRows,
    routeCreatedRows,
    inProgressRows,
  };
}

function matchesGlobalFilters(params: {
  filters: FiltersState;
  city?: string | null;
  neighborhood?: string | null;
  filial?: string | null;
  importSource?: string | null;
  serviceType?: string | null;
  installerId?: string | null;
  routeId?: string | null;
  ignoreRouteInstaller?: boolean;
}) {
  const { filters, city, neighborhood, filial, importSource, serviceType, installerId, routeId, ignoreRouteInstaller } = params;

  if (filters.city.length > 0 && !filters.city.includes(normalizeText(city))) return false;
  if (filters.neighborhood && normalizeText(neighborhood) !== filters.neighborhood) return false;
  if (filters.filial && normalizeText(filial) !== filters.filial) return false;
  if (!matchesImportSourceFilter(filters.importSource, importSource)) return false;
  if (!matchesServiceTypeFilter(filters.serviceType, serviceType)) return false;

  if (!ignoreRouteInstaller) {
    if (filters.installerId && normalizeText(installerId) !== filters.installerId) return false;
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
  a: AssemblyOperationalReportRow,
  b: AssemblyOperationalReportRow,
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
