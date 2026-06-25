export const CONTROLLED_STORE_RELEASE_LOCATIONS = [
  'ATACADO LOJA ASSU',
  'LOJA MOSSORO',
  'LOJA MOSSORO PARTAGE',
] as const;

export type ControlledStoreReleaseLocation = (typeof CONTROLLED_STORE_RELEASE_LOCATIONS)[number];
export type StoreReleaseOrderStatus = 'not_applicable' | 'pending' | 'partial' | 'released';

export function normalizeStoreReleaseLocation(value: string | null | undefined): string {
  const raw = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();

  if (!raw) return '';

  const plain = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (plain === 'ATACADO LOJA ASSU') return 'ATACADO LOJA ASSU';
  if (plain === 'LOJA MOSSORO') return 'LOJA MOSSORO';
  if (plain === 'LOJA MOSSORO PARTAGE') return 'LOJA MOSSORO PARTAGE';

  return raw;
}

export function isControlledStoreReleaseLocation(value: string | null | undefined): boolean {
  return CONTROLLED_STORE_RELEASE_LOCATIONS.includes(
    normalizeStoreReleaseLocation(value) as ControlledStoreReleaseLocation
  );
}

export function isTruthyStoreReleaseValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['sim', 's', 'true', '1', 'yes', 'y'].includes(normalized);
}

export function isStoreReleaseBlocked(
  order: {
    requires_store_release?: boolean | null;
    store_release_status?: string | null;
  },
  settings?: {
    enabled?: boolean;
  } | null
): boolean {
  if (!settings?.enabled) return false;
  return Boolean(order?.requires_store_release) && order?.store_release_status !== 'released';
}

export function getStoreReleaseStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'pending':
      return 'Aguardando liberacao';
    case 'partial':
      return 'Liberacao parcial';
    case 'released':
      return 'Liberado';
    default:
      return 'Nao se aplica';
  }
}
