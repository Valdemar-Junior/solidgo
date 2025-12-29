
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { AssemblyRoute, AssemblyProductWithDetails } from '../../types/database';

export interface AssemblyReportData {
    route: AssemblyRoute;
    products: AssemblyProductWithDetails[];
    installerName: string;
    supervisorName: string; // Conferente
    vehicleInfo: string;
    generatedAt: string;
}

export class AssemblyReportGenerator {
    static async generateAssemblyReport(data: AssemblyReportData): Promise<Uint8Array> {
        const pdfDoc = await PDFDocument.create();
        let page = pdfDoc.addPage([595.28, 841.89]); // A4 portrait
        const { width, height } = page.getSize();

        // Fonts
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        const margin = 40;
        let y = height - margin;

        // Helper to draw centered text in a box
        const drawCenteredText = (text: string, x: number, y: number, boxWidth: number, fontRef: any, size: number, color: any) => {
            const textWidth = fontRef.widthOfTextAtSize(text, size);
            page.drawText(text, {
                x: x + (boxWidth - textWidth) / 2,
                y,
                size,
                font: fontRef,
                color
            });
        };

        // --- HEADER ---

        // Logo Logic
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
            '/LOGONEW.png'
        ].filter(Boolean) as string[];

        let logoDrawn = false;
        for (const url of candidates) {
            try {
                const resp = await fetch(url, { cache: 'no-store' });
                if (!resp.ok) continue;
                const buffer = await resp.arrayBuffer();
                let image;
                try { image = await pdfDoc.embedPng(buffer); } catch { try { image = await pdfDoc.embedJpg(buffer); } catch { } }
                if (image) {
                    const logoH = 40;
                    const logoW = (image.width / image.height) * logoH;
                    page.drawImage(image, { x: margin, y: y - logoH, width: logoW, height: logoH });
                    logoDrawn = true;
                    break;
                }
            } catch (e) {
                // ignore
            }
        }

        if (!logoDrawn) {
            page.drawText('Lojão', { x: margin, y: y - 20, size: 24, font: fontBold, color: rgb(0.9, 0.1, 0.1) });
            page.drawText('DOS MÓVEIS', { x: margin + 70, y: y - 20, size: 12, font: font, color: rgb(0.9, 0.4, 0.4) });
        }

        // Header Right
        const routeName = data.route.name || `Montagem #${data.route.id.slice(0, 6)}`;
        const routeId = `#M${data.route.id.slice(0, 5).toUpperCase()}`;
        const dateStr = new Date(data.generatedAt).toLocaleDateString('pt-BR');

        page.drawText(routeName, {
            x: width - margin - fontBold.widthOfTextAtSize(routeName, 18),
            y: y - 15,
            size: 18,
            font: fontBold,
            color: rgb(0.2, 0.2, 0.3)
        });

        page.drawText(routeId, {
            x: width - margin - fontBold.widthOfTextAtSize(routeId, 10),
            y: y - 30,
            size: 10,
            font: fontBold,
            color: rgb(0.5, 0.5, 0.5)
        });

        page.drawText(dateStr, {
            x: width - margin - font.widthOfTextAtSize(dateStr, 10),
            y: y - 42,
            size: 10,
            font: font,
            color: rgb(0.5, 0.5, 0.5)
        });

        page.drawText('RELATÓRIO DE MONTAGEM', {
            x: margin,
            y: y - 55,
            size: 8,
            font: fontBold,
            color: rgb(0.5, 0.5, 0.6)
        });

        y -= 70;

