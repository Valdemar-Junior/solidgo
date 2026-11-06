import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Bot, Copy, History, KeyRound, Loader2, Power, ShieldCheck, Truck } from 'lucide-react';
import { chamarAgente, formatarDataHora, STATUS_APROVACAO } from './api';

type Config = {
  ativo: boolean;
  permite_criar_rota: boolean;
  token_gerado_no_solidgo: boolean;
  token_criado_em: string | null;
  token_da_vercel_configurado: boolean;
  endereco_mcp: string;
};
type Historico = {
  aprovacoes: { id: string; status: string; tipo: string; criado_em: string; route_code: string | null; rota: string | null; pedidos: number; erro: string | null }[];
  auditoria: { id: number; criado_em: string; origem: string; acao: string; ok: boolean; erro: string | null }[];
};

const NOMES_ACAO: Record<string, string> = {
  preparar_rota: 'Agente preparou rota',
  aprovar_rota: 'Admin aprovou rota',
  recusar_rota: 'Admin recusou rota',
  alterar_config: 'Configuração alterada',
  gerar_token: 'Novo token gerado',
};

// Configurações do Agente IA (Hermes via MCP): liga/desliga, permissão de criar rota,
// troca de token e histórico. Só admin.
export default function Agente() {
  const [config, setConfig] = useState<Config | null>(null);
  const [hist, setHist] = useState<Historico | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [tokenNovo, setTokenNovo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [c, h] = await Promise.all([chamarAgente<Config>('config'), chamarAgente<Historico>('historico')]);
      setConfig(c); setHist(h); setErro(null);
    } catch (e: any) {
      setErro(e.message || 'Erro ao carregar');
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const alterar = async (mudanca: Partial<Pick<Config, 'ativo' | 'permite_criar_rota'>>) => {
    setSalvando(true);
    try {
      await chamarAgente('config', { method: 'POST', body: mudanca });
      toast.success('Salvo');
      await carregar();
    } catch (e: any) { toast.error(e.message); } finally { setSalvando(false); }
  };

  const gerarToken = async () => {
    const msg = config?.token_gerado_no_solidgo || config?.token_da_vercel_configurado
      ? 'Gerar um token novo? O token atual para de funcionar NA HORA e o Hermes só volta a acessar depois que você colar o novo no config.yaml dele.'
      : 'Gerar o token do agente?';
    if (!window.confirm(msg)) return;
    setSalvando(true);
    try {
      const r = await chamarAgente<{ token: string }>('gerar_token', { method: 'POST' });
      setTokenNovo(r.token);
      await carregar();
    } catch (e: any) { toast.error(e.message); } finally { setSalvando(false); }
  };

  const copiar = (t: string) => navigator.clipboard.writeText(t).then(() => toast.success('Copiado'));

  if (erro) return <div className="max-w-4xl mx-auto px-4 py-10"><div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-6">{erro}</div></div>;
  if (!config || !hist) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>;

  const pendentes = hist.aprovacoes.filter((a) => a.status === 'pendente');
  const yaml = tokenNovo
    ? `mcp_servers:\n  solidgo:\n    url: "${config.endereco_mcp}"\n    headers:\n      Authorization: "Bearer ${tokenNovo}"\n    timeout: 60\n    tools:\n      prompts: false\n      resources: false`
    : '';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6 pb-24">
      <div className="flex items-center gap-2">
        <Bot className="h-6 w-6 text-blue-600" />
        <h1 className="text-xl font-bold text-gray-900">Agente IA (Hermes)</h1>
      </div>

      {pendentes.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 space-y-2">
          <div className="font-semibold text-yellow-900 text-sm">{pendentes.length} rota(s) esperando sua aprovação</div>
          {pendentes.map((a) => (
            <Link key={a.id} to={`/admin/agente/aprovar/${a.id}`} className="flex items-center gap-2 text-sm text-blue-700 hover:underline">
              <Truck className="h-4 w-4" /> {a.rota || 'Rota'} · {a.pedidos} pedido(s) · {formatarDataHora(a.criado_em)}
            </Link>
          ))}
        </div>
      )}

      <Cartao icone={<Power className="h-5 w-5 text-blue-600" />} titulo="Funcionamento">
        <Chave
          ligado={config.ativo}
          disabled={salvando}
          onChange={(v) => alterar({ ativo: v })}
          titulo="Agente ligado"
          texto="Desligado, o SolidGo recusa qualquer pedido do Hermes na hora (botão de emergência)."
        />
        <Chave
          ligado={config.permite_criar_rota}
          disabled={salvando || !config.ativo}
          onChange={(v) => alterar({ permite_criar_rota: v })}
          titulo="Pode preparar rotas"
          texto="O agente monta a prévia da rota e manda o link. A rota só é criada quando um admin clica em Confirmar."
        />
      </Cartao>

      <Cartao icone={<KeyRound className="h-5 w-5 text-blue-600" />} titulo="Token de acesso (crachá do Hermes)">
        <div className="text-sm text-gray-600 space-y-1">
          <div>Endereço do MCP: <code className="bg-gray-100 px-1.5 py-0.5 rounded">{config.endereco_mcp}</code></div>
          <div>
            Token atual:{' '}
            {config.token_gerado_no_solidgo
              ? <>gerado aqui em {formatarDataHora(config.token_criado_em)}</>
              : config.token_da_vercel_configurado ? <>o da Vercel (variável MCP_TOKEN)</> : <span className="text-red-600">nenhum — o Hermes não consegue entrar</span>}
          </div>
        </div>
        <button
          onClick={gerarToken}
          disabled={salvando}
          className="mt-3 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          Gerar novo token
        </button>

        {tokenNovo && (
          <div className="mt-4 border border-green-200 bg-green-50 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-green-800">
              <ShieldCheck className="h-4 w-4" /> Token gerado. Ele aparece SÓ AGORA: copie antes de sair desta tela.
            </div>
            <p className="text-sm text-gray-700">
              Cole este bloco no <code>~/.hermes/config.yaml</code> da VPS (no lugar do bloco <code>solidgo</code> antigo).
              Faça isso pelo terminal da VPS, não pelo chat do Hermes, para o token não ficar no histórico de mensagens.
            </p>
            <pre className="bg-white border border-gray-200 rounded-lg p-3 text-xs overflow-x-auto">{yaml}</pre>
            <button onClick={() => copiar(yaml)} className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm flex items-center gap-1.5 hover:bg-gray-50">
              <Copy className="h-4 w-4" /> Copiar bloco
            </button>
          </div>
        )}
      </Cartao>

      <Cartao icone={<History className="h-5 w-5 text-blue-600" />} titulo="Rotas preparadas pelo agente">
        {hist.aprovacoes.length === 0 ? <p className="text-sm text-gray-500">Nenhuma ainda.</p> : (
          <ul className="divide-y divide-gray-100 -mx-6">
            {hist.aprovacoes.map((a) => {
              const st = STATUS_APROVACAO[a.status] || STATUS_APROVACAO.erro;
              return (
                <li key={a.id}>
                  <Link to={`/admin/agente/aprovar/${a.id}`} className="px-6 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm hover:bg-gray-50">
                    <span className="text-gray-400 w-24">{formatarDataHora(a.criado_em)}</span>
                    <span className="font-medium text-gray-900">{a.rota || '—'}</span>
                    <span className="text-gray-500">{a.pedidos} pedido(s)</span>
                    {a.route_code && <span className="text-gray-700">{a.route_code}</span>}
                    <span className={`ml-auto px-2 py-0.5 rounded-full text-xs border ${st.cor}`}>{st.rotulo}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Cartao>

      <Cartao icone={<History className="h-5 w-5 text-gray-500" />} titulo="Histórico de ações">
        {hist.auditoria.length === 0 ? <p className="text-sm text-gray-500">Nada registrado ainda.</p> : (
          <ul className="divide-y divide-gray-100 -mx-6 text-sm">
            {hist.auditoria.map((l) => (
              <li key={l.id} className="px-6 py-2 flex flex-wrap gap-x-3">
                <span className="text-gray-400 w-24">{formatarDataHora(l.criado_em)}</span>
                <span className={l.ok ? 'text-gray-800' : 'text-red-700'}>{NOMES_ACAO[l.acao] || l.acao}{l.ok ? '' : ' (falhou)'}</span>
                {l.erro && <span className="text-red-600 text-xs">{l.erro}</span>}
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </div>
  );
}

function Cartao({ icone, titulo, children }: { icone: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="border-b border-gray-100 bg-gray-50 px-6 py-4 flex items-center gap-2">
        {icone}<h2 className="font-bold text-gray-900">{titulo}</h2>
      </div>
      <div className="p-6 space-y-4">{children}</div>
    </div>
  );
}

function Chave({ ligado, disabled, onChange, titulo, texto }: { ligado: boolean; disabled?: boolean; onChange: (v: boolean) => void; titulo: string; texto: string }) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        disabled={disabled}
        onClick={() => onChange(!ligado)}
        className={`mt-0.5 relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${ligado ? 'bg-blue-600' : 'bg-gray-300'}`}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ${ligado ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
      <span>
        <span className="block text-sm font-medium text-gray-900">{titulo}</span>
        <span className="block text-sm text-gray-500">{texto}</span>
      </span>
    </label>
  );
}
