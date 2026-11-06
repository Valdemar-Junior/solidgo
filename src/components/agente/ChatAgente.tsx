import { Fragment, useEffect, useRef, useState } from 'react';
import { Bot, Loader2, RotateCcw, Send, Wrench, X } from 'lucide-react';
import supabase from '../../supabase/client';
import { chamarAgente } from '../../pages/admin/agente/api';
import CartaoAprovacao from './CartaoAprovacao';

// Chat do admin com o agente (Hermes), fase 3. Fica num botão flutuante em todas
// as telas do admin. A conversa vive só nesta aba (sessionStorage, igual ao login).
// O navegador fala com /api/agente (servidor do SolidGo), nunca direto com o Hermes.

type Msg = { role: 'user' | 'assistant'; content: string };
const CHAVE = 'solidgo-chat-agente';
const LINK_APROVACAO = /https?:\/\/[^\s)\]]*\/admin\/agente\/aprovar\/([0-9a-f-]{36})/gi;
const NOMES_FERRAMENTA: Record<string, string> = {
  listar_pedidos_pendentes: 'consultando a fila de pedidos',
  listar_motoristas_veiculos: 'consultando motoristas e veículos',
  listar_rotas_cadastradas: 'consultando rotas cadastradas',
  ver_rota: 'abrindo a rota',
  preparar_rota: 'preparando a prévia da rota',
  consultar_aprovacao: 'conferindo a aprovação',
};

function lerSalvo(): { sessao: string; msgs: Msg[] } {
  try {
    const s = JSON.parse(sessionStorage.getItem(CHAVE) || 'null');
    if (s && typeof s.sessao === 'string' && Array.isArray(s.msgs)) return s;
  } catch { /* sem armazenamento: começa do zero */ }
  return { sessao: crypto.randomUUID(), msgs: [] };
}

// Texto simples com **negrito** e quebras de linha; links de aprovação viram cartão.
function Conteudo({ texto }: { texto: string }) {
  const ids = [...new Set([...texto.matchAll(LINK_APROVACAO)].map((m) => m[1]))];
  const limpo = texto.replace(LINK_APROVACAO, '').replace(/\n{3,}/g, '\n\n').trim();
  return (
    <div className="space-y-2">
      {limpo && (
        <div className="whitespace-pre-wrap break-words">
          {limpo.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
            parte.startsWith('**') && parte.endsWith('**')
              ? <strong key={i}>{parte.slice(2, -2)}</strong>
              : <Fragment key={i}>{parte}</Fragment>,
          )}
        </div>
      )}
      {ids.map((id) => <CartaoAprovacao key={id} id={id} />)}
    </div>
  );
}

