import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Loader2,
  PackageCheck,
  PackageOpen,
  PackageX,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Truck,
  Undo2,
  Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';
import { fetchAllPages, fetchInChunks } from '../../utils/supabase/batch';
import { generateDanfeBase64 } from '../../utils/danfe/generateDanfe';
import { createPickupFromReturn } from '../../utils/pickup/createPickupFromReturn';

// Central de Devoluções: uma tela só com o filme completo de cada devolução
// que chegou do ERP — tipo (parcial/total), origem (cancelado/devolvido),
// produtos, motivo (extraído do XML da nota de devolução) e a SITUAÇÃO
// OPERACIONAL do pedido no momento (na fila, em rota com motorista, entregue
// aguardando coleta...). A fila de roteirização remove/re-fila sozinha; esta
// tela existe pra logística ENXERGAR e agir.

type ReturnItemRow = {
  return_id: string;
  sku_snapshot: string | null;
  product_name_snapshot: string | null;
  returned_quantity: number;
};

type ActiveRouteInfo = { id: string; name: string; status: string };

type ReturnRow = {
  id: string;
  order_id: string;
  return_nfe_number: string | null;
  return_date: string | null;
  created_at: string;
  return_type: string | null;
  reason: string | null;
  requires_pickup: boolean;
  pickup_created_at: string | null;
  store_return_confirmed_at: string | null;
  order: {
    id: string;
    order_id_erp: string;
    customer_name: string | null;
    filial_venda: string | null;
    blocked_at: string | null;
  } | null;
  items: ReturnItemRow[];
  activeRoute: ActiveRouteInfo | null;
  // O item ficou BLOQUEADO ("não entregar") numa rota de entrega já finalizada,
  // ou seja: o motorista SAIU com o produto e trouxe de volta. Só esse caso
  // precisa de conferência de retorno à loja.
  wentOutBlocked: boolean;
};

type XmlInfo = { motivo: string; nfOrigem: string; rawXml: string };

const PAGE_SIZE = 25;

// O motivo vem SEMPRE nas Informações Complementares (infCpl) do XML da nota
// de devolução, no padrão "MOTIVO DA DEVOLUCAO: ...". A NF de origem da venda
// vem junto ("Devolucao da NFE:12345").
function extractXmlInfo(xml: string): XmlInfo {
  const raw = String(xml || '');
  const infCplMatch = raw.match(/<infCpl>([\s\S]*?)<\/infCpl>/i);
  const infCpl = infCplMatch ? infCplMatch[1] : raw;
  const motivoMatch = infCpl.match(/MOTIVO\s+DA\s+DEVOLU[CÇ][AÃ]O\s*:?\s*([\s\S]*?)(?:$|<)/i);
  const nfOrigemMatch = infCpl.match(/Devolucao\s+da\s+NFE\s*:?\s*(\d+)/i);
  return {
    motivo: (motivoMatch?.[1] || '').replace(/\s+/g, ' ').trim(),
    nfOrigem: (nfOrigemMatch?.[1] || '').trim(),
    rawXml: raw,
  };
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('pt-BR');
}

