import { createClient } from '@supabase/supabase-js'
export const config = { runtime: 'nodejs18.x' }

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { routeId, debug, limit = 10 } = req.body || {}
  if (!routeId) return res.status(400).json({ error: 'Missing routeId' })

  const url = (process.env.SUPABASE_URL || '').trim().replace(/\s+/g, '').replace(/\.+$/, '').replace(/\/+$/, '')
  const key = (process.env.SUPABASE_SERVICE_KEY || '').trim().replace(/\s+/g, '')
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })

  const supa = createClient(url, key)
  const ua = (process.env.NOMINATIM_USER_AGENT || 'SOLIDGO/1.0 (contact: support@example.com)').trim()

  try {
    const { data: rows, error } = await supa
      .from('route_orders')
      .select('id, order_id, order:orders!order_id(*)')
      .eq('route_id', routeId)
      .order('sequence', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })

    let updated = 0
    const toProcess = rows.filter((r: any) => {
      const a = typeof r.order?.address_json === 'string' ? JSON.parse(r.order.address_json) : (r.order?.address_json || {})
      return !(typeof a.lat === 'number' && typeof a.lng === 'number')
    }).slice(0, Number(limit) || 10)

    for (const r of toProcess) {
      const o: any = r.order || {}
      const addr = typeof o.address_json === 'string' ? JSON.parse(o.address_json) : (o.address_json || {})
      const raw = o.raw_json || {}
      const enriched = {
        street: addr.street || raw.destinatario_endereco || '',
        number: addr.number || '',
        neighborhood: addr.neighborhood || raw.destinatario_bairro || '',
        city: addr.city || raw.destinatario_cidade || '',
        state: addr.state || '',
        zip: addr.zip || raw.destinatario_cep || '',
      }
      const text = [
        `${enriched.street}${enriched.number ? ', ' + enriched.number : ''}`,
        enriched.neighborhood ? `- ${enriched.neighborhood}` : '',
        `${enriched.city} - ${enriched.state}`,
        enriched.zip ? `${enriched.zip}` : '',
        'Brasil',
      ].filter(Boolean).join(', ').replace(', -', ' -')

      const streetParam = encodeURIComponent(`${enriched.street}${enriched.number ? ' ' + enriched.number : ''}`.trim())
      const cityParam = encodeURIComponent(String(enriched.city || ''))
      const stateParam = encodeURIComponent(String(enriched.state || ''))
      const zipParam = encodeURIComponent(String(enriched.zip || ''))
      const urlStructured = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&country=Brazil&street=${streetParam}&city=${cityParam}&state=${stateParam}&postalcode=${zipParam}`
      let resp = await fetch(urlStructured, { headers: { 'Accept': 'application/json', 'User-Agent': ua } })
      let js: any = await resp.json()
      let first = Array.isArray(js) ? js[0] : null
      let lat = first ? Number(first.lat) : NaN
      let lon = first ? Number(first.lon) : NaN
      let urlReq = urlStructured
      if (isNaN(lat) || isNaN(lon)) {
        const q = encodeURIComponent(text)
        urlReq = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&countrycodes=br&q=${q}`
        resp = await fetch(urlReq, { headers: { 'Accept': 'application/json', 'User-Agent': ua } })
        js = await resp.json()
        first = Array.isArray(js) ? js[0] : null
        lat = first ? Number(first.lat) : NaN
        lon = first ? Number(first.lon) : NaN
      }
      if (debug) console.log('GEOCODE_ROUTE', { routeId, orderId: r.order_id, text, urlReq, result: js })
      if (!isNaN(lat) && !isNaN(lon)) {
        const nextAddr = { ...addr, lat, lng: lon }
        const { error: upError } = await supa.from('orders').update({ address_json: nextAddr }).eq('id', r.order_id)
        if (!upError) updated++
      }
      // Respeitar limites; pequena pausa entre requests
      await new Promise(res2 => setTimeout(res2, 350))
    }

    return res.status(200).json({ ok: true, updated, processed: toProcess.length })
  } catch (e: any) {
    return res.status(500).json({ error: String(e.message || 'Unknown error') })
  }
}
