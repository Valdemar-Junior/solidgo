import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Loader2,
  PackageCheck,
  PackageSearch,
  RotateCcw,
  Search,
  Truck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';
import { DeliverySheetGenerator } from '../../utils/pdf/deliverySheetGenerator';
import {
  ProductCommitmentReportGenerator,
  type ProductCommitmentReportRow,
  type ProductCommitmentReportSummary,
} from '../../utils/pdf/productCommitmentReportGenerator';

type Situation = 'reserved' | 'delivered';

type FiltersState = {
  search: string;
  saleStart: string;
  saleEnd: string;
  situations: Situation[];
  pageSize: number;
};

type RpcPayload = {
  rows?: ProductCommitmentReportRow[];
  summary?: Partial<ProductCommitmentReportSummary>;
};

const EMPTY_SUMMARY: ProductCommitmentReportSummary = {
  reservedUnits: 0,
  deliveredUnits: 0,
  awaitingRouteUnits: 0,
  separatingUnits: 0,
  inRouteUnits: 0,
  totalRecords: 0,
  distinctProducts: 0,
  page: 0,
  pageSize: 50,
};

const createInitialFilters = (): FiltersState => ({
  search: '',
  saleStart: '',
  saleEnd: '',
  situations: ['reserved'],
  pageSize: 50,
});

const normalizeSummary = (value?: Partial<ProductCommitmentReportSummary> & Record<string, unknown>): ProductCommitmentReportSummary => ({
  reservedUnits: Number(value?.reservedUnits ?? value?.reserved_units ?? 0),
  deliveredUnits: Number(value?.deliveredUnits ?? value?.delivered_units ?? 0),
  awaitingRouteUnits: Number(value?.awaitingRouteUnits ?? value?.awaiting_route_units ?? 0),
  separatingUnits: Number(value?.separatingUnits ?? value?.separating_units ?? 0),
  inRouteUnits: Number(value?.inRouteUnits ?? value?.in_route_units ?? 0),
  totalRecords: Number(value?.totalRecords ?? value?.total_records ?? 0),
  distinctProducts: Number(value?.distinctProducts ?? value?.distinct_products ?? 0),
  page: Number(value?.page ?? 0),
  pageSize: Number(value?.pageSize ?? value?.page_size ?? 50),
});

const formatQuantity = (value: number | string | null | undefined) => {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
};

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString('pt-BR');
};

