import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Truck, XCircle } from 'lucide-react';
import { chamarAgente, STATUS_APROVACAO } from '../../pages/admin/agente/api';

// Cartão de aprovação dentro do chat: mesma decisão da tela /admin/agente/aprovar/:id,
// sem sair da conversa. Só o clique em Confirmar grava a rota.
export default function CartaoAprovacao({ id }: { id: string }) {
  const [ap, setAp] = useState<any>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<'aprovar' | 'recusar' | null>(null);

  const carregar = useCallback(async () => {
    try { setAp(await chamarAgente('aprovacao', { params: { id } })); setErro(null); }
    catch (e: any) { setErro(e.message || 'Erro'); }
  }, [id]);
  useEffect(() => { carregar(); }, [carregar]);

  const decidir = async (decisao: 'aprovar' | 'recusar') => {
    if (decisao === 'recusar' && !window.confirm('Recusar esta rota? Nada será gravado.')) return;
    setEnviando(decisao);
    try {
      const r = await chamarAgente<any>('decidir', { method: 'POST', body: { id, decisao } });
      if (decisao === 'aprovar') r.ok ? toast.success(`Rota criada: ${r.route_code}`) : toast.error(r.erro || 'Não foi possível criar');
      else toast.success('Proposta recusada');
    } catch (e: any) { toast.error(e.message || 'Erro'); }
    finally { setEnviando(null); carregar(); }
  };

  if (erro) return <div className="text-xs text-red-600 border border-red-200 bg-red-50 rounded-lg p-2">Prévia indisponível: {erro}</div>;
  if (!ap) return <div className="flex items-center gap-2 text-xs text-gray-500 border rounded-lg p-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> carregando prévia…</div>;

  const r = ap.resumo || {};
  const st = STATUS_APROVACAO[ap.status] || STATUS_APROVACAO.erro;
  const avisos = (r.pedidos || []).reduce((n: number, p: any) => n + (p.avisos?.length || 0), 0) + (r.avisos_gerais?.length || 0);
  const pendente = ap.status === 'pendente';

  return (
    <div className="border border-blue-200 bg-white rounded-xl p-3 space-y-2 text-sm shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-gray-900">
          <Truck className="h-4 w-4 text-blue-600" />
          {ap.tipo === 'nova_rota' ? r.rota : `Adicionar em ${r.romaneio}`}
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${st.cor}`}>{st.rotulo}</span>
      </div>
      <div className="text-xs text-gray-600 space-y-0.5">
        {r.motorista && <div>Motorista: {r.motorista}{r.ajudante ? ` · Ajudante: ${r.ajudante}` : ''}</div>}
        {r.veiculo && <div>Veículo: {r.veiculo}{r.conferente ? ` · Conferente: ${r.conferente}` : ''}</div>}
        {r.data_entrega && <div>Entrega: {r.data_entrega}</div>}
        <div>{(r.pedidos || []).length} pedido(s){(r.pedidos_fora || []).length ? ` · ${(r.pedidos_fora || []).length} fora` : ''}</div>
      </div>
      {avisos > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-yellow-800 bg-yellow-50 rounded px-2 py-1">
          <AlertTriangle className="h-3.5 w-3.5" /> {avisos} aviso(s) — veja os detalhes antes de confirmar
        </div>
      )}
      {ap.status === 'aprovada' && <div className="text-xs text-green-700 font-medium">Rota criada: {ap.route_code}</div>}
      {ap.status === 'erro' && ap.erro && <div className="text-xs text-red-700">{ap.erro}</div>}
      <div className="flex flex-wrap gap-2 pt-1">
        <Link to={`/admin/agente/aprovar/${id}`} className="px-2.5 py-1.5 rounded-lg border border-gray-300 text-xs flex items-center gap-1 hover:bg-gray-50">
          <ExternalLink className="h-3.5 w-3.5" /> Detalhes
        </Link>
        {pendente && (
          <>
            <button onClick={() => decidir('recusar')} disabled={enviando !== null}
              className="px-2.5 py-1.5 rounded-lg border border-gray-300 text-xs flex items-center gap-1 hover:bg-gray-50 disabled:opacity-50">
              {enviando === 'recusar' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Recusar
            </button>
            <button onClick={() => decidir('aprovar')} disabled={enviando !== null}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold flex items-center gap-1 hover:bg-blue-700 disabled:opacity-50">
              {enviando === 'aprovar' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Confirmar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
