
import { PDFDocument, rgb, StandardFonts, values } from 'pdf-lib';
import type { RouteWithDetails } from '../../types/database';
import { sanitizePdfText, wrapTextSafe, fitTextSafe } from './pdfTextSanitizer';

export interface RouteReportData {
    route: RouteWithDetails;
    driverName: string;
    supervisorName: string;
    vehicleInfo: string;
    teamName: string;
    helperName: string;
    generatedAt: string;
}

export class RouteReportGenerator {
    static async generateRouteReport(data: RouteReportData): Promise<Uint8Array> {
        const pdfDoc = await PDFDocument.create();
        let page = pdfDoc.addPage([595.28, 841.89]); // A4 portrait
        const { width, height } = page.getSize();

        // Fonts
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        const margin = 40;
        let y = height - margin;

        // Helper to draw centered text in a box (with sanitization)
        const drawCenteredText = (text: string, x: number, y: number, boxWidth: number, fontRef: any, size: number, color: any) => {
            const safeText = sanitizePdfText(text);
            try {
                const textWidth = fontRef.widthOfTextAtSize(safeText, size);
                page.drawText(safeText, {
                    x: x + (boxWidth - textWidth) / 2,
                    y,
                    size,
                    font: fontRef,
                    color
                });
            } catch (e) {
                console.warn('[PDF] Error drawing centered text:', e);
            }
        };

        // --- HEADER ---

        // Logo (Reuse logic from DeliverySheetGenerator)
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

        // Header Right - Route ID and Name
        const routeName = data.route.name || '-';
        const routeCode = (data.route as any).route_code || `#${data.route.id.slice(0, 6)}`;
        const dateStr = new Date(data.generatedAt).toLocaleDateString('pt-BR');

        // ID do Romaneio (route_code)
        page.drawText(routeCode, {
            x: width - margin - fontBold.widthOfTextAtSize(routeCode, 14),
            y: y - 12,
            size: 14,
            font: fontBold,
            color: rgb(0.2, 0.2, 0.3)
        });

        // Nome da Rota
        page.drawText(`Rota: ${routeName}`, {
            x: width - margin - font.widthOfTextAtSize(`Rota: ${routeName}`, 10),
            y: y - 28,
            size: 10,
            font: font,
            color: rgb(0.4, 0.4, 0.4)
        });

        page.drawText(dateStr, {
            x: width - margin - font.widthOfTextAtSize(dateStr, 10),
            y: y - 42,
            size: 10,
            font: font,
            color: rgb(0.5, 0.5, 0.5)
        });

        page.drawText(dateStr, {
            x: width - margin - font.widthOfTextAtSize(dateStr, 10),
            y: y - 42,
            size: 10,
            font: font,
            color: rgb(0.5, 0.5, 0.5)
        });

        page.drawText('RELATÓRIO DE GESTÃO DE ROTAS', {
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
        const orders = data.route.route_orders;
        const total = orders.length;
        const delivered = orders.filter(o => o.status === 'delivered').length;
        const returned = orders.filter(o => o.status === 'returned').length;
        const pending = orders.filter(o => o.status === 'pending').length;
        const rate = total > 0 ? ((delivered / total) * 100).toFixed(1) + '%' : '0%';

        const kwiWidth = (width - margin * 2) / 5;
        const kpiY = y;

        // Draw KPIs
        const drawKPI = (label: string, value: string | number, color: any, idx: number) => {
            const xBase = margin + (idx * kwiWidth);

            // Vertical separator (except last)
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

        drawKPI('TOTAL PEDIDOS', total, rgb(0.2, 0.2, 0.2), 0);
        drawKPI('ENTREGUES', delivered, rgb(0.1, 0.7, 0.3), 1);
        drawKPI('RETORNADOS', returned, rgb(0.9, 0.2, 0.2), 2);
        drawKPI('PENDENTES', pending, rgb(0.6, 0.6, 0.6), 3);
        drawKPI('TAXA ENTREGA', rate, rgb(0.3, 0.5, 0.9), 4);

        y -= 50;

        // --- LOGISTICS DETAILS ---

        // Section Header
        const drawSectionHeader = (title: string, iconChar: string = '') => {
            // Gray background strip
            page.drawRectangle({
                x: margin,
                y: y,
                width: width - margin * 2,
                height: 20,
                color: rgb(0.96, 0.97, 0.98),
            });
            // Icon circle (fake) if needed or just text
            // Drawing Title
            page.drawText(title.toUpperCase(), {
                x: margin + 10,
                y: y + 6,
                size: 9,
                font: fontBold,
                color: rgb(0.3, 0.3, 0.4)
            });
            y -= 15;
        };

        // Details Section
        // Labels
        y -= 10;
        const detailsLabelsY = y;
        const detailsValuesY = y - 15;
        const colW = (width - margin * 2) / 4;

        const drawDetail = (label: string, value: string, colIdx: number, rowIdx: number = 0) => {
            const x = margin + (colIdx * colW);
            const yOffset = rowIdx * 35; // 35px spacing between rows
            page.drawText(label, { x, y: detailsLabelsY - yOffset, size: 7, font: fontBold, color: rgb(0.6, 0.6, 0.6) });
            page.drawText(value, { x, y: detailsValuesY - yOffset, size: 9, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
        };

        drawDetail('ID ROMANEIO', (data.route as any).route_code || data.route.id.slice(0, 8), 0);
        drawDetail('EQUIPE', data.teamName || '-', 1);
        drawDetail('MOTORISTA', data.driverName || '-', 2);
        drawDetail('AJUDANTE', data.helperName || '-', 3);

        // Second row
        drawDetail('VEÍCULO', data.vehicleInfo || '-', 0, 1);
        drawDetail('CONFERENTE', data.supervisorName || '-', 1, 1);

        y -= 35; // Extra spacing for the second row in details section
        y -= 60; // Breathing room before tables section

        // --- TABLE GENERATION HELPER ---

        const drawOrdersTable = (
            title: string,
            items: any[],
            cols: { label: string, widthPct: number, align?: 'left' | 'right' | 'center' }[],
            badgeColor: any,
            textColor: any
        ) => {
            // Header with badge
            page.drawRectangle({
                x: margin,
                y: y,
                width: width - margin * 2,
                height: 24,
                color: rgb(1, 1, 1) // white background
            });

            // Icon/Bullet
            const circleR = 8;
            page.drawCircle({
                x: margin + 12,
                y: y + 12,
                size: circleR,
                color: badgeColor,
                opacity: 0.1
            });
            // Just a colored dot logic or similar visual
            // Drawing title
            page.drawText(title, {
                x: margin + 28,
                y: y + 9,
                size: 12,
                font: fontBold,
                color: rgb(0.2, 0.2, 0.3)
            });

            // Count Badge
            const countText = `${items.length} ITENS`;
            const countW = fontBold.widthOfTextAtSize(countText, 8);
            const badgeW = countW + 16;
            page.drawRectangle({
                x: width - margin - badgeW,
                y: y + 6,
                width: badgeW,
                height: 14,
                color: rgb(0.95, 0.95, 0.95),
                // rounded corners not supported easily, just rect
            });
            drawCenteredText(countText, width - margin - badgeW, y + 10, badgeW, fontBold, 8, rgb(0.5, 0.5, 0.5));

            y -= 20;

            // Table Header
            page.drawRectangle({
                x: margin,
                y: y - 10,
                width: width - margin * 2,
                height: 20,
                color: rgb(0.98, 0.98, 0.98)
            });

            const availableW = width - margin * 2;
            let curX = margin + 10; // padding left

            const colWidths = cols.map(c => availableW * (c.widthPct / 100));

            cols.forEach((c, i) => {
                page.drawText(c.label.toUpperCase(), {
                    x: curX,
                    y: y - 3,
                    size: 7,
                    font: fontBold,
                    color: rgb(0.6, 0.6, 0.6)
                });
                curX += colWidths[i];
            });

            y -= 12;

            // Rows
            items.forEach((item, idx) => {
                if (y < margin + 40) {
                    page = pdfDoc.addPage([595.28, 841.89]);
                    y = height - margin;
                    // Re-draw partial header if needed, but for simplicity just continue
                }

                // Row background (zebra optional, or lines)
                page.drawLine({
                    start: { x: margin, y: y - 10 },
                    end: { x: width - margin, y: y - 10 },
                    thickness: 0.5,
                    color: rgb(0.95, 0.95, 0.95)
                });

                let rowX = margin + 10;
                cols.forEach((c, i) => {
                    let text = String(item[i] || '');

                    if (c.label === 'CONF.') {
                        page.drawRectangle({
                            x: rowX + (colWidths[i] - 12) / 2,
                            y: y - 8,
                            width: 12,
                            height: 12,
                            borderColor: rgb(0.7, 0.7, 0.7),
                            borderWidth: 1,
                            color: rgb(1, 1, 1),
                        });
                    } else {
                        // Handle custom rendering per column could go here
                        // For now, just truncate if too long?
                        const cw = colWidths[i] - 10; // padding
                        let fontSize = 9;
                        if (font.widthOfTextAtSize(text, fontSize) > cw) {
                            // Simple truncate
                            while (text.length > 0 && font.widthOfTextAtSize(text + '...', fontSize) > cw) {
                                text = text.slice(0, -1);
                            }
                            text += '...';
                        }

                        // Special badge rendering for 'Status' column in returned table?
                        // If the column label is 'MOTIVO / STATUS' and text is 'returned', draw badge
                        // We passed formatted text in 'item', so let's check content.
                        const isStatusCol = c.label.includes('STATUS');

                        if (isStatusCol && text) {
                            // Draw badge
                            const bw = fontBold.widthOfTextAtSize(text, 8) + 12;
                            page.drawRectangle({
                                x: rowX - 4,
                                y: y - 8,
                                width: bw,
                                height: 14,
                                color: rgb(1, 0.95, 0.95), // light red bg
                            });
                            page.drawText(text, { x: rowX, y: y - 3, size: 8, font: fontBold, color: rgb(0.8, 0.2, 0.2) });
                        } else {
                            page.drawText(text, { x: rowX, y: y - 3, size: 9, font: font, color: rgb(0.3, 0.3, 0.3) });
                        }
                    }

                    rowX += colWidths[i];
                });

                y -= 25;
            });

            y -= 20; // gap after table
        };

        // --- DELIVERED TABLE ---
        const deliveredOrders = orders.filter(o => o.status === 'delivered').map(o => {
            const addr = o.order.address_json;
            const addrStr = `${addr?.street || ''}${addr?.neighborhood ? `, ${addr.neighborhood}` : ''}${addr?.city ? `, ${addr.city}` : ''}`;
            const timeStr = o.delivered_at ? new Date(o.delivered_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-';
            return [
                `#${o.order.order_id_erp || o.order.id.slice(0, 6)}`,
                o.order.customer_name,
                addrStr,
                timeStr
            ];
        });

        if (deliveredOrders.length > 0) {
            drawOrdersTable(
                'Pedidos Entregues',
                deliveredOrders,
                [
                    { label: 'ID Pedido', widthPct: 15 },
                    { label: 'Cliente', widthPct: 30 },
                    { label: 'Endereço de Entrega', widthPct: 35 },
                    { label: 'Horário', widthPct: 10 },
                    { label: 'CONF.', widthPct: 10 }
                ],
                rgb(0.2, 0.8, 0.4), // green badge
                rgb(0.1, 0.6, 0.2)
            );
        }

        // --- RETURNED TABLE ---
        const returnedOrders = orders.filter(o => o.status === 'returned').map(o => {
            const addr = o.order.address_json;
            const addrStr = `${addr?.street || ''}, ${addr?.neighborhood || ''}`;
            // Try to get reason from relation or string
            let reason = typeof o.return_reason === 'object' ? o.return_reason?.reason : o.return_reason;
            if (!reason) reason = 'Devolvido';
            return [
                `#${o.order.order_id_erp || o.order.id.slice(0, 6)}`,
                o.order.customer_name,
                addrStr,
                reason
            ];
        });

        if (returnedOrders.length > 0) {
            drawOrdersTable(
                'Pedidos Retornados',
                returnedOrders,
                [
                    { label: 'ID Pedido', widthPct: 15 },
                    { label: 'Cliente', widthPct: 30 },
                    { label: 'Endereço', widthPct: 30 },
                    { label: 'Motivo / Status', widthPct: 15 },
                    { label: 'CONF.', widthPct: 10 }
                ],
                rgb(0.9, 0.4, 0.4), // red badge
                rgb(0.8, 0.2, 0.2)
            );
        }

        // Check space for signatures
        if (y < 120) {
            page = pdfDoc.addPage([595.28, 841.89]);
            y = height - margin;
        } else {
            y -= 40;
        }

        // --- FOOTER SIGNATURES ---
        const sigY = y;
        const halfW = (width - margin * 2) / 2;

        // Driver Signature
        page.drawLine({
            start: { x: margin, y: sigY },
            end: { x: margin + halfW - 20, y: sigY },
            thickness: 1,
            color: rgb(0.8, 0.8, 0.8)
        });
        drawCenteredText('ASSINATURA DO MOTORISTA', margin, sigY - 15, halfW - 20, fontBold, 8, rgb(0.3, 0.3, 0.3));
        drawCenteredText('Confirmo a entrega e retorno dos itens acima', margin, sigY - 25, halfW - 20, font, 6, rgb(0.6, 0.6, 0.6));

        // Supervisor Signature
        page.drawLine({
            start: { x: margin + halfW + 20, y: sigY },
            end: { x: width - margin, y: sigY },
            thickness: 1,
            color: rgb(0.8, 0.8, 0.8)
        });
        drawCenteredText('ASSINATURA DO CONFERENTE', margin + halfW + 20, sigY - 15, halfW - 20, fontBold, 8, rgb(0.3, 0.3, 0.3));
        drawCenteredText('Conferência de retorno e prestação de contas', margin + halfW + 20, sigY - 25, halfW - 20, font, 6, rgb(0.6, 0.6, 0.6));

        // Bottom Footer
        page.drawText(`SolidGO - Sistema de Logística | Gerado em ${new Date(data.generatedAt).toLocaleString('pt-BR')}`, {
            x: margin,
            y: 20,
            size: 6,
            font: font,
            color: rgb(0.7, 0.7, 0.7)
        });

        return await pdfDoc.save();
    }
}
