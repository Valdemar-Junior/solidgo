import type { SupabaseClient } from '@supabase/supabase-js'
import type { Json } from './comum.js'

// WhatsApp via Evolution API. A chave da Evolution fica só aqui no servidor; o navegador
// fala com /api/agente?canal=admin&acao=wa_*, e a Evolution com /api/whatsapp/webhook.
//
// Variáveis na Vercel:
//   EVOLUTION_URL       ex.: https://evo.lojaodosmoveis.shop
//   EVOLUTION_API_KEY   token da instância (não a chave global AUTHENTICATION_API_KEY)
//   EVOLUTION_INSTANCE  ex.: lojao
//   WA_WEBHOOK_TOKEN    segredo do webhook, com pelo menos 32 caracteres

const LIMITE_MIDIA = 16 * 1024 * 1024

const EXTENSOES: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
  'video/mp4': 'mp4',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
}

const limpar = (s: string | undefined) => (s || '').trim()
const baseEvolution = () => limpar(process.env.EVOLUTION_URL).replace(/\/+$/, '')
const chaveEvolution = () => limpar(process.env.EVOLUTION_API_KEY)
export const instanciaWhatsapp = () => limpar(process.env.EVOLUTION_INSTANCE)
export const tokenWebhookWhatsapp = () => limpar(process.env.WA_WEBHOOK_TOKEN)

function whatsappConfigurado(): boolean {
  return Boolean(baseEvolution() && chaveEvolution() && instanciaWhatsapp() && tokenWebhookWhatsapp().length >= 32)
}

