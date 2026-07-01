import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { fitTextSafe, sanitizePdfText } from './pdfTextSanitizer';

export interface AssemblyOperationalReportFilters {
  includeCompleted?: boolean;
  completedStart: string;
  completedEnd: string;
  pendingStart: string;
  pendingEnd: string;
  city?: string;
  neighborhood?: string;
  filial?: string;
  importSourceLabel?: string;
  serviceTypeLabel?: string;
  installerName?: string;
  routeLabel?: string;
  sortLabel?: string;
  generatedAt: string;
}

export interface AssemblyOperationalReportRow {
  orderIdErp: string;
  customerName: string;
  city: string;
  neighborhood: string;
  filial: string;
  saleDate?: string | null;
  forecastDate?: string | null;
  routeName?: string | null;
  routeCode?: string | null;
  installerName?: string | null;
  referenceDate?: string | null;
  notes?: string | null;
}

export interface AssemblyOperationalReportData {
  filters: AssemblyOperationalReportFilters;
  completedRows: AssemblyOperationalReportRow[];
  awaitingRouteRows: AssemblyOperationalReportRow[];
  routeCreatedRows: AssemblyOperationalReportRow[];
  inProgressRows: AssemblyOperationalReportRow[];
}

type SummaryItem = {
  label: string;
  value: number;
  color: ReturnType<typeof rgb>;
};

type Column = {
  key: keyof AssemblyOperationalReportRow | 'statusLabel' | 'deadlineStatus';
  label: string;
  width: number;
};

export class AssemblyOperationalReportGenerator {
  static async generate(data: AssemblyOperationalReportData): Promise<Uint8Array> {
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
      const normalizedValue = String(value).trim();
      const dateOnlyMatch = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dateOnlyMatch) {
        const [, year, month, day] = dateOnlyMatch;
        return `${day}/${month}/${year}`;
      }

