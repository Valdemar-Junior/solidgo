import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { userId, newPassword } = req.body || {}
  if (!userId || !newPassword) return res.status(400).json({ error: 'Missing userId or newPassword' })

  const url = process.env.SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || ''
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