import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { fitTextSafe, sanitizePdfText } from './pdfTextSanitizer';

export type AssemblyGoalRouteBreakdown = {
  routeId: string;
  routeName: string;
  routeCode?: string | null;
  completedAt: string;
  received: number;
  delivered: number;
  returned: number;
};

export type AssemblyGoalPersonRow = {
  personId: string;
  personName: string;
  personType: string;
  received: number;
  delivered: number;
  returned: number;
  quantityTarget: number;
  quantityTargetMet: boolean;
  performancePercent: number;
  performanceTargetMet: boolean;
  finalResult: 'Meta Atingida' | 'Meta Atingida por Desempenho' | 'Meta Nao Atingida';
  analysis: string;
  routes: AssemblyGoalRouteBreakdown[];
};

export type AssemblyGoalWeekSection = {
  label: string;
  rows: AssemblyGoalPersonRow[];
};

export type AssemblyGoalReportData = {
  periodLabel: string;
  viewLabel: string;
  peopleLabel?: string;
  quantityTarget: number;
  performanceDeliveryTarget: number;
  performancePercentTarget: number;
  weeklyTarget: number;
  showRouteDetails?: boolean;
  generatedAt: string;
  weeklySections: AssemblyGoalWeekSection[];
  monthlyRows: AssemblyGoalPersonRow[];
};

type SummaryCard = {
  label: string;
  value: number;
  color: ReturnType<typeof rgb>;
};

export class AssemblyGoalReportGenerator {
  static async generate(data: AssemblyGoalReportData): Promise<Uint8Array> {
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
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return '-';
      return parsed.toLocaleString('pt-BR');
    };

    const formatPercent = (value: number) => `${value.toFixed(2).replace('.', ',')}%`;

    const resultColor = (result: AssemblyGoalPersonRow['finalResult']) => {
      if (result === 'Meta Atingida') return rgb(0.07, 0.63, 0.34);
      if (result === 'Meta Atingida por Desempenho') return rgb(0.12, 0.43, 0.82);
      return rgb(0.75, 0.22, 0.17);
    };

    const drawHeader = () => {
      drawText('RELATORIO DE META DE MONTAGEM', margin, y, 18, true, rgb(0.08, 0.16, 0.28));
      drawText(`Gerado em ${formatDateTime(data.generatedAt)}`, pageWidth - 240, y + 2, 9, false, rgb(0.45, 0.45, 0.5));
      y -= 24;

      drawText(`Periodo: ${data.periodLabel}`, margin, y, 9, false, rgb(0.35, 0.35, 0.4));
      drawText(`Visao: ${data.viewLabel}`, margin + 170, y, 9, false, rgb(0.35, 0.35, 0.4));
      drawText(`Montadores: ${data.peopleLabel || 'Todos'}`, margin + 320, y, 9, false, rgb(0.35, 0.35, 0.4));
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
      const approved = data.monthlyRows.filter((row) => row.finalResult === 'Meta Atingida').length;
      const approvedByPerformance = data.monthlyRows.filter((row) => row.finalResult === 'Meta Atingida por Desempenho').length;
      const failed = data.monthlyRows.filter((row) => row.finalResult === 'Meta Nao Atingida').length;
      const totalReceived = data.monthlyRows.reduce((sum, row) => sum + row.received, 0);
      const cards: SummaryCard[] = [
        { label: 'Montadores avaliados', value: data.monthlyRows.length, color: rgb(0.18, 0.18, 0.2) },
        { label: 'Meta atingida', value: approved, color: rgb(0.07, 0.63, 0.34) },
        { label: 'Atingida por desempenho', value: approvedByPerformance, color: rgb(0.12, 0.43, 0.82) },
        { label: 'Meta nao atingida', value: failed, color: rgb(0.75, 0.22, 0.17) },
        { label: 'Recebido no periodo', value: totalReceived, color: rgb(0.78, 0.45, 0.08) },
      ];

      ensureSpace(92);
      const gap = 10;
      const cardWidth = (pageWidth - margin * 2 - gap * (cards.length - 1)) / cards.length;
      const cardHeight = 58;

      cards.forEach((card, index) => {
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
        drawText(card.label, x + 10, y - 16, 8, true, rgb(0.34, 0.36, 0.4));
        drawText(String(card.value), x + 10, y - 40, 20, true, card.color);
      });

      y -= cardHeight + 20;
    };

