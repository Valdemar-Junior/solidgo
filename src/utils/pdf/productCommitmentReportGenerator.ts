import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { fitTextSafe, sanitizePdfText } from './pdfTextSanitizer';

export type ProductCommitmentStatus = 'awaiting_route' | 'separating' | 'in_route' | 'delivered';

export type ProductCommitmentReportRow = {
  order_id: string;
  order_id_erp: string;
  customer_name: string;
  phone?: string | null;
  sale_date?: string | null;
  forecast_date?: string | null;
  branch?: string | null;
  seller_name?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  product_sku: string;
  product_name: string;
  storage_location?: string | null;
  purchased_quantity: number | string;
  product_reserved_units?: number | string | null;
  product_delivered_units?: number | string | null;
  unit_price?: number | string | null;
  report_status: ProductCommitmentStatus;
  route_id?: string | null;
  route_code?: string | null;
  route_name?: string | null;
  route_status?: string | null;
  driver_name?: string | null;
  delivered_at?: string | null;
};

export type ProductCommitmentReportSummary = {
  reservedUnits: number;
  deliveredUnits: number;
  awaitingRouteUnits: number;
  separatingUnits: number;
  inRouteUnits: number;
  totalRecords: number;
  distinctProducts: number;
  page: number;
  pageSize: number;
};

type ProductCommitmentReportData = {
  rows: ProductCommitmentReportRow[];
  summary: ProductCommitmentReportSummary;
  filters: {
    search: string;
    situations: Array<'reserved' | 'delivered'>;
    storageLocations: string[];
    periodLabel: string;
    page: number;
    totalPages: number;
    generatedAt: string;
  };
};

const STATUS_LABEL: Record<ProductCommitmentStatus, string> = {
  awaiting_route: 'Aguardando rota',
  separating: 'Em separacao',
  in_route: 'Em rota',
  delivered: 'Entregue',
};

export class ProductCommitmentReportGenerator {
  static async generate(data: ProductCommitmentReportData): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    const pageSize: [number, number] = [841.89, 595.28];
    let page = pdfDoc.addPage(pageSize);
    const [pageWidth, pageHeight] = pageSize;
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const margin = 28;
    let y = pageHeight - margin;

    const addPage = () => {
      page = pdfDoc.addPage(pageSize);
      y = pageHeight - margin;
    };

    const ensureSpace = (needed: number) => {
      if (y - needed < margin) addPage();
    };

    const drawText = (text: string, x: number, yPos: number, size = 9, bold = false, color = rgb(0.18, 0.18, 0.2)) => {
      page.drawText(sanitizePdfText(text), { x, y: yPos, size, font: bold ? fontBold : font, color });
    };

    const formatDate = (value?: string | null) => {
      if (!value) return '-';
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleDateString('pt-BR');
    };

    const formatQuantity = (value: number | string) => {
      const parsed = Number(value || 0);
      return Number.isInteger(parsed) ? String(parsed) : parsed.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    };

    drawText('RELATORIO DE PRODUTOS COMPROMETIDOS', margin, y, 17, true, rgb(0.08, 0.16, 0.28));
    drawText(`Gerado em ${new Date(data.filters.generatedAt).toLocaleString('pt-BR')}`, pageWidth - 220, y + 2, 8, false, rgb(0.45, 0.45, 0.5));
    y -= 22;
    drawText(`Periodo de venda: ${data.filters.periodLabel}`, margin, y, 9, false, rgb(0.35, 0.35, 0.4));
    drawText(`Produto: ${data.filters.search || 'Todos'}`, margin + 260, y, 9, false, rgb(0.35, 0.35, 0.4));
    drawText(`Pagina consultada: ${data.filters.page}/${data.filters.totalPages}`, pageWidth - 185, y, 9, false, rgb(0.35, 0.35, 0.4));
    y -= 14;
    drawText(
      fitTextSafe(`Local de estocagem: ${data.filters.storageLocations.join(', ') || 'Todos'}`, pageWidth - margin * 2, font, 8),
      margin,
      y,
      8,
      false,
      rgb(0.35, 0.35, 0.4)
    );
    y -= 18;

