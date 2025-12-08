import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

// Load env from .env.local if present (dev)
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
  const tokenHeader = req.headers['x-admin-setup-token'] || req.headers['X-Admin-Setup-Token']
  const setupToken = (process.env.SETUP_TOKEN || '').trim()
  if (!setupToken || String(tokenHeader || '').trim() !== setupToken) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { email, password, name } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'Missing email or password' })

  let url = (process.env.SUPABASE_URL || '').trim().replace(/\s+/g, '').replace(/\.+$/, '').replace(/\/+$/, '')
  let serviceKey = (process.env.SUPABASE_SERVICE_KEY || '').trim().replace(/\s+/g, '')
  if (!url || !serviceKey) return res.status(500).json({ error: 'Server not configured' })

  const supa = createClient(url, serviceKey)

  try {
    // Create auth user
    const { data: created, error: createErr } = await (supa as any).auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createErr) return res.status(500).json({ error: createErr.message || 'Failed to create admin user' })
    const userId = created?.user?.id
    if (!userId) return res.status(500).json({ error: 'User id missing after creation' })

    // Upsert public.users
    const upsertPayload = {
      id: userId,
      email,
      name: name || email,
      role: 'admin',
      must_change_password: true,
    }
    const { error: upErr } = await supa.from('users').upsert(upsertPayload, { onConflict: 'id' })
    if (upErr) return res.status(500).json({ error: upErr.message || 'Failed to upsert profile' })

    return res.status(200).json({ ok: true, id: userId })
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Internal error' })
  }
}

