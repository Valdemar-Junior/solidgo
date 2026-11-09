import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, MapPin, QrCode, RefreshCw, Smartphone, WifiOff } from 'lucide-react';
import { chamarAgente, formatarDataHora } from '../agente/api';

// Tela de conexão do número de WhatsApp (Evolution API), só admin.
// Tudo passa por /api/agente: o navegador nunca vê a chave da Evolution.

type Ultima = {
  id: string;
  direcao: 'in' | 'out';
  tipo: string;
  texto: string | null;
  midia_path: string | null;
  lat: number | null;
  lng: number | null;
  enviada_em: string;
  conversa: { telefone: string; nome_contato: string | null; remote_jid: string } | null;
};
type Estado = {
  configurado: boolean;
  estado?: string;
  numero?: string | null;
  nome_perfil?: string | null;
  conectado_em?: string | null;
  recebimento_ativo?: boolean;
  recebimento_endereco?: string | null;
  ultimas?: Ultima[];
};

const SEGUNDOS_QR = 30;
const CHAVE_SENHA = 'wa_tela_senha'; // só nesta aba: fechou, pede de novo
const SENHA_PEDIDA = 'SENHA_WHATSAPP';

const chamar = <T = any,>(acao: string, opcoes: { method?: 'GET' | 'POST'; body?: unknown } = {}) =>
  chamarAgente<T>(acao, { ...opcoes, headers: { 'x-wa-senha': encodeURIComponent(sessionStorage.getItem(CHAVE_SENHA) || '') } });

const srcDoQr = (b: string) => (b.startsWith('data:') ? b : `data:image/png;base64,${b}`);

function resumo(m: Ultima): string {
  if (m.tipo === 'localizacao') return `📍 ${m.lat}, ${m.lng}`;
  if (m.tipo === 'texto') return m.texto || '';
  const arquivo = ['imagem', 'audio', 'video', 'documento'].includes(m.tipo)
    ? (m.midia_path ? 'arquivo guardado' : 'arquivo NÃO guardado')
    : '';
  return [`[${m.tipo}]`, m.texto, arquivo].filter(Boolean).join(' · ');
}

