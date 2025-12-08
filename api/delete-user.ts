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

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { userId } = req.body || {}
  if (!userId) return res.status(400).json({ error: 'Missing userId' })

  let url = (process.env.SUPABASE_URL || '').trim().replace(/\s+/g, '').replace(/\.+$/, '').replace(/\/+$/, '')
  let serviceKey = (process.env.SUPABASE_SERVICE_KEY || '').trim().replace(/\s+/g, '')
  if (!url || !serviceKey) return res.status(500).json({ error: 'Server not configured' })

  const supa = createClient(url, serviceKey)

  try {
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

