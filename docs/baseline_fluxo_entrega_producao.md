# Baseline de Producao: Fluxo Atual de Entrega (SOLIDGO)

## Objetivo
Registrar o estado atual do fluxo de entrega antes da implantacao da comprovacao digital, para reduzir risco de regressao.

Data de baseline: 2026-02-08

## Fontes Revisadas
1. `src/components/DeliveryMarking.tsx`
2. `src/hooks/useDeliveryPhotos.tsx`
3. `src/services/deliveryPhotoService.ts`
4. `src/utils/offline/backgroundSync.ts`
5. `src/pages/admin/OrderLookup.tsx`

## Fluxo Atual: Marcar como Entregue
1. O motorista aciona o botao `Entregue` em `DeliveryMarking`.
2. O fluxo chama `capturePhotos('delivered', ...)`.
3. Quando a flag de app `require_delivery_photos` esta ativa, o modal exige no minimo 2 fotos.
4. As fotos sao classificadas como:
   - foto 1: `product`
   - foto 2: `receipt`
5. Online:
   - atualiza `route_orders.status = delivered` e `delivered_at`
   - atualiza `orders.status = delivered`
   - limpa flags de retorno (`return_flag`, `last_return_reason`, `last_return_notes`)
6. Offline:
   - enfileira `delivery_confirmation` em `SyncQueue`
   - atualiza cache local de `route_orders`

Referencias:
1. `src/components/DeliveryMarking.tsx:234`
2. `src/components/DeliveryMarking.tsx:252`
3. `src/components/DeliveryMarking.tsx:264`
4. `src/components/DeliveryMarking.tsx:359`
5. `src/hooks/useDeliveryPhotos.tsx:44`
6. `src/hooks/useDeliveryPhotos.tsx:111`

## Fluxo Atual: Marcar como Retornado
1. Motivo de retorno e obrigatorio.
2. Captura de foto e opcional no retorno.
3. Online:
   - atualiza `route_orders` para `returned`
   - atualiza `orders.return_flag = true` e notas de retorno
4. Offline:
   - enfileira `delivery_confirmation` com `action = returned`
   - grava cache local para sincronizar depois

Referencias:
1. `src/components/DeliveryMarking.tsx:375`
2. `src/components/DeliveryMarking.tsx:412`
3. `src/components/DeliveryMarking.tsx:427`
4. `src/components/DeliveryMarking.tsx:448`

## Fluxo Atual: Desfazer Entrega/Retorno
1. Ao desfazer, remove fotos do bucket `delivery-photos` e da tabela `delivery_photos`.
2. Reverte `route_orders` para `pending`.
3. Reverte `orders.status` para `assigned`.

Referencias:
1. `src/components/DeliveryMarking.tsx:507`
2. `src/components/DeliveryMarking.tsx:596`

## Fluxo Atual: Finalizar Rota
1. Exige zero pedidos pendentes.
2. Marca rota como `completed`.
3. Libera pedidos retornados para `orders.status = pending`.
4. Garante pedidos entregues como `orders.status = delivered`.

Referencias:
1. `src/components/DeliveryMarking.tsx:686`
2. `src/components/DeliveryMarking.tsx:705`
3. `src/components/DeliveryMarking.tsx:723`
4. `src/components/DeliveryMarking.tsx:735`

## Fluxo Offline Atual (Sincronizacao)
1. `BackgroundSync` processa itens pendentes de `SyncQueue`.
2. `delivery_confirmation` atualiza `route_orders` e `orders`.
3. A sincronizacao registra acao em log tecnico (`logSyncAction`).

Referencias:
1. `src/utils/offline/backgroundSync.ts:138`
2. `src/utils/offline/backgroundSync.ts:426`

## Consultas Administrativas Atuais
1. A tela de consulta de pedidos busca em `orders` e historico em `route_orders`.
2. Exibe motorista, rota, data de entrega e visualizador de fotos por `route_order_id`.

Referencias:
1. `src/pages/admin/OrderLookup.tsx:165`
2. `src/pages/admin/OrderLookup.tsx:566`

## Tabelas Hoje Envolvidas no Fluxo
1. `orders`
2. `route_orders`
3. `delivery_photos`
4. `audit_logs`
5. `assembly_products`
6. `routes`

## Regras Confirmadas Antes da Fase Digital
1. Fluxo atual funciona em producao e nao deve ser interrompido.
2. Ja existe regra operacional de no minimo 2 fotos quando configuracao de foto obrigatoria esta ativa.
3. Estrategia de implantacao deve ser aditiva (novo armazenamento paralelo).

