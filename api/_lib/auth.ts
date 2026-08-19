import { createClient } from '@supabase/supabase-js'

// Porteiro compartilhado das funcoes serverless (Vercel).
// Estas funcoes usam a SERVICE_KEY (poder total, ignora RLS), entao PRECISAM
// validar quem esta chamando antes de agir. Sem isto, qualquer um na internet
// que souber a URL executa a operacao.

function getEnv() {
  const url = (process.env.SUPABASE_URL || '')
    .trim().replace(/\s+/g, '').replace(/\.+$/, '').replace(/\/+$/, '')
  const serviceKey = (process.env.SUPABASE_SERVICE_KEY || '').trim().replace(/\s+/g, '')
  return { url, serviceKey }
}

function getBearerToken(req: any): string {
  const header = req?.headers?.authorization || req?.headers?.Authorization || ''
  return typeof header === 'string' ? header.replace(/^Bearer\s+/i, '').trim() : ''
}

/**
 * Exige um usuario AUTENTICADO. Em caso de falha, ja responde (401/500) e
 * retorna null - o chamador deve fazer `if (!x) return`.
 */
export async function requireUser(req: any, res: any): Promise<{ id: string } | null> {
  const { url, serviceKey } = getEnv()
  if (!url || !serviceKey) {
    res.status(500).json({ error: 'Server not configured' })
    return null
  }
  const token = getBearerToken(req)
  if (!token) {
    res.status(401).json({ error: 'Nao autenticado' })
    return null
  }
  const admin = createClient(url, serviceKey)
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) {
    res.status(401).json({ error: 'Sessao invalida ou expirada' })
    return null
  }
  return { id: data.user.id }
}

/**
 * Exige um usuario autenticado E com papel 'admin'. Em caso de falha, ja
 * responde (401/403/500) e retorna null.
 */
export async function requireAdmin(req: any, res: any): Promise<{ id: string } | null> {
  const authed = await requireUser(req, res)
  if (!authed) return null

  const { url, serviceKey } = getEnv()
  const admin = createClient(url, serviceKey)
  const { data, error } = await admin.from('users').select('role').eq('id', authed.id).single()
  if (error || data?.role !== 'admin') {
    res.status(403).json({ error: 'Acesso restrito a administradores' })
    return null
  }
  return authed
}
