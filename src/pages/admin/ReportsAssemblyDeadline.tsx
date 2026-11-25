import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlarmClock, ArrowLeft, CheckCircle2, Clock, HelpCircle, Loader2, MapPin, Printer, RotateCcw, Timer, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { MultiSelect } from '../../components/ui/MultiSelect';
import { supabase } from '../../supabase/client';
import { addDaysBR, formatDateBR, toDateBR, todayBR } from '../../utils/dateBR';
import { calculateAssemblyStats } from '../../utils/assemblyKitLogic';
import type { AssemblyProductWithDetails } from '../../types/database';

// Relatório de prazo de montagem.
// - Compara a previsão de montagem do pedido (orders.previsao_montagem) com o dia em que
//   a montagem foi concluída (assembly_products.completion_date), os dois no fuso de Brasília.
// - No prazo = montado no dia da previsão ou antes. Fora do prazo = depois; atraso em dias corridos.
// - Mesmas regras do Painel de montagem: kit vale 1 e conta no dia da ÚLTIMA peça montada,
//   indo para o montador dessa peça; troca e assistência ficam de fora; usuários genéricos não entram.
// - A rota "BAIXA DE MONTAGENS" (baixa em lote, data não real) fica de fora.
// - O período filtra a data em que a montagem foi GERADA (assembly_products.created_at). Assim
//   montagem antiga que ficou parada em rota "Aguardando" não entra no mês (pedido do dono, 25/11/2026).
// - "Ainda não montadas": geradas no período e sem montagem; mostra quantas já passaram da previsão.

const GENERIC_ASSEMBLER_EMAILS = new Set(['montador@solidgo.local', 'montadorteste@solidgo.local']);
const PAGE_SIZE = 1000;

const DELAY_BANDS: Array<{ label: string; min: number; max: number }> = [
  { label: '1 a 2 dias', min: 1, max: 2 },
  { label: '3 a 5 dias', min: 3, max: 5 },
  { label: '6 a 10 dias', min: 6, max: 10 },
  { label: '11 a 15 dias', min: 11, max: 15 },
  { label: '16 a 30 dias', min: 16, max: 30 },
  { label: 'Mais de 30 dias', min: 31, max: Number.POSITIVE_INFINITY },
];

type FiltersState = {
  startDate: string;
  endDate: string;
  cities: string[];
  assemblerIds: string[];
};

type AssemblerOption = { id: string; label: string };

type KitItem = {
  sku?: string | null;
  faz_parte_de_kit?: string | null;
  codigo_kit_pai?: string | number | null;
  nome_kit_pai?: string | null;
  qtde_receita?: number | string | null;
};

type ProductRow = {
  id: string;
  order_id: string;
  product_sku: string | null;
  product_name: string;
  status: string;
  completion_date: string | null;
  assembly_route_id: string | null;
  route: { id: string; name: string | null; assembler_id: string | null } | null;
  order: {
    id: string;
    order_id_erp: string | null;
    customer_name: string | null;
    service_type: string | null;
    previsao_montagem: string | null;
    address_json: { city?: string | null } | null;
    items_json: KitItem[] | null;
    raw_items: KitItem[] | null;
  } | null;
};

// Uma montagem (produto avulso ou kit inteiro), com o peso que ela tem na contagem.
type AssemblyUnit = {
  key: string;
  weight: number;
  orderErp: string;
  customer: string;
  city: string;
  product: string;
  assemblerId: string;
  forecastDay: string; // '' quando o pedido não tem previsão
  doneDay: string; // '' quando ainda não foi montada
  delayDays: number | null; // null sem previsão; <= 0 no prazo
};

type ReportData = {
  done: AssemblyUnit[];
  open: AssemblyUnit[];
};

type GroupRow = {
  key: string;
  label: string;
  total: number;
  onTime: number;
  late: number;
  noForecast: number;
  avgDelay: number;
  maxDelay: number;
};

const PRODUCT_SELECT = `
  id,
  order_id,
  product_sku,
  product_name,
  status,
  completion_date,
  assembly_route_id,
  route:assembly_routes!assembly_route_id(id, name, assembler_id),
  order:orders!order_id(id, order_id_erp, customer_name, service_type, previsao_montagem, address_json, items_json, raw_items:raw_json->items)
`;

