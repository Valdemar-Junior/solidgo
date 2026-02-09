import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Order } from '../../types/database';
import { sanitizePdfText, wrapTextSafe } from './pdfTextSanitizer';

export interface DeliveryProofPhotoData {
  id?: string;
  url: string;
  label?: string;
  createdAt?: string | null;
}

export interface DeliveryProofReceiptData {
  id?: string;
  deliveredAtServer?: string | null;
  deviceTimestamp?: string | null;
  recipientName?: string | null;
  recipientRelation?: string | null;
  recipientNotes?: string | null;
  gpsStatus?: string | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  gpsAccuracyM?: number | null;
  gpsFailureReason?: string | null;
  syncStatus?: string | null;
  networkMode?: string | null;
  photoCount?: number | null;
  proofHash?: string | null;
}

export interface DeliveryProofRouteData {
  routeName?: string | null;
  routeCode?: string | null;
  routeId?: string | null;
  routeOrderId?: string | null;
  routeOrderStatus?: string | null;
  deliveredAt?: string | null;
  driverName?: string | null;
  vehicleInfo?: string | null;
}

export interface DeliveryProofPdfData {
  order: Order;
  route: DeliveryProofRouteData;
  receipt: DeliveryProofReceiptData;
  deliveredByName?: string | null;
  photos: DeliveryProofPhotoData[];
  generatedAt: string;
}

type StatusBadge = {
  text: string;
  bg: ReturnType<typeof rgb>;
  fg: ReturnType<typeof rgb>;
};

type ItemSummary = {
  name: string;
  total: number;
};

export class DeliveryProofPdfGenerator {
  private static readonly PAGE_WIDTH = 595.28;
  private static readonly PAGE_HEIGHT = 841.89;
  private static readonly MARGIN = 28;

  static async generate(data: DeliveryProofPdfData): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const page = pdfDoc.addPage([this.PAGE_WIDTH, this.PAGE_HEIGHT]);

    const COLORS = {
      pageBg: rgb(0.99, 0.99, 0.995),
      cardBg: rgb(1, 1, 1),
      cardBorder: rgb(0.87, 0.89, 0.92),
      title: rgb(0.07, 0.2, 0.45),
      text: rgb(0.13, 0.13, 0.13),
      muted: rgb(0.42, 0.45, 0.5),
      section: rgb(0.15, 0.38, 0.82),
      sectionLine: rgb(0.83, 0.87, 0.93),
      lightBox: rgb(0.96, 0.97, 0.99),
      footerLine: rgb(0.84, 0.87, 0.92),
      captionBg: rgb(0.2, 0.23, 0.3),
    };

    page.drawRectangle({
      x: 0,
      y: 0,
      width: this.PAGE_WIDTH,
      height: this.PAGE_HEIGHT,
      color: COLORS.pageBg,
    });

    const contentX = this.MARGIN;
    const contentW = this.PAGE_WIDTH - this.MARGIN * 2;

    const transactionId = sanitizePdfText(data.order.order_id_erp || data.receipt.id || '-');
    const orderCpf = sanitizePdfText(
      data.order.customer_cpf ||
      String((data.order.raw_json as any)?.destinatario_cpf || (data.order.raw_json as any)?.cliente_cpf || '-')
    );
    const hasGps = this.isFiniteNumber(data.receipt.gpsLat) && this.isFiniteNumber(data.receipt.gpsLng);
    const gpsLat = hasGps ? Number(data.receipt.gpsLat) : null;
    const gpsLng = hasGps ? Number(data.receipt.gpsLng) : null;
    const status = this.getStatusBadge(data.route.routeOrderStatus || data.order.status);
    const orderItems = this.getOrderItemsSummary(data.order);
    const totalValue = orderItems.reduce((acc, item) => acc + item.total, 0);
    const logoImage = await this.loadEmbeddedImage(pdfDoc, '/logo.png');