    const drawSectionTitle = (title: string) => {
      ensureSpace(28);
      page.drawRectangle({
        x: margin,
        y: y - 18,
        width: pageWidth - margin * 2,
        height: 20,
        color: rgb(0.96, 0.97, 0.98),
      });
      drawText(title, margin + 10, y - 5, 11, true, rgb(0.16, 0.18, 0.24));
      y -= 28;
    };

    const drawTable = (rows: AssemblyGoalPersonRow[]) => {
      const columns = [
        { key: 'personName', label: 'Pessoa', width: 128 },
        { key: 'personType', label: 'Tipo', width: 54 },
        { key: 'received', label: 'Recebido', width: 58 },
        { key: 'delivered', label: 'Montado', width: 58 },
        { key: 'returned', label: 'Retornado', width: 60 },
        { key: 'quantity', label: 'Meta qtd.', width: 72 },
        { key: 'performance', label: '% desempenho', width: 78 },
        { key: 'perfMet', label: 'Meta desp.', width: 70 },
        { key: 'result', label: 'Resultado', width: 120 },
      ] as const;

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
        drawText('Nenhum registro encontrado para este periodo.', margin + 6, y - 2, 9, false, rgb(0.45, 0.45, 0.5));
        y -= 22;
        return;
      }

      rows.forEach((row) => {
        const rowHeight = 28;
        ensureSpace(rowHeight);

        let x = margin + 4;
        const values = {
          personName: fitTextSafe(row.personName, 120, font, 8),
          personType: fitTextSafe(row.personType, 46, font, 8),
          received: String(row.received),
          delivered: String(row.delivered),
          returned: String(row.returned),
          quantity: row.quantityTargetMet ? 'Sim' : 'Nao',
          performance: formatPercent(row.performancePercent),
          perfMet: row.performanceTargetMet ? 'Sim' : 'Nao',
          result: fitTextSafe(
            row.finalResult === 'Meta Nao Atingida' ? 'Meta nao atingida' : row.finalResult,
            112,
            font,
            8
          ),
        };

        columns.forEach((column) => {
          const rawValue = values[column.key as keyof typeof values] || '-';
          drawText(
            rawValue,
            x,
            y - 2,
            8,
            false,
            column.key === 'result' ? resultColor(row.finalResult) : rgb(0.18, 0.18, 0.2)
          );
          x += column.width;
        });

        y -= 14;
        y -= 8;

        page.drawLine({
          start: { x: margin, y: y + 2 },
          end: { x: margin + tableWidth, y: y + 2 },
          thickness: 0.5,
          color: rgb(0.92, 0.94, 0.97),
        });
      });

      y -= 8;
    };

    const drawRouteDetails = (title: string, rows: AssemblyGoalPersonRow[]) => {
      if (!data.showRouteDetails) return;

      rows.forEach((row) => {
        if (row.routes.length === 0) return;

        ensureSpace(24);
        drawText(`${title} - ${row.personName}`, margin, y, 10, true, rgb(0.16, 0.18, 0.24));
        y -= 14;

        row.routes.forEach((route) => {
          ensureSpace(18);
          const label = route.routeCode ? `${route.routeCode} - ${route.routeName}` : route.routeName;
          drawText(
            `${label} | Finalizada em ${formatDateTime(route.completedAt)} | ${route.received}/${route.delivered}/${route.returned}`,
            margin + 8,
            y,
            8,
            false,
            rgb(0.35, 0.35, 0.4)
          );
          y -= 12;
        });

        y -= 8;
      });
    };

    drawHeader();
    drawSummary();
    drawSectionTitle(
      `Consolidado mensal - quantidade: ${data.quantityTarget} | desempenho: ${data.performanceDeliveryTarget} e ${data.performancePercentTarget}%`
    );
    drawTable(data.monthlyRows);
    drawRouteDetails('Rotas do consolidado', data.monthlyRows);

    data.weeklySections.forEach((section) => {
      drawSectionTitle(`${section.label} - meta: ${data.weeklyTarget} montagens`);
      drawTable(section.rows);
      drawRouteDetails(section.label, section.rows);
    });

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
