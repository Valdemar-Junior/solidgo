import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { Route, RouteOrder, Order } from '../../types/database';
import { sanitizePdfText, wrapTextSafe } from './pdfTextSanitizer';

export interface SeparationSheetData {
    route: Route;
    routeOrders: RouteOrder[];
    orders: Order[];
    generatedAt: string;
}

export class SeparationSheetGenerator {
    static async generate(data: SeparationSheetData): Promise<Uint8Array> {
        const pdfDoc = await PDFDocument.create();
        let page = pdfDoc.addPage([595.28, 841.89]); // A4 Portrait
        const { width, height } = page.getSize();

        // Configurações de layout
        const margin = 20;
        const fontSizeHeader = 10;
        const fontSizeContent = 8;
        const lineHeight = 10;

        // Fontes
        const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        // Estado da página
        let y = height - margin;

        // Função auxiliar para desenhar texto
        const drawText = (text: string, x: number, y: number, font: any, size: number, color = rgb(0, 0, 0)) => {
            page.drawText(text, { x, y, font, size, color });
        };

        // Função de quebra de linha com sanitização para evitar erros de caracteres especiais
        const wrapText = (text: string, maxWidth: number, font: any, size: number): string[] => {
            return wrapTextSafe(text, maxWidth, font, size);
        };

        // 1. Cabeçalho do Romaneio
        const drawHeader = () => {
            y = height - margin;
            drawText('ROMANEIO DE SEPARAÇÃO / CONFERÊNCIA', margin, y, fontBold, 12);
            y -= 14;

            const routeName = (data.route.name || 'Rota Sem Nome');
            const routeId = ((data.route as any).route_code || data.route.id.slice(0, 8));
            const dateStr = new Date(data.generatedAt).toLocaleString('pt-BR');

            drawText(`Rota: ${routeName}`, margin, y, fontBold, 10);
            drawText(`ID: ${routeId} | Data: ${dateStr}`, margin + 300, y, fontRegular, 8);

            y -= 10;
            page.drawLine({
                start: { x: margin, y },
                end: { x: width - margin, y },
                thickness: 1,
                color: rgb(0, 0, 0),
            });
            y -= 10;
        };

        drawHeader();

        // Processar pedidos
        const processedOrderIds = new Set<string>();

        for (const ro of data.routeOrders) {
            if (processedOrderIds.has(ro.order_id)) continue;
            processedOrderIds.add(ro.order_id);

            const order = data.orders.find(o => o.id === ro.order_id);
            if (!order) continue;

            const items = order.items_json || [];

            // Recuperar Observações
            const obsPublic = (order as any).observacoes_publicas || (order.raw_json as any)?.observacoes_publicas || (order.raw_json as any)?.observacoes || '';
            const obsInternal = (order as any).observacoes_internas || (order.raw_json as any)?.observacoes_internas || '';

            // --- PRÉ-CÁLCULO DE ALTURA REAL ---

            // 1. Altura Obs Publica
            let obsPublicLines: string[] = [];
            let hObsPublic = 0;
            if (obsPublic) {
                obsPublicLines = wrapText(obsPublic, width - (margin * 2) - 60, fontRegular, fontSizeContent);
                hObsPublic = (obsPublicLines.length * lineHeight) + 4;
            }

            // 2. Altura Obs Interna
            let obsInternalLines: string[] = [];
            let hObsInternal = 0;
            if (obsInternal) {
                obsInternalLines = wrapText(obsInternal, width - (margin * 2) - 80, fontRegular, fontSizeContent);
                hObsInternal = (obsInternalLines.length * lineHeight) + 4;
            }

            // 3. Altura Itens
            let hItemsTotal = 0;
            const colX = {
                qtd: margin,
                vols: margin + 25,
                local: margin + 50, // 70
                prod: margin + 140, // 160 (Increased from 110 to give 90px for Local)
                marca: width - margin - 80,
                check: width - margin - 15
            };
            const maxProdWidth = colX.marca - colX.prod - 5;

            const itemsWithLines = items.map(item => {
                const sku = item.sku || '';
                const name = item.name || 'Item sem nome';
                const fullName = sku ? `[${sku}] ${name}` : name;

                // Location wrapping
                const location = (item as any).location || (item as any).local_estocagem || '-';
                const maxLocalWidth = colX.prod - colX.local - 5;
                const locLines = wrapText(String(location), maxLocalWidth, fontRegular, fontSizeContent);

                const lines = wrapText(fullName, maxProdWidth, fontRegular, fontSizeContent);

                // Height based on max lines (Product OR Location)
                const maxLines = Math.max(lines.length, locLines.length);
                const h = Math.max(maxLines * lineHeight, 12) + 4; // +4 gap

                return { item, lines, locLines, height: h };
            });
            hItemsTotal = itemsWithLines.reduce((acc, curr) => acc + curr.height, 0);

            // Altura Total do Bloco do Pedido
            // Header (30) + Header Tabela (12) + Itens + Obs + Gap Final (16)
            const totalOrderBlockHeight = 30 + 12 + hItemsTotal + hObsPublic + hObsInternal + 16;

            const pageHeightAvailable = height - (margin * 2) - 40;

            if (y - totalOrderBlockHeight < margin) {
                if (totalOrderBlockHeight < pageHeightAvailable) {
                    // Cabe inteiro na próxima página, salta.
                    page = pdfDoc.addPage([595.28, 841.89]);
                    drawHeader();
                } else {
                    // É gigante, mas se já estamos na metade pra baixo, pula pra próxima pra começar limpo
                    if (y < height / 2) {
                        page = pdfDoc.addPage([595.28, 841.89]);
                        drawHeader();
                    }
                }
            }

            // --- DESENHO ---

            // Cabeçalho do Pedido
            const orderId = order.order_id_erp || 'N/A';
            const customerName = (order.customer_name || 'Consumidor').slice(0, 30);

            const addr = order.address_json;
            let addressStr = '';
            if (addr) {
                const parts = [];
                if (addr.street) parts.push(addr.street);
                if (addr.neighborhood) parts.push(addr.neighborhood);
                if (addr.city) parts.push(addr.city);
                addressStr = parts.join(', ').slice(0, 80);
            }

            page.drawRectangle({
                x: margin,
                y: y - 10,
                width: width - (margin * 2),
                height: 12,
                color: rgb(0.9, 0.9, 0.9),
            });

            drawText(`Pedido: ${orderId}`, margin + 2, y - 8, fontBold, 9);
            drawText(`Cliente: ${customerName}`, margin + 100, y - 8, fontBold, 9);
            drawText(addressStr, margin + 280, y - 8, fontRegular, 8);

            y -= 20;

            // Cabeçalho da Tabela
            drawText('Qtd', colX.qtd, y, fontBold, 7);
            drawText('Vol', colX.vols, y, fontBold, 7);
            drawText('Local', colX.local, y, fontBold, 7); // Header
            drawText('Produto / SKU', colX.prod, y, fontBold, 7);
            drawText('Marca', colX.marca, y, fontBold, 7);
            drawText('Conf', colX.check - 5, y, fontBold, 7);

            y -= 2;
            page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5 });
            y -= 10;

