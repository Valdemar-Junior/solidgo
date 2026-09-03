import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import { code128Bars, code128ModuleCount, sanitizeCode128 } from '../labels/code128';
import type { ExpeditionLabel } from '../labels/expeditionLabels';
import { fitTextSafe, sanitizePdfText, wrapTextSafe } from './pdfTextSanitizer';

/**
 * PDF das etiquetas de expedição: UMA etiqueta por página, no tamanho exato de
 * 100 x 50 mm da Tomate. O operador abre e manda imprimir — a impressora puxa
 * uma etiqueta por página, em sequência.
 *
 * O código de barras é desenhado como retângulos (vetorial), não como imagem:
 * sai mais nítido na térmica e não pesa no bundle.
 */

const MM = 72 / 25.4;              // 1 mm em pontos de PDF
const PAGE_WIDTH = 100 * MM;       // 283,46 pt
const PAGE_HEIGHT = 50 * MM;       // 141,73 pt
const MARGIN = 5;

/** Um ponto da cabeça de impressão de 203 dpi (o padrão dessas térmicas). */
const DOT = 72 / 203;
/** Margem branca dos dois lados do código — sem ela o leitor não engata. */
const QUIET_MODULES = 10;
/** Altura testada na Tomate: o leitor pega de primeira sem comer a etiqueta. */
const BARCODE_HEIGHT = 22;

export type ExpeditionLabelPdfOptions = {
  /** Documento gerado vazio quando a rota não tem nenhum volume pra etiquetar. */
  labels: ExpeditionLabel[];
};

/**
 * Largura do módulo (a barra mais fina) em pontos.
 *
 * Encaixa o código na largura útil e depois arredonda para baixo num número
 * inteiro de pontos da cabeça de impressão: barra que cai no meio de um ponto
 * sai borrada e o leitor erra. Mínimo de 2 pontos por módulo; se nem isso couber
 * (código muito longo), usa a largura crua pra não estourar a etiqueta.
 */
export const moduleWidthFor = (moduleCount: number, available: number): number => {
  const raw = available / (moduleCount + QUIET_MODULES * 2);
  const snapped = Math.floor(raw / DOT) * DOT;
  return snapped >= DOT * 2 ? snapped : raw;
};

export class ExpeditionLabelGenerator {
  static async generate({ labels }: ExpeditionLabelPdfOptions): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    labels.forEach((label) => {
      const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      drawLabel(page, label, font, fontBold);
    });

    return pdfDoc.save();
  }

  /** Abre o PDF numa aba nova; se o navegador bloquear, baixa o arquivo. */
  static openPDFInNewTab(pdfBytes: Uint8Array, fileName = 'etiquetas.pdf'): void {
    const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) {
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    setTimeout(() => URL.revokeObjectURL(url), 600000);
  }
}

