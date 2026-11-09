import supabase from '../../../supabase/client';

// Chamadas das telas do Agente IA para /api/agente?canal=admin (só admin logado).
export async function chamarAgente<T = any>(acao: string, opcoes: { method?: 'GET' | 'POST'; body?: unknown; params?: Record<string, string>; headers?: Record<string, string> } = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const qs = new URLSearchParams({ canal: 'admin', acao, ...(opcoes.params || {}) });
  const resp = await fetch(`/api/agente?${qs.toString()}`, {
    method: opcoes.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || ''}`,
      ...(opcoes.headers || {}),
    },
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok && !(json && typeof json === 'object' && 'ok' in json)) {
    throw new Error(json?.error || `Erro ${resp.status}`);
  }
  return json as T;
}

export const STATUS_APROVACAO: Record<string, { rotulo: string; cor: string }> = {
  pendente: { rotulo: 'Aguardando aprovação', cor: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  aprovada: { rotulo: 'Aprovada', cor: 'bg-green-50 text-green-700 border-green-200' },
  recusada: { rotulo: 'Recusada', cor: 'bg-gray-100 text-gray-600 border-gray-200' },
  expirada: { rotulo: 'Expirada', cor: 'bg-gray-100 text-gray-500 border-gray-200' },
  erro: { rotulo: 'Erro', cor: 'bg-red-50 text-red-700 border-red-200' },
};

export const formatarDataHora = (v?: string | null) =>
  v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
