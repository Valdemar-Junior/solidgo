import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, CalendarRange, Eye, FileSpreadsheet, Loader2, Route, RotateCcw, Truck, UserCircle2, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';
import { DeliverySheetGenerator } from '../../utils/pdf/deliverySheetGenerator';
import {
  DeliveryGoalReportGenerator,
  type DeliveryGoalPersonRow,
  type DeliveryGoalReportData,
  type DeliveryGoalRouteBreakdown,
  type DeliveryGoalWeekSection,
} from '../../utils/pdf/deliveryGoalReportGenerator';

type ViewMode = 'driver' | 'helper';

type PersonOption = {
  id: string;
  name: string;
};

type FiltersState = {
  month: string;
  viewMode: ViewMode;
  personId: string;
};

type CompletedRouteRow = {
  id: string;
  name?: string | null;
  route_code?: string | null;
  status: string;
  updated_at?: string | null;
  driver_id?: string | null;
  helper_id?: string | null;
  driver?: {
    id?: string | null;
    user?: {
      name?: string | null;
    } | null;
  } | null;
  helper?: {
    id?: string | null;
    name?: string | null;
  } | null;
  route_orders?: Array<{
    id: string;
    status: string;
  }> | null;
};

type PreviewData = {
  weeklySections: DeliveryGoalWeekSection[];
  monthlyRows: DeliveryGoalPersonRow[];
};

const MONTHLY_TARGET = 480;
const WEEKLY_TARGET = 120;

const getCurrentMonth = () => new Date().toISOString().slice(0, 7);

const createInitialFilters = (): FiltersState => ({
  month: getCurrentMonth(),
  viewMode: 'driver',
  personId: '',
});

const formatMonthLabel = (month: string) => {
  const [year, monthIndex] = month.split('-').map(Number);
  const date = new Date(year, (monthIndex || 1) - 1, 1);
  return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
};

const normalizeText = (value: unknown) => String(value || '').trim();

const formatPercent = (value: number) => `${value.toFixed(2).replace('.', ',')}%`;

const getMonthBounds = (month: string) => {
  const [year, monthIndex] = month.split('-').map(Number);
  const start = new Date(year, (monthIndex || 1) - 1, 1);
  const end = new Date(year, monthIndex || 1, 0);
  return { start, end };
};

const toStartOfDayIso = (date: Date) => {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  return local.toISOString();
};

const toEndOfDayIso = (date: Date) => {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  return local.toISOString();
};

const getCalendarWeekSections = (month: string) => {
  const { start, end } = getMonthBounds(month);
  const result: Array<{ start: Date; end: Date; label: string }> = [];
  let current = new Date(start);

  while (current <= end) {
    const periodStart = new Date(current);
    const periodEnd = new Date(current);
    periodEnd.setDate(periodEnd.getDate() + (6 - periodEnd.getDay()));
    if (periodEnd > end) {
      periodEnd.setTime(end.getTime());
    }

    result.push({
      start: periodStart,
      end: periodEnd,
      label: `${periodStart.toLocaleDateString('pt-BR')} a ${periodEnd.toLocaleDateString('pt-BR')}`,
    });

    current = new Date(periodEnd);
    current.setDate(current.getDate() + 1);
  }

  return result;
};

const evaluateTarget = (received: number, delivered: number, quantityTarget: number) => {
  const quantityTargetMet = received >= quantityTarget && delivered >= quantityTarget;
  const performancePercent = received > 0 ? (delivered / received) * 100 : 0;
  const performanceTargetMet = received > 0 && received < quantityTarget && performancePercent >= 90;

  const finalResult: DeliveryGoalPersonRow['finalResult'] = quantityTargetMet
    ? 'Meta Atingida'
    : performanceTargetMet
      ? 'Meta Atingida por Desempenho'
      : 'Meta Nao Atingida';

  const analysis =
    received >= quantityTarget
      ? `Recebeu ${received} entregas no periodo e realizou ${delivered}. Como o volume recebido atingiu a meta base de ${quantityTarget}, a avaliacao foi feita por quantidade e o resultado foi ${quantityTargetMet ? 'positivo' : 'negativo'}.`
      : `Recebeu ${received} entregas no periodo, realizou ${delivered} e registrou ${received - delivered} retornos. Como o volume ficou abaixo da meta base de ${quantityTarget}, a avaliacao foi feita por desempenho, alcancando ${formatPercent(performancePercent)}.`;

  return {
    quantityTarget,
    quantityTargetMet,
    performancePercent,
    performanceTargetMet,
    finalResult,
    analysis,
  };
};

const routeLabel = (route: DeliveryGoalRouteBreakdown) => {
  const base = route.routeCode ? `${route.routeCode} - ${route.routeName}` : route.routeName;
  return `${base} (${route.received}/${route.delivered}/${route.returned})`;
};