            // Itens
            for (const { item, lines, locLines, height: itemH } of itemsWithLines) {
                if (y - itemH < margin) {
                    page = pdfDoc.addPage([595.28, 841.89]);
                    drawHeader();
                    drawText(`(Continuação Pedido: ${orderId})`, margin, y, fontRegular, 8);
                    y -= 12;
                }

                const qtd = (item as any).purchased_quantity ?? item.quantity ?? 1;
                const vols = (item.volumes_per_unit || 1) * qtd;
                const brand = (item as any).brand || (order as any).brand || '-';

                // Draw Qty/Vol
                drawText(String(qtd), colX.qtd + 5, y, fontRegular, fontSizeContent);
                drawText(String(vols), colX.vols + 5, y, fontRegular, fontSizeContent);

                // Draw Location (Wrapped)
                if (locLines) {
                    locLines.forEach((line: string, i: number) => {
                        drawText(line, colX.local, y - (i * lineHeight), fontRegular, fontSizeContent);
                    });
                }

                // Draw Product (Wrapped)
                lines.forEach((line, i) => {
                    drawText(line, colX.prod, y - (i * lineHeight), fontRegular, fontSizeContent);
                });

                drawText(String(brand).slice(0, 12), colX.marca, y, fontRegular, fontSizeContent);

                page.drawRectangle({
                    x: colX.check,
                    y: y - 1,
                    width: 8,
                    height: 8,
                    borderColor: rgb(0, 0, 0),
                    borderWidth: 1,
                });

                y -= itemH;
            }

            // Observações
            if (hObsPublic > 0) {
                if (y - hObsPublic < margin) {
                    page = pdfDoc.addPage([595.28, 841.89]);
                    drawHeader();
                    drawText(`(Continuação Pedido: ${orderId})`, margin, y, fontRegular, 8);
                    y -= 12;
                }
                const label = "Observação: ";
                const labelWidth = fontBold.widthOfTextAtSize(label, fontSizeContent);
                drawText(label, margin, y, fontBold, fontSizeContent);

                obsPublicLines.forEach((line, i) => {
                    drawText(line, margin + labelWidth, y - (i * lineHeight), fontRegular, fontSizeContent);
                });
                y -= hObsPublic;
            }

            if (hObsInternal > 0) {
                if (y - hObsInternal < margin) {
                    page = pdfDoc.addPage([595.28, 841.89]);
                    drawHeader();
                    drawText(`(Continuação Pedido: ${orderId})`, margin, y, fontRegular, 8);
                    y -= 12;
                }
                const label = "Obs. Interna: ";
                const labelWidth = fontBold.widthOfTextAtSize(label, fontSizeContent);
                drawText(label, margin, y, fontBold, fontSizeContent);

                obsInternalLines.forEach((line, i) => {
                    drawText(line, margin + labelWidth, y - (i * lineHeight), fontRegular, fontSizeContent, rgb(0.3, 0.3, 0.3));
                });
                y -= hObsInternal;
            }

            y -= 6;
            page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
            y -= 10;
        }

        // Rodapé
        const pages = pdfDoc.getPages();
        const totalPages = pages.length;
        for (let i = 0; i < totalPages; i++) {
            const p = pages[i];
            const { width } = p.getSize();
            p.drawText(`Página ${i + 1} de ${totalPages}`, {
                x: width - 80,
                y: 10,
                size: 8,
                font: fontRegular,
                color: rgb(0, 0, 0),
            });
        }

        return await pdfDoc.save();
    }
}
