import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function slugifyName(name: string) {
  const s = String(name || '').toLowerCase().trim()
  const noAccents = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return noAccents.replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '')
}

export function toLoginEmailFromName(name: string) {
  const slug = slugifyName(name)
  return `${slug || 'usuario' }@solidgo.local`
}

/** Mantém só os dígitos do CPF (remove pontos, traço e espaços). */
export function onlyDigits(value: string) {
  return String(value || '').replace(/\D/g, '')
}

/** Formata para exibição: 000.000.000-00 (parcial enquanto digita). */
export function formatCpf(value: string) {
  const d = onlyDigits(value).slice(0, 11)
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4')
}

/** Valida CPF com dígitos verificadores. Vazio é considerado inválido — trate o "opcional" antes. */
export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value)
  if (cpf.length !== 11) return false
  if (/^(\d)\1{10}$/.test(cpf)) return false // todos os dígitos iguais (ex.: 00000000000)

  const digit = (factorStart: number, length: number) => {
    let sum = 0
    for (let i = 0; i < length; i++) sum += parseInt(cpf[i], 10) * (factorStart - i)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }

  return digit(10, 9) === parseInt(cpf[9], 10) && digit(11, 10) === parseInt(cpf[10], 10)
}
