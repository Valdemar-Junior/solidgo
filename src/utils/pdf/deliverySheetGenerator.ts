import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage } from 'pdf-lib';
import type { Route, RouteOrder, Order, DriverWithUser, Vehicle } from '../../types/database';

// Layout Constants
const PAGE_SIZE: [number, number] = [595.28, 841.89]; // A4
const PAGE_WIDTH = PAGE_SIZE[0];
const PAGE_HEIGHT = PAGE_SIZE[1];
const MARGIN = 32;
const MARGIN_BOTTOM = 40; // Minimum bottom margin to trigger page break

const FONTS = {
  REGULAR: StandardFonts.Helvetica,
  BOLD: StandardFonts.HelveticaBold,
};

const SIZES = {
  TITLE: 14,
  SUBTITLE: 11,
  BODY: 10,
  SMALL: 9,
  TINY: 8,
};

const SPACING = {
  LINE: 12,
  PARAGRAPH: 6,
  SECTION: 14,
  BLOCK: 24, // Between items
};

export interface DeliverySheetData {
  route: Route;
  routeOrders: RouteOrder[];
  driver: DriverWithUser;
  vehicle?: Vehicle;
  orders: Order[];
  generatedAt: string;
}

interface FontSet {
  regular: PDFFont;
  bold: PDFFont;
}

export class DeliverySheetGenerator {
  static async generateDeliverySheet(data: DeliverySheetData, title: string = 'Romaneio de Entrega'): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    
    // Load fonts
    const fonts: FontSet = {
      regular: await pdfDoc.embedFont(FONTS.REGULAR),
      bold: await pdfDoc.embedFont(FONTS.BOLD),
    };

    // Initial page
    let page = pdfDoc.addPage(PAGE_SIZE);
    let y = PAGE_HEIGHT - MARGIN;

    // Load logo once
    const logoImage = await this.loadLogo(pdfDoc);

    // Draw initial header
    y = this.drawHeader(page, y, title, data.generatedAt, fonts, logoImage);
    y = this.drawOverview(page, y, data, fonts);

    // Iterate over orders
    for (let i = 0; i < data.routeOrders.length; i++) {
      const ro = data.routeOrders[i];
      const order = data.orders.find(o => o.id === ro.order_id);
      if (!order) continue;

      const itemSeq = i + 1;
      
      // Calculate block height to check for page break
      const blockHeight = this.measureItemBlock(order, fonts);

      // Check if we need a new page
      if (y - blockHeight < MARGIN_BOTTOM) {
        page = pdfDoc.addPage(PAGE_SIZE);
        y = PAGE_HEIGHT - MARGIN;
        // Header and Overview are only for the first page as requested
      }

      // Draw the item block
      y = this.drawItemBlock(page, y, itemSeq, order, data.route, fonts);
    }

    // Draw Footer on the last page (or every page if desired, but typically last page or fixed bottom)
    this.drawFooter(page, fonts);

