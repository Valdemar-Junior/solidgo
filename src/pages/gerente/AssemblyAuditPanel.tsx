import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Hammer, Loader2, PackageSearch, RefreshCw, XCircle } from 'lucide-react';
import { supabase } from '../../supabase/client';
import type { OrderItem } from '../../types/database';
import { toast } from 'sonner';

type ErpSaleRow = {
  filial?: string | null;
  vendedor?: string | null;
  pedido?: number | string | null;
  data_hora_venda?: string | null;
  valor_pedido?: string | number | null;
  cliente?: string | null;
  cpf_cnpj?: string | null;
  telefones?: string | null;
  endereco_entrega?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  cep_entrega?: string | null;
  observacoes_venda?: string | null;
  observacoes_internas?: string | null;
  qtd_itens_sem_montagem?: string | number | null;
  qtd_pecas_sem_montagem?: string | number | null;
  valor_itens_sem_montagem?: string | number | null;
  tempo_montagem_estimado?: string | number | null;
  produtos_sem_montagem?: string | null;
};

type LocalOrder = {
  id: string;
  order_id_erp: string;
  status: string | null;
  items_json: OrderItem[] | null;
};

type AuditRecord = {
  order_id_erp: string;
  decision: 'needs_assembly' | 'no_assembly';
  notes: string | null;
  assembly_applied: boolean;
  assembly_products_created: number;
  pending_reason: string | null;
  decided_at: string;
  decided_by_user_id: string | null;
};

type DecisionResult = {
  order_found?: boolean;
  items_marked?: number;
  items_already_marked?: number;
  assembly_applied?: boolean;
  assembly_products_created?: number;
  pending_reason?: string | null;
};

const FALLBACK_WEBHOOK_URL = 'https://n8n.lojaodosmoveis.shop/webhook/auditoria_montagem';

const PENDING_REASON_LABEL: Record<string, string> = {
  aguardando_entrega: 'Montagem marcada. Os cards serao gerados quando a rota for finalizada.',
  aguardando_finalizacao_rota: 'Montagem marcada. A rota deste pedido ainda nao foi finalizada.',
  falha_ao_gerar: 'Montagem marcada, mas a geracao automatica dos cards falhou. Verifique na auditoria do admin.',
};

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR');
}

function formatCurrency(value?: string | number | null) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(parsed)) return '-';
  return parsed.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function normalizeSku(value: unknown) {
  return String(value ?? '').trim().toUpperCase();
}

function getItemSku(item: OrderItem | any) {
  return normalizeSku(item?.sku || item?.codigo || item?.codigo_produto || 'SKU-INDEF');
}

function itemAlreadyHasAssembly(item: OrderItem | any) {
  const values = [item?.has_assembly, item?.possui_montagem];
  return values.some((value) => ['sim', 's', 'true', '1', 'yes', 'y'].includes(String(value ?? '').trim().toLowerCase()));
}

/**
 * O ERP devolve os produtos em texto corrido, ex.:
 * "3540-2 - ARMARIO COZINHA PEROLA 120CM 5PTA 1GAV  - C212 - FELLICCI (qtd 1.)".
 * Extraimos o codigo inicial de cada produto para pre-marcar os itens do pedido.
 */
function extractSkusFromErpText(value?: string | null): string[] {
  const raw = String(value || '').trim();
  if (!raw) return [];

  return raw
    .split(/\r?\n|\s*\|\s*|\s*;\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^([A-Za-z0-9][A-Za-z0-9._/-]*)\s*-\s+/);
      return match ? normalizeSku(match[1]) : '';
    })
    .filter(Boolean);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function resolveWebhookUrl() {
  const fromEnv = import.meta.env.VITE_WEBHOOK_AUDITORIA_MONTAGEM as string | undefined;
  if (fromEnv) return fromEnv;

  const { data } = await supabase
    .from('webhook_settings')
    .select('url')
    .eq('key', 'auditoria_montagem')
    .eq('active', true)
    .maybeSingle();

  return (data?.url as string | undefined) || FALLBACK_WEBHOOK_URL;
}

function normalizeWebhookPayload(payload: any): ErpSaleRow[] {
  if (Array.isArray(payload)) return payload as ErpSaleRow[];
  if (payload && typeof payload === 'object') {
    const firstArray = Object.values(payload).find((value) => Array.isArray(value));
    if (firstArray) return firstArray as ErpSaleRow[];
    if (payload.pedido) return [payload as ErpSaleRow];
  }
  return [];
}

