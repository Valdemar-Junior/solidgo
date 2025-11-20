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
