import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Check, CheckCheck, FileText, Link2, Loader2, MapPin, Paperclip, Search, Send, X } from 'lucide-react';
import supabase from '../../../supabase/client';
import { chamarWhatsapp, ehSenhaPedida, esquecerSenha, FormSenha } from './senha';

// Atendimento pelo WhatsApp. Consulta a cada 3 s pela API, e não pelo Realtime do banco,
// para as mensagens continuarem protegidas pela senha da tela.

type Conversa = {
  id: string;
  telefone: string;
  nome_contato: string | null;
  order_id_erp: string | null;
  status: 'aberta' | 'aguardando' | 'fechada';
  ultima_mensagem: string | null;
  ultima_mensagem_em: string | null;
  nao_lidas: number;
  cliente: string | null;
};
type Mensagem = {
  id: string;
  direcao: 'in' | 'out';
  tipo: string;
  texto: string | null;
  midia_path: string | null;
  midia_mimetype: string | null;
  lat: number | null;
  lng: number | null;
  local_nome: string | null;
  autor: string | null;
  status_envio: string | null;
  enviada_em: string;
};
type Painel = { conversas: Conversa[]; conversa: Conversa | null; mensagens: Mensagem[]; estado: string | null };
type Pedido = { order_id_erp: string; customer_name: string; phone: string; status: string };

const INTERVALO_MS = 3_000;
const LIMITE_ANEXO = 16 * 1024 * 1024;
const TIPOS_ANEXO = 'image/jpeg,image/png,image/webp,video/mp4,audio/mpeg,audio/ogg,audio/mp4,application/pdf,.doc,.docx,.xls,.xlsx';
const FUSO = 'America/Sao_Paulo';

const horaDe = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
const diaDe = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' });

function telefoneExibido(t: string): string {
  if (t.startsWith('lid:')) return 'Número oculto';
  const m = t.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : t;
}
const nomeDe = (c: Conversa) => c.cliente || c.nome_contato || telefoneExibido(c.telefone);

function quandoLista(iso: string | null): string {
  if (!iso) return '';
  return diaDe(iso) === diaDe(new Date().toISOString()) ? horaDe(iso) : diaDe(iso).slice(0, 5);
}

function Midia({ m }: { m: Mensagem }) {
  const [url, setUrl] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let ativo = true;
    chamarWhatsapp<{ url: string }>('wa_midia_url', { params: { mensagem_id: m.id } })
      .then((r) => { if (ativo) setUrl(r.url); })
      .catch(() => { if (ativo) setFalhou(true); });
    return () => { ativo = false; };
  }, [m.id]);

  if (falhou) return <p className="text-xs italic text-gray-500">Não consegui abrir o arquivo.</p>;
  if (!url) return <Loader2 className="h-5 w-5 animate-spin text-gray-400" />;
  if (m.tipo === 'imagem') {
    return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Foto recebida" className="max-h-64 rounded-lg" /></a>;
  }
  if (m.tipo === 'video') return <video src={url} controls className="max-h-64 rounded-lg" />;
  if (m.tipo === 'audio') {
    return (
      <div>
        <audio src={url} controls className="max-w-full" />
        <a href={url} target="_blank" rel="noreferrer" className="text-xs text-blue-700 underline">Abrir áudio</a>
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-blue-700 underline">
      <FileText className="h-5 w-5" /> Abrir documento
    </a>
  );
}

