import { createClient } from '@supabase/supabase-js'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { orderId } = req.body || {}
  if (!orderId) return res.status(400).json({ error: 'Missing orderId' })

  const url = (process.env.SUPABASE_URL || '').trim().replace(/\s+/g, '').replace(/\.+$/, '').replace(/\/+$/, '')
  const key = (process.env.SUPABASE_SERVICE_KEY || '').trim().replace(/\s+/g, '')
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })

  const supa = createClient(url, key)

  try {
    const { data: order, error: loadError } = await supa
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single()
    if (loadError || !order) return res.status(404).json({ error: 'Order not found' })

    const addr = typeof order.address_json === 'string' ? JSON.parse(order.address_json) : (order.address_json || {})
    const raw = order.raw_json || {}
    const enriched = {
      street: addr.street || raw.destinatario_endereco || '',
      number: addr.number || '',
      neighborhood: addr.neighborhood || raw.destinatario_bairro || '',
      city: addr.city || raw.destinatario_cidade || '',
      state: addr.state || '',
      zip: addr.zip || raw.destinatario_cep || '',
    }

    const q = encodeURIComponent([
      `${enriched.street}${enriched.number ? ', ' + enriched.number : ''}`,
      enriched.neighborhood ? `- ${enriched.neighborhood}` : '',
      `${enriched.city} - ${enriched.state}`,
      enriched.zip ? `${enriched.zip}` : '',
      'Brasil',
    ].filter(Boolean).join(', ').replace(', -', ' -'))

    const ua = (process.env.NOMINATIM_USER_AGENT || 'SOLIDGO/1.0 (contact: support@example.com)').trim()
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&countrycodes=br&q=${q}`, {
      headers: { 'Accept': 'application/json', 'User-Agent': ua },
    })
    const js: any = await resp.json()
    const first = Array.isArray(js) ? js[0] : null
    const lat = first ? Number(first.lat) : NaN
    const lon = first ? Number(first.lon) : NaN
    if (isNaN(lat) || isNaN(lon)) return res.status(200).json({ ok: false })

    const nextAddr = { ...addr, lat, lng: lon }
    const { error: upError } = await supa.from('orders').update({ address_json: nextAddr }).eq('id', orderId)
    if (upError) return res.status(500).json({ error: upError.message })

    return res.status(200).json({ ok: true, lat, lng: lon })
  } catch (e: any) {
    return res.status(500).json({ error: String(e.message || 'Unknown error') })
  }
}

