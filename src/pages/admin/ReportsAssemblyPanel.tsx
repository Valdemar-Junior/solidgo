import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, CalendarClock, CheckCircle2, Hammer, Loader2, Printer, RotateCcw, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { MultiSelect } from '../../components/ui/MultiSelect';
import { supabase } from '../../supabase/client';
import { addDaysBR, formatDateBR, todayBR } from '../../utils/dateBR';
import { calculateAssemblyStats } from '../../utils/assemblyKitLogic';
import type { AssemblyProductWithDetails } from '../../types/database';

// Painel de montagem — regras combinadas com o dono em 18 e 19/11/2026:
// - Contagem por produto; peças de kit viram 1 montagem por kit (regra de assemblyKitLogic).
// - GERADAS: cartões criados no período, montados ou não. Ignora o filtro de montador.
// - REALIZADAS: montado no período, mesmo gerado antes. Kit conta quando a ÚLTIMA peça
//   foi montada, e vai para o montador dessa última peça.
// - AGENDADAS: foto de agora das rotas com "aguardando" no nome. Ignora período e montador.
// - Troca e assistência ficam fora de GERADAS e REALIZADAS.
// - Usuários genéricos (abaixo) não entram em REALIZADAS nem na tabela.

const GENERIC_ASSEMBLER_EMAILS = new Set(['montador@solidgo.local', 'montadorteste@solidgo.local']);
const WAITING_ROUTE_PATTERN = '%aguardando%';
const PAGE_SIZE = 1000;
const IN_CHUNK_SIZE = 100;
const DAYS_PER_MONTH = 365.25 / 12;

type FiltersState = {
  startDate: string;
  endDate: string;
  cities: string[];
  assemblerIds: string[];
};

type AssemblerOption = {
  id: string;
  name: string;
  label: string;
};

type KitItem = {
  sku?: string | null;
  faz_parte_de_kit?: string | null;
  codigo_kit_pai?: string | number | null;
};

type ProductRow = {
  id: string;
  order_id: string;
  product_sku: string | null;
  product_name: string;
  status: string;
  completion_date: string | null;
  created_at: string;
  assembly_route_id: string | null;
  route: { id: string; name: string | null; assembler_id: string | null } | null;
  order: {
    id: string;
    order_id_erp: string | null;
    service_type: string | null;
    address_json: { city?: string | null } | null;
    items_json: KitItem[] | null;
    raw_items: KitItem[] | null;
  } | null;
};

type PanelData = {
  generated: ProductRow[];
  completed: ProductRow[];
  scheduled: ProductRow[];
};

type AssemblerRow = {
  id: string;
  label: string;
  completed: number;
};

