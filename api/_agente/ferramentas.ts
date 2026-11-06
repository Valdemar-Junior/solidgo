import type { SupabaseClient } from '@supabase/supabase-js'

// Ferramentas do MCP do SolidGo. FASE 1: somente leitura.
// Regra de ouro: nada aqui grava no banco. Escrita entra na fase 2, com prévia,
// confirmação humana e auditoria.
// Privacidade: nunca devolver telefone, CPF ou endereço completo (só cidade/bairro).

type Json = Record<string, unknown>

export type Ferramenta = {
  name: string
  description: string
  inputSchema: Json
  executar: (supa: SupabaseClient, args: Json) => Promise<unknown>
}

export class ErroFerramenta extends Error {}

const TIMEOUT_MS = 10_000
const sinal = () => AbortSignal.timeout(TIMEOUT_MS)

// "São Rafael" == "sao rafael" == "SAO RAFAEL"
export function normalizar(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

function texto(valor: unknown, max = 300): string | null {
  const s = String(valor ?? '').trim()
  if (!s) return null
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function lerTexto(args: Json, campo: string): string | undefined {
  const v = args[campo]
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v !== 'string') throw new ErroFerramenta(`"${campo}" precisa ser texto.`)
  return v.trim()
}

function lerLimite(args: Json, padrao: number, maximo: number): number {
  const v = args.limite
  if (v === undefined || v === null) return padrao
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1 || n > maximo) {
    throw new ErroFerramenta(`"limite" precisa ser um número inteiro entre 1 e ${maximo}.`)
  }
  return n
}

// O Supabase corta cada resposta em 1000 linhas sem avisar: busca página por página.
const PAGINA = 1000
async function buscarTudo(
  consulta: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<Json[]> {
  const todas: Json[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1)
    if (error) throw error
    const pagina = (data || []) as Json[]
    todas.push(...pagina)
    if (pagina.length < PAGINA) return todas
    if (todas.length >= 20_000) throw new ErroFerramenta('Consulta grande demais; filtre mais.')
  }
}

function emLotes<T>(lista: T[], tamanho: number): T[][] {
  const lotes: T[][] = []
  for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho))
  return lotes
}

function resumoItens(itens: unknown): { quantidade_itens: number; produtos: string[] } {
  const lista = Array.isArray(itens) ? itens : []
  const produtos = lista
    .map((it) => texto((it as Json)?.name, 80))
    .filter((n): n is string => Boolean(n))
  return { quantidade_itens: lista.length, produtos: produtos.slice(0, 5) }
}

