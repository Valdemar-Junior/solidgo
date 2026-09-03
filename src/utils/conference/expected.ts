/**
 * Regras puras da conferência de mercadoria (coletor).
 *
 * Ficam fora da tela pra poder testar sem navegador: é aqui que se decide
 * "quantos volumes deste produto vão nesta rota" e "esta etiqueta bipada é
 * de qual produto".
 */

/** Uma linha de produto do pedido: quantos volumes precisam ser bipados. */
export type ExpectedLine = {
  key: string;            // orderId|sku|indice
  orderId: string;
  sku: string;            // como aparece na etiqueta
  skuNorm: string;
  name: string;
  location: string;
  required: number;       // volumes esperados NESTA rota (já descontando devolução)
  codes: string[];        // etiquetas aceitas (normalizadas)
  erpLabels: string[];    // etiquetas do ERP como vieram, na ordem (pode vir vazio)
};

/** Uma parada = um pedido da rota. */
export type Stop = {
  orderId: string;
  routeOrderId: string;
  sequence: number;
  erp: string;
  customer: string;
  lines: ExpectedLine[];
  required: number;
};

/** Tolera ';' no lugar de '/', espaços e caixa alta. Não remove sufixos aqui. */
export const normalizeScan = (raw: string) =>
  String(raw || '').trim().replace(/[；;]/g, '/').replace(/\s+/g, '').toLowerCase();

/** Parte do código depois do "x/y-": normalmente o código do produto. */
export const productPart = (norm: string) => {
  const i = norm.indexOf('-');
  return i === -1 ? norm : norm.slice(i + 1);
};

/**
 * Acha a linha do produto para um código lido.
 * 1) etiqueta exata; 2) código do produto exato; 3) tirando sufixos numéricos
 *    de impressão (um por vez).
 *
 * `exact: true` significa que bateu com a etiqueta inteira — só nesse caso dá
 * pra afirmar que uma segunda leitura igual é volume repetido.
 */
export const matchLine = (norm: string, lines: ExpectedLine[]): { line: ExpectedLine; exact: boolean } | null => {
  const byLabel = lines.find((l) => l.codes.includes(norm));
  if (byLabel) return { line: byLabel, exact: true };

  let prod = productPart(norm);
  while (prod) {
    const hit = lines.find((l) => l.skuNorm === prod);
    if (hit) return { line: hit, exact: false };
    const i = prod.lastIndexOf('-');
    if (i <= 0) break;
    const tail = prod.slice(i + 1);
    if (!/^\d+$/.test(tail)) break;
    prod = prod.slice(0, i);
  }
  return null;
};

/**
 * Monta as paradas (pedidos) e os volumes esperados de cada uma.
 *
 * `snapshot` = linhas de `route_order_items` da rota. Quando existe, ele manda:
 * `allocated_quantity` é o que realmente foi separado pra esta rota, já sem o
 * que o cliente devolveu. Sem snapshot, cai na quantidade comprada.
 */
export const buildStops = (route: any, snapshot: any[]): Stop[] => {
  const snapByOrder = new Map<string, any[]>();
  (snapshot || []).forEach((s) => {
    const k = String(s.order_id);
    if (!snapByOrder.has(k)) snapByOrder.set(k, []);
    snapByOrder.get(k)!.push(s);
  });

  const stops: Stop[] = [];
  const ros = [...(route?.route_orders || [])]
    .filter((ro: any) => !['cancelled', 'removed'].includes(String(ro?.status || '')))
    .sort((a: any, b: any) => (a.sequence || 0) - (b.sequence || 0));

  ros.forEach((ro: any) => {
    const o = ro.order;
    if (!o) return;
    const orderId = String(o.id);
    const snap = snapByOrder.get(orderId) || [];
    const items = Array.isArray(o.items_json) ? o.items_json : [];
    const lines: ExpectedLine[] = [];

    items.forEach((it: any, idx: number) => {
      const sku = String(it?.sku || '').trim();
      if (!sku) return;
      const skuNorm = sku.toLowerCase();

      const totalVolumes = Number(it?.quantity ?? it?.volumes_per_unit ?? 0) || 0;
      const purchased = Number(it?.purchased_quantity ?? 0) || 1;
      const perUnit = totalVolumes > 0 ? totalVolumes / purchased : 1;

      const snapRow = snap.find((s) => String(s.sku_snapshot || '').toLowerCase() === skuNorm);
      const qty = snapRow ? Number(snapRow.allocated_quantity ?? 0) : purchased;
      const required = Math.max(0, Math.round(perUnit * qty));
      if (required === 0) return; // não vai nesta rota

      // Guardamos as etiquetas do ERP como vieram (a impressão usa esse texto)
      // e normalizadas (a leitura do coletor compara assim).
      const erpLabels: string[] = Array.isArray(it?.labels)
        ? it.labels.map((l: any) => String(l || '').trim()).filter(Boolean)
        : [];
      const erpLabelsNorm = erpLabels.map((l) => normalizeScan(l)).filter(Boolean);
      const generated = Array.from({ length: required }, (_, i) => `${i + 1}/${required}-${skuNorm}`);
      const codes = Array.from(new Set([...erpLabelsNorm, ...generated]));

      lines.push({
        key: `${orderId}|${skuNorm}|${idx}`,
        orderId,
        sku,
        skuNorm,
        name: String(it?.name || ''),
        location: String(it?.location || ''),
        required,
        codes,
        erpLabels,
      });
    });

    stops.push({
      orderId,
      routeOrderId: String(ro.id),
      sequence: Number(ro.sequence || 0),
      erp: String(o.order_id_erp || ''),
      customer: String(o.customer_name || ''),
      lines,
      required: lines.reduce((acc, l) => acc + l.required, 0),
    });
  });

  return stops;
};

/** Pedidos (diferentes do aberto) que contêm o código lido. */
export const findOtherStops = (norm: string, stops: Stop[], currentOrderId: string) =>
  stops.filter((s) => s.orderId !== currentOrderId && matchLine(norm, s.lines));
