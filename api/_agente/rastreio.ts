import type { SupabaseClient } from '@supabase/supabase-js'
import type { Json } from './comum.js'

// Tela "Ao vivo": posição dos celulares dos motoristas (Traccar Client) lida do
// Traccar Server na VPS. Não toca no PWA do motorista nem em nenhuma tabela de rota:
// só LÊ o Traccar e as rotas "Em Rota". O vínculo celular -> motorista fica em
// app_settings (key 'rastreio_vinculos'), porque o celular é do motorista, e o
// caminhão do dia sai da rota em andamento dele.
//
// Variáveis na Vercel:
//   TRACCAR_URL      ex.: https://traccar.lojaodosmoveis.shop
//   TRACCAR_USUARIO  e-mail do usuário "somente leitura" criado no Traccar
//   TRACCAR_SENHA    senha desse usuário
//   (ou TRACCAR_TOKEN, se preferir usar token em vez de usuário/senha)

const CHAVE_VINCULOS = 'rastreio_vinculos'

function base(): string {
  return (process.env.TRACCAR_URL || '').trim().replace(/\/+$/, '').replace(/\/api$/i, '')
}

function autorizacao(): string | null {
  const token = (process.env.TRACCAR_TOKEN || '').trim()
  if (token) return `Bearer ${token}`
  const usuario = (process.env.TRACCAR_USUARIO || '').trim()
  const senha = (process.env.TRACCAR_SENHA || '').trim()
  if (usuario && senha) return `Basic ${Buffer.from(`${usuario}:${senha}`).toString('base64')}`
  return null
}

export function traccarConfigurado(): boolean {
  return Boolean(base() && autorizacao())
}

async function traccar(caminho: string): Promise<any[]> {
  const resp = await fetch(`${base()}/api${caminho}`, {
    headers: { Authorization: autorizacao() || '', Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (resp.status === 401) throw new Error('O Traccar recusou o usuário/senha (TRACCAR_USUARIO / TRACCAR_SENHA).')
  if (!resp.ok) throw new Error(`O Traccar respondeu ${resp.status}.`)
  const json = await resp.json()
  return Array.isArray(json) ? json : []
}

async function lerVinculos(supa: SupabaseClient): Promise<Record<string, string>> {
  const { data } = await supa.from('app_settings').select('value').eq('key', CHAVE_VINCULOS).maybeSingle()
  const v = (data?.value as Json | undefined)?.vinculos
  return v && typeof v === 'object' ? { ...(v as Record<string, string>) } : {}
}

const nomeDe = (u: any): string => String((Array.isArray(u) ? u[0] : u)?.name || '')

export async function posicoesAoVivo(supa: SupabaseClient) {
  if (!traccarConfigurado()) {
    return { configurado: false, dispositivos: [], motoristas: [], atualizado_em: new Date().toISOString() }
  }

  const [dispositivos, posicoes, vinculos, motoristasRes, rotasRes] = await Promise.all([
    traccar('/devices'),
    traccar('/positions'),
    lerVinculos(supa),
    supa.from('drivers').select('id, active, user:users!user_id(name)').eq('active', true),
    supa.from('routes')
      .select('id, name, route_code, driver_id, updated_at, vehicle:vehicles!vehicle_id(plate, model), route_orders(status)')
      .eq('status', 'in_progress')
      .order('updated_at', { ascending: false })
      .limit(200),
  ])

  const motoristas = (motoristasRes.data || [])
    .map((d: any) => ({ id: String(d.id), nome: nomeDe(d.user) || 'Sem nome' }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  const nomeMotorista = new Map(motoristas.map((m) => [m.id, m.nome]))

  // Rota em andamento mais recente de cada motorista.
  const rotaDoMotorista = new Map<string, any>()
  for (const r of (rotasRes.data || []) as any[]) {
    const id = String(r.driver_id || '')
    if (id && !rotaDoMotorista.has(id)) rotaDoMotorista.set(id, r)
  }

  const posicaoDo = new Map<number, any>()
  for (const p of posicoes) posicaoDo.set(Number(p.deviceId), p)

  const lista = dispositivos.map((d: any) => {
    const p = posicaoDo.get(Number(d.id))
    const motoristaId = vinculos[String(d.id)] || null
    const rota = motoristaId ? rotaDoMotorista.get(motoristaId) : undefined
    const veiculo = rota ? (Array.isArray(rota.vehicle) ? rota.vehicle[0] : rota.vehicle) : null
    const itens: any[] = Array.isArray(rota?.route_orders) ? rota.route_orders : []
    const bateria = Number(p?.attributes?.batteryLevel)
    return {
      dispositivo_id: Number(d.id),
      dispositivo_nome: String(d.name || ''),
      online: d.status === 'online',
      ultimo_contato: d.lastUpdate || null,
      motorista_id: motoristaId,
      motorista_nome: motoristaId ? (nomeMotorista.get(motoristaId) || 'Motorista inativo') : null,
      posicao: p && Number.isFinite(Number(p.latitude)) ? {
        lat: Number(p.latitude),
        lng: Number(p.longitude),
        velocidade_kmh: Math.round(Number(p.speed || 0) * 1.852), // Traccar manda em nós
        direcao: Number(p.course || 0),
        horario: p.fixTime || p.deviceTime || null,
        bateria: Number.isFinite(bateria) ? Math.round(bateria) : null,
      } : null,
      rota: rota ? {
        id: String(rota.id),
        nome: String(rota.name || ''),
        codigo: String(rota.route_code || ''),
        veiculo: veiculo ? [veiculo.model, veiculo.plate].filter(Boolean).join(' · ') : null,
        entregues: itens.filter((i) => i.status === 'delivered').length,
        retornados: itens.filter((i) => i.status === 'returned').length,
        total: itens.length,
      } : null,
    }
  })

  return { configurado: true, dispositivos: lista, motoristas, atualizado_em: new Date().toISOString() }
}

export async function salvarVinculo(supa: SupabaseClient, dispositivoId: unknown, motoristaId: unknown) {
  const id = Number(dispositivoId)
  if (!Number.isInteger(id) || id <= 0) throw new Error('Celular inválido.')
  const vinculos = await lerVinculos(supa)
  const motorista = typeof motoristaId === 'string' && motoristaId.trim() ? motoristaId.trim() : null
  if (motorista) {
    const { data } = await supa.from('drivers').select('id').eq('id', motorista).maybeSingle()
    if (!data) throw new Error('Motorista não encontrado.')
    // Um motorista, um celular: tira o motorista de qualquer outro celular.
    for (const [k, v] of Object.entries(vinculos)) if (v === motorista) delete vinculos[k]
    vinculos[String(id)] = motorista
  } else {
    delete vinculos[String(id)]
  }
  const { error } = await supa.from('app_settings').upsert([{
    key: CHAVE_VINCULOS,
    value: { vinculos },
    updated_at: new Date().toISOString(),
  }])
  if (error) throw new Error(error.message)
  return { ok: true }
}