const formatMoney = (value?: number | string | null) => {
  if (value === null || value === undefined || value === '') return '-';
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const STATUS_META: Record<ProductCommitmentReportRow['report_status'], { label: string; className: string }> = {
  awaiting_route: { label: 'Aguardando rota', className: 'bg-amber-100 text-amber-800' },
  separating: { label: 'Em separacao', className: 'bg-violet-100 text-violet-800' },
  in_route: { label: 'Em rota', className: 'bg-blue-100 text-blue-800' },
  delivered: { label: 'Entregue', className: 'bg-emerald-100 text-emerald-800' },
};

export default function ReportsProductCommitment() {
  const navigate = useNavigate();
  const [draftFilters, setDraftFilters] = useState<FiltersState>(() => createInitialFilters());
  const [appliedFilters, setAppliedFilters] = useState<FiltersState>(() => createInitialFilters());
  const [rows, setRows] = useState<ProductCommitmentReportRow[]>([]);
  const [summary, setSummary] = useState<ProductCommitmentReportSummary>(EMPTY_SUMMARY);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const loadReport = async (filters: FiltersState, requestedPage: number) => {
    if (filters.saleStart && filters.saleEnd && filters.saleStart > filters.saleEnd) {
      toast.error('O periodo da venda esta invalido');
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('get_product_commitment_report', {
        p_search: filters.search.trim() || null,
        p_sale_start: filters.saleStart || null,
        p_sale_end: filters.saleEnd || null,
        p_situations: filters.situations,
        p_page: requestedPage,
        p_page_size: filters.pageSize,
      });

      if (error) throw error;

      const payload = (data || {}) as RpcPayload;
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
      setSummary(normalizeSummary((payload.summary || {}) as Partial<ProductCommitmentReportSummary> & Record<string, unknown>));
      setPage(requestedPage);
    } catch (error) {
      console.error('Erro ao carregar relatorio de produtos comprometidos:', error);
      toast.error('Nao foi possivel carregar o relatorio de produtos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport(createInitialFilters(), 0);
  }, []);

  const totalPages = Math.max(1, Math.ceil(summary.totalRecords / appliedFilters.pageSize));

  const periodLabel = useMemo(() => {
    if (!appliedFilters.saleStart && !appliedFilters.saleEnd) return 'Todas as vendas';
    return `${appliedFilters.saleStart ? formatDate(`${appliedFilters.saleStart}T00:00:00`) : 'Inicio'} a ${appliedFilters.saleEnd ? formatDate(`${appliedFilters.saleEnd}T00:00:00`) : 'Hoje'}`;
  }, [appliedFilters.saleEnd, appliedFilters.saleStart]);

  const applyFilters = () => {
    if (draftFilters.situations.length === 0) {
      toast.error('Selecione Reserva ou Entregue');
      return;
    }
    const next = { ...draftFilters };
    setAppliedFilters(next);
    void loadReport(next, 0);
  };

  const resetFilters = () => {
    const next = createInitialFilters();
    setDraftFilters(next);
    setAppliedFilters(next);
    void loadReport(next, 0);
  };

  const toggleSituation = (situation: Situation) => {
    setDraftFilters((current) => ({
      ...current,
      situations: current.situations.includes(situation)
        ? current.situations.filter((item) => item !== situation)
        : [...current.situations, situation],
    }));
  };

  const changePage = (nextPage: number) => {
    if (nextPage < 0 || nextPage >= totalPages || loading) return;
    void loadReport(appliedFilters, nextPage);
  };

  const generatePdf = async () => {
    try {
      setGeneratingPdf(true);
      const bytes = await ProductCommitmentReportGenerator.generate({
        rows,
        summary,
        filters: {
          search: appliedFilters.search,
          situations: appliedFilters.situations,
          periodLabel,
          page: page + 1,
          totalPages,
          generatedAt: new Date().toISOString(),
        },
      });
      DeliverySheetGenerator.openPDFInNewTab(bytes);
    } catch (error) {
      console.error('Erro ao gerar PDF do relatorio de produtos:', error);
      toast.error('Nao foi possivel gerar o PDF');
    } finally {
      setGeneratingPdf(false);
    }
  };

  return (
    <div className="w-full pb-10">
      <main className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
        <button
          onClick={() => navigate('/admin/reports')}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para relatorios
        </button>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Relatorio de produtos comprometidos</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500">
                Consulte unidades compradas reservadas para entrega ou ja entregues. Devolucoes nao entram no relatorio.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={resetFilters} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
                <RotateCcw className="h-4 w-4" /> Limpar filtros
              </button>
              <button
                onClick={generatePdf}
                disabled={generatingPdf || loading || rows.length === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                title="Gera somente a pagina visivel para evitar consumo adicional de dados"
              >
                {generatingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                PDF da pagina
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
            <label className="lg:col-span-4">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Produto ou SKU</span>
              <input
                value={draftFilters.search}
                onChange={(event) => setDraftFilters((current) => ({ ...current, search: event.target.value }))}
                onKeyDown={(event) => { if (event.key === 'Enter') applyFilters(); }}
                placeholder="Ex.: Roupeiro Chicago"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>

            <div className="lg:col-span-3">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Situacao</span>
              <div className="flex h-[38px] items-center gap-4 rounded-lg border border-gray-300 px-3">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={draftFilters.situations.includes('reserved')} onChange={() => toggleSituation('reserved')} /> Reserva
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={draftFilters.situations.includes('delivered')} onChange={() => toggleSituation('delivered')} /> Entregue
                </label>
              </div>
            </div>

            <label className="lg:col-span-2">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Venda inicial</span>
              <input type="date" value={draftFilters.saleStart} onChange={(event) => setDraftFilters((current) => ({ ...current, saleStart: event.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>

            <label className="lg:col-span-2">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Venda final</span>
              <input type="date" value={draftFilters.saleEnd} onChange={(event) => setDraftFilters((current) => ({ ...current, saleEnd: event.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>

            <button
              onClick={applyFilters}
              disabled={loading}
              className="mt-auto inline-flex h-[38px] items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 lg:col-span-1"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Buscar
            </button>
          </div>

          <p className="mt-3 text-xs text-gray-500">
            Sem periodo, todas as reservas atuais sao consideradas. A consulta retorna no maximo {appliedFilters.pageSize} linhas por pagina.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard icon={<PackageSearch className="h-5 w-5 text-amber-700" />} label="Unidades reservadas" value={formatQuantity(summary.reservedUnits)} helper={`${formatQuantity(summary.distinctProducts)} produto(s) distinto(s)`} />
          <SummaryCard icon={<PackageCheck className="h-5 w-5 text-emerald-700" />} label="Unidades entregues" value={formatQuantity(summary.deliveredUnits)} helper="Conforme os filtros aplicados" />
          <SummaryCard icon={<Truck className="h-5 w-5 text-blue-700" />} label="Em separacao / rota" value={`${formatQuantity(summary.separatingUnits)} / ${formatQuantity(summary.inRouteUnits)}`} helper={`${formatQuantity(summary.awaitingRouteUnits)} aguardando rota`} />
          <SummaryCard icon={<FileSpreadsheet className="h-5 w-5 text-violet-700" />} label="Registros encontrados" value={formatQuantity(summary.totalRecords)} helper={periodLabel} />
        </section>

        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Produtos por cliente</h2>
              <p className="text-xs text-gray-500">Quantidade baseada na quantidade comprada.</p>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-500">
              Linhas
              <select
                value={draftFilters.pageSize}
                onChange={(event) => setDraftFilters((current) => ({ ...current, pageSize: Number(event.target.value) }))}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[1180px] w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <TableHead>Produto</TableHead>
                  <TableHead align="right">Qtd.</TableHead>
                  <TableHead>Situacao</TableHead>
                  <TableHead>Cliente / Pedido</TableHead>
                  <TableHead>Venda</TableHead>
                  <TableHead>Previsao</TableHead>
                  <TableHead>Informacoes da venda</TableHead>
                  <TableHead>Rota</TableHead>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-gray-500"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Carregando...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-gray-500">Nenhum produto encontrado.</td></tr>
                ) : rows.map((row, index) => {
                  const status = STATUS_META[row.report_status] || STATUS_META.awaiting_route;
                  const routeLabel = row.route_code || row.route_name
                    ? `${row.route_code || ''}${row.route_code && row.route_name ? ' - ' : ''}${row.route_name || ''}`
                    : '-';
                  return (
                    <tr key={`${row.order_id}-${row.product_sku}-${index}`} className="align-top hover:bg-gray-50/70">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-900">{row.product_name}</p>
                        <p className="mt-1 text-xs text-gray-500">SKU: {row.product_sku}</p>
                        <p className="mt-1 text-[11px] font-medium text-indigo-600">
                          Reserva: {formatQuantity(row.product_reserved_units)} · Entregue: {formatQuantity(row.product_delivered_units)}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right text-lg font-bold text-gray-900">{formatQuantity(row.purchased_quantity)}</td>
                      <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${status.className}`}>{status.label}</span></td>
                      <td className="px-4 py-3"><p className="font-medium text-gray-900">{row.customer_name}</p><p className="mt-1 text-xs text-gray-500">Pedido {row.order_id_erp}</p></td>
                      <td className="px-4 py-3 text-sm text-gray-700">{formatDate(row.sale_date)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{formatDate(row.forecast_date)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700"><p>{row.branch || '-'}</p><p className="mt-1 text-xs text-gray-500">{row.seller_name || 'Vendedor nao informado'} · {formatMoney(row.unit_price)}</p></td>
                      <td className="px-4 py-3 text-sm text-gray-700"><p className="font-medium">{routeLabel}</p><p className="mt-1 text-xs text-gray-500">{row.driver_name || 'Sem motorista'}</p></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-4">
            <p className="text-sm text-gray-500">Pagina {page + 1} de {totalPages}</p>
            <div className="flex gap-2">
              <button onClick={() => changePage(page - 1)} disabled={page === 0 || loading} className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 disabled:opacity-40" title="Pagina anterior"><ChevronLeft className="h-4 w-4" /></button>
              <button onClick={() => changePage(page + 1)} disabled={page + 1 >= totalPages || loading} className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 disabled:opacity-40" title="Proxima pagina"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function SummaryCard({ icon, label, value, helper }: { icon: ReactNode; label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-gray-50 p-3">{icon}</div><div><p className="text-sm font-semibold text-gray-500">{label}</p><p className="mt-1 text-2xl font-bold text-gray-900">{value}</p></div></div>
      <p className="mt-3 text-xs text-gray-500">{helper}</p>
    </div>
  );
}

function TableHead({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return <th className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 ${align === 'right' ? 'text-right' : 'text-left'}`}>{children}</th>;
}
