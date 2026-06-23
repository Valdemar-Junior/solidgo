import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { fitTextSafe, sanitizePdfText, wrapTextSafe } from './pdfTextSanitizer';

export interface WithdrawalReportFilters {
  periodLabel: string;
  presetLabel: string;
  generatedAt: string;
}

export interface WithdrawalReportRow {
  orderIdErp: string;
  customerName: string;
  addressLine: string;
  responsibleName: string;
  registeredByName: string;
  withdrawnAt: string;
  notes?: string | null;
  productsLabel: string;
  assemblyStatusLabel: string;
}

export interface WithdrawalReportData {
  filters: WithdrawalReportFilters;
  rows: WithdrawalReportRow[];
  totalWithdrawals: number;
  assemblyOrders: number;
  generatedAssemblyOrders: number;
  pendingAssemblyOrders: number;
}

type Column = {
  key: keyof WithdrawalReportRow;
  label: string;
  width: number;
};

export class WithdrawalReportGenerator {
  static async generate(data: WithdrawalReportData): Promise<Uint8Array> {
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

    const formatDateTime = (value?: string | null) => {
      if (!value) return '-';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '-';
      return date.toLocaleString('pt-BR');
    };

    const drawHeader = () => {
      drawText('RELATORIO DE RETIRADAS', margin, y, 18, true, rgb(0.28, 0.08, 0.34));
      drawText(`Gerado em ${formatDateTime(data.filters.generatedAt)}`, pageWidth - 240, y + 2, 9, false, rgb(0.45, 0.45, 0.5));
      y -= 24;

      drawText(`Periodo: ${data.filters.periodLabel}`, margin, y, 9, false, rgb(0.35, 0.35, 0.4));
      drawText(`Filtro rapido: ${data.filters.presetLabel}`, margin + 220, y, 9, false, rgb(0.35, 0.35, 0.4));
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
      const items = [
        { label: 'Retiradas', value: data.totalWithdrawals, color: rgb(0.2, 0.26, 0.72) },
        { label: 'Com montagem', value: data.assemblyOrders, color: rgb(0.78, 0.45, 0.08) },
        { label: 'Montagem gerada', value: data.generatedAssemblyOrders, color: rgb(0.07, 0.63, 0.34) },
        { label: 'Montagem pendente', value: data.pendingAssemblyOrders, color: rgb(0.75, 0.22, 0.17) },
      ];

      ensureSpace(82);
      const gap = 10;
      const cardWidth = (pageWidth - margin * 2 - gap * (items.length - 1)) / items.length;
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

    const columns: Column[] = [
      { key: 'orderIdErp', label: 'Pedido', width: 52 },
      { key: 'customerName', label: 'Cliente', width: 100 },
      { key: 'responsibleName', label: 'Conferente', width: 76 },
      { key: 'registeredByName', label: 'Registrado', width: 74 },
      { key: 'withdrawnAt', label: 'Retirada', width: 80 },
      { key: 'assemblyStatusLabel', label: 'Montagem', width: 82 },
      { key: 'productsLabel', label: 'Produtos', width: 145 },
      { key: 'addressLine', label: 'Endereco', width: 146 },
    ];
    const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);

    const drawTableHeader = () => {
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
    };

    const drawTableRow = (row: WithdrawalReportRow) => {
      const lineValues = {
        orderIdErp: row.orderIdErp || '-',
        customerName: row.customerName || '-',
        responsibleName: row.responsibleName || '-',
        registeredByName: row.registeredByName || '-',
        withdrawnAt: row.withdrawnAt ? formatDateTime(row.withdrawnAt) : '-',
        assemblyStatusLabel: row.assemblyStatusLabel || '-',
        productsLabel: row.productsLabel || '-',
        addressLine: row.addressLine || '-',
      };

      const wrappedByColumn = columns.map((column) => {
        const rawValue = lineValues[column.key] || '-';
        if (column.key === 'productsLabel' || column.key === 'addressLine') {
          const wrapped = wrapTextSafe(rawValue, column.width - 8, font, 8).slice(0, 4);
          return wrapped.length > 0 ? wrapped : ['-'];
        }

        return [fitTextSafe(rawValue, column.width - 8, font, 8) || '-'];
      });

      const maxLines = Math.max(...wrappedByColumn.map((lines) => lines.length));
      const lineHeight = 10;
      const contentHeight = Math.max(14, maxLines * lineHeight);
      const notesLines = row.notes
        ? wrapTextSafe(`Obs: ${row.notes}`, tableWidth - 16, font, 7).slice(0, 2)
        : [];
      const notesHeight = notesLines.length > 0 ? notesLines.length * 9 + 4 : 0;
      const rowHeight = contentHeight + notesHeight + 8;

      ensureSpace(rowHeight + 6);

      let x = margin + 4;
      columns.forEach((column, index) => {
        const lines = wrappedByColumn[index];
        lines.forEach((line, lineIndex) => {
          drawText(line, x, y - 2 - lineIndex * lineHeight, 8, false, rgb(0.18, 0.18, 0.2));
        });
        x += column.width;
      });

      y -= contentHeight;

      if (notesLines.length > 0) {
        notesLines.forEach((line, index) => {
          drawText(line, margin + 10, y - 1 - index * 9, 7, false, rgb(0.45, 0.45, 0.5));
        });
        y -= notesHeight;
      }

      page.drawLine({
        start: { x: margin, y: y + 2 },
        end: { x: margin + tableWidth, y: y + 2 },
        thickness: 0.5,
        color: rgb(0.92, 0.94, 0.97),
      });
      y -= 8;
    };

    drawHeader();
    drawSummary();
    drawTableHeader();

    if (data.rows.length === 0) {
      ensureSpace(24);
      drawText('Nenhuma retirada encontrada para o periodo informado.', margin + 6, y - 2, 9, false, rgb(0.45, 0.45, 0.5));
      y -= 22;
    } else {
      data.rows.forEach(drawTableRow);
    }

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
