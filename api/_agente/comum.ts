import type { SupabaseClient } from '@supabase/supabase-js'

// Peças comuns das ferramentas do agente (MCP do SolidGo).
// Privacidade: nunca devolver telefone, CPF ou endereço completo (só cidade/bairro).
// Telefones digitados dentro das observações também são mascarados.

export type Json = Record<string, unknown>

export type Contexto = {
  baseUrl: string       // ex.: https://solidgo.lojaodosmoveis.shop (para montar links)
  ator: string | null   // quem pediu ao agente (header x-mcp-actor), se vier
}

export type Ferramenta = {
  name: string
  description: string
  inputSchema: Json
  somenteLeitura: boolean
  executar: (supa: SupabaseClient, args: Json, ctx: Contexto) => Promise<unknown>
}

export class ErroFerramenta extends Error {}

export const TIMEOUT_MS = 10_000
export const sinal = () => AbortSignal.timeout(TIMEOUT_MS)

// "São Rafael" == "sao rafael" == "SAO RAFAEL"
export function normalizar(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

export function texto(valor: unknown, max = 300): string | null {
  const s = String(valor ?? '').trim()
  if (!s) return null
  return s.length > max ? `${s.slice(0, max)}…` : s
}

export function lerTexto(args: Json, campo: string): string | undefined {
  const v = args[campo]
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v !== 'string') throw new ErroFerramenta(`"${campo}" precisa ser texto.`)
  return v.trim()
}

export function lerLimite(args: Json, padrao: number, maximo: number): number {
  const v = args.limite
  if (v === undefined || v === null) return padrao
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1 || n > maximo) {
    throw new ErroFerramenta(`"limite" precisa ser um número inteiro entre 1 e ${maximo}.`)
  }
  return n
}

// O Supabase corta cada resposta em 1000 linhas sem avisar: busca página por página.
export const PAGINA = 1000
export async function buscarTudo(
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

export function emLotes<T>(lista: T[], tamanho: number): T[][] {
  const lotes: T[][] = []
  for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho))
  return lotes
}

export function resumoItens(itens: unknown): { quantidade_itens: number; produtos: string[] } {
  const lista = Array.isArray(itens) ? itens : []
  const produtos = lista
    .map((it) => texto((it as Json)?.name, 80))
    .filter((n): n is string => Boolean(n))
  return { quantidade_itens: lista.length, produtos: produtos.slice(0, 5) }
}

// "(84) 99814-4768" -> "(84) 9****-****". Datas (25/11/2026) e números de pedido
// (6 dígitos) não casam: o padrão exige 8 ou 9 dígitos com separador opcional.
export function mascararTelefones(valor: string): string {
  return valor.replace(/(?<!\d)(\(?\d{2}\)?[\s.-]?)?(9?)\d{4}[\s.-]?\d{4}\b/g, (_m, ddd: string | undefined, nove: string) =>
    `${ddd ?? ''}${nove}****-****`,
  )
}

export function observacao(valor: unknown, max = 1000): string | null {
  const t = texto(valor, max)
  return t ? mascararTelefones(t) : null
}
