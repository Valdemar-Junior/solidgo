import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, CalendarRange, Eye, FileSpreadsheet, Loader2, Package, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';
import { isAssemblyRequired } from '../../utils/assembly/syncAssemblyProducts';
import { DeliverySheetGenerator } from '../../utils/pdf/deliverySheetGenerator';
import {
  WithdrawalReportGenerator,
  type WithdrawalReportData,
  type WithdrawalReportRow,
} from '../../utils/pdf/withdrawalReportGenerator';

type WithdrawalReportPreset = 'today' | 'yesterday' | 'last7' | 'month' | 'custom';

type FiltersState = {
  preset: WithdrawalReportPreset;
  startDate: string;
  endDate: string;
};

type WithdrawalQueryRow = {
  id: string;
  responsible_name?: string | null;
  notes?: string | null;
  withdrawn_at?: string | null;
  registered_by_name?: string | null;
  source?: string | null;
  legacy_route_id?: string | null;
  order?: {
    id: string;
    order_id_erp?: string | null;
    customer_name?: string | null;
    address_json?: Record<string, any> | null;
    items_json?: any[] | string | null;
    previsao_montagem?: string | null;
  } | null;
};

type WithdrawalItemRow = {
  label: string;
  hasAssembly: boolean;
};

type PreviewRow = {
  id: string;
  orderId: string;
  orderIdErp: string;
  customerName: string;
  addressLine: string;
  responsibleName: string;
  registeredByName: string;
  withdrawnAt: string;
  notes: string | null;
  source: string;
  items: WithdrawalItemRow[];
  hasAssemblyItems: boolean;
  assemblyGenerated: boolean;
};

const PRESET_LABELS: Record<WithdrawalReportPreset, string> = {
  today: 'Hoje',
  yesterday: 'Ontem',
  last7: 'Ultimos 7 dias',
  month: 'Mes atual',
  custom: 'Intervalo',
};

const normalizeText = (value: unknown) => String(value || '').trim();

const toLocalDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toStartOfDayIso = (value: string) => `${value}T00:00:00.000`;
const toEndOfDayIso = (value: string) => `${value}T23:59:59.999`;

const createPresetRange = (preset: Exclude<WithdrawalReportPreset, 'custom'>) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (preset === 'today') {
    const current = toLocalDateInput(today);
    return { startDate: current, endDate: current };
  }

  if (preset === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const current = toLocalDateInput(yesterday);
    return { startDate: current, endDate: current };
  }

  if (preset === 'last7') {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return {
      startDate: toLocalDateInput(start),
      endDate: toLocalDateInput(today),
    };
  }

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    startDate: toLocalDateInput(monthStart),
    endDate: toLocalDateInput(today),
  };
};

const createInitialFilters = (): FiltersState => {
  const period = createPresetRange('month');
  return {
    preset: 'month',
    ...period,
  };
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR');
};

const formatAddressLine = (address: Record<string, any> | null | undefined) => {
  if (!address || typeof address !== 'object') return '-';

  const street = normalizeText(address.street || address.rua || address.endereco);
  const number = normalizeText(address.number || address.numero);
  const neighborhood = normalizeText(address.neighborhood || address.bairro);
  const city = normalizeText(address.city || address.cidade);

  const line1 = [street, number].filter(Boolean).join(', ');
  const line2 = [neighborhood, city].filter(Boolean).join(' - ');
  return [line1, line2].filter(Boolean).join(' | ') || '-';
};