    const drawCard = (x: number, topY: number, width: number, height: number) => {
      page.drawRectangle({
        x,
        y: topY - height,
        width,
        height,
        color: COLORS.cardBg,
        borderColor: COLORS.cardBorder,
        borderWidth: 1,
      });
    };

    const drawSectionTitle = (x: number, y: number, title: string) => {
      page.drawText(sanitizePdfText(title), {
        x,
        y,
        size: 11,
        font: fontBold,
        color: COLORS.section,
      });
      page.drawLine({
        start: { x, y: y - 6 },
        end: { x: x + 220, y: y - 6 },
        thickness: 1,
        color: COLORS.sectionLine,
      });
    };

    const getLines = (value: string, maxWidth: number, targetFont: PDFFont, size: number, maxLines: number) => {
      const lines = wrapTextSafe(sanitizePdfText(value || '-'), maxWidth, targetFont, size);
      return this.clampLines(lines.length ? lines : ['-'], maxLines);
    };

    const drawField = (
      x: number,
      y: number,
      label: string,
      value: string,
      maxWidth: number,
      maxLines = 2,
      valueSize = 10
    ) => {
      page.drawText(sanitizePdfText(label).toUpperCase(), {
        x,
        y,
        size: 7,
        font: fontBold,
        color: COLORS.muted,
      });

      const lines = getLines(value, maxWidth, fontBold, valueSize, maxLines);
      let currentY = y - 11;
      for (const line of lines) {
        page.drawText(line, {
          x,
          y: currentY,
          size: valueSize,
          font: fontBold,
          color: COLORS.text,
        });
        currentY -= valueSize + 1;
      }

      return currentY - 5;
    };

    const drawStatusBadge = (x: number, y: number, badge: StatusBadge) => {
      const textW = fontBold.widthOfTextAtSize(badge.text, 8);
      const w = textW + 12;
      const h = 14;
      page.drawRectangle({
        x,
        y: y - h + 2,
        width: w,
        height: h,
        color: badge.bg,
      });
      page.drawText(badge.text, {
        x: x + 6,
        y: y - 8,
        size: 8,
        font: fontBold,
        color: badge.fg,
      });
    };

    // Header
    const headerTop = this.PAGE_HEIGHT - this.MARGIN;
    const headerH = 88;
    drawCard(contentX, headerTop, contentW, headerH);

    const logoBoxX = contentX + 10;
    const logoBoxY = headerTop - 58;
    const logoBoxW = 112;
    const logoBoxH = 42;
    page.drawRectangle({
      x: logoBoxX,
      y: logoBoxY,
      width: logoBoxW,
      height: logoBoxH,
      color: rgb(0.95, 0.97, 1),
      borderColor: COLORS.cardBorder,
      borderWidth: 1,
    });
    if (logoImage) {
      const fit = this.fitIntoBox(logoImage.width, logoImage.height, logoBoxW - 8, logoBoxH - 8);
      page.drawImage(logoImage, {
        x: logoBoxX + (logoBoxW - fit.width) / 2,
        y: logoBoxY + (logoBoxH - fit.height) / 2,
        width: fit.width,
        height: fit.height,
      });
    } else {
      page.drawText('LOJAO', {
        x: logoBoxX + 25,
        y: logoBoxY + 17,
        size: 10,
        font: fontBold,
        color: COLORS.section,
      });
    }

    page.drawText('COMPROVANTE DIGITAL DE ENTREGA', {
      x: contentX + 132,
      y: headerTop - 28,
      size: 15,
      font: fontBold,
      color: COLORS.title,
    });
    page.drawText(`ID da transacao: #${transactionId}`, {
      x: contentX + 132,
      y: headerTop - 44,
      size: 9,
      font,
      color: COLORS.muted,
    });

