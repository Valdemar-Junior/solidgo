import { describe, it, expect } from 'vitest';
import {
  isBlockedRouteOrderItem,
  isDeliverableRouteOrderItem,
  isVisibleRouteOrderItem,
  getRouteOrderItemStatusLabel,
  getRouteOrderItemStatusClasses,
  lineUnitPrice,
  computeDeliverableOrderValue,
} from './itemLogic';
import type { RouteOrderItem } from '../../types/database';

// Monta um item de snapshot de rota minimo pros testes.
const roi = (over: Partial<RouteOrderItem> = {}): RouteOrderItem => ({
  id: 'ri',
  route_order_id: 'ro',
  order_id: 'o',
  order_item_id: 'oi',
  sku_snapshot: 'S1',
  product_name_snapshot: 'Produto',
  allocated_quantity: 1,
  deliverable_quantity_snapshot: 1,
  returned_quantity_snapshot: 0,
  status: 'pending',
  ...(over as any),
}) as RouteOrderItem;

describe('predicados de item de rota', () => {
  it('bloqueado no ERP: devolvido > 0 e nada entregavel', () => {
    expect(isBlockedRouteOrderItem(roi({ returned_quantity_snapshot: 1, deliverable_quantity_snapshot: 0 }))).toBe(true);
  });
  it('NAO bloqueado quando ainda ha saldo entregavel (devolucao parcial)', () => {
    expect(isBlockedRouteOrderItem(roi({ returned_quantity_snapshot: 1, deliverable_quantity_snapshot: 1 }))).toBe(false);
  });
  it('entregavel quando saldo do snapshot > 0', () => {
    expect(isDeliverableRouteOrderItem(roi({ deliverable_quantity_snapshot: 2 }))).toBe(true);
    expect(isDeliverableRouteOrderItem(roi({ deliverable_quantity_snapshot: 0 }))).toBe(false);
  });
  it('visivel quando alocado > 0 OU ainda ha saldo entregavel', () => {
    expect(isVisibleRouteOrderItem(roi({ allocated_quantity: 0, deliverable_quantity_snapshot: 0 }))).toBe(false);
    expect(isVisibleRouteOrderItem(roi({ allocated_quantity: 1, deliverable_quantity_snapshot: 0 }))).toBe(true);
    expect(isVisibleRouteOrderItem(roi({ allocated_quantity: 0, deliverable_quantity_snapshot: 1 }))).toBe(true);
  });
});

describe('getRouteOrderItemStatusLabel — o rotulo certo pra cada caso (bug que o dono achou)', () => {
  // ESTE distingue devolucao do ERP (por baixo) de retorno do motorista (na rua).
  it('item bloqueado no ERP mostra "Devolvido no ERP" mesmo que o status diga outra coisa', () => {
    const item = roi({ returned_quantity_snapshot: 1, deliverable_quantity_snapshot: 0, status: 'returned' });
    expect(getRouteOrderItemStatusLabel(item)).toBe('Devolvido no ERP');
  });
  it('item retornado pelo motorista (sem bloqueio ERP) mostra "Retornado na entrega"', () => {
    const item = roi({ status: 'returned', returned_quantity_snapshot: 0, deliverable_quantity_snapshot: 1 });
    expect(getRouteOrderItemStatusLabel(item)).toBe('Retornado na entrega');
  });
  it('demais status', () => {
    expect(getRouteOrderItemStatusLabel(roi({ status: 'partial' }))).toBe('Devolução parcial');
    expect(getRouteOrderItemStatusLabel(roi({ status: 'delivered' }))).toBe('Entregue');
    expect(getRouteOrderItemStatusLabel(roi({ status: 'cancelled' }))).toBe('Cancelado');
    expect(getRouteOrderItemStatusLabel(roi({ status: 'pending' }))).toBe('Disponível para entrega');
  });
});

describe('getRouteOrderItemStatusClasses — cor coerente com o estado', () => {
  it('vermelho para retornado E para bloqueado no ERP', () => {
    expect(getRouteOrderItemStatusClasses(roi({ status: 'returned' }))).toContain('red');
    expect(getRouteOrderItemStatusClasses(roi({ returned_quantity_snapshot: 1, deliverable_quantity_snapshot: 0 }))).toContain('red');
  });
  it('verde para entregue, ambar para parcial, azul para disponivel', () => {
    expect(getRouteOrderItemStatusClasses(roi({ status: 'delivered' }))).toContain('green');
    expect(getRouteOrderItemStatusClasses(roi({ status: 'partial' }))).toContain('amber');
    expect(getRouteOrderItemStatusClasses(roi({ status: 'pending' }))).toContain('blue');
  });
});

describe('lineUnitPrice — preco unitario robusto', () => {
  it('usa total/qtd quando ha total', () => {
    expect(lineUnitPrice({ total_price_real: 300, purchased_quantity: 3 })).toBe(100);
  });
  it('cai no unit_price quando nao ha total', () => {
    expect(lineUnitPrice({ unit_price_real: 50 })).toBe(50);
  });
  it('nao divide por zero (qtd 0 vira 1)', () => {
    expect(lineUnitPrice({ total_price_real: 80, purchased_quantity: 0 })).toBe(80);
  });
});

describe('computeDeliverableOrderValue — "Valor: R$" descontando o que foi devolvido', () => {
  const order = {
    items_json: [
      { sku: 'ROUPEIRO', purchased_quantity: 1, total_price_real: 1000 },
      { sku: 'CAMA', purchased_quantity: 1, total_price_real: 500 },
    ],
  };

  it('sem snapshot (modo legado): valor cheio do pedido', () => {
    expect(computeDeliverableOrderValue(order, [])).toBe(1500);
  });

  it('com tudo entregavel: valor cheio', () => {
    const snap = [
      roi({ sku_snapshot: 'ROUPEIRO', deliverable_quantity_snapshot: 1 }),
      roi({ sku_snapshot: 'CAMA', deliverable_quantity_snapshot: 1 }),
    ];
    expect(computeDeliverableOrderValue(order, snap)).toBe(1500);
  });

  it('cama devolvida (saldo 0): valor cai para so o roupeiro', () => {
    const snap = [
      roi({ sku_snapshot: 'ROUPEIRO', deliverable_quantity_snapshot: 1 }),
      roi({ sku_snapshot: 'CAMA', deliverable_quantity_snapshot: 0 }),
    ];
    expect(computeDeliverableOrderValue(order, snap)).toBe(1000);
  });

  it('SKU desconhecido no snapshot: mantem valor cheio da linha (fallback seguro, nunca subestima)', () => {
    const snap = [roi({ sku_snapshot: 'ROUPEIRO', deliverable_quantity_snapshot: 1 })];
    // CAMA nao esta no snapshot -> soma cheio -> 1000 (roupeiro) + 500 (cama fallback)
    expect(computeDeliverableOrderValue(order, snap)).toBe(1500);
  });

  it('mesmo SKU repetido em 2 linhas: consome o saldo linha a linha (nao conta em dobro)', () => {
    const orderRep = {
      items_json: [
        { sku: 'CADEIRA', purchased_quantity: 1, total_price_real: 100 },
        { sku: 'CADEIRA', purchased_quantity: 1, total_price_real: 100 },
      ],
    };
    // Saldo entregavel total = 1 (uma cadeira devolvida). Só uma linha vale.
    const snap = [roi({ sku_snapshot: 'CADEIRA', deliverable_quantity_snapshot: 1 })];
    expect(computeDeliverableOrderValue(orderRep, snap)).toBe(100);
  });
});
