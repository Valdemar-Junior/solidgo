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

    // Se tiver LOCATIONIQ_KEY, usa LocationIQ. Senão, tenta Nominatim (mas vamos recomendar LocationIQ)
    const liqKey = process.env.LOCATIONIQ_KEY
    
    let lat = NaN
    let lon = NaN
    let result: any = null
    let usedMethod = ''

    // Limpeza basica
    const cleanStreet = (enriched.street || '').replace(/[^\w\s\.,-]/g, ' ').trim()
    let streetForStruct = cleanStreet
    let numberForStruct = enriched.number
    if (!numberForStruct) {
      const match = cleanStreet.match(/^(.*?)[,\s]+(\d+[a-zA-Z]?)$/)
      if (match) {
        streetForStruct = match[1].trim()
        numberForStruct = match[2].trim()
      }
    }

    if (liqKey) {
        // --- LOCATIONIQ LOGIC ---
        // LocationIQ é muito melhor em freeform search
        const fetchLocationIQ = async (q: string) => {
            try {
                // Rate limit do LocationIQ free é 2 req/s. 
                // Vamos ser seguros e colocar um pequeno delay aleatorio se for loop rapido, 
                // mas aqui é serverless function, entao ok.
                const u = `https://us1.locationiq.com/v1/search?key=${liqKey}&q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1&countrycodes=br`
                const r = await fetch(u)
                if (!r.ok) return null
                const j = await r.json()
                if (Array.isArray(j) && j.length > 0) return j[0]
                return null
            } catch { return null }
        }

        // 1. Busca completa
        const fullText = [
            `${enriched.street} ${enriched.number || numberForStruct || ''}`,
            enriched.neighborhood,
            enriched.city,
            enriched.state,
            enriched.zip,
            'Brasil'
        ].filter(Boolean).join(', ')
        
        result = await fetchLocationIQ(fullText)
        if (result) usedMethod = 'locationiq_full'

        // 2. Busca sem CEP (se falhar)
        if (!result) {
             const textNoZip = [
                `${enriched.street} ${enriched.number || numberForStruct || ''}`,
                enriched.neighborhood,
                enriched.city,
                enriched.state,
                'Brasil'
            ].filter(Boolean).join(', ')
            result = await fetchLocationIQ(textNoZip)
            if (result) usedMethod = 'locationiq_no_zip'
        }
        
        // 3. Busca só Rua e Cidade
        if (!result) {
            const textSimple = [
                `${streetForStruct}`,
                enriched.city,
                enriched.state,
                'Brasil'
            ].filter(Boolean).join(', ')
            result = await fetchLocationIQ(textSimple)
            if (result) usedMethod = 'locationiq_simple'
        }

    } else {
        // --- FALLBACK NOMINATIM (CÓDIGO ANTIGO) ---
        // (Mantido apenas como fallback se a chave não for configurada)
        const ua = (process.env.NOMINATIM_USER_AGENT || 'SOLIDGO/1.0 (contact: support@example.com)').trim()
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
        
        // ... (Lógica do nominatim simplificada para não poluir, focando na migração)
        // Se cair aqui, vai usar a lógica freeform básica
        const text = [
            `${enriched.street}${enriched.number ? ', ' + enriched.number : ''}`,
            enriched.neighborhood ? `- ${enriched.neighborhood}` : '',
            `${enriched.city}${enriched.state ? ' - ' + enriched.state : ''}`,
            'Brasil',
        ].filter(Boolean).join(', ').replace(', -', ' -')
        result = await fetchNominatim(`q=${encodeURIComponent(text)}`)
        if (result) usedMethod = 'nominatim_fallback'
    }

    if (result) {
      lat = Number(result.lat)
      lon = Number(result.lon)
    }

    if (debug) {
      console.log('GEOCODE_ORDER', { orderId, usedMethod, result, provider: liqKey ? 'LocationIQ' : 'Nominatim' })
    }

    if (isNaN(lat) || isNaN(lon)) {
        return res.status(200).json({ ok: false, message: 'Geocoding failed' })
    }

    const nextAddr = { ...addr, lat, lng: lon }
    const { error: upError } = await supa.from('orders').update({ address_json: nextAddr }).eq('id', orderId)
    if (upError) return res.status(500).json({ error: upError.message })
    
    return res.status(200).json({ ok: true, lat, lng: lon, method: usedMethod })
  } catch (e: any) {
    return res.status(500).json({ error: String(e.message || 'Unknown error') })
  }
}
