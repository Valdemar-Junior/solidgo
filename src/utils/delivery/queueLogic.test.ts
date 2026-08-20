import { describe, it, expect } from 'vitest';
import { getOperationalItemsForOrder } from './queueLogic';
import type { OrderItemHold } from '../../types/database';

const bal = (over: Record<string, any> = {}) => ({
  order_item_id: 'oi', order_id: 'o1', source_line_key: 'item:roupeiro||', sku: 'ROUPEIRO',
  product_name: 'Roupeiro', source_present: true, purchased_quantity: 1, returned_quantity: 0,
  shadow_deliverable_quantity: 1, has_over_return: false,
  delivered_quantity: 0, remaining_deliverable_quantity: 1, storage_location: 'A1',
  ...over,
});

describe('getOperationalItemsForOrder — o que a fila de roteirizacao mostra do pedido', () => {
  it('sem saldos por item (modo legado): devolve os items_json originais', () => {
    const order = { id: 'o1', items_json: [{ sku: 'X', name: 'Item X' }] };
    const out = getOperationalItemsForOrder(order, {});
    expect(out).toHaveLength(1);
    expect(out[0].sku).toBe('X');
  });

  it('mostra o item que ainda FALTA entregar, com a quantidade RESTANTE (nao a cheia)', () => {
    const order = { id: 'o1', items_json: [{ sku: 'ROUPEIRO', name: 'Roupeiro', location: 'A1' }] };
    const balances = { o1: [bal({ purchased_quantity: 3, remaining_deliverable_quantity: 2, shadow_deliverable_quantity: 3 })] };
    const out = getOperationalItemsForOrder(order, balances);
    expect(out).toHaveLength(1);
    // quantidade da fila = RESTANTE (2), nao a comprada (3) nem o saldo cheio (3)
    expect(out[0].quantity).toBe(2);
    expect(out[0].purchased_quantity).toBe(2);
    expect(out[0].originally_purchased_quantity).toBe(3);
  });

  // GUARDA DE ENTREGA DUPLA no nivel da fila:
  it('NAO mostra na fila o item ja totalmente entregue (restante 0, mesmo com saldo cheio > 0)', () => {
    const order = { id: 'o1', items_json: [{ sku: 'ROUPEIRO' }, { sku: 'CAMA' }] };
    const balances = {
      o1: [
        bal({ sku: 'ROUPEIRO', source_line_key: 'item:roupeiro||', remaining_deliverable_quantity: 0, shadow_deliverable_quantity: 1 }),
        bal({ sku: 'CAMA', source_line_key: 'item:cama||', remaining_deliverable_quantity: 1, shadow_deliverable_quantity: 1 }),
      ],
    };
    const out = getOperationalItemsForOrder(order, balances);
    // so a CAMA (roupeiro ja entregue nao reaparece)
    expect(out).toHaveLength(1);
    expect(out[0].sku).toBe('CAMA');
  });

  it('casa o saldo com o item original por SKU (herda nome/local do original)', () => {
    const order = { id: 'o1', items_json: [{ sku: 'ROUPEIRO', name: 'Roupeiro 6 portas', location: 'RUA-3' }] };
    const balances = { o1: [bal({ sku: 'ROUPEIRO', product_name: 'nome-do-saldo' })] };
    const out = getOperationalItemsForOrder(order, balances);
    expect(out[0].name).toBe('Roupeiro 6 portas');
    expect(out[0].location).toBe('RUA-3');
  });
});

// Aba "Em Espera": itens pausados somem da fila; agendamento vencido volta sozinho.
const hold = (over: Record<string, any> = {}) => ({
  id: 'h1', order_id: 'o1', order_item_id: null, source_line_key: null,
  sku: null, storage_location: null, product_name: null,
  hold_type: 'manual', scheduled_date: null, reason: null, status: 'active',
  created_at: 'x', updated_at: 'x', ...over,
} as OrderItemHold);

describe('getOperationalItemsForOrder — camada "Em Espera" (itens pausados)', () => {
  // pedido com 2 itens no modo legado (sem saldo por item)
  const order = { id: 'o1', items_json: [
    { sku: 'VENTILADOR', name: 'Ventilador', location: 'A1' },
    { sku: 'ROUPEIRO', name: 'Roupeiro', location: 'B2' },
  ] };

  it('esconde da fila o item com pausa manual ("cliente vai avisar"), o outro fica', () => {
    const ctx = { holdsByOrderId: { o1: [hold({ sku: 'ROUPEIRO' })] }, today: '2026-07-10' };
    const out = getOperationalItemsForOrder(order, {}, ctx);
    expect(out).toHaveLength(1);
    expect(out[0].sku).toBe('VENTILADOR');
  });

  it('agendamento com data FUTURA segura o item fora da fila', () => {
    const ctx = { holdsByOrderId: { o1: [hold({ sku: 'ROUPEIRO', hold_type: 'scheduled', scheduled_date: '2026-07-25' })] }, today: '2026-07-10' };
    const out = getOperationalItemsForOrder(order, {}, ctx);
    expect(out.map((i: any) => i.sku)).toEqual(['VENTILADOR']);
  });

  it('agendamento com data JA VENCIDA volta sozinho pra fila', () => {
    const ctx = { holdsByOrderId: { o1: [hold({ sku: 'ROUPEIRO', hold_type: 'scheduled', scheduled_date: '2026-07-10' })] }, today: '2026-07-10' };
    const out = getOperationalItemsForOrder(order, {}, ctx);
    expect(out.map((i: any) => i.sku).sort()).toEqual(['ROUPEIRO', 'VENTILADOR']);
  });

  it('move automatico por PALAVRA-CHAVE (*retirada*) esconde o pedido todo', () => {
    const ord = { ...order, observacoes_internas: 'Venda normal *RETIRADA* cliente busca' };
    const ctx = { autoRules: { keywords: ['*retirada*'], operations: [] }, today: '2026-07-10' };
    const out = getOperationalItemsForOrder(ord, {}, ctx);
    expect(out).toHaveLength(0);
  });

  it('move automatico por OPERACAO esconde o pedido todo', () => {
    const ord = { ...order, raw_json: { operacoes: 'Venda com Retirada' } };
    const ctx = { autoRules: { keywords: [], operations: ['Venda com Retirada'] }, today: '2026-07-10' };
    const out = getOperationalItemsForOrder(ord, {}, ctx);
    expect(out).toHaveLength(0);
  });

  it('liberar UM item (override released) traz so ele de volta, mesmo no automatico', () => {
    const ord = { ...order, raw_json: { operacoes: 'Venda com Retirada' } };
    const ctx = {
      autoRules: { keywords: [], operations: ['Venda com Retirada'] },
      holdsByOrderId: { o1: [hold({ sku: 'VENTILADOR', status: 'released' })] },
      today: '2026-07-10',
    };
    const out = getOperationalItemsForOrder(ord, {}, ctx);
    expect(out.map((i: any) => i.sku)).toEqual(['VENTILADOR']);
  });

  it('sem contexto de holds, comportamento antigo continua igual', () => {
    const out = getOperationalItemsForOrder(order, {});
    expect(out).toHaveLength(2);
  });

  it('item ja retirado (picked_up) some da fila, o resto do pedido continua', () => {
    const ctx = { holdsByOrderId: { o1: [hold({ sku: 'VENTILADOR', status: 'picked_up', hold_type: 'retirada' })] }, today: '2026-07-10' };
    const out = getOperationalItemsForOrder(order, {}, ctx);
    expect(out.map((i: any) => i.sku)).toEqual(['ROUPEIRO']);
  });
});