export default function ReturnsManagement() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [periodDays, setPeriodDays] = useState<7 | 30 | 90>(7);
  const [typeFilter, setTypeFilter] = useState<'all' | 'partial' | 'total'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [xmlInfoByReturnId, setXmlInfoByReturnId] = useState<Record<string, XmlInfo>>({});
  const [printingId, setPrintingId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const startIso = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

      const returns = await fetchAllPages<any>((from, to) => supabase
        .from('order_returns')
        .select(`
          id, order_id, return_nfe_number, return_date, return_type, reason,
          requires_pickup, pickup_created_at, store_return_confirmed_at, created_at,
          order:orders!order_id(id, order_id_erp, customer_name, filial_venda, blocked_at)
        `)
        .eq('processing_status', 'processed')
        .gte('created_at', startIso)
        .order('created_at', { ascending: false })
        .range(from, to));

      const returnIds = returns.map((r: any) => String(r.id));
      const itemRows = returnIds.length > 0
        ? await fetchInChunks<string, ReturnItemRow>(returnIds, (ids) => supabase
          .from('order_return_items')
          .select('return_id, sku_snapshot, product_name_snapshot, returned_quantity')
          .in('return_id', ids))
        : [];
      const itemsByReturn: Record<string, ReturnItemRow[]> = {};
      for (const item of itemRows) {
        const key = String(item.return_id);
        (itemsByReturn[key] = itemsByReturn[key] || []).push(item);
      }

      // Situação operacional: o pedido está em alguma rota de ENTREGA ativa?
      const orderIds = Array.from(new Set(returns.map((r: any) => String(r.order_id)).filter(Boolean)));
      const routeRows = orderIds.length > 0
        ? await fetchInChunks<string, any>(orderIds, (ids) => supabase
          .from('route_orders')
          .select('id, order_id, route:routes!route_id(id, name, status)')
          .in('order_id', ids))
        : [];
      const activeRouteByOrder: Record<string, ActiveRouteInfo> = {};
      const completedRouteOrderIds: string[] = [];
      for (const rr of routeRows) {
        const route = rr?.route;
        if (!route) continue;
        const name = String(route.name || '');
        const isColeta = name.trim().toUpperCase().startsWith('COLETA-');
        if (route.status === 'completed') {
          // Rota de ENTREGA já finalizada = o motorista saiu com estes itens.
          // (Rota de COLETA não conta — é o fluxo inverso, buscar na casa do cliente.)
          if (!isColeta) completedRouteOrderIds.push(String(rr.id));
          continue;
        }
        if (isColeta) continue;
        // Rota iniciada (com motorista) tem prioridade sobre rota em separação.
        const current = activeRouteByOrder[String(rr.order_id)];
        if (!current || route.status === 'in_progress') {
          activeRouteByOrder[String(rr.order_id)] = { id: String(route.id), name, status: String(route.status || '') };
        }
      }

      // "Motorista saiu com o produto e trouxe de volta": item BLOQUEADO
      // (devolvido, nada a entregar) numa rota de entrega JÁ FINALIZADA. Só
      // esse caso precisa de conferência de retorno à loja — item bloqueado
      // ANTES de sair (nunca roteirizado, ou em rota que não começou) jamais
      // deixou o depósito, então não tem "retorno" a confirmar.
      const wentOutBlockedByOrder: Record<string, boolean> = {};
      if (completedRouteOrderIds.length > 0) {
        const blockedItems = await fetchInChunks<string, any>(completedRouteOrderIds, (ids) => supabase
          .from('route_order_items')
          .select('order_id, returned_quantity_snapshot, deliverable_quantity_snapshot')
          .in('route_order_id', ids));
        for (const it of blockedItems) {
          const ret = Number(it.returned_quantity_snapshot || 0);
          const deliv = Number(it.deliverable_quantity_snapshot || 0);
          if (ret > 0 && deliv <= 0) wentOutBlockedByOrder[String(it.order_id)] = true;
        }
      }

      setRows(returns.map((r: any) => ({
        ...r,
        items: itemsByReturn[String(r.id)] || [],
        activeRoute: activeRouteByOrder[String(r.order_id)] || null,
        wentOutBlocked: wentOutBlockedByOrder[String(r.order_id)] || false,
      })));
      setPage(0);
    } catch (error) {
      console.error('[Devolucoes] Falha ao carregar devoluções:', error);
      toast.error('Falha ao carregar as devoluções. Recarregue a página.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, [periodDays]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (typeFilter !== 'all' && String(row.return_type || '') !== typeFilter) return false;
      if (!q) return true;
      const erp = String(row.order?.order_id_erp || '').toLowerCase();
      const client = String(row.order?.customer_name || '').toLowerCase();
      const nfe = String(row.return_nfe_number || '').toLowerCase();
      return erp.includes(q) || client.includes(q) || nfe.includes(q);
    });
  }, [rows, typeFilter, search]);

  const pageRows = useMemo(
    () => filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filteredRows, page],
  );
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));

  // Motivo/NF de origem: o XML pesa ~7 KB por devolução, então só baixamos o
  // XML das linhas VISÍVEIS nesta página (não da lista inteira).
  useEffect(() => {
    const missing = pageRows
      .map((row) => String(row.id))
      .filter((id) => !(id in xmlInfoByReturnId));
    if (missing.length === 0) return;

    let alive = true;
    (async () => {
      try {
        const xmlRows = await fetchInChunks<string, any>(missing, (ids) => supabase
          .from('order_returns')
          .select('id, return_xml')
          .in('id', ids));
        if (!alive) return;
        setXmlInfoByReturnId((prev) => {
          const next = { ...prev };
          for (const row of xmlRows) {
            next[String(row.id)] = extractXmlInfo(String(row.return_xml || ''));
          }
          for (const id of missing) {
            if (!next[id]) next[id] = { motivo: '', nfOrigem: '', rawXml: '' };
          }
          return next;
        });
      } catch (error) {
        console.error('[Devolucoes] Falha ao carregar XML das devoluções:', error);
      }
    })();
    return () => { alive = false; };
  }, [pageRows, xmlInfoByReturnId]);

  const criticalCount = useMemo(
    () => filteredRows.filter((r) => r.activeRoute).length,
    [filteredRows],
  );
  const pickupPendingCount = useMemo(
    () => filteredRows.filter((r) => r.requires_pickup && !r.pickup_created_at).length,
    [filteredRows],
  );

  // O produto devolvido/bloqueado ("não entregar") já voltou fisicamente pra
  // loja e a logística confirmou a conferência.
  const isStoreReturnConfirmed = (row: ReturnRow) => Boolean(row.store_return_confirmed_at);

  // O botão "Confirmar retorno à loja" só aparece quando o motorista DE FATO
  // saiu com o produto e trouxe de volta (item bloqueado numa rota de entrega
  // já finalizada) — e ainda não foi conferido. Não aparece pra bloqueio antes
  // de sair (nunca saiu do depósito) nem pra coleta (fluxo próprio dela).
  const canConfirmStoreReturn = (row: ReturnRow) =>
    row.wentOutBlocked
    && !row.activeRoute
    && !row.requires_pickup
    && !row.pickup_created_at
    && !isStoreReturnConfirmed(row);

  const situacao = (row: ReturnRow): { label: string; cls: string } => {
    if (row.activeRoute) {
      if (row.activeRoute.status === 'in_progress') {
        return {
          label: `EM ROTA COM MOTORISTA — ${row.activeRoute.name} — NÃO ENTREGAR`,
          cls: 'bg-red-100 text-red-800 border-red-300 font-semibold',
        };
      }
      return {
        label: `Em separação — ${row.activeRoute.name}`,
        cls: 'bg-orange-100 text-orange-800 border-orange-200',
      };
    }
    if (isStoreReturnConfirmed(row)) {
      return { label: '✓ Retornou à loja', cls: 'bg-green-100 text-green-800 border-green-300 font-medium' };
    }
    // Saiu com o motorista, voltou bloqueado, rota finalizada: falta só a
    // logística conferir o retorno (é o caso com botão verde ao lado).
    if (canConfirmStoreReturn(row)) {
      return { label: 'Voltou com o motorista — confirme o retorno', cls: 'bg-amber-100 text-amber-800 border-amber-300 font-medium' };
    }
    if (row.requires_pickup && !row.pickup_created_at) {
      return { label: 'Entregue — precisa de coleta', cls: 'bg-blue-100 text-blue-800 border-blue-200' };
    }
    if (row.pickup_created_at) {
      return { label: 'Coleta gerada', cls: 'bg-green-100 text-green-800 border-green-200' };
    }
    if (row.order?.blocked_at) {
      return { label: 'Removido da fila (bloqueado)', cls: 'bg-gray-200 text-gray-800 border-gray-300' };
    }
    if (String(row.return_type || '') === 'partial') {
      return { label: 'Parcial — itens restantes seguem na fila', cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' };
    }
    return { label: 'Processada', cls: 'bg-gray-100 text-gray-700 border-gray-200' };
  };

  const origem = (row: ReturnRow) => {
    const reason = String(row.reason || '').toLowerCase();
    if (reason.includes('cancel')) return 'Cancelamento';
    if (reason.includes('devol')) return 'Devolução';
    return reason ? row.reason : '—';
  };

  // Imprime a nota de devolução: reaproveita a salva; se não existir, gera
  // pelo /api/danfe (layout novo) a partir do XML e salva pro próximo clique.
  const printReturnDanfe = async (row: ReturnRow) => {
    setPrintingId(row.id);
    try {
      const { data: orderData, error } = await supabase
        .from('orders')
        .select('return_danfe_base64, return_nfe_xml')
        .eq('id', row.order_id)
        .single();
      if (error) throw error;

      let base64 = String(orderData?.return_danfe_base64 || '');
      if (!base64.startsWith('JVBER')) {
        const xml = xmlInfoByReturnId[row.id]?.rawXml
          || String(orderData?.return_nfe_xml || '');
        if (!xml.includes('<')) {
          toast.error('O XML desta nota de devolução não está disponível.');
          return;
        }
        toast.info('Gerando nota de devolução...');
        base64 = await generateDanfeBase64(xml);
        if (!base64.startsWith('JVBER')) {
          toast.error('Não foi possível gerar a nota de devolução (verifique o XML / Gotenberg).');
          return;
        }
        await supabase
          .from('orders')
          .update({ return_danfe_base64: base64 })
          .eq('id', row.order_id);
      }

      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/pdf' });
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (error) {
      console.error('[Devolucoes] Erro ao imprimir nota de devolução:', error);
      toast.error('Erro ao imprimir a nota de devolução.');
    } finally {
      setPrintingId(null);
    }
  };

  const openOrderLookup = async (row: ReturnRow) => {
    const erp = String(row.order?.order_id_erp || '');
    try { await navigator.clipboard.writeText(erp); } catch { /* clipboard opcional */ }
    toast.info(`Número ${erp} copiado — cole na busca da Consulta de Pedido.`);
    navigate('/admin/order-lookup');
  };

  // Remove o pedido de uma rota EM SEPARAÇÃO (mesma receita da conferência:
  // apaga o vínculo — os snapshots por item caem em cascata —, devolve o
  // pedido pra pending e re-sincroniza a liberação de loja).
  // Rota INICIADA não permite: o móvel está fisicamente no caminhão; remover
  // no sistema seria mentira operacional — o caminho é falar com o motorista.
  const [removingId, setRemovingId] = useState<string | null>(null);
  const removeFromRoute = async (row: ReturnRow) => {
    const route = row.activeRoute;
    if (!route || route.status === 'in_progress') return;
    const erp = String(row.order?.order_id_erp || '');
    if (!window.confirm(`Remover o pedido ${erp} da rota "${route.name}"?\nEle volta pra fila de roteirização (só os itens não devolvidos).`)) return;

    setRemovingId(row.id);
    try {
      const { error: delError } = await supabase
        .from('route_orders')
        .delete()
        .eq('route_id', route.id)
        .eq('order_id', row.order_id);
      if (delError) throw delError;

      const { error: updError } = await supabase
        .from('orders')
        .update({ status: 'pending' })
        .eq('id', row.order_id);
      if (updError) throw updError;

      const { error: syncError } = await supabase.rpc('sync_store_release_for_orders', {
        p_order_ids: [row.order_id],
      });
      if (syncError) console.warn('[Devolucoes] Falha ao re-sincronizar liberação de loja:', syncError);

      toast.success(`Pedido ${erp} removido da rota "${route.name}".`);
      await loadData();
    } catch (error) {
      console.error('[Devolucoes] Erro ao remover da rota:', error);
      toast.error('Erro ao remover o pedido da rota.');
    } finally {
      setRemovingId(null);
    }
  };

  // Confirmar retorno à loja: carimbo de conferência de que o produto
  // devolvido/bloqueado ("não entregar") voltou fisicamente pro depósito.
  // Reversível — o mesmo botão desfaz (limpa o carimbo).
  const [confirmingReturnId, setConfirmingReturnId] = useState<string | null>(null);
  const toggleStoreReturn = async (row: ReturnRow, confirm: boolean) => {
    const erp = String(row.order?.order_id_erp || '');
    const question = confirm
      ? `Confirmar que o produto devolvido do pedido ${erp} voltou pra loja?\nA devolução passa pra "Retornou à loja".`
      : `Desfazer a confirmação de retorno do pedido ${erp}?`;
    if (!window.confirm(question)) return;

    setConfirmingReturnId(row.id);
    try {
      let confirmedBy: string | null = null;
      if (confirm) {
        const { data: auth } = await supabase.auth.getUser();
        confirmedBy = auth?.user?.id || null;
      }
      const { error } = await supabase
        .from('order_returns')
        .update({
          store_return_confirmed_at: confirm ? new Date().toISOString() : null,
          store_return_confirmed_by: confirmedBy,
        })
        .eq('id', row.id);
      if (error) throw error;

      toast.success(confirm
        ? `Retorno do pedido ${erp} confirmado.`
        : `Confirmação do pedido ${erp} desfeita.`);
      await loadData();
    } catch (error) {
      console.error('[Devolucoes] Erro ao confirmar retorno à loja:', error);
      toast.error('Erro ao registrar o retorno à loja.');
    } finally {
      setConfirmingReturnId(null);
    }
  };

  // Gerar coleta DIRETO da central: mesmo fluxo da Gestão de Entregas
  // (módulo compartilhado createPickupFromReturn) — só escolhe a equipe.
  const [pickupModalRow, setPickupModalRow] = useState<ReturnRow | null>(null);
  const [pickupTeamId, setPickupTeamId] = useState('');
  const [pickupObservations, setPickupObservations] = useState('');
  const [pickupSaving, setPickupSaving] = useState(false);
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);

  const openPickupModal = async (row: ReturnRow) => {
    setPickupModalRow(row);
    setPickupTeamId('');
    setPickupObservations('');
    if (teams.length === 0) {
      const { data, error } = await supabase
        .from('teams_user')
        .select('id, name, active')
        .order('name');
      if (error) {
        console.error('[Devolucoes] Falha ao carregar equipes:', error);
        toast.error('Não foi possível carregar as equipes.');
        setPickupModalRow(null);
        return;
      }
      setTeams(((data || []) as any[])
        .filter((t) => t.active !== false)
        .map((t) => ({ id: String(t.id), name: String(t.name || 'Equipe') })));
    }
  };

  const confirmCreatePickup = async () => {
    if (!pickupModalRow) return;
    if (!pickupTeamId) {
      toast.error('Selecione uma equipe.');
      return;
    }
    setPickupSaving(true);
    try {
      const result = await createPickupFromReturn({
        returnId: pickupModalRow.id,
        teamId: pickupTeamId,
        observations: pickupObservations,
      });
      if (result.status === 'already_created') {
        toast.info('Essa coleta já foi criada. Atualizando a tela...');
      } else if (result.status === 'synced_existing') {
        toast.success('A coleta já existia e foi sincronizada com a devolução.');
      } else {
        toast.success(`Coleta criada! Pedido ${result.pickupOrderErp} na rota ${result.routeName}.`);
      }
      setPickupModalRow(null);
      await loadData();
    } catch (error: any) {
      console.error('[Devolucoes] Erro ao criar coleta:', error);
      toast.error('Erro ao criar coleta: ' + (error?.message || ''));
    } finally {
      setPickupSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center">
            <Undo2 className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Devoluções</h1>
            <p className="text-sm text-gray-500">Central de controle das devoluções e cancelamentos do ERP</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" /> Recarregar
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={`rounded-2xl border p-4 ${criticalCount > 0 ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`}>
          <div className="flex items-center gap-3">
            <AlertTriangle className={`h-8 w-8 ${criticalCount > 0 ? 'text-red-600' : 'text-gray-300'}`} />
            <div>
              <p className="text-2xl font-bold text-gray-900">{criticalCount}</p>
              <p className="text-sm text-gray-600">Em rota (não entregar!)</p>
            </div>
          </div>
        </div>
        <div className={`rounded-2xl border p-4 ${pickupPendingCount > 0 ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'}`}>
          <div className="flex items-center gap-3">
            <Truck className={`h-8 w-8 ${pickupPendingCount > 0 ? 'text-blue-600' : 'text-gray-300'}`} />
            <div>
              <p className="text-2xl font-bold text-gray-900">{pickupPendingCount}</p>
              <p className="text-sm text-gray-600">Precisam de coleta</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <PackageOpen className="h-8 w-8 text-gray-400" />
            <div>
              <p className="text-2xl font-bold text-gray-900">{filteredRows.length}</p>
              <p className="text-sm text-gray-600">Devoluções no período</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-56">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Pedido, cliente ou NF de devolução..."
              className="w-full rounded-xl border border-gray-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-gray-200 p-1">
            {([7, 30, 90] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setPeriodDays(d)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${periodDays === d ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                {d} dias
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-gray-200 p-1">
            {([['all', 'Todas'], ['partial', 'Parciais'], ['total', 'Totais']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => { setTypeFilter(value); setPage(0); }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${typeFilter === value ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" /> Carregando devoluções...
          </div>
        ) : pageRows.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            Nenhuma devolução {typeFilter !== 'all' || search ? 'com esses filtros' : `nos últimos ${periodDays} dias`}.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Pedido</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Origem</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Produtos devolvidos</th>
                <th className="px-4 py-3">Motivo</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => {
                const info = xmlInfoByReturnId[row.id];
                const sit = situacao(row);
                return (
                  <tr key={row.id} className="border-b border-gray-100 align-top hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {formatDate(row.return_date || row.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-gray-900">
                      {row.order?.order_id_erp || '—'}
                      {info?.nfOrigem && (
                        <span className="block text-xs font-normal text-gray-400">NF venda {info.nfOrigem}</span>
                      )}
                      {row.return_nfe_number && (
                        <span className="block text-xs font-normal text-gray-400">NF dev. {row.return_nfe_number}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{row.order?.customer_name || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">{origem(row)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${String(row.return_type) === 'total' ? 'border-red-200 bg-red-50 text-red-700' : 'border-yellow-200 bg-yellow-50 text-yellow-700'}`}>
                        {String(row.return_type) === 'total' ? 'TOTAL' : 'PARCIAL'}
                      </span>
                    </td>
                    <td className="max-w-64 px-4 py-3 text-gray-700">
                      {row.items.length === 0 ? '—' : (
                        <ul className="space-y-0.5">
                          {row.items.map((item, idx) => (
                            <li key={idx} className="truncate" title={`${item.product_name_snapshot || item.sku_snapshot} (${Number(item.returned_quantity)})`}>
                              <span className="text-gray-400">{Number(item.returned_quantity)}x</span>{' '}
                              {item.product_name_snapshot || item.sku_snapshot || '—'}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="max-w-56 px-4 py-3 text-gray-600">
                      {info === undefined
                        ? <span className="text-gray-300">carregando...</span>
                        : (info.motivo
                          ? <span title={info.motivo} className="line-clamp-3">{info.motivo}</span>
                          : '—')}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-lg border px-2 py-1 text-xs ${sit.cls}`}>{sit.label}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {row.activeRoute && row.activeRoute.status !== 'in_progress' && (
                        <button
                          type="button"
                          title={`Remover da rota "${row.activeRoute.name}" (em separação)`}
                          onClick={() => void removeFromRoute(row)}
                          disabled={removingId === row.id}
                          className="rounded-lg p-1.5 text-orange-600 transition-colors hover:bg-orange-50 hover:text-orange-800 disabled:opacity-50"
                        >
                          {removingId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageX className="h-4 w-4" />}
                        </button>
                      )}
                      {row.requires_pickup && !row.pickup_created_at && (
                        <button
                          type="button"
                          title="Gerar coleta"
                          onClick={() => void openPickupModal(row)}
                          className="rounded-lg p-1.5 text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-800"
                        >
                          <Truck className="h-4 w-4" />
                        </button>
                      )}
                      {canConfirmStoreReturn(row) && (
                        <button
                          type="button"
                          title="Confirmar que o produto voltou pra loja"
                          onClick={() => void toggleStoreReturn(row, true)}
                          disabled={confirmingReturnId === row.id}
                          className="rounded-lg p-1.5 text-green-600 transition-colors hover:bg-green-50 hover:text-green-800 disabled:opacity-50"
                        >
                          {confirmingReturnId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                        </button>
                      )}
                      {isStoreReturnConfirmed(row) && !row.activeRoute && (
                        <button
                          type="button"
                          title="Desfazer confirmação de retorno"
                          onClick={() => void toggleStoreReturn(row, false)}
                          disabled={confirmingReturnId === row.id}
                          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
                        >
                          {confirmingReturnId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                        </button>
                      )}
                      <button
                        type="button"
                        title="Imprimir nota de devolução"
                        onClick={() => void printReturnDanfe(row)}
                        disabled={printingId === row.id}
                        className="rounded-lg p-1.5 text-green-600 transition-colors hover:bg-green-50 hover:text-green-800 disabled:opacity-50"
                      >
                        {printingId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        title="Ver pedido na Consulta"
                        onClick={() => void openOrderLookup(row)}
                        className="rounded-lg p-1.5 text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-800"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {pickupModalRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900">Gerar coleta</h2>
            <p className="mt-1 text-sm text-gray-600">
              Pedido <span className="font-semibold">{pickupModalRow.order?.order_id_erp}</span> — {pickupModalRow.order?.customer_name}
            </p>
            {pickupModalRow.items.length > 0 && (
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                <p className="mb-1 text-xs font-semibold uppercase text-gray-500">Itens da coleta</p>
                <ul className="space-y-0.5">
                  {pickupModalRow.items.map((item, idx) => (
                    <li key={idx}>
                      <span className="text-gray-400">{Number(item.returned_quantity)}x</span>{' '}
                      {item.product_name_snapshot || item.sku_snapshot}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <label className="mt-4 block text-sm font-medium text-gray-700">Equipe da coleta</label>
            <select
              value={pickupTeamId}
              onChange={(e) => setPickupTeamId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value="">Selecione a equipe...</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
            <label className="mt-3 block text-sm font-medium text-gray-700">Observações (opcional)</label>
            <textarea
              value={pickupObservations}
              onChange={(e) => setPickupObservations(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              placeholder="Ex.: combinar horário com o cliente"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPickupModalRow(null)}
                disabled={pickupSaving}
                className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmCreatePickup()}
                disabled={pickupSaving || !pickupTeamId}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {pickupSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Criar coleta
              </button>
            </div>
          </div>
        </div>
      )}

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>Página {page + 1} de {totalPages} — {filteredRows.length} devoluções</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-xl border border-gray-300 bg-white px-4 py-2 font-medium hover:bg-gray-50 disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="rounded-xl border border-gray-300 bg-white px-4 py-2 font-medium hover:bg-gray-50 disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