const parseItemsJson = (itemsJson: unknown): any[] => {
  if (Array.isArray(itemsJson)) return itemsJson;
  if (typeof itemsJson === 'string') {
    try {
      const parsed = JSON.parse(itemsJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const getItemLabel = (item: any) =>
  normalizeText(
    item?.product_name ||
    item?.nome ||
    item?.descricao ||
    item?.description ||
    item?.produto ||
    item?.name
  ) || 'Produto sem descricao';

const buildItemRows = (items: any[]): WithdrawalItemRow[] =>
  items.map((item) => ({
    label: getItemLabel(item),
    hasAssembly:
      isAssemblyRequired(item?.has_assembly) ||
      isAssemblyRequired(item?.tem_montagem) ||
      isAssemblyRequired(item?.possui_montagem),
  }));

const getAssemblyStatus = (row: PreviewRow) => {
  if (!row.hasAssemblyItems) {
    return {
      label: 'Sem montagem',
      className: 'bg-gray-100 text-gray-700',
    };
  }

  if (row.assemblyGenerated) {
    return {
      label: 'Gerada no assembly',
      className: 'bg-green-100 text-green-700',
    };
  }

  return {
    label: 'Pendente no assembly',
    className: 'bg-amber-100 text-amber-700',
  };
};

export default function ReportsWithdrawals() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FiltersState>(() => createInitialFilters());
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const summary = useMemo(() => {
    const assemblyOrders = previewRows.filter((row) => row.hasAssemblyItems).length;
    const generatedAssemblyOrders = previewRows.filter((row) => row.hasAssemblyItems && row.assemblyGenerated).length;
    const pendingAssemblyOrders = previewRows.filter((row) => row.hasAssemblyItems && !row.assemblyGenerated).length;

    return {
      totalWithdrawals: previewRows.length,
      assemblyOrders,
      generatedAssemblyOrders,
      pendingAssemblyOrders,
    };
  }, [previewRows]);

  const periodLabel = useMemo(
    () => `${formatDateForLabel(filters.startDate)} a ${formatDateForLabel(filters.endDate)}`,
    [filters.endDate, filters.startDate]
  );

  const loadPreview = async () => {
    try {
      if (!filters.startDate || !filters.endDate) {
        toast.error('Preencha o periodo antes de atualizar a previa');
        return;
      }

      if (filters.startDate > filters.endDate) {
        toast.error('O periodo informado esta invalido');
        return;
      }

      setLoadingPreview(true);
      const rows = await fetchWithdrawalPreview(filters);
      setPreviewRows(rows);
    } catch (error) {
      console.error('Erro ao carregar relatorio de retiradas:', error);
      toast.error('Nao foi possivel carregar a previa do relatorio');
    } finally {
      setLoadingPreview(false);
    }
  };

  useEffect(() => {
    void loadPreview();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updatePreset = (preset: WithdrawalReportPreset) => {
    if (preset === 'custom') {
      setFilters((prev) => ({ ...prev, preset }));
      return;
    }

    setFilters({
      preset,
      ...createPresetRange(preset),
    });
  };

  const updateDateField = (key: 'startDate' | 'endDate', value: string) => {
    setFilters((prev) => ({
      ...prev,
      preset: 'custom',
      [key]: value,
    }));
  };

  const resetFilters = () => {
    setFilters(createInitialFilters());
  };

  const generatePdf = async () => {
    try {
      setGeneratingPdf(true);
      const rows = await fetchWithdrawalPreview(filters);
      setPreviewRows(rows);

      const reportRows: WithdrawalReportRow[] = rows.map((row) => ({
        orderIdErp: row.orderIdErp,
        customerName: row.customerName,
        addressLine: row.addressLine,
        responsibleName: row.responsibleName,
        registeredByName: row.registeredByName,
        withdrawnAt: row.withdrawnAt,
        notes: row.notes,
        productsLabel: row.items.length > 0
          ? row.items.map((item) => `${item.label} [${item.hasAssembly ? 'Montagem' : 'Sem montagem'}]`).join(' | ')
          : 'Sem produtos',
        assemblyStatusLabel: getAssemblyStatus(row).label,
      }));

      const pdfData: WithdrawalReportData = {
        filters: {
          periodLabel,
          presetLabel: PRESET_LABELS[filters.preset],
          generatedAt: new Date().toISOString(),
        },
        rows: reportRows,
        totalWithdrawals: rows.length,
        assemblyOrders: rows.filter((row) => row.hasAssemblyItems).length,
        generatedAssemblyOrders: rows.filter((row) => row.hasAssemblyItems && row.assemblyGenerated).length,
        pendingAssemblyOrders: rows.filter((row) => row.hasAssemblyItems && !row.assemblyGenerated).length,
      };

      const pdfBytes = await WithdrawalReportGenerator.generate(pdfData);
      DeliverySheetGenerator.openPDFInNewTab(pdfBytes);
    } catch (error) {
      console.error('Erro ao gerar PDF do relatorio de retiradas:', error);
      toast.error('Nao foi possivel gerar o PDF do relatorio');
    } finally {
      setGeneratingPdf(false);
    }
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

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Relatorio de retiradas</h1>
              <p className="mt-1 text-sm text-gray-500">
                Acompanhe retiradas por periodo com cliente, produtos, endereco, conferente, usuario que registrou e status da montagem.
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
                disabled={loadingPreview}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed"
              >
                {loadingPreview ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                Atualizar previa
              </button>
              <button
                onClick={generatePdf}
                disabled={generatingPdf}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {generatingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                Gerar PDF
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
            <FilterCard
              icon={<CalendarRange className="h-5 w-5 text-fuchsia-600" />}
              title="Periodo"
              description="Escolha um atalho rapido ou defina um intervalo livre para acompanhar as retiradas."
            >
              <div className="flex flex-wrap gap-2">
                {(['today', 'yesterday', 'last7', 'month', 'custom'] as WithdrawalReportPreset[]).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => updatePreset(preset)}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                      filters.preset === preset
                        ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {PRESET_LABELS[preset]}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <DateField
                  label="Inicio"
                  value={filters.startDate}
                  onChange={(value) => updateDateField('startDate', value)}
                />
                <DateField
                  label="Fim"
                  value={filters.endDate}
                  onChange={(value) => updateDateField('endDate', value)}
                />
              </div>
            </FilterCard>

            <FilterCard
              icon={<Package className="h-5 w-5 text-emerald-600" />}
              title="Resumo do filtro"
              description="O relatorio considera apenas pedidos ja marcados como retirados na tabela dedicada."
            >
              <SummaryLine label="Periodo" value={periodLabel} />
              <SummaryLine label="Atalho" value={PRESET_LABELS[filters.preset]} />
              <SummaryLine label="Base" value="order_withdrawals" />
            </FilterCard>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryTile title="Retiradas" value={summary.totalWithdrawals} helper="Pedidos encontrados no periodo filtrado." />
          <SummaryTile title="Com montagem" value={summary.assemblyOrders} helper="Pedidos com ao menos um produto marcado para montagem." />
          <SummaryTile title="Montagem gerada" value={summary.generatedAssemblyOrders} helper="Pedidos retirados que ja possuem registro em assembly_products." />
          <SummaryTile title="Montagem pendente" value={summary.pendingAssemblyOrders} helper="Retiradas com montagem ainda nao refletidas em assembly_products." />
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-6 py-4">
            <h2 className="text-lg font-bold text-gray-900">Previa das retiradas</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Pedido</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Cliente</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Produtos</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Montagem</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Endereco</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Conferente</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Registrado por</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Data/hora retirada</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {loadingPreview ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">
                      Carregando previa...
                    </td>
                  </tr>
                ) : previewRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">
                      Nenhuma retirada encontrada para o periodo informado.
                    </td>
                  </tr>
                ) : (
                  previewRows.map((row) => {
                    const assemblyStatus = getAssemblyStatus(row);
                    return (
                      <tr key={row.id} className="align-top">
                        <td className="px-4 py-4 text-sm font-semibold text-gray-900">{row.orderIdErp}</td>
                        <td className="px-4 py-4 text-sm text-gray-700">
                          <div className="font-medium text-gray-900">{row.customerName}</div>
                          {row.notes ? <div className="mt-1 text-xs text-gray-500">Obs: {row.notes}</div> : null}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-700">
                          <div className="space-y-2">
                            {row.items.length > 0 ? row.items.map((item, index) => (
                              <div key={`${row.id}-item-${index}`} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                                <div className="text-sm font-medium text-gray-900">{item.label}</div>
                                <div className="mt-1">
                                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                    item.hasAssembly ? 'bg-violet-100 text-violet-700' : 'bg-gray-200 text-gray-700'
                                  }`}>
                                    {item.hasAssembly ? 'Montagem' : 'Sem montagem'}
                                  </span>
                                </div>
                              </div>
                            )) : (
                              <span className="text-sm text-gray-400">Sem produtos</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-700">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${assemblyStatus.className}`}>
                            {assemblyStatus.label}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-700">{row.addressLine}</td>
                        <td className="px-4 py-4 text-sm font-medium text-gray-900">{row.responsibleName}</td>
                        <td className="px-4 py-4 text-sm text-gray-700">{row.registeredByName}</td>
                        <td className="px-4 py-4 text-sm text-gray-700">{formatDateTime(row.withdrawnAt)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}

function SummaryLine({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
      <span className="font-medium text-gray-500">{label}</span>
      <span className="text-right font-semibold text-gray-900">{value}</span>
    </div>
  );
}

function SummaryTile({
  title,
  value,
  helper,
}: {
  title: string;
  value: number;
  helper: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-gray-500">{title}</p>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
      <p className="mt-3 text-xs leading-5 text-gray-500">{helper}</p>
    </div>
  );
}

function formatDateForLabel(value: string) {
  if (!value) return '-';
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

async function fetchWithdrawalPreview(filters: FiltersState): Promise<PreviewRow[]> {
  const { data, error } = await supabase
    .from('order_withdrawals')
    .select(`
      id,
      responsible_name,
      notes,
      withdrawn_at,
      registered_by_name,
      source,
      legacy_route_id,
      order:orders!inner(
        id,
        order_id_erp,
        customer_name,
        address_json,
        items_json,
        previsao_montagem
      )
    `)
    .gte('withdrawn_at', toStartOfDayIso(filters.startDate))
    .lte('withdrawn_at', toEndOfDayIso(filters.endDate))
    .order('withdrawn_at', { ascending: false });

  if (error) throw error;

  const withdrawals = ((data || []) as WithdrawalQueryRow[]).filter((row) => row.order?.id);
  const orderIds = Array.from(new Set(withdrawals.map((row) => String(row.order?.id)).filter(Boolean)));

  const assemblyOrdersSet = new Set<string>();
  if (orderIds.length > 0) {
    const { data: assemblyData, error: assemblyError } = await supabase
      .from('assembly_products')
      .select('order_id')
      .in('order_id', orderIds);

    if (assemblyError) throw assemblyError;

    (assemblyData || []).forEach((row: any) => {
      if (row?.order_id) {
        assemblyOrdersSet.add(String(row.order_id));
      }
    });
  }

  return withdrawals.map((row) => {
    const order = row.order!;
    const items = buildItemRows(parseItemsJson(order.items_json));
    const hasAssemblyItems = items.some((item) => item.hasAssembly);

    return {
      id: row.id,
      orderId: String(order.id),
      orderIdErp: normalizeText(order.order_id_erp) || '-',
      customerName: normalizeText(order.customer_name) || 'Cliente sem nome',
      addressLine: formatAddressLine(order.address_json),
      responsibleName: normalizeText(row.responsible_name) || '-',
      registeredByName: normalizeText(row.registered_by_name) || '-',
      withdrawnAt: row.withdrawn_at || '',
      notes: normalizeText(row.notes) || null,
      source: normalizeText(row.source) || 'manual',
      items,
      hasAssemblyItems,
      assemblyGenerated: hasAssemblyItems && assemblyOrdersSet.has(String(order.id)),
    } satisfies PreviewRow;
  });
}
