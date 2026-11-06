import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ErroFerramenta, lerTexto, normalizar, observacao, resumoItens, sinal, texto,
  type Contexto, type Ferramenta, type Json,
} from './comum.js'

// Fase 2: preparar rota com APROVAÇÃO HUMANA.
// preparar_rota confere tudo igual à tela (RouteCreation.tsx / createRoute), monta a
// prévia e grava SÓ a proposta em agente_aprovacoes. A rota só nasce quando um admin
// logado clica Confirmar no SolidGo (função agente_aprovar_rota no banco).

const MAX_PEDIDOS = 60
const VALIDADE_HORAS = 12

// Frases que costumam indicar que o pedido não pode sair em qualquer dia.
const FRASES_RESTRICAO = [
  'so pode receber', 'nao pode receber', 'so recebe', 'nao entregar', 'nao enviar',
  'aguardar', 'vai avisar', 'avisar quando', 'avisa quando', 'depois do dia', 'a partir do dia',
  'apos o dia', 'final do mes', 'inicio do mes', 'esperar', 'segurar', 'nao esta em casa', 'viajando',
]

// ---------------------------------------------------------------------------
// Resolução de nomes: exato (sem acento) -> único parcial -> erro com candidatos.
// Nunca escolhe no chute.
// ---------------------------------------------------------------------------
export function resolverPorNome<T>(
  lista: T[], chave: (x: T) => string, procurado: string, oQue: string,
): T {
  const alvo = normalizar(procurado)
  const exatos = lista.filter((x) => normalizar(chave(x)) === alvo)
  if (exatos.length === 1) return exatos[0]
  const parciais = exatos.length > 1 ? exatos : lista.filter((x) => normalizar(chave(x)).includes(alvo))
  if (parciais.length === 1) return parciais[0]
  if (parciais.length === 0) {
    throw new ErroFerramenta(`${oQue} "${procurado}" não encontrado. Consulte listar_motoristas_veiculos / listar_rotas_cadastradas.`)
  }
  const nomes = parciais.slice(0, 10).map(chave).join(', ')
  throw new ErroFerramenta(`${oQue} "${procurado}" é ambíguo. Pergunte ao usuário qual destes: ${nomes}.`)
}

const nomeRel = (rel: unknown): string => {
  const r = Array.isArray(rel) ? rel[0] : rel
  return String((r as Json | null)?.name ?? '').trim()
}

