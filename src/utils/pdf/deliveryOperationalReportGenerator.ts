import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { fitTextSafe, sanitizePdfText } from './pdfTextSanitizer';

export interface DeliveryOperationalReportFilters {
  deliveredStart: string;
  deliveredEnd: string;
  pendingStart: string;
  pendingEnd: string;
  city?: string;
  neighborhood?: string;
  filial?: string;
  driverName?: string;
  routeLabel?: string;
  generatedAt: string;
}

export interface DeliveryOperationalReportRow {
  orderIdErp: string;
  customerName: string;
  city: string;
  neighborhood: string;
  filial: string;
  saleDate?: string | null;
  forecastDate?: string | null;
  routeName?: string | null;
  routeCode?: string | null;
  driverName?: string | null;
  deliveredAt?: string | null;
  notes?: string | null;
}

export interface DeliveryOperationalReportData {
  filters: DeliveryOperationalReportFilters;
  deliveredRows: DeliveryOperationalReportRow[];
  awaitingRouteRows: DeliveryOperationalReportRow[];
  separatingRows: DeliveryOperationalReportRow[];
  inRouteRows: DeliveryOperationalReportRow[];
}

type SummaryItem = {
  label: string;
  value: number;
  color: ReturnType<typeof rgb>;
};

type Column = {
  key: keyof DeliveryOperationalReportRow | 'statusLabel';
  label: string;
  width: number;
};

