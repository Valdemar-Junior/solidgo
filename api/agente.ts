import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireAdmin } from './_lib/auth.js'
import { ErroFerramenta, type Contexto, type Ferramenta, type Json } from './_agente/comum.js'
import { FERRAMENTAS_LEITURA } from './_agente/ferramentas.js'
import { FERRAMENTAS_ROTA } from './_agente/rota.js'
import { conversar, hermesConfigurado } from './_agente/chat.js'
import { posicoesAoVivo, salvarVinculo } from './_agente/rastreio.js'
import { acaoWhatsapp, processarWebhookWhatsapp, tokenWebhookWhatsapp } from './_agente/whatsapp.js'

// Função única do agente (o plano gratuito da Vercel limita a 12 funções em api/).
//   /api/mcp                    -> canal MCP (Hermes), protegido por token
//   /api/agente?canal=admin&... -> telas do SolidGo (config, aprovação, chat, ao vivo), só admin logado
//
// MCP "Streamable HTTP" sem sessão, respondendo JSON simples, feito à mão
// (só precisamos de initialize / tools/list / tools/call / ping).

const FERRAMENTAS: Ferramenta[] = [...FERRAMENTAS_LEITURA, ...FERRAMENTAS_ROTA]
const PROTOCOLOS = ['2025-06-18', '2025-03-26', '2024-11-05']
const INSTRUCOES =
  'Servidor do SolidGo (logística do Lojão dos Móveis). Leitura: listar_pedidos_pendentes (fila de pedidos aguardando rota, ' +
  'com observações), listar_motoristas_veiculos (motoristas, ajudantes, equipes, veículos, conferentes, romaneios Em Separação), ' +
  'listar_rotas_cadastradas e ver_rota. Escrita: preparar_rota NÃO grava, devolve prévia e link; a rota só é criada quando um ' +
  'admin clica Confirmar no SolidGo. Sempre leia as observações dos pedidos. O dia da entrega é opcional (a rota não tem campo de data).'

type RpcId = string | number | null

function cabecalho(req: any, nome: string): string {
  const v = req?.headers?.[nome]
  return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '')
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

// Compara em tempo constante (hash dos dois lados para igualar o tamanho).
function iguais(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}

function clienteBanco(): SupabaseClient | null {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\s+/g, '').replace(/\/+$/, '')
  const chave = (process.env.SUPABASE_SERVICE_KEY || '').trim().replace(/\s+/g, '')
  if (!url || !chave) return null
  return createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } })
}

type Config = { ativo: boolean; permite_criar_rota: boolean; token_hash: string | null; token_criado_em: string | null }

async function lerConfig(supa: SupabaseClient): Promise<Config | null> {
  const { data, error } = await supa.from('agente_config')
    .select('ativo, permite_criar_rota, token_hash, token_criado_em').eq('id', true).maybeSingle()
  if (error) return null // tabela ainda não criada: cai no token da variável de ambiente
  return (data as Config | null) ?? null
}

// Token: se já foi gerado um na tela do SolidGo, SÓ ele vale (o da Vercel morre).
// Senão, vale MCP_TOKEN da Vercel.
function tokenValido(req: any, config: Config | null): boolean {
  const bearer = cabecalho(req, 'authorization').replace(/^Bearer\s+/i, '').trim()
  const recebido = bearer || cabecalho(req, 'x-mcp-token').trim()
  if (!recebido) return false
  if (config?.token_hash) return iguais(sha256(recebido), config.token_hash)
  const esperado = (process.env.MCP_TOKEN || '').trim()
  if (esperado.length < 32) return false
  return iguais(recebido, esperado)
}

function ipDe(req: any): string | null {
  return cabecalho(req, 'x-forwarded-for').split(',')[0].trim() || null
}

function baseUrlDe(req: any): string {
  const host = cabecalho(req, 'x-forwarded-host') || cabecalho(req, 'host') || 'solidgo.lojaodosmoveis.shop'
  const proto = cabecalho(req, 'x-forwarded-proto') || 'https'
  return `${proto}://${host}`
}

async function auditar(supa: SupabaseClient, linha: { origem: string; acao: string; ok: boolean; detalhe?: unknown; erro?: string | null; ator?: string | null; ip?: string | null }) {
  try {
    await supa.from('agente_auditoria').insert({ ...linha, detalhe: linha.detalhe ?? null, erro: linha.erro ?? null })
  } catch {
    // auditoria nunca derruba a operação
  }
}

