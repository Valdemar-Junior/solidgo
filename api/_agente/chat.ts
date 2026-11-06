import type { SupabaseClient } from '@supabase/supabase-js'
import type { Json } from './comum.js'

// Ponte do chat do SolidGo (fase 3) para o API server do Hermes na VPS.
// O navegador NUNCA fala direto com o Hermes: a chave dele fica só aqui no
// servidor (HERMES_API_URL / HERMES_API_KEY na Vercel). Só admin logado chega aqui.
//
// Resposta para o navegador: uma linha JSON por evento (NDJSON):
//   {"t":"texto","v":"..."}        pedaço da resposta
//   {"t":"ferramenta","v":"nome"}  o agente começou a usar uma ferramenta
//   {"t":"erro","v":"..."}         falha
//   {"t":"fim"}

const MAX_MENSAGENS = 40
const MAX_CARACTERES = 8000

export function hermesConfigurado(): boolean {
  return Boolean((process.env.HERMES_API_URL || '').trim() && (process.env.HERMES_API_KEY || '').trim())
}

function hojeBR(): string {
  return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
}

function instrucoes(nomeAdmin: string): string {
  return [
    `Você está no chat interno do SolidGo (logística do Lojão dos Móveis), falando com ${nomeAdmin}, administrador.`,
    `Hoje é ${hojeBR()} (horário de Brasília).`,
    'Use as ferramentas do servidor MCP "solidgo" para consultar pedidos, motoristas, veículos e rotas.',
    'Para criar rota use preparar_rota: ela NÃO grava, devolve uma prévia e um link_para_aprovar. Sempre inclua o link_para_aprovar',
    'completo na resposta: o SolidGo transforma esse link num cartão com o botão Confirmar. Nunca diga que a rota foi criada',
    'antes de consultar_aprovacao confirmar. Leia as observações dos pedidos e aponte restrições de data.',
    'Responda em português, de forma curta e organizada. Não mostre telefones nem CPF.',
  ].join(' ')
}

type Mensagem = { role: 'user' | 'assistant'; content: string }

function limparMensagens(bruto: unknown): Mensagem[] {
  if (!Array.isArray(bruto)) return []
  return bruto
    .filter((m): m is Json => Boolean(m) && typeof m === 'object')
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_MENSAGENS)
    .map((m) => ({ role: m.role as Mensagem['role'], content: String(m.content).slice(0, MAX_CARACTERES) }))
}

export async function conversar(req: any, res: any, supa: SupabaseClient, adminId: string) {
  // Aceita o endereço com ou sem /v1 no final (com /v1 virava /v1/v1/... = 404).
  const url = (process.env.HERMES_API_URL || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '')
  const chave = (process.env.HERMES_API_KEY || '').trim()
  if (!url || !chave) return res.status(503).json({ error: 'Chat ainda não configurado: faltam HERMES_API_URL e HERMES_API_KEY na Vercel.' })

  const { data: cfg } = await supa.from('agente_config').select('ativo').eq('id', true).maybeSingle()
  if (cfg && cfg.ativo === false) return res.status(503).json({ error: 'Agente desligado nas configurações (Agente IA).' })

  const corpo = (typeof req.body === 'object' && req.body) ? req.body as Json : {}
  const mensagens = limparMensagens(corpo.mensagens)
  if (mensagens.length === 0 || mensagens[mensagens.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'Mensagem vazia.' })
  }
  const sessao = String(corpo.sessao ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64)

  const { data: usuario } = await supa.from('users').select('name').eq('id', adminId).maybeSingle()
  const nomeAdmin = String(usuario?.name || 'admin')

  const cabecalhos: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${chave}`,
    Accept: 'text/event-stream',
    'X-Hermes-Session-Key': `solidgo-chat-${adminId}`,
  }
  if (sessao) cabecalhos['X-Hermes-Session-Id'] = `solidgo-${sessao}`

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no')
  res.status(200)
  const enviar = (evento: Json) => res.write(`${JSON.stringify(evento)}\n`)

  try {
    await supa.from('agente_auditoria').insert({ origem: 'chat', acao: 'mensagem_chat', ok: true, ator: adminId, detalhe: { mensagens: mensagens.length } })
  } catch { /* auditoria nunca derruba o chat */ }

  let resposta: Response
  try {
    resposta = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: cabecalhos,
      body: JSON.stringify({ stream: true, messages: [{ role: 'system', content: instrucoes(nomeAdmin) }, ...mensagens] }),
      signal: AbortSignal.timeout(55_000),
    })
  } catch (e) {
    enviar({ t: 'erro', v: 'Não consegui falar com o Hermes na VPS (fora do ar ou endereço errado).' })
    console.error('[chat] conexão com Hermes falhou:', e instanceof Error ? e.message : e)
    enviar({ t: 'fim' })
    return res.end()
  }

  if (!resposta.ok || !resposta.body) {
    const motivo = resposta.status === 401 ? 'chave do Hermes recusada (HERMES_API_KEY)' : `Hermes respondeu ${resposta.status}`
    enviar({ t: 'erro', v: `Falha no Hermes: ${motivo}.` })
    enviar({ t: 'fim' })
    return res.end()
  }

  // Lê o SSE do Hermes e repassa só o que a tela precisa.
  const leitor = resposta.body.getReader()
  const decodificador = new TextDecoder()
  let pendente = ''
  let eventoAtual = ''
  try {
    for (;;) {
      const { value, done } = await leitor.read()
      if (done) break
      pendente += decodificador.decode(value, { stream: true })
      const linhas = pendente.split(/\r?\n/)
      pendente = linhas.pop() ?? ''
      for (const linha of linhas) {
        if (!linha || linha.startsWith(':')) { if (!linha) eventoAtual = ''; continue }
        if (linha.startsWith('event:')) { eventoAtual = linha.slice(6).trim(); continue }
        if (!linha.startsWith('data:')) continue
        const dado = linha.slice(5).trim()
        if (dado === '[DONE]') continue
        let json: Json
        try { json = JSON.parse(dado) } catch { continue }
        if (eventoAtual === 'hermes.tool.progress') {
          const nome = String((json.tool ?? json.name ?? json.tool_name ?? '') as string)
          if (nome) enviar({ t: 'ferramenta', v: nome.replace(/^mcp_+solidgo_+/, '') })
          continue
        }
        const escolha = Array.isArray(json.choices) ? (json.choices[0] as Json | undefined) : undefined
        const delta = (escolha?.delta ?? {}) as Json
        if (typeof delta.content === 'string' && delta.content) enviar({ t: 'texto', v: delta.content })
      }
    }
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    enviar({ t: 'erro', v: timeout ? 'O Hermes demorou demais (limite de 55 s). Tente pedir em partes.' : 'A conexão com o Hermes caiu no meio da resposta.' })
  }
  enviar({ t: 'fim' })
  return res.end()
}
