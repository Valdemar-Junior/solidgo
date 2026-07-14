import { createClient } from '@supabase/supabase-js'
import { requireUser } from './_lib/auth.js'
import { processXmlToHtml } from './_lib/danfe-html.js'

// Logo da DANFE: vem da Configuração de NF (app_settings key 'nf_config'),
// a menos que o chamador mande um logoBase64 explícito. Assim o logo é
// configurável por instalação (facilita replicar pra outra empresa).
async function resolveLogoBase64(bodyLogo: unknown): Promise<string> {
  const explicit = String(bodyLogo || '').trim()
  if (explicit) return explicit
  try {
    const url = (process.env.SUPABASE_URL || '').trim().replace(/\s+/g, '').replace(/\/+$/, '')
    const key = (process.env.SUPABASE_SERVICE_KEY || '').trim().replace(/\s+/g, '')
    if (!url || !key) return ''
    const supa = createClient(url, key)
    const { data } = await supa.from('app_settings').select('value').eq('key', 'nf_config').maybeSingle()
    return String((data?.value as any)?.logoBase64 || '').trim()
  } catch {
    return ''
  }
}

// Gera a DANFE (PDF em base64) a partir do XML da NF-e.
// Fluxo: XML -> HTML (aqui, leve) -> Gotenberg no VPS (PDF, pesado) -> base64.
// Protegido: só usuário autenticado (a importação é feita por admin logado).
// Config: process.env.GOTENBERG_URL (o Gotenberg do seu VPS).
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const caller = await requireUser(req, res)
  if (!caller) return

  const { xml, logoBase64 } = req.body || {}
  if (!xml || typeof xml !== 'string' || !xml.includes('<')) {
    return res.status(400).json({ error: "Campo 'xml' inválido ou ausente" })
  }

  const gotenbergBase = (process.env.GOTENBERG_URL || '').trim().replace(/\/+$/, '')
  if (!gotenbergBase) return res.status(500).json({ error: 'GOTENBERG_URL não configurado no servidor' })
  const gotenbergUrl = gotenbergBase.includes('/convert/')
    ? gotenbergBase
    : `${gotenbergBase}/forms/chromium/convert/html`

  try {
    // Logo: do corpo (se veio) ou da Configuração de NF (app_settings).
    const logo = await resolveLogoBase64(logoBase64)

    // 1) XML -> HTML (parse + template + código de barras) — leve, roda na serverless.
    const { html, meta } = await processXmlToHtml(xml, logo)

    // 2) HTML -> PDF no Gotenberg (VPS). Envia o HTML como arquivo index.html (multipart).
    const form = new FormData()
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html')
    form.append('printBackground', 'true')
    form.append('preferCssPageSize', 'true')

    const g = await fetch(gotenbergUrl, { method: 'POST', body: form })
    if (!g.ok) {
      const detail = await g.text().catch(() => '')
      console.error('[danfe] Gotenberg retornou erro:', g.status, detail.slice(0, 300))
      return res.status(502).json({ error: 'Falha ao gerar PDF (Gotenberg)', status: g.status })
    }

    const pdfBuffer = Buffer.from(await g.arrayBuffer())
    const danfe_base64 = pdfBuffer.toString('base64')

    return res.status(200).json({ danfe_base64, meta })
  } catch (e: any) {
    // Log sem payload (LGPD).
    console.error('[danfe] Erro ao gerar DANFE:', e?.message)
    return res.status(500).json({ error: 'Erro interno ao gerar DANFE' })
  }
}
