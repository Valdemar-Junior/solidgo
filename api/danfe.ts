import { createClient } from '@supabase/supabase-js'
import { requireUser } from './_lib/auth.js'

// Gera a DANFE (PDF em base64) a partir do XML da NF-e.
//
// Fluxo: navegador -> este endpoint (exige login) -> API DanfeHub -> PDF base64.
// O endpoint e um repassador fino: quem desenha a DANFE e o DanfeHub (XML -> HTML
// -> Gotenberg). Aqui so entram a autenticacao, a logo e a chave da API - que
// NUNCA pode ir para o navegador, pois o front e publico.
//
// Config (variaveis de ambiente na Vercel):
//   DANFE_API_KEY  - chave do cliente, criada na aba Clientes do DanfeHub (obrigatoria)
//   DANFE_API_URL  - URL base do DanfeHub (opcional; ja vem com o padrao abaixo)
//   SUPABASE_URL / SUPABASE_SERVICE_KEY - ja usados pelos outros endpoints

const DEFAULT_DANFE_API_URL = 'https://danfehub.lojaodosmoveis.shop'

// O DanfeHub espera o Gotenberg responder; se ele engasgar, a chamada fica
// pendurada e a funcao da Vercel morre por tempo esgotado sem explicar nada.
// Com prazo proprio, a resposta e um erro claro.
const TIMEOUT_MS = 30_000

// Logo da DANFE: vem da Configuracao de NF (app_settings key 'nf_config'),
// a menos que o chamador mande um logoBase64 explicito. Assim a logo e
// configuravel pela tela (Configuracoes -> Geral), sem mexer em codigo.
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

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const caller = await requireUser(req, res)
  if (!caller) return

  const { xml, logoBase64 } = req.body || {}
  if (!xml || typeof xml !== 'string' || !xml.includes('<')) {
    return res.status(400).json({ error: "Campo 'xml' invalido ou ausente" })
  }

  const apiKey = (process.env.DANFE_API_KEY || '').trim()
  if (!apiKey) {
    console.error('[danfe] DANFE_API_KEY nao configurada na Vercel')
    return res.status(500).json({ error: 'DANFE_API_KEY nao configurada no servidor' })
  }

  const base = (process.env.DANFE_API_URL || DEFAULT_DANFE_API_URL).trim().replace(/\/+$/, '')
  const url = base.endsWith('/danfe/pdf') ? base : `${base}/danfe/pdf`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    // Logo: do corpo (se veio) ou da Configuracao de NF (app_settings).
    // A logo enviada aqui tem prioridade sobre a cadastrada no painel do DanfeHub.
    const logo = await resolveLogoBase64(logoBase64)

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(logo ? { xml, logoBase64: logo } : { xml }),
      signal: controller.signal,
    })

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      console.error('[danfe] DanfeHub retornou erro:', resp.status, detail.slice(0, 300))
      // 400 e problema do XML enviado; 401 e chave errada (culpa da configuracao,
      // nao de quem clicou); o resto e o servico de PDF fora do ar.
      if (resp.status === 400) return res.status(400).json({ error: 'XML da nota fora do padrao esperado' })
      if (resp.status === 401 || resp.status === 403) {
        return res.status(500).json({ error: 'Chave da API de DANFE invalida ou desativada' })
      }
      return res.status(502).json({ error: 'Falha ao gerar PDF (servico de DANFE)', status: resp.status })
    }

    const data = await resp.json().catch(() => null)
    const danfe_base64 = String(data?.pdf_base64 || '')
    if (!danfe_base64) {
      console.error('[danfe] DanfeHub respondeu sem pdf_base64')
      return res.status(502).json({ error: 'Servico de DANFE nao devolveu o PDF' })
    }

    return res.status(200).json({ danfe_base64, meta: data?.meta || null })
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      console.error('[danfe] Tempo esgotado aguardando o DanfeHub')
      return res.status(504).json({ error: 'Tempo esgotado ao gerar a DANFE' })
    }
    // Log sem payload (LGPD): nao registra XML nem dados da nota.
    console.error('[danfe] Erro ao gerar DANFE:', e?.message)
    return res.status(500).json({ error: 'Erro interno ao gerar DANFE' })
  } finally {
    clearTimeout(timer)
  }
}
