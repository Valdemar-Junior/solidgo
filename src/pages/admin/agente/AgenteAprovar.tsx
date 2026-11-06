import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Bot, CheckCircle2, Loader2, Truck, XCircle } from 'lucide-react';
import { chamarAgente, formatarDataHora, STATUS_APROVACAO } from './api';

type PedidoResumo = { order_id_erp: string; cliente: string | null; cidade: string | null; bairro: string | null; produtos: string[]; avisos: string[] };
type Aprovacao = {
  id: string;
  status: string;
  tipo: 'nova_rota' | 'adicionar_em_rota';
  criado_em: string;
  expira_em: string;
  pedido_por: string | null;
  decidido_em: string | null;
  route_code: string | null;
  erro: string | null;
  resumo: {
    rota?: string; romaneio?: string; equipe?: string | null; motorista?: string | null; ajudante?: string | null;
    veiculo?: string; conferente?: string; observacoes?: string | null; data_entrega?: string | null;
    pedidos_que_ja_estao?: number;
    pedidos: PedidoResumo[];
    pedidos_fora: { order_id_erp: string; motivo: string }[];
    avisos_gerais: string[];
  };
};

// Tela em que o admin confere a rota que o agente (Hermes) preparou e decide.
// Só o clique em "Confirmar" grava a rota (função agente_aprovar_rota no banco).
export default function AgenteAprovar() {
  const { id } = useParams<{ id: string }>();
  const [ap, setAp] = useState<Aprovacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<'aprovar' | 'recusar' | null>(null);

  const carregar = useCallback(async () => {
    try {
      setAp(await chamarAgente<Aprovacao>('aprovacao', { params: { id: String(id) } }));
      setErro(null);
    } catch (e: any) {
      setErro(e.message || 'Erro ao carregar');
    }
  }, [id]);

  useEffect(() => { carregar(); }, [carregar]);

  const decidir = async (decisao: 'aprovar' | 'recusar') => {
    if (decisao === 'recusar' && !window.confirm('Recusar esta rota? Nada será gravado.')) return;
    setEnviando(decisao);
    try {
      const r = await chamarAgente<any>('decidir', { method: 'POST', body: { id, decisao } });
      if (decisao === 'aprovar') {
        if (r.ok) toast.success(`Rota criada: ${r.route_code}`);
        else toast.error(r.erro || r.error || 'Não foi possível criar a rota');
      } else {
        toast.success('Proposta recusada');
      }
    } catch (e: any) {
      toast.error(e.message || 'Erro');
    } finally {
      setEnviando(null);
      carregar();
    }
  };

  if (erro) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-6">{erro}</div>
      </div>
    );
  }
  if (!ap) {
    return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>;
  }

  const r = ap.resumo;
  const st = STATUS_APROVACAO[ap.status] || STATUS_APROVACAO.erro;
  const pendente = ap.status === 'pendente';
  const totalAvisos = r.pedidos.reduce((n, p) => n + p.avisos.length, 0) + r.avisos_gerais.length;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6 pb-24">
      <Link to="/admin/agente" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> Agente IA
      </Link>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="border-b border-gray-100 bg-gray-50 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-blue-600" />
            <h1 className="font-bold text-gray-900">
              {ap.tipo === 'nova_rota' ? 'Nova rota preparada pelo agente' : `Adicionar pedidos ao romaneio ${r.romaneio}`}
            </h1>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${st.cor}`}>{st.rotulo}</span>
        </div>

        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <Campo rotulo="Rota" valor={r.rota} />
          {ap.tipo === 'nova_rota' ? (
            <>
              <Campo rotulo="Data da entrega" valor={r.data_entrega} />
              <Campo rotulo="Equipe" valor={r.equipe} />
              <Campo rotulo="Motorista" valor={r.motorista} />
              <Campo rotulo="Ajudante" valor={r.ajudante} />
              <Campo rotulo="Veículo" valor={r.veiculo} />
              <Campo rotulo="Conferente" valor={r.conferente} />
            </>
          ) : (
            <>
              <Campo rotulo="Motorista" valor={r.motorista} />
              <Campo rotulo="Pedidos que já estão nele" valor={String(r.pedidos_que_ja_estao ?? 0)} />
            </>
          )}
          <div className="sm:col-span-2"><Campo rotulo="Observações da rota" valor={r.observacoes} /></div>
          <div className="sm:col-span-2 text-xs text-gray-400">
            Preparada em {formatarDataHora(ap.criado_em)}{ap.pedido_por ? ` · pedido por ${ap.pedido_por}` : ''}
            {pendente ? ` · vale até ${formatarDataHora(ap.expira_em)}` : ''}
          </div>
        </div>
      </div>

      {r.avisos_gerais.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-900 space-y-1">
          {r.avisos_gerais.map((a, i) => <div key={i} className="flex gap-2"><AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />{a}</div>)}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="border-b border-gray-100 bg-gray-50 px-6 py-3 flex items-center gap-2">
          <Truck className="h-4 w-4 text-blue-600" />
          <h2 className="font-semibold text-gray-900 text-sm">
            {r.pedidos.length} pedido(s) na rota{totalAvisos > 0 ? ` · ${totalAvisos} aviso(s) para conferir` : ''}
          </h2>
        </div>
        <ol className="divide-y divide-gray-100">
          {r.pedidos.map((p, i) => (
            <li key={p.order_id_erp} className="px-6 py-3 text-sm">
              <div className="flex flex-wrap gap-x-3 items-baseline">
                <span className="text-gray-400 w-6">{i + 1}.</span>
                <span className="font-semibold text-gray-900">{p.order_id_erp}</span>
                <span className="text-gray-700">{p.cliente}</span>
                <span className="text-gray-500">{[p.cidade, p.bairro].filter(Boolean).join(' · ')}</span>
              </div>
              {p.produtos.length > 0 && <div className="ml-9 text-xs text-gray-500">{p.produtos.join(', ')}</div>}
              {p.avisos.map((a, j) => (
                <div key={j} className="ml-9 mt-1 flex gap-1.5 text-xs text-yellow-800 bg-yellow-50 rounded px-2 py-1">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />{a}
                </div>
              ))}
            </li>
          ))}
        </ol>
      </div>

      {r.pedidos_fora.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="border-b border-gray-100 bg-gray-50 px-6 py-3 text-sm font-semibold text-gray-700">
            {r.pedidos_fora.length} pedido(s) que ficaram de fora
          </div>
          <ul className="divide-y divide-gray-100">
            {r.pedidos_fora.map((p) => (
              <li key={p.order_id_erp} className="px-6 py-2 text-sm"><span className="font-semibold">{p.order_id_erp}</span> — <span className="text-gray-600">{p.motivo}</span></li>
            ))}
          </ul>
        </div>
      )}

      {ap.status === 'aprovada' && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded-xl p-4 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5" /> Rota criada: <strong>{ap.route_code}</strong>. Ela já aparece na Gestão de Entregas.
        </div>
      )}
      {ap.status === 'erro' && ap.erro && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">{ap.erro}</div>
      )}

      {pendente && (
        <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
          <button
            onClick={() => decidir('recusar')}
            disabled={enviando !== null}
            className="px-5 py-3 rounded-xl border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {enviando === 'recusar' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Recusar
          </button>
          <button
            onClick={() => decidir('aprovar')}
            disabled={enviando !== null}
            className="px-6 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {enviando === 'aprovar' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {ap.tipo === 'nova_rota' ? 'Confirmar e criar rota' : 'Confirmar e adicionar'}
          </button>
        </div>
      )}
    </div>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor?: string | null }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">{rotulo}</div>
      <div className="text-gray-900">{valor || '—'}</div>
    </div>
  );
}