export default function ChatAgente() {
  const [aberto, setAberto] = useState(false);
  const [estado, setEstado] = useState(lerSalvo);
  const [entrada, setEntrada] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [ferramenta, setFerramenta] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { sessionStorage.setItem(CHAVE, JSON.stringify(estado)); } catch { /* ignora */ }
    fim.current?.scrollIntoView({ behavior: 'smooth' });
  }, [estado, ferramenta]);

  useEffect(() => {
    if (!aberto) return;
    chamarAgente<{ configurado: boolean; ativo: boolean }>('chat_status')
      .then((s) => setAviso(!s.configurado ? 'O chat ainda não foi ligado ao Hermes (falta configurar na Vercel).' : !s.ativo ? 'O agente está desligado em Agente IA.' : null))
      .catch(() => setAviso(null));
  }, [aberto]);

  const novaConversa = () => {
    if (enviando) return;
    setEstado({ sessao: crypto.randomUUID(), msgs: [] });
  };

  const enviar = async () => {
    const texto = entrada.trim();
    if (!texto || enviando) return;
    const historico: Msg[] = [...estado.msgs, { role: 'user', content: texto }];
    setEstado((s) => ({ ...s, msgs: [...historico, { role: 'assistant', content: '' }] }));
    setEntrada('');
    setEnviando(true);
    setFerramenta(null);

    const acrescentar = (pedaco: string) => setEstado((s) => {
      const msgs = [...s.msgs];
      const ultima = msgs[msgs.length - 1];
      msgs[msgs.length - 1] = { ...ultima, content: ultima.content + pedaco };
      return { ...s, msgs };
    });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch('/api/agente?canal=admin&acao=chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ sessao: estado.sessao, mensagens: historico }),
      });
      if (!resp.ok || !resp.body) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j?.error || `Erro ${resp.status}`);
      }
      const leitor = resp.body.getReader();
      const dec = new TextDecoder();
      let resto = '';
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        resto += dec.decode(value, { stream: true });
        const linhas = resto.split('\n');
        resto = linhas.pop() ?? '';
        for (const linha of linhas) {
          if (!linha.trim()) continue;
          let ev: { t: string; v?: string };
          try { ev = JSON.parse(linha); } catch { continue; }
          if (ev.t === 'texto' && ev.v) { setFerramenta(null); acrescentar(ev.v); }
          else if (ev.t === 'ferramenta' && ev.v) setFerramenta(NOMES_FERRAMENTA[ev.v] || `usando ${ev.v}`);
          else if (ev.t === 'erro' && ev.v) acrescentar(`\n\n⚠️ ${ev.v}`);
        }
      }
    } catch (e: any) {
      acrescentar(`⚠️ ${e.message || 'Falha ao falar com o agente.'}`);
    } finally {
      setEnviando(false);
      setFerramenta(null);
      setEstado((s) => {
        const ultima = s.msgs[s.msgs.length - 1];
        if (ultima?.role === 'assistant' && !ultima.content.trim()) {
          return { ...s, msgs: [...s.msgs.slice(0, -1), { role: 'assistant', content: '⚠️ O agente não respondeu.' }] };
        }
        return s;
      });
    }
  };

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-blue-600 px-4 py-3 text-white shadow-lg hover:bg-blue-700"
        aria-label="Abrir assistente"
      >
        <Bot className="h-5 w-5" /> <span className="text-sm font-semibold">Assistente</span>
      </button>
    );
  }

  return (
    <div className="fixed z-50 inset-x-2 bottom-2 top-16 sm:inset-auto sm:bottom-5 sm:right-5 sm:w-[420px] sm:h-[620px] flex flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2 font-semibold text-gray-900"><Bot className="h-5 w-5 text-blue-600" /> Assistente (Hermes)</div>
        <div className="flex items-center gap-1">
          <button onClick={novaConversa} title="Nova conversa" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><RotateCcw className="h-4 w-4" /></button>
          <button onClick={() => setAberto(false)} title="Fechar" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
        {aviso && <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-2 text-xs text-yellow-900">{aviso}</div>}
        {estado.msgs.length === 0 && (
          <div className="text-gray-500 text-sm space-y-2">
            <p>Peça, por exemplo:</p>
            <p className="italic">“Quais pedidos de São Rafael estão aguardando rota? Veja as observações.”</p>
            <p className="italic">“Prepare a rota de São Rafael para 10/11 com o Leandro, veículo [placa], conferente [nome].”</p>
            <p className="text-xs">A rota só é criada quando você clica em <strong>Confirmar</strong> no cartão que aparece aqui.</p>
          </div>
        )}
        {estado.msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={m.role === 'user'
              ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-blue-600 px-3 py-2 text-white whitespace-pre-wrap break-words'
              : 'max-w-[95%] text-gray-800'}>
              {m.role === 'user' ? m.content : <Conteudo texto={m.content} />}
            </div>
          </div>
        ))}
        {enviando && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            {ferramenta ? <Wrench className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {ferramenta ? `${ferramenta}…` : 'pensando…'}
          </div>
        )}
        <div ref={fim} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); enviar(); }}
        className="flex items-end gap-2 border-t border-gray-100 p-3"
      >
        <textarea
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
          rows={2}
          placeholder="Escreva para o assistente…"
          className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button type="submit" disabled={enviando || !entrada.trim()} className="rounded-xl bg-blue-600 p-2.5 text-white hover:bg-blue-700 disabled:opacity-50" aria-label="Enviar">
          {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </button>
      </form>
    </div>
  );
}
