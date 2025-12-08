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
          // Se não tiver rua, tenta pegar do viacep
          if (!enriched.street && vj.logradouro) enriched.street = vj.logradouro
          if (!enriched.neighborhood && vj.bairro) enriched.neighborhood = vj.bairro
        }
      }
    } catch {}

    const ua = (process.env.NOMINATIM_USER_AGENT || 'SOLIDGO/1.0 (contact: support@example.com)').trim()
    
    // Helper para buscar
    const fetchNominatim = async (params: string) => {
      try {
        const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&countrycodes=br&${params}`
        const r = await fetch(u, { headers: { 'Accept': 'application/json', 'User-Agent': ua } })
        if (!r.ok) return null
        const j = await r.json()
        if (Array.isArray(j) && j.length > 0) return j[0]
        return null
      } catch { return null }
    }

    let lat = NaN
    let lon = NaN
    let result: any = null
    let usedMethod = ''

    // Limpeza basica
    const cleanStreet = (enriched.street || '').replace(/[^\w\s\.,-]/g, ' ').trim()
    const streetHasNumber = /\d+/.test(cleanStreet)
    const streetParam = encodeURIComponent(cleanStreet)
    const cityParam = encodeURIComponent(String(enriched.city || ''))
    const stateParam = encodeURIComponent(String(enriched.state || ''))
    const zipParam = encodeURIComponent(String(enriched.zip || ''))

    // 1. Structured Search (completo)
    if (!result) {
      // Se a rua já tem numero, nominatim as vezes prefere que passe junto no street, as vezes não.
      // Vamos tentar passar como está.
      const q = `street=${streetParam}&city=${cityParam}&state=${stateParam}&postalcode=${zipParam}`
      result = await fetchNominatim(q)
      if (result) usedMethod = 'structured_full'
    }

    // 2. Freeform Search (q=)
    if (!result) {
      const text = [
        `${enriched.street}${enriched.number ? ', ' + enriched.number : ''}`,
        enriched.neighborhood ? `- ${enriched.neighborhood}` : '',
        `${enriched.city}${enriched.state ? ' - ' + enriched.state : ''}`,
        enriched.zip ? `${enriched.zip}` : '',
        'Brasil',
      ].filter(Boolean).join(', ').replace(', -', ' -')
      result = await fetchNominatim(`q=${encodeURIComponent(text)}`)
      if (result) usedMethod = 'freeform_full'
    }

    // 3. Structured Search SEM CEP (Muitas vezes o CEP no OSM está desatualizado ou ausente)
    if (!result && enriched.street && enriched.city) {
      const q = `street=${streetParam}&city=${cityParam}&state=${stateParam}`
      result = await fetchNominatim(q)
      if (result) usedMethod = 'structured_no_zip'
    }

    // 4. Freeform Search SEM CEP
    if (!result) {
      const text = [
        `${enriched.street}${enriched.number ? ', ' + enriched.number : ''}`,
        enriched.neighborhood ? `- ${enriched.neighborhood}` : '',
        `${enriched.city}${enriched.state ? ' - ' + enriched.state : ''}`,
        'Brasil',
      ].filter(Boolean).join(', ').replace(', -', ' -')
      result = await fetchNominatim(`q=${encodeURIComponent(text)}`)
      if (result) usedMethod = 'freeform_no_zip'
    }

    // 5. Tentar apenas Rua e Cidade (sem numero, sem bairro) - Fallback "centro da rua"
    if (!result && enriched.street && enriched.city) {
        // Tenta limpar o numero da rua se estiver nela
        const streetOnly = cleanStreet.replace(/,?\s*\d+.*$/, '')
        const q = `street=${encodeURIComponent(streetOnly)}&city=${cityParam}&state=${stateParam}`
        result = await fetchNominatim(q)
        if (result) usedMethod = 'street_city_fallback'
    }

    if (result) {
      lat = Number(result.lat)
      lon = Number(result.lon)
    }

    if (debug) {
      console.log('GEOCODE_ORDER', { orderId, usedMethod, result })
    }

    if (isNaN(lat) || isNaN(lon)) {
        return res.status(200).json({ ok: false, message: 'Geocoding failed for all strategies' })
    }

    const nextAddr = { ...addr, lat, lng: lon }
    const { error: upError } = await supa.from('orders').update({ address_json: nextAddr }).eq('id', orderId)
    if (upError) return res.status(500).json({ error: upError.message })
    
    return res.status(200).json({ ok: true, lat, lng: lon, method: usedMethod })
  } catch (e: any) {
    return res.status(500).json({ error: String(e.message || 'Unknown error') })
  }
}