    return await pdfDoc.save();
  }

  // --- Layout Components ---

  private static drawHeader(
    page: PDFPage,
    y: number,
    title: string,
    dateStr: string,
    fonts: FontSet,
    logoImage: any
  ): number {
    let currentY = y;
    let logoHeight = 0;

    // Draw Logo
    if (logoImage) {
      const logoW = 140;
      const logoH = (logoImage.height / logoImage.width) * logoW;
      page.drawImage(logoImage, {
        x: MARGIN,
        y: currentY - logoH + 4, // adjust slightly to align top
        width: logoW,
        height: logoH
      });
      logoHeight = logoH;
    } else {
      // Fallback text logo
      this.drawText(page, 'Lojão dos Móveis', MARGIN, currentY, { font: fonts.bold, size: 16 });
      logoHeight = 20;
    }

    // Calculate Y for text (ensure it doesn't overlap logo if logo is tall, but usually text is to the right or below)
    // In this layout, title is below logo or aligned. The original code put title BELOW logo.
    // Let's put title below logo.
    
    currentY -= (logoHeight ? logoHeight + 16 : 24);

    this.drawText(page, title, MARGIN, currentY, { font: fonts.bold, size: SIZES.TITLE });
    
    const dateText = `Data e Hora da impressão: ${new Date(dateStr).toLocaleString('pt-BR')}`;
    this.drawText(page, dateText, MARGIN, currentY - 16, { font: fonts.regular, size: SIZES.SMALL });
    
    currentY -= 26;
    
    // Separator line
    this.drawLine(page, currentY, MARGIN, PAGE_WIDTH - MARGIN);
    currentY -= 12;

    return currentY;
  }

  private static drawOverview(page: PDFPage, y: number, data: DeliverySheetData, fonts: FontSet): number {
    let currentY = y;
    const col1X = MARGIN;
    const col2X = MARGIN + 220;
    const col3X = MARGIN + 400;

    const driverName = String((data.driver?.user?.name || (data.driver as any)?.name || '')).trim();
    const vehicleModel = data.vehicle ? data.vehicle.model : '';
    const vehiclePlate = data.vehicle ? data.vehicle.plate : '';
    const conferente = String(data.route.conferente || '').trim();
    const obs = String(data.route.observations || '').trim();

    // Row 1: Nº do Romaneio, Motorista, Conferente
    this.drawLabelValue(page, col1X, currentY, 'Nº do Romaneio', String(data.route.name || data.route.id), fonts);
    this.drawLabelValue(page, col2X, currentY, 'Motorista', driverName, fonts);
    this.drawLabelValue(page, col3X, currentY, 'Conferente', conferente, fonts);

    currentY -= 32;

    // Row 2: Veículo, Placa
    this.drawLabelValue(page, col1X, currentY, 'Veículo', vehicleModel, fonts);
    this.drawLabelValue(page, col2X, currentY, 'Placa', vehiclePlate, fonts);

    currentY -= 28;

    // Observações da rota (wrap em largura total)
    if (obs) {
      const label = 'Observações da Rota: ';
      const labelW = fonts.bold.widthOfTextAtSize(label, SIZES.BODY);
      const maxW = PAGE_WIDTH - MARGIN * 2 - labelW;
      this.drawText(page, label, MARGIN, currentY, { font: fonts.bold, size: SIZES.BODY });
      const lines = this.wrapText(obs, maxW, fonts.regular, SIZES.BODY);
      if (lines.length) {
        this.drawText(page, lines[0], MARGIN + labelW, currentY, { font: fonts.regular, size: SIZES.BODY });
        currentY -= SPACING.LINE;
        for (let i = 1; i < lines.length; i++) {
          this.drawText(page, lines[i], MARGIN + labelW, currentY, { font: fonts.regular, size: SIZES.BODY });
          currentY -= SPACING.LINE;
        }
      } else {
        currentY -= SPACING.LINE;
      }
      currentY -= 4;
    }

    this.drawLine(page, currentY, MARGIN, PAGE_WIDTH - MARGIN);
    currentY -= 10;

    return currentY;
  }

  private static drawItemBlock(
    page: PDFPage,
    startY: number,
    seq: number,
    order: Order,
    route: Route,
    fonts: FontSet
  ): number {
    let y = startY;
    const rightColX = MARGIN + 280;

    // 1. Header Line: Item, Vendedor
    this.drawText(page, `Item: ${seq}`, MARGIN, y, { font: fonts.bold, size: SIZES.BODY });
    
    const vendedorNome = this.getVendedorName(order);
    this.drawLabelValueInline(page, rightColX, y, 'Vendedor: ', vendedorNome, fonts);
    y -= 16;

    // 2. Line: Nº Romaneio, Telefone
    this.drawLabelValueInline(page, MARGIN, y, 'Nº Romaneio: ', String(route.name || route.id), fonts);
    this.drawLabelValueInline(page, rightColX, y, 'Telefone: ', String(order.phone || ''), fonts);
    y -= 14;

    // 3. Line: Cliente, Nº Pedido
    this.drawLabelValueInline(page, MARGIN, y, 'Cliente: ', String(order.customer_name || ''), fonts);
    this.drawLabelValueInline(page, rightColX, y, 'Nº Pedido: ', String(order.order_id_erp || ''), fonts);
    y -= 14;

    // 4. Address (Wrapped)
    const addressStr = this.formatAddress(order);
    const addressLabel = 'Endereço: ';
    const addressLabelW = fonts.bold.widthOfTextAtSize(addressLabel, SIZES.BODY);
    const addressMaxWidth = PAGE_WIDTH - MARGIN * 2 - addressLabelW;
    const addressLines = this.wrapText(addressStr, addressMaxWidth, fonts.regular, SIZES.BODY);

    this.drawText(page, addressLabel, MARGIN, y, { font: fonts.bold, size: SIZES.BODY });
    if (addressLines.length > 0) {
      this.drawText(page, addressLines[0], MARGIN + addressLabelW, y, { font: fonts.regular, size: SIZES.BODY });
      y -= SPACING.LINE;
      for (let i = 1; i < addressLines.length; i++) {
        this.drawText(page, addressLines[i], MARGIN + addressLabelW, y, { font: fonts.regular, size: SIZES.BODY });
        y -= SPACING.LINE;
      }
    } else {
      y -= SPACING.LINE;
    }
    y -= 2; // small gap

    // 5. Observations (Public)
    const obsPublic = this.getPublicObs(order);
    if (obsPublic) {
      const obsLabel = 'Observação: ';
      const obsLabelW = fonts.bold.widthOfTextAtSize(obsLabel, SIZES.BODY);
      const obsLines = this.wrapText(obsPublic, PAGE_WIDTH - MARGIN * 2 - obsLabelW, fonts.regular, SIZES.BODY);
      
      this.drawText(page, obsLabel, MARGIN, y, { font: fonts.bold, size: SIZES.BODY });
      this.drawText(page, obsLines[0], MARGIN + obsLabelW, y, { font: fonts.regular, size: SIZES.BODY });
      y -= SPACING.LINE;
      for (let i = 1; i < obsLines.length; i++) {
        this.drawText(page, obsLines[i], MARGIN + obsLabelW, y, { font: fonts.regular, size: SIZES.BODY });
        y -= SPACING.LINE;
      }
    } else {
       // draw empty label to maintain consistency if needed, or skip. Original drew it.
       this.drawText(page, 'Observação: ', MARGIN, y, { font: fonts.bold, size: SIZES.BODY });
       y -= SPACING.LINE;
    }
    y -= 2;

    // 6. Observations (Internal)
    const obsInternal = this.getInternalObs(order);
    if (obsInternal) {
      const obsILabel = 'Observação Interna: ';
      const obsILabelW = fonts.bold.widthOfTextAtSize(obsILabel, SIZES.BODY);
      const obsILines = this.wrapText(obsInternal, PAGE_WIDTH - MARGIN * 2 - obsILabelW, fonts.regular, SIZES.BODY);

      this.drawText(page, obsILabel, MARGIN, y, { font: fonts.bold, size: SIZES.BODY });
      this.drawText(page, obsILines[0], MARGIN + obsILabelW, y, { font: fonts.regular, size: SIZES.BODY });
      y -= SPACING.LINE;
      for (let i = 1; i < obsILines.length; i++) {
        this.drawText(page, obsILines[i], MARGIN + obsILabelW, y, { font: fonts.regular, size: SIZES.BODY });
        y -= SPACING.LINE;
      }
    } else {
       this.drawText(page, 'Observação Interna: ', MARGIN, y, { font: fonts.bold, size: SIZES.BODY });
       y -= SPACING.LINE;
    }

    // 7. Items Table
    y -= 4; // Space before table
    const tableResult = this.drawItemsTable(page, y, order, fonts);
    y = tableResult.newY;

    // 8. Signatures
    y -= 40; // Gap before signatures (increased from 20)
    this.drawText(page, 'Declaro que recebi o produto em perfeitas condições na data: ____/____/______', MARGIN, y, { font: fonts.regular, size: SIZES.BODY });
    
    y -= 50; // Increased gap for signatures
    
    const halfWidth = (PAGE_WIDTH - MARGIN * 2) / 2;
    const leftLineEnd = MARGIN + halfWidth - 20;
    const rightLineStart = MARGIN + halfWidth + 20;
    const rightLineEnd = PAGE_WIDTH - MARGIN;
    const lineWidth = leftLineEnd - MARGIN; // Both lines have same width

    // Draw lines
    this.drawLine(page, y, MARGIN, leftLineEnd);
    this.drawLine(page, y, rightLineStart, rightLineEnd);

    // Draw centered labels
    const label1 = 'Ass. do Recebedor';
    const label1W = fonts.regular.widthOfTextAtSize(label1, SIZES.TINY);
    const label1X = MARGIN + (lineWidth - label1W) / 2;
    
    const label2 = 'Ass. Resp pela Entrega';
    const label2W = fonts.regular.widthOfTextAtSize(label2, SIZES.TINY);
    const label2X = rightLineStart + (lineWidth - label2W) / 2;

    this.drawText(page, label1, label1X, y - 14, { font: fonts.regular, size: SIZES.TINY });
    this.drawText(page, label2, label2X, y - 14, { font: fonts.regular, size: SIZES.TINY });

    y -= 30; // Bottom padding of block
    this.drawLine(page, y, MARGIN, PAGE_WIDTH - MARGIN); // Separator between items
    y -= 20; // Margin for next item

    return y;
  }

  private static measureItemBlock(order: Order, fonts: FontSet): number {
    let height = 0;
    
    // Fixed headers (Item/Vend, Rom/Tel, Cli/Ped)
    height += 16 + 14 + 14; 

    // Address
    const addressStr = this.formatAddress(order);
    const addressLabelW = fonts.bold.widthOfTextAtSize('Endereço: ', SIZES.BODY);
    const addressLines = this.wrapText(addressStr, PAGE_WIDTH - MARGIN * 2 - addressLabelW, fonts.regular, SIZES.BODY);
    height += Math.max(1, addressLines.length) * SPACING.LINE + 2;

    // Obs Public
    const obsPublic = this.getPublicObs(order);
    const obsLabelW = fonts.bold.widthOfTextAtSize('Observação: ', SIZES.BODY);
    const obsLines = obsPublic ? this.wrapText(obsPublic, PAGE_WIDTH - MARGIN * 2 - obsLabelW, fonts.regular, SIZES.BODY) : [];
    height += Math.max(1, obsLines.length) * SPACING.LINE + 2;

    // Obs Internal
    const obsInternal = this.getInternalObs(order);
    const obsILabelW = fonts.bold.widthOfTextAtSize('Observação Interna: ', SIZES.BODY);
    const obsILines = obsInternal ? this.wrapText(obsInternal, PAGE_WIDTH - MARGIN * 2 - obsILabelW, fonts.regular, SIZES.BODY) : [];
    height += Math.max(1, obsILines.length) * SPACING.LINE + 2;

    // Table
    height += 4; // Space before
    height += this.measureItemsTable(order, fonts);
    
    // Signatures
    height += 40 + 50 + 14 + 30; // Gap + Date line + Sig line + Text + Bottom padding
    height += 20; // Margin for next item

    return height;
  }

  private static drawItemsTable(page: PDFPage, topY: number, order: Order, fonts: FontSet): { newY: number } {
    const headers = ['Código', 'Produto', 'Local', 'Data', 'Qtde', 'Marca'];
    const colWidths = [38, 240, 92, 58, 24, 79];
    const items = this.getOrderItems(order);

    // Calculate total table height first to draw the box
    const tableContentHeight = this.measureItemsTable(order, fonts);
    // Draw box
    page.drawRectangle({
      x: MARGIN,
      y: topY - tableContentHeight,
      width: PAGE_WIDTH - MARGIN * 2,
      height: tableContentHeight,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1
    });

    let y = topY - 12;
    let x = MARGIN + 2;

    // Draw Headers
    headers.forEach((h, i) => {
      this.drawText(page, h, x, y, { font: fonts.bold, size: SIZES.SMALL });
      x += colWidths[i];
    });

    y -= 14;

    // Draw Rows
    const dataVenda = this.formatDateBR(
      (order as any).raw_json?.data_venda || 
      (order as any).raw_json?.data_emissao || 
      (order as any).sale_date
    );

    for (const item of items) {
      x = MARGIN + 2;
      
      const codigo = String(item.sku || '');
      const produto = item.color ? `${item.name} - ${item.color}` : String(item.name || '');
      const local = this.resolveItemLocation(item, order, items);
      const qtde = String(item.purchased_quantity ?? item.quantity ?? 1);
      const marca = String(item.brand || '');

      // Wrap texts
      const prodLines = this.wrapText(produto, colWidths[1] - 8, fonts.regular, SIZES.SMALL);
      const localLines = this.wrapText(local, colWidths[2] - 8, fonts.regular, SIZES.SMALL);
      const marcaLines = this.wrapText(marca, colWidths[5] - 8, fonts.regular, SIZES.SMALL);

      const rowLines = Math.max(1, prodLines.length, localLines.length, marcaLines.length);
      const rowHeight = rowLines * 11;

      // Draw cells
      this.drawText(page, codigo, x, y, { font: fonts.regular, size: SIZES.SMALL });
      x += colWidths[0];

      prodLines.forEach((l, i) => this.drawText(page, l, x, y - i * 11, { font: fonts.regular, size: SIZES.SMALL }));
      x += colWidths[1];

      localLines.forEach((l, i) => this.drawText(page, l, x, y - i * 11, { font: fonts.regular, size: SIZES.SMALL }));
      x += colWidths[2];

      this.drawText(page, dataVenda, x, y, { font: fonts.regular, size: SIZES.SMALL });
      x += colWidths[3];

      this.drawText(page, qtde, x, y, { font: fonts.regular, size: SIZES.SMALL });
      x += colWidths[4];

      marcaLines.forEach((l, i) => this.drawText(page, l, x, y - i * 11, { font: fonts.regular, size: SIZES.SMALL }));

      y -= (rowHeight + 4);
    }

    return { newY: topY - tableContentHeight };
  }

  private static measureItemsTable(order: Order, fonts: FontSet): number {
    const colWidths = [38, 240, 92, 58, 24, 79];
    const items = this.getOrderItems(order);
    let height = 16; // Header height

    for (const item of items) {
      const produto = item.color ? `${item.name} - ${item.color}` : String(item.name || '');
      const local = this.resolveItemLocation(item, order, items);
      const marca = String(item.brand || '');

      const prodLines = this.wrapText(produto, colWidths[1] - 8, fonts.regular, SIZES.SMALL);
      const localLines = this.wrapText(local, colWidths[2] - 8, fonts.regular, SIZES.SMALL);
      const marcaLines = this.wrapText(marca, colWidths[5] - 8, fonts.regular, SIZES.SMALL);

      const rowLines = Math.max(1, prodLines.length, localLines.length, marcaLines.length);
      height += (rowLines * 11) + 4;
    }
    
    return height + 14; // Add some padding
  }

  // --- Helpers ---

  private static drawLabelValue(page: PDFPage, x: number, y: number, label: string, value: string, fonts: FontSet) {
    this.drawText(page, label, x, y, { font: fonts.bold, size: SIZES.BODY });
    this.drawText(page, value, x, y - 14, { font: fonts.regular, size: SIZES.SUBTITLE });
  }

  private static drawLabelValueInline(page: PDFPage, x: number, y: number, label: string, value: string, fonts: FontSet) {
    const labelW = fonts.bold.widthOfTextAtSize(label, SIZES.BODY);
    this.drawText(page, label, x, y, { font: fonts.bold, size: SIZES.BODY });
    this.drawText(page, value, x + labelW, y, { font: fonts.regular, size: SIZES.BODY });
  }

  private static drawText(page: PDFPage, text: string, x: number, y: number, options: { font: PDFFont, size: number, color?: any }) {
    page.drawText(text || '', {
      x,
      y,
      font: options.font,
      size: options.size,
      color: options.color || rgb(0, 0, 0),
    });
  }

  private static drawLine(page: PDFPage, y: number, startX: number, endX: number) {
    page.drawLine({
      start: { x: startX, y },
      end: { x: endX, y },
      thickness: 1,
      color: rgb(0, 0, 0),
    });
  }

  private static drawFooter(page: PDFPage, fonts: FontSet) {
     this.drawText(page, 'Este documento é válido como comprovante de entrega', MARGIN, 40, {
      font: fonts.regular,
      size: SIZES.BODY,
      color: rgb(0.5, 0.5, 0.5),
    });
  }

  private static wrapText(text: string, maxWidth: number, font: PDFFont, size: number): string[] {
    const words = String(text || '').split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (const w of words) {
      const test = current ? current + ' ' + w : w;
      const width = font.widthOfTextAtSize(test, size);
      if (width > maxWidth && current) {
        lines.push(current);
        current = w;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  // --- Data Accessors & Formatters ---

  private static async loadLogo(pdfDoc: PDFDocument): Promise<any> {
    const envLogo = (import.meta as any).env?.VITE_PDF_LOGO_URL as string | undefined;
    const candidates = [
        envLogo,
        '/logo.png', 
        '/logo_lojao.png',
        '/LOGONEW.png'
    ].filter(Boolean) as string[];

    for (const url of candidates) {
        try {
            const finalUrl = url.startsWith('http') ? url : window.location.origin + url;
            const resp = await fetch(finalUrl, { cache: 'no-store' });
            if (!resp.ok) continue;
            const buffer = await resp.arrayBuffer();
            try { return await pdfDoc.embedPng(buffer); } catch {
                try { return await pdfDoc.embedJpg(buffer); } catch { continue; }
            }
        } catch { continue; }
    }
    return null;
  }

  private static getVendedorName(order: Order): string {
    return String(
        (order as any).vendedor_nome || 
        (order as any).raw_json?.nome_vendedor || 
        (order as any).raw_json?.vendedor || 
        (order as any).raw_json?.vendedor_nome || 
        ''
    ).trim();
  }

  private static formatAddress(order: Order): string {
    const addr = order.address_json || { street: '', neighborhood: '', city: '', zip: '', complement: '' };
    return `${addr.street}, ${addr.neighborhood}, ${addr.city} - CEP: ${addr.zip}${addr.complement ? ' • ' + addr.complement : ''}`;
  }

  private static getPublicObs(order: Order): string {
    return (order as any).observacoes_publicas
        ?? (order as any).raw_json?.observacoes_publicas
        ?? (order as any).raw_json?.observacoes
        ?? '';
  }

  private static getInternalObs(order: Order): string {
    return (order as any).observacoes_internas ?? (order as any).raw_json?.observacoes_internas ?? '';
  }

  private static getOrderItems(order: Order): any[] {
    const items = (order as any).items_json;
    return (Array.isArray(items) && items.length > 0) ? items : [{}]; // Return empty object to force 1 row if empty
  }

  private static resolveItemLocation(item: any, order: Order, allItems: any[]): string {
    const norm = (s: any) => String(s ?? '').toLowerCase().trim();
    if (item.location) return String(item.location);
    
    const prodLoc = (order as any).raw_json?.produtos_locais;
    if (Array.isArray(prodLoc)) {
        const byCode = prodLoc.find((p: any) => norm(p?.codigo_produto) === norm(item.sku));
        if (byCode?.local_estocagem) return String(byCode.local_estocagem);
        
        const byName = prodLoc.find((p: any) => norm(p?.nome_produto) === norm(item.name));
        if (byName?.local_estocagem) return String(byName.local_estocagem);

        // Fallback strategies (index match or first)
        const idx = allItems.indexOf(item);
        if (idx >= 0 && prodLoc[idx]?.local_estocagem) return String(prodLoc[idx].local_estocagem);
        if (prodLoc[0]?.local_estocagem) return String(prodLoc[0].local_estocagem);
    }
    return '';
  }

  private static formatDateBR(input: any): string {
    if (!input) return '';
    try {
      const s = String(input);
      if (/^\d{4}-\d{2}-\d{2}/.test(s) || /T\d{2}:\d{2}:\d{2}/.test(s)) {
        const d = new Date(s);
        if (!isNaN(d.getTime())) return d.toLocaleDateString('pt-BR');
      }
      if (/^\d{10,}$/.test(s)) {
        const d = new Date(Number(s));
        if (!isNaN(d.getTime())) return d.toLocaleDateString('pt-BR');
      }
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
      const d = new Date(s);
      return !isNaN(d.getTime()) ? d.toLocaleDateString('pt-BR') : '';
    } catch { return ''; }
  }

  // Legacy methods support
  static async generateDeliverySheetWithSignature(data: DeliverySheetData, signatures: Map<string, string>): Promise<Uint8Array> {
    return await this.generateDeliverySheet(data);
  }

  static openPDFInNewTab(pdfBytes: Uint8Array): void {
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) {
      const link = document.createElement('a');
      link.href = url;
      link.download = 'romaneio.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    setTimeout(() => URL.revokeObjectURL(url), 600000);
  }
}