const normalizeText = (value: unknown) => String(value ?? '').trim();
const normalizeKey = (value: unknown) =>
  normalizeText(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();

const firstDayOfMonthBR = () => `${todayBR().slice(0, 7)}-01`;

const createInitialFilters = (): FiltersState => ({
  startDate: firstDayOfMonthBR(),
  endDate: todayBR(),
  cities: [],
  assemblerIds: [],
});

const periodBounds = (startDate: string, endDate: string) => ({
  from: new Date(`${startDate}T00:00:00-03:00`).toISOString(),
  to: new Date(`${addDaysBR(endDate, 1)}T00:00:00-03:00`).toISOString(),
});

// Diferença em dias corridos entre dois 'YYYY-MM-DD'.
const diffDays = (fromDay: string, toDay: string) => {
  const start = new Date(`${fromDay}T12:00:00-03:00`).getTime();
  const end = new Date(`${toDay}T12:00:00-03:00`).getTime();
  return Math.round((end - start) / 86_400_000);
};

const formatNumber = (value: number, decimals = 0) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const formatPercent = (part: number, total: number) => (total > 0 ? `${formatNumber((part / total) * 100, 1)}%` : '-');

const dayLabel = (day: string) => (day ? formatDateBR(`${day}T12:00:00-03:00`) : '-');

const daysLabel = (days: number) => `${formatNumber(days)} ${days === 1 ? 'dia' : 'dias'}`;

// Rota usada para dar baixa em lote: a data de montagem dela não é real (decisão do dono, 25/11/2026).
const isWriteOffRoute = (row: ProductRow) => normalizeKey(row.route?.name).startsWith('BAIXA DE MONTAGE');

const isExchangeOrAssistance = (row: ProductRow) => {
  const serviceType = normalizeKey(row.order?.service_type);
  if (serviceType === 'TROCA' || serviceType === 'ASSISTENCIA') return true;
  return /-(A|T)-[0-9]+$/.test(normalizeText(row.order?.order_id_erp));
};

const findItem = (row: ProductRow) => {
  const orderItem = (row.order?.items_json || []).find((item) => item?.sku === row.product_sku);
  const rawItem = (row.order?.raw_items || []).find((item) => item?.sku === row.product_sku);
  return { orderItem, rawItem };
};

const kitCodeOf = (row: ProductRow): string | null => {
  const { orderItem, rawItem } = findItem(row);
  const isKit = orderItem?.faz_parte_de_kit === 'SIM' || rawItem?.faz_parte_de_kit === 'SIM';
  const kitCode = orderItem?.codigo_kit_pai || rawItem?.codigo_kit_pai;
  return isKit && kitCode ? String(kitCode) : null;
};

const kitNameOf = (row: ProductRow) => {
  const { orderItem, rawItem } = findItem(row);
  return normalizeText(orderItem?.nome_kit_pai || rawItem?.nome_kit_pai) || `Kit ${kitCodeOf(row)}`;
};

const toStatsInput = (rows: ProductRow[]) =>
  rows.map((row) => ({
    ...row,
    order: { ...(row.order || {}), items_json: row.order?.items_json || [], raw_json: { items: row.order?.raw_items || [] } },
  })) as unknown as AssemblyProductWithDetails[];

const countAssemblies = (rows: ProductRow[]) => calculateAssemblyStats(toStatsInput(rows)).totalItems;

const buildUnit = (key: string, pieces: ProductRow[], reference: ProductRow, doneDay: string, delayBaseDay: string): AssemblyUnit => {
  const forecastDay = toDateBR(reference.order?.previsao_montagem);
  const isKit = Boolean(kitCodeOf(reference));
  return {
    key,
    weight: isKit ? countAssemblies(pieces) : 1,
    orderErp: normalizeText(reference.order?.order_id_erp) || '-',
    customer: normalizeText(reference.order?.customer_name) || '-',
    city: normalizeText(reference.order?.address_json?.city),
    product: isKit ? kitNameOf(reference) : normalizeText(reference.product_name) || '-',
    assemblerId: normalizeText(reference.route?.assembler_id),
    forecastDay,
    doneDay,
    delayDays: forecastDay && delayBaseDay ? diffDays(forecastDay, delayBaseDay) : null,
  };
};

type PageResult = PromiseLike<{ data: unknown; error: unknown }>;

async function fetchAllPages(buildQuery: (from: number, to: number) => PageResult): Promise<ProductRow[]> {
  const rows: ProductRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data || []) as ProductRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function fetchReportData(startDate: string, endDate: string): Promise<ReportData> {
  const { from, to } = periodBounds(startDate, endDate);
  const today = todayBR();

  // Tudo o que foi GERADO no período. Montagem antiga (que ficou parada em rota de espera)
  // foi gerada antes e fica de fora sozinha.
  const generated = await fetchAllPages((rangeFrom, rangeTo) =>
    supabase
      .from('assembly_products')
      .select(PRODUCT_SELECT)
      .neq('status', 'cancelled')
      .gte('created_at', from)
      .lt('created_at', to)
      .order('id')
      .range(rangeFrom, rangeTo)
  );

  const done: AssemblyUnit[] = [];
  const open: AssemblyUnit[] = [];
  const kitGroups = new Map<string, ProductRow[]>();

  generated
    .filter((row) => row.order && !isExchangeOrAssistance(row))
    .forEach((row) => {
      const kitCode = kitCodeOf(row);
      if (kitCode) {
        const key = `${row.order_id}_${kitCode}`;
        kitGroups.set(key, [...(kitGroups.get(key) || []), row]);
        return;
      }
      if (isWriteOffRoute(row)) return;
      if (row.status === 'completed' && row.completion_date) {
        const doneDay = toDateBR(row.completion_date);
        done.push(buildUnit(row.id, [row], row, doneDay, doneDay));
      } else {
        open.push(buildUnit(row.id, [row], row, '', today));
      }
    });

  // Kit só está montado quando todas as peças estão; vale o dia da última peça.
  kitGroups.forEach((pieces, key) => {
    if (pieces.some(isWriteOffRoute)) return;
    const complete = pieces.every((piece) => piece.status === 'completed' && piece.completion_date);
    if (!complete) {
      open.push(buildUnit(key, pieces, pieces[0], '', today));
      return;
    }
    const last = pieces.reduce((latest, piece) =>
      (piece.completion_date || '') > (latest.completion_date || '') ? piece : latest
    );
    const doneDay = toDateBR(last.completion_date);
    done.push(buildUnit(key, pieces, last, doneDay, doneDay));
  });

  return { done, open };
}

const sumWeight = (units: AssemblyUnit[]) => units.reduce((sum, unit) => sum + unit.weight, 0);

const summarize = (units: AssemblyUnit[]) => {
  const withForecast = units.filter((unit) => unit.delayDays !== null);
  const lateUnits = withForecast.filter((unit) => (unit.delayDays ?? 0) > 0);
  const late = sumWeight(lateUnits);
  const delaySum = lateUnits.reduce((sum, unit) => sum + unit.weight * (unit.delayDays ?? 0), 0);
  return {
    total: sumWeight(units),
    onTime: sumWeight(withForecast) - late,
    late,
    noForecast: sumWeight(units.filter((unit) => unit.delayDays === null)),
    avgDelay: late > 0 ? delaySum / late : 0,
    maxDelay: lateUnits.reduce((max, unit) => Math.max(max, unit.delayDays ?? 0), 0),
  };
};

const groupBy = (units: AssemblyUnit[], keyOf: (unit: AssemblyUnit) => string, labelOf: (key: string) => string): GroupRow[] => {
  const groups = new Map<string, AssemblyUnit[]>();
  units.forEach((unit) => {
    const key = keyOf(unit);
    groups.set(key, [...(groups.get(key) || []), unit]);
  });
  return Array.from(groups.entries())
    .map(([key, groupUnits]) => ({ key, label: labelOf(key), ...summarize(groupUnits) }))
    .sort((a, b) => b.avgDelay - a.avgDelay || b.late - a.late || a.label.localeCompare(b.label, 'pt-BR'));
};

export default function ReportsAssemblyDeadline() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FiltersState>(() => createInitialFilters());
  const [assemblers, setAssemblers] = useState<AssemblerOption[]>([]);
  const [data, setData] = useState<ReportData>({ done: [], open: [] });
  const [loading, setLoading] = useState(false);
  const [loadedPeriod, setLoadedPeriod] = useState('');
  const [showAllLate, setShowAllLate] = useState(false);

  useEffect(() => {
    const loadAssemblers = async () => {
      const { data: users, error } = await supabase
        .from('users')
        .select('id, name, email, active')
        .eq('role', 'montador')
        .order('name');
      if (error) {
        console.error('Erro ao carregar montadores do relatório de prazo:', error);
        toast.error('Não foi possível carregar a lista de montadores');
        return;
      }
      setAssemblers(
        ((users || []) as Array<{ id: string; name: string | null; email: string | null; active: boolean | null }>)
          .filter((user) => !GENERIC_ASSEMBLER_EMAILS.has(normalizeText(user.email).toLowerCase()))
          .map((user) => {
            const name = normalizeText(user.name) || 'Montador sem nome';
            return { id: user.id, label: user.active === false ? `${name} (inativo)` : name };
          })
          .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
      );
    };
    void loadAssemblers();
  }, []);

  const periodValid = Boolean(filters.startDate && filters.endDate && filters.startDate <= filters.endDate);

  useEffect(() => {
    if (!periodValid) return;
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const result = await fetchReportData(filters.startDate, filters.endDate);
        if (cancelled) return;
        setData(result);
        setLoadedPeriod(`${filters.startDate}|${filters.endDate}`);
      } catch (error) {
        console.error('Erro ao carregar o relatório de prazo de montagem:', error);
        if (!cancelled) toast.error('Não foi possível carregar o relatório de prazo de montagem');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [filters.startDate, filters.endDate, periodValid]);

  const assemblerById = useMemo(() => new Map(assemblers.map((assembler) => [assembler.id, assembler])), [assemblers]);

  const cityOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    [...data.done, ...data.open].forEach((unit) => {
      if (unit.city && !byKey.has(normalizeKey(unit.city))) byKey.set(normalizeKey(unit.city), unit.city);
    });
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [data]);

  const view = useMemo(() => {
    const selectedCityKeys = new Set(filters.cities.map(normalizeKey));
    const inCity = (unit: AssemblyUnit) => selectedCityKeys.size === 0 || selectedCityKeys.has(normalizeKey(unit.city));
    const selectedAssemblers = new Set(filters.assemblerIds);

    const done = data.done.filter((unit) => {
      if (!assemblerById.has(unit.assemblerId)) return false; // sem montador ou usuário genérico
      if (selectedAssemblers.size > 0 && !selectedAssemblers.has(unit.assemblerId)) return false;
      return inCity(unit);
    });
    const open = data.open.filter(inCity);
    const openLate = open.filter((unit) => (unit.delayDays ?? 0) > 0);
    const lateUnits = done
      .filter((unit) => (unit.delayDays ?? 0) > 0)
      .sort((a, b) => (b.delayDays ?? 0) - (a.delayDays ?? 0) || a.orderErp.localeCompare(b.orderErp));

    const bands = DELAY_BANDS.map((band) => ({
      label: band.label,
      count: sumWeight(lateUnits.filter((unit) => (unit.delayDays ?? 0) >= band.min && (unit.delayDays ?? 0) <= band.max)),
    }));

    return {
      summary: summarize(done),
      open: { count: sumWeight(open), late: sumWeight(openLate) },
      generatedCount: sumWeight(done) + sumWeight(open),
      bands,
      byCity: groupBy(done, (unit) => normalizeKey(unit.city) || 'SEM CIDADE', (key) =>
        done.find((unit) => normalizeKey(unit.city) === key)?.city || 'Sem cidade'
      ),
      byAssembler: groupBy(done, (unit) => unit.assemblerId, (id) => assemblerById.get(id)?.label || 'Montador'),
      lateUnits,
    };
  }, [data, filters.cities, filters.assemblerIds, assemblerById]);

  const periodLabel = periodValid ? `${dayLabel(filters.startDate)} a ${dayLabel(filters.endDate)}` : '-';
  const citiesLabel = filters.cities.length > 0 ? filters.cities.join(', ') : 'Todas';
  const assemblersLabel =
    filters.assemblerIds.length > 0
      ? filters.assemblerIds.map((id) => assemblerById.get(id)?.label || 'Montador').join(', ')
      : 'Todos';
  const dataIsCurrent = loadedPeriod === `${filters.startDate}|${filters.endDate}` && !loading;
  const { summary } = view;
  const withForecast = summary.onTime + summary.late;
  const visibleLate = showAllLate ? view.lateUnits : view.lateUnits.slice(0, 30);

  const printPdf = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.');
      return;
    }
    printWindow.document.write(
      buildPrintHtml({ periodLabel, citiesLabel, assemblersLabel, view, assemblerById })
    );
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
  };

  return (
    <div className="w-full pb-10">
      <main className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <button
                type="button"
                onClick={() => navigate('/admin/reports')}
                className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-800"
              >
                <ArrowLeft className="h-4 w-4" />
                Voltar para relatórios
              </button>
              <h1 className="text-2xl font-bold text-gray-900">Prazo de montagem</h1>
              <p className="mt-1 text-sm text-gray-500">
                Montagens geradas no período e se foram montadas dentro da previsão do pedido. Kit conta como uma montagem. Troca, assistência e a rota Baixa de montagens ficam de fora.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFilters(createInitialFilters())}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                <RotateCcw className="h-4 w-4" />
                Limpar filtros
              </button>
              <button
                type="button"
                onClick={printPdf}
                disabled={!dataIsCurrent}
                className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
              >
                <Printer className="h-4 w-4" />
                Imprimir PDF
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <DateField label="Geradas de" value={filters.startDate} onChange={(value) => setFilters((prev) => ({ ...prev, startDate: value }))} />
            <DateField label="Até" value={filters.endDate} onChange={(value) => setFilters((prev) => ({ ...prev, endDate: value }))} />
            <div>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Cidades</span>
              <MultiSelect
                options={cityOptions}
                selected={filters.cities}
                onChange={(cities) => setFilters((prev) => ({ ...prev, cities }))}
                placeholder="Todas as cidades"
                disabled={loading}
              />
            </div>
            <div>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Montadores</span>
              <MultiSelect
                options={assemblers.map((assembler) => ({ value: assembler.id, label: assembler.label }))}
                selected={filters.assemblerIds}
                onChange={(assemblerIds) => setFilters((prev) => ({ ...prev, assemblerIds }))}
                placeholder="Todos os montadores"
              />
            </div>
          </div>
          {!periodValid && (
            <p className="mt-3 text-sm font-semibold text-red-600">A data de início precisa ser igual ou anterior à data de fim.</p>
          )}
        </section>

        {loading ? (
          <div className="flex items-center justify-center gap-3 rounded-2xl border border-gray-200 bg-white p-12 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Carregando montagens...
          </div>
        ) : (
          <>
            {/* SINTÉTICO */}
            <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                title="No prazo"
                value={formatNumber(summary.onTime)}
                icon={<CheckCircle2 className="h-5 w-5" />}
                tone="bg-emerald-50 text-emerald-700"
                line={`${formatPercent(summary.onTime, withForecast)} das montagens com previsão`}
                note="Montadas no dia da previsão ou antes."
              />
              <StatCard
                title="Fora do prazo"
                value={formatNumber(summary.late)}
                icon={<AlarmClock className="h-5 w-5" />}
                tone="bg-red-50 text-red-700"
                line={`${formatPercent(summary.late, withForecast)} das montagens com previsão`}
                note={summary.late > 0 ? `Atraso médio de ${formatNumber(summary.avgDelay, 1)} dias; o maior foi de ${daysLabel(summary.maxDelay)}.` : 'Nenhuma montagem atrasada no período.'}
              />
              <StatCard
                title="Sem previsão"
                value={formatNumber(summary.noForecast)}
                icon={<HelpCircle className="h-5 w-5" />}
                tone="bg-gray-100 text-gray-600"
                line={`de ${formatNumber(summary.total)} já montadas`}
                note="Pedido sem data de previsão de montagem. Não entram no percentual."
              />
              <StatCard
                title="Ainda não montadas"
                value={formatNumber(view.open.count)}
                icon={<Clock className="h-5 w-5" />}
                tone="bg-amber-50 text-amber-700"
                line={view.open.late > 0 ? `${formatNumber(view.open.late)} já passaram da previsão` : 'Nenhuma passou da previsão'}
                note="Geradas no período e ainda sem montagem. Não usa o filtro de montador."
              />
            </section>

            {/* ANALÍTICO: faixas de atraso */}
            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <SectionTitle icon={<Timer className="h-5 w-5 text-orange-600" />} title="Fora do prazo por dias de atraso" />
              {summary.late === 0 ? (
                <p className="px-6 py-8 text-sm text-gray-500">Nenhuma montagem fora do prazo com esses filtros.</p>
              ) : (
                <div className="space-y-3 px-6 py-5">
                  {view.bands.map((band) => (
                    <div key={band.label} className="grid grid-cols-[120px_1fr_120px] items-center gap-3 text-sm">
                      <span className="font-medium text-gray-700">{band.label}</span>
                      <div className="h-3 rounded-full bg-gray-100">
                        <div
                          className="h-3 rounded-full bg-red-500"
                          style={{ width: `${summary.late > 0 ? (band.count / summary.late) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="text-right text-gray-900">
                        <b>{formatNumber(band.count)}</b> <span className="text-gray-500">({formatPercent(band.count, summary.late)})</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <GroupTable
              icon={<MapPin className="h-5 w-5 text-orange-600" />}
              title="Atraso por cidade"
              firstColumn="Cidade"
              rows={view.byCity}
              emptyText="Nenhuma montagem com esses filtros."
            />

            <GroupTable
              icon={<Users className="h-5 w-5 text-orange-600" />}
              title="Atraso por montador"
              firstColumn="Montador"
              rows={view.byAssembler}
              emptyText="Nenhuma montagem com esses filtros."
            />

            {/* ANALÍTICO: lista */}
            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <SectionTitle icon={<AlarmClock className="h-5 w-5 text-orange-600" />} title="Montagens fora do prazo, do maior atraso para o menor" />
              {view.lateUnits.length === 0 ? (
                <p className="px-6 py-8 text-sm text-gray-500">Nenhuma montagem fora do prazo com esses filtros.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-4 py-3">Pedido</th>
                          <th className="px-4 py-3">Cliente</th>
                          <th className="px-4 py-3">Produto</th>
                          <th className="px-4 py-3">Cidade</th>
                          <th className="px-4 py-3">Montador</th>
                          <th className="px-4 py-3">Previsão</th>
                          <th className="px-4 py-3">Montado em</th>
                          <th className="px-4 py-3 text-right">Atraso</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {visibleLate.map((unit) => (
                          <tr key={unit.key}>
                            <td className="px-4 py-2 font-medium text-gray-900">{unit.orderErp}</td>
                            <td className="px-4 py-2">{unit.customer}</td>
                            <td className="px-4 py-2">{unit.product}{unit.weight !== 1 ? ` (${formatNumber(unit.weight)})` : ''}</td>
                            <td className="px-4 py-2">{unit.city || '-'}</td>
                            <td className="px-4 py-2">{assemblerById.get(unit.assemblerId)?.label || '-'}</td>
                            <td className="px-4 py-2">{dayLabel(unit.forecastDay)}</td>
                            <td className="px-4 py-2">{dayLabel(unit.doneDay)}</td>
                            <td className="px-4 py-2 text-right font-semibold text-red-700">{daysLabel(unit.delayDays ?? 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {view.lateUnits.length > 30 && (
                    <div className="border-t border-gray-100 px-6 py-3">
                      <button
                        type="button"
                        onClick={() => setShowAllLate((value) => !value)}
                        className="text-sm font-semibold text-orange-600 hover:text-orange-700"
                      >
                        {showAllLate ? 'Mostrar só os 30 maiores' : `Mostrar todas as ${formatNumber(view.lateUnits.length)}`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-orange-500 focus:outline-none"
      />
    </label>
  );
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-gray-100 px-6 py-4">
      {icon}
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
    </div>
  );
}

function StatCard({ title, value, icon, tone, line, note }: { title: string; value: string; icon: ReactNode; tone: string; line: string; note: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</span>
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      </div>
      <p className="mt-3 text-4xl font-bold text-gray-900">{value}</p>
      <p className="mt-2 text-sm font-medium text-gray-700">{line}</p>
      <p className="mt-3 text-xs text-gray-400">{note}</p>
    </div>
  );
}

function GroupTable({ icon, title, firstColumn, rows, emptyText }: { icon: ReactNode; title: string; firstColumn: string; rows: GroupRow[]; emptyText: string }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <SectionTitle icon={icon} title={title} />
      {rows.length === 0 ? (
        <p className="px-6 py-8 text-sm text-gray-500">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-6 py-3">{firstColumn}</th>
                <th className="px-6 py-3 text-right">Montadas</th>
                <th className="px-6 py-3 text-right">No prazo</th>
                <th className="px-6 py-3 text-right">Fora do prazo</th>
                <th className="px-6 py-3 text-right">% no prazo</th>
                <th className="px-6 py-3 text-right">Atraso médio</th>
                <th className="px-6 py-3 text-right">Maior atraso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="px-6 py-3 font-medium text-gray-900">{row.label}</td>
                  <td className="px-6 py-3 text-right">{formatNumber(row.total)}</td>
                  <td className="px-6 py-3 text-right text-emerald-700">{formatNumber(row.onTime)}</td>
                  <td className="px-6 py-3 text-right text-red-700">{formatNumber(row.late)}</td>
                  <td className="px-6 py-3 text-right">{formatPercent(row.onTime, row.onTime + row.late)}</td>
                  <td className="px-6 py-3 text-right">{row.late > 0 ? `${formatNumber(row.avgDelay, 1)} dias` : '-'}</td>
                  <td className="px-6 py-3 text-right">{row.late > 0 ? daysLabel(row.maxDelay) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-gray-100 px-6 py-2 text-xs text-gray-400">
        Ordenado pelo atraso médio. Atraso médio considera só as montagens fora do prazo.
      </p>
    </section>
  );
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function buildPrintHtml(params: {
  periodLabel: string;
  citiesLabel: string;
  assemblersLabel: string;
  view: {
    summary: ReturnType<typeof summarize>;
    open: { count: number; late: number };
    bands: Array<{ label: string; count: number }>;
    byCity: GroupRow[];
    byAssembler: GroupRow[];
    lateUnits: AssemblyUnit[];
  };
  assemblerById: Map<string, AssemblerOption>;
}) {
  const { view, assemblerById } = params;
  const { summary } = view;
  const withForecast = summary.onTime + summary.late;
  const card = (title: string, value: string, line: string) => `
    <div class="card"><div class="card-title">${title}</div><div class="card-value">${value}</div><div class="card-line">${line}</div></div>`;
  const groupTable = (title: string, firstColumn: string, rows: GroupRow[]) => `
    <h2>${title}</h2>
    <table>
      <thead><tr><th>${firstColumn}</th><th class="num">Montadas</th><th class="num">No prazo</th><th class="num">Fora</th><th class="num">% no prazo</th><th class="num">Atraso médio</th><th class="num">Maior atraso</th></tr></thead>
      <tbody>${
        rows
          .map(
            (row) => `<tr><td>${escapeHtml(row.label)}</td><td class="num">${formatNumber(row.total)}</td><td class="num">${formatNumber(row.onTime)}</td><td class="num">${formatNumber(row.late)}</td><td class="num">${formatPercent(row.onTime, row.onTime + row.late)}</td><td class="num">${row.late > 0 ? `${formatNumber(row.avgDelay, 1)} dias` : '-'}</td><td class="num">${row.late > 0 ? daysLabel(row.maxDelay) : '-'}</td></tr>`
          )
          .join('') || '<tr><td colspan="7">Nenhuma montagem com esses filtros.</td></tr>'
      }</tbody>
    </table>`;
  const bandsHtml = view.bands
    .map((band) => `<tr><td>${band.label}</td><td class="num">${formatNumber(band.count)}</td><td class="num">${formatPercent(band.count, summary.late)}</td></tr>`)
    .join('');
  const lateHtml = view.lateUnits
    .map(
      (unit) => `<tr><td>${escapeHtml(unit.orderErp)}</td><td>${escapeHtml(unit.customer)}</td><td>${escapeHtml(unit.product)}${unit.weight !== 1 ? ` (${formatNumber(unit.weight)})` : ''}</td><td>${escapeHtml(unit.city || '-')}</td><td>${escapeHtml(assemblerById.get(unit.assemblerId)?.label || '-')}</td><td>${dayLabel(unit.forecastDay)}</td><td>${dayLabel(unit.doneDay)}</td><td class="num">${daysLabel(unit.delayDays ?? 0)}</td></tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Prazo de montagem - ${escapeHtml(params.periodLabel)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  h2 { font-size: 15px; margin: 20px 0 8px; }
  .filters { font-size: 12px; color: #374151; margin-bottom: 16px; line-height: 1.6; }
  .filters b { color: #111827; }
  .cards { display: flex; gap: 12px; }
  .card { flex: 1; border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; }
  .card-title { font-size: 11px; font-weight: bold; text-transform: uppercase; color: #6b7280; }
  .card-value { font-size: 26px; font-weight: bold; margin: 4px 0; }
  .card-line { font-size: 11px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 5px 6px; text-align: left; }
  th { background: #f3f4f6; font-size: 10px; text-transform: uppercase; color: #4b5563; }
  .num { text-align: right; }
  .footer { margin-top: 16px; font-size: 10px; color: #6b7280; }
  @page { size: A4; margin: 12mm; }
</style>
</head>
<body>
  <h1>Prazo de montagem</h1>
  <div class="filters">
    <div><b>Geradas no período:</b> ${escapeHtml(params.periodLabel)}</div>
    <div><b>Cidades:</b> ${escapeHtml(params.citiesLabel)}</div>
    <div><b>Montadores:</b> ${escapeHtml(params.assemblersLabel)}</div>
  </div>
  <div class="cards">
    ${card('No prazo', formatNumber(summary.onTime), `${formatPercent(summary.onTime, withForecast)} das montagens com previsão`)}
    ${card('Fora do prazo', formatNumber(summary.late), summary.late > 0 ? `${formatPercent(summary.late, withForecast)} · atraso médio ${formatNumber(summary.avgDelay, 1)} dias · maior ${daysLabel(summary.maxDelay)}` : 'Nenhuma no período')}
    ${card('Sem previsão', formatNumber(summary.noForecast), `de ${formatNumber(summary.total)} já montadas`)}
    ${card('Ainda não montadas', formatNumber(view.open.count), `${formatNumber(view.open.late)} já passaram da previsão (no momento da impressão)`)}
  </div>
  <h2>Fora do prazo por dias de atraso</h2>
  <table>
    <thead><tr><th>Faixa</th><th class="num">Montagens</th><th class="num">% das atrasadas</th></tr></thead>
    <tbody>${bandsHtml}</tbody>
  </table>
  ${groupTable('Atraso por cidade', 'Cidade', view.byCity)}
  ${groupTable('Atraso por montador', 'Montador', view.byAssembler)}
  <h2>Montagens fora do prazo</h2>
  <table>
    <thead><tr><th>Pedido</th><th>Cliente</th><th>Produto</th><th>Cidade</th><th>Montador</th><th>Previsão</th><th>Montado em</th><th class="num">Atraso</th></tr></thead>
    <tbody>${lateHtml || '<tr><td colspan="8">Nenhuma montagem fora do prazo.</td></tr>'}</tbody>
  </table>
  <div class="footer">No prazo = montado no dia da previsão ou antes. Kit conta como uma montagem, no dia da última peça. Troca, assistência e a rota Baixa de montagens ficam de fora. Gerado em ${escapeHtml(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}.</div>
</body>
</html>`;
}
