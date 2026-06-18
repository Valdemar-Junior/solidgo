import fs from 'fs'
import path from 'path'
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

// Load env from .env.local if present (dev) — sanitized later
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

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = req.body || {}

  let url = (process.env.SUPABASE_URL || '').trim().replace(/\s+/g, '').replace(/\.+$/, '').replace(/\/+$/, '')
  let serviceKey = (process.env.SUPABASE_SERVICE_KEY || '').trim().replace(/\s+/g, '')
  if (!url || !serviceKey) return res.status(500).json({ error: 'Server not configured' })

  const supa = createClient(url, serviceKey)

  const domain: string | undefined = body.domain
  const emails: string[] = Array.isArray(body.emails) ? body.emails : []
  const ids: string[] = Array.isArray(body.ids) ? body.ids : []
  const excludeEmails: string[] = Array.isArray(body.exclude_emails) ? body.exclude_emails : []
  const excludeIds: string[] = Array.isArray(body.exclude_ids) ? body.exclude_ids : []
  const keepAdmin: boolean = body.keep_admin !== false // default true

  try {
    // Build candidate list from auth.users
    let candidates: { id: string, email: string }[] = []
    if (domain) {
      const { data } = await supa.from('auth.users' as any).select('id,email').ilike('email', `%@${domain}%`)
      candidates = (data || []).map((u: any) => ({ id: u.id, email: u.email }))
    }
    if (emails.length > 0) {
      const { data } = await supa.from('auth.users' as any).select('id,email').in('email', emails)
      candidates = candidates.concat((data || []).map((u: any) => ({ id: u.id, email: u.email })))
    }
    if (ids.length > 0) {
      const { data } = await supa.from('auth.users' as any).select('id,email').in('id', ids)
      candidates = candidates.concat((data || []).map((u: any) => ({ id: u.id, email: u.email })))
    }

    // De-duplicate
    const map = new Map<string, { id: string, email: string }>()
    candidates.forEach(c => { if (!map.has(c.id)) map.set(c.id, c) })
    let list = Array.from(map.values())

    // Exclusions
    list = list.filter(c => !excludeIds.includes(c.id) && !excludeEmails.includes(c.email))

    // Keep admin users if requested
    if (keepAdmin) {
      const { data: adminIds } = await supa.from('users').select('id').eq('role', 'admin')
      const adminSet = new Set((adminIds || []).map((r: any) => r.id))
      list = list.filter(c => !adminSet.has(c.id))
    }

    // If nothing, return
    if (list.length === 0) return res.status(200).json({ ok: true, deleted: 0 })

    // Perform deletions
    let deleted = 0
    let skipped = 0
    const blockedUsers: Array<{ id: string, email: string, details: Record<string, number> }> = []
    for (const u of list) {
      const links = await getUserRouteLinks(supa, u.id)
      const totalLinks = Object.values(links).reduce((sum, value) => sum + Number(value || 0), 0)
      if (totalLinks > 0) {
        skipped++
        blockedUsers.push({ id: u.id, email: u.email, details: links })
        continue
      }

      const delAuth = await supa.auth.admin.deleteUser(u.id)
      if (delAuth.error) continue
      await supa.from('drivers').delete().eq('user_id', u.id)
      await supa.from('teams_user').delete().or(`driver_user_id.eq.${u.id},helper_user_id.eq.${u.id}`)
      await supa.from('users').delete().eq('id', u.id)
      deleted++
    }

    return res.status(200).json({ ok: true, deleted, skipped, attempted: list.length, blocked_users: blockedUsers })
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Internal error' })
  }
}
