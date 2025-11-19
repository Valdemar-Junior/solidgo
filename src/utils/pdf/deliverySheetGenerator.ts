import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { Route, RouteOrder, Order, DriverWithUser, Vehicle } from '../../types/database';

export interface DeliverySheetData {
  route: Route;
  routeOrders: RouteOrder[];
  driver: DriverWithUser;
  vehicle?: Vehicle;
  orders: Order[];
  generatedAt: string;
}

export class DeliverySheetGenerator {
  static async generateDeliverySheet(data: DeliverySheetData): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();
    const fontSize = 11;
    const margin = 40;
    let y = height - margin;

    // Load fonts
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Header brand and title
    const envLogo = (import.meta as any).env?.VITE_PDF_LOGO_URL as string | undefined;
    const origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
    const baseTag = (typeof document !== 'undefined') ? document.querySelector('base') as HTMLBaseElement | null : null;
    const baseHref = (baseTag && baseTag.getAttribute('href')) || (import.meta as any).env?.BASE_URL || '/';
    const withBase = (p: string) => {
      try { return new URL(p.replace(/^\/?/, ''), origin + (baseHref || '/')).toString(); } catch { return p; }
    };
    const candidates = [
      envLogo,
      withBase('logo.png'), withBase('logo.jpg'), withBase('logo.jpeg'),
      origin ? origin + '/logo.png' : undefined,
      '/LOGONEW.png', '/LOGONEW .png'
    ].filter(Boolean) as string[];
    let drawnLogoHeight = 0;
    let logoOk = false;
    for (const url of candidates) {
      try {
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) continue;
        const logoBytes = await resp.arrayBuffer();
        let logoImg: any = null;
        try {
          logoImg = await pdfDoc.embedPng(logoBytes);
        } catch {
          try { logoImg = await pdfDoc.embedJpg(logoBytes); } catch { logoImg = null; }
        }
        if (!logoImg) continue;
        const logoW = 140;
        const logoH = (logoImg.height / logoImg.width) * logoW;
        page.drawImage(logoImg, { x: margin, y: y - logoH + 4, width: logoW, height: logoH });
        drawnLogoHeight = logoH;
        logoOk = true;
        break;
      } catch {}
    }
    if (!logoOk) {
      this.drawText(page, 'Lojão dos Móveis', margin, y, { font: helveticaBoldFont, size: 16, color: { r: 0, g: 0, b: 0 } });
    }
    y -= drawnLogoHeight ? drawnLogoHeight + 6 : 24;
    this.drawText(page, 'Romaneio de Separação', margin, y, { font: helveticaBoldFont, size: 14, color: { r: 0, g: 0, b: 0 } });
    this.drawText(page, `Data e Hora da impressão: ${new Date(data.generatedAt).toLocaleString('pt-BR')}`, margin, y - 16, { font: helveticaFont, size: 9, color: { r: 0, g: 0, b: 0 } });
    y -= 26;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0, 0, 0) });
    y -= 12;

    // Romaneio overview grid
    const gridY = y;
    this.drawText(page, `Nº do Romaneio`, margin, gridY, { font: helveticaBoldFont, size: 10, color: { r: 0, g: 0, b: 0 } });
    this.drawText(page, String(data.route.name || data.route.id), margin, gridY - 14, { font: helveticaFont, size: 11, color: { r: 0, g: 0, b: 0 } });
    this.drawText(page, `KM Inicial`, margin + 150, gridY, { font: helveticaBoldFont, size: 10, color: { r: 0, g: 0, b: 0 } });
    this.drawText(page, ``, margin + 150, gridY - 14, { font: helveticaFont, size: 11, color: { r: 0, g: 0, b: 0 } });
    this.drawText(page, `KM Final`, margin + 260, gridY, { font: helveticaBoldFont, size: 10, color: { r: 0, g: 0, b: 0 } });
    this.drawText(page, ``, margin + 260, gridY - 14, { font: helveticaFont, size: 11, color: { r: 0, g: 0, b: 0 } });
    this.drawText(page, `Ajudante`, margin + 360, gridY, { font: helveticaBoldFont, size: 10, color: { r: 0, g: 0, b: 0 } });
    this.drawText(page, ``, margin + 360, gridY - 14, { font: helveticaFont, size: 11, color: { r: 0, g: 0, b: 0 } });
    this.drawText(page, `Transportador`, margin, gridY - 32, { font: helveticaBoldFont, size: 10, color: { r: 0, g: 0, b: 0 } });
    this.drawText(page, `Veículo`, margin + 260, gridY - 32, { font: helveticaBoldFont, size: 10, color: { r: 0, g: 0, b: 0 } });
    this.drawText(page, `Placa`, margin + 420, gridY - 32, { font: helveticaBoldFont, size: 10, color: { r: 0, g: 0, b: 0 } });
    const vehicleText = data.vehicle ? `${data.vehicle.model}` : '';
    const plateText = data.vehicle ? `${data.vehicle.plate}` : '';
    this.drawText(page, vehicleText, margin + 260, gridY - 46, { font: helveticaFont, size: 11, color: { r: 0, g: 0, b: 0 } });
    this.drawText(page, plateText, margin + 420, gridY - 46, { font: helveticaFont, size: 11, color: { r: 0, g: 0, b: 0 } });
    y = gridY - 60;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0, 0, 0) });
    y -= 10;

    // Per-item blocks following the provided structure
    for (let i = 0; i < data.routeOrders.length; i++) {
      const ro = data.routeOrders[i];
      const order = data.orders.find(o => o.id === ro.order_id);
      if (!order) continue;
      if (y < 220) { page = pdfDoc.addPage([595.28, 841.89]); y = height - margin; this.drawText(page, 'Romaneio de Separação', margin, y, { font: helveticaBoldFont, size: 14, color: { r: 0, g: 0, b: 0 } }); y -= 16; page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0, 0, 0) }); y -= 12; }

      this.drawText(page, `Item: ${i + 1}`, margin, y, { font: helveticaBoldFont, size: 11, color: { r: 0, g: 0, b: 0 } });
      this.drawText(page, `Vendedor: ${data.route.conferente || ''}`, margin + 350, y, { font: helveticaFont, size: 10, color: { r: 0, g: 0, b: 0 } });
      y -= 16;
      this.drawText(page, `Nº Romaneio: ${data.route.name || data.route.id}`, margin, y, { font: helveticaFont, size: 11, color: { r: 0, g: 0, b: 0 } });
      this.drawText(page, `Telefone: ${order.phone || ''}`, margin + 280, y, { font: helveticaFont, size: 11, color: { r: 0, g: 0, b: 0 } });
      y -= 14;
      this.drawText(page, `Cliente: ${order.customer_name || ''}`, margin, y, { font: helveticaBoldFont, size: 11, color: { r: 0, g: 0, b: 0 } });
      this.drawText(page, `Nº Pedido: ${order.order_id_erp || ''}`, margin + 280, y, { font: helveticaFont, size: 11, color: { r: 0, g: 0, b: 0 } });
      y -= 14;
      const addr = order.address_json || { street: '', neighborhood: '', city: '', zip: '', complement: '' };
      const addressFull = `Endereço: ${addr.street}, ${addr.neighborhood}, ${addr.city} - CEP: ${addr.zip}${addr.complement ? ' • ' + addr.complement : ''}`;
      const addressLines = this.wrapText(addressFull, width - margin * 2, helveticaFont, 10);
      for (const line of addressLines) { this.drawText(page, line, margin, y, { font: helveticaFont, size: 10, color: { r: 0, g: 0, b: 0 } }); y -= 12; }
      const obs = order.observations ? `Observação: ${order.observations}` : 'Observação:';
      const obsLines = this.wrapText(obs, width - margin * 2, helveticaFont, 10);
      for (const line of obsLines) { this.drawText(page, line, margin, y, { font: helveticaFont, size: 10, color: { r: 0, g: 0, b: 0 } }); y -= 12; }
      this.drawText(page, `Observação Interna:`, margin, y, { font: helveticaFont, size: 10, color: { r: 0, g: 0, b: 0 } });
      y -= 10;

      // Items table (multi-itens) - ordem: Código, Produto(+Cor), Local, Data, Qtde, Marca (sem Filial)
      const tableTop = y - 14;
      const tableWidth = width - margin * 2;
      const headers = ['Código', 'Produto', 'Local', 'Data', 'Qtde', 'Marca'];
      // Larguras fechando exatamente o tableWidth: 60 + 240 + 100 + 60 + 30 + 25 = 515
      const cols = [60, 240, 100, 60, 30, 25];

      const items = Array.isArray(order.items_json) && order.items_json.length > 0 ? order.items_json : [];
      const filial = (order as any).raw_json?.filial_entrega || (order as any).raw_json?.filial_venda || '';
      const saleDateRaw = (order as any).raw_json?.data_venda
        || (order as any).raw_json?.data_emissao
        || (order as any).sale_date
        || '';
      const dataStr = DeliverySheetGenerator.formatDateBR(saleDateRaw);

      // Calculate total height
      let contentHeight = 16; // header
      const rowHeightsCalc: number[] = [];
      for (const it of (items.length ? items : [{} as any])) {
        const produtoNome = String((it as any).name || '');
        const colorStr = String((it as any).color || '');
        const produtoFmt = colorStr ? `${produtoNome} - ${colorStr}` : produtoNome;
        const productLines = this.wrapText(produtoFmt, cols[1] - 8, helveticaFont, 9);
        const rowH = Math.max(12, productLines.length * 12);
        rowHeightsCalc.push(rowH);
        contentHeight += rowH + 6;
      }
      let tableHeight = contentHeight + 14;
      page.drawRectangle({ x: margin, y: tableTop - tableHeight, width: tableWidth, height: tableHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });

      // Header
      let x = margin + 4; let hy = tableTop - 12;
      headers.forEach((h, idx) => { this.drawText(page, h, x, hy, { font: helveticaBoldFont, size: 9, color: { r: 0, g: 0, b: 0 } }); x += cols[idx]; });

      // Rows
      hy -= 14; x = margin + 4;
      const rowsCount = items.length ? items.length : 1;
      for (let rIdx = 0; rIdx < rowsCount; rIdx++) {
        const it = items[rIdx] || {} as any;
        const qtde = it.quantity ?? 1;
        const codigo = it.sku ?? '';
        const marca = it.brand ?? '';
        const color = it.color ?? '';
        const norm = (s: any) => String(s ?? '').toLowerCase().trim();
        const resolveLocal = (): string => {
          // priority: item.location > match by codigo > match by nome > same index > first entry
          if (it.location) return String(it.location);
          const prodLoc = (order as any).raw_json?.produtos_locais;
          if (Array.isArray(prodLoc)) {
            const byCode = prodLoc.find((p: any) => norm(p?.codigo_produto) === norm(codigo));
            if (byCode?.local_estocagem) return String(byCode.local_estocagem);
            const byName = prodLoc.find((p: any) => norm(p?.nome_produto) === norm(it?.name));
            if (byName?.local_estocagem) return String(byName.local_estocagem);
            if (prodLoc[rIdx]?.local_estocagem) return String(prodLoc[rIdx].local_estocagem);
            if (prodLoc[0]?.local_estocagem) return String(prodLoc[0].local_estocagem);
          }
          return '';
        };
        const local = resolveLocal();
        const produto = String(it.name ?? '');
        const produtoFmt = color ? `${produto} - ${color}` : produto;
        const productLines = this.wrapText(produtoFmt, cols[1] - 8, helveticaFont, 9);
        const localLines = this.wrapText(String(local || ''), cols[2] - 8, helveticaFont, 9);
        const marcaLines = this.wrapText(String(marca || ''), cols[5] - 8, helveticaFont, 9);
        const rowHeight = Math.max(12, productLines.length * 12, localLines.length * 12, marcaLines.length * 12);

        // Colunas na ordem: Código | Produto(+Cor) | Local | Data | Qtde | Marca
        let xx = margin + 4;
        this.drawText(page, String(codigo), xx, hy, { font: helveticaFont, size: 9, color: { r: 0, g: 0, b: 0 } });
        xx += cols[0];

        productLines.forEach((pl, pi) => { this.drawText(page, pl, xx, hy - pi * 12, { font: helveticaFont, size: 9, color: { r: 0, g: 0, b: 0 } }); });
        xx += cols[1];

        localLines.forEach((ll, li) => { this.drawText(page, ll, xx, hy - li * 12, { font: helveticaFont, size: 9, color: { r: 0, g: 0, b: 0 } }); });
        xx += cols[2];

        this.drawText(page, dataStr, xx, hy, { font: helveticaFont, size: 9, color: { r: 0, g: 0, b: 0 } });
        xx += cols[3];

        this.drawText(page, String(qtde), xx, hy, { font: helveticaFont, size: 9, color: { r: 0, g: 0, b: 0 } });
        xx += cols[4];

        marcaLines.forEach((ml, mi) => { this.drawText(page, ml, xx, hy - mi * 12, { font: helveticaFont, size: 9, color: { r: 0, g: 0, b: 0 } }); });

        hy -= (rowHeight + 6);
      }

      y = tableTop - tableHeight - 10;

      // Declaration and signatures
      this.drawText(page, 'Declaro que recebi o produto em perfeitas condições na data: ____/____/______', margin, y, { font: helveticaFont, size: 10, color: { r: 0, g: 0, b: 0 } });
      y -= 18;
      page.drawLine({ start: { x: margin, y }, end: { x: margin + 220, y }, thickness: 1, color: rgb(0, 0, 0) });
      this.drawText(page, 'Ass. do Recebedor', margin, y - 12, { font: helveticaFont, size: 8, color: { r: 0, g: 0, b: 0 } });
      page.drawLine({ start: { x: margin + 260, y }, end: { x: margin + 480, y }, thickness: 1, color: rgb(0, 0, 0) });
      this.drawText(page, 'Ass. Resp pela Entrega', margin + 260, y - 12, { font: helveticaFont, size: 8, color: { r: 0, g: 0, b: 0 } });
      y -= 24;
      page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0, 0, 0) });
      y -= 10;
    }

    // End footer

    // Footer
    const footerY = 40;
    this.drawText(page, 'Este documento é válido como comprovante de entrega', margin, footerY, {
      font: helveticaFont,
      size: 10,
      color: { r: 0.5, g: 0.5, b: 0.5 },
    });

    return await pdfDoc.save();
  }

  private static drawText(
    page: any,
    text: string,
    x: number,
    y: number,
    options: {
      font: any;
      size: number;
      color: { r: number; g: number; b: number };
    }
  ): void {
    page.drawText(text, {
      x,
      y,
      font: options.font,
      size: options.size,
      color: rgb(options.color.r, options.color.g, options.color.b),
    });
  }

  private static truncateText(text: string, maxLength: number): string {
    return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
  }

  private static fitText(text: string, maxWidth: number, font: any, size: number): string {
    let t = String(text || '');
    if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
    const ell = '...';
    let lo = 0, hi = t.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const candidate = t.substring(0, mid) + ell;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) lo = mid + 1; else hi = mid;
    }
    const slice = Math.max(0, lo - 1);
    return (slice <= 0) ? ell : t.substring(0, slice) + ell;
  }

  private static wrapText(text: string, maxWidth: number, font: any, size: number): string[] {
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

  private static formatDateBR(input: any): string {
    if (!input) return '';
    try {
      const s = String(input);
      // ISO or YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}/.test(s) || /T\d{2}:\d{2}:\d{2}/.test(s)) {
        const d = new Date(s);
        if (!isNaN(d.getTime())) return d.toLocaleDateString('pt-BR');
      }
      // Epoch milliseconds
      if (/^\d{10,}$/.test(s)) {
        const d = new Date(Number(s));
        if (!isNaN(d.getTime())) return d.toLocaleDateString('pt-BR');
      }
      // dd/MM/yyyy
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
      const d = new Date(s);
      return !isNaN(d.getTime()) ? d.toLocaleDateString('pt-BR') : '';
    } catch {
      return '';
    }
  }

  static async generateDeliverySheetWithSignature(
    data: DeliverySheetData,
    signatures: Map<string, string> // order_id -> base64 signature
  ): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.load(await this.generateDeliverySheet(data));
    
    // Add signatures to the PDF
    // This is a simplified version - in a real implementation,
    // you would need to properly position the signatures on each order's signature box
    
    return await pdfDoc.save();
  }

  static downloadPDF(pdfBytes: Uint8Array, filename: string): void {
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  static openPDFInNewTab(pdfBytes: Uint8Array): void {
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