// ===========================================================================
// Canal MCP
// ===========================================================================
const ok = (id: RpcId, result: unknown) => ({ jsonrpc: '2.0', id, result })
const falha = (id: RpcId, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

async function chamarFerramenta(supa: SupabaseClient, params: Json, ctx: Contexto, ip: string | null) {
  const nome = String(params?.name ?? '')
  const args = (params?.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Json
  const ferramenta = FERRAMENTAS.find((f) => f.name === nome)
  if (!ferramenta) return { isError: true, content: [{ type: 'text', text: `Ferramenta desconhecida: ${nome}` }] }

  try {
    const resultado = await ferramenta.executar(supa, args, ctx)
    if (!ferramenta.somenteLeitura) {
      const r = resultado as Json
      await auditar(supa, { origem: 'mcp', acao: nome, ok: true, ator: ctx.ator, ip,
        detalhe: { args, aprovacao_id: r?.aprovacao_id ?? null, pedidos_fora: (r?.resumo as Json | undefined)?.pedidos_fora ?? r?.pedidos_fora ?? null } })
    }
    return { content: [{ type: 'text', text: JSON.stringify(resultado) }] }
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    const msg = e instanceof ErroFerramenta
      ? e.message
      : timeout
        ? 'O banco demorou mais de 10 segundos para responder. Tente de novo ou filtre mais.'
        : 'Erro ao consultar o SolidGo.'
    if (!(e instanceof ErroFerramenta)) console.error(`[mcp] ${nome} falhou:`, e instanceof Error ? e.message : e)
    if (!ferramenta.somenteLeitura) await auditar(supa, { origem: 'mcp', acao: nome, ok: false, ator: ctx.ator, ip, detalhe: { args }, erro: msg })
    return { isError: true, content: [{ type: 'text', text: msg }] }
  }
}

async function tratarMcp(supa: SupabaseClient, msg: Json, ctx: Contexto, ip: string | null): Promise<Json | null> {
  const id = (msg?.id ?? null) as RpcId
  const metodo = String(msg?.method ?? '')
  if (!('id' in (msg || {}))) return null // notificações não respondem

  switch (metodo) {
    case 'initialize': {
      const pedido = String((msg.params as Json | undefined)?.protocolVersion ?? '')
      return ok(id, {
        protocolVersion: PROTOCOLOS.includes(pedido) ? pedido : PROTOCOLOS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'solidgo', version: '2.0.0' },
        instructions: INSTRUCOES,
      })
    }
    case 'ping':
      return ok(id, {})
    case 'tools/list':
      return ok(id, {
        tools: FERRAMENTAS.map(({ name, description, inputSchema, somenteLeitura }) => ({
          name, description, inputSchema, annotations: { readOnlyHint: somenteLeitura },
        })),
      })
    case 'tools/call':
      return ok(id, await chamarFerramenta(supa, (msg.params || {}) as Json, ctx, ip))
    default:
      return falha(id, -32601, `Método não suportado: ${metodo}`)
  }
}

async function canalMcp(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Use POST' })
  }
  // Sem token nenhum: recusa antes de tocar no banco.
  if (!cabecalho(req, 'authorization').trim() && !cabecalho(req, 'x-mcp-token').trim()) {
    return res.status(401).json({ error: 'Não autorizado' })
  }
  const supa = clienteBanco()
  if (!supa) return res.status(500).json({ error: 'Servidor sem configuração do banco' })

  const config = await lerConfig(supa)
  // Porteiro: sem token válido, nenhuma ferramenta roda.
  if (!tokenValido(req, config)) return res.status(401).json({ error: 'Não autorizado' })
  if (config && !config.ativo) return res.status(503).json({ error: 'Agente desligado nas configurações do SolidGo' })

  let corpo: unknown = req.body
  if (typeof corpo === 'string') {
    try { corpo = JSON.parse(corpo) } catch { return res.status(400).json(falha(null, -32700, 'JSON inválido')) }
  }
  if (!corpo || typeof corpo !== 'object') return res.status(400).json(falha(null, -32600, 'Requisição inválida'))

  const ctx: Contexto = { baseUrl: baseUrlDe(req), ator: cabecalho(req, 'x-mcp-actor').slice(0, 120) || null }
  const ip = ipDe(req)
  const mensagens = (Array.isArray(corpo) ? corpo : [corpo]) as Json[]
  const respostas = (await Promise.all(mensagens.map((m) => tratarMcp(supa, m, ctx, ip)))).filter((r): r is Json => r !== null)

  if (respostas.length === 0) return res.status(202).end()
  return res.status(200).json(Array.isArray(corpo) ? respostas : respostas[0])
}