    const authBoxW = 96;
    const authBoxH = 56;
    const authX = contentX + contentW - authBoxW - 10;
    const authTop = headerTop - 10;
    page.drawRectangle({
      x: authX,
      y: authTop - authBoxH,
      width: authBoxW,
      height: authBoxH,
      color: COLORS.lightBox,
      borderColor: COLORS.cardBorder,
      borderWidth: 1,
    });
    page.drawText('AUTENTICACAO', {
      x: authX + 12,
      y: authTop - 26,
      size: 8,
      font: fontBold,
      color: COLORS.muted,
    });
    page.drawText('DIGITAL', {
      x: authX + 30,
      y: authTop - 37,
      size: 8,
      font: fontBold,
      color: COLORS.muted,
    });

    // Two-column cards
    const cardsTop = headerTop - headerH - 12;
    const cardsGap = 12;
    const cardW = (contentW - cardsGap) / 2;
    const cardH = 258;
    const leftX = contentX;
    const rightX = contentX + cardW + cardsGap;

    drawCard(leftX, cardsTop, cardW, cardH);
    drawCard(rightX, cardsTop, cardW, cardH);

    drawSectionTitle(leftX + 12, cardsTop - 20, 'DADOS DO PEDIDO');
    drawSectionTitle(rightX + 12, cardsTop - 20, 'DETALHES DA ENTREGA');

    // Left card content
    let leftY = cardsTop - 48;
    leftY = drawField(leftX + 12, leftY, 'Cliente', data.order.customer_name || '-', cardW - 24, 1);
    leftY = drawField(leftX + 12, leftY, 'CPF / CNPJ', orderCpf || '-', cardW - 24, 1);
    leftY = drawField(leftX + 12, leftY, 'Endereco', this.buildAddressText(data.order.address_json as any), cardW - 24, 2, 9);

    const itemsBoxH = 92;
    const itemsBoxTop = cardsTop - cardH + itemsBoxH + 12;
    const itemsBoxX = leftX + 12;
    const itemsBoxW = cardW - 24;
    page.drawRectangle({
      x: itemsBoxX,
      y: itemsBoxTop - itemsBoxH,
      width: itemsBoxW,
      height: itemsBoxH,
      color: COLORS.lightBox,
      borderColor: COLORS.cardBorder,
      borderWidth: 1,
    });
    page.drawText('ITENS DO PEDIDO', {
      x: itemsBoxX + 8,
      y: itemsBoxTop - 12,
      size: 7,
      font: fontBold,
      color: COLORS.muted,
    });

    const visibleItems = orderItems.slice(0, 2);
    const rowH = 16;
    let rowY = itemsBoxTop - 26;
    for (const item of visibleItems) {
      const name = this.clampLines(getLines(item.name, itemsBoxW - 120, font, 9, 1), 1)[0];
      const value = this.formatCurrencyBR(item.total);
      const valueW = fontBold.widthOfTextAtSize(value, 9);
      page.drawText(name, {
        x: itemsBoxX + 8,
        y: rowY,
        size: 9,
        font,
        color: COLORS.text,
      });
      page.drawText(value, {
        x: itemsBoxX + itemsBoxW - 8 - valueW,
        y: rowY,
        size: 9,
        font,
        color: COLORS.text,
      });
      rowY -= rowH;
    }

    if (orderItems.length > visibleItems.length) {
      page.drawText(`+${orderItems.length - visibleItems.length} item(ns)`, {
        x: itemsBoxX + 8,
        y: rowY,
        size: 8,
        font,
        color: COLORS.muted,
      });
      rowY -= rowH;
    }

    page.drawLine({
      start: { x: itemsBoxX + 8, y: itemsBoxTop - itemsBoxH + 23 },
      end: { x: itemsBoxX + itemsBoxW - 8, y: itemsBoxTop - itemsBoxH + 23 },
      thickness: 1,
      color: COLORS.cardBorder,
    });
    const totalLabel = 'TOTAL';
    const totalValueText = this.formatCurrencyBR(totalValue);
    const totalValueW = fontBold.widthOfTextAtSize(totalValueText, 10);
    page.drawText(totalLabel, {
      x: itemsBoxX + 8,
      y: itemsBoxTop - itemsBoxH + 8,
      size: 10,
      font: fontBold,
      color: COLORS.text,
    });
    page.drawText(totalValueText, {
      x: itemsBoxX + itemsBoxW - 8 - totalValueW,
      y: itemsBoxTop - itemsBoxH + 8,
      size: 10,
      font: fontBold,
      color: COLORS.text,
    });

