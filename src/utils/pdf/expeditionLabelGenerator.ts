/**
 * PDF das etiquetas de expedição: uma etiqueta por página, 100 x 50 mm,
 * no tamanho exato da bobina da impressora térmica.
 *
 * Como cada etiqueta é uma página, dá pra mandar o arquivo inteiro pra
 * impressora e ela cospe o romaneio todo em sequência, em vez de imprimir de
 * uma em uma. O código de barras é desenhado como retângulos (vetorial), então
 * sai nítido em qualquer resolução.
 */

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ExpeditionLabel } from '../labels/expeditionLabels';
import { code128Widths } from '../labels/code128';
import { sanitizePdfText } from './pdfTextSanitizer';

const MM = 72 / 25.4;
const LABEL_WIDTH = 100 * MM;   // 283.46 pt
const LABEL_HEIGHT = 50 * MM;   // 141.73 pt
const MARGIN = 3 * MM;
const BARCODE_HEIGHT = 10 * MM;
const QUIET_ZONE_MODULES = 10;  // margem de silêncio exigida pelo Code 128

export interface ExpeditionLabelSheetData {
  labels: ExpeditionLabel[];
  routeName: string;
  routeCode: string;
}

/** Encurta o texto até caber na largura pedida, com "..." no fim. */
const fit = (text: string, font: PDFFont, size: number, maxWidth: number): string => {
  const clean = sanitizePdfText(text || '');
  if (!clean) return '';
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  let cut = clean;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}...`;
};

/** Desenha o Code 128 centralizado, ocupando a largura disponível. */
const drawBarcode = (page: PDFPage, text: string, centerX: number, bottomY: number, maxWidth: number) => {
  const widths = code128Widths(text);
  const totalModules = widths.reduce((acc, w) => acc + w, 0) + QUIET_ZONE_MODULES * 2;
  const moduleWidth = maxWidth / totalModules;

  let x = centerX - maxWidth / 2 + QUIET_ZONE_MODULES * moduleWidth;
  widths.forEach((moduleCount, i) => {
    const barWidth = moduleCount * moduleWidth;
    if (i % 2 === 0) {  // índice par = barra; ímpar = espaço
      page.drawRectangle({
        x,
        y: bottomY,
        width: barWidth,
        height: BARCODE_HEIGHT,
        color: rgb(0, 0, 0),
      });
    }
    x += barWidth;
  });
};

export class ExpeditionLabelGenerator {
  static async generate(data: ExpeditionLabelSheetData): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const black = rgb(0, 0, 0);
    const gray = rgb(0.35, 0.35, 0.35);

    const innerWidth = LABEL_WIDTH - MARGIN * 2;

    const write = (page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, color = black) => {
      if (!text) return;
      page.drawText(text, { x, y, size, font, color });
    };

    for (const label of data.labels) {
      const page = pdfDoc.addPage([LABEL_WIDTH, LABEL_HEIGHT]);

      // Alturas fixas: todas as etiquetas ficam com a mesma cara, o que ajuda
      // quem está conferindo volume atrás de volume na esteira.
      const Y_TOPO = 118;
      const Y_BARCODE = 83;
      const Y_CODIGO = 75;
      const Y_CLIENTE = 64;
      const Y_RUA = 54;
      const Y_BAIRRO = 45;
      const Y_CIDADE = 34;
      const Y_COMPLEMENTO = 25;
      const Y_PRODUTO = 16;
      const Y_RODAPE = 6;

      // Linha de cima: pedido à esquerda, volume do pedido à direita.
      write(page, `PEDIDO ${sanitizePdfText(label.orderErp)}`, MARGIN, Y_TOPO, bold, 13);

      const vol = `VOL ${label.orderVolumeIndex}/${label.orderVolumeTotal}`;
      write(page, vol, LABEL_WIDTH - MARGIN - bold.widthOfTextAtSize(vol, 13), Y_TOPO, bold, 13);

      // Código de barras + o mesmo código em texto (pra digitar se o leitor falhar).
      drawBarcode(page, label.barcode, LABEL_WIDTH / 2, Y_BARCODE, innerWidth);

      const codeText = sanitizePdfText(label.barcode);
      write(page, codeText, (LABEL_WIDTH - regular.widthOfTextAtSize(codeText, 7)) / 2, Y_CODIGO, regular, 7, gray);

      // Cliente e endereço.
      write(page, fit(label.customer, bold, 9.5, innerWidth), MARGIN, Y_CLIENTE, bold, 9.5);
      write(page, fit(label.street, regular, 8, innerWidth), MARGIN, Y_RUA, regular, 8);
      write(page, fit(label.neighborhood, regular, 8, innerWidth), MARGIN, Y_BAIRRO, regular, 8);

      // Cidade em destaque: é por ela que a carga é separada no caminhão.
      const cidade = fit(label.city, bold, 11, innerWidth * 0.7);
      write(page, cidade, MARGIN, Y_CIDADE, bold, 11);
      if (label.zip) {
        const cep = sanitizePdfText(label.zip);
        write(page, cep, LABEL_WIDTH - MARGIN - regular.widthOfTextAtSize(cep, 8), Y_CIDADE + 1, regular, 8, gray);
      }

      write(page, fit(label.complement, regular, 6.5, innerWidth), MARGIN, Y_COMPLEMENTO, regular, 6.5, gray);

      // Produto: o volume dele vem na frente pra não ser cortado em nome longo.
      const produto = `(${label.itemVolumeIndex}/${label.itemVolumeTotal}) ${label.sku} ${label.product}`;
      write(page, fit(produto, regular, 7, innerWidth), MARGIN, Y_PRODUTO, regular, 7);

      // Rodapé: parada e rota à esquerda, local de estoque à direita.
      const rodape = [`Parada ${label.sequence}`, data.routeName, label.seller ? `Vend: ${label.seller}` : '']
        .filter(Boolean).join(' | ');
      const local = label.location ? sanitizePdfText(`Local: ${label.location}`) : '';
      const larguraLocal = local ? regular.widthOfTextAtSize(local, 6.5) : 0;

      write(page, fit(rodape, regular, 6.5, innerWidth - larguraLocal - 6), MARGIN, Y_RODAPE, regular, 6.5, gray);
      if (local) write(page, local, LABEL_WIDTH - MARGIN - larguraLocal, Y_RODAPE, regular, 6.5, gray);
    }

    return pdfDoc.save();
  }
}
