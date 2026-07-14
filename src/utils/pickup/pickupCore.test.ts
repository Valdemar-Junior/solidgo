import { describe, it, expect } from 'vitest';
import { pickupItemKey, pickupHoldMatchesItem, buildPickupHoldPayload } from './pickupMatch';
import type { OrderItemHold } from '../../types/database';

// Casamento item<->hold é a peça crítica: casar errado esconde/entrega o item errado.
const hold = (over: Partial<OrderItemHold> = {}): Partial<OrderItemHold> => ({
  source_line_key: null, sku: null, storage_location: null, status: 'picked_up', ...over,
});

describe('pickupItemKey — chave estável do item', () => {
  it('normaliza (lowercase/trim) e combina source_line_key|sku|local', () => {
    expect(pickupItemKey({ source_line_key: 'ITEM:X', sku: 'Sku1', location: 'Loja A' }))
      .toBe('item:x|sku1|loja a');
  });
  it('usa storage_location quando não há location', () => {
    expect(pickupItemKey({ sku: 'A', storage_location: 'DEP' })).toBe('|a|dep');
  });
  it('itens de mesmo sku em locais diferentes têm chaves diferentes', () => {
    expect(pickupItemKey({ sku: 'A', location: 'L1' }))
      .not.toBe(pickupItemKey({ sku: 'A', location: 'L2' }));
  });
});

describe('pickupHoldMatchesItem — quando um hold casa com um item da fila/rota', () => {
  it('casa por source_line_key (prioridade)', () => {
    expect(pickupHoldMatchesItem(hold({ source_line_key: 'item:abc' }), { source_line_key: 'ITEM:ABC', sku: 'OUTRO' })).toBe(true);
  });

  it('casa por sku + local quando ambos têm local', () => {
    expect(pickupHoldMatchesItem(hold({ sku: 'VENT', storage_location: 'DEP' }), { sku: 'vent', location: 'dep' })).toBe(true);
  });

  it('NÃO casa quando sku igual mas local diferente (item de outro local não é escondido)', () => {
    expect(pickupHoldMatchesItem(hold({ sku: 'VENT', storage_location: 'LOJA A' }), { sku: 'VENT', location: 'LOJA B' })).toBe(false);
  });

  it('casa só por sku quando o hold não tem local (retirada sem local definido)', () => {
    expect(pickupHoldMatchesItem(hold({ sku: 'VENT' }), { sku: 'VENT', location: 'QUALQUER' })).toBe(true);
  });

  it('casa só por sku quando o item não tem local', () => {
    expect(pickupHoldMatchesItem(hold({ sku: 'VENT', storage_location: 'DEP' }), { sku: 'VENT' })).toBe(true);
  });

  it('NÃO casa itens diferentes (sku e chave diferentes)', () => {
    expect(pickupHoldMatchesItem(hold({ sku: 'VENT', storage_location: 'DEP' }), { sku: 'ROUPEIRO', location: 'DEP' })).toBe(false);
  });

  it('hold sem sku nem chave não casa com nada (evita esconder item errado)', () => {
    expect(pickupHoldMatchesItem(hold({}), { sku: 'VENT', location: 'DEP' })).toBe(false);
  });

  it('source_line_key vazio no item não casa por chave (cai pro sku)', () => {
    // hold tem chave, item não tem -> não casa por chave; sku diferente -> não casa
    expect(pickupHoldMatchesItem(hold({ source_line_key: 'item:abc', sku: 'A' }), { sku: 'B' })).toBe(false);
  });
});

describe('buildPickupHoldPayload — payload do hold a partir do item', () => {
  it('extrai order_id, chaves e usa location como storage_location', () => {
    const p = buildPickupHoldPayload({ id: 'o1' }, { order_item_id: 'oi1', source_line_key: 'k', sku: 'S', location: 'DEP', name: 'Produto' }, { hold_type: 'retirada', status: 'picked_up' });
    expect(p).toMatchObject({
      order_id: 'o1', order_item_id: 'oi1', source_line_key: 'k', sku: 'S',
      storage_location: 'DEP', product_name: 'Produto', hold_type: 'retirada', status: 'picked_up',
    });
  });
  it('cai para descricao/product_name quando não há name', () => {
    expect(buildPickupHoldPayload({ id: 'o1' }, { sku: 'S', descricao: 'Desc' }, {}).product_name).toBe('Desc');
  });
});