export class DeliveryOperationalReportGenerator {
  static async generate(data: DeliveryOperationalReportData): Promise<Uint8Array> {
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

    const ensureSpace = (heightNeeded: number) => {
      if (y - heightNeeded < margin) {
        addPage();
      }
    };

    const drawText = (
      text: string,
      x: number,
      yPos: number,
      size = 10,
      bold = false,
      color = rgb(0.18, 0.18, 0.2)
    ) => {
      page.drawText(sanitizePdfText(text), {
        x,
        y: yPos,
        size,
        font: bold ? fontBold : font,
        color,
      });
    };

    const formatDate = (value?: string | null) => {
      if (!value) return '-';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '-';
      return date.toLocaleDateString('pt-BR');
    };

    const formatDateTime = (value?: string | null) => {
      if (!value) return '-';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '-';
      return date.toLocaleString('pt-BR');
    };

    const drawHeader = () => {
      drawText('RELATORIO OPERACIONAL DE ENTREGAS', margin, y, 18, true, rgb(0.08, 0.16, 0.28));
      drawText(`Gerado em ${formatDateTime(data.filters.generatedAt)}`, pageWidth - 240, y + 2, 9, false, rgb(0.45, 0.45, 0.5));
      y -= 24;

      const filtersLine1 = [
        `Entregas: ${formatDate(data.filters.deliveredStart)} a ${formatDate(data.filters.deliveredEnd)}`,
        `Pendencias: ${formatDate(data.filters.pendingStart)} a ${formatDate(data.filters.pendingEnd)}`,
      ];
      const filtersLine2 = [
        `Cidade: ${data.filters.city || 'Todas'}`,
        `Bairro: ${data.filters.neighborhood || 'Todos'}`,
        `Filial: ${data.filters.filial || 'Todas'}`,
        `Motorista: ${data.filters.driverName || 'Todos'}`,
        `Rota: ${data.filters.routeLabel || 'Todas'}`,
      ];

      drawText(filtersLine1.join('   |   '), margin, y, 9, false, rgb(0.35, 0.35, 0.4));
      y -= 14;
      drawText(filtersLine2.join('   |   '), margin, y, 9, false, rgb(0.35, 0.35, 0.4));
      y -= 16;

      page.drawLine({
        start: { x: margin, y },
        end: { x: pageWidth - margin, y },
        thickness: 1,
        color: rgb(0.88, 0.9, 0.93),
      });
      y -= 18;
    };

    const drawSummary = () => {
      const pendingTotal = data.awaitingRouteRows.length + data.separatingRows.length + data.inRouteRows.length;
      const items: SummaryItem[] = [
        { label: 'Entregues', value: data.deliveredRows.length, color: rgb(0.07, 0.63, 0.34) },
        { label: 'Pendentes', value: pendingTotal, color: rgb(0.78, 0.45, 0.08) },
        { label: 'Aguardando rota', value: data.awaitingRouteRows.length, color: rgb(0.81, 0.36, 0.09) },
        { label: 'Em separacao', value: data.separatingRows.length, color: rgb(0.12, 0.43, 0.82) },
        { label: 'Em rota nao entregue', value: data.inRouteRows.length, color: rgb(0.46, 0.24, 0.72) },
      ];

      ensureSpace(90);
      const gap = 10;
      const cardWidth = (pageWidth - margin * 2 - gap * 4) / 5;
      const cardHeight = 58;

      items.forEach((item, index) => {
        const x = margin + (cardWidth + gap) * index;
        page.drawRectangle({
          x,
          y: y - cardHeight,
          width: cardWidth,
          height: cardHeight,
          color: rgb(0.97, 0.98, 0.99),
          borderColor: rgb(0.88, 0.9, 0.93),
          borderWidth: 1,
        });
        drawText(item.label, x + 10, y - 16, 9, true, rgb(0.34, 0.36, 0.4));
        drawText(String(item.value), x + 10, y - 40, 20, true, item.color);
      });

      y -= cardHeight + 24;
    };

    const drawSectionTitle = (title: string, count: number, color: ReturnType<typeof rgb>) => {
      ensureSpace(28);
      page.drawRectangle({
        x: margin,
        y: y - 18,
        width: pageWidth - margin * 2,
        height: 20,
        color: rgb(0.96, 0.97, 0.98),
      });
      drawText(title, margin + 10, y - 5, 11, true, color);
      drawText(`${count} pedido(s) unicos`, pageWidth - margin - 126, y - 5, 9, true, rgb(0.38, 0.4, 0.44));
      y -= 28;
    };

    const drawTable = (
      rows: DeliveryOperationalReportRow[],
      statusLabel: string,
      color: ReturnType<typeof rgb>
    ) => {
      const columns: Column[] = [
        { key: 'orderIdErp', label: 'Pedido', width: 60 },
        { key: 'customerName', label: 'Cliente', width: 156 },
        { key: 'city', label: 'Cidade', width: 88 },
        { key: 'forecastDate', label: 'Prev. entrega', width: 70 },
        { key: 'routeName', label: 'Rota', width: 138 },
        { key: 'driverName', label: 'Motorista', width: 110 },
        { key: 'statusLabel', label: 'Status', width: 92 },
        { key: 'deliveredAt', label: 'Data ref.', width: 70 },
      ];

      const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);

      ensureSpace(22);
      page.drawRectangle({
        x: margin,
        y: y - 16,
        width: tableWidth,
        height: 18,
        color: rgb(0.92, 0.94, 0.97),
      });

      let currentX = margin + 4;
      columns.forEach((column) => {
        drawText(column.label, currentX, y - 5, 7, true, rgb(0.34, 0.36, 0.4));
        currentX += column.width;
      });
      y -= 20;

      if (rows.length === 0) {
        ensureSpace(24);
        drawText('Nenhum pedido encontrado para este grupo.', margin + 6, y - 2, 9, false, rgb(0.45, 0.45, 0.5));
        y -= 22;
        return;
      }

      rows.forEach((row) => {
        ensureSpace(18);
        let x = margin + 4;
        const values: Record<string, string> = {
          orderIdErp: row.orderIdErp || '-',
          customerName: row.customerName || '-',
          city: row.city || '-',
          forecastDate: formatDate(row.forecastDate),
          routeName: row.routeCode ? `${row.routeCode} - ${row.routeName || '-'}` : row.routeName || '-',
          driverName: row.driverName || '-',
          statusLabel,
          deliveredAt: row.deliveredAt ? formatDate(row.deliveredAt) : '-',
        };

        columns.forEach((column) => {
          const maxWidth = column.width - 8;
          const value = fitTextSafe(values[column.key] || '-', maxWidth, font, 8);
          drawText(value, x, y - 2, 8, false, column.key === 'statusLabel' ? color : rgb(0.18, 0.18, 0.2));
          x += column.width;
        });

        y -= 14;

        if (row.notes) {
          ensureSpace(14);
          drawText(`Obs: ${row.notes}`, margin + 10, y - 1, 7, false, rgb(0.45, 0.45, 0.5));
          y -= 12;
        }

        page.drawLine({
          start: { x: margin, y: y + 2 },
          end: { x: margin + tableWidth, y: y + 2 },
          thickness: 0.5,
          color: rgb(0.92, 0.94, 0.97),
        });
      });

      y -= 8;
    };

    drawHeader();
    drawSummary();

    drawSectionTitle('Entregues no periodo', data.deliveredRows.length, rgb(0.07, 0.63, 0.34));
    drawTable(data.deliveredRows, 'Entregue', rgb(0.07, 0.63, 0.34));

    drawSectionTitle('Aguardando rota', data.awaitingRouteRows.length, rgb(0.81, 0.36, 0.09));
    drawTable(data.awaitingRouteRows, 'Aguardando rota', rgb(0.81, 0.36, 0.09));

    drawSectionTitle('Em separacao', data.separatingRows.length, rgb(0.12, 0.43, 0.82));
    drawTable(data.separatingRows, 'Em separacao', rgb(0.12, 0.43, 0.82));

    drawSectionTitle('Em rota nao entregue', data.inRouteRows.length, rgb(0.46, 0.24, 0.72));
    drawTable(data.inRouteRows, 'Em rota', rgb(0.46, 0.24, 0.72));

    const pages = pdfDoc.getPages();
    pages.forEach((pdfPage, index) => {
      pdfPage.drawText(`Pagina ${index + 1} de ${pages.length}`, {
        x: pageWidth - margin - 70,
        y: 14,
        size: 8,
        font,
        color: rgb(0.55, 0.55, 0.6),
      });
    });

    return pdfDoc.save();
  }
}