      const isoMatch = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})T/);
      if (isoMatch) {
        const [, year, month, day] = isoMatch;
        return `${day}/${month}/${year}`;
      }

      const date = new Date(normalizedValue);
      if (Number.isNaN(date.getTime())) return '-';
      return date.toLocaleDateString('pt-BR');
    };

    const formatDateTime = (value?: string | null) => {
      if (!value) return '-';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '-';
      return date.toLocaleString('pt-BR');
    };

    const isOverdue = (value?: string | null) => {
      if (!value) return false;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return false;

      const forecastDate = date.toISOString().slice(0, 10);
      const today = new Date();
      const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())
        .toISOString()
        .slice(0, 10);

      return forecastDate < todayDate;
    };

    const toDateOnly = (value?: string | null) => {
      if (!value) return null;
      const normalizedValue = String(value).trim();
      const isoDate = normalizedValue.match(/^(\d{4}-\d{2}-\d{2})/);
      if (isoDate) return isoDate[1];

      const date = new Date(normalizedValue);
      if (Number.isNaN(date.getTime())) return null;
      return date.toISOString().slice(0, 10);
    };

    const getDeadlineStatus = (row: AssemblyOperationalReportRow) => {
      const forecastDate = toDateOnly(row.forecastDate);
      if (!forecastDate) return 'SEM PREVISAO';

      const comparisonDate = toDateOnly(row.referenceDate || data.filters.generatedAt);
      if (!comparisonDate) return 'SEM PREVISAO';
      return comparisonDate <= forecastDate ? 'DENTRO DO PRAZO' : 'FORA DO PRAZO';
    };

    const drawHeader = () => {
      drawText('RELATORIO OPERACIONAL DE MONTAGENS', margin, y, 18, true, rgb(0.19, 0.12, 0.04));
      drawText(`Gerado em ${formatDateTime(data.filters.generatedAt)}`, pageWidth - 240, y + 2, 9, false, rgb(0.45, 0.45, 0.5));
      y -= 24;

      const pendingLabel =
        data.filters.pendingStart || data.filters.pendingEnd
          ? `${formatDate(data.filters.pendingStart)} a ${formatDate(data.filters.pendingEnd)}`
          : 'Fila atual completa';

      const filtersLine1 = [
        data.filters.includeCompleted
          ? `Concluidas: ${formatDate(data.filters.completedStart)} a ${formatDate(data.filters.completedEnd)}`
          : 'Concluidas: nao consideradas',
        `Pendencias: ${pendingLabel}`,
      ];
      const filtersLine2 = [
        `Cidade: ${data.filters.city || 'Todas'}`,
        `Bairro: ${data.filters.neighborhood || 'Todos'}`,
        `Filial: ${data.filters.filial || 'Todas'}`,
        `Origem: ${data.filters.importSourceLabel || 'Todas'}`,
        `Tipo: ${data.filters.serviceTypeLabel || 'Todos'}`,
      ];
      const filtersLine3 = [
        `Montador: ${data.filters.installerName || 'Todos'}`,
        `Rota: ${data.filters.routeLabel || 'Todas'}`,
      ];
      const filtersLine4 = `Ordenacao: ${data.filters.sortLabel || 'Data da venda: mais velha para mais nova'}`;

      drawText(filtersLine1.join('   |   '), margin, y, 9, false, rgb(0.35, 0.35, 0.4));
      y -= 14;
      drawText(filtersLine2.join('   |   '), margin, y, 9, false, rgb(0.35, 0.35, 0.4));
      y -= 14;
      drawText(filtersLine3.join('   |   '), margin, y, 9, false, rgb(0.35, 0.35, 0.4));
      y -= 14;
      drawText(filtersLine4, margin, y, 9, false, rgb(0.35, 0.35, 0.4));
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
      const pendingTotal =
        data.awaitingRouteRows.length + data.routeCreatedRows.length + data.inProgressRows.length;
      const items: SummaryItem[] = data.filters.includeCompleted
        ? [
            { label: 'Concluidas', value: data.completedRows.length, color: rgb(0.07, 0.63, 0.34) },
            { label: 'Pendentes', value: pendingTotal, color: rgb(0.78, 0.45, 0.08) },
            { label: 'Aguardando rota', value: data.awaitingRouteRows.length, color: rgb(0.81, 0.36, 0.09) },
            { label: 'Rota criada', value: data.routeCreatedRows.length, color: rgb(0.12, 0.43, 0.82) },
            { label: 'Em montagem', value: data.inProgressRows.length, color: rgb(0.46, 0.24, 0.72) },
          ]
        : [
            { label: 'Pendentes', value: pendingTotal, color: rgb(0.78, 0.45, 0.08) },
            { label: 'Aguardando rota', value: data.awaitingRouteRows.length, color: rgb(0.81, 0.36, 0.09) },
            { label: 'Rota criada', value: data.routeCreatedRows.length, color: rgb(0.12, 0.43, 0.82) },
            { label: 'Em montagem', value: data.inProgressRows.length, color: rgb(0.46, 0.24, 0.72) },
          ];

      const overdueItems: SummaryItem[] = [
        {
          label: 'Fora do prazo aguardando rota',
          value: data.awaitingRouteRows.filter((row) => isOverdue(row.forecastDate)).length,
          color: rgb(0.75, 0.22, 0.17),
        },
        {
          label: 'Fora do prazo com rota criada',
          value: data.routeCreatedRows.filter((row) => isOverdue(row.forecastDate)).length,
          color: rgb(0.75, 0.22, 0.17),
        },
        {
          label: 'Fora do prazo em montagem',
          value: data.inProgressRows.filter((row) => isOverdue(row.forecastDate)).length,
          color: rgb(0.75, 0.22, 0.17),
        },
      ];

      ensureSpace(176);
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

      y -= cardHeight + 18;

      drawText('Pendencias fora do prazo', margin, y, 11, true, rgb(0.75, 0.22, 0.17));
      y -= 12;

      const overdueGap = 12;
      const overdueCardWidth = (pageWidth - margin * 2 - overdueGap * 2) / 3;
      const overdueCardHeight = 54;

      overdueItems.forEach((item, index) => {
        const x = margin + (overdueCardWidth + overdueGap) * index;
        page.drawRectangle({
          x,
          y: y - overdueCardHeight,
          width: overdueCardWidth,
          height: overdueCardHeight,
          color: rgb(1, 0.97, 0.96),
          borderColor: rgb(0.96, 0.83, 0.8),
          borderWidth: 1,
        });
        drawText(item.label, x + 10, y - 16, 9, true, rgb(0.44, 0.2, 0.17));
        drawText(String(item.value), x + 10, y - 38, 19, true, item.color);
      });

      y -= overdueCardHeight + 24;
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
      rows: AssemblyOperationalReportRow[],
      statusLabel: string,
      color: ReturnType<typeof rgb>
    ) => {
      const columns: Column[] = [
        { key: 'orderIdErp', label: 'Pedido', width: 60 },
        { key: 'customerName', label: 'Cliente', width: 116 },
        { key: 'city', label: 'Cidade', width: 60 },
        { key: 'saleDate', label: 'Data venda', width: 62 },
        { key: 'forecastDate', label: 'Prev. montagem', width: 70 },
        { key: 'routeName', label: 'Rota', width: 86 },
        { key: 'installerName', label: 'Montador', width: 74 },
        { key: 'statusLabel', label: 'Status', width: 72 },
        { key: 'deadlineStatus', label: 'Situacao prazo', width: 92 },
        { key: 'referenceDate', label: 'Data ref.', width: 64 },
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
          saleDate: formatDate(row.saleDate),
          forecastDate: formatDate(row.forecastDate),
          routeName: row.routeCode ? `${row.routeCode} - ${row.routeName || '-'}` : row.routeName || '-',
          installerName: row.installerName || '-',
          statusLabel,
          deadlineStatus: getDeadlineStatus(row),
          referenceDate: row.referenceDate ? formatDate(row.referenceDate) : '-',
        };

        columns.forEach((column) => {
          const maxWidth = column.width - 8;
          const rawValue = values[column.key] || '-';
          const value = fitTextSafe(rawValue, maxWidth, font, 8);
          let textColor = column.key === 'statusLabel' ? color : rgb(0.18, 0.18, 0.2);
          if (column.key === 'deadlineStatus') {
            textColor = rawValue === 'DENTRO DO PRAZO'
              ? rgb(0.07, 0.55, 0.29)
              : rawValue === 'FORA DO PRAZO'
                ? rgb(0.75, 0.22, 0.17)
                : rgb(0.45, 0.45, 0.5);
          }
          drawText(value, x, y - 2, 8, false, textColor);
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

    if (data.filters.includeCompleted) {
      drawSectionTitle('Montagens concluidas no periodo', data.completedRows.length, rgb(0.07, 0.63, 0.34));
      drawTable(data.completedRows, 'Concluida', rgb(0.07, 0.63, 0.34));
    }

    drawSectionTitle('Aguardando rota', data.awaitingRouteRows.length, rgb(0.81, 0.36, 0.09));
    drawTable(data.awaitingRouteRows, 'Aguardando rota', rgb(0.81, 0.36, 0.09));

    drawSectionTitle('Rota criada', data.routeCreatedRows.length, rgb(0.12, 0.43, 0.82));
    drawTable(data.routeCreatedRows, 'Rota criada', rgb(0.12, 0.43, 0.82));

    drawSectionTitle('Em montagem', data.inProgressRows.length, rgb(0.46, 0.24, 0.72));
    drawTable(data.inProgressRows, 'Em montagem', rgb(0.46, 0.24, 0.72));

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
