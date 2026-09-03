import { describe, it, expect } from 'vitest';
import { buildStops } from '../conference/expected';
import { barcodesForLine, buildExpeditionLabels } from './expeditionLabels';

/** Atalho pra montar um pedido dentro de uma rota. */
const order = (id: string, erp: string, customer: string, items: any[], sequence = 1, extra: any = {}) => ({
  id: `ro_${id}`,
  order_id: id,
  status: 'pending',
  sequence,
  order: {
    id,
    order_id_erp: erp,
    customer_name: customer,
    items_json: items,
    address_json: {
      street: 'Maria Das Dores Da Silva, 13',
      neighborhood: 'Segundo Mestre',
      city: 'IPANGUACU',
      zip: '59508-000',
      complement: 'Proximo O Plantio De Bananas',
    },
    vendedor_nome: 'DALLYSON',
    ...extra,
  },
});

const item = (sku: string, volumes: number, purchased = 1, labels?: string[]) => ({
  sku,
  name: `Produto ${sku}`,
  location: 'ATACADO DEPOSITO',
  quantity: volumes,
  volumes_per_unit: volumes,
  purchased_quantity: purchased,
  labels: labels ?? Array.from({ length: volumes }, (_, i) => `${i + 1}/${volumes}-${sku}`),
});

describe('quantas etiquetas saem', () => {
  it('uma etiqueta por volume: roupeiro de 5 + maquina de 6 = 11', () => {
    const route = {
      name: 'ASSU SETOR 1',
      route_orders: [order('o1', '144897', 'Jessica', [item('2852-1', 5), item('3190-4', 6)])],
    };
    const labels = buildExpeditionLabels(route, []);
    expect(labels).toHaveLength(11);
    expect(labels.filter((l) => l.sku === '2852-1')).toHaveLength(5);
    expect(labels.filter((l) => l.sku === '3190-4')).toHaveLength(6);
  });

  it('a contagem bate exatamente com o que a conferencia espera bipar', () => {
    const route = {
      name: 'ASSU SETOR 1',
      route_orders: [
        order('o1', '144897', 'Jessica', [item('2852-1', 5), item('3190-4', 6)], 1),
        order('o2', '144898', 'Joao', [item('2826', 2, 3)], 2),
      ],
    };
    const snapshot = [{ order_id: 'o2', sku_snapshot: '2826', allocated_quantity: 2, purchased_quantity: 3 }];

    const esperadoPelaConferencia = buildStops(route, snapshot).reduce((acc, s) => acc + s.required, 0);
    expect(buildExpeditionLabels(route, snapshot)).toHaveLength(esperadoPelaConferencia);
  });

  it('item devolvido pelo cliente nao gera etiqueta', () => {
    // Comprou 2 unidades de 2 volumes (4 volumes) e devolveu 1 unidade.
    const route = { name: 'R', route_orders: [order('o1', '141073', 'Maria', [item('2322-1', 4, 2)])] };
    const snapshot = [{ order_id: 'o1', sku_snapshot: '2322-1', allocated_quantity: 1, purchased_quantity: 2 }];
    expect(buildExpeditionLabels(route, snapshot)).toHaveLength(2);
  });

  it('produto que nao vai nesta rota nao aparece', () => {
    const route = { name: 'R', route_orders: [order('o1', '141073', 'Maria', [item('2322-1', 2, 1), item('9999', 3)])] };
    const snapshot = [{ order_id: 'o1', sku_snapshot: '2322-1', allocated_quantity: 0, purchased_quantity: 1 }];
    const labels = buildExpeditionLabels(route, snapshot);
    expect(labels.map((l) => l.sku)).toEqual(['9999', '9999', '9999']);
  });
});