// "07/11/2026", "7/11", "2026-11-07" -> "2026-11-07" (ano atual se faltar)
export function lerData(valor: string | undefined): string | null {
  if (!valor) return null
  const v = valor.trim()
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = v.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
  if (m) {
    const anoAtual = new Date().getFullYear()
    const ano = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : String(anoAtual)
    return `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  throw new ErroFerramenta('"data_entrega" precisa estar no formato DD/MM/AAAA.')
}
const dataBR = (iso: string) => iso.split('-').reverse().join('/')

// Avisos (não bloqueiam): datas citadas na observação diferentes da entrega
// planejada, e frases de restrição. A IA lê também; isto é a segunda conferência.
export function avisosDoPedido(textos: (string | null)[], dataEntrega: string | null): string[] {
  const avisos: string[] = []
  const tudo = textos.filter(Boolean).join(' | ')
  if (!tudo) return avisos
  const plano = normalizar(tudo)

  const datas = new Set<string>()
  for (const m of tudo.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const dia = Number(m[1]); const mes = Number(m[2])
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) continue
    datas.add(`${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`)
  }
  if (datas.size > 0) {
    const entrega = dataEntrega ? dataBR(dataEntrega).slice(0, 5) : null
    const diferentes = [...datas].filter((d) => d !== entrega)
    if (diferentes.length > 0) {
      avisos.push(entrega
        ? `Observação cita a data ${diferentes.join(', ')}, mas a entrega planejada é ${entrega}.`
        : `Observação cita a data ${diferentes.join(', ')}. Confira antes de mandar.`)
    }
  }
  const frases = FRASES_RESTRICAO.filter((f) => plano.includes(f))
  if (frases.length > 0) avisos.push(`Observação com possível restrição ("${frases.join('", "')}").`)
  return avisos
}

// ---------------------------------------------------------------------------
// Confere cada pedido com a MESMA regra da fila da tela.
// ---------------------------------------------------------------------------
type PedidoOk = { id: string; erp: string; cliente: string | null; cidade: string | null; bairro: string | null; produtos: string[]; avisos: string[] }
type PedidoFora = { order_id_erp: string; motivo: string }

async function conferirPedidos(supa: SupabaseClient, erps: string[], dataEntrega: string | null) {
  const { data: linhas, error } = await supa
    .from('orders')
    .select('id, order_id_erp, customer_name, address_json, items_json, status, blocked_at, blocked_reason, observacoes_internas, observacoes_publicas, last_return_reason, last_return_notes, requires_store_release, store_release_status')
    .in('order_id_erp', erps)
    .abortSignal(sinal())
  if (error) throw error
  const pedidos = (linhas || []) as Json[]
  const ids = pedidos.map((p) => String(p.id))

  const [travasRes, retiradasRes, liberacaoRes] = await Promise.all([
    ids.length
      ? supa.from('route_orders').select('order_id, route:routes!inner(status, route_code)').in('order_id', ids).neq('route.status', 'completed').abortSignal(sinal())
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supa.from('order_withdrawals').select('order_id').in('order_id', ids).abortSignal(sinal())
      : Promise.resolve({ data: [], error: null }),
    supa.from('app_settings').select('value').eq('key', 'store_release_control').maybeSingle(),
  ])
  if (travasRes.error) throw travasRes.error
  if (retiradasRes.error) throw retiradasRes.error
  const emRota = new Map<string, string>()
  for (const r of (travasRes.data || []) as Json[]) {
    const rota = (Array.isArray(r.route) ? r.route[0] : r.route) as Json | null
    emRota.set(String(r.order_id), String(rota?.route_code ?? 'outra rota'))
  }
  const retirados = new Set(((retiradasRes.data || []) as Json[]).map((r) => String(r.order_id)))
  const controleLoja = ((liberacaoRes.data as Json | null)?.value as Json | null)?.enabled === true

  const ok: PedidoOk[] = []
  const fora: PedidoFora[] = []
  for (const erp of erps) {
    const doErp = pedidos.filter((p) => String(p.order_id_erp) === erp)
    if (doErp.length === 0) { fora.push({ order_id_erp: erp, motivo: 'Pedido não encontrado no SolidGo.' }); continue }
    let algumOk = false
    const motivos: string[] = []
    for (const p of doErp) {
      const id = String(p.id)
      const itens = Array.isArray(p.items_json) ? p.items_json : []
      let motivo: string | null = null
      if (emRota.has(id)) motivo = `Já está na rota ${emRota.get(id)}.`
      else if (p.blocked_at) motivo = `Bloqueado${p.blocked_reason ? `: ${texto(p.blocked_reason, 120)}` : '.'}`
      else if (!['pending', 'returned'].includes(String(p.status))) motivo = p.status === 'delivered' ? 'Já foi entregue.' : `Não está aguardando rota (status ${p.status}).`
      else if (retirados.has(id)) motivo = 'Já foi retirado pelo cliente.'
      else if (itens.length === 0) motivo = 'Pedido sem itens.'
      else if (controleLoja && p.requires_store_release && p.store_release_status !== 'released') motivo = 'Aguardando liberação de saída da loja.'
      if (motivo) { motivos.push(motivo); continue }
      algumOk = true
      const endereco = (p.address_json as Json | null) || {}
      ok.push({
        id,
        erp,
        cliente: texto(p.customer_name, 120),
        cidade: texto(endereco.city, 80),
        bairro: texto(endereco.neighborhood, 80),
        produtos: resumoItens(p.items_json).produtos,
        avisos: avisosDoPedido(
          [observacao(p.observacoes_internas), observacao(p.observacoes_publicas), observacao(p.last_return_notes)],
          dataEntrega,
        ),
      })
    }
    if (!algumOk) fora.push({ order_id_erp: erp, motivo: [...new Set(motivos)].join(' ') })
  }
  return { ok, fora }
}

// ---------------------------------------------------------------------------
// preparar_rota
// ---------------------------------------------------------------------------
async function prepararRota(supa: SupabaseClient, args: Json, ctx: Contexto) {
  const { data: config } = await supa.from('agente_config').select('permite_criar_rota').eq('id', true).maybeSingle()
  if (config && config.permite_criar_rota === false) {
    throw new ErroFerramenta('Criar rota pelo agente está DESLIGADO nas configurações do SolidGo (Agente IA).')
  }

  const brutos = args.pedidos
  if (!Array.isArray(brutos) || brutos.length === 0) throw new ErroFerramenta('Informe "pedidos": a lista de números de pedido (order_id_erp).')
  const erps = [...new Set(brutos.map((x) => String(x ?? '').trim()).filter(Boolean))]
  if (erps.length > MAX_PEDIDOS) throw new ErroFerramenta(`No máximo ${MAX_PEDIDOS} pedidos por rota.`)

  const romaneio = lerTexto(args, 'romaneio_existente')
  const dataEntrega = lerData(lerTexto(args, 'data_entrega'))
  const obsLivre = lerTexto(args, 'observacoes') ?? ''
  if (obsLivre.length > 1000) throw new ErroFerramenta('"observacoes" com no máximo 1000 caracteres.')

  const avisosGerais: string[] = []
  let tipo: 'nova_rota' | 'adicionar_em_rota'
  let dados: Json
  let cabecalho: Json

  if (romaneio) {
    // Adicionar pedidos a um romaneio que ainda está Em Separação.
    const { data: rotas, error } = await supa.from('routes')
      .select('id, name, route_code, status, driver:drivers!driver_id(user:users!user_id(name)), route_orders(id)')
      .ilike('route_code', romaneio.replace(/[%_]/g, '')).limit(1).abortSignal(sinal())
    if (error) throw error
    const rota = (rotas || [])[0] as Json | undefined
    if (!rota) throw new ErroFerramenta(`Romaneio "${romaneio}" não encontrado. Use o código RE-DDMMYY-XXX.`)
    if (rota.status !== 'pending') throw new ErroFerramenta(`O romaneio ${rota.route_code} não está mais Em Separação.`)
    const nome = String(rota.name ?? '').toUpperCase()
    if (nome.startsWith('RETIRADA') || nome.startsWith('COLETA-')) throw new ErroFerramenta('Esse romaneio não é de entrega.')
    for (const campo of ['rota_cadastrada', 'equipe', 'motorista', 'ajudante', 'veiculo', 'conferente']) {
      if (args[campo]) avisosGerais.push(`"${campo}" foi ignorado: ao adicionar num romaneio existente, a equipe dele não muda.`)
    }
    tipo = 'adicionar_em_rota'
    dados = { route_id: rota.id }
    const drv = (Array.isArray(rota.driver) ? rota.driver[0] : rota.driver) as Json | null
    cabecalho = {
      romaneio: rota.route_code, rota: rota.name, motorista: nomeRel(drv?.user) || null,
      pedidos_que_ja_estao: Array.isArray(rota.route_orders) ? rota.route_orders.length : 0,
    }
  } else {
    const rotaNome = lerTexto(args, 'rota_cadastrada')
    const veiculoTxt = lerTexto(args, 'veiculo')
    const conferenteTxt = lerTexto(args, 'conferente')
    const equipeTxt = lerTexto(args, 'equipe')
    const motoristaTxt = lerTexto(args, 'motorista')
    const ajudanteTxt = lerTexto(args, 'ajudante')
    const faltando = [
      !rotaNome && 'rota_cadastrada', !veiculoTxt && 'veiculo', !conferenteTxt && 'conferente',
      !motoristaTxt && !equipeTxt && 'motorista (ou equipe)',
    ].filter(Boolean)
    if (faltando.length) throw new ErroFerramenta(`Faltam campos obrigatórios da tela de rota: ${faltando.join(', ')}. Pergunte ao usuário.`)

    const [catRes, motRes, veiRes, confRes, ajuRes, eqRes] = await Promise.all([
      supa.from('delivery_route_catalog').select('id, name').eq('active', true).abortSignal(sinal()),
      supa.from('drivers').select('id, user_id, user:users!user_id(name)').eq('active', true).abortSignal(sinal()),
      supa.from('vehicles').select('id, plate, model').eq('active', true).abortSignal(sinal()),
      supa.from('users').select('id, name').eq('role', 'conferente').abortSignal(sinal()),
      supa.from('users').select('id, name').eq('role', 'helper').eq('active', true).abortSignal(sinal()),
      supa.from('teams_user').select('id, name, driver_user_id, helper_user_id').eq('active', true).abortSignal(sinal()),
    ])
    for (const r of [catRes, motRes, veiRes, confRes, ajuRes, eqRes]) if (r.error) throw r.error
    const motoristas = (motRes.data || []) as Json[]
    const ajudantes = (ajuRes.data || []) as Json[]

    const cat = resolverPorNome((catRes.data || []) as Json[], (x) => String(x.name), rotaNome!, 'Rota cadastrada')
    const veiculo = resolverPorNome(
      (veiRes.data || []) as Json[],
      // placa com e sem hífen + modelo: "TSW-0H64", "tsw0h64" e "Saveiro" casam
      (x) => `${String(x.plate ?? '')} ${String(x.plate ?? '').replace(/[-\s]/g, '')} ${String(x.model ?? '')}`,
      veiculoTxt!, 'Veículo',
    )
    const conf = resolverPorNome((confRes.data || []) as Json[], (x) => String(x.name), conferenteTxt!, 'Conferente')

    let equipe: Json | null = null
    let motorista: Json | null = null
    let ajudante: Json | null = null
    if (equipeTxt) {
      equipe = resolverPorNome((eqRes.data || []) as Json[], (x) => String(x.name), equipeTxt, 'Equipe')
      motorista = motoristas.find((d) => String(d.user_id) === String(equipe!.driver_user_id)) ?? null
      if (equipe.helper_user_id) {
        ajudante = ajudantes.find((u) => String(u.id) === String(equipe!.helper_user_id))
          ?? { id: equipe.helper_user_id, name: '(ajudante da equipe)' }
      }
    }
    if (motoristaTxt) {
      const escolhido = resolverPorNome(motoristas, (x) => nomeRel(x.user), motoristaTxt, 'Motorista')
      if (motorista && String(motorista.id) !== String(escolhido.id)) {
        avisosGerais.push(`Motorista informado (${nomeRel(escolhido.user)}) é diferente do motorista da equipe; vale o informado.`)
      }
      motorista = escolhido
    }
    if (!motorista) throw new ErroFerramenta('A equipe não tem motorista ativo. Informe "motorista".')
    if (ajudanteTxt) ajudante = resolverPorNome(ajudantes, (x) => String(x.name), ajudanteTxt, 'Ajudante')

    const observacoes = [dataEntrega ? `Entrega prevista: ${dataBR(dataEntrega)}.` : '', obsLivre].filter(Boolean).join(' ')
    tipo = 'nova_rota'
    dados = {
      route_name: String(cat.name).trim(),
      driver_id: motorista.id,
      vehicle_id: veiculo.id,
      conferente_id: conf.id,
      conferente_nome: conf.name,
      team_id: equipe?.id ?? null,
      helper_id: ajudante?.id ?? null,
      observations: observacoes || null,
    }
    cabecalho = {
      rota: cat.name,
      equipe: equipe?.name ?? null,
      motorista: nomeRel(motorista.user),
      ajudante: ajudante ? String(ajudante.name) : null,
      veiculo: `${veiculo.plate} ${veiculo.model ?? ''}`.trim(),
      conferente: conf.name,
      observacoes: observacoes || null,
    }
  }

  const { ok, fora } = await conferirPedidos(supa, erps, dataEntrega)
  if (ok.length === 0) {
    return { criado: false, motivo: 'Nenhum pedido pode entrar na rota.', pedidos_fora: fora }
  }

  const resumo = {
    tipo,
    ...cabecalho,
    data_entrega: dataEntrega ? dataBR(dataEntrega) : null,
    pedidos: ok.map(({ id: _id, ...p }) => ({ order_id_erp: p.erp, cliente: p.cliente, cidade: p.cidade, bairro: p.bairro, produtos: p.produtos, avisos: p.avisos })),
    pedidos_fora: fora,
    avisos_gerais: avisosGerais,
  }

  const expira = new Date(Date.now() + VALIDADE_HORAS * 3600_000).toISOString()
  const { data: ap, error: erroAp } = await supa.from('agente_aprovacoes')
    .insert({ tipo, dados: { ...dados, order_ids: ok.map((p) => p.id) }, resumo, pedido_por: ctx.ator, expira_em: expira })
    .select('id').single()
  if (erroAp) throw erroAp

  return {
    aprovacao_id: ap.id,
    link_para_aprovar: `${ctx.baseUrl}/admin/agente/aprovar/${ap.id}`,
    expira_em: expira,
    resumo,
    instrucao_para_o_agente:
      'NADA foi gravado ainda. Mostre ao usuário o resumo (inclusive pedidos_fora e avisos) e o link_para_aprovar. ' +
      'A rota só é criada quando um admin abrir o link no SolidGo e clicar em Confirmar. ' +
      'Depois, use consultar_aprovacao para saber se foi aprovada e qual o código da rota.',
  }
}

// ---------------------------------------------------------------------------
// consultar_aprovacao
// ---------------------------------------------------------------------------
async function consultarAprovacao(supa: SupabaseClient, args: Json) {
  const id = lerTexto(args, 'aprovacao_id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new ErroFerramenta('Informe "aprovacao_id" (o id devolvido por preparar_rota).')
  const { data, error } = await supa.from('agente_aprovacoes')
    .select('id, status, criado_em, expira_em, decidido_em, route_code, erro, resumo')
    .eq('id', id).abortSignal(sinal()).maybeSingle()
  if (error) throw error
  if (!data) throw new ErroFerramenta('Proposta não encontrada.')
  const expirada = data.status === 'pendente' && new Date(String(data.expira_em)) < new Date()
  return {
    status: expirada ? 'expirada' : data.status,
    route_code: data.route_code,
    erro: data.erro,
    criado_em: data.criado_em,
    decidido_em: data.decidido_em,
    rota: (data.resumo as Json | null)?.rota ?? null,
  }
}

export const FERRAMENTAS_ROTA: Ferramenta[] = [
  {
    name: 'preparar_rota',
    description:
      'Prepara uma rota de entrega (ou adiciona pedidos num romaneio Em Separação) e devolve a PRÉVIA e um link de aprovação. ' +
      'NÃO grava a rota: ela só é criada quando um admin clica Confirmar no SolidGo. Confere as mesmas regras da tela ' +
      '(pedido bloqueado, já em rota, retirado, sem itens, aguardando liberação da loja) e aponta avisos de data/restrição nas observações. ' +
      'Para rota NOVA são obrigatórios: rota_cadastrada, veiculo, conferente e motorista (ou equipe). ' +
      'Antes, pergunte ao usuário o dia da entrega e use data_entrega. Use os nomes de listar_motoristas_veiculos e listar_rotas_cadastradas.',
    inputSchema: {
      type: 'object',
      properties: {
        pedidos: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: MAX_PEDIDOS, description: 'Números dos pedidos (order_id_erp), na ordem de entrega desejada.' },
        rota_cadastrada: { type: 'string', description: 'Nome do catálogo (ex.: "SÃO RAFAEL"). Obrigatório para rota nova.' },
        romaneio_existente: { type: 'string', description: 'Código RE-DDMMYY-XXX de um romaneio Em Separação, para ADICIONAR pedidos nele em vez de criar rota nova.' },
        equipe: { type: 'string', description: 'Nome da equipe (preenche motorista e ajudante).' },
        motorista: { type: 'string', description: 'Nome do motorista.' },
        ajudante: { type: 'string', description: 'Nome do ajudante (opcional).' },
        veiculo: { type: 'string', description: 'Placa ou modelo do veículo. Obrigatório para rota nova.' },
        conferente: { type: 'string', description: 'Nome do conferente. Obrigatório para rota nova.' },
        observacoes: { type: 'string', description: 'Observações da rota (opcional).' },
        data_entrega: { type: 'string', description: 'Dia planejado da entrega, DD/MM/AAAA. Usado para conferir as observações e anotado na rota.' },
      },
      required: ['pedidos'],
      additionalProperties: false,
    },
    somenteLeitura: false,
    executar: prepararRota,
  },
  {
    name: 'consultar_aprovacao',
    description: 'Diz se uma rota preparada já foi aprovada (e o código RE-... dela), recusada, expirada ou deu erro. Somente leitura.',
    inputSchema: {
      type: 'object',
      properties: { aprovacao_id: { type: 'string', description: 'Id devolvido por preparar_rota.' } },
      required: ['aprovacao_id'],
      additionalProperties: false,
    },
    somenteLeitura: true,
    executar: (supa, args) => consultarAprovacao(supa, args),
  },
]
