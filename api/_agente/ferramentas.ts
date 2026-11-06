import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ErroFerramenta, buscarTudo, emLotes, lerLimite, lerTexto, normalizar, observacao, resumoItens, sinal, texto,
  type Ferramenta, type Json,
} from './comum.js'

// Ferramentas de LEITURA do MCP do SolidGo. A parte que prepara rota (fase 2)
// fica em ./rota.ts e também não grava rota: só a proposta para o admin aprovar.

// ---------------------------------------------------------------------------
// listar_pedidos_pendentes
// Mesma regra da fila "Pedidos aguardando rota" (RouteCreation.tsx / loadData):
// status pending ou returned, sem bloqueio, fora de rota ativa e sem retirada.
// ---------------------------------------------------------------------------
export async function listarPedidosPendentes(supa: SupabaseClient, args: Json) {
  const cidade = lerTexto(args, 'cidade')
  const limite = lerLimite(args, 50, 200)

  const pedidos = await buscarTudo((de, ate) =>
    supa
      .from('orders')
      .select('id, order_id_erp, customer_name, address_json, items_json, status, filial_venda, data_venda, previsao_entrega, observacoes_internas, observacoes_publicas, return_flag, last_return_reason, last_return_notes, created_at')
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
  // A tela só mostra pedido que tem item (RouteCreation.tsx expande pedido em linhas por item).
  // Sem isso entravam ~20 registros-fantasma de importação por lote: sem item, cidade nem data.
  fila = fila.filter((p: Json) => Array.isArray(p.items_json) && p.items_json.length > 0)

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
        // Inteiras (até 1000): uma data tipo "só recebe dia 25/11" costuma estar no fim do texto.
        observacoes_internas: observacao(p.observacoes_internas),
        observacoes_publicas: observacao(p.observacoes_publicas),
        ultima_devolucao: p.last_return_reason || p.last_return_notes
          ? { motivo: texto(p.last_return_reason, 300), anotacoes: observacao(p.last_return_notes) }
          : null,
        ...resumoItens(p.items_json),
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// listar_motoristas_veiculos: tudo que o formulário "Nova Rota / Romaneio" pede
// ---------------------------------------------------------------------------
const nomeDe = (rel: unknown): string | null => {
  const r = Array.isArray(rel) ? rel[0] : rel
  return texto((r as Json | null)?.name, 120)
}
const porNome = <T extends { nome: string | null }>(lista: T[]) =>
  lista.filter((x) => x.nome).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'))

async function listarMotoristasVeiculos(supa: SupabaseClient) {
  const [motoristasRes, veiculosRes, equipesRes, ajudantesRes, conferentesRes, romaneiosRes] = await Promise.all([
    supa.from('drivers').select('id, active, user:users!user_id(name)').eq('active', true).abortSignal(sinal()),
    supa.from('vehicles').select('id, plate, model, capacity, active').eq('active', true).abortSignal(sinal()),
    supa.from('teams_user')
      .select('id, name, driver:users!teams_user_driver_user_id_fkey(name), helper:users!teams_user_helper_user_id_fkey(name)')
      .eq('active', true).abortSignal(sinal()),
    supa.from('users').select('id, name').eq('role', 'helper').eq('active', true).abortSignal(sinal()),
    supa.from('users').select('id, name').eq('role', 'conferente').abortSignal(sinal()),
    supa.from('routes')
      .select('id, name, route_code, created_at, driver:drivers!driver_id(user:users!user_id(name)), route_orders(id)')
      .eq('status', 'pending')
      .not('name', 'ilike', 'RETIRADA%').not('name', 'like', 'COLETA-%')
      .order('created_at', { ascending: false }).limit(40).abortSignal(sinal()),
  ])
  for (const r of [motoristasRes, veiculosRes, equipesRes, ajudantesRes, conferentesRes, romaneiosRes]) {
    if (r.error) throw r.error
  }

  return {
    motoristas: porNome((motoristasRes.data || []).map((d: Json) => ({ nome: nomeDe(d.user) }))),
    ajudantes: porNome((ajudantesRes.data || []).map((u: Json) => ({ nome: texto(u.name, 120) }))),
    equipes: porNome((equipesRes.data || []).map((t: Json) => ({
      nome: texto(t.name, 120), motorista: nomeDe(t.driver), ajudante: nomeDe(t.helper),
    }))),
    veiculos: (veiculosRes.data || []).map((v: Json) => ({ placa: v.plate, modelo: v.model, capacidade: v.capacity ?? null })),
    conferentes: porNome((conferentesRes.data || []).map((u: Json) => ({ nome: texto(u.name, 120) }))),
    romaneios_em_separacao: (romaneiosRes.data || []).map((r: Json) => ({
      route_code: r.route_code,
      nome: r.name,
      motorista: nomeDe((Array.isArray(r.driver) ? r.driver[0] : (r.driver as Json | null))?.user),
      pedidos: Array.isArray(r.route_orders) ? r.route_orders.length : 0,
      criado_em: r.created_at,
    })),
  }
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
    observacoes: observacao(encontrada.observations),
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

export const FERRAMENTAS_LEITURA: Ferramenta[] = [
  {
    name: 'listar_pedidos_pendentes',
    description:
      'Lista os pedidos aguardando rota de entrega (mesma fila da tela Gestão de Entregas: pendentes ou devolvidos, sem bloqueio, fora de rota ativa, não retirados e com itens), do mais antigo para o mais novo. Traz observações internas e públicas completas e o motivo da última devolução: leia-os para achar restrições de data (ex.: "cliente só pode receber dia 25/11") antes de sugerir o pedido numa rota. Sem cidade, traz também o resumo de quantos pedidos há por cidade. Somente leitura.',
    inputSchema: {
      type: 'object',
      properties: {
        cidade: { type: 'string', description: 'Filtra pela cidade de entrega (ignora acento e maiúsculas). Ex.: "São Rafael".' },
        limite: { type: 'integer', minimum: 1, maximum: 200, default: 50, description: 'Quantos pedidos devolver (1 a 200).' },
      },
      additionalProperties: false,
    },
    somenteLeitura: true,
    executar: listarPedidosPendentes,
  },
  {
    name: 'listar_motoristas_veiculos',
    description: 'Lista tudo que o formulário de rota pede: motoristas, ajudantes, equipes (motorista + ajudante), veículos (placa, modelo, capacidade), conferentes e os romaneios ainda Em Separação (que podem receber mais pedidos). Use os nomes daqui em preparar_rota. Somente leitura.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    somenteLeitura: true,
    executar: (supa) => listarMotoristasVeiculos(supa),
  },
  {
    name: 'listar_rotas_cadastradas',
    description: 'Lista os nomes de rota cadastrados no catálogo (os únicos nomes válidos para criar uma rota de entrega). Somente leitura.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    somenteLeitura: true,
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
    somenteLeitura: true,
    executar: verRota,
  },
]