const drawLabel = (page: PDFPage, label: ExpeditionLabel, font: PDFFont, fontBold: PDFFont) => {
  const usable = PAGE_WIDTH - MARGIN * 2;
  const left = MARGIN;
  const right = PAGE_WIDTH - MARGIN;
  let y = PAGE_HEIGHT - MARGIN;

  const black = rgb(0, 0, 0);

  /** Uma linha de texto a partir da esquerda, cortada se não couber. */
  const line = (text: string, size: number, f: PDFFont, gap = 1) => {
    y -= size;
    page.drawText(fitTextSafe(text, usable, f, size), { x: left, y, size, font: f, color: black });
    y -= gap;
  };

  /** Texto encostado na margem direita, na mesma altura de uma linha já escrita. */
  const rightText = (text: string, maxWidth: number, size: number, f: PDFFont, baseline: number) => {
    const safe = fitTextSafe(text, maxWidth, f, size);
    page.drawText(safe, {
      x: right - f.widthOfTextAtSize(safe, size),
      y: baseline,
      size,
      font: f,
      color: black,
    });
  };

  /**
   * Quebra o texto em até `maxLines` linhas. O que passar disso não some: vai
   * junto na última linha, que aí sim é cortada — melhor perder o fim do nome
   * do produto do que perder o meio dele.
   */
  const wrapped = (text: string, size: number, f: PDFFont, maxLines: number, gap = 1) => {
    const all = wrapTextSafe(text, usable, f, size);
    const lines = all.length <= maxLines
      ? all
      : [...all.slice(0, maxLines - 1), all.slice(maxLines - 1).join(' ')];
    lines.forEach((l) => line(l, size, f, gap));
  };

  // 1. Pedido à esquerda, volume do pedido à direita — as duas coisas que o
  //    conferente olha primeiro.
  const headerSize = 12;
  y -= headerSize;
  page.drawText(fitTextSafe(`PEDIDO ${label.erp}`, usable * 0.6, fontBold, headerSize), {
    x: left, y, size: headerSize, font: fontBold, color: black,
  });
  rightText(`VOL ${label.volumeInOrder}/${label.volumesInOrder}`, usable * 0.4, headerSize, fontBold, y);
  y -= 3;

  // 2. Código de barras + o mesmo código em texto embaixo (pra digitar no
  //    coletor se o leitor falhar).
  y -= BARCODE_HEIGHT;
  drawBarcode(page, label.barcode, left, y, usable, BARCODE_HEIGHT);
  y -= 1;

  const codeSize = 8.5;
  y -= codeSize;
  const codeText = sanitizePdfText(sanitizeCode128(label.barcode));
  page.drawText(codeText, {
    x: left + (usable - font.widthOfTextAtSize(codeText, codeSize)) / 2,
    y,
    size: codeSize,
    font,
    color: black,
  });
  y -= 3;

  // 3. Cliente.
  line(label.customer, 10.5, fontBold, 1.5);

  // 4. Rua com número, complemento e CEP numa linha só; quebra pra segunda
  //    quando o complemento for daqueles longos ("próximo ao posto...").
  const endereco = [label.address.street, label.address.complement, label.address.zip]
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join(' - ');
  wrapped(endereco, 8.5, font, 2, 1);
  y -= 1;

  // 5. Cidade e bairro lado a lado, os dois em negrito: é por eles que a carga
  //    é separada, então precisam saltar aos olhos de longe.
  const citySize = 11;
  y -= citySize;
  page.drawText(fitTextSafe(label.address.city, usable * 0.62, fontBold, citySize), {
    x: left, y, size: citySize, font: fontBold, color: black,
  });
  if (label.address.neighborhood) {
    rightText(label.address.neighborhood, usable * 0.36, 10, fontBold, y);
  }
  y -= 2;

  // 6. Produto, com o volume DAQUELE produto na frente pra não ser cortado
  //    quando o nome for longo. Em duas linhas cabe quase todo nome.
  wrapped(
    `(${label.volumeInProduct}/${label.volumesInProduct}) ${label.sku} ${label.productName}`,
    9,
    font,
    2,
    1,
  );

  // 7. Rodapé colado no pé da etiqueta: o espaço que sobrar vira respiro entre
  //    ele e o produto, em vez de sobra branca no fim.
  const footerSize = 8;
  const footer = [
    label.seller ? `Vend: ${label.seller}` : '',
    label.location ? `Local: ${label.location}` : '',
  ].filter(Boolean).join(' | ');
  if (footer) {
    page.drawText(fitTextSafe(footer, usable, font, footerSize), {
      x: left, y: MARGIN, size: footerSize, font, color: black,
    });
  }
};

/** Desenha o Code 128 como barras pretas, centralizado na largura disponível. */
const drawBarcode = (
  page: PDFPage,
  text: string,
  left: number,
  bottom: number,
  available: number,
  height: number,
) => {
  const moduleCount = code128ModuleCount(text);
  const moduleWidth = moduleWidthFor(moduleCount, available);
  const totalWidth = moduleCount * moduleWidth;
  const x0 = left + (available - totalWidth) / 2;

  code128Bars(text).forEach((bar) => {
    page.drawRectangle({
      x: x0 + bar.start * moduleWidth,
      y: bottom,
      width: bar.width * moduleWidth,
      height,
      color: rgb(0, 0, 0),
    });
  });
};