export default function ReportsDeliveryGoal() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FiltersState>(() => createInitialFilters());
  const [driverOptions, setDriverOptions] = useState<PersonOption[]>([]);
  const [helperOptions, setHelperOptions] = useState<PersonOption[]>([]);
  const [previewData, setPreviewData] = useState<PreviewData>({ weeklySections: [], monthlyRows: [] });
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  useEffect(() => {
    const loadOptions = async () => {
      try {
        setLoadingOptions(true);

        const [driversRes, helpersRes] = await Promise.all([
          supabase
            .from('drivers')
            .select('id, user:users!user_id(name, active)')
            .order('id'),
          supabase
            .from('users')
            .select('id, name, active')
            .eq('role', 'helper')
            .order('name'),
        ]);

        if (driversRes.error) throw driversRes.error;
        if (helpersRes.error) throw helpersRes.error;

        setDriverOptions(
          ((driversRes.data || []) as any[])
            .filter((row) => row?.user?.active !== false)
            .map((row) => ({
              id: String(row.id),
              name: normalizeText(row?.user?.name) || 'Motorista sem nome',
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
        );

        setHelperOptions(
          ((helpersRes.data || []) as any[])
            .filter((row) => row?.active !== false)
            .map((row) => ({
              id: String(row.id),
              name: normalizeText(row.name) || 'Ajudante sem nome',
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      } catch (error) {
        console.error('Erro ao carregar filtros do relatorio de meta:', error);
        toast.error('Nao foi possivel carregar os filtros do relatorio de meta');
      } finally {
        setLoadingOptions(false);
      }
    };

    loadOptions();
  }, []);

  const personOptions = filters.viewMode === 'driver' ? driverOptions : helperOptions;
  const selectedPerson = personOptions.find((person) => person.id === filters.personId);

  const loadPreview = async () => {
    try {
      setLoadingPreview(true);
      const data = await fetchPreviewData(filters);
      setPreviewData(data);
    } catch (error) {
      console.error('Erro ao gerar previa do relatorio de meta:', error);
      toast.error('Nao foi possivel gerar a previa do relatorio');
    } finally {
      setLoadingPreview(false);
    }
  };

  useEffect(() => {
    if (loadingOptions) return;
    void loadPreview();
  }, [loadingOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetFilters = () => {
    setFilters(createInitialFilters());
  };

  const generatePdf = async () => {
    try {
      setGeneratingPdf(true);
      const freshData = await fetchPreviewData(filters);
      setPreviewData(freshData);

      const reportData: DeliveryGoalReportData = {
        monthLabel: formatMonthLabel(filters.month),
        viewLabel: filters.viewMode === 'driver' ? 'Motoristas' : 'Ajudantes',
        personLabel: selectedPerson?.name,
        generatedAt: new Date().toISOString(),
        weeklySections: freshData.weeklySections,
        monthlyRows: freshData.monthlyRows,
      };

      const pdfBytes = await DeliveryGoalReportGenerator.generate(reportData);
      DeliverySheetGenerator.openPDFInNewTab(pdfBytes);
    } catch (error) {
      console.error('Erro ao gerar PDF do relatorio de meta:', error);
      toast.error('Nao foi possivel gerar o PDF do relatorio');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const updateFilter = <K extends keyof FiltersState>(key: K, value: FiltersState[K]) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
      ...(key === 'viewMode' ? { personId: '' } : {}),
    }));
  };

  const monthlyApprovedCount = useMemo(
    () => previewData.monthlyRows.filter((row) => row.finalResult !== 'Meta Nao Atingida').length,
    [previewData.monthlyRows]
  );

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

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Relatorio de meta de entrega</h1>
              <p className="mt-1 text-sm text-gray-500">
                Avalie motoristas e ajudantes com base em rotas finalizadas no mes, com detalhamento por rota para conferencia.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={resetFilters}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                <RotateCcw className="h-4 w-4" />
                Limpar filtros
              </button>
              <button
                onClick={() => void loadPreview()}
                disabled={loadingOptions || loadingPreview}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed"
              >
                {loadingPreview ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                Atualizar previa
              </button>
              <button
                onClick={generatePdf}
                disabled={loadingOptions || generatingPdf}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {generatingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                Gerar PDF
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <FilterCard
              icon={<CalendarRange className="h-5 w-5 text-blue-600" />}
              title="Periodo"
              description="O relatorio considera um unico mes e agrupa por semanas calendario dentro dele."
            >
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Mes</span>
                <input
                  type="month"
                  value={filters.month}
                  onChange={(event) => updateFilter('month', event.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
            </FilterCard>

            <FilterCard
              icon={<Users className="h-5 w-5 text-violet-600" />}
              title="Visao"
              description="Escolha se a avaliacao sera por motorista ou por ajudante."
            >
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Agrupamento</span>
                <select
                  value={filters.viewMode}
                  onChange={(event) => updateFilter('viewMode', event.target.value as ViewMode)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="driver">Motoristas</option>
                  <option value="helper">Ajudantes</option>
                </select>
              </label>
            </FilterCard>

            <FilterCard
              icon={<UserCircle2 className="h-5 w-5 text-emerald-600" />}
              title="Pessoa"
              description="Filtre uma pessoa especifica para gerar um PDF individual."
            >
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {filters.viewMode === 'driver' ? 'Motorista' : 'Ajudante'}
                </span>
                <select
                  value={filters.personId}
                  disabled={loadingOptions}
                  onChange={(event) => updateFilter('personId', event.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-100"
                >
                  <option value="">Todos</option>
                  {personOptions.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
            </FilterCard>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <SummaryTile
            icon={<Truck className="h-5 w-5 text-blue-700" />}
            title="Pessoas avaliadas"
            value={previewData.monthlyRows.length}
            helper="Linhas consolidadas no mes selecionado."
          />
          <SummaryTile
            icon={<Route className="h-5 w-5 text-emerald-700" />}
            title="Metas aprovadas"
            value={monthlyApprovedCount}
            helper="Soma de meta atingida direta e por desempenho."
          />
          <SummaryTile
            icon={<CalendarRange className="h-5 w-5 text-amber-700" />}
            title="Periodo"
            value={formatMonthLabel(filters.month)}
            helper={filters.viewMode === 'driver' ? 'Visao por motoristas.' : 'Visao por ajudantes.'}
          />
        </section>

        <ReportTable
          title="Consolidado mensal"
          rows={previewData.monthlyRows}
          loading={loadingPreview}
        />

        {previewData.weeklySections.map((section) => (
          <ReportTable
            key={section.label}
            title={section.label}
            rows={section.rows}
            loading={loadingPreview}
          />
        ))}
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

function SummaryTile({
  icon,
  title,
  value,
  helper,
}: {
  icon: ReactNode;
  title: string;
  value: number | string;
  helper: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-gray-50 p-3">{icon}</div>
        <div>
          <p className="text-sm font-semibold text-gray-500">{title}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-gray-500">{helper}</p>
    </div>
  );
}

function ReportTable({
  title,
  rows,
  loading,
}: {
  title: string;
  rows: DeliveryGoalPersonRow[];
  loading: boolean;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-6 py-4">
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Pessoa</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Recebido</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Entregue</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Retornado</th>
              <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">Meta qtd.</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">% desempenho</th>
              <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">Meta desp.</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Resultado</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Rotas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-500">
                  Carregando previa...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-500">
                  Nenhum registro encontrado para este periodo.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${title}-${row.personId}`} className="align-top">
                  <td className="px-4 py-4">
                    <p className="font-semibold text-gray-900">{row.personName}</p>
                    <p className="mt-1 text-xs leading-5 text-gray-500">{row.analysis}</p>
                  </td>
                  <td className="px-4 py-4 text-right font-semibold text-gray-900">{row.received}</td>
                  <td className="px-4 py-4 text-right font-semibold text-gray-900">{row.delivered}</td>
                  <td className="px-4 py-4 text-right font-semibold text-gray-900">{row.returned}</td>
                  <td className="px-4 py-4 text-center">
                    <StatusBadge ok={row.quantityTargetMet} trueLabel="Sim" falseLabel="Nao" />
                  </td>
                  <td className="px-4 py-4 text-right font-semibold text-gray-900">{formatPercent(row.performancePercent)}</td>
                  <td className="px-4 py-4 text-center">
                    <StatusBadge ok={row.performanceTargetMet} trueLabel="Sim" falseLabel="Nao" />
                  </td>
                  <td className="px-4 py-4">
                    <ResultBadge result={row.finalResult} />
                  </td>
                  <td className="px-4 py-4">
                    <div className="space-y-2">
                      {row.routes.map((route) => (
                        <div key={route.routeId} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                          <p className="text-sm font-semibold text-gray-800">{routeLabel(route)}</p>
                          <p className="mt-1 text-xs text-gray-500">
                            Finalizada em {new Date(route.completedAt).toLocaleString('pt-BR')}
                          </p>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusBadge({
  ok,
  trueLabel,
  falseLabel,
}: {
  ok: boolean;
  trueLabel: string;
  falseLabel: string;
}) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {ok ? trueLabel : falseLabel}
    </span>
  );
}

function ResultBadge({
  result,
}: {
  result: DeliveryGoalPersonRow['finalResult'];
}) {
  const className =
    result === 'Meta Atingida'
      ? 'bg-green-100 text-green-700'
      : result === 'Meta Atingida por Desempenho'
        ? 'bg-blue-100 text-blue-700'
        : 'bg-red-100 text-red-700';

  const label = result === 'Meta Nao Atingida' ? 'Meta nao atingida' : result;

  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${className}`}>{label}</span>;
}

async function fetchPreviewData(filters: FiltersState): Promise<PreviewData> {
  const { start, end } = getMonthBounds(filters.month);
  let query = supabase
    .from('routes')
    .select(`
      id,
      name,
      route_code,
      status,
      updated_at,
      driver_id,
      helper_id,
      driver:drivers!driver_id(
        id,
        user:users!user_id(name)
      ),
      helper:users!routes_helper_id_fkey(
        id,
        name
      ),
      route_orders(
        id,
        status
      )
    `)
    .eq('status', 'completed')
    .gte('updated_at', toStartOfDayIso(start))
    .lte('updated_at', toEndOfDayIso(end))
    .order('updated_at', { ascending: true });

  if (filters.viewMode === 'driver' && filters.personId) {
    query = query.eq('driver_id', filters.personId);
  }

  if (filters.viewMode === 'helper' && filters.personId) {
    query = query.eq('helper_id', filters.personId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const routes = ((data || []) as CompletedRouteRow[]).filter((route) => {
    if (filters.viewMode === 'driver') {
      return !!route.driver_id && !!normalizeText(route.driver?.user?.name);
    }
    return !!route.helper_id && !!normalizeText(route.helper?.name);
  });

  const weeks = getCalendarWeekSections(filters.month);
  const weeklyMaps = weeks.map(() => new Map<string, {
    personName: string;
    received: number;
    delivered: number;
    returned: number;
    routes: DeliveryGoalRouteBreakdown[];
  }>());
  const monthlyMap = new Map<string, {
    personName: string;
    received: number;
    delivered: number;
    returned: number;
    routes: DeliveryGoalRouteBreakdown[];
  }>();

  routes.forEach((route) => {
    const completedAt = route.updated_at || '';
    if (!completedAt) return;
    const completedDate = new Date(completedAt);
    if (Number.isNaN(completedDate.getTime())) return;

    const personId = filters.viewMode === 'driver' ? String(route.driver_id || '') : String(route.helper_id || '');
    const personName =
      filters.viewMode === 'driver'
        ? normalizeText(route.driver?.user?.name)
        : normalizeText(route.helper?.name);

    if (!personId || !personName) return;

    const received = route.route_orders?.length || 0;
    const delivered = route.route_orders?.filter((item) => item.status === 'delivered').length || 0;
    const returned = route.route_orders?.filter((item) => item.status === 'returned').length || 0;

    const routeBreakdown: DeliveryGoalRouteBreakdown = {
      routeId: route.id,
      routeName: normalizeText(route.name) || 'Rota sem nome',
      routeCode: route.route_code || null,
      completedAt,
      received,
      delivered,
      returned,
    };

    const monthlyEntry = monthlyMap.get(personId) || {
      personName,
      received: 0,
      delivered: 0,
      returned: 0,
      routes: [],
    };
    monthlyEntry.received += received;
    monthlyEntry.delivered += delivered;
    monthlyEntry.returned += returned;
    monthlyEntry.routes.push(routeBreakdown);
    monthlyMap.set(personId, monthlyEntry);

    const weekIndex = weeks.findIndex((week) => completedDate >= week.start && completedDate <= week.end);
    if (weekIndex < 0) return;

    const weeklyEntry = weeklyMaps[weekIndex].get(personId) || {
      personName,
      received: 0,
      delivered: 0,
      returned: 0,
      routes: [],
    };
    weeklyEntry.received += received;
    weeklyEntry.delivered += delivered;
    weeklyEntry.returned += returned;
    weeklyEntry.routes.push(routeBreakdown);
    weeklyMaps[weekIndex].set(personId, weeklyEntry);
  });

  const buildRows = (
    map: Map<string, {
      personName: string;
      received: number;
      delivered: number;
      returned: number;
      routes: DeliveryGoalRouteBreakdown[];
    }>,
    quantityTarget: number
  ) =>
    Array.from(map.entries())
      .map(([personId, entry]) => {
        const evaluation = evaluateTarget(entry.received, entry.delivered, quantityTarget);
        return {
          personId,
          personName: entry.personName,
          received: entry.received,
          delivered: entry.delivered,
          returned: entry.returned,
          routes: entry.routes.sort((a, b) => a.completedAt.localeCompare(b.completedAt)),
          ...evaluation,
        } satisfies DeliveryGoalPersonRow;
      })
      .sort((a, b) => a.personName.localeCompare(b.personName));

  return {
    monthlyRows: buildRows(monthlyMap, MONTHLY_TARGET),
    weeklySections: weeks.map((week, index) => ({
      label: `Semana ${week.label}`,
      rows: buildRows(weeklyMaps[index], WEEKLY_TARGET),
    })),
  };
}