    // Right card content
    let rightY = cardsTop - 48;
    const eventDate = this.formatDateTime(data.receipt.deliveredAtServer || data.route.deliveredAt || null);
    rightY = drawField(rightX + 12, rightY, 'Data e hora', eventDate, cardW - 24, 1);

    page.drawText('STATUS', {
      x: rightX + 12,
      y: rightY,
      size: 7,
      font: fontBold,
      color: COLORS.muted,
    });
    drawStatusBadge(rightX + 12, rightY - 10, status);
    rightY -= 28;

    rightY = drawField(rightX + 12, rightY, 'Recebido por', data.receipt.recipientName || '-', cardW - 24, 1);
    rightY = drawField(rightX + 12, rightY, 'Relacao', data.receipt.recipientRelation || '-', cardW - 24, 1);
    rightY = drawField(rightX + 12, rightY, 'Entregador', data.deliveredByName || data.route.driverName || '-', cardW - 24, 1);

    const gpsBoxH = 92;
    const gpsBoxX = rightX + 12;
    const gpsBoxY = cardsTop - cardH + 12;
    const gpsBoxW = cardW - 24;
    page.drawRectangle({
      x: gpsBoxX,
      y: gpsBoxY,
      width: gpsBoxW,
      height: gpsBoxH,
      color: COLORS.lightBox,
      borderColor: COLORS.cardBorder,
      borderWidth: 1,
    });

    const mapThumbX = gpsBoxX + 6;
    const mapThumbY = gpsBoxY + 6;
    const mapThumbW = 96;
    const mapThumbH = gpsBoxH - 12;
    page.drawRectangle({
      x: mapThumbX,
      y: mapThumbY,
      width: mapThumbW,
      height: mapThumbH,
      color: rgb(0.94, 0.96, 0.98),
      borderColor: COLORS.cardBorder,
      borderWidth: 1,
    });

    page.drawText(hasGps ? 'GPS' : 'Sem GPS', {
      x: mapThumbX + (hasGps ? 35 : 25),
      y: mapThumbY + mapThumbH / 2 - 4,
      size: 10,
      font,
      color: COLORS.muted,
    });

    const gpsTextX = mapThumbX + mapThumbW + 10;
    let gpsTextY = gpsBoxY + gpsBoxH - 16;
    page.drawText('COORDENADAS GPS', {
      x: gpsTextX,
      y: gpsTextY,
      size: 7,
      font: fontBold,
      color: COLORS.muted,
    });
    gpsTextY -= 12;

    if (hasGps && gpsLat !== null && gpsLng !== null) {
      page.drawText(`${gpsLat.toFixed(6)}, ${gpsLng.toFixed(6)}`, {
        x: gpsTextX,
        y: gpsTextY,
        size: 9,
        font: fontBold,
        color: COLORS.text,
      });
      gpsTextY -= 12;
      const precision = data.receipt.gpsAccuracyM != null ? `${Math.round(data.receipt.gpsAccuracyM)}m` : '-';
      page.drawText(`Precisao: ${precision}`, {
        x: gpsTextX,
        y: gpsTextY,
        size: 8,
        font,
        color: COLORS.muted,
      });
      gpsTextY -= 11;
      page.drawText(`Status: ${sanitizePdfText(data.receipt.gpsStatus || 'ok')}`, {
        x: gpsTextX,
        y: gpsTextY,
        size: 8,
        font,
        color: COLORS.muted,
      });
    } else {
      page.drawText(sanitizePdfText(data.receipt.gpsFailureReason || 'Localizacao nao registrada'), {
        x: gpsTextX,
        y: gpsTextY,
        size: 8,
        font,
        color: COLORS.muted,
      });
    }