// ---------------------------------------------------------------------------
// listar_pedidos_pendentes
// Mesma regra da fila "Pedidos aguardando rota" (RouteCreation.tsx / loadData):
// status pending ou returned, sem bloqueio, fora de rota ativa e sem retirada.
// ---------------------------------------------------------------------------
async function listarPedidosPendentes(supa: SupabaseClient, args: Json) {
  const cidade = lerTexto(args, 'cidade')
  const limite = lerLimite(args, 50, 200)

  const pedidos = await buscarTudo((de, ate) =>
    supa
      .from('orders')
      .select('id, order_id_erp, customer_name, address_json, items_json, status, filial_venda, data_venda, previsao_entrega, observacoes_internas, observacoes_publicas, return_flag, last_return_reason, created_at')
      .in('status', ['pending', 'returned'])
      .is('blocked_at', null)
      .order('data_venda', { ascending: true })
      .order('id', { ascending: true })
      .range(de, ate)
      .abortSignal(sinal()),
  )

  const emRotaAtiva = await buscarTudo((de, ate) =>
    supa
      .from('route_orders')
      .select('id, order_id, route:routes!inner(status)')
      .neq('route.status', 'completed')
      .order('id', { ascending: true })
      .range(de, ate)
      .abortSignal(sinal()),
  )
  const travados = new Set(emRotaAtiva.map((r) => String(r.order_id)))

  let fila = pedidos.filter((p) => !travados.has(String(p.id)))

  const retirados = new Set<string>()
  for (const lote of emLotes(fila.map((p: Json) => String(p.id)), 150)) {
    const { data, error: erroRetirada } = await supa
      .from('order_withdrawals')
      .select('order_id')
      .in('order_id', lote)
      .abortSignal(sinal())
    if (erroRetirada) throw erroRetirada
    for (const r of data || []) retirados.add(String((r as Json).order_id))
  }
  fila = fila.filter((p: Json) => !retirados.has(String(p.id)))

  const cidadeDe = (p: Json) => String((p.address_json as Json | null)?.city ?? '').trim()

  const porCidade: Record<string, number> = {}
  for (const p of fila) {
    const c = cidadeDe(p) || '(sem cidade)'
    porCidade[c] = (porCidade[c] || 0) + 1
  }

  if (cidade) {
    const alvo = normalizar(cidade)
    fila = fila.filter((p: Json) => normalizar(cidadeDe(p)) === alvo)
  }

  return {
    total_na_fila: fila.length,
    mostrando: Math.min(fila.length, limite),
    filtro_cidade: cidade ?? null,
    ...(cidade ? {} : { resumo_por_cidade: porCidade }),
    pedidos: fila.slice(0, limite).map((p: Json) => {
      const endereco = (p.address_json as Json | null) || {}
      return {
        order_id_erp: p.order_id_erp,
        cliente: p.customer_name,
        cidade: cidadeDe(p) || null,
        bairro: texto(endereco.neighborhood, 80),
        loja: p.filial_venda ?? null,
        data_venda: p.data_venda ?? null,
        previsao_entrega: p.previsao_entrega ?? null,
        devolvido_antes: p.status === 'returned' || Boolean(p.return_flag) || Boolean(p.last_return_reason),
        observacoes_internas: texto(p.observacoes_internas),
        observacoes_publicas: texto(p.observacoes_publicas),
        ...resumoItens(p.items_json),
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// listar_motoristas_veiculos
// ---------------------------------------------------------------------------
async function listarMotoristasVeiculos(supa: SupabaseClient) {
  const [motoristasRes, veiculosRes] = await Promise.all([
    supa.from('drivers').select('id, active, user:users!user_id(name)').eq('active', true).abortSignal(sinal()),
    supa.from('vehicles').select('id, plate, model, capacity, active').eq('active', true).abortSignal(sinal()),
  ])
  if (motoristasRes.error) throw motoristasRes.error
  if (veiculosRes.error) throw veiculosRes.error

  const motoristas = (motoristasRes.data || [])
    .map((d: Json) => {
      const user = d.user as Json | Json[] | null
      const nome = Array.isArray(user) ? user[0]?.name : user?.name
      return { id: d.id, nome: texto(nome, 120) }
    })
    .filter((m) => m.nome)
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'))

  const veiculos = (veiculosRes.data || []).map((v: Json) => ({
    id: v.id,
    placa: v.plate,
    modelo: v.model,
    capacidade: v.capacity ?? null,
  }))

  return { motoristas, veiculos }
}

// ---------------------------------------------------------------------------
// listar_rotas_cadastradas (catálogo: os nomes válidos para criar rota)
// ---------------------------------------------------------------------------
async function listarRotasCadastradas(supa: SupabaseClient) {
  const { data, error } = await supa
    .from('delivery_route_catalog')
    .select('id, name')
    .eq('active', true)
    .order('name', { ascending: true })
    .abortSignal(sinal())
  if (error) throw error
  return { rotas: (data || []).map((r: Json) => ({ id: r.id, nome: r.name })) }
}

// ---------------------------------------------------------------------------
// ver_rota
// ---------------------------------------------------------------------------
const STATUS_ROTA: Record<string, string> = {
  pending: 'Em Separação',
  in_progress: 'Em Rota',
  completed: 'Finalizada',
}
const STATUS_PEDIDO_NA_ROTA: Record<string, string> = {
  pending: 'Pendente',
  delivered: 'Entregue',
  returned: 'Retornado',
}

async function verRota(supa: SupabaseClient, args: Json) {
  const rotaId = lerTexto(args, 'rota_id')
  const rota = lerTexto(args, 'rota')
  if (!rotaId && !rota) throw new ErroFerramenta('Informe "rota" (código RE-... ou nome) ou "rota_id".')

  const cabecalho = 'id, name, route_code, status, created_at, observations, conferente, driver:drivers!driver_id(user:users!user_id(name)), vehicle:vehicles!vehicle_id(plate, model)'

  let encontrada: Json | null = null
  if (rotaId) {
    const { data, error } = await supa.from('routes').select(cabecalho).eq('id', rotaId).abortSignal(sinal()).maybeSingle()
    if (error) throw error
    encontrada = data as Json | null
  } else if (rota) {
    const { data: porCodigo, error } = await supa.from('routes').select(cabecalho).ilike('route_code', rota.replace(/[%_]/g, '')).limit(1).abortSignal(sinal())
    if (error) throw error
    if (porCodigo && porCodigo.length > 0) {
      encontrada = porCodigo[0] as Json
    } else {
      const { data: porNome, error: erroNome } = await supa
        .from('routes')
        .select('id, name, route_code, status, created_at')
        .ilike('name', `%${rota.replace(/[%_]/g, '')}%`)
        .order('created_at', { ascending: false })
        .limit(10)
        .abortSignal(sinal())
      if (erroNome) throw erroNome
      if (!porNome || porNome.length === 0) throw new ErroFerramenta(`Nenhuma rota encontrada para "${rota}".`)
      if (porNome.length > 1) {
        return {
          aviso: 'Mais de uma rota com esse nome. Chame de novo com o route_code ou rota_id de uma delas.',
          candidatas: porNome.map((r: Json) => ({
            rota_id: r.id,
            nome: r.name,
            route_code: r.route_code,
            status: STATUS_ROTA[String(r.status)] ?? r.status,
            criada_em: r.created_at,
          })),
        }
      }
      return verRota(supa, { rota_id: String((porNome[0] as Json).id) })
    }
  }
  if (!encontrada) throw new ErroFerramenta('Rota não encontrada.')

  const { data: itens, error: erroItens } = await supa
    .from('route_orders')
    .select('sequence, status, order:orders!order_id(order_id_erp, customer_name, address_json)')
    .eq('route_id', String(encontrada.id))
    .order('sequence', { ascending: true })
    .abortSignal(sinal())
  if (erroItens) throw erroItens

  const motorista = ((encontrada.driver as Json | null)?.user as Json | null)?.name ?? null
  const veiculo = encontrada.vehicle as Json | null

  return {
    rota_id: encontrada.id,
    nome: encontrada.name,
    route_code: encontrada.route_code,
    status: STATUS_ROTA[String(encontrada.status)] ?? encontrada.status,
    criada_em: encontrada.created_at,
    motorista,
    veiculo: veiculo ? { placa: veiculo.plate, modelo: veiculo.model } : null,
    conferente: encontrada.conferente ?? null,
    observacoes: texto(encontrada.observations),
    total_pedidos: (itens || []).length,
    pedidos: (itens || []).map((ro: Json) => {
      const o = (ro.order as Json | null) || {}
      return {
        sequencia: ro.sequence,
        order_id_erp: o.order_id_erp ?? null,
        cliente: o.customer_name ?? null,
        cidade: (o.address_json as Json | null)?.city ?? null,
        status: STATUS_PEDIDO_NA_ROTA[String(ro.status)] ?? ro.status,
      }
    }),
  }
}

export const FERRAMENTAS: Ferramenta[] = [
  {
    name: 'listar_pedidos_pendentes',
    description:
      'Lista os pedidos aguardando rota de entrega (mesma fila da tela Gestão de Entregas: pendentes ou devolvidos, sem bloqueio, fora de rota ativa e não retirados). Sem cidade, traz também o resumo de quantos pedidos há por cidade. Somente leitura.',
    inputSchema: {
      type: 'object',
      properties: {
        cidade: { type: 'string', description: 'Filtra pela cidade de entrega (ignora acento e maiúsculas). Ex.: "São Rafael".' },
        limite: { type: 'integer', minimum: 1, maximum: 200, default: 50, description: 'Quantos pedidos devolver (1 a 200).' },
      },
      additionalProperties: false,
    },
    executar: listarPedidosPendentes,
  },
  {
    name: 'listar_motoristas_veiculos',
    description: 'Lista os motoristas ativos e os veículos ativos (placa, modelo, capacidade). Somente leitura.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    executar: (supa) => listarMotoristasVeiculos(supa),
  },
  {
    name: 'listar_rotas_cadastradas',
    description: 'Lista os nomes de rota cadastrados no catálogo (os únicos nomes válidos para criar uma rota de entrega). Somente leitura.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    executar: (supa) => listarRotasCadastradas(supa),
  },
  {
    name: 'ver_rota',
    description: 'Mostra uma rota: cabeçalho (status, motorista, veículo, conferente) e os pedidos na ordem de entrega. Aceita o código (RE-DDMMYY-XXX), o nome ou o id. Somente leitura.',
    inputSchema: {
      type: 'object',
      properties: {
        rota: { type: 'string', description: 'Código da rota (ex.: RE-061126-002) ou nome (ex.: MOSSORÓ).' },
        rota_id: { type: 'string', description: 'Id (uuid) da rota.' },
      },
      additionalProperties: false,
    },
    executar: verRota,
  },
]
