import { describe, expect, it } from 'vitest';
import {
  buildLegacyReturnRows,
  isLegacyReturnRowId,
  legacyPickupOrderErpId,
  legacyPickupRouteName,
  legacyReturnRowId,
  normalizeReturnNfeNumber,
  type LegacyReturnOrder,
} from './legacyReturns';

const order = (over: Partial<LegacyReturnOrder> = {}): LegacyReturnOrder => ({
  id: 'o1',
  order_id_erp: '107013',
  customer_name: 'Cliente',
  filial_venda: '1',
  blocked_at: '2026-08-18T17:08:00Z',
  blocked_reason: 'Devolução - NF 78520',
  requires_pickup: true,
  pickup_created_at: null,
  return_nfe_number: '78520',
  return_date: '2026-08-18T17:08:00Z',
  created_at: '2026-04-01T10:00:00Z',
  ...over,
});

describe('normalizeReturnNfeNumber', () => {
  it('descarta o "undefined" que o n8n antigo gravava', () => {
    expect(normalizeReturnNfeNumber('undefined')).toBeNull();
    expect(normalizeReturnNfeNumber(' null ')).toBeNull();
    expect(normalizeReturnNfeNumber('')).toBeNull();
    expect(normalizeReturnNfeNumber(null)).toBeNull();
    expect(normalizeReturnNfeNumber(' 97821 ')).toBe('97821');
  });
});

describe('buildLegacyReturnRows', () => {
  it('coleta pendente do fluxo antigo vira linha da central', () => {
    const [row] = buildLegacyReturnRows([order()], new Set());
    expect(row.id).toBe(legacyReturnRowId('o1'));
    expect(isLegacyReturnRowId(row.id)).toBe(true);
    expect(row.isLegacy).toBe(true);
    expect(row.requires_pickup).toBe(true);
    expect(row.pickup_created_at).toBeNull();
    expect(row.order.order_id_erp).toBe('107013');
  });

  it('pedido que já tem evento processado sai daqui (não aparece duas vezes)', () => {
    expect(buildLegacyReturnRows([order()], new Set(['o1']))).toHaveLength(0);
  });

  it('pedido de coleta C- nunca é devolução', () => {
    expect(buildLegacyReturnRows([order({ id: 'c1', order_id_erp: 'C-107013' })], new Set())).toHaveLength(0);
  });

  it('sem bloqueio e sem coleta pendente não entra', () => {
    expect(buildLegacyReturnRows([order({ blocked_at: null, requires_pickup: false })], new Set())).toHaveLength(0);
  });

  it('coleta pendente entra mesmo sem data de bloqueio', () => {
    expect(buildLegacyReturnRows([order({ blocked_at: null })], new Set())).toHaveLength(1);
  });

  it('nota "undefined" não aparece como número de nota', () => {
    const [row] = buildLegacyReturnRows([order({ return_nfe_number: 'undefined' })], new Set());
    expect(row.return_nfe_number).toBeNull();
  });

  it('data da devolução cai pro bloqueio quando falta', () => {
    const [row] = buildLegacyReturnRows([order({ return_date: null })], new Set());
    expect(row.return_date).toBe('2026-08-18T17:08:00Z');
    expect(row.created_at).toBe('2026-08-18T17:08:00Z');
  });
});

describe('coleta do fluxo antigo', () => {
  it('usa o mesmo número do site antigo (C-<pedido>)', () => {
    expect(legacyPickupOrderErpId('107013', false)).toBe('C-107013');
  });

  it('segunda devolução do mesmo pedido ganha a data pra não colidir', () => {
    expect(legacyPickupOrderErpId('107013', true, '2026-08-18T17:08:00Z')).toBe('C-107013-20260818');
  });

  it('rota nunca se chama COLETA-undefined', () => {
    const d = new Date(2026, 8, 11, 12);
    expect(legacyPickupRouteName('undefined', '107013', d)).toBe('COLETA-107013-11092026');
    expect(legacyPickupRouteName('97821', '146043', d)).toBe('COLETA-97821-11092026');
  });
});
