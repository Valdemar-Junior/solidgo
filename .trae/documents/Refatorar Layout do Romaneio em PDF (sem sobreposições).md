# Objetivo
Corrigir o layout do PDF (romaneio) para eliminar sobreposições, garantir quebras de linha, espaçamentos consistentes e abrir em nova aba para impressão, seguindo a estrutura do seu modelo.

## Estratégia de Layout
- **Sistema de layout**: Criar um pequeno “layout engine” com coordenadas absolutas, alturas dinâmicas e quebra de página segura.
- **Constantes globais**: `PAGE_A4`, `MARGIN`, `COLUMN_WIDTHS`, `LINE_HEIGHT`, `SPACING` (título/linha/bloco).
- **Medir texto**: Usar `font.widthOfTextAtSize(text, size)` para calcular largura e implementar `wrapText(text, maxWidth, font, size)` que retorna linhas dentro da coluna.
- **Cabeçalho com logo**: Desenhar logo (ou texto) e posicionar o título abaixo da altura real da imagem; nunca sobrepor.
- **Grade de resumo**: Renderizar “Nº do Romaneio / KM Inicial / KM Final / Ajudante / Transportador / Veículo / Placa” em linhas fixas com espaçamentos; cada célula mede e ajusta Y.
- **Bloco por item**: Para cada pedido da rota, calcular altura do bloco antes de desenhar:
  - Título do item + vendedor (duas colunas)
  - Linha “Nº Romaneio / Telefone / Nº Pedido” (duas colunas)
  - Cliente (bold)
  - Endereço e Observações com wrap
  - Tabela de produtos (cabeçalho + linhas com wrap na coluna Produto)
  - Declaração + duas assinaturas
  - Se `remainingHeight < blockHeight`: inserir nova página e redesenhar cabeçalho + grade de resumo.

## Componentização (funções)
- **drawHeader(page, y, logo)** → retorna novo `y`
- **drawOverview(page, y, route, vehicle)** → retorna novo `y`
- **measureItemBlock(order, fonts, widths)** → calcula altura necessária do bloco
- **drawItemBlock(page, y, seq, order, fonts, widths)** → desenha e retorna novo `y`
- **wrapText(text, maxWidth, font, size)** → divide texto em linhas
- **drawTableRow(cells, widths)** → mede cada célula, usa a maior altura como altura da linha, desenha sem sobrepor

## Quebra de Página e Repetição
- **Page break**: Antes de desenhar cada bloco, comparar `y - blockHeight` com `MARGIN_BOTTOM`; se não couber, `addPage()` e repetir `drawHeader`+`drawOverview`.
- **Cabeçalho em páginas seguintes**: Renderizar título + data (sem logo se preferir) e a grade de resumo novamente.

## Dados e Normalização
- **Dados completos**: Buscar `route_orders` com join em `orders` antes de gerar.
- **Campos**: nº documento (order_id_erp), cliente, telefone, endereço completo, observações, itens (sku/nome/quantidade).
- **Fallbacks**: Se algum campo vier vazio, usar string vazia; nunca desenhar `undefined`.

## Abertura do PDF
- **Navegador**: Usar `openPDFInNewTab(pdfBytes)` (já implementado) ao invés de download.
- **Logo**: `VITE_PDF_LOGO_URL` (ou arquivo em `/public/logo_lojao.png`).

## Validação Visual
- **Cenários**:
  - 1, 5 e 20 pedidos (múltiplas páginas)
  - Endereços e observações longas (wrap)
  - Produtos com nome longo (wrap em coluna Produto)
- **Checklist**:
  - Sem linhas cruzando texto
  - Título nunca sobrepõe logo
  - Todas as seções respeitam `LINE_HEIGHT` e `SPACING`
  - Cabeçalho/overview repetidos em páginas seguintes

## Entregáveis
- Refatoração completa do `deliverySheetGenerator.ts` com layout seguro.
- Helpers (`wrapText`, `measureItemBlock`, `drawItemBlock`).
- Configuração de logo.
- Testes visuais com amostras.

## Plano de Execução
1. Introduzir constantes de layout e helpers de medição/wrap.
2. Refatorar cabeçalho: posicionamento relativo à altura da logo.
3. Refatorar overview em linhas fixas e espaçamento controlado.
4. Implementar `measureItemBlock` e `drawItemBlock` com wrap e tabela.
5. Adicionar quebra de página segura e repetição do cabeçalho.
6. Validar com casos de texto longo e muitos itens; ajustar margens.
7. Integrar `openPDFInNewTab` e configuração da logo.

## Tempo e Critérios de Aceite
- **Tempo**: 1 iteração curta (refatoração + validação), seguida de ajustes finos.
- **Aceite**: PDF sem sobreposição, todas as infos legíveis, múltiplas páginas com cabeçalho repetido e pronto para impressão.