    // Map section (larger map)
    const mapSectionTop = cardsTop - cardH - 12;
    const mapSectionH = 168;
    drawCard(contentX, mapSectionTop, contentW, mapSectionH);
    drawSectionTitle(contentX + 12, mapSectionTop - 20, 'MAPA DO PONTO DE ENTREGA');

    const mapX = contentX + 12;
    const mapW = contentW - 24;
    const mapTop = mapSectionTop - 34;
    const mapH = 118;
    page.drawRectangle({
      x: mapX,
      y: mapTop - mapH,
      width: mapW,
      height: mapH,
      color: rgb(0.95, 0.96, 0.98),
      borderColor: COLORS.cardBorder,
      borderWidth: 1,
    });

    if (hasGps && gpsLat !== null && gpsLng !== null) {
      const mapImage = await this.loadEmbeddedImage(pdfDoc, this.getStaticMapUrl(gpsLat, gpsLng));
      if (mapImage) {
        const fit = this.fitIntoBox(mapImage.width, mapImage.height, mapW - 4, mapH - 4);
        page.drawImage(mapImage, {
          x: mapX + (mapW - fit.width) / 2,
          y: mapTop - mapH + (mapH - fit.height) / 2,
          width: fit.width,
          height: fit.height,
        });
      } else {
        page.drawText('Mapa nao disponivel no momento', {
          x: mapX + 12,
          y: mapTop - mapH / 2,
          size: 9,
          font,
          color: COLORS.muted,
        });
      }
      const gpsSummary = `${gpsLat.toFixed(6)}, ${gpsLng.toFixed(6)} | Precisao: ${data.receipt.gpsAccuracyM != null ? `${Math.round(data.receipt.gpsAccuracyM)}m` : '-'}`;
      page.drawText(sanitizePdfText(gpsSummary), {
        x: mapX,
        y: mapSectionTop - mapSectionH + 10,
        size: 8,
        font,
        color: COLORS.muted,
      });
    } else {
      page.drawText('Coordenadas GPS nao registradas para esta entrega', {
        x: mapX + 12,
        y: mapTop - mapH / 2,
        size: 9,
        font,
        color: COLORS.muted,
      });
      if (data.receipt.gpsFailureReason) {
        page.drawText(`Motivo tecnico: ${sanitizePdfText(data.receipt.gpsFailureReason)}`, {
          x: mapX,
          y: mapSectionTop - mapSectionH + 10,
          size: 8,
          font,
          color: COLORS.muted,
        });
      }
    }

    // Evidence section
    const evidenceTop = mapSectionTop - mapSectionH - 10;
    const evidenceH = 176;
    drawCard(contentX, evidenceTop, contentW, evidenceH);
    drawSectionTitle(contentX + 12, evidenceTop - 20, 'EVIDENCIAS VISUAIS');

    const photos = data.photos.slice(0, 4);
    const primaryPhotos = photos.slice(0, 2);
    const tileGap = 10;
    const tileW = (contentW - 24 - tileGap) / 2;
    const tileH = 120;
    const tilesTop = evidenceTop - 46;

    for (let i = 0; i < 2; i += 1) {
      const photo = primaryPhotos[i];
      const tileX = contentX + 12 + (tileW + tileGap) * i;
      await this.drawEvidenceTile(pdfDoc, page, font, fontBold, {
        x: tileX,
        topY: tilesTop,
        width: tileW,
        height: tileH,
        photo,
        colors: {
          border: COLORS.cardBorder,
          bg: rgb(0.95, 0.96, 0.98),
          caption: COLORS.captionBg,
          captionText: rgb(1, 1, 1),
          fallbackText: COLORS.muted,
        },
      });
    }

    if (photos.length > 2) {
      page.drawText(`+${photos.length - 2} evidencia(s) adicional(is) registrada(s) no pedido`, {
        x: contentX + 12,
        y: evidenceTop - evidenceH + 10,
        size: 8,
        font,
        color: COLORS.muted,
      });
    }

