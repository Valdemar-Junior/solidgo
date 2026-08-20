import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';
import { useAuthStore } from '../../stores/authStore';
import { AlertTriangle, CheckCircle2, PackageX, X, Truck } from 'lucide-react';

/**
 * Painel do ADMIN para tratar as divergências da conferência.
 *
 * Divisão de papéis: o conferente só INFORMA (marca o motivo de um produto que
 * não subiu no caminhão). Quem tira o pedido da rota é o admin, aqui, na Gestão
 * de Entregas.
 */

const REASON_LABELS: Record<string, string> = {
  no_space: 'Não coube no caminhão',
  damaged: 'Avariado',
  no_stock: 'Sem estoque',
  not_found: 'Não encontrado no estoque',
  other: 'Outro',
};

const reasonLabel = (v?: string) => (v ? REASON_LABELS[v] || v : 'Motivo não informado');

type Row = {
  orderId: string;
  erp: string;
  customer: string;
  produtos: { sku: string; reason?: string; notes?: string }[];
  volumesFaltantes: string[];
  required?: number;
  scanned?: number;
};

export default function ConferenceDivergenceModal({
  route, onClose, onChanged,
}: {
  route: any;
  onClose: () => void;
  onChanged: () => void;
}) {
  const conf = route?.conference;
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const rows = useMemo<Row[]>(() => {
    const summary = conf?.summary || {};
    const missing: any[] = Array.isArray(summary.missing) ? summary.missing : [];
    const notBiped: any[] = Array.isArray(summary.notBipedProducts) ? summary.notBipedProducts : [];
    const byOrderInfo: any[] = Array.isArray(summary.byOrder) ? summary.byOrder : [];

    const map = new Map<string, Row>();
    const ensure = (orderId: string) => {
      const key = String(orderId || '');
      if (!map.has(key)) {
        const ro = (route?.route_orders || []).find((r: any) => String(r.order_id) === key || String(r.order?.id) === key);
        const info = byOrderInfo.find((b: any) => String(b.orderId) === key);
        map.set(key, {
          orderId: key,
          erp: String(ro?.order?.order_id_erp || info?.erp || '—'),
          customer: String(ro?.order?.customer_name || info?.customer || 'Cliente não informado'),
          produtos: [],
          volumesFaltantes: [],
          required: info?.required,
          scanned: info?.scanned,
        });
      }
      return map.get(key)!;
    };

    notBiped.forEach((p) => {
      if (!p?.orderId) return;
      ensure(p.orderId).produtos.push({ sku: String(p.productCode || '—'), reason: p.reason, notes: p.notes });
    });
    missing.forEach((m) => {
      if (!m?.orderId) return;
      ensure(m.orderId).volumesFaltantes.push(String(m.code || ''));
    });

    return Array.from(map.values());
  }, [conf, route]);

  const selectedIds = rows.map((r) => r.orderId).filter((id) => selected[id]);
  const jaResolvida = Boolean(conf?.resolved_at);
  const jaRemovidos: string[] = Array.isArray(conf?.resolution?.removedOrderIds) ? conf.resolution.removedOrderIds : [];

  // Pedido que já tem volume no caminhão: tirar da rota é decisão do admin,
  // mas ele precisa saber que tem mercadoria carregada.
  const parciaisSelecionados = rows.filter((r) => selected[r.orderId] && (r.scanned || 0) > 0);

  const marcarResolvida = async (removedIds: string[], fecharTudo: boolean) => {
    const authUser = useAuthStore.getState().user;
    const payload = {
      removedOrderIds: Array.from(new Set([...jaRemovidos, ...removedIds])),
      divergencias: rows.map((r) => ({
        orderId: r.orderId,
        erp: r.erp,
        produtos: r.produtos,
        volumesFaltantes: r.volumesFaltantes,
      })),
    };
    const update: any = { resolution: payload };
    if (fecharTudo) {
      update.resolved_at = new Date().toISOString();
      update.resolved_by = authUser?.id || null;
    }
    const { data, error } = await supabase
      .from('route_conferences')
      .update(update)
      .eq('id', conf.id)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('sem permissão para gravar a resolução');
  };

  const tirarDaRota = async () => {
    if (selectedIds.length === 0) { toast.error('Escolha quais pedidos sair da rota'); return; }
    setBusy(true);
    try {
      const rid = String(route.id);
      // O snapshot por item (route_order_items) sai junto: o banco apaga em
      // cascata pelo route_order_id.
      const { data: apagados, error: delErr } = await supabase
        .from('route_orders')
        .delete()
        .eq('route_id', rid)
        .in('order_id', selectedIds)
        .select('id');
      if (delErr) throw delErr;
      if (!apagados || apagados.length === 0) {
        toast.error('O banco não deixou tirar os pedidos da rota. Nada foi alterado.');
        return;
      }

      const { error: updErr } = await supabase
        .from('orders')
        .update({ status: 'pending' })
        .in('id', selectedIds);
      if (updErr) throw updErr;

      await supabase.rpc('sync_store_release_for_orders', { p_order_ids: selectedIds });

      // Só considera a divergência encerrada quando todos os pedidos com
      // pendência foram tratados.
      const tratados = new Set([...jaRemovidos, ...selectedIds]);
      const todosTratados = rows.every((r) => tratados.has(r.orderId));
      await marcarResolvida(selectedIds, todosTratados);

      toast.success(
        todosTratados
          ? `${apagados.length} pedido(s) voltaram para a fila. Divergência encerrada.`
          : `${apagados.length} pedido(s) voltaram para a fila. Ainda falta tratar os outros.`,
      );
      onChanged();
      onClose();
    } catch (e: any) {
      console.error(e);
      toast.error('Erro ao tirar os pedidos da rota');
    } finally {
      setBusy(false);
    }
  };

  const resolverSemRemover = async () => {
    setBusy(true);
    try {
      await marcarResolvida([], true);
      toast.success('Divergência marcada como resolvida (nenhum pedido saiu da rota)');
      onChanged();
      onClose();
    } catch (e: any) {
      console.error(e);
      toast.error('Erro ao marcar como resolvida');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between bg-gray-50">
          <div>
            <h4 className="text-lg font-bold text-gray-900">Divergências da conferência</h4>
            <p className="text-xs text-gray-600 mt-0.5">
              {route?.name} • conferente: {String(route?.conferente || '').trim() || 'não informado'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {jaResolvida && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-green-800 text-sm font-medium">
              <CheckCircle2 className="h-5 w-5" /> Esta divergência já foi tratada em{' '}
              {new Date(conf.resolved_at).toLocaleString('pt-BR')}.
            </div>
          )}

          {rows.length === 0 ? (
            <div className="text-center py-8 text-gray-500 font-medium">
              O conferente não apontou divergência nesta rota.
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-amber-900 text-sm">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <div>
                  O conferente informou que <strong>{rows.length} pedido(s)</strong> não subiram completos.
                  Marque quais devem sair da rota — eles voltam para a fila de roteirização.
                </div>
              </div>

              {rows.map((r) => {
                const removido = jaRemovidos.includes(r.orderId);
                const parcial = (r.scanned || 0) > 0;
                return (
                  <label
                    key={r.orderId}
                    className={`block border rounded-lg overflow-hidden cursor-pointer ${selected[r.orderId] ? 'border-red-400 ring-1 ring-red-200' : 'border-gray-200'} ${removido ? 'opacity-60' : ''}`}
                  >
                    <div className="px-4 py-3 bg-gray-50 border-b flex items-center gap-3">
                      <input
                        type="checkbox"
                        disabled={removido || jaResolvida}
                        checked={Boolean(selected[r.orderId])}
                        onChange={(e) => setSelected((prev) => ({ ...prev, [r.orderId]: e.target.checked }))}
                        className="h-4 w-4 text-red-600 rounded border-gray-300"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-gray-900 truncate">
                          Pedido {r.erp} • {r.customer}
                        </div>
                        {typeof r.required === 'number' && (
                          <div className="text-xs text-gray-600 mt-0.5">
                            Conferido: {r.scanned || 0} de {r.required} volume(s)
                          </div>
                        )}
                      </div>
                      {removido && (
                        <span className="shrink-0 text-[11px] font-semibold bg-gray-200 text-gray-700 px-2 py-1 rounded-full">
                          Já saiu da rota
                        </span>
                      )}
                    </div>

                    <div className="p-4 space-y-2 bg-white">
                      {r.produtos.length > 0 && (
                        <ul className="space-y-1.5">
                          {r.produtos.map((p, i) => (
                            <li key={i} className="text-sm bg-red-50 border border-red-100 rounded px-3 py-2">
                              <span className="font-semibold text-gray-900">{p.sku}</span>
                              <span className="text-gray-500"> — </span>
                              <span className="text-red-700 font-medium">{reasonLabel(p.reason)}</span>
                              {p.notes && <span className="text-gray-600"> • {p.notes}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                      {r.volumesFaltantes.length > 0 && (
                        <details className="text-xs text-gray-600">
                          <summary className="cursor-pointer font-medium">
                            Etiquetas não bipadas ({r.volumesFaltantes.length})
                          </summary>
                          <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-1.5">
                            {r.volumesFaltantes.map((c, i) => (
                              <span key={`${c}-${i}`} className="font-mono text-center bg-gray-100 border rounded px-2 py-1">{c}</span>
                            ))}
                          </div>
                        </details>
                      )}
                      {parcial && (
                        <div className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                          <Truck className="h-4 w-4 shrink-0" />
                          <span>
                            Atenção: {r.scanned} volume(s) deste pedido <strong>já estão no caminhão</strong>. Se tirar
                            o pedido da rota, descarregue essa mercadoria antes de o motorista sair.
                          </span>
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </>
          )}
        </div>

        {rows.length > 0 && !jaResolvida && (
          <div className="px-6 py-4 border-t bg-gray-50 space-y-3">
            {parciaisSelecionados.length > 0 && (
              <div className="text-xs text-amber-800 bg-amber-100 border border-amber-200 rounded px-3 py-2">
                {parciaisSelecionados.length} dos pedidos marcados já têm volume carregado — confirme a descarga no galpão.
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <button onClick={onClose} className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg font-medium">
                Fechar
              </button>
              <button
                onClick={resolverSemRemover}
                disabled={busy}
                className="px-4 py-2 bg-teal-600 text-white hover:bg-teal-700 rounded-lg font-medium disabled:opacity-60"
              >
                Resolvi por fora (manter na rota)
              </button>
              <button
                onClick={tirarDaRota}
                disabled={busy || selectedIds.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-lg font-semibold disabled:opacity-50"
              >
                <PackageX className="h-4 w-4" />
                Tirar da rota{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
