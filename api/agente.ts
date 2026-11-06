import { createHash, timingSafeEqual } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { ErroFerramenta, FERRAMENTAS } from './_agente/ferramentas.js'

// Função única do agente (MCP agora; o chat do admin entra aqui na fase 3).
// Uma função só porque o plano gratuito da Vercel limita a 12 funções em api/.
// Publicada em /api/mcp por rewrite no vercel.json.
//
// Protocolo: MCP "Streamable HTTP" sem sessão (cada request é independente),
// respondendo JSON simples. Feito à mão, sem SDK, porque só precisamos de
// initialize / tools/list / tools/call / ping.

const PROTOCOLOS = ['2025-06-18', '2025-03-26', '2024-11-05']
const INSTRUCOES =
  'Servidor do SolidGo (logística do Lojão dos Móveis). Fase atual: somente leitura. ' +
  'Use listar_pedidos_pendentes para a fila de pedidos aguardando rota, listar_motoristas_veiculos, ' +
  'listar_rotas_cadastradas para os nomes válidos de rota e ver_rota para conferir uma rota.'

type Json = Record<string, unknown>
type RpcId = string | number | null

function cabecalho(req: any, nome: string): string {
  const v = req?.headers?.[nome]
  return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '')
}

// Compara em tempo constante (hash dos dois lados para igualar o tamanho).
function tokenConfere(recebido: string, esperado: string): boolean {
  const a = createHash('sha256').update(recebido).digest()
  const b = createHash('sha256').update(esperado).digest()
  return timingSafeEqual(a, b)
}

function autorizado(req: any): boolean {
  const esperado = (process.env.MCP_TOKEN || '').trim()
  if (esperado.length < 32) return false // sem token configurado (ou fraco) ninguém entra
  const bearer = cabecalho(req, 'authorization').replace(/^Bearer\s+/i, '').trim()
  const alternativo = cabecalho(req, 'x-mcp-token').trim()
  const recebido = bearer || alternativo
  return Boolean(recebido) && tokenConfere(recebido, esperado)
}

function clienteBanco() {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\s+/g, '').replace(/\/+$/, '')
  const chave = (process.env.SUPABASE_SERVICE_KEY || '').trim().replace(/\s+/g, '')
  if (!url || !chave) return null
  return createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } })
}

const ok = (id: RpcId, result: unknown) => ({ jsonrpc: '2.0', id, result })
const falha = (id: RpcId, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

async function chamarFerramenta(params: Json) {
  const nome = String(params?.name ?? '')
  const args = (params?.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Json
  const ferramenta = FERRAMENTAS.find((f) => f.name === nome)
  if (!ferramenta) {
    return { isError: true, content: [{ type: 'text', text: `Ferramenta desconhecida: ${nome}` }] }
  }
  const supa = clienteBanco()
  if (!supa) return { isError: true, content: [{ type: 'text', text: 'Servidor sem configuração do banco.' }] }

  try {
    const resultado = await ferramenta.executar(supa, args)
    return { content: [{ type: 'text', text: JSON.stringify(resultado) }] }
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    const msg = e instanceof ErroFerramenta
      ? e.message
      : timeout
        ? 'O banco demorou mais de 10 segundos para responder. Tente de novo ou filtre mais.'
        : 'Erro ao consultar o SolidGo.'
    if (!(e instanceof ErroFerramenta)) console.error(`[mcp] ${nome} falhou:`, e instanceof Error ? e.message : e)
    return { isError: true, content: [{ type: 'text', text: msg }] }
  }
}

async function tratar(msg: Json): Promise<Json | null> {
  const id = (msg?.id ?? null) as RpcId
  const metodo = String(msg?.method ?? '')
  const ehNotificacao = !('id' in (msg || {}))
  if (ehNotificacao) return null // notifications/initialized etc.: não respondem

  switch (metodo) {
    case 'initialize': {
      const pedido = String((msg.params as Json | undefined)?.protocolVersion ?? '')
      return ok(id, {
        protocolVersion: PROTOCOLOS.includes(pedido) ? pedido : PROTOCOLOS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'solidgo', version: '1.0.0' },
        instructions: INSTRUCOES,
      })
    }
    case 'ping':
      return ok(id, {})
    case 'tools/list':
      return ok(id, {
        tools: FERRAMENTAS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
          annotations: { readOnlyHint: true },
        })),
      })
    case 'tools/call':
      return ok(id, await chamarFerramenta((msg.params || {}) as Json))
    default:
      return falha(id, -32601, `Método não suportado: ${metodo}`)
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Use POST' })
  }
  // Porteiro antes de qualquer coisa: sem token válido, nenhuma consulta ao banco.
  if (!autorizado(req)) return res.status(401).json({ error: 'Não autorizado' })

  let corpo: unknown = req.body
  if (typeof corpo === 'string') {
    try { corpo = JSON.parse(corpo) } catch { return res.status(400).json(falha(null, -32700, 'JSON inválido')) }
  }
  if (!corpo || typeof corpo !== 'object') return res.status(400).json(falha(null, -32600, 'Requisição inválida'))

  const mensagens = (Array.isArray(corpo) ? corpo : [corpo]) as Json[]
  const respostas = (await Promise.all(mensagens.map(tratar))).filter((r): r is Json => r !== null)

  if (respostas.length === 0) return res.status(202).end()
  return res.status(200).json(Array.isArray(corpo) ? respostas : respostas[0])
}