const PRODUCT_SELECT = `
  id,
  order_id,
  product_sku,
  product_name,
  status,
  completion_date,
  created_at,
  assembly_route_id,
  route:assembly_routes!assembly_route_id(id, name, assembler_id),
  order:orders!order_id(id, order_id_erp, service_type, address_json, items_json, raw_items:raw_json->items)
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

// Limites do período no fuso de Brasília: [início do primeiro dia, início do dia seguinte ao último).
const periodBounds = (startDate: string, endDate: string) => ({
  from: new Date(`${startDate}T00:00:00-03:00`).toISOString(),
  to: new Date(`${addDaysBR(endDate, 1)}T00:00:00-03:00`).toISOString(),
});

const countDays = (startDate: string, endDate: string) => {
  const start = new Date(`${startDate}T12:00:00-03:00`).getTime();
  const end = new Date(`${endDate}T12:00:00-03:00`).getTime();
  return Math.round((end - start) / 86_400_000) + 1;
};

const formatNumber = (value: number, decimals = 0) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const isExchangeOrAssistance = (row: ProductRow) => {
  const serviceType = normalizeKey(row.order?.service_type);
  if (serviceType === 'TROCA' || serviceType === 'ASSISTENCIA') return true;
  return /-(A|T)-[0-9]+$/.test(normalizeText(row.order?.order_id_erp));
};

const cityOf = (row: ProductRow) => normalizeText(row.order?.address_json?.city);

// Mesma identificação de kit usada em assemblyKitLogic: item do pedido com faz_parte_de_kit = SIM.
const kitCodeOf = (row: ProductRow): string | null => {
  const items = row.order?.items_json || [];
  const rawItems = row.order?.raw_items || [];
  const orderItem = items.find((item) => item?.sku === row.product_sku);
  const rawItem = rawItems.find((item) => item?.sku === row.product_sku);
  const isKit = orderItem?.faz_parte_de_kit === 'SIM' || rawItem?.faz_parte_de_kit === 'SIM';
  const kitCode = orderItem?.codigo_kit_pai || rawItem?.codigo_kit_pai;
  return isKit && kitCode ? String(kitCode) : null;
};

// Adapta a linha para o formato que calculateAssemblyStats espera.
const toStatsInput = (rows: ProductRow[]) =>
  rows.map((row) => ({
    ...row,
    order: { ...(row.order || {}), items_json: row.order?.items_json || [], raw_json: { items: row.order?.raw_items || [] } },
  })) as unknown as AssemblyProductWithDetails[];

const countAssemblies = (rows: ProductRow[]) => calculateAssemblyStats(toStatsInput(rows)).totalItems;

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

async function fetchByIds(column: string, ids: string[]): Promise<ProductRow[]> {
  const rows: ProductRow[] = [];
  for (let index = 0; index < ids.length; index += IN_CHUNK_SIZE) {
    const chunk = ids.slice(index, index + IN_CHUNK_SIZE);
    const page = await fetchAllPages((from, to) =>
      supabase.from('assembly_products').select(PRODUCT_SELECT).in(column, chunk).order('id').range(from, to)
    );
    rows.push(...page);
  }
  return rows;
}

async function fetchPanelData(startDate: string, endDate: string): Promise<PanelData> {
  const { from, to } = periodBounds(startDate, endDate);

  const [generated, completedInPeriod, waitingRoutes] = await Promise.all([
    fetchAllPages((rangeFrom, rangeTo) =>
      supabase
        .from('assembly_products')
        .select(PRODUCT_SELECT)
        .gte('created_at', from)
        .lt('created_at', to)
        .order('id')
        .range(rangeFrom, rangeTo)
    ),
    fetchAllPages((rangeFrom, rangeTo) =>
      supabase
        .from('assembly_products')
        .select(PRODUCT_SELECT)
        .eq('status', 'completed')
        .gte('completion_date', from)
        .lt('completion_date', to)
        .order('id')
        .range(rangeFrom, rangeTo)
    ),
    supabase.from('assembly_routes').select('id').ilike('name', WAITING_ROUTE_PATTERN),
  ]);

  if (waitingRoutes.error) throw waitingRoutes.error;

  // Kit montado em dias diferentes: busca todas as peças dos kits para saber se o kit
  // ficou completo e quando a última peça foi montada.
  const kitOrderIds = Array.from(
    new Set(completedInPeriod.filter((row) => kitCodeOf(row)).map((row) => row.order_id))
  );
  const kitSiblings = kitOrderIds.length > 0 ? await fetchByIds('order_id', kitOrderIds) : [];

  const waitingRouteIds = ((waitingRoutes.data || []) as Array<{ id: string }>).map((route) => route.id);
  const scheduledAll = waitingRouteIds.length > 0 ? await fetchByIds('assembly_route_id', waitingRouteIds) : [];
  const scheduled = scheduledAll.filter((row) => row.status !== 'completed' && row.status !== 'cancelled');

  const singles = completedInPeriod.filter((row) => !kitCodeOf(row));
  const kitGroups = new Map<string, ProductRow[]>();
  kitSiblings.forEach((row) => {
    const kitCode = kitCodeOf(row);
    if (!kitCode) return;
    const key = `${row.order_id}_${kitCode}`;
    kitGroups.set(key, [...(kitGroups.get(key) || []), row]);
  });

  const completedKitPieces: ProductRow[] = [];
  kitGroups.forEach((pieces) => {
    if (!pieces.every((piece) => piece.status === 'completed' && piece.completion_date)) return;
    const last = pieces.reduce((latest, piece) =>
      (piece.completion_date || '') > (latest.completion_date || '') ? piece : latest
    );
    const lastAt = new Date(last.completion_date || '').toISOString();
    if (lastAt < from || lastAt >= to) return;
    // Todas as peças vão para a rota da última peça: o kit inteiro é do montador que o terminou.
    pieces.forEach((piece) => completedKitPieces.push({ ...piece, route: last.route }));
  });

  return {
    generated: generated.filter((row) => !isExchangeOrAssistance(row)),
    completed: [...singles, ...completedKitPieces].filter((row) => !isExchangeOrAssistance(row)),
    scheduled,
  };
}

export default function ReportsAssemblyPanel() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FiltersState>(() => createInitialFilters());
  const [assemblers, setAssemblers] = useState<AssemblerOption[]>([]);
  const [data, setData] = useState<PanelData>({ generated: [], completed: [], scheduled: [] });
  const [loading, setLoading] = useState(false);
  const [loadedPeriod, setLoadedPeriod] = useState('');

  useEffect(() => {
    const loadAssemblers = async () => {
      const { data: users, error } = await supabase
        .from('users')
        .select('id, name, email, active')
        .eq('role', 'montador')
        .order('name');
      if (error) {
        console.error('Erro ao carregar montadores do painel:', error);
        toast.error('Não foi possível carregar a lista de montadores');
        return;
      }
      setAssemblers(
        ((users || []) as Array<{ id: string; name: string | null; email: string | null; active: boolean | null }>)
          .filter((user) => !GENERIC_ASSEMBLER_EMAILS.has(normalizeText(user.email).toLowerCase()))
          .map((user) => {
            const name = normalizeText(user.name) || 'Montador sem nome';
            return { id: user.id, name, label: user.active === false ? `${name} (inativo)` : name };
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
        const result = await fetchPanelData(filters.startDate, filters.endDate);
        if (cancelled) return;
        setData(result);
        setLoadedPeriod(`${filters.startDate}|${filters.endDate}`);
      } catch (error) {
        console.error('Erro ao carregar o painel de montagem:', error);
        if (!cancelled) toast.error('Não foi possível carregar o painel de montagem');
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
    [...data.generated, ...data.completed, ...data.scheduled].forEach((row) => {
      const city = cityOf(row);
      if (city && !byKey.has(normalizeKey(city))) byKey.set(normalizeKey(city), city);
    });
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [data]);

  const view = useMemo(() => {
    const selectedCityKeys = new Set(filters.cities.map(normalizeKey));
    const inCity = (row: ProductRow) => selectedCityKeys.size === 0 || selectedCityKeys.has(normalizeKey(cityOf(row)));
    const selectedAssemblers = new Set(filters.assemblerIds);
    const assemblerOf = (row: ProductRow) => normalizeText(row.route?.assembler_id);

    const generated = data.generated.filter(inCity);
    const completed = data.completed.filter((row) => {
      const assemblerId = assemblerOf(row);
      if (!assemblerById.has(assemblerId)) return false; // sem montador ou usuário genérico
      if (selectedAssemblers.size > 0 && !selectedAssemblers.has(assemblerId)) return false;
      return inCity(row);
    });
    const scheduled = data.scheduled.filter(inCity);

    const completedByAssembler = new Map<string, ProductRow[]>();
    completed.forEach((row) => {
      const assemblerId = assemblerOf(row);
      completedByAssembler.set(assemblerId, [...(completedByAssembler.get(assemblerId) || []), row]);
    });

    const assemblerIdsToShow = new Set([...completedByAssembler.keys(), ...filters.assemblerIds]);
    const assemblerRows: AssemblerRow[] = Array.from(assemblerIdsToShow)
      .map((id) => ({
        id,
        label: assemblerById.get(id)?.label || 'Montador',
        completed: countAssemblies(completedByAssembler.get(id) || []),
      }))
      .sort((a, b) => b.completed - a.completed || a.label.localeCompare(b.label, 'pt-BR'));

    return {
      generatedCount: countAssemblies(generated),
      completedCount: countAssemblies(completed),
      scheduledCount: countAssemblies(scheduled),
      assemblerRows,
    };
  }, [data, filters.cities, filters.assemblerIds, assemblerById]);

  const days = periodValid ? countDays(filters.startDate, filters.endDate) : 0;
  const weeks = Math.max(1, days / 7);
  const months = Math.max(1, days / DAYS_PER_MONTH);
  const perWeek = (value: number) => value / weeks;
  const perMonth = (value: number) => value / months;

  const periodLabel = periodValid ? `${formatDateBR(`${filters.startDate}T12:00:00-03:00`)} a ${formatDateBR(`${filters.endDate}T12:00:00-03:00`)}` : '-';
  const citiesLabel = filters.cities.length > 0 ? filters.cities.join(', ') : 'Todas';
  const assemblersLabel =
    filters.assemblerIds.length > 0
      ? filters.assemblerIds.map((id) => assemblerById.get(id)?.label || 'Montador').join(', ')
      : 'Todos';
  const dataIsCurrent = loadedPeriod === `${filters.startDate}|${filters.endDate}` && !loading;

  const printPdf = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.');
      return;
    }
    printWindow.document.write(
      buildPrintHtml({
        periodLabel,
        citiesLabel,
        assemblersLabel,
        generated: view.generatedCount,
        completed: view.completedCount,
        scheduled: view.scheduledCount,
        perWeek,
        perMonth,
        rows: view.assemblerRows,
      })
    );
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
  };

  const totalCompletedInTable = view.assemblerRows.reduce((sum, row) => sum + row.completed, 0);

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
              <h1 className="text-2xl font-bold text-gray-900">Painel de montagem</h1>
              <p className="mt-1 text-sm text-gray-500">
                Montagens geradas, realizadas e agendadas. Kit conta como uma montagem. Troca e assistência ficam de fora.
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
            <DateField label="Início" value={filters.startDate} onChange={(value) => setFilters((prev) => ({ ...prev, startDate: value }))} />
            <DateField label="Fim" value={filters.endDate} onChange={(value) => setFilters((prev) => ({ ...prev, endDate: value }))} />
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
            <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <StatCard
                title="Geradas"
                value={view.generatedCount}
                icon={<Sparkles className="h-5 w-5" />}
                tone="bg-blue-50 text-blue-700"
                lines={[
                  `${formatNumber(perWeek(view.generatedCount), 1)} por semana`,
                  `${formatNumber(perMonth(view.generatedCount), 1)} por mês`,
                ]}
                note="Criadas no período, montadas ou não. Não usa o filtro de montador."
              />
              <StatCard
                title="Realizadas"
                value={view.completedCount}
                icon={<CheckCircle2 className="h-5 w-5" />}
                tone="bg-emerald-50 text-emerald-700"
                lines={[
                  `${formatNumber(perWeek(view.completedCount), 1)} por semana`,
                  `${formatNumber(perMonth(view.completedCount), 1)} por mês`,
                ]}
                note="Montadas no período, mesmo se geradas antes."
              />
              <StatCard
                title="Agendadas"
                value={view.scheduledCount}
                icon={<CalendarClock className="h-5 w-5" />}
                tone="bg-amber-50 text-amber-700"
                lines={['Situação de agora']}
                note="Nas rotas Aguardando (montagem, cliente e assistência). Não usa período nem montador."
              />
            </section>

            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-gray-100 px-6 py-4">
                <Hammer className="h-5 w-5 text-orange-600" />
                <h2 className="text-lg font-bold text-gray-900">Realizadas por montador</h2>
              </div>
              {view.assemblerRows.length === 0 ? (
                <p className="px-6 py-8 text-sm text-gray-500">Nenhuma montagem realizada com esses filtros.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-6 py-3">Montador</th>
                        <th className="px-6 py-3 text-right">Realizadas</th>
                        <th className="px-6 py-3 text-right">Média por semana</th>
                        <th className="px-6 py-3 text-right">Média por mês</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {view.assemblerRows.map((row) => (
                        <tr key={row.id}>
                          <td className="px-6 py-3 font-medium text-gray-900">{row.label}</td>
                          <td className="px-6 py-3 text-right">{formatNumber(row.completed)}</td>
                          <td className="px-6 py-3 text-right">{formatNumber(perWeek(row.completed), 1)}</td>
                          <td className="px-6 py-3 text-right">{formatNumber(perMonth(row.completed), 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 font-bold text-gray-900">
                      <tr>
                        <td className="px-6 py-3">Total</td>
                        <td className="px-6 py-3 text-right">{formatNumber(totalCompletedInTable)}</td>
                        <td className="px-6 py-3 text-right">{formatNumber(perWeek(totalCompletedInTable), 1)}</td>
                        <td className="px-6 py-3 text-right">{formatNumber(perMonth(totalCompletedInTable), 1)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
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

function StatCard({
  title,
  value,
  icon,
  tone,
  lines,
  note,
}: {
  title: string;
  value: number;
  icon: ReactNode;
  tone: string;
  lines: string[];
  note: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</span>
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      </div>
      <p className="mt-3 text-4xl font-bold text-gray-900">{formatNumber(value)}</p>
      <div className="mt-2 space-y-0.5 text-sm font-medium text-gray-700">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <p className="mt-3 text-xs text-gray-400">{note}</p>
    </div>
  );
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function buildPrintHtml(params: {
  periodLabel: string;
  citiesLabel: string;
  assemblersLabel: string;
  generated: number;
  completed: number;
  scheduled: number;
  perWeek: (value: number) => number;
  perMonth: (value: number) => number;
  rows: AssemblerRow[];
}) {
  const { perWeek, perMonth } = params;
  const total = params.rows.reduce((sum, row) => sum + row.completed, 0);
  const card = (title: string, value: number, lines: string[], note: string) => `
    <div class="card">
      <div class="card-title">${title}</div>
      <div class="card-value">${formatNumber(value)}</div>
      ${lines.map((line) => `<div class="card-line">${line}</div>`).join('')}
      <div class="card-note">${note}</div>
    </div>`;
  const rowsHtml = params.rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.label)}</td>
        <td class="num">${formatNumber(row.completed)}</td>
        <td class="num">${formatNumber(perWeek(row.completed), 1)}</td>
        <td class="num">${formatNumber(perMonth(row.completed), 1)}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Painel de montagem - ${escapeHtml(params.periodLabel)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  .filters { font-size: 12px; color: #374151; margin-bottom: 16px; line-height: 1.6; }
  .filters b { color: #111827; }
  .cards { display: flex; gap: 12px; margin-bottom: 20px; }
  .card { flex: 1; border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; }
  .card-title { font-size: 11px; font-weight: bold; text-transform: uppercase; color: #6b7280; }
  .card-value { font-size: 28px; font-weight: bold; margin: 4px 0; }
  .card-line { font-size: 12px; }
  .card-note { font-size: 10px; color: #6b7280; margin-top: 6px; }
  h2 { font-size: 15px; margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; }
  th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; color: #4b5563; }
  .num { text-align: right; }
  tfoot td { font-weight: bold; background: #f9fafb; }
  .footer { margin-top: 16px; font-size: 10px; color: #6b7280; }
  @page { size: A4; margin: 12mm; }
</style>
</head>
<body>
  <h1>Painel de montagem</h1>
  <div class="filters">
    <div><b>Período:</b> ${escapeHtml(params.periodLabel)}</div>
    <div><b>Cidades:</b> ${escapeHtml(params.citiesLabel)}</div>
    <div><b>Montadores:</b> ${escapeHtml(params.assemblersLabel)}</div>
  </div>
  <div class="cards">
    ${card('Geradas', params.generated, [`${formatNumber(perWeek(params.generated), 1)} por semana`, `${formatNumber(perMonth(params.generated), 1)} por mês`], 'Criadas no período, montadas ou não. Não usa o filtro de montador.')}
    ${card('Realizadas', params.completed, [`${formatNumber(perWeek(params.completed), 1)} por semana`, `${formatNumber(perMonth(params.completed), 1)} por mês`], 'Montadas no período, mesmo se geradas antes.')}
    ${card('Agendadas', params.scheduled, ['Situação no momento da impressão'], 'Nas rotas Aguardando (montagem, cliente e assistência).')}
  </div>
  <h2>Realizadas por montador</h2>
  <table>
    <thead><tr><th>Montador</th><th class="num">Realizadas</th><th class="num">Média por semana</th><th class="num">Média por mês</th></tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="4">Nenhuma montagem realizada com esses filtros.</td></tr>'}</tbody>
    <tfoot><tr><td>Total</td><td class="num">${formatNumber(total)}</td><td class="num">${formatNumber(perWeek(total), 1)}</td><td class="num">${formatNumber(perMonth(total), 1)}</td></tr></tfoot>
  </table>
  <div class="footer">Kit conta como uma montagem. Troca e assistência ficam de fora. Gerado em ${escapeHtml(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}.</div>
</body>
</html>`;
}