describe('codigo de barras da etiqueta', () => {
  it('reaproveita a etiqueta do ERP exatamente como ela veio', () => {
    const route = {
      name: 'R',
      route_orders: [order('o1', '144897', 'Jessica', [item('2852-1', 3, 1, ['1/6-2852-1', '2/6-2852-1', '3/6-2852-1'])])],
    };
    expect(buildExpeditionLabels(route, []).map((l) => l.barcode))
      .toEqual(['1/6-2852-1', '2/6-2852-1', '3/6-2852-1']);
  });

  it('gera no mesmo formato quando o ERP nao manda etiqueta nenhuma', () => {
    expect(barcodesForLine({ labels: [] }, '2852-1', 3)).toEqual(['1/3-2852-1', '2/3-2852-1', '3/3-2852-1']);
    expect(barcodesForLine({}, '2852-1', 2)).toEqual(['1/2-2852-1', '2/2-2852-1']);
  });

  it('completa quando o ERP manda menos etiquetas do que volumes', () => {
    expect(barcodesForLine({ labels: ['1/6-2852-1'] }, '2852-1', 3))
      .toEqual(['1/6-2852-1', '2/3-2852-1', '3/3-2852-1']);
  });

  it('descarta etiqueta repetida do ERP em vez de imprimir duas caixas iguais', () => {
    const codes = barcodesForLine({ labels: ['1/6-2852-1', '1/6-2852-1', '2/6-2852-1'] }, '2852-1', 3);
    expect(codes).toEqual(['1/6-2852-1', '2/6-2852-1', '3/3-2852-1']);
    expect(new Set(codes).size).toBe(3);
  });

  it('a chave do numero do pedido no codigo vem desligada', () => {
    const route = { name: 'R', route_orders: [order('o1', '144897', 'Jessica', [item('2852-1', 1, 1, ['1/6-2852-1'])])] };
    expect(buildExpeditionLabels(route, [])[0].barcode).toBe('1/6-2852-1');
    expect(buildExpeditionLabels(route, [], { includeOrderInBarcode: true })[0].barcode)
      .toBe('144897*1/6-2852-1');
  });
});

describe('o que vai escrito na etiqueta', () => {
  const route = {
    name: 'ASSU SETOR 1',
    route_orders: [
      order('o1', '144897', 'Jessica Priscila Costa De Araujo', [item('2852-1', 2), item('3190-4', 1)], 1),
      order('o2', '144898', 'Joao', [item('2826', 1)], 2),
    ],
  };
  const labels = buildExpeditionLabels(route, []);

  it('sai na ordem das paradas', () => {
    expect(labels.map((l) => l.stopNumber)).toEqual([1, 1, 1, 2]);
    expect(labels.map((l) => l.erp)).toEqual(['144897', '144897', '144897', '144898']);
  });

  it('VOL x/y conta o volume dentro do PEDIDO (e o que o conferente confere)', () => {
    expect(labels.slice(0, 3).map((l) => `${l.volumeInOrder}/${l.volumesInOrder}`))
      .toEqual(['1/3', '2/3', '3/3']);
    expect(`${labels[3].volumeInOrder}/${labels[3].volumesInOrder}`).toBe('1/1');
  });

  it('o (x/y) do produto conta dentro daquele produto', () => {
    expect(labels.slice(0, 3).map((l) => `${l.volumeInProduct}/${l.volumesInProduct}`))
      .toEqual(['1/2', '2/2', '1/1']);
  });

  it('leva cliente, endereco completo, vendedor, local e nome da rota', () => {
    const l = labels[0];
    expect(l.customer).toBe('Jessica Priscila Costa De Araujo');
    expect(l.address.street).toBe('Maria Das Dores Da Silva, 13');
    expect(l.address.neighborhood).toBe('Segundo Mestre');
    expect(l.address.city).toBe('IPANGUACU');
    expect(l.address.zip).toBe('59508-000');
    expect(l.address.complement).toBe('Proximo O Plantio De Bananas');
    expect(l.seller).toBe('DALLYSON');
    expect(l.location).toBe('ATACADO DEPOSITO');
    expect(l.routeName).toBe('ASSU SETOR 1');
  });

  it('cai no raw_json quando o endereco estruturado vier vazio', () => {
    const semAddress = {
      name: 'R',
      route_orders: [
        order('o1', '1', 'Maria', [item('a', 1)], 1, {
          address_json: {},
          vendedor_nome: '',
          raw_json: {
            destinatario_endereco: 'Rua A, 1',
            destinatario_bairro: 'Centro',
            destinatario_cidade: 'ASSU',
            destinatario_cep: '59650-000',
            nome_vendedor: 'MARCOS',
          },
        }),
      ],
    };
    const l = buildExpeditionLabels(semAddress, [])[0];
    expect(l.address.city).toBe('ASSU');
    expect(l.address.zip).toBe('59650-000');
    expect(l.seller).toBe('MARCOS');
  });

  it('pedido cancelado na rota nao gera etiqueta', () => {
    const comCancelado = {
      name: 'R',
      route_orders: [
        order('o1', '1', 'Maria', [item('a', 1)], 1),
        { ...order('o2', '2', 'Joao', [item('b', 1)], 2), status: 'cancelled' },
      ],
    };
    expect(buildExpeditionLabels(comCancelado, []).map((l) => l.erp)).toEqual(['1']);
  });
});