function Localizacao({ m }: { m: Mensagem }) {
  const [semMapa, setSemMapa] = useState(false);
  return (
    <div className="space-y-1">
      {!semMapa && (
        <img src={`/api/static-map?lat=${m.lat}&lng=${m.lng}&w=320&h=160&z=16`} alt="Mapa da localização" onError={() => setSemMapa(true)} className="rounded-lg" />
      )}
      {m.local_nome && <p className="text-sm">{m.local_nome}</p>}
      <a href={`https://www.google.com/maps?q=${m.lat},${m.lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-blue-700 underline">
        <MapPin className="h-4 w-4" /> Abrir no Google Maps
      </a>
    </div>
  );
}

function Balao({ m }: { m: Mensagem }) {
  const saida = m.direcao === 'out';
  const temMidia = ['imagem', 'audio', 'video', 'documento'].includes(m.tipo);
  return (
    <div className={`flex ${saida ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] sm:max-w-[70%] rounded-lg px-3 py-2 shadow-sm ${saida ? 'bg-green-100' : 'bg-white'}`}>
        {saida && m.autor && <p className="text-xs font-semibold text-green-800">{m.autor === 'celular' ? 'Pelo celular' : m.autor}</p>}
        {temMidia && (m.midia_path ? <Midia m={m} /> : <p className="text-xs italic text-gray-500">Arquivo não guardado ({m.tipo})</p>)}
        {m.tipo === 'localizacao' && m.lat !== null && <Localizacao m={m} />}
        {m.tipo === 'outro' && !m.texto && <p className="text-xs italic text-gray-500">Mensagem não exibida (figurinha ou outro formato)</p>}
        {m.texto && <p className="whitespace-pre-wrap break-words text-gray-900">{m.texto}</p>}
        <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-gray-500">
          {horaDe(m.enviada_em)}
          {saida && m.status_envio === 'sent' && <Check className="h-3.5 w-3.5" />}
          {saida && m.status_envio === 'delivered' && <CheckCheck className="h-3.5 w-3.5" />}
          {saida && m.status_envio === 'read' && <CheckCheck className="h-3.5 w-3.5 text-blue-600" />}
          {saida && m.status_envio === 'failed' && <span className="font-semibold text-red-700">não enviada</span>}
        </p>
      </div>
    </div>
  );
}

function Vincular({ conversa, aoSalvar, aoFechar }: { conversa: Conversa; aoSalvar: () => void; aoFechar: () => void }) {
  const [q, setQ] = useState(conversa.telefone.startsWith('lid:') ? '' : conversa.telefone.slice(-8));
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const buscar = useCallback(async (termo: string) => {
    if (termo.trim().length < 3) return;
    setOcupado(true);
    try {
      const r = await chamarWhatsapp<{ pedidos: Pedido[] }>('wa_buscar_pedido', { params: { q: termo } });
      setPedidos(r.pedidos);
    } catch (e: any) {
      toast.error(e.message || 'Não consegui buscar.');
    } finally {
      setOcupado(false);
    }
  }, []);

  // Já abre procurando pelo telefone da conversa.
  useEffect(() => { buscar(conversa.telefone.startsWith('lid:') ? '' : conversa.telefone.slice(-8)); }, [buscar, conversa.telefone]);

  const salvar = async (codigo: string | null) => {
    setOcupado(true);
    try {
      await chamarWhatsapp('wa_vincular', { method: 'POST', body: { conversa_id: conversa.id, order_id_erp: codigo } });
      toast.success(codigo ? 'Pedido vinculado.' : 'Vínculo removido.');
      aoSalvar();
      aoFechar();
    } catch (e: any) {
      toast.error(e.message || 'Não consegui vincular.');
      setOcupado(false);
    }
  };

  return (
    <div className="border-b bg-white p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-medium text-gray-800">Vincular ao pedido</p>
        <button onClick={aoFechar} className="p-1 text-gray-500 hover:bg-gray-100 rounded" title="Fechar"><X className="h-4 w-4" /></button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); buscar(q); }} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, telefone ou nome" className="flex-1 rounded-lg border px-3 py-1.5" />
        <button disabled={ocupado} className="rounded-lg bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50">Buscar</button>
      </form>
      {conversa.order_id_erp && (
        <button disabled={ocupado} onClick={() => salvar(null)} className="text-sm text-red-700 underline">
          Remover vínculo com o pedido {conversa.order_id_erp}
        </button>
      )}
      {pedidos?.length === 0 && <p className="text-sm text-gray-500">Nenhum pedido encontrado.</p>}
      <ul className="max-h-48 overflow-auto divide-y">
        {pedidos?.map((p) => (
          <li key={p.order_id_erp}>
            <button disabled={ocupado} onClick={() => salvar(p.order_id_erp)} className="w-full p-2 text-left text-sm hover:bg-blue-50">
              <b>{p.order_id_erp}</b> · {p.customer_name} <span className="text-gray-500">· {p.phone}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Atendimento() {
  const [painel, setPainel] = useState<Painel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [precisaSenha, setPrecisaSenha] = useState(false);
  const [filtro, setFiltro] = useState<'abertas' | 'fechadas'>('abertas');
  const [busca, setBusca] = useState('');
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [anexo, setAnexo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [vinculando, setVinculando] = useState(false);
  const travaEnvio = useRef(false); // segura o segundo toque antes de o botão desabilitar
  const ultimaConsulta = useRef(0);
  const caixaMensagens = useRef<HTMLDivElement>(null);
  const pertoDoFim = useRef(true);
  const inputArquivo = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const consulta = ++ultimaConsulta.current;
    try {
      const r = await chamarWhatsapp<Painel>('wa_atendimento', { params: { filtro, ...(selecionada ? { conversa_id: selecionada } : {}) } });
      if (consulta !== ultimaConsulta.current) return; // chegou atrasada: já se pediu outra conversa
      setPainel(r);
      setErro(null);
      setPrecisaSenha(false);
    } catch (e: any) {
      if (consulta !== ultimaConsulta.current) return;
      if (ehSenhaPedida(e)) {
        esquecerSenha();
        setPainel(null);
        setPrecisaSenha(true);
        return;
      }
      setErro(e.message || 'Falha ao buscar as conversas.');
    }
  }, [filtro, selecionada]);

  useEffect(() => {
    if (precisaSenha) return;
    carregar();
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') carregar(); }, INTERVALO_MS);
    return () => window.clearInterval(id);
  }, [carregar, precisaSenha]);

  const conversa = painel?.conversa?.id === selecionada ? painel?.conversa ?? null : null;
  const mensagens = useMemo(() => (conversa ? painel?.mensagens ?? [] : []), [conversa, painel?.mensagens]);

  // Abriu a conversa, ou chegou mensagem com ela aberta: zera as não lidas.
  const naoLidas = conversa?.nao_lidas ?? 0;
  useEffect(() => {
    if (!selecionada || naoLidas === 0 || document.visibilityState !== 'visible') return;
    chamarWhatsapp('wa_marcar_lida', { method: 'POST', body: { conversa_id: selecionada } }).then(carregar).catch(() => { /* tenta na próxima */ });
  }, [selecionada, naoLidas, carregar]);

  useEffect(() => {
    pertoDoFim.current = true;
    setVinculando(false);
    setTexto('');
    setAnexo(null);
  }, [selecionada]);

  // Desce com mensagem nova, sem puxar quem está lendo o histórico.
  useEffect(() => {
    const caixa = caixaMensagens.current;
    if (caixa && pertoDoFim.current) caixa.scrollTop = caixa.scrollHeight;
  }, [mensagens]);

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const conversas = painel?.conversas ?? [];
    if (!termo) return conversas;
    return conversas.filter((c) => `${nomeDe(c)} ${c.telefone} ${c.order_id_erp ?? ''}`.toLowerCase().includes(termo));
  }, [painel?.conversas, busca]);

  const escolherArquivo = (arquivo: File | undefined) => {
    if (inputArquivo.current) inputArquivo.current.value = '';
    if (!arquivo) return;
    if (arquivo.size > LIMITE_ANEXO) { toast.error('O arquivo passa de 16 MB.'); return; }
    if (!arquivo.type) { toast.error('Não reconheci o tipo desse arquivo.'); return; }
    setAnexo(arquivo);
  };

  const enviar = async () => {
    if (!conversa || travaEnvio.current || (!texto.trim() && !anexo)) return;
    travaEnvio.current = true;
    setEnviando(true);
    try {
      let dadosAnexo: { caminho: string; nome: string } | undefined;
      if (anexo) {
        const preparo = await chamarWhatsapp<{ caminho: string; token: string }>('wa_preparar_anexo', {
          method: 'POST', body: { conversa_id: conversa.id, mimetype: anexo.type },
        });
        const { error } = await supabase.storage.from('wa-midia').uploadToSignedUrl(preparo.caminho, preparo.token, anexo, { contentType: anexo.type });
        if (error) throw new Error('Não consegui subir o arquivo.');
        dadosAnexo = { caminho: preparo.caminho, nome: anexo.name };
      }
      await chamarWhatsapp('wa_enviar', { method: 'POST', body: { conversa_id: conversa.id, texto, anexo: dadosAnexo } });
      setTexto('');
      setAnexo(null);
      pertoDoFim.current = true;
      await carregar();
    } catch (e: any) {
      toast.error(e.message || 'Não consegui enviar.');
    } finally {
      travaEnvio.current = false;
      setEnviando(false);
    }
  };

  const mudarStatus = async (acao: 'wa_fechar' | 'wa_reabrir') => {
    if (!conversa) return;
    try {
      await chamarWhatsapp(acao, { method: 'POST', body: { conversa_id: conversa.id } });
      if (acao === 'wa_fechar') setSelecionada(null);
      await carregar();
    } catch (e: any) {
      toast.error(e.message || 'Não consegui salvar.');
    }
  };

  if (precisaSenha) return <FormSenha aoEntrar={carregar} />;
  if (!painel && !erro) {
    return <div className="p-6 flex items-center gap-2 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> Carregando conversas…</div>;
  }

  let diaAnterior = '';

  return (
    <div className="h-full flex flex-col">
      {painel?.estado === 'close' && (
        <Link to="/admin/whatsapp/conexao" className="shrink-0 bg-red-100 px-4 py-2 text-center text-sm font-medium text-red-800">
          WhatsApp desconectado: as mensagens não estão chegando. Clique para reconectar.
        </Link>
      )}
      {erro && <div className="shrink-0 bg-red-50 px-4 py-2 text-sm text-red-700">{erro}</div>}

      <div className="flex-1 min-h-0 flex">
        <aside className={`${selecionada ? 'hidden md:flex' : 'flex'} w-full md:w-80 shrink-0 flex-col border-r bg-white`}>
          <div className="p-3 space-y-2 border-b">
            <div className="flex rounded-lg bg-gray-100 p-1 text-sm">
              {(['abertas', 'fechadas'] as const).map((f) => (
                <button key={f} onClick={() => { setFiltro(f); setSelecionada(null); }} className={`flex-1 rounded-md py-1 capitalize ${filtro === f ? 'bg-white font-semibold shadow-sm' : 'text-gray-600'}`}>
                  {f}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar conversa" className="w-full rounded-lg border py-1.5 pl-8 pr-3 text-sm" />
            </div>
          </div>
          <ul className="flex-1 overflow-auto divide-y">
            {lista.length === 0 && <li className="p-4 text-sm text-gray-500">Nenhuma conversa.</li>}
            {lista.map((c) => (
              <li key={c.id}>
                <button onClick={() => setSelecionada(c.id)} className={`w-full p-3 text-left hover:bg-gray-50 ${c.id === selecionada ? 'bg-blue-50' : ''}`}>
                  <div className="flex justify-between gap-2">
                    <span className="truncate font-medium text-gray-900">{nomeDe(c)}</span>
                    <span className="shrink-0 text-xs text-gray-500">{quandoLista(c.ultima_mensagem_em)}</span>
                  </div>
                  <div className="mt-0.5 flex justify-between gap-2">
                    <span className="truncate text-sm text-gray-600">{c.ultima_mensagem}</span>
                    {c.nao_lidas > 0 && <span className="shrink-0 rounded-full bg-green-600 px-1.5 text-xs font-semibold text-white">{c.nao_lidas}</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className={`${selecionada ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col bg-[#efeae2]`}>
          {!selecionada && <div className="m-auto text-gray-500">Escolha uma conversa.</div>}
          {selecionada && !conversa && <div className="m-auto"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>}
          {conversa && (
            <>
              <header className="shrink-0 flex items-center gap-2 border-b bg-white p-3">
                <button onClick={() => setSelecionada(null)} className="md:hidden p-1 text-gray-600" title="Voltar"><ArrowLeft className="h-5 w-5" /></button>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-gray-900">{nomeDe(conversa)}</p>
                  <p className="truncate text-xs text-gray-500">
                    {telefoneExibido(conversa.telefone)}
                    {conversa.order_id_erp ? ` · Pedido ${conversa.order_id_erp}` : ''}
                  </p>
                </div>
                <button onClick={() => setVinculando((v) => !v)} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-sm text-gray-700 hover:bg-gray-50">
                  <Link2 className="h-4 w-4" /> <span className="hidden sm:inline">Pedido</span>
                </button>
                {conversa.status === 'fechada'
                  ? <button onClick={() => mudarStatus('wa_reabrir')} className="rounded-lg border px-2 py-1 text-sm text-gray-700 hover:bg-gray-50">Reabrir</button>
                  : <button onClick={() => mudarStatus('wa_fechar')} className="rounded-lg border px-2 py-1 text-sm text-gray-700 hover:bg-gray-50">Fechar</button>}
              </header>

              {vinculando && <Vincular conversa={conversa} aoSalvar={carregar} aoFechar={() => setVinculando(false)} />}

              <div
                ref={caixaMensagens}
                onScroll={(e) => {
                  const c = e.currentTarget;
                  pertoDoFim.current = c.scrollHeight - c.scrollTop - c.clientHeight < 80;
                }}
                className="flex-1 overflow-auto p-3 space-y-2"
              >
                {mensagens.map((m) => {
                  const dia = diaDe(m.enviada_em);
                  const novoDia = dia !== diaAnterior;
                  diaAnterior = dia;
                  return (
                    <Fragment key={m.id}>
                      {novoDia && <p className="mx-auto w-fit rounded-md bg-white/80 px-2 py-0.5 text-xs text-gray-600">{dia}</p>}
                      <Balao m={m} />
                    </Fragment>
                  );
                })}
              </div>

              <footer className="shrink-0 bg-white p-2 border-t">
                {anexo && (
                  <div className="mb-2 flex items-center justify-between rounded-lg bg-gray-100 px-3 py-1 text-sm">
                    <span className="truncate">{anexo.name}</span>
                    <button onClick={() => setAnexo(null)} className="p-1" title="Tirar anexo"><X className="h-4 w-4" /></button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <input ref={inputArquivo} type="file" accept={TIPOS_ANEXO} className="hidden" onChange={(e) => escolherArquivo(e.target.files?.[0])} />
                  <button onClick={() => inputArquivo.current?.click()} disabled={enviando} className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50" title="Anexar arquivo">
                    <Paperclip className="h-5 w-5" />
                  </button>
                  <textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
                    }}
                    rows={1}
                    placeholder="Digite uma mensagem"
                    className="flex-1 resize-none rounded-lg border px-3 py-2 max-h-32"
                  />
                  <button onClick={enviar} disabled={enviando || (!texto.trim() && !anexo)} className="p-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50" title="Enviar">
                    {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                  </button>
                </div>
              </footer>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
