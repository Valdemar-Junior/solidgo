/**
 * Etiquetas de expedição (uma por volume) de uma rota.
 *
 * Regra de ouro: a quantidade de etiquetas de cada produto é EXATAMENTE a
 * mesma que a conferência do coletor espera (`ExpectedLine.required`). Se as
 * duas contas divergissem, o conferente veria sobra ou falta de volume só por
 * causa da impressão.
 *
 * O código de barras reaproveita a etiqueta que o ERP já manda (`labels` do
 * item, ex.: "1/4-1347-1"), então a etiqueta impressa aqui é lida pelo mesmo
 * leitor, do mesmo jeito que a etiqueta antiga. Quando o ERP não manda etiqueta
 * (ou manda menos que o necessário), geramos no mesmo formato.
 */

import { buildStops, type Stop } from '../conference/expected';

/** Uma etiqueta = um volume que vai subir no caminhão. */
export type ExpeditionLabel = {
  /** Código que vai no código de barras (ex.: "1/4-1347-1"). */
  barcode: string;
  /** Ordem da parada na rota. */
  sequence: number;
  orderErp: string;
  customer: string;
  /** Rua e número. */
  street: string;
  neighborhood: string;
  city: string;
  zip: string;
  complement: string;
  seller: string;
  sku: string;
  product: string;
  location: string;
  /** Volume dentro do produto: 2 de 4. */
  itemVolumeIndex: number;
  itemVolumeTotal: number;
  /** Volume dentro do pedido: 6 de 11 — é o que o conferente conta no caminhão. */
  orderVolumeIndex: number;
  orderVolumeTotal: number;
};

/**
 * Prefixo com o número do pedido dentro do código de barras.
 *
 * Desligado: hoje a etiqueta sai idêntica à do ERP. Ligando (`true`), o código
 * vira "145319*1/4-1347-1" e o coletor passa a saber de qual pedido é o volume,
 * o que permite conferir item a item em vez de por pedido. Só ligue depois de
 * ensinar `matchLine` (src/utils/conference/expected.ts) a separar o prefixo.
 */
export const INCLUDE_ORDER_IN_BARCODE = false;

const ORDER_BARCODE_SEPARATOR = '*';

const buildBarcode = (orderErp: string, labelCode: string) =>
  INCLUDE_ORDER_IN_BARCODE ? `${orderErp}${ORDER_BARCODE_SEPARATOR}${labelCode}` : labelCode;

/** Códigos de barras de uma linha de produto, na ordem dos volumes. */
export const labelCodesForLine = (
  erpLabels: string[],
  required: number,
  sku: string,
): string[] => {
  const usable = (erpLabels || []).map((l) => String(l || '').trim()).filter(Boolean);
  const codes: string[] = [];
  for (let i = 0; i < required; i += 1) {
    // O ERP às vezes manda menos etiquetas do que volumes (ou nenhuma).
    codes.push(usable[i] || `${i + 1}/${required}-${sku}`);
  }
  return codes;
};

type OrderInfo = {
  street: string;
  neighborhood: string;
  city: string;
  zip: string;
  complement: string;
  seller: string;
};

const emptyOrderInfo: OrderInfo = { street: '', neighborhood: '', city: '', zip: '', complement: '', seller: '' };

/** Dados de endereço/vendedor que a `Stop` não carrega, indexados por order_id. */
const indexOrders = (route: any): Record<string, OrderInfo> => {
  const map: Record<string, OrderInfo> = {};
  (route?.route_orders || []).forEach((ro: any) => {
    const o = ro?.order;
    if (!o?.id) return;
    const addr = o.address_json || {};
    const raw = o.raw_json || {};
    map[String(o.id)] = {
      street: String(addr.street || raw.destinatario_endereco || ''),
      neighborhood: String(addr.neighborhood || raw.destinatario_bairro || ''),
      city: String(addr.city || raw.destinatario_cidade || ''),
      zip: String(addr.zip || raw.destinatario_cep || ''),
      complement: String(addr.complement || raw.destinatario_complemento || ''),
      seller: String(o.vendedor_nome || raw.nome_vendedor || raw.vendedor || ''),
    };
  });
  return map;
};

/**
 * Monta todas as etiquetas da rota, na ordem das paradas.
 *
 * `snapshot` = linhas de `route_order_items` (o que foi realmente separado pra
 * esta rota). Sem snapshot, cai na quantidade comprada — mesmo comportamento
 * da conferência.
 */
export const buildExpeditionLabels = (route: any, snapshot: any[]): ExpeditionLabel[] => {
  const stops: Stop[] = buildStops(route, snapshot);
  const orderInfo = indexOrders(route);
  const labels: ExpeditionLabel[] = [];

  stops.forEach((stop) => {
    const info = orderInfo[stop.orderId] || emptyOrderInfo;
    const orderVolumeTotal = stop.required;
    let orderVolumeIndex = 0;

    stop.lines.forEach((line) => {
      const codes = labelCodesForLine(line.erpLabels, line.required, line.sku);
      codes.forEach((code, i) => {
        orderVolumeIndex += 1;
        labels.push({
          barcode: buildBarcode(stop.erp, code),
          sequence: stop.sequence,
          orderErp: stop.erp,
          customer: stop.customer,
          street: info.street,
          neighborhood: info.neighborhood,
          city: info.city,
          zip: info.zip,
          complement: info.complement,
          seller: info.seller,
          sku: line.sku,
          product: line.name,
          location: line.location,
          itemVolumeIndex: i + 1,
          itemVolumeTotal: line.required,
          orderVolumeIndex,
          orderVolumeTotal,
        });
      });
    });
  });

  return labels;
};