    // Footer
    const footerY = 62;
    page.drawLine({
      start: { x: contentX, y: footerY + 18 },
      end: { x: contentX + contentW, y: footerY + 18 },
      thickness: 1,
      color: COLORS.footerLine,
    });

    const hashLines = this.clampLines(
      wrapTextSafe(
        sanitizePdfText(`Hash digital: ${data.receipt.proofHash || '-'}`),
        320,
        font,
        8
      ),
      2
    );
    page.drawText(hashLines[0] || 'Hash digital: -', {
      x: contentX,
      y: footerY + 6,
      size: 8,
      font,
      color: COLORS.muted,
    });
    if (hashLines[1]) {
      page.drawText(hashLines[1], {
        x: contentX,
        y: footerY - 4,
        size: 8,
        font,
        color: COLORS.muted,
      });
    }

    page.drawText('SOLIDGO', {
      x: contentX + contentW - 130,
      y: footerY + 6,
      size: 10,
      font: fontBold,
      color: COLORS.title,
    });
    page.drawText('Pagina 1 de 1', {
      x: contentX + contentW - 130,
      y: footerY - 6,
      size: 8,
      font,
      color: COLORS.muted,
    });

    return pdfDoc.save();
  }

  static openPDFInNewTab(pdfBytes: Uint8Array): void {
    const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) {
      const link = document.createElement('a');
      link.href = url;
      link.download = 'comprovante-digital-entrega.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    setTimeout(() => URL.revokeObjectURL(url), 600000);
  }

  private static async drawEvidenceTile(
    pdfDoc: PDFDocument,
    page: PDFPage,
    font: PDFFont,
    fontBold: PDFFont,
    opts: {
      x: number;
      topY: number;
      width: number;
      height: number;
      photo?: DeliveryProofPhotoData;
      colors: {
        border: ReturnType<typeof rgb>;
        bg: ReturnType<typeof rgb>;
        caption: ReturnType<typeof rgb>;
        captionText: ReturnType<typeof rgb>;
        fallbackText: ReturnType<typeof rgb>;
      };
    }
  ) {
    const { x, topY, width, height, photo, colors } = opts;
    const captionH = 16;
    const imageBoxH = height - captionH;

    page.drawRectangle({
      x,
      y: topY - height,
      width,
      height,
      color: colors.bg,
      borderColor: colors.border,
      borderWidth: 1,
    });

    if (photo?.url) {
      const image = await this.loadEmbeddedImage(pdfDoc, photo.url);
      if (image) {
        const fit = this.fitIntoBox(image.width, image.height, width - 4, imageBoxH - 4);
        page.drawImage(image, {
          x: x + (width - fit.width) / 2,
          y: topY - captionH - (imageBoxH - fit.height) / 2 - fit.height,
          width: fit.width,
          height: fit.height,
        });
      } else {
        page.drawText('Imagem indisponivel', {
          x: x + 8,
          y: topY - captionH - imageBoxH / 2,
          size: 8,
          font,
          color: colors.fallbackText,
        });
      }
    } else {
      page.drawText('Sem foto', {
        x: x + width / 2 - 18,
        y: topY - captionH - imageBoxH / 2,
        size: 8,
        font,
        color: colors.fallbackText,
      });
    }

    page.drawRectangle({
      x,
      y: topY - height,
      width,
      height: captionH,
      color: colors.caption,
    });

    const rawLabel = sanitizePdfText(photo?.label || 'EVIDENCIA');
    const label = this.clampLines(wrapTextSafe(rawLabel.toUpperCase(), width - 8, fontBold, 7), 1)[0] || 'EVIDENCIA';
    page.drawText(label, {
      x: x + 4,
      y: topY - height + 5,
      size: 7,
      font: fontBold,
      color: colors.captionText,
    });
  }

  private static fitIntoBox(sourceW: number, sourceH: number, boxW: number, boxH: number) {
    if (sourceW <= 0 || sourceH <= 0 || boxW <= 0 || boxH <= 0) {
      return { width: boxW, height: boxH };
    }
    const ratio = Math.min(boxW / sourceW, boxH / sourceH);
    return {
      width: sourceW * ratio,
      height: sourceH * ratio,
    };
  }

  private static async loadEmbeddedImage(pdfDoc: PDFDocument, url?: string | null) {
    const src = String(url || '').trim();
    if (!src) return null;
    try {
      const response = await fetch(src, { cache: 'no-store' });
      if (!response.ok) return null;
      const buffer = await response.arrayBuffer();
      try {
        return await pdfDoc.embedPng(buffer);
      } catch {
        try {
          return await pdfDoc.embedJpg(buffer);
        } catch {
          return null;
        }
      }
    } catch {
      return null;
    }
  }

  private static getStaticMapUrl(lat: number, lng: number): string {
    const latText = encodeURIComponent(String(lat));
    const lngText = encodeURIComponent(String(lng));
    return `/api/static-map?lat=${latText}&lng=${lngText}&w=640&h=300&z=16`;
  }

  private static buildAddressText(address: any): string {
    if (!address || typeof address !== 'object') return '-';
    const street = String(address.street || '').trim();
    const number = String(address.number || '').trim();
    const neighborhood = String(address.neighborhood || '').trim();
    const city = String(address.city || '').trim();
    const state = String(address.state || '').trim();
    const zip = String(address.zip || '').trim();
    const complement = String(address.complement || '').trim();

    const parts = [
      [street, number].filter(Boolean).join(', '),
      neighborhood,
      [city, state].filter(Boolean).join(' - '),
      zip ? `CEP ${zip}` : '',
      complement ? `Compl.: ${complement}` : '',
    ].filter(Boolean);

    return parts.join(' | ') || '-';
  }

  private static formatDateTime(value?: string | null): string {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('pt-BR');
  }

  private static isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }

  private static formatCurrencyBR(value: number): string {
    const safe = Number.isFinite(value) ? value : 0;
    return safe.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  private static getStatusBadge(status?: string | null): StatusBadge {
    const normalized = String(status || '').toLowerCase().trim();
    if (normalized === 'delivered') {
      return {
        text: 'CONCLUIDO',
        bg: rgb(0.86, 0.95, 0.88),
        fg: rgb(0.18, 0.5, 0.22),
      };
    }
    if (normalized === 'returned') {
      return {
        text: 'RETORNADO',
        bg: rgb(0.98, 0.89, 0.89),
        fg: rgb(0.63, 0.17, 0.17),
      };
    }
    return {
      text: 'PENDENTE',
      bg: rgb(0.94, 0.94, 0.94),
      fg: rgb(0.35, 0.35, 0.35),
    };
  }

  private static getOrderItemsSummary(order: Order): ItemSummary[] {
    const raw = Array.isArray(order.items_json) ? order.items_json : [];
    return raw.map((item: any) => {
      const qty = Number(item?.purchased_quantity ?? item?.quantity ?? 1);
      const unit = Number(item?.unit_price_real ?? item?.unit_price ?? item?.price ?? 0);
      const total = Number(item?.total_price_real ?? item?.total_price ?? (unit * (Number.isFinite(qty) ? qty : 1)));
      const name = sanitizePdfText(String(item?.name || item?.sku || 'Item'));
      return {
        name: name || 'Item',
        total: Number.isFinite(total) ? total : 0,
      };
    });
  }

  private static clampLines(lines: string[], maxLines: number): string[] {
    if (lines.length <= maxLines) return lines;
    const clipped = lines.slice(0, Math.max(1, maxLines));
    const lastIdx = clipped.length - 1;
    const last = clipped[lastIdx] || '';
    clipped[lastIdx] = `${last.slice(0, Math.max(0, last.length - 3))}...`;
    return clipped;
  }
}
