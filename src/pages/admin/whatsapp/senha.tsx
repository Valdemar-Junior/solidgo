import { useState } from 'react';
import { chamarAgente } from '../agente/api';

// Senha extra das telas de WhatsApp (conferida no servidor; vale até fechar a aba).
const CHAVE_SENHA = 'wa_tela_senha';

export const guardarSenha = (senha: string) => sessionStorage.setItem(CHAVE_SENHA, senha);
export const esquecerSenha = () => sessionStorage.removeItem(CHAVE_SENHA);
export const ehSenhaPedida = (e: unknown) => e instanceof Error && e.message === 'SENHA_WHATSAPP';

export const chamarWhatsapp = <T = any,>(acao: string, opcoes: { method?: 'GET' | 'POST'; body?: unknown; params?: Record<string, string> } = {}) =>
  chamarAgente<T>(acao, { ...opcoes, headers: { 'x-wa-senha': encodeURIComponent(sessionStorage.getItem(CHAVE_SENHA) || '') } });

export function FormSenha({ aoEntrar }: { aoEntrar: () => void | Promise<void> }) {
  const [senha, setSenha] = useState('');
  const [tentou, setTentou] = useState(false);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    guardarSenha(senha);
    setSenha('');
    setTentou(true); // se a senha servir, o formulário some
    await aoEntrar();
  };

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
      {tentou && <p className="text-sm text-red-700">Senha incorreta.</p>}
      <button disabled={!senha} className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        Entrar
      </button>
    </form>
  );
}
