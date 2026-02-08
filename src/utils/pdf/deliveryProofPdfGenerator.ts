import { PDFDocument, rgb, StandardFonts, type PDFPage, type PDFFont } from 'pdf-lib';
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

export class DeliveryProofPdfGenerator {
  private static readonly PAGE_WIDTH = 595.28;
  private static readonly PAGE_HEIGHT = 841.89;
  private static readonly MARGIN = 32;

  static async generate(data: DeliveryProofPdfData): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    let page = pdfDoc.addPage([this.PAGE_WIDTH, this.PAGE_HEIGHT]);
    let y = this.PAGE_HEIGHT - this.MARGIN;

    const ensureSpace = (requiredHeight: number) => {
      if (y - requiredHeight >= this.MARGIN) return;
      page = pdfDoc.addPage([this.PAGE_WIDTH, this.PAGE_HEIGHT]);
      y = this.PAGE_HEIGHT - this.MARGIN;
    };

    const drawTitle = (title: string) => {
      const safeTitle = sanitizePdfText(title);
      page.drawText(safeTitle, {
        x: this.MARGIN,
        y,
        size: 16,
        font: fontBold,
        color: rgb(0.07, 0.2, 0.45),
      });
      y -= 18;
    };

    const drawSectionTitle = (title: string) => {
      ensureSpace(24);
      const safeTitle = sanitizePdfText(title);
      page.drawText(safeTitle, {
        x: this.MARGIN,
        y,
        size: 12,
        font: fontBold,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= 8;
      page.drawLine({
        start: { x: this.MARGIN, y },
        end: { x: this.PAGE_WIDTH - this.MARGIN, y },
        thickness: 1,
        color: rgb(0.85, 0.85, 0.85),
      });
      y -= 12;
    };

    const drawLabelValue = (label: string, value: string) => {
      const safeLabel = sanitizePdfText(label);
      const safeValue = sanitizePdfText(value || '-');
      const labelWidth = fontBold.widthOfTextAtSize(`${safeLabel}: `, 10);
      const maxValueWidth = this.PAGE_WIDTH - (this.MARGIN * 2) - labelWidth;
      const valueLines = wrapTextSafe(safeValue, maxValueWidth, font, 10);
      const lineCount = Math.max(1, valueLines.length);
      ensureSpace(12 * lineCount + 4);

      page.drawText(`${safeLabel}: `, {
        x: this.MARGIN,
        y,
        size: 10,
        font: fontBold,
        color: rgb(0.2, 0.2, 0.2),
      });

      page.drawText(valueLines[0] || '-', {
        x: this.MARGIN + labelWidth,
        y,
        size: 10,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });

      y -= 12;
      for (let i = 1; i < valueLines.length; i++) {
        page.drawText(valueLines[i], {
          x: this.MARGIN + labelWidth,
          y,
          size: 10,
          font,
          color: rgb(0.1, 0.1, 0.1),
        });
        y -= 12;
      }

      y -= 2;
    };

    drawTitle('Comprovante Digital de Entrega');
    drawLabelValue('Gerado em', this.formatDateTime(data.generatedAt));
    drawLabelValue('Comprovante ID', data.receipt.id || '-');
    if (data.receipt.proofHash) {
      drawLabelValue('Hash', data.receipt.proofHash);
    }

    y -= 4;
    drawSectionTitle('Pedido');
    const addressText = this.buildAddressText(data.order.address_json as any);
    drawLabelValue('Pedido', data.order.order_id_erp || '-');
    drawLabelValue('Cliente', data.order.customer_name || '-');
    drawLabelValue('CPF', data.order.customer_cpf || String((data.order.raw_json as any)?.destinatario_cpf || (data.order.raw_json as any)?.cliente_cpf || '-'));
    drawLabelValue('Telefone', data.order.phone || '-');
    drawLabelValue('Endereco', addressText || '-');

    drawSectionTitle('Entrega');
    drawLabelValue('Rota', data.route.routeName || '-');
    drawLabelValue('Codigo rota', data.route.routeCode || data.route.routeId || '-');
    drawLabelValue('Status pedido na rota', data.route.routeOrderStatus || '-');
    drawLabelValue('Motorista da rota', data.route.driverName || '-');
    drawLabelValue('Veiculo', data.route.vehicleInfo || '-');
    drawLabelValue('Entregador do comprovante', data.deliveredByName || '-');
    drawLabelValue('Data/hora servidor', this.formatDateTime(data.receipt.deliveredAtServer));
    drawLabelValue('Data/hora dispositivo', this.formatDateTime(data.receipt.deviceTimestamp));
    drawLabelValue('Recebedor', data.receipt.recipientName || '-');
    drawLabelValue('Relacao', data.receipt.recipientRelation || '-');
    if (data.receipt.recipientNotes) {
      drawLabelValue('Obs. recebedor', data.receipt.recipientNotes);
    }
    drawLabelValue('Modo rede', data.receipt.networkMode || '-');
    drawLabelValue('Sync status', data.receipt.syncStatus || '-');
    drawLabelValue('Fotos registradas', String(data.receipt.photoCount ?? data.photos.length));

    const hasGps = this.isFiniteNumber(data.receipt.gpsLat) && this.isFiniteNumber(data.receipt.gpsLng);
    const gpsLabel = hasGps
      ? `${data.receipt.gpsLat?.toFixed(6)}, ${data.receipt.gpsLng?.toFixed(6)}`
      : '-';
    drawLabelValue('GPS status', data.receipt.gpsStatus || (hasGps ? 'ok' : 'failed'));
    drawLabelValue('GPS coordenadas', gpsLabel);
    drawLabelValue('GPS precisao (m)', data.receipt.gpsAccuracyM != null ? String(Math.round(data.receipt.gpsAccuracyM)) : '-');
    if (!hasGps || data.receipt.gpsFailureReason) {
      drawLabelValue('Motivo tecnico GPS', data.receipt.gpsFailureReason || '-');
    }

    if (hasGps) {
      drawSectionTitle('Mapa do ponto de entrega');
      const lat = Number(data.receipt.gpsLat);
      const lng = Number(data.receipt.gpsLng);
      const mapImage = await this.loadEmbeddedImage(pdfDoc, this.getStaticMapUrl(lat, lng));

      if (mapImage) {
        const mapWidth = this.PAGE_WIDTH - this.MARGIN * 2;
        const mapHeight = 210;
        ensureSpace(mapHeight + 40);
        const imageBounds = this.fitIntoBox(mapImage.width, mapImage.height, mapWidth, mapHeight);
        const drawX = this.MARGIN + (mapWidth - imageBounds.width) / 2;
        const drawY = y - imageBounds.height;
        page.drawRectangle({
          x: this.MARGIN,
          y: y - mapHeight,
          width: mapWidth,
          height: mapHeight,
          borderColor: rgb(0.9, 0.9, 0.9),
          borderWidth: 1,
          color: rgb(0.98, 0.98, 0.98),
        });
        page.drawImage(mapImage, {
          x: drawX,
          y: drawY,
          width: imageBounds.width,
          height: imageBounds.height,
        });
        y -= mapHeight + 10;
      }

      const mapLink = `https://www.google.com/maps?q=${lat},${lng}`;
      drawLabelValue('Link mapa', mapLink);
    }

    drawSectionTitle('Fotos da entrega');
    const photos = data.photos.slice(0, 4);
    if (photos.length === 0) {
      drawLabelValue('Fotos', 'Nao ha fotos sincronizadas para este comprovante');
    } else {
      const boxGap = 12;
      const boxWidth = (this.PAGE_WIDTH - this.MARGIN * 2 - boxGap) / 2;
      const boxHeight = 170;

      for (let i = 0; i < photos.length; i += 2) {
        ensureSpace(boxHeight + 30);
        const rowTop = y;

        const first = photos[i];
        const second = photos[i + 1];
        await this.drawPhotoCard(pdfDoc, page, font, fontBold, first, this.MARGIN, rowTop, boxWidth, boxHeight);
        if (second) {
          await this.drawPhotoCard(pdfDoc, page, font, fontBold, second, this.MARGIN + boxWidth + boxGap, rowTop, boxWidth, boxHeight);
        }

        y -= boxHeight + 16;
      }
    }

    ensureSpace(36);
    page.drawLine({
      start: { x: this.MARGIN, y },
      end: { x: this.PAGE_WIDTH - this.MARGIN, y },
      thickness: 1,
      color: rgb(0.85, 0.85, 0.85),
    });
    y -= 14;
    page.drawText('SOLIDGO - Comprovante Digital de Entrega', {
      x: this.MARGIN,
      y,
      size: 9,
      font,
      color: rgb(0.45, 0.45, 0.45),
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

  private static async drawPhotoCard(
    pdfDoc: PDFDocument,
    page: PDFPage,
    font: PDFFont,
    fontBold: PDFFont,
    photo: DeliveryProofPhotoData,
    x: number,
    topY: number,
    width: number,
    height: number
  ) {
    const captionHeight = 24;
    const imageBoxHeight = height - captionHeight - 8;

    page.drawRectangle({
      x,
      y: topY - height,
      width,
      height,
      borderColor: rgb(0.85, 0.85, 0.85),
      borderWidth: 1,
      color: rgb(0.99, 0.99, 0.99),
    });

    const image = await this.loadEmbeddedImage(pdfDoc, photo.url);
    if (image) {
      const fit = this.fitIntoBox(image.width, image.height, width - 8, imageBoxHeight - 8);
      const drawX = x + (width - fit.width) / 2;
      const drawY = topY - imageBoxHeight + (imageBoxHeight - fit.height) / 2;
      page.drawImage(image, {
        x: drawX,
        y: drawY,
        width: fit.width,
        height: fit.height,
      });
    } else {
      const failText = 'Foto indisponivel';
      page.drawText(failText, {
        x: x + 8,
        y: topY - imageBoxHeight / 2,
        size: 10,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });
    }

    const label = sanitizePdfText(photo.label || 'Foto da entrega');
    const timeText = this.formatDateTime(photo.createdAt);
    const labelSafe = wrapTextSafe(label, width - 8, fontBold, 8)[0] || 'Foto';
    page.drawText(labelSafe, {
      x: x + 4,
      y: topY - height + 12,
      size: 8,
      font: fontBold,
      color: rgb(0.2, 0.2, 0.2),
    });
    page.drawText(timeText, {
      x: x + 4,
      y: topY - height + 3,
      size: 7,
      font,
      color: rgb(0.4, 0.4, 0.4),
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
    const googleKey = String((import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || '').trim();
    if (googleKey) {
      return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=16&size=640x320&markers=color:red%7C${lat},${lng}&key=${googleKey}`;
    }
    return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=16&size=640x320&markers=${lat},${lng},red-pushpin`;
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
}