    const cards = [
      ['Reservadas', formatQuantity(data.summary.reservedUnits)],
      ['Entregues', formatQuantity(data.summary.deliveredUnits)],
      ['Aguardando rota', formatQuantity(data.summary.awaitingRouteUnits)],
      ['Em separacao', formatQuantity(data.summary.separatingUnits)],
      ['Em rota', formatQuantity(data.summary.inRouteUnits)],
    ];
    const gap = 8;
    const cardWidth = (pageWidth - margin * 2 - gap * (cards.length - 1)) / cards.length;
    cards.forEach(([label, value], index) => {
      const x = margin + index * (cardWidth + gap);
      page.drawRectangle({ x, y: y - 42, width: cardWidth, height: 44, color: rgb(0.97, 0.98, 0.99), borderColor: rgb(0.88, 0.9, 0.93), borderWidth: 1 });
      drawText(label, x + 8, y - 14, 7, true, rgb(0.4, 0.42, 0.46));
      drawText(value, x + 8, y - 33, 16, true, rgb(0.1, 0.25, 0.45));
    });
    y -= 58;

    const columns = [
      { key: 'product', label: 'Produto', width: 130 },
      { key: 'sku', label: 'SKU', width: 55 },
      { key: 'location', label: 'Local estoque', width: 75 },
      { key: 'quantity', label: 'Qtd.', width: 32 },
      { key: 'status', label: 'Situacao', width: 70 },
      { key: 'customer', label: 'Cliente', width: 105 },
      { key: 'order', label: 'Pedido', width: 58 },
      { key: 'sale', label: 'Venda', width: 48 },
      { key: 'forecast', label: 'Previsao', width: 52 },
      { key: 'route', label: 'Rota', width: 130 },
    ] as const;
    const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);

    const drawHeader = () => {
      page.drawRectangle({ x: margin, y: y - 15, width: tableWidth, height: 17, color: rgb(0.92, 0.94, 0.97) });
      let x = margin + 3;
      columns.forEach((column) => {
        drawText(column.label, x, y - 4, 7, true, rgb(0.34, 0.36, 0.4));
        x += column.width;
      });
      y -= 20;
    };

    drawHeader();
    data.rows.forEach((row) => {
      if (y - 24 < margin) {
        addPage();
        drawHeader();
      }
      ensureSpace(24);
      const route = row.route_code || row.route_name
        ? `${row.route_code || ''}${row.route_code && row.route_name ? ' - ' : ''}${row.route_name || ''}`
        : '-';
      const values = {
        product: fitTextSafe(row.product_name, 123, font, 7.5),
        sku: fitTextSafe(row.product_sku, 48, font, 7.5),
        location: fitTextSafe(row.storage_location || 'Sem local', 68, font, 7.5),
        quantity: formatQuantity(row.purchased_quantity),
        status: STATUS_LABEL[row.report_status] || '-',
        customer: fitTextSafe(row.customer_name, 98, font, 7.5),
        order: fitTextSafe(row.order_id_erp, 51, font, 7.5),
        sale: formatDate(row.sale_date),
        forecast: formatDate(row.forecast_date),
        route: fitTextSafe(route, 123, font, 7.5),
      };
      let x = margin + 3;
      columns.forEach((column) => {
        drawText(values[column.key], x, y - 2, 7.5);
        x += column.width;
      });
      y -= 18;
      page.drawLine({ start: { x: margin, y: y + 3 }, end: { x: margin + tableWidth, y: y + 3 }, thickness: 0.4, color: rgb(0.92, 0.94, 0.97) });
    });

    if (data.rows.length === 0) drawText('Nenhum produto encontrado.', margin + 4, y - 4, 9, false, rgb(0.45, 0.45, 0.5));

    pdfDoc.getPages().forEach((pdfPage, index, pages) => {
      pdfPage.drawText(`Pagina PDF ${index + 1} de ${pages.length}`, { x: pageWidth - margin - 90, y: 14, size: 8, font, color: rgb(0.55, 0.55, 0.6) });
    });

    return pdfDoc.save();
  }
}
