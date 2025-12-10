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
  static async generateDeliverySheet(data: DeliverySheetData, title: string = 'Romaneio de Separação'): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();
    const fontSize = 11;
    const margin = 32;
    let y = height - margin;

    // Load fonts
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const isAssemblySheet = String(title || '').toLowerCase().includes('montagem');
    const isAssemblyItem = (it: any): boolean => {
      const v1 = String(it?.has_assembly ?? '').toLowerCase();
      const v2 = String(it?.possui_montagem ?? '').toLowerCase();
      const v3 = String((it as any)?.raw_json?.tem_montagem ?? '').toLowerCase();
      return v1 === 'true' || v1 === 'sim' || v2 === 'true' || v2 === 'sim' || v3 === 'true' || v3 === 'sim';
    };

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
    this.drawText(page, title, margin, y, { font: helveticaBoldFont, size: 14, color: { r: 0, g: 0, b: 0 } });
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
      
      // Precompute dynamic heights to ensure the whole block fits including signatures
      const addr = order.address_json || { street: '', neighborhood: '', city: '', zip: '', complement: '' };
      const addressValuePre = `${addr.street}, ${addr.neighborhood}, ${addr.city} - CEP: ${addr.zip}${addr.complement ? ' • ' + addr.complement : ''}`;
      const endLabelPre = 'Endereço: ';
      const endWPre = helveticaBoldFont.widthOfTextAtSize(endLabelPre, 10);
      const addressLinesPre = this.wrapText(addressValuePre, width - margin * 2 - endWPre, helveticaFont, 10);
      const obsPublicPre = (order as any).observacoes_publicas
        ?? (order as any).raw_json?.observacoes_publicas
        ?? (order as any).raw_json?.observacoes
        ?? '';
      const obsLabelPre = 'Observação: ';
      const obsWPre = helveticaBoldFont.widthOfTextAtSize(obsLabelPre, 10);
      const obsPublicLinesPre = obsPublicPre ? this.wrapText(String(obsPublicPre), width - margin * 2 - obsWPre, helveticaFont, 10) : [];
      const obsInternalPre = (order as any).observacoes_internas ?? (order as any).raw_json?.observacoes_internas ?? '';
      const obsILabelPre = 'Observação Interna: ';
      const obsIWPre = helveticaBoldFont.widthOfTextAtSize(obsILabelPre, 10);
      const obsInternalLinesPre = obsInternalPre ? this.wrapText(String(obsInternalPre), width - margin * 2 - obsIWPre, helveticaFont, 10) : [];

      // Table config & height estimation
      const headersPre = ['Código', 'Produto', 'Local', 'Data', 'Qtde', 'Marca'];
      const colsPre = [38, 240, 92, 58, 24, 79];
      const itemsAll = Array.isArray(order.items_json) && order.items_json.length > 0 ? order.items_json : [];
      const itemsPre = isAssemblySheet ? itemsAll.filter(isAssemblyItem) : itemsAll;
      let contentHeightPre = 16; // header row height
      const normPre = (s: any) => String(s ?? '').toLowerCase().trim();
      const prodLocPre = (order as any).raw_json?.produtos_locais;
      for (const it of (itemsPre.length ? itemsPre : [{} as any])) {
        const produtoNomePre = String((it as any).name || '');
        const colorStrPre = String((it as any).color || '');
        const produtoFmtPre = colorStrPre ? `${produtoNomePre} - ${colorStrPre}` : produtoNomePre;
        const productLinesPre = this.wrapText(produtoFmtPre, colsPre[1] - 8, helveticaFont, 9);

        // local (precompute same as render)
        let localPre = String(it?.location || '');
        if (!localPre && Array.isArray(prodLocPre)) {
          const byCode = prodLocPre.find((p: any) => normPre(p?.codigo_produto) === normPre(it?.sku));
          if (byCode?.local_estocagem) localPre = String(byCode.local_estocagem);
          else {
            const byName = prodLocPre.find((p: any) => normPre(p?.nome_produto) === normPre(it?.name));
            if (byName?.local_estocagem) localPre = String(byName.local_estocagem);
          }
        }
        const localLinesPre = this.wrapText(localPre, colsPre[2] - 8, helveticaFont, 9);

        // marca
        const marcaPre = String(it?.brand || '');
        const marcaLinesPre = this.wrapText(marcaPre, colsPre[5] - 8, helveticaFont, 9);
        const lineHPre = 11;
        const rowHPre = Math.max(11, productLinesPre.length * lineHPre, localLinesPre.length * lineHPre, marcaLinesPre.length * lineHPre);
        contentHeightPre += rowHPre + 4;
      }
      const tableHeightPre = contentHeightPre + 14;

      const signaturesHeight = 34 + 36 + 10; // date line spacing + two lines + bottom separator
      const staticTopHeights = 16 + 14 + 14; // Item/Vendedor, Romaneio/Telefone, Cliente/Pedido
      const observacaoInternaLabel = 10; // "Observação Interna:" label spacing
      const afterTableSpacing = 24; // gap after table before date
      const totalBlockHeight = staticTopHeights
        + addressLinesPre.length * 12
        + obsPublicLinesPre.length * 12
        + obsInternalLinesPre.length * 12
        + 14 + tableHeightPre + afterTableSpacing
        + signaturesHeight;

      if (y - totalBlockHeight < margin) {
        page = pdfDoc.addPage([595.28, 841.89]);
        y = height - margin;
        this.drawText(page, title, margin, y, { font: helveticaBoldFont, size: 14, color: { r: 0, g: 0, b: 0 } });
        y -= 16;
        page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0, 0, 0) });
        y -= 18; // extra breathing between header line and first item
      }

      this.drawText(page, `Item: ${i + 1}`, margin, y, { font: helveticaBoldFont, size: 10, color: { r: 0, g: 0, b: 0 } });
      const vendedorNome = String((order as any).vendedor_nome || (order as any).raw_json?.nome_vendedor || (order as any).raw_json?.vendedor || (order as any).raw_json?.vendedor_nome || '').trim();
      const rightColX = margin + 280;
      const vendLabel = 'Vendedor: ';
      const vendLabelW = helveticaBoldFont.widthOfTextAtSize(vendLabel, 10);
      this.drawText(page, vendLabel, rightColX, y, { font: helveticaBoldFont, size: 10, color: { r: 0, g: 0, b: 0 } });
      this.drawText(page, vendedorNome, rightColX + vendLabelW, y, { font: helveticaFont, size: 10, color: { r: 0, g: 0, b: 0 } });
      y -= 16;
      const romLabel = 'Nº Romaneio: ';
      const romLabelW = helveticaBoldFont.widthOfTextAtSize(romLabel, 10);
      this.drawText(page, romLabel, margin, y, { font: helveticaBoldFont, size: 10, color: { r: 0, g: 0, b: 0 } });
      this.drawText(page, String(data.route.name || data.route.id), margin + romLabelW, y, { font: helveticaFont, size: 10, color: { r: 0, g: 0, b: 0 } });
      const telLabel = 'Telefone: ';
      const telLabelW = helveticaBoldFont.widthOfTextAtSize(telLabel, 10);
      this.drawText(page, telLabel, rightColX, y, { font: helveticaBoldFont, size: 10, color: { r: 0, g: 0, b: 0 } });
      this.drawText(page, String(order.phone || ''), rightColX + telLabelW, y, { font: helveticaFont, size: 10, color: { r: 0, g: 0, b: 0 } });
      y -= 14;
      const cliLabel = 'Cliente: ';
      const cliLabelW = helveticaBoldFont.widthOfTextAtSize(cliLabel, 10);
      this.drawText(page, cliLabel, margin, y, { font: helveticaBoldFont, size: 10, color: { r: 0, g: 0, b: 0 } });
      this.drawText(page, String(order.customer_name || ''), margin + cliLabelW, y, { font: helveticaFont, size: 10, color: { r: 0, g: 0, b: 0 } });
      const pedLabel = 'Nº Pedido: ';
      const pedLabelW = helveticaBoldFont.widthOfTextAtSize(pedLabel, 10);
      this.drawText(page, pedLabel, rightColX, y, { font: helveticaBoldFont, size: 10, color: { r: 0, g: 0, b: 0 } });
      this.drawText(page, String(order.order_id_erp || ''), rightColX + pedLabelW, y, { font: helveticaFont, size: 10, color: { r: 0, g: 0, b: 0 } });
      y -= 14;
      // Endereço com label em negrito
      const labelEnd = 'Endereço: ';
      const lew = helveticaBoldFont.widthOfTextAtSize(labelEnd, 10);
      this.drawText(page, labelEnd, margin, y, { font: helveticaBoldFont, size: 10, color: { r: 0, g: 0, b: 0 } });
      this.drawText(page, addressLinesPre[0] || '', margin + lew, y, { font: helveticaFont, size: 10, color: { r: 0, g: 0, b: 0 } });
      y -= 12;
      for (let iLine = 1; iLine < addressLinesPre.length; iLine++) {
        this.drawText(page, addressLinesPre[iLine], margin + lew, y, { font: helveticaFont, size: 10, color: { r: 0, g: 0, b: 0 } });
        y -= 12;
      }
      y -= 6;
      const labelObs = 'Observação: ';
      const low = helveticaBoldFont.widthOfTextAtSize(labelObs, 10);
      if (obsPublicLinesPre.length > 0) {
        this.drawText(page, labelObs, margin, y, { font: helveticaBoldFont, size: 10, color: { r: 0, g: 0, b: 0 } });
        this.drawText(page, obsPublicLinesPre[0], margin + low, y, { font: helveticaFont, size: 10, color: { r: 0, g: 0, b: 0 } });
        y -= 12;
        for (let i = 1; i < obsPublicLinesPre.length; i++) { this.drawText(page, obsPublicLinesPre[i], margin + low, y, { font: helveticaFont, size: 10, color: { r: 0, g: 0, b: 0 } }); y -= 12; }
      } else {
        this.drawText(page, labelObs, margin, y, { font: helveticaBoldFont, size: 10, color: { r: 0, g: 0, b: 0 } });
        y -= 12;
      }
      y -= 6;
      const labelObsI = 'Observação Interna: ';
      const loi = helveticaBoldFont.widthOfTextAtSize(labelObsI, 10);
      if (obsInternalLinesPre.length > 0) {
        this.drawText(page, labelObsI, margin, y, { font: helveticaBoldFont, size: 10, color: { r: 0, g: 0, b: 0 } });
        this.drawText(page, obsInternalLinesPre[0], margin + loi, y, { font: helveticaFont, size: 10, color: { r: 0, g: 0, b: 0 } });
        y -= 12;
        for (let i = 1; i < obsInternalLinesPre.length; i++) { this.drawText(page, obsInternalLinesPre[i], margin + loi, y, { font: helveticaFont, size: 10, color: { r: 0, g: 0, b: 0 } }); y -= 12; }
      } else {
        this.drawText(page, labelObsI, margin, y, { font: helveticaBoldFont, size: 10, color: { r: 0, g: 0, b: 0 } });
        y -= 12;
      }

      // Items table (multi-itens) - ordem: Código, Produto(+Cor), Local, Data, Qtde, Marca (sem Filial)
      const tableTop = y - 14;
      const tableWidth = width - margin * 2;
      const headers = headersPre;
      const cols = colsPre;

      const items = itemsPre;
      const filial = (order as any).raw_json?.filial_entrega || (order as any).raw_json?.filial_venda || '';
      const saleDateRaw = (order as any).raw_json?.data_venda
        || (order as any).raw_json?.data_emissao
        || (order as any).sale_date
        || '';
      const dataStr = DeliverySheetGenerator.formatDateBR(saleDateRaw);

      // Calculate total height
      let contentHeight = contentHeightPre;
      let tableHeight = tableHeightPre;
      page.drawRectangle({ x: margin, y: tableTop - tableHeight, width: tableWidth, height: tableHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });

      // Header
      let x = margin + 2; let hy = tableTop - 12;
      headers.forEach((h, idx) => { this.drawText(page, h, x, hy, { font: helveticaBoldFont, size: 9, color: { r: 0, g: 0, b: 0 } }); x += cols[idx]; });

      // Rows
      hy -= 14; x = margin + 2;
      const rowsCount = items.length ? items.length : 1;
      for (let rIdx = 0; rIdx < rowsCount; rIdx++) {
        const it = items[rIdx] || {} as any;
        const qtde = (it.purchased_quantity ?? it.quantity ?? 1);
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
        const lineH = 11;
        const rowHeight = Math.max(11, productLines.length * lineH, localLines.length * lineH, marcaLines.length * lineH);

        // Colunas na ordem: Código | Produto(+Cor) | Local | Data | Qtde | Marca
        let xx = margin + 2;
        this.drawText(page, String(codigo), xx, hy, { font: helveticaFont, size: 9, color: { r: 0, g: 0, b: 0 } });
        xx += cols[0];

        productLines.forEach((pl, pi) => { this.drawText(page, pl, xx, hy - pi * lineH, { font: helveticaFont, size: 9, color: { r: 0, g: 0, b: 0 } }); });
        xx += cols[1];

        localLines.forEach((ll, li) => { this.drawText(page, ll, xx, hy - li * lineH, { font: helveticaFont, size: 9, color: { r: 0, g: 0, b: 0 } }); });
        xx += cols[2];

        this.drawText(page, dataStr, xx, hy, { font: helveticaFont, size: 9, color: { r: 0, g: 0, b: 0 } });
        xx += cols[3];

        this.drawText(page, String(qtde), xx, hy, { font: helveticaFont, size: 9, color: { r: 0, g: 0, b: 0 } });
        xx += cols[4];

        marcaLines.forEach((ml, mi) => { this.drawText(page, ml, xx, hy - mi * lineH, { font: helveticaFont, size: 9, color: { r: 0, g: 0, b: 0 } }); });

        hy -= (rowHeight + 4);
      }

      y = tableTop - tableHeight - 26; // small extra gap after table

      // Declaration and signatures
      this.drawText(page, 'Declaro que recebi o produto em perfeitas condições na data: ____/____/______', margin, y, { font: helveticaFont, size: 10, color: { r: 0, g: 0, b: 0 } });
      y -= 34;
      const half = (width - margin * 2) / 2;
      const leftLineEnd = margin + half - 20;
      const rightLineStart = margin + half + 20;
      const rightLineEnd = width - margin;
      page.drawLine({ start: { x: margin, y }, end: { x: leftLineEnd, y }, thickness: 1, color: rgb(0, 0, 0) });
      this.drawText(page, 'Ass. do Recebedor', margin, y - 14, { font: helveticaFont, size: 8, color: { r: 0, g: 0, b: 0 } });
      page.drawLine({ start: { x: rightLineStart, y }, end: { x: rightLineEnd, y }, thickness: 1, color: rgb(0, 0, 0) });
      this.drawText(page, 'Ass. Resp pela Entrega', rightLineStart, y - 14, { font: helveticaFont, size: 8, color: { r: 0, g: 0, b: 0 } });
      y -= 40; // extra bottom breathing before next item or page footer
      page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0, 0, 0) });
      y -= 20; // extra gap before next item on same page
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
