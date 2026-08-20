import { supabase } from '../../supabase/client';

/**
 * Lê a chave "exigir 2FA para administradores" das configurações (app_settings).
 * Default: desligado. É a "chave liga/desliga" que o admin controla nas Configurações.
 */
export async function getRequireAdmin2fa(): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'require_admin_2fa')
      .maybeSingle();
    return (data as any)?.value?.enabled === true;
  } catch {
    // Em erro/offline, não bloqueia o login (fail-open no gate; a segurança real
    // depende do 2FA estar ligado + fator cadastrado).
    return false;
  }
}

// "Confiar neste dispositivo": depois de confirmar o código, este computador fica
// confiável por um tempo — nele, o 2FA não é pedido de novo (a SENHA continua sendo
// pedida sempre). Padrão usual e equilibrado: 1 dia (24h). Mude aqui se quiser.
const TRUST_DEVICE_HOURS = 24;
const trustKey = (userId: string) => `2fa_trusted_until_${userId}`;

export function trustThisDevice(userId: string): void {
  try {
    localStorage.setItem(trustKey(userId), String(Date.now() + TRUST_DEVICE_HOURS * 60 * 60 * 1000));
  } catch {
    // ignore (ex.: storage indisponível)
  }
}

export function isDeviceTrusted(userId: string): boolean {
  try {
    const until = Number(localStorage.getItem(trustKey(userId)) || 0);
    return until > Date.now();
  } catch {
    return false;
  }
}

export type TwoFactorStatus = 'satisfied' | 'needs_verify' | 'needs_enroll';

/**
 * Estado do 2FA do usuário atual, via nível de garantia (AAL) do Supabase.
 * - 'satisfied':    já passou pelo 2FA nesta sessão (aal2).
 * - 'needs_verify': tem um fator cadastrado, mas precisa digitar o código agora.
 * - 'needs_enroll': ainda não cadastrou o celular (precisa ativar o 2FA).
 */
export async function getTwoFactorStatus(): Promise<TwoFactorStatus> {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) return 'satisfied';
    if (data.currentLevel === 'aal2') return 'satisfied';
    if (data.nextLevel === 'aal2') return 'needs_verify';
    return 'needs_enroll';
  } catch {
    return 'satisfied';
  }
}
