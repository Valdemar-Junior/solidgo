import { describe, it, expect } from 'vitest';
import { buildExpeditionLabels, labelCodesForLine } from './expeditionLabels';
import { buildStops } from '../conference/expected';

/** Pedido dentro de uma rota, com endereço e vendedor. */
const order = (id: string, erp: string, customer: string, items: any[], sequence = 1) => ({
  id: `ro_${id}`,
  order_id: id,
  status: 'pending',
  sequence,
  order: {
    id,
    order_id_erp: erp,
    customer_name: customer,
    items_json: items,
    vendedor_nome: 'DALTSON SANTANA',
    address_json: {
      street: 'Sitio Palheiro 4, 25',
      neighborhood: 'Zona Rural',
      city: 'ASSU',
      zip: '59650-000',
      complement: 'Proximo a placa do km 91',
    },
  },
});

const item = (sku: string, volumes: number, purchased = 1, labels?: string[]) => ({
  sku,
  name: `Produto ${sku}`,
  quantity: volumes,
  volumes_per_unit: volumes,
  purchased_quantity: purchased,
  labels: labels ?? Array.from({ length: volumes }, (_, i) => `${i + 1}/${volumes}-${sku}`),
});

describe('quantidade de etiquetas', () => {
  it('gera uma etiqueta por volume: roupeiro de 5 + maquina de 6 = 11 etiquetas', () => {
    const route = {
      name: 'ASSU SETOR 1',
      route_orders: [order('o1', '146138', 'Joao', [item('1347-1', 5), item('3802-2', 6)])],
    };
    const labels = buildExpeditionLabels(route, []);
    expect(labels).toHaveLength(11);
    expect(labels[0].orderVolumeIndex).toBe(1);
    expect(labels[10].orderVolumeIndex).toBe(11);
    expect(labels.every((l) => l.orderVolumeTotal === 11)).toBe(true);
  });

  it('bate exatamente com o que a conferencia espera bipar', () => {
    const route = {
      route_orders: [
        order('o1', '146138', 'Joao', [item('1347-1', 4), item('3802-2', 1)], 1),
        order('o2', '146139', 'Maria', [item('3898', 2)], 2),
      ],
    };
    const totalConferencia = buildStops(route, []).reduce((acc, s) => acc + s.required, 0);
    expect(buildExpeditionLabels(route, []).length).toBe(totalConferencia);
  });

  it('nao imprime etiqueta de item devolvido (respeita o snapshot da rota)', () => {
    // 2 unidades de 2 volumes cada; cliente devolveu 1 unidade.
    const route = { route_orders: [order('o1', '146138', 'Joao', [item('2322-1', 4, 2)])] };
    const snapshot = [{ order_id: 'o1', sku_snapshot: '2322-1', allocated_quantity: 1, purchased_quantity: 2 }];
    const labels = buildExpeditionLabels(route, snapshot);
    expect(labels).toHaveLength(2);
    expect(labels.map((l) => l.barcode)).toEqual(['1/4-2322-1', '2/4-2322-1']);
  });
});

describe('codigo de barras', () => {
  it('reaproveita a etiqueta que o ERP mandou, como ela veio', () => {
    const route = { route_orders: [order('o1', '146138', 'Joao', [item('1347-1', 4)])] };
    const labels = buildExpeditionLabels(route, []);
    expect(labels.map((l) => l.barcode)).toEqual(['1/4-1347-1', '2/4-1347-1', '3/4-1347-1', '4/4-1347-1']);
  });

  it('gera no mesmo formato quando o ERP nao manda etiqueta', () => {
    const route = { route_orders: [order('o1', '146138', 'Joao', [item('1347-1', 3, 1, [])])] };
    expect(buildExpeditionLabels(route, []).map((l) => l.barcode)).toEqual(['1/3-1347-1', '2/3-1347-1', '3/3-1347-1']);
  });

  it('completa quando o ERP manda menos etiquetas que volumes', () => {
    expect(labelCodesForLine(['1/1-2921'], 2, '2921')).toEqual(['1/1-2921', '2/2-2921']);
  });

  it('mantem etiquetas repetidas do ERP (dois volumes iguais)', () => {
    expect(labelCodesForLine(['1/1-1284-3', '1/1-1284-3'], 2, '1284-3')).toEqual(['1/1-1284-3', '1/1-1284-3']);
  });
});

describe('dados impressos na etiqueta', () => {
  it('leva pedido, cliente, endereco completo, vendedor e parada', () => {
    const route = {
      name: 'ASSU SETOR 1',
      route_orders: [order('o1', '146138', 'Genigleciela Fernandes', [item('1347-1', 2)], 3)],
    };
    const [primeira] = buildExpeditionLabels(route, []);
    expect(primeira.orderErp).toBe('146138');
    expect(primeira.customer).toBe('Genigleciela Fernandes');
    expect(primeira.street).toBe('Sitio Palheiro 4, 25');
    expect(primeira.neighborhood).toBe('Zona Rural');
    expect(primeira.city).toBe('ASSU');
    expect(primeira.seller).toBe('DALTSON SANTANA');
    expect(primeira.sequence).toBe(3);
    expect(primeira.itemVolumeIndex).toBe(1);
    expect(primeira.itemVolumeTotal).toBe(2);
  });

  it('sai na ordem das paradas', () => {
    const route = {
      route_orders: [
        order('o2', '222', 'Maria', [item('a', 1)], 2),
        order('o1', '111', 'Joao', [item('b', 1)], 1),
      ],
    };
    expect(buildExpeditionLabels(route, []).map((l) => l.orderErp)).toEqual(['111', '222']);
  });
});