async function evolution(caminho: string, metodo: 'GET' | 'POST' | 'DELETE' = 'GET', corpo?: unknown, tempoMs = 15000) {
  const resp = await fetch(`${baseEvolution()}${caminho}`, {
    method: metodo,
    headers: { apikey: chaveEvolution(), 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(tempoMs),
  })
  const texto = await resp.text()
  let json: any = null
  try { json = texto ? JSON.parse(texto) : null } catch { /* resposta sem JSON */ }
  return { ok: resp.ok, status: resp.status, json }
}

function exigirSucesso(r: { ok: boolean; status: number }, acao: string) {
  if (r.status === 401 || r.status === 403) throw new Error('A Evolution recusou a chave (EVOLUTION_API_KEY).')
  if (!r.ok) throw new Error(`Não consegui ${acao}: a Evolution respondeu ${r.status}.`)
}

// ===========================================================================
// Telefone e conteúdo da mensagem
// ===========================================================================

// O WhatsApp guarda celulares antigos sem o 9º dígito. A conversa usa sempre a forma
// com o 9, para casar com o cadastro; para responder, vale o remote_jid original.
export function telefoneCanonico(numero: string): string {
  const d = numero.replace(/\D/g, '')
  return d.length === 12 && d.startsWith('55') && '6789'.includes(d[4]) ? `${d.slice(0, 4)}9${d.slice(4)}` : d
}

const digitosDoJid = (jid: string) => jid.split('@')[0].split(':')[0].replace(/\D/g, '')

// Conversa individual apenas. Com @lid o WhatsApp esconde o telefone: usa o número
// alternativo, se vier; senão a conversa fica identificada como 'lid:...'.
export function identificarContato(key: Json): { telefone: string; remote_jid: string } | null {
  const jid = String(key?.remoteJid ?? '')
  const dominio = jid.split('@')[1]
  if (dominio !== 's.whatsapp.net' && dominio !== 'lid') return null
  const digitos = digitosDoJid(jid)
  if (!digitos) return null
  if (dominio === 's.whatsapp.net') return { telefone: telefoneCanonico(digitos), remote_jid: jid }
  const alternativos = [key?.remoteJidAlt, key?.fromMe ? null : key?.senderPn].map((v) => String(v ?? ''))
  const real = alternativos.find((v) => v.endsWith('@s.whatsapp.net') && digitosDoJid(v))
  return { telefone: real ? telefoneCanonico(digitosDoJid(real)) : `lid:${digitos}`, remote_jid: jid }
}

type Conteudo = {
  tipo: 'texto' | 'imagem' | 'audio' | 'video' | 'documento' | 'localizacao' | 'outro'
  texto: string | null
  midia?: { tamanho: number }
  lat?: number
  lng?: number
  local_nome?: string | null
}

const SEM_CONTEUDO = new Set(['messageContextInfo', 'senderKeyDistributionMessage', 'base64', 'mediaUrl'])
const INVISIVEIS = new Set(['protocolMessage', 'reactionMessage', 'pollUpdateMessage'])
const EMBALAGENS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage']

const textoOuNulo = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
const tamanhoDe = (v: any) => Number(v?.low ?? v) || 0

export function extrairConteudo(mensagem: Json | null | undefined): Conteudo | null {
  let m: any = mensagem
  for (let i = 0; i < 4 && m; i++) {
    const embalagem = EMBALAGENS.find((k) => m[k]?.message)
    if (!embalagem) break
    m = m[embalagem].message
  }
  if (!m) return null
  const chaves = Object.keys(m).filter((k) => !SEM_CONTEUDO.has(k))
  if (chaves.length === 0 || chaves.some((k) => INVISIVEIS.has(k))) return null

  if (m.conversation) return { tipo: 'texto', texto: String(m.conversation) }
  if (m.extendedTextMessage) return { tipo: 'texto', texto: textoOuNulo(m.extendedTextMessage.text) }
  if (m.imageMessage) return { tipo: 'imagem', texto: textoOuNulo(m.imageMessage.caption), midia: { tamanho: tamanhoDe(m.imageMessage.fileLength) } }
  if (m.videoMessage) return { tipo: 'video', texto: textoOuNulo(m.videoMessage.caption), midia: { tamanho: tamanhoDe(m.videoMessage.fileLength) } }
  if (m.audioMessage) return { tipo: 'audio', texto: null, midia: { tamanho: tamanhoDe(m.audioMessage.fileLength) } }
  if (m.documentMessage) {
    return {
      tipo: 'documento',
      texto: textoOuNulo(m.documentMessage.caption) ?? textoOuNulo(m.documentMessage.fileName),
      midia: { tamanho: tamanhoDe(m.documentMessage.fileLength) },
    }
  }
  const local = m.locationMessage || m.liveLocationMessage
  if (local) {
    const lat = Number(local.degreesLatitude)
    const lng = Number(local.degreesLongitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { tipo: 'outro', texto: null }
    return { tipo: 'localizacao', texto: null, lat, lng, local_nome: textoOuNulo(local.name) ?? textoOuNulo(local.address) }
  }
  if (m.contactMessage) return { tipo: 'outro', texto: textoOuNulo(m.contactMessage.displayName) }
  return { tipo: 'outro', texto: null }
}

// ===========================================================================
// Webhook (chamado pela Evolution, já com o segredo conferido)
// ===========================================================================
async function guardarMidia(supa: SupabaseClient, instancia: string, conversaId: string, messageId: string, linhaId: string) {
  const r = await evolution(`/chat/getBase64FromMediaMessage/${encodeURIComponent(instancia)}`, 'POST',
    { message: { key: { id: messageId } }, convertToMp4: false }, 30000)
  if (!r.ok || typeof r.json?.base64 !== 'string') throw new Error(`Evolution respondeu ${r.status} ao baixar a mídia.`)

  const mimetype = String(r.json.mimetype || '').split(';')[0].trim().toLowerCase()
  const extensao = EXTENSOES[mimetype]
  if (!extensao) throw new Error(`Tipo de arquivo não permitido: ${mimetype || 'desconhecido'}.`)

  const arquivo = Buffer.from(r.json.base64.replace(/^data:[^,]*,/, ''), 'base64')
  if (arquivo.length === 0 || arquivo.length > LIMITE_MIDIA) throw new Error(`Arquivo fora do limite: ${arquivo.length} bytes.`)

  const caminho = `conversas/${conversaId}/${messageId.replace(/[^\w-]/g, '_')}.${extensao}`
  const envio = await supa.storage.from('wa-midia').upload(caminho, arquivo, { contentType: mimetype, upsert: true })
  if (envio.error) throw new Error(envio.error.message)

  const { error } = await supa.from('wa_mensagens').update({ midia_path: caminho, midia_mimetype: mimetype }).eq('id', linhaId)
  if (error) throw new Error(error.message)
}

async function receberMensagem(supa: SupabaseClient, instancia: string, dado: Json) {
  const key = (dado?.key || {}) as Json
  const messageId = String(key.id ?? '')
  const contato = identificarContato(key)
  const conteudo = extrairConteudo(dado?.message as Json)
  if (!messageId || !contato || !conteudo) return

  const deMim = key.fromMe === true
  const nome = deMim ? null : textoOuNulo(dado.pushName)
  const conversa = await supa.from('wa_conversas')
    .upsert({ telefone: contato.telefone, remote_jid: contato.remote_jid, ...(nome ? { nome_contato: nome } : {}) }, { onConflict: 'telefone' })
    .select('id').single()
  if (conversa.error) throw new Error(conversa.error.message)
  const conversaId = String(conversa.data.id)

  const segundos = Number((dado.messageTimestamp as any)?.low ?? dado.messageTimestamp)
  const gravada = await supa.from('wa_mensagens').upsert({
    conversa_id: conversaId,
    message_id: messageId,
    direcao: deMim ? 'out' : 'in',
    tipo: conteudo.tipo,
    texto: conteudo.texto,
    lat: conteudo.lat ?? null,
    lng: conteudo.lng ?? null,
    local_nome: conteudo.local_nome ?? null,
    autor: deMim ? 'celular' : 'cliente',
    status_envio: deMim ? 'sent' : null,
    enviada_em: new Date(segundos > 0 ? segundos * 1000 : Date.now()).toISOString(),
    chave: { ...key, messageType: dado.messageType ?? null },
  }, { onConflict: 'message_id', ignoreDuplicates: true }).select('id')
  if (gravada.error) throw new Error(gravada.error.message)
  if (!gravada.data?.length || !conteudo.midia) return // reenvio, ou mensagem sem arquivo

  if (conteudo.midia.tamanho > LIMITE_MIDIA) {
    console.warn('[whatsapp] mídia acima de 16 MB não foi guardada:', messageId)
    return
  }
  // A mensagem já está gravada: falha no arquivo não pode fazer perder o texto dela.
  try {
    await guardarMidia(supa, instancia, conversaId, messageId, String(gravada.data[0].id))
  } catch (e) {
    console.error('[whatsapp] mídia não guardada:', messageId, e instanceof Error ? e.message : e)
  }
}

// O status só anda para a frente: um aviso atrasado não desfaz "lida".
const ORDEM_STATUS = ['pending', 'sent', 'delivered', 'read']
const STATUS_WHATSAPP: Record<string, string> = {
  PENDING: 'pending', SERVER_ACK: 'sent', DELIVERY_ACK: 'delivered', READ: 'read', PLAYED: 'read', ERROR: 'failed',
}

async function atualizarStatus(supa: SupabaseClient, dado: Json) {
  const messageId = String(dado?.keyId ?? (dado?.key as Json | undefined)?.id ?? '')
  const status = STATUS_WHATSAPP[String(dado?.status ?? '').toUpperCase()]
  if (!messageId || !status) return
  const anteriores = status === 'failed' ? ORDEM_STATUS : ORDEM_STATUS.slice(0, ORDEM_STATUS.indexOf(status))
  if (anteriores.length === 0) return
  const { error } = await supa.from('wa_mensagens').update({ status_envio: status })
    .eq('message_id', messageId).eq('direcao', 'out').in('status_envio', anteriores)
  if (error) throw new Error(error.message)
}

async function gravarEstado(supa: SupabaseClient, instancia: string, estado: string, perfil?: { numero?: string | null; nome?: string | null }) {
  const atual = await supa.from('wa_instancia_status').select('estado, conectado_em').eq('instancia', instancia).maybeSingle()
  const agora = new Date().toISOString()
  const linha: Json = { instancia, estado, atualizado_em: agora }
  if (perfil?.numero) linha.numero = perfil.numero
  if (perfil?.nome) linha.nome_perfil = perfil.nome
  if (estado === 'open' && (atual.data?.estado !== 'open' || !atual.data?.conectado_em)) linha.conectado_em = agora
  const { error } = await supa.from('wa_instancia_status').upsert(linha as any, { onConflict: 'instancia' })
  if (error) throw new Error(error.message)
}

export async function processarWebhookWhatsapp(supa: SupabaseClient, corpo: Json) {
  const instancia = instanciaWhatsapp()
  if (String(corpo?.instance ?? '') !== instancia) return
  const evento = String(corpo?.event ?? '').toLowerCase().replace(/_/g, '.')
  const dados = (Array.isArray(corpo?.data) ? corpo.data : [corpo?.data]).filter(Boolean) as Json[]

  for (const dado of dados) {
    if (evento === 'messages.upsert') await receberMensagem(supa, instancia, dado)
    else if (evento === 'messages.update') await atualizarStatus(supa, dado)
    else if (evento === 'connection.update' && dado.state) {
      await gravarEstado(supa, instancia, String(dado.state), {
        numero: dado.wuid ? digitosDoJid(String(dado.wuid)) : null,
        nome: textoOuNulo(dado.profileName),
      })
    }
  }
}

// ===========================================================================
// Tela de conexão (só admin; o porteiro fica em api/agente.ts)
// ===========================================================================
const urlDoWebhook = (baseUrl: string) => `${baseUrl}/api/whatsapp/webhook?token=${encodeURIComponent(tokenWebhookWhatsapp())}`

async function ativarRecebimento(baseUrl: string) {
  const r = await evolution(`/webhook/set/${encodeURIComponent(instanciaWhatsapp())}`, 'POST', {
    webhook: {
      enabled: true,
      url: urlDoWebhook(baseUrl),
      byEvents: false, // com true a Evolution muda o endereço a cada tipo de evento
      base64: false,
      events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
    },
  })
  exigirSucesso(r, 'ativar o recebimento')
}

function hostDe(url: string): string | null {
  try { return new URL(url).host } catch { return null }
}

async function lerEstado(supa: SupabaseClient, baseUrl: string) {
  const instancia = encodeURIComponent(instanciaWhatsapp())
  const conexao = await evolution(`/instance/connectionState/${instancia}`)
  exigirSucesso(conexao, 'ler o estado do WhatsApp')
  const estado = String(conexao.json?.instance?.state ?? conexao.json?.state ?? 'close')

  const [perfis, webhook] = await Promise.all([
    estado === 'open' ? evolution(`/instance/fetchInstances?instanceName=${instancia}`).catch(() => null) : null,
    evolution(`/webhook/find/${instancia}`).catch(() => null),
  ])
  const perfil: any = Array.isArray(perfis?.json) ? perfis.json[0] : perfis?.json
  const dono = String(perfil?.ownerJid ?? perfil?.instance?.owner ?? '')
  const numero = dono ? digitosDoJid(dono) : null
  const nome = textoOuNulo(perfil?.profileName ?? perfil?.instance?.profileName)
  await gravarEstado(supa, instanciaWhatsapp(), estado, { numero, nome })

  const destino: any = webhook?.json?.webhook ?? webhook?.json
  const urlDestino = typeof destino?.url === 'string' ? destino.url : ''

  const [salvo, ultimas] = await Promise.all([
    supa.from('wa_instancia_status').select('numero, nome_perfil, conectado_em').eq('instancia', instanciaWhatsapp()).maybeSingle(),
    supa.from('wa_mensagens')
      .select('id, direcao, tipo, texto, midia_path, lat, lng, enviada_em, conversa:wa_conversas(telefone, nome_contato, remote_jid)')
      .order('enviada_em', { ascending: false }).limit(10),
  ])

  return {
    configurado: true,
    estado,
    numero: salvo.data?.numero ?? null,
    nome_perfil: salvo.data?.nome_perfil ?? null,
    conectado_em: salvo.data?.conectado_em ?? null,
    recebimento_ativo: destino?.enabled === true && urlDestino === urlDoWebhook(baseUrl),
    recebimento_endereco: urlDestino ? hostDe(urlDestino) : null, // só o domínio: o endereço completo tem o segredo
    ultimas: ultimas.data || [],
  }
}

function numeroParaParear(valor: unknown): string {
  const d = String(valor ?? '').replace(/\D/g, '')
  const completo = d.length === 10 || d.length === 11 ? `55${d}` : d
  if (completo.length < 12 || completo.length > 13 || !completo.startsWith('55')) {
    throw new Error('Número inválido. Digite com DDD, por exemplo 84 99999-9999.')
  }
  return completo
}

export async function acaoWhatsapp(supa: SupabaseClient, acao: string, metodo: string, corpo: Json, baseUrl: string): Promise<Json> {
  // A faixa vermelha lê só o banco, para não consultar a Evolution em toda tela.
  if (acao === 'wa_faixa' && metodo === 'GET') {
    const { data } = await supa.from('wa_instancia_status').select('estado').eq('instancia', instanciaWhatsapp()).maybeSingle()
    return { desconectado: data?.estado === 'close' }
  }
  if (!whatsappConfigurado()) {
    if (acao === 'wa_estado' && metodo === 'GET') return { configurado: false }
    throw new Error('WhatsApp ainda não configurado na Vercel.')
  }

  const instancia = encodeURIComponent(instanciaWhatsapp())
  if (acao === 'wa_estado' && metodo === 'GET') return lerEstado(supa, baseUrl)

  if (metodo === 'POST') {
    if (acao === 'wa_ativar_recebimento') {
      await ativarRecebimento(baseUrl)
      return { ok: true }
    }
    if (acao === 'wa_qr' || acao === 'wa_parear') {
      await ativarRecebimento(baseUrl) // assim a mensagem que chegar logo após conectar já é gravada
      const numero = acao === 'wa_parear' ? `?number=${numeroParaParear(corpo.numero)}` : ''
      const r = await evolution(`/instance/connect/${instancia}${numero}`)
      exigirSucesso(r, 'gerar a conexão')
      return { base64: r.json?.base64 ?? null, pairingCode: r.json?.pairingCode ?? null }
    }
    if (acao === 'wa_reiniciar') {
      exigirSucesso(await evolution(`/instance/restart/${instancia}`, 'POST'), 'reiniciar')
      return { ok: true }
    }
    if (acao === 'wa_desconectar') {
      const r = await evolution(`/instance/logout/${instancia}`, 'DELETE')
      if (r.status !== 400) exigirSucesso(r, 'desconectar') // 400 = já estava desconectada
      await gravarEstado(supa, instanciaWhatsapp(), 'close')
      return { ok: true }
    }
  }
  throw new Error('Ação desconhecida.')
}