// ===========================================================================
// Canal admin (telas do SolidGo). Sempre exige admin logado.
// ===========================================================================
async function canalAdmin(req: any, res: any) {
  const admin = await requireAdmin(req, res)
  if (!admin) return
  const supa = clienteBanco()
  if (!supa) return res.status(500).json({ error: 'Servidor sem configuração do banco' })

  const acao = String(req.query?.acao ?? '')
  const corpo = (typeof req.body === 'object' && req.body) ? req.body as Json : {}
  const ip = ipDe(req)

  if (acao === 'chat' && req.method === 'POST') return conversar(req, res, supa, admin.id)

  // Tela "Ao vivo" (rastreio pelos celulares, via Traccar). Só leitura + vínculo celular->motorista.
  if (acao === 'ao_vivo' && req.method === 'GET') {
    try { return res.status(200).json(await posicoesAoVivo(supa)) }
    catch (e) { return res.status(502).json({ error: e instanceof Error ? e.message : 'Falha ao ler o Traccar.' }) }
  }
  if (acao === 'vincular_celular' && req.method === 'POST') {
    try { return res.status(200).json(await salvarVinculo(supa, corpo.dispositivo_id, corpo.motorista_id)) }
    catch (e) { return res.status(400).json({ error: e instanceof Error ? e.message : 'Falha ao vincular.' }) }
  }
  if (acao.startsWith('wa_')) {
    // Senha extra da tela, opcional: sem WA_TELA_SENHA na Vercel, vale só o login de admin.
    // A faixa de "desconectado" fica de fora porque não mostra nenhum dado.
    const senhaTela = (process.env.WA_TELA_SENHA || '').trim()
    if (senhaTela && acao !== 'wa_faixa' && !iguais(cabecalho(req, 'x-wa-senha'), encodeURIComponent(senhaTela))) {
      return res.status(403).json({ error: 'SENHA_WHATSAPP' })
    }
    try {
      const resultado = await acaoWhatsapp(supa, acao, String(req.method), { ...req.query, ...corpo }, baseUrlDe(req), admin.id)
      if (['wa_ativar_recebimento', 'wa_reiniciar', 'wa_desconectar'].includes(acao)) {
        await auditar(supa, { origem: 'admin', acao, ok: true, ator: admin.id, ip })
      }
      return res.status(200).json(resultado)
    } catch (e) {
      return res.status(502).json({ error: e instanceof Error ? e.message : 'Falha ao falar com o WhatsApp.' })
    }
  }
  if (acao === 'chat_status' && req.method === 'GET') {
    const config = await lerConfig(supa)
    return res.status(200).json({ configurado: hermesConfigurado(), ativo: config?.ativo !== false })
  }

  if (acao === 'config' && req.method === 'GET') {
    const config = await lerConfig(supa)
    if (!config) return res.status(500).json({ error: 'Tabelas do agente ainda não criadas no banco (rode a migração).' })
    return res.status(200).json({
      ativo: config.ativo,
      permite_criar_rota: config.permite_criar_rota,
      token_gerado_no_solidgo: Boolean(config.token_hash),
      token_criado_em: config.token_criado_em,
      token_da_vercel_configurado: (process.env.MCP_TOKEN || '').trim().length >= 32,
      endereco_mcp: `${baseUrlDe(req)}/api/mcp`,
      chat_configurado: hermesConfigurado(),
    })
  }

  if (acao === 'config' && req.method === 'POST') {
    const mudanca: Json = { atualizado_em: new Date().toISOString(), atualizado_por: admin.id }
    if (typeof corpo.ativo === 'boolean') mudanca.ativo = corpo.ativo
    if (typeof corpo.permite_criar_rota === 'boolean') mudanca.permite_criar_rota = corpo.permite_criar_rota
    const { error } = await supa.from('agente_config').update(mudanca).eq('id', true)
    if (error) return res.status(500).json({ error: 'Não consegui salvar.' })
    await auditar(supa, { origem: 'admin', acao: 'alterar_config', ok: true, ator: admin.id, ip, detalhe: mudanca })
    return res.status(200).json({ ok: true })
  }

  if (acao === 'gerar_token' && req.method === 'POST') {
    const token = randomBytes(32).toString('hex')
    const { error } = await supa.from('agente_config')
      .update({ token_hash: sha256(token), token_criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(), atualizado_por: admin.id })
      .eq('id', true)
    if (error) return res.status(500).json({ error: 'Não consegui gerar o token.' })
    await auditar(supa, { origem: 'admin', acao: 'gerar_token', ok: true, ator: admin.id, ip })
    // Única vez que o token aparece: no banco fica só o hash.
    return res.status(200).json({ token, endereco_mcp: `${baseUrlDe(req)}/api/mcp` })
  }

  if (acao === 'aprovacao' && req.method === 'GET') {
    const id = String(req.query?.id ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Id inválido' })
    const { data, error } = await supa.from('agente_aprovacoes')
      .select('id, status, tipo, resumo, criado_em, expira_em, pedido_por, decidido_em, route_code, erro').eq('id', id).maybeSingle()
    if (error) return res.status(500).json({ error: 'Erro ao buscar a proposta.' })
    if (!data) return res.status(404).json({ error: 'Proposta não encontrada.' })
    const expirada = data.status === 'pendente' && new Date(String(data.expira_em)) < new Date()
    return res.status(200).json({ ...data, status: expirada ? 'expirada' : data.status })
  }

  if (acao === 'decidir' && req.method === 'POST') {
    const id = String(corpo.id ?? '')
    const decisao = String(corpo.decisao ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(id) || !['aprovar', 'recusar'].includes(decisao)) {
      return res.status(400).json({ error: 'Pedido inválido' })
    }
    if (decisao === 'recusar') {
      const { data, error } = await supa.from('agente_aprovacoes')
        .update({ status: 'recusada', decidido_por: admin.id, decidido_em: new Date().toISOString() })
        .eq('id', id).eq('status', 'pendente').select('id')
      if (error) return res.status(500).json({ error: 'Não consegui recusar.' })
      if (!data?.length) return res.status(409).json({ error: 'Essa proposta não está mais pendente.' })
      await auditar(supa, { origem: 'admin', acao: 'recusar_rota', ok: true, ator: admin.id, ip, detalhe: { aprovacao_id: id } })
      return res.status(200).json({ ok: true, status: 'recusada' })
    }
    const { data, error } = await supa.rpc('agente_aprovar_rota', { p_aprovacao_id: id, p_admin_id: admin.id })
    if (error) {
      await auditar(supa, { origem: 'admin', acao: 'aprovar_rota', ok: false, ator: admin.id, ip, detalhe: { aprovacao_id: id }, erro: error.message })
      return res.status(400).json({ error: error.message })
    }
    const r = (data || {}) as Json
    await auditar(supa, { origem: 'admin', acao: 'aprovar_rota', ok: r.ok === true, ator: admin.id, ip, detalhe: { aprovacao_id: id, ...r }, erro: r.ok ? null : String(r.erro ?? '') })
    return res.status(r.ok ? 200 : 409).json(r)
  }

  if (acao === 'historico' && req.method === 'GET') {
    const [aps, aud] = await Promise.all([
      supa.from('agente_aprovacoes').select('id, status, tipo, criado_em, expira_em, decidido_em, route_code, erro, resumo')
        .order('criado_em', { ascending: false }).limit(30),
      supa.from('agente_auditoria').select('id, criado_em, origem, acao, ok, erro, ator')
        .order('criado_em', { ascending: false }).limit(50),
    ])
    const agora = new Date()
    return res.status(200).json({
      aprovacoes: (aps.data || []).map((a: Json) => ({
        id: a.id, status: a.status === 'pendente' && new Date(String(a.expira_em)) < agora ? 'expirada' : a.status,
        tipo: a.tipo, criado_em: a.criado_em, decidido_em: a.decidido_em, route_code: a.route_code, erro: a.erro,
        rota: (a.resumo as Json | null)?.rota ?? null,
        pedidos: Array.isArray((a.resumo as Json | null)?.pedidos) ? ((a.resumo as Json).pedidos as unknown[]).length : 0,
      })),
      auditoria: aud.data || [],
    })
  }

  return res.status(404).json({ error: 'Ação desconhecida' })
}

// ===========================================================================
// Webhook do WhatsApp. A Evolution não assina o envio: o segredo vai na URL.
// Grava antes de responder: depois da resposta a Vercel pode encerrar a função.
// Se falhar, responde 500 e o reenvio não duplica nada (message_id é único).
// ===========================================================================
async function canalWhatsapp(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Use POST' })
  }
  const esperado = tokenWebhookWhatsapp()
  if (esperado.length < 32 || !iguais(String(req.query?.token ?? ''), esperado)) {
    return res.status(401).json({ error: 'Não autorizado' })
  }
  const supa = clienteBanco()
  if (!supa) return res.status(500).json({ error: 'Servidor sem configuração do banco' })

  let corpo: unknown = req.body
  if (typeof corpo === 'string') {
    try { corpo = JSON.parse(corpo) } catch { return res.status(400).json({ error: 'JSON inválido' }) }
  }
  if (!corpo || typeof corpo !== 'object') return res.status(400).json({ error: 'Requisição inválida' })

  try {
    await processarWebhookWhatsapp(supa, corpo as Json)
    return res.status(200).json({ ok: true })
  } catch (e) {
    console.error('[whatsapp] webhook falhou:', e instanceof Error ? e.message : e)
    return res.status(500).json({ error: 'Falha ao gravar' })
  }
}

export default async function handler(req: any, res: any) {
  const canal = String(req.query?.canal ?? '')
  if (canal === 'admin') return canalAdmin(req, res)
  if (canal === 'whatsapp') return canalWhatsapp(req, res)
  return canalMcp(req, res)
}
