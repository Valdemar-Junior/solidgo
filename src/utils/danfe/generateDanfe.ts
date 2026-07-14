import { supabase } from '../../supabase/client';

// Gera a DANFE (PDF em base64) de um XML NF-e chamando o endpoint /api/danfe.
// Serve pra QUALQUER XML — nota de venda OU de devolução (o endpoint é o mesmo).
// Retorna '' se não gerar. O chamador decide onde salvar (danfe_base64 x return_danfe_base64).
export async function generateDanfeBase64(xml: string): Promise<string> {
  const clean = String(xml || '').trim();
  if (!clean.includes('<')) return '';
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || '';
    const resp = await fetch('/api/danfe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ xml: clean }),
    });
    if (!resp.ok) return '';
    const data = await resp.json().catch(() => null);
    return String(data?.danfe_base64 || '');
  } catch {
    return '';
  }
}