export default function Conexao() {
  const [dados, setDados] = useState<Estado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [modo, setModo] = useState<'qr' | 'codigo' | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [restante, setRestante] = useState(SEGUNDOS_QR);
  const [numero, setNumero] = useState('');
  const [codigo, setCodigo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [precisaSenha, setPrecisaSenha] = useState(false);
  const [senha, setSenha] = useState('');
  const [senhaErrada, setSenhaErrada] = useState(false);
  const contagem = useRef(SEGUNDOS_QR);

  const conectado = dados?.estado === 'open';

  const carregar = useCallback(async () => {
    try {
      setDados(await chamar<Estado>('wa_estado'));
      setErro(null);
      setPrecisaSenha(false);
    } catch (e: any) {
      if (e.message === SENHA_PEDIDA) {
        sessionStorage.removeItem(CHAVE_SENHA);
        setDados(null);
        setPrecisaSenha(true);
        return;
      }
      setErro(e.message || 'Falha ao consultar o WhatsApp.');
    }
  }, []);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    sessionStorage.setItem(CHAVE_SENHA, senha);
    setSenha('');
    setSenhaErrada(true); // se a senha servir, o formulário some
    await carregar();
  };

  // Enquanto conecta, confere a cada 5 s para virar "Conectado" logo.
  useEffect(() => {
    if (precisaSenha) return;
    carregar();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') carregar();
    }, modo ? 5_000 : 30_000);
    return () => window.clearInterval(id);
  }, [carregar, modo, precisaSenha]);

  useEffect(() => {
    if (conectado) {
      setModo(null);
      setQr(null);
      setCodigo(null);
    }
  }, [conectado]);

  // O QR do WhatsApp expira: renova sozinho a cada 30 s.
  useEffect(() => {
    if (modo !== 'qr') return;
    let ativo = true;
    const gerar = async () => {
      try {
        const r = await chamar<{ base64: string | null }>('wa_qr', { method: 'POST' });
        if (ativo) setQr(r.base64);
      } catch (e: any) {
        if (ativo) toast.error(e.message || 'Não consegui gerar o QR.');
      }
    };
    gerar();
    contagem.current = SEGUNDOS_QR;
    setRestante(SEGUNDOS_QR);
    const id = window.setInterval(() => {
      contagem.current -= 1;
      if (contagem.current <= 0) {
        contagem.current = SEGUNDOS_QR;
        gerar();
      }
      setRestante(contagem.current);
    }, 1000);
    return () => { ativo = false; window.clearInterval(id); };
  }, [modo]);

  const executar = async (acao: string, sucesso: string) => {
    setOcupado(true);
    try {
      await chamar(acao, { method: 'POST' });
      toast.success(sucesso);
      await carregar();
    } catch (e: any) {
      toast.error(e.message || 'Não consegui concluir.');
    } finally {
      setOcupado(false);
    }
  };

  const gerarCodigo = async () => {
    setOcupado(true);
    try {
      const r = await chamar<{ pairingCode: string | null }>('wa_parear', { method: 'POST', body: { numero } });
      if (!r.pairingCode) toast.error('A Evolution não devolveu o código. Tente de novo ou use o QR.');
      setCodigo(r.pairingCode);
    } catch (e: any) {
      toast.error(e.message || 'Não consegui gerar o código.');
    } finally {
      setOcupado(false);
    }
  };

  const desconectar = () => {
    if (window.confirm('Desconectar este número do SolidGo? As mensagens param de chegar até conectar de novo.')) {
      executar('wa_desconectar', 'WhatsApp desconectado.');
    }
  };

  if (precisaSenha) {
    return (
      <form onSubmit={entrar} className="p-6 max-w-sm mx-auto space-y-3">
        <h2 className="text-lg font-semibold text-gray-800">Digite a senha do WhatsApp</h2>
        <input
          type="password"
          autoFocus
          autoComplete="off"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className="w-full rounded-lg border px-3 py-2"
        />
        {senhaErrada && <p className="text-sm text-red-700">Senha incorreta.</p>}
        <button disabled={!senha} className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          Entrar
        </button>
      </form>
    );
  }

  if (!dados && !erro) {
    return <div className="p-6 flex items-center gap-2 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> Consultando o WhatsApp…</div>;
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      {erro && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      {dados && !dados.configurado && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
          O WhatsApp ainda não foi configurado na Vercel. Faltam as variáveis EVOLUTION_URL, EVOLUTION_API_KEY,
          EVOLUTION_INSTANCE e WA_WEBHOOK_TOKEN (com pelo menos 32 caracteres).
        </div>
      )}

      {dados?.configurado && (
        <section className="rounded-xl border bg-white p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            {conectado ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 font-semibold text-green-800">
                <CheckCircle2 className="h-5 w-5" /> Conectado
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-full bg-red-100 px-3 py-1 font-semibold text-red-800">
                <WifiOff className="h-5 w-5" /> {dados.estado === 'connecting' ? 'Conectando…' : 'Desconectado'}
              </span>
            )}
            <button onClick={carregar} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg" title="Atualizar">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          {conectado && (
            <dl className="grid sm:grid-cols-3 gap-3 text-sm">
              <div><dt className="text-gray-500">Número</dt><dd className="font-medium">{dados.numero || '-'}</dd></div>
              <div><dt className="text-gray-500">Perfil</dt><dd className="font-medium">{dados.nome_perfil || '-'}</dd></div>
              <div><dt className="text-gray-500">Conectado em</dt><dd className="font-medium">{formatarDataHora(dados.conectado_em)}</dd></div>
            </dl>
          )}

          {dados.recebimento_ativo ? (
            <p className="text-sm text-green-700">As mensagens recebidas estão sendo gravadas no SolidGo.</p>
          ) : (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 space-y-2">
              <p>
                {dados.recebimento_endereco
                  ? `As mensagens estão indo para outro endereço (${dados.recebimento_endereco}).`
                  : 'O recebimento de mensagens ainda não foi ativado.'}
              </p>
              <button
                disabled={ocupado}
                onClick={() => executar('wa_ativar_recebimento', 'Recebimento ativado.')}
                className="rounded-lg bg-yellow-600 px-3 py-1.5 font-medium text-white hover:bg-yellow-700 disabled:opacity-50"
              >
                Receber neste endereço
              </button>
            </div>
          )}

          {!conectado && (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setModo('qr')}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 font-medium ${modo === 'qr' ? 'bg-blue-600 text-white' : 'border text-gray-700 hover:bg-gray-50'}`}
                >
                  <QrCode className="h-5 w-5" /> Conectar com QR Code
                </button>
                <button
                  onClick={() => setModo('codigo')}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 font-medium ${modo === 'codigo' ? 'bg-blue-600 text-white' : 'border text-gray-700 hover:bg-gray-50'}`}
                >
                  <Smartphone className="h-5 w-5" /> Conectar com código
                </button>
              </div>

              {modo && (
                <ol className="list-decimal pl-6 space-y-1 text-lg text-gray-800">
                  <li>Abra o WhatsApp do chip</li>
                  <li>Toque em <b>Aparelhos conectados</b></li>
                  <li>Toque em <b>Conectar aparelho</b></li>
                  {modo === 'qr'
                    ? <li>Aponte a câmera para o QR Code abaixo</li>
                    : <li>Toque em <b>Conectar com número de telefone</b> e digite o código abaixo</li>}
                </ol>
              )}

              {modo === 'qr' && (
                <div className="flex flex-col items-center gap-2">
                  {qr
                    ? <img src={srcDoQr(qr)} alt="QR Code para conectar o WhatsApp" className="h-64 w-64" />
                    : <div className="h-64 w-64 flex items-center justify-center text-gray-400"><Loader2 className="h-8 w-8 animate-spin" /></div>}
                  <p className="text-sm text-gray-500">atualiza em {restante}s</p>
                </div>
              )}

              {modo === 'codigo' && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      value={numero}
                      onChange={(e) => setNumero(e.target.value)}
                      inputMode="tel"
                      placeholder="Número do chip com DDD"
                      className="flex-1 rounded-lg border px-3 py-2"
                    />
                    <button
                      disabled={ocupado || !numero.trim()}
                      onClick={gerarCodigo}
                      className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      Gerar código
                    </button>
                  </div>
                  {codigo && <p className="text-center font-mono text-3xl font-bold tracking-widest">{codigo}</p>}
                </div>
              )}
            </>
          )}

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <button disabled={ocupado} onClick={() => executar('wa_reiniciar', 'Conexão reiniciada.')} className="rounded-lg border px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Reiniciar conexão
            </button>
            {conectado && (
              <button disabled={ocupado} onClick={desconectar} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
                Desconectar
              </button>
            )}
          </div>
        </section>
      )}

      {dados?.configurado && (
        <section className="rounded-xl border bg-white p-5">
          <h2 className="font-semibold text-gray-800 mb-3">Últimas mensagens</h2>
          {!dados.ultimas?.length ? (
            <p className="text-sm text-gray-500">Nenhuma mensagem gravada ainda.</p>
          ) : (
            <ul className="divide-y text-sm">
              {dados.ultimas.map((m) => (
                <li key={m.id} className="py-2">
                  <div className="flex justify-between gap-3 text-xs text-gray-500">
                    <span>
                      {m.direcao === 'in' ? 'Recebida de' : 'Enviada para'} {m.conversa?.nome_contato || m.conversa?.telefone || '-'}
                      {m.conversa?.nome_contato ? ` (${m.conversa.telefone})` : ''}
                    </span>
                    <span>{formatarDataHora(m.enviada_em)}</span>
                  </div>
                  <p className="text-gray-800 break-words">
                    {m.tipo === 'localizacao' && <MapPin className="inline h-4 w-4 mr-1 text-red-600" />}
                    {resumo(m)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