        // Divider
        page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0.9, 0.9, 0.9) });
        y -= 20;

        // --- KPIs ---
        const products = data.products;
        const total = products.length;
        const completed = products.filter(o => o.status === 'completed').length;
        const pending = products.filter(o => o.status === 'pending' || o.status === 'in_progress').length;
        // Assembly usually doesn't have "returned" in the same sense, but maybe "cancelled" or "was_returned"
        const returned = products.filter(o => o.status === 'cancelled' || o.was_returned).length;
        const rate = total > 0 ? ((completed / total) * 100).toFixed(1) + '%' : '0%';

        const kwiWidth = (width - margin * 2) / 5;
        const kpiY = y;

        // Draw KPIs
        const drawKPI = (label: string, value: string | number, color: any, idx: number) => {
            const xBase = margin + (idx * kwiWidth);
            if (idx < 4) {
                page.drawLine({
                    start: { x: xBase + kwiWidth, y: kpiY + 10 },
                    end: { x: xBase + kwiWidth, y: kpiY - 30 },
                    thickness: 1,
                    color: rgb(0.9, 0.9, 0.9)
                });
            }
            drawCenteredText(label, xBase, kpiY, kwiWidth, fontBold, 8, rgb(0.6, 0.6, 0.6));
            drawCenteredText(String(value), xBase, kpiY - 20, kwiWidth, fontBold, 18, color);
        };

        drawKPI('TOTAL PRODUTOS', total, rgb(0.2, 0.2, 0.2), 0);
        drawKPI('MONTADOS', completed, rgb(0.1, 0.7, 0.3), 1);
        drawKPI('PENDENTES', pending, rgb(0.9, 0.5, 0.1), 2); // Orange for pending
        drawKPI('CANCELAD/DEVOL', returned, rgb(0.9, 0.2, 0.2), 3);
        drawKPI('TAXA MONTAGEM', rate, rgb(0.3, 0.5, 0.9), 4);

        y -= 50;

        // --- LOGISTICS DETAILS ---
        const drawDetail = (label: string, value: string, idx: number) => {
            const colW = (width - margin * 2) / 3;
            const x = margin + (idx * colW);
            page.drawText(label, { x, y: y, size: 7, font: fontBold, color: rgb(0.6, 0.6, 0.6) });
            page.drawText(value, { x, y: y - 15, size: 9, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
        };

        const routeDate = data.route.deadline ? new Date(data.route.deadline).toLocaleDateString('pt-BR') : dateStr;

        drawDetail('DATA PREVISTA', routeDate, 0); // Or execution date
        drawDetail('MONTADOR', data.installerName || '-', 1);
        drawDetail('VEÍCULO', data.vehicleInfo || '-', 2);

        y -= 40;

        // --- GROUPING HELPER ---
        // Group products by Order
        interface GroupedOrder {
            orderId: string;
            orderRef: string;
            customerName: string;
            address: string;
            phone?: string;
            items: AssemblyProductWithDetails[];
        }

        const groupProducts = (prods: AssemblyProductWithDetails[]) => {
            const map = new Map<string, GroupedOrder>();
            prods.forEach(p => {
                const oid = String(p.order_id);
                if (!map.has(oid)) {
                    const addr = p.order?.address_json;
                    const addrStr = `${addr?.street || ''}${addr?.neighborhood ? `, ${addr.neighborhood}` : ''}${addr?.city ? `, ${addr.city}` : ''}`;
                    map.set(oid, {
                        orderId: oid,
                        orderRef: p.order?.order_id_erp || oid.slice(0, 6),
                        customerName: p.order?.customer_name || 'Cliente Desconhecido',
                        address: addrStr,
                        phone: p.order?.phone || '',
                        items: []
                    });
                }
                map.get(oid)!.items.push(p);
            });
            return Array.from(map.values());
        };

        // --- TABLE GENERATION (Grouped) ---
        const drawGroupedTable = (title: string, groups: GroupedOrder[], badgeColor: any) => {
            // Section Title
            page.drawRectangle({ x: margin, y, width: width - margin * 2, height: 24, color: rgb(1, 1, 1) });
            page.drawCircle({ x: margin + 12, y: y + 12, size: 8, color: badgeColor, opacity: 0.1 });
            page.drawText(title, { x: margin + 28, y: y + 9, size: 12, font: fontBold, color: rgb(0.2, 0.2, 0.3) });

            y -= 20;

            if (groups.length === 0) {
                page.drawText('Nenhum item.', { x: margin + 10, y: y - 10, size: 9, font, color: rgb(0.6, 0.6, 0.6) });
                y -= 30;
                return;
            }

            for (const group of groups) {
                // Check page break
                if (y < margin + 60) { // Enough for header + 1 item
                    page = pdfDoc.addPage([595.28, 841.89]);
                    y = height - margin;
                }

                // Order Header (Gray Box)
                page.drawRectangle({
                    x: margin, y: y - 20, width: width - margin * 2, height: 20, color: rgb(0.96, 0.97, 0.98)
                });

                const headerText = `Pedido: ${group.orderRef} • ${group.customerName} • ${group.address}`;
                // Truncate header text if needed
                page.drawText(headerText, {
                    x: margin + 10, y: y - 13, size: 9, font: fontBold, color: rgb(0.3, 0.3, 0.4)
                });

                y -= 20;

                // Column Headers
                const cols = [
                    { label: 'PRODUTO / SKU', widthPct: 50 },
                    { label: 'STATUS', widthPct: 20 },
                    { label: 'OBSERVAÇÕES', widthPct: 20 },
                    { label: 'CONF.', widthPct: 10 }
                ];

                const availW = width - margin * 2;
                const colWs = cols.map(c => availW * (c.widthPct / 100));

                // Draw col headers
                let cx = margin + 10;
                cols.forEach((c, i) => {
                    page.drawText(c.label, { x: cx, y: y - 10, size: 7, font: fontBold, color: rgb(0.6, 0.6, 0.6) });
                    cx += colWs[i];
                });

                y -= 15;

                // Items
                for (const item of group.items) {
                    if (y < margin + 20) {
                        page = pdfDoc.addPage([595.28, 841.89]);
                        y = height - margin;
                        // Redraw order ref just to be nice? No, complexity.
                    }

                    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: rgb(0.9, 0.9, 0.9) });
                    y -= 12;

                    let rowX = margin + 10;

                    // Col 1: Product
                    const prodName = `${item.product_name} (${item.product_sku || '-'})`;
                    let cleanProdName = prodName;
                    if (font.widthOfTextAtSize(cleanProdName, 9) > colWs[0] - 10) {
                        // simple truncate
                        while (cleanProdName.length > 0 && font.widthOfTextAtSize(cleanProdName + '...', 9) > colWs[0] - 10) cleanProdName = cleanProdName.slice(0, -1);
                        cleanProdName += '...';
                    }
                    page.drawText(cleanProdName, { x: rowX, y, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
                    rowX += colWs[0];

                    // Col 2: Status
                    let statusMap: any = { 'pending': 'Pendente', 'completed': 'Montado', 'assigned': 'Atribuído', 'in_progress': 'Em Andamento', 'cancelled': 'Cancelado' };
                    let stText = statusMap[item.status] || item.status;
                    if (item.status === 'completed' && item.completion_date) {
                        stText += ` ${new Date(item.completion_date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
                    }
                    page.drawText(stText, { x: rowX, y, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
                    rowX += colWs[1];

                    // Col 3: Obs
                    let obs = item.observations || item.technical_notes || '-';
                    if (font.widthOfTextAtSize(obs, 8) > colWs[2] - 10) {
                        obs = obs.substring(0, 15) + '...';
                    }
                    page.drawText(obs, { x: rowX, y, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
                    rowX += colWs[2];

                    // Col 4: Checkbox
                    page.drawRectangle({
                        x: rowX + (colWs[3] - 12) / 2,
                        y: y - 2,
                        width: 12, height: 12,
                        borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1, color: rgb(1, 1, 1)
                    });

                    y -= 8;
                }

                y -= 15; // Gap between orders
            }
        };

        const completedItems = products.filter(p => p.status === 'completed');
        const pendingItems = products.filter(p => p.status !== 'completed');

        const groupedCompleted = groupProducts(completedItems);
        const groupedPending = groupProducts(pendingItems);

        if (groupedCompleted.length > 0) {
            drawGroupedTable('Itens Montados', groupedCompleted, rgb(0.2, 0.8, 0.4));
        }

        if (groupedPending.length > 0) {
            drawGroupedTable('Itens Pendentes / Outros', groupedPending, rgb(0.9, 0.6, 0.2));
        }

        // --- FOOTER SIGNATURES ---
        if (y < 120) { page = pdfDoc.addPage([595.28, 841.89]); y = height - margin; } else { y -= 40; }

        const sigY = y;
        const halfW = (width - margin * 2) / 2;

        // Installer Signature - Centered since it's the only one
        page.drawLine({ start: { x: margin + halfW / 2, y: sigY }, end: { x: margin + halfW + halfW / 2, y: sigY }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
        drawCenteredText('ASSINATURA DO MONTADOR', margin + halfW / 2, sigY - 15, halfW, fontBold, 8, rgb(0.3, 0.3, 0.3));
        drawCenteredText('Declaro que os serviços foram realizados', margin + halfW / 2, sigY - 25, halfW, font, 6, rgb(0.6, 0.6, 0.6));

        // Bottom Footer
        page.drawText(`SolidGO - Gestão de Montagem | Gerado em ${new Date(data.generatedAt).toLocaleString('pt-BR')}`, {
            x: margin, y: 20, size: 6, font, color: rgb(0.7, 0.7, 0.7)
        });

        return await pdfDoc.save();
    }
}
