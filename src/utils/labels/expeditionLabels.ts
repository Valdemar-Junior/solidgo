/**
 * Etiqueta de expedição: quais etiquetas sair, e o que vai escrito em cada uma.
 *
 * Regra que não pode ser quebrada: a QUANTIDADE de etiquetas usa exatamente a
 * mesma conta da conferência do coletor (`buildStops`). Se as duas contas
 * divergirem, o conferente vê falta ou sobra de volume só por causa da
 * impressão. Por isso aqui não se calcula volume nenhum — só se pergunta ao
 * `buildStops` quantos ele espera bipar.
 *
 * O código de barras reaproveita a etiqueta que o ERP já mandou
 * (`items_json[].labels`, no formato `1/6-2852-1`), pra que o mesmo leitor da
 * conferência continue lendo sem mudar nada no coletor.
 */

import { buildStops, normalizeScan } from '../conference/expected';

/** Uma etiqueta = uma página do PDF = um volume no caminhão. */
export type ExpeditionLabel = {
  orderId: string;
  erp: string;              // número do pedido / lançamento
  customer: string;
  address: {
    street: string;
    neighborhood: string;
    city: string;
    zip: string;
    complement: string;
  };
  sku: string;
  productName: string;
  location: string;         // local de estoque
  seller: string;           // vendedor
  volumeInOrder: number;    // x de "VOL x/y" — o que o conferente conta
  volumesInOrder: number;   // y de "VOL x/y"
  volumeInProduct: number;  // x do "(x/y)" na frente do produto
  volumesInProduct: number; // y do "(x/y)"
  barcode: string;          // conteúdo do Code 128 (e o texto embaixo dele)
};

export type ExpeditionLabelOptions = {
  /**
   * DESLIGADA. Liga o número do pedido dentro do código de barras
   * (`144897*1/6-2852-1`), o que permitiria conferir item a item em vez de por
   * pedido. Antes de ligar é preciso ensinar o `matchLine` (conferência) a
   * separar esse prefixo — senão o coletor para de reconhecer o que for bipado.
   */
  includeOrderInBarcode?: boolean;
};

/** Separador entre o pedido e a etiqueta do ERP, quando a chave acima estiver ligada. */
export const ORDER_BARCODE_SEPARATOR = '*';

/**
 * As etiquetas que o ERP mandou para este item, na ordem, sem repetição e sem
 * vazios.
 *
 * Esses dados vêm inconsistentes em alguns pedidos: às vezes menos etiquetas do
 * que volumes, às vezes a mesma etiqueta repetida. Repetida seria pior que
 * faltando — duas caixas com o mesmo código fazem o coletor acusar volume
 * duplicado —, então a repetida é descartada e o buraco é preenchido depois.
 */
const erpLabelsOf = (item: any): string[] => {
  const seen = new Set<string>();
  const labels: string[] = [];
  (Array.isArray(item?.labels) ? item.labels : []).forEach((raw: any) => {
    const text = String(raw ?? '').trim();
    if (!text) return;
    const key = normalizeScan(text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    labels.push(text);
  });
  return labels;
};

/**
 * Os códigos de barras de um produto, um por volume.
 *
 * Usa o que o ERP mandou; quando ele mandar menos do que o necessário, completa
 * no mesmo formato (`i/N-sku`) para o volume não sair sem etiqueta.
 */
export const barcodesForLine = (item: any, sku: string, required: number): string[] => {
  const fromErp = erpLabelsOf(item);
  return Array.from({ length: required }, (_, i) => fromErp[i] ?? `${i + 1}/${required}-${sku}`);
};

/**
 * Monta todas as etiquetas da rota, na ordem das paradas.
 *
 * `route` é a rota com `route_orders` e `order` (igual ao que a conferência
 * carrega); `snapshot` são as linhas de `route_order_items` — quando existe, é
 * ele que manda: item devolvido pelo cliente não gera etiqueta.
 */
export const buildExpeditionLabels = (
  route: any,
  snapshot: any[],
  options: ExpeditionLabelOptions = {},
): ExpeditionLabel[] => {
  const ordersById = new Map<string, any>();
  (route?.route_orders || []).forEach((ro: any) => {
    if (ro?.order?.id) ordersById.set(String(ro.order.id), ro.order);
  });

  const labels: ExpeditionLabel[] = [];

  buildStops(route, snapshot).forEach((stop) => {
    const order = ordersById.get(stop.orderId) || {};
    const items = Array.isArray(order.items_json) ? order.items_json : [];
    const address = order.address_json || {};
    const raw = order.raw_json || {};

    const seller = String(
      order.vendedor_nome || raw.nome_vendedor || raw.vendedor || raw.vendedor_nome || '',
    ).trim();

    const volumesInOrder = stop.required;
    let volumeInOrder = 0;

    stop.lines.forEach((line) => {
      const item = items[line.itemIndex] || {};
      const barcodes = barcodesForLine(item, line.sku, line.required);

      barcodes.forEach((barcode, i) => {
        volumeInOrder += 1;
        labels.push({
          orderId: stop.orderId,
          erp: stop.erp,
          customer: stop.customer,
          address: {
            street: String(address.street || raw.destinatario_endereco || ''),
            neighborhood: String(address.neighborhood || raw.destinatario_bairro || ''),
            city: String(address.city || raw.destinatario_cidade || ''),
            zip: String(address.zip || raw.destinatario_cep || ''),
            complement: String(address.complement || raw.destinatario_complemento || ''),
          },
          sku: line.sku,
          productName: line.name,
          location: line.location,
          seller,
          volumeInOrder,
          volumesInOrder,
          volumeInProduct: i + 1,
          volumesInProduct: line.required,
          barcode: options.includeOrderInBarcode && stop.erp
            ? `${stop.erp}${ORDER_BARCODE_SEPARATOR}${barcode}`
            : barcode,
        });
      });
    });
  });

  return labels;
};
