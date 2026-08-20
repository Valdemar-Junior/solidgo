import { describe, it, expect } from 'vitest';
import { buildStops, matchLine, normalizeScan, findOtherStops } from './expected';

/** Atalho pra montar um pedido dentro de uma rota. */
const order = (id: string, erp: string, customer: string, items: any[], sequence = 1) => ({
  id: `ro_${id}`,
  order_id: id,
  status: 'pending',
  sequence,
  order: { id, order_id_erp: erp, customer_name: customer, items_json: items },
});

const item = (sku: string, volumes: number, purchased = 1, labels?: string[]) => ({
  sku,
  name: `Produto ${sku}`,
  quantity: volumes,
  volumes_per_unit: volumes,
  purchased_quantity: purchased,
  labels: labels ?? Array.from({ length: volumes }, (_, i) => `${i + 1}/${volumes}-${sku}`),
});

describe('leitura do código', () => {
  it('aceita ponto-e-vírgula no lugar da barra e ignora espaços/caixa', () => {
    expect(normalizeScan(' 1;3-3189-2 ')).toBe('1/3-3189-2');
    expect(normalizeScan('1/3-ABC')).toBe('1/3-abc');
  });
});

describe('volumes esperados', () => {
  it('usa os volumes do item quando não há snapshot da rota', () => {
    const stops = buildStops({ route_orders: [order('o1', '141073', 'Maria', [item('3189-2', 3)])] }, []);
    expect(stops[0].required).toBe(3);
    expect(stops[0].lines[0].codes).toContain('1/3-3189-2');
  });

  it('respeita o snapshot da rota: item devolvido não é cobrado do conferente', () => {
    // Cliente comprou 2 unidades de 2 volumes cada (4 volumes) e devolveu 1 unidade.
    const route = { route_orders: [order('o1', '141073', 'Maria', [item('2322-1', 4, 2)])] };
    const snapshot = [{ order_id: 'o1', sku_snapshot: '2322-1', allocated_quantity: 1, purchased_quantity: 2 }];
    const stops = buildStops(route, snapshot);
    expect(stops[0].required).toBe(2); // só a unidade que sobrou
  });

  it('some com a linha quando nada foi alocado nesta rota', () => {
    const route = { route_orders: [order('o1', '141073', 'Maria', [item('2322-1', 2, 1)])] };
    const snapshot = [{ order_id: 'o1', sku_snapshot: '2322-1', allocated_quantity: 0, purchased_quantity: 1 }];
    const stops = buildStops(route, snapshot);
    expect(stops[0].lines).toHaveLength(0);
    expect(stops[0].required).toBe(0);
  });

  it('ignora pedidos cancelados e ordena pela sequência da rota', () => {
    const route = {
      route_orders: [
        order('o2', '2', 'B', [item('1', 1)], 2),
        { ...order('o3', '3', 'C', [item('2', 1)], 3), status: 'cancelled' },
        order('o1', '1', 'A', [item('3', 1)], 1),
      ],
    };
    const stops = buildStops(route, []);
    expect(stops.map((s) => s.erp)).toEqual(['1', '2']);
  });
});

describe('achar o produto pelo código bipado', () => {
  const lines = buildStops(
    { route_orders: [order('o1', '141073', 'Maria', [item('3189-2', 3), item('2826', 1)])] },
    [],
  )[0].lines;

  it('acha pela etiqueta exata e marca como exata', () => {
    const hit = matchLine('2/3-3189-2', lines)!;
    expect(hit.line.sku).toBe('3189-2');
    expect(hit.exact).toBe(true);
  });

  it('acha pelo código do produto mesmo com x/y diferente do impresso', () => {
    const hit = matchLine('9/9-3189-2', lines)!;
    expect(hit.line.sku).toBe('3189-2');
    expect(hit.exact).toBe(false);
  });

  it('não confunde o sufixo do SKU com sufixo de impressão', () => {
    // "3189-2" é o SKU; não pode cair no SKU "3189" (que não existe aqui).
    expect(matchLine('1/3-3189-2', lines)!.line.sku).toBe('3189-2');
    // Sufixo extra de impressão é tolerado.
    expect(matchLine('1/1-2826-7', lines)!.line.sku).toBe('2826');
  });

  it('recusa código que não é da rota', () => {
    expect(matchLine('1/1-9999', lines)).toBeNull();
  });
});

describe('mesmo produto em dois pedidos da rota (etiqueta não tem o pedido)', () => {
  const route = {
    route_orders: [
      order('o1', '141073', 'Maria', [item('2826', 1)], 1),
      order('o2', '141096', 'João', [item('2826', 1)], 2),
    ],
  };
  const stops = buildStops(route, []);

  it('mantém os volumes separados por pedido', () => {
    expect(stops).toHaveLength(2);
    expect(stops[0].required).toBe(1);
    expect(stops[1].required).toBe(1);
    expect(stops[0].lines[0].key).not.toBe(stops[1].lines[0].key);
  });

  it('avisa que o código também existe no outro pedido', () => {
    const others = findOtherStops('1/1-2826', stops, 'o1');
    expect(others.map((s) => s.erp)).toEqual(['141096']);
  });
});
