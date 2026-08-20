import fs from 'fs'
import path from 'path'
// Lightweight loader for .env.local when running vercel dev without dotenv
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
import { requireAdmin } from './_lib/auth.js'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Só admin autenticado pode resetar senha de usuários.
  const caller = await requireAdmin(req, res)
  if (!caller) return

  const { userId, newPassword } = req.body || {}
  if (!userId || !newPassword) return res.status(400).json({ error: 'Missing userId or newPassword' })

  let url = process.env.SUPABASE_URL || ''
  let serviceKey = process.env.SUPABASE_SERVICE_KEY || ''
  // Sanitize environment values to avoid invalid header/URL issues
  url = url.trim().replace(/\s+/g, '').replace(/\.+$/, '').replace(/\/+$/, '')
  serviceKey = serviceKey.trim().replace(/\s+/g, '')
  if (!url || !serviceKey) return res.status(500).json({ error: 'Server not configured' })

  const admin = createClient(url, serviceKey)

  try {
    const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  } catch (e: any) {
    return res.status(500).json({ error: String(e.message || 'Unknown error') })
  }
}
