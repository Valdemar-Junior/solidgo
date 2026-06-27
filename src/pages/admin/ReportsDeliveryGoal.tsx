import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, CalendarRange, Eye, FileSpreadsheet, Loader2, RotateCcw, Route, Truck, UserCircle2, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { MultiSelect } from '../../components/ui/MultiSelect';
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
  type: ViewMode;
};

type FiltersState = {
  startDate: string;
  endDate: string;
  viewModes: ViewMode[];
  personIds: string[];
};

type CompletedRouteRow = {
  id: string;
  name?: string | null;
  route_code?: string | null;
  status: string;
  completed_at?: string | null;
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
const MONTHLY_PERFORMANCE_DELIVERY_TARGET = 385;
const PERFORMANCE_PERCENT_TARGET = 90;
const WEEKLY_TARGET = 120;

const createInitialFilters = (): FiltersState => ({
  startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
  endDate: new Date().toISOString().slice(0, 10),
  viewModes: ['driver', 'helper'],
  personIds: [],
});

const normalizeText = (value: unknown) => String(value || '').trim();

const formatPercent = (value: number) => `${value.toFixed(2).replace('.', ',')}%`;

const toStartOfDayIso = (date: Date) => {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  return local.toISOString();
};

const toEndOfDayIso = (date: Date) => {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  return local.toISOString();
};

const formatPeriodLabel = (startDate: string, endDate: string) => {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  return `${start.toLocaleDateString('pt-BR')} a ${end.toLocaleDateString('pt-BR')}`;
};

const getCalendarWeekSections = (startDate: string, endDate: string) => {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const result: Array<{ start: Date; end: Date; label: string }> = [];
  let current = new Date(start);

  while (current <= end) {
    const periodStart = new Date(current);
    const periodEnd = new Date(current);
    const offset = periodEnd.getDay() === 0 ? 0 : 6 - periodEnd.getDay() + 1;
    periodEnd.setDate(periodEnd.getDate() + offset);
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

const evaluateMonthlyTarget = (received: number, delivered: number) => {
  const quantityTargetMet = delivered >= MONTHLY_TARGET;
  const performancePercent = received > 0 ? (delivered / received) * 100 : 0;
  const performanceTargetMet =
    delivered >= MONTHLY_PERFORMANCE_DELIVERY_TARGET &&
    performancePercent >= PERFORMANCE_PERCENT_TARGET;

  const finalResult: DeliveryGoalPersonRow['finalResult'] = quantityTargetMet
    ? 'Meta Atingida'
    : performanceTargetMet
      ? 'Meta Atingida por Desempenho'
      : 'Meta Nao Atingida';

  const analysis = quantityTargetMet
    ? `Recebeu ${received} entregas no periodo e realizou ${delivered}, atingindo a meta mensal por quantidade de ${MONTHLY_TARGET} entregas.`
    : performanceTargetMet
      ? `Recebeu ${received} entregas no periodo e realizou ${delivered}, atingindo a meta mensal por desempenho com pelo menos ${MONTHLY_PERFORMANCE_DELIVERY_TARGET} entregas e ${formatPercent(performancePercent)} de desempenho.`
      : `Recebeu ${received} entregas no periodo, realizou ${delivered} e registrou ${received - delivered} retornos. Nao atingiu a meta mensal de ${MONTHLY_TARGET} entregas por quantidade nem os criterios de desempenho de pelo menos ${MONTHLY_PERFORMANCE_DELIVERY_TARGET} entregas e ${PERFORMANCE_PERCENT_TARGET}%.`;

  return {
    quantityTarget: MONTHLY_TARGET,
    quantityTargetMet,
    performancePercent,
    performanceTargetMet,
    finalResult,
    analysis,
  };
};

const evaluateWeeklyTarget = (received: number, delivered: number) => {
  const quantityTargetMet = delivered >= WEEKLY_TARGET;
  const performancePercent = received > 0 ? (delivered / received) * 100 : 0;

  return {
    quantityTarget: WEEKLY_TARGET,
    quantityTargetMet,
    performancePercent,
    performanceTargetMet: false,
    finalResult: quantityTargetMet ? 'Meta Atingida' as const : 'Meta Nao Atingida' as const,
    analysis: `Recebeu ${received} entregas no periodo e realizou ${delivered}. A meta semanal de ${WEEKLY_TARGET} entregas foi ${quantityTargetMet ? 'atingida' : 'nao atingida'}.`,
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
              type: 'driver' as const,
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
        );

        setHelperOptions(
          ((helpersRes.data || []) as any[])
            .filter((row) => row?.active !== false)
            .map((row) => ({
              id: String(row.id),
              name: normalizeText(row.name) || 'Ajudante sem nome',
              type: 'helper' as const,
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

  const personOptions = useMemo(() => {
    const options: PersonOption[] = [];
    if (filters.viewModes.includes('driver')) options.push(...driverOptions);
    if (filters.viewModes.includes('helper')) options.push(...helperOptions);
    return options.sort((a, b) => a.name.localeCompare(b.name));
  }, [driverOptions, filters.viewModes, helperOptions]);

  const selectedPeople = personOptions.filter((person) => filters.personIds.includes(person.id));

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
        periodLabel: formatPeriodLabel(filters.startDate, filters.endDate),
        viewLabel: getViewModesLabel(filters.viewModes),
        peopleLabel: getPeopleLabel(selectedPeople),
        quantityTarget: MONTHLY_TARGET,
        performanceDeliveryTarget: MONTHLY_PERFORMANCE_DELIVERY_TARGET,
        performancePercentTarget: PERFORMANCE_PERCENT_TARGET,
        weeklyTarget: WEEKLY_TARGET,
        showRouteDetails: selectedPeople.length === 1,
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
      ...(key === 'viewModes'
        ? { personIds: prev.personIds.filter((id) => {
            const selectedModes = value as ViewMode[];
            const option = [...driverOptions, ...helperOptions].find((person) => person.id === id);
            return option ? selectedModes.includes(option.type) : false;
          }) }
        : {}),
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
              description="Selecione o periodo mensal. O consolidado usa metas fixas e os blocos semanais exigem 120 entregas."
            >
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Inicio</span>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(event) => updateFilter('startDate', event.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Fim</span>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(event) => updateFilter('endDate', event.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
            </FilterCard>

            <FilterCard
              icon={<Users className="h-5 w-5 text-violet-600" />}
              title="Visao"
              description="Selecione uma ou mais visoes para combinar motorista e ajudante no mesmo relatorio."
            >
              <div className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Agrupamento</span>
                <MultiSelect
                  options={[
                    { value: 'driver', label: 'Motoristas' },
                    { value: 'helper', label: 'Ajudantes' },
                  ]}
                  selected={filters.viewModes}
                  onChange={(selected) => updateFilter('viewModes', selected as ViewMode[])}
                  placeholder="Selecione uma ou mais visoes"
                />
              </div>
            </FilterCard>

            <FilterCard
              icon={<UserCircle2 className="h-5 w-5 text-emerald-600" />}
              title="Pessoa"
              description="Filtre uma ou varias pessoas para gerar um PDF mais direcionado."
            >
              <div className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Pessoas</span>
                <MultiSelect
                  options={personOptions.map((person) => ({
                    value: person.id,
                    label: person.type === 'driver' ? `${person.name} (Motorista)` : `${person.name} (Ajudante)`,
                  }))}
                  selected={filters.personIds}
                  onChange={(selected) => updateFilter('personIds', selected)}
                  placeholder="Todas as pessoas"
                  disabled={loadingOptions || filters.viewModes.length === 0}
                />
              </div>
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
            value={formatPeriodLabel(filters.startDate, filters.endDate)}
            helper={getViewModesLabel(filters.viewModes)}
          />
        </section>

        <ReportTable
          title="Consolidado mensal"
          rows={previewData.monthlyRows}
          loading={loadingPreview}
          compact
        />

        {previewData.weeklySections.map((section) => (
          <ReportTable
            key={section.label}
            title={section.label}
            rows={section.rows}
            loading={loadingPreview}
            compact
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
  compact,
}: {
  title: string;
  rows: DeliveryGoalPersonRow[];
  loading: boolean;
  compact?: boolean;
}) {
  const [expandedRows, setExpandedRows] = useState<string[]>([]);

  const toggleRow = (rowId: string) => {
    setExpandedRows((prev) => (prev.includes(rowId) ? prev.filter((item) => item !== rowId) : [...prev, rowId]));
  };

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
              <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">Rotas</th>
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
              rows.map((row) => {
                const isExpanded = expandedRows.includes(row.personId);
                return (
                  <Fragment key={`${title}-${row.personId}`}>
                    <tr key={`${title}-${row.personId}`} className="align-middle">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-gray-900">{row.personName}</p>
                          <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
                            {row.personType}
                          </span>
                        </div>
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
                      <td className="px-4 py-4 text-center">
                        {row.routes.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => toggleRow(row.personId)}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                          >
                            {isExpanded ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
                            {row.routes.length} rota(s)
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">0 rota</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={9} className="bg-gray-50 px-4 py-4">
                          <div className={`grid gap-3 ${compact ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
                            {row.routes.map((route) => (
                              <div key={route.routeId} className="rounded-lg border border-gray-200 bg-white px-3 py-3">
                                <p className="text-sm font-semibold text-gray-800">{routeLabel(route)}</p>
                                <p className="mt-1 text-xs text-gray-500">
                                  Finalizada em {new Date(route.completedAt).toLocaleString('pt-BR')}
                                </p>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
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
  if (!filters.startDate || !filters.endDate) {
    return { monthlyRows: [], weeklySections: [] };
  }

  if (filters.startDate > filters.endDate) {
    throw new Error('Periodo invalido');
  }

  const start = new Date(`${filters.startDate}T00:00:00`);
  const end = new Date(`${filters.endDate}T00:00:00`);
  const { data, error } = await supabase
    .from('routes')
    .select(`
      id,
      name,
      route_code,
      status,
      completed_at,
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
    .gte('completed_at', toStartOfDayIso(start))
    .lte('completed_at', toEndOfDayIso(end))
    .order('completed_at', { ascending: true });
  if (error) throw error;

  const routes = (data || []) as CompletedRouteRow[];
  const weeks = getCalendarWeekSections(filters.startDate, filters.endDate);
  const weeklyMaps = weeks.map(() => new Map<string, AggregationBucket>());
  const monthlyMap = new Map<string, AggregationBucket>();

  routes.forEach((route) => {
    const completedAt = route.completed_at || route.updated_at || '';
    if (!completedAt) return;
    const completedDate = new Date(completedAt);
    if (Number.isNaN(completedDate.getTime())) return;

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

    const weekIndex = weeks.findIndex((week) => completedDate >= week.start && completedDate <= week.end);
    const addRole = (type: ViewMode, personId: string | null | undefined, personName: string | null | undefined) => {
      if (!filters.viewModes.includes(type)) return;
      const normalizedId = String(personId || '');
      const normalizedName = normalizeText(personName);
      if (!normalizedId || !normalizedName) return;
      if (filters.personIds.length > 0 && !filters.personIds.includes(normalizedId)) return;

      const key = `${type}:${normalizedId}`;
      const personType = type === 'driver' ? 'Motorista' : 'Ajudante';

      const monthlyEntry = monthlyMap.get(key) || createAggregationBucket(normalizedName, personType);
      monthlyEntry.received += received;
      monthlyEntry.delivered += delivered;
      monthlyEntry.returned += returned;
      monthlyEntry.routes.push(routeBreakdown);
      monthlyMap.set(key, monthlyEntry);

      if (weekIndex >= 0) {
        const weeklyEntry = weeklyMaps[weekIndex].get(key) || createAggregationBucket(normalizedName, personType);
        weeklyEntry.received += received;
        weeklyEntry.delivered += delivered;
        weeklyEntry.returned += returned;
        weeklyEntry.routes.push(routeBreakdown);
        weeklyMaps[weekIndex].set(key, weeklyEntry);
      }
    };

    addRole('driver', route.driver_id, route.driver?.user?.name);
    addRole('helper', route.helper_id, route.helper?.name);
  });

  const buildRows = (
    map: Map<string, AggregationBucket>,
    evaluate: (received: number, delivered: number) => Omit<DeliveryGoalPersonRow, 'personId' | 'personName' | 'personType' | 'received' | 'delivered' | 'returned' | 'routes'>
  ) =>
    Array.from(map.entries())
      .map(([personId, entry]) => {
        const evaluation = evaluate(entry.received, entry.delivered);
        return {
          personId,
          personName: entry.personName,
          personType: entry.personType,
          received: entry.received,
          delivered: entry.delivered,
          returned: entry.returned,
          routes: entry.routes.sort((a, b) => a.completedAt.localeCompare(b.completedAt)),
          ...evaluation,
        } satisfies DeliveryGoalPersonRow;
      })
      .sort((a, b) => a.personName.localeCompare(b.personName));

  return {
    monthlyRows: buildRows(monthlyMap, evaluateMonthlyTarget),
    weeklySections: weeks.map((week, index) => ({
      label: `Semana ${week.label}`,
      rows: buildRows(weeklyMaps[index], evaluateWeeklyTarget),
    })),
  };
}

type AggregationBucket = {
  personName: string;
  personType: string;
  received: number;
  delivered: number;
  returned: number;
  routes: DeliveryGoalRouteBreakdown[];
};

function createAggregationBucket(personName: string, personType: string): AggregationBucket {
  return {
    personName,
    personType,
    received: 0,
    delivered: 0,
    returned: 0,
    routes: [],
  };
}

function getViewModesLabel(viewModes: ViewMode[]) {
  if (viewModes.length === 0) return 'Nenhuma visao selecionada';
  if (viewModes.length === 2) return 'Motoristas e ajudantes';
  return viewModes[0] === 'driver' ? 'Motoristas' : 'Ajudantes';
}

function getPeopleLabel(people: PersonOption[]) {
  if (people.length === 0) return undefined;
  if (people.length <= 2) return people.map((person) => person.name).join(', ');
  return `${people.length} pessoas selecionadas`;
}
