export function normalizeStatus(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function normalizeEnvironment(value: unknown) {
  const normalized = normalizeStatus(value);
  if (normalized === 'production' || normalized === 'producao') return 'production';
  return 'homologation';
}

export function getFocusToken(environment: 'production' | 'homologation') {
  return environment === 'production'
    ? Deno.env.get('FOCUS_NFE_PRODUCTION_TOKEN') || Deno.env.get('FOCUS_NFE_TOKEN')
    : Deno.env.get('FOCUS_NFE_HOMOLOGATION_TOKEN') || Deno.env.get('FOCUS_NFE_TOKEN');
}

export function getFocusBaseUrl(environment: 'production' | 'homologation') {
  const specificBaseUrl =
    environment === 'production'
      ? Deno.env.get('FOCUS_NFE_PRODUCTION_BASE_URL')?.trim()
      : Deno.env.get('FOCUS_NFE_HOMOLOGATION_BASE_URL')?.trim();

  if (specificBaseUrl) {
    return specificBaseUrl.replace(/\/$/, '');
  }

  return environment === 'production'
    ? 'https://api.focusnfe.com.br'
    : 'https://homologacao.focusnfe.com.br';
}

export function safeJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function resolveFocusUserMessage(payload: any) {
  return (
    payload?.mensagem_sefaz ||
    payload?.mensagem ||
    payload?.message ||
    payload?.descricao ||
    null
  );
}

export function resolveFocusMessage(payload: any) {
  return (
    payload?.mensagem_sefaz ||
    payload?.mensagem ||
    payload?.message ||
    payload?.descricao ||
    payload?.status_sefaz ||
    payload?.codigo_status ||
    null
  );
}

export function mapFocusMdfeStatus(
  payload: any,
  fallbackStatus?: 'draft' | 'processing' | 'issued' | 'closed' | 'cancelled' | 'error' | null
) {
  const status = normalizeStatus(
    payload?.status ||
      payload?.situacao ||
      payload?.descricao_status ||
      payload?.mensagem_sefaz ||
      payload?.mensagem ||
      payload?.message ||
      payload?.codigo_status ||
      payload?.status_sefaz
  );

  const sefazCode = String(
    payload?.status_sefaz ?? payload?.codigo_status ?? payload?.cStat ?? payload?.cstat ?? ''
  ).trim();

  if (
    status.includes('erro') ||
    status.includes('rejei') ||
    status.includes('deneg') ||
    status.includes('nao autoriz')
  ) {
    return 'error';
  }

  if (status.includes('encerr')) return 'closed';
  if (status.includes('cancel')) return 'cancelled';
  if (status.includes('process')) return 'processing';
  if (status.includes('autoriz') || sefazCode === '100') return 'issued';

  if (sefazCode) {
    if (fallbackStatus === 'closed') return 'closed';
    if (fallbackStatus === 'cancelled') return 'cancelled';
    if (sefazCode !== '100') return 'error';
  }

  return fallbackStatus || null;
}
