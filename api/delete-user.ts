import fs from 'fs'
import path from 'path'
try {
  const p = path.resolve(process.cwd(), '.env.local')
  if (fs.existsSync(p)) {
    const content = fs.readFileSync(p, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
      if (m) {
        const key = m[1]
        const val = m[2]
        if (!process.env[key]) process.env[key] = val
      }
    }
  }
} catch {}
import { createClient } from '@supabase/supabase-js'

async function getUserRouteLinks(supa: any, userId: string) {
  const { data: driverRows, error: driverError } = await supa
    .from('drivers')
    .select('id')
    .eq('user_id', userId)

  if (driverError) throw driverError

  const driverIds = (driverRows || []).map((row: any) => row.id).filter(Boolean)

  const [
    driverRoutesRes,
    helperRoutesRes,
    conferenteRoutesRes,
    assemblyRoutesRes,
    routeConferencesRes,
    assemblyProductsRes,
  ] = await Promise.all([
    driverIds.length > 0
      ? supa.from('routes').select('id', { count: 'exact', head: true }).in('driver_id', driverIds)
      : Promise.resolve({ count: 0, error: null }),
    supa.from('routes').select('id', { count: 'exact', head: true }).eq('helper_id', userId),
    supa.from('routes').select('id', { count: 'exact', head: true }).eq('conferente_id', userId),
    supa.from('assembly_routes').select('id', { count: 'exact', head: true }).eq('assembler_id', userId),
    supa.from('route_conferences').select('id', { count: 'exact', head: true }).or(`user_id.eq.${userId},resolved_by.eq.${userId}`),
    supa.from('assembly_products').select('id', { count: 'exact', head: true }).eq('installer_id', userId),
  ])

  const results = [
    driverRoutesRes,
    helperRoutesRes,
    conferenteRoutesRes,
    assemblyRoutesRes,
    routeConferencesRes,
    assemblyProductsRes,
  ]

  const firstError = results.find((result: any) => result?.error)?.error
  if (firstError) throw firstError

  return {
    driverRoutes: Number(driverRoutesRes.count || 0),
    helperRoutes: Number(helperRoutesRes.count || 0),
    conferenteRoutes: Number(conferenteRoutesRes.count || 0),
    assemblyRoutes: Number(assemblyRoutesRes.count || 0),
    routeConferences: Number(routeConferencesRes.count || 0),
    assemblyProducts: Number(assemblyProductsRes.count || 0),
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { userId } = req.body || {}
  if (!userId) return res.status(400).json({ error: 'Missing userId' })

  let url = (process.env.SUPABASE_URL || '').trim().replace(/\s+/g, '').replace(/\.+$/, '').replace(/\/+$/, '')
  let serviceKey = (process.env.SUPABASE_SERVICE_KEY || '').trim().replace(/\s+/g, '')
  if (!url || !serviceKey) return res.status(500).json({ error: 'Server not configured' })

  const supa = createClient(url, serviceKey)

  try {
    const links = await getUserRouteLinks(supa, userId)
    const totalLinks = Object.values(links).reduce((sum, value) => sum + Number(value || 0), 0)

    if (totalLinks > 0) {
      return res.status(409).json({
        error: 'Usuário possui vínculos operacionais e não pode ser excluído.',
        details: links,
      })
    }

    const delAuth = await supa.auth.admin.deleteUser(userId)
    if (delAuth.error) return res.status(500).json({ error: delAuth.error.message || 'Failed to delete auth user' })

    await supa.from('drivers').delete().eq('user_id', userId)
    await supa.from('teams_user').delete().or(`driver_user_id.eq.${userId},helper_user_id.eq.${userId}`)
    await supa.from('users').delete().eq('id', userId)

    return res.status(200).json({ ok: true })
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Internal error' })
  }
}