type ModalState = {
  row: ErpSaleRow;
  erpId: string;
  order: LocalOrder | null;
  selectedSkus: string[];
  /** Itens que ja estavam com montagem no pedido: entram na decisao, mas sem alterar nada. */
  lockedSkus: string[];
  notes: string;
} | null;

export default function AssemblyAuditPanel() {
  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [rows, setRows] = useState<ErpSaleRow[]>([]);
  const [ordersByErp, setOrdersByErp] = useState<Record<string, LocalOrder>>({});
  const [auditByErp, setAuditByErp] = useState<Record<string, AuditRecord>>({});
  const [ordersLookupFailed, setOrdersLookupFailed] = useState(false);
  const [auditLookupFailed, setAuditLookupFailed] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending');
  const [modal, setModal] = useState<ModalState>(null);
  const [saving, setSaving] = useState(false);

  /**
   * As duas consultas sao independentes de proposito: se a de auditoria falhar,
   * a tela ainda precisa saber quais pedidos existem no SolidGo. Caso contrario
   * todos apareceriam como "nao importado", que e uma informacao errada.
   */
  const loadLocalContext = async (erpIds: string[]) => {
    const uniqueIds = Array.from(new Set(erpIds.filter(Boolean)));
    if (uniqueIds.length === 0) {
      setOrdersByErp({});
      setAuditByErp({});
      setOrdersLookupFailed(false);
      setAuditLookupFailed(false);
      return;
    }

    const orderMap: Record<string, LocalOrder> = {};
    const auditMap: Record<string, AuditRecord> = {};
    let ordersFailed = false;
    let auditFailed = false;

    for (const chunk of chunkArray(uniqueIds, 200)) {
      const [ordersResult, auditResult] = await Promise.all([
        supabase.from('orders').select('id, order_id_erp, status, items_json').in('order_id_erp', chunk),
        supabase
          .from('assembly_audit_records')
          .select('order_id_erp, decision, notes, assembly_applied, assembly_products_created, pending_reason, decided_at, decided_by_user_id')
          .in('order_id_erp', chunk),
      ]);

      if (ordersResult.error) {
        ordersFailed = true;
        console.error('[AssemblyAuditPanel] Falha ao buscar pedidos:', ordersResult.error.message);
      } else {
        (ordersResult.data || []).forEach((order: any) => {
          orderMap[String(order.order_id_erp)] = order as LocalOrder;
        });
      }

      if (auditResult.error) {
        auditFailed = true;
        console.error('[AssemblyAuditPanel] Falha ao buscar auditorias:', auditResult.error.message);
      } else {
        (auditResult.data || []).forEach((record: any) => {
          auditMap[String(record.order_id_erp)] = record as AuditRecord;
        });
      }
    }

    setOrdersByErp(orderMap);
    setAuditByErp(auditMap);
    setOrdersLookupFailed(ordersFailed);
    setAuditLookupFailed(auditFailed);
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const webhookUrl = await resolveWebhookUrl();

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const authHeaderName = import.meta.env.VITE_WEBHOOK_AUDITORIA_MONTAGEM_HEADER as string | undefined;
      const authHeaderValue = import.meta.env.VITE_WEBHOOK_AUDITORIA_MONTAGEM_TOKEN as string | undefined;
      if (authHeaderName && authHeaderValue) {
        headers[authHeaderName] = authHeaderValue;
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        // A consulta do ERP tem a janela fixa de 48 horas; nao ha filtro a enviar.
        body: JSON.stringify({ origem: 'solidgo_auditoria_montagem' }),
      });

      if (!response.ok) {
        throw new Error(`Erro ${response.status} ao consultar o ERP`);
      }

      const text = await response.text();
      let payload: any;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error('O webhook nao devolveu JSON. Verifique a opcao "Respond" no n8n.');
      }

      if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.message && !payload.pedido) {
        throw new Error('O webhook respondeu antes de rodar a consulta. Ajuste o "Respond" para usar o no "Respond to Webhook".');
      }

      const erpRows = normalizeWebhookPayload(payload).filter((row) => String(row?.pedido ?? '').trim() !== '');

      setRows(erpRows);
      await loadLocalContext(erpRows.map((row) => String(row.pedido ?? '').trim()));
      setHasLoadedOnce(true);
    } catch (error: any) {
      console.error('[AssemblyAuditPanel]', error);
      toast.error(error?.message || 'Erro ao consultar a auditoria de montagem');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // Carrega apenas na primeira montagem; as demais consultas sao manuais.
  }, []);

  const visibleRows = useMemo(() => {
    return rows.filter((row) => {
      const erpId = String(row.pedido ?? '').trim();
      if (statusFilter === 'pending') return !auditByErp[erpId];
      return true;
    });
  }, [rows, auditByErp, statusFilter]);

  const summary = useMemo(() => {
    let pending = 0;
    let audited = 0;
    let notImported = 0;
    let pendingValue = 0;

    rows.forEach((row) => {
      const erpId = String(row.pedido ?? '').trim();
      if (auditByErp[erpId]) {
        audited += 1;
        return;
      }
      pending += 1;
      if (!ordersByErp[erpId]) notImported += 1;
      const value = Number(String(row.valor_pedido ?? '').replace(',', '.'));
      if (Number.isFinite(value)) pendingValue += value;
    });

    return { pending, audited, notImported, pendingValue, total: rows.length };
  }, [rows, auditByErp, ordersByErp]);

  const openModal = (row: ErpSaleRow) => {
    const erpId = String(row.pedido ?? '').trim();
    const order = ordersByErp[erpId] || null;
    const erpSkus = extractSkusFromErpText(row.produtos_sem_montagem);
    const items = Array.isArray(order?.items_json) ? order!.items_json! : [];

    const preselected = items
      .filter((item) => erpSkus.includes(getItemSku(item)) && !itemAlreadyHasAssembly(item))
      .map((item) => getItemSku(item));

    const locked = items.filter(itemAlreadyHasAssembly).map((item) => getItemSku(item));

    setModal({
      row,
      erpId,
      order,
      selectedSkus: Array.from(new Set(preselected)),
      lockedSkus: Array.from(new Set(locked)),
      notes: auditByErp[erpId]?.notes || '',
    });
  };

  const closeModal = () => setModal(null);

  const toggleSku = (sku: string) => {
    setModal((current) => {
      if (!current) return current;
      const exists = current.selectedSkus.includes(sku);
      return {
        ...current,
        selectedSkus: exists
          ? current.selectedSkus.filter((item) => item !== sku)
          : [...current.selectedSkus, sku],
      };
    });
  };

  const submitDecision = async (decision: 'needs_assembly' | 'no_assembly') => {
    if (!modal) return;

    // Itens ja marcados entram no envio para que uma venda cujo pedido ja foi
    // corrigido possa ser encerrada como "precisa de montagem" mesmo sem novidade.
    const skusToSend = Array.from(new Set([...modal.selectedSkus, ...modal.lockedSkus]));

    if (decision === 'needs_assembly') {
      if (!modal.order) {
        toast.error('Este pedido ainda nao foi importado para o SolidGo. Importe antes de marcar a montagem.');
        return;
      }
      if (skusToSend.length === 0) {
        toast.error('Selecione ao menos um produto para marcar montagem.');
        return;
      }
    }

    try {
      setSaving(true);
      const { data, error } = await supabase.rpc('apply_assembly_audit_decision', {
        p_order_id_erp: modal.erpId,
        p_decision: decision,
        p_item_skus: decision === 'needs_assembly' ? skusToSend : null,
        p_notes: modal.notes.trim() || null,
        p_erp_snapshot: modal.row,
      });

      if (error) throw error;

      const result = (data || {}) as DecisionResult;

      if (decision === 'no_assembly') {
        toast.success('Venda marcada como sem montagem.');
      } else if (result.assembly_applied && (result.assembly_products_created || 0) === 0) {
        toast.success('Montagem confirmada. Os cards deste pedido ja existiam.');
      } else if (result.assembly_applied) {
        toast.success(`Montagem marcada e ${result.assembly_products_created} card(s) gerado(s).`);
      } else {
        toast.success(PENDING_REASON_LABEL[String(result.pending_reason)] || 'Montagem marcada.');
      }

      closeModal();
      await loadLocalContext(rows.map((row) => String(row.pedido ?? '').trim()));
    } catch (error: any) {
      console.error('[AssemblyAuditPanel]', error);
      toast.error(error?.message || 'Erro ao registrar a auditoria');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Periodo</p>
              <p className="flex items-center rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700">
                <Clock className="mr-2 h-4 w-4 text-gray-400" />
                Ultimas 48 horas
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="inline-flex items-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {loading ? 'Consultando...' : 'Atualizar'}
            </button>
          </div>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'pending' | 'all')}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          >
            <option value="pending">Somente nao auditados</option>
            <option value="all">Todos do periodo</option>
          </select>
        </div>
        <p className="mt-4 text-sm text-gray-500">
          Vendas das ultimas 48 horas em que o vendedor nao marcou montagem no ERP. Nem toda venda desta lista precisa de
          montagem — voce decide caso a caso.
        </p>
      </div>

      {(ordersLookupFailed || auditLookupFailed) && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Nao foi possivel verificar tudo no SolidGo.</p>
            <p className="mt-1">
              {ordersLookupFailed && 'A consulta dos pedidos falhou, entao nao da para saber quais ja foram importados. '}
              {auditLookupFailed && 'A consulta das auditorias ja registradas falhou, entao vendas ja decididas podem reaparecer na lista. '}
              Clique em Atualizar para tentar de novo.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-600">Aguardando auditoria</p>
          <p className="mt-2 text-3xl font-bold text-amber-700">{summary.pending}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">Ja auditadas</p>
          <p className="mt-2 text-3xl font-bold text-emerald-700">{summary.audited}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Nao importadas</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{ordersLookupFailed ? '?' : summary.notImported}</p>
          <p className="mt-1 text-xs text-gray-500">
            {ordersLookupFailed ? 'Nao foi possivel verificar.' : 'Nao permitem marcar montagem ainda.'}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Valor pendente</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{formatCurrency(summary.pendingValue)}</p>
        </div>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-gray-500 shadow-sm">
            Consultando o ERP...
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500 shadow-sm">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
            <p className="font-medium text-gray-900">
              {hasLoadedOnce
                ? 'Nenhuma venda pendente de auditoria nas ultimas 48 horas.'
                : 'Clique em Atualizar para consultar o ERP.'}
            </p>
          </div>
        ) : (
          visibleRows.map((row) => {
            const erpId = String(row.pedido ?? '').trim();
            const order = ordersByErp[erpId];
            const audit = auditByErp[erpId];
            const observacoes = String(row.observacoes_venda || '');
            const looksLikeNoAssembly = /sem\s+montagem/i.test(observacoes);

            return (
              <div key={erpId} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                        Pedido {erpId}
                      </span>
                      <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                        {row.filial || 'Filial nao informada'}
                      </span>
                      {order ? (
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                          No SolidGo
                        </span>
                      ) : ordersLookupFailed ? (
                        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                          Nao verificado
                        </span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                          Nao importado
                        </span>
                      )}
                      {looksLikeNoAssembly && (
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          Observacao diz "sem montagem"
                        </span>
                      )}
                      {audit && (
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            audit.decision === 'needs_assembly'
                              ? 'bg-purple-50 text-purple-700'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {audit.decision === 'needs_assembly' ? 'Marcada com montagem' : 'Sem montagem'}
                        </span>
                      )}
                    </div>

                    <h3 className="text-lg font-bold text-gray-900">{row.cliente || 'Cliente nao informado'}</h3>

                    <div className="space-y-1 text-sm text-gray-500">
                      <p>Vendedor: {row.vendedor?.trim() || '-'}</p>
                      <p>Venda: {formatDateTime(row.data_hora_venda)} • {formatCurrency(row.valor_pedido)}</p>
                      <p>CPF/CNPJ: {row.cpf_cnpj || '-'} • Telefone: {row.telefones || '-'}</p>
                      <p>
                        Entrega: {row.endereco_entrega || '-'}
                        {row.bairro ? ` - ${row.bairro}` : ''}
                        {row.cidade ? ` - ${row.cidade}` : ''}
                        {row.cep_entrega ? ` (${row.cep_entrega})` : ''}
                      </p>
                      {observacoes && observacoes !== 'SEM OBSERVACAO' && <p>Obs. da venda: {observacoes}</p>}
                    </div>

                    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                      <p className="flex items-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        <PackageSearch className="mr-2 h-3.5 w-3.5" />
                        Produtos sem montagem no ERP
                      </p>
                      <p className="mt-2 text-sm text-gray-800">{row.produtos_sem_montagem || '-'}</p>
                      <p className="mt-2 text-xs text-gray-500">
                        {row.qtd_itens_sem_montagem || 0} item(ns) • {formatCurrency(row.valor_itens_sem_montagem)}
                      </p>
                    </div>

                    {audit && (
                      <div className="mt-3 rounded-xl border border-gray-100 bg-white p-3 text-xs text-gray-600">
                        <p>Auditado em {formatDateTime(audit.decided_at)}</p>
                        {audit.decision === 'needs_assembly' && (
                          <p>
                            {audit.assembly_applied
                              ? `${audit.assembly_products_created} card(s) de montagem gerado(s).`
                              : PENDING_REASON_LABEL[String(audit.pending_reason)] || 'Aguardando geracao dos cards.'}
                          </p>
                        )}
                        {audit.notes && <p>Obs.: {audit.notes}</p>}
                      </div>
                    )}
                  </div>

                  <div className="w-full lg:w-56">
                    <button
                      type="button"
                      onClick={() => openModal(row)}
                      className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                    >
                      <Hammer className="mr-2 h-4 w-4" />
                      {audit ? 'Rever decisao' : 'Auditar venda'}
                    </button>
                    {!order && (
                      <p className="mt-2 text-center text-xs text-gray-500">
                        {ordersLookupFailed
                          ? 'Sem confirmar o pedido no SolidGo so e possivel marcar como sem montagem.'
                          : 'Sem o pedido importado so e possivel marcar como sem montagem.'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-6 py-4">
              <h3 className="text-lg font-bold text-gray-900">Auditar pedido {modal.erpId}</h3>
              <p className="mt-1 text-sm text-gray-500">{modal.row.cliente || 'Cliente nao informado'}</p>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                <p className="font-semibold text-gray-900">Produtos apontados pelo ERP</p>
                <p className="mt-1">{modal.row.produtos_sem_montagem || '-'}</p>
              </div>

              {!modal.order ? (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-semibold">
                      {ordersLookupFailed
                        ? 'Nao foi possivel confirmar este pedido no SolidGo.'
                        : 'Pedido ainda nao importado para o SolidGo.'}
                    </p>
                    <p className="mt-1">
                      {ordersLookupFailed
                        ? 'A consulta falhou, entao a marcacao de montagem fica bloqueada por seguranca. Feche e clique em Atualizar.'
                        : 'So e possivel marcar montagem depois que o pedido for importado. Voce ainda pode registrar que esta venda nao precisa de montagem.'}
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="mb-2 text-sm font-semibold text-gray-900">
                    Selecione os produtos que precisam de montagem
                  </p>
                  <div className="space-y-2">
                    {(modal.order.items_json || []).length === 0 ? (
                      <p className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                        O pedido importado nao possui lista de produtos.
                      </p>
                    ) : (
                      (modal.order.items_json || []).map((item, index) => {
                        const sku = getItemSku(item);
                        const alreadyMarked = itemAlreadyHasAssembly(item);
                        const checked = modal.selectedSkus.includes(sku);

                        return (
                          <label
                            key={`${sku}-${index}`}
                            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                              alreadyMarked
                                ? 'border-emerald-200 bg-emerald-50'
                                : checked
                                  ? 'border-emerald-300 bg-white'
                                  : 'border-gray-200 bg-white'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={alreadyMarked || checked}
                              disabled={alreadyMarked}
                              onChange={() => toggleSku(sku)}
                              className="mt-1 h-4 w-4"
                            />
                            <span className="text-sm">
                              <span className="block font-semibold text-gray-900">{item.name || 'Produto sem nome'}</span>
                              <span className="block text-xs text-gray-500">
                                SKU: {sku} • Qtd: {item.purchased_quantity ?? item.quantity ?? 1}
                              </span>
                              {alreadyMarked && (
                                <span className="mt-1 block text-xs font-semibold text-emerald-700">
                                  Ja esta marcado com montagem
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Observacao (opcional)</label>
                <textarea
                  value={modal.notes}
                  onChange={(event) =>
                    setModal((current) => (current ? { ...current, notes: event.target.value } : current))
                  }
                  rows={3}
                  placeholder="Ex.: cliente confirmou que precisa de montagem."
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-gray-100 bg-gray-50 px-6 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void submitDecision('no_assembly')}
                disabled={saving}
                className="inline-flex items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-60"
              >
                <XCircle className="mr-2 h-4 w-4" />
                Nao precisa de montagem
              </button>
              <button
                type="button"
                onClick={() => void submitDecision('needs_assembly')}
                disabled={saving || !modal.order || modal.selectedSkus.length + modal.lockedSkus.length === 0}
                className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Hammer className="mr-2 h-4 w-4" />}
                Marcar montagem
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
