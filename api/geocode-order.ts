import { createClient } from '@supabase/supabase-js'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { orderId, debug } = req.body || {}
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
    const enriched: any = {
      street: addr.street || raw.destinatario_endereco || '',
      number: addr.number || '',
      neighborhood: addr.neighborhood || raw.destinatario_bairro || '',
      city: addr.city || raw.destinatario_cidade || '',
      state: addr.state || '',
      zip: addr.zip || raw.destinatario_cep || '',
    }

    // Enriquecer UF/cidade via ViaCEP se faltando
    try {
      const cepDigits = String(enriched.zip || '').replace(/\D/g, '').slice(0, 8)
      if ((!enriched.state || !enriched.city) && cepDigits.length === 8) {
        const via = await fetch(`https://viacep.com.br/ws/${cepDigits}/json/`, { headers: { 'Accept': 'application/json' } })
        const vj: any = await via.json()
        if (!vj?.erro) {
          enriched.state = enriched.state || String(vj.uf || '')
          enriched.city = enriched.city || String(vj.localidade || '')
        }
      }
    } catch {}

    const text = [
      `${enriched.street}${enriched.number ? ', ' + enriched.number : ''}`,
      enriched.neighborhood ? `- ${enriched.neighborhood}` : '',
      `${enriched.city}${enriched.state ? ' - ' + enriched.state : ''}`,
      enriched.zip ? `${enriched.zip}` : '',
      'Brasil',
    ].filter(Boolean).join(', ').replace(', -', ' -')
    const q = encodeURIComponent(text)

    const ua = (process.env.NOMINATIM_USER_AGENT || 'SOLIDGO/1.0 (contact: support@example.com)').trim()
    // Tentativa 1: consulta estruturada (street/city/state/postalcode)
    const streetParam = encodeURIComponent(`${enriched.street}${enriched.number ? ' ' + enriched.number : ''}`.trim())
    const cityParam = encodeURIComponent(String(enriched.city || ''))
    const stateParam = encodeURIComponent(String(enriched.state || ''))
    const zipParam = encodeURIComponent(String(enriched.zip || ''))
    const urlStructured = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&country=Brazil&street=${streetParam}&city=${cityParam}&state=${stateParam}&postalcode=${zipParam}`
    let resp = await fetch(urlStructured, {
      headers: { 'Accept': 'application/json', 'User-Agent': ua },
    })
    let js: any = await resp.json()
    let first = Array.isArray(js) ? js[0] : null
    let lat = first ? Number(first.lat) : NaN
    let lon = first ? Number(first.lon) : NaN
    // Tentativa 2: fallback por texto livre (q=)
    let urlReq = urlStructured
    if (isNaN(lat) || isNaN(lon)) {
      urlReq = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&countrycodes=br&q=${q}`
      resp = await fetch(urlReq, { headers: { 'Accept': 'application/json', 'User-Agent': ua } })
      js = await resp.json()
      first = Array.isArray(js) ? js[0] : null
      lat = first ? Number(first.lat) : NaN
      lon = first ? Number(first.lon) : NaN
    }
    if (debug) {
      console.log('GEOCODE_ORDER', { orderId, text, urlStructured, urlReq, result: js })
    }
    if (isNaN(lat) || isNaN(lon)) return res.status(200).json({ ok: false, text, urlReq })

    const nextAddr = { ...addr, lat, lng: lon }
    const { error: upError } = await supa.from('orders').update({ address_json: nextAddr }).eq('id', orderId)
    if (upError) return res.status(500).json({ error: upError.message })
    return res.status(200).json({ ok: true, lat, lng: lon, text, urlReq })
  } catch (e: any) {
    return res.status(500).json({ error: String(e.message || 'Unknown error') })
  }
}
