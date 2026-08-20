# Como o SolidGo funciona — Manual de referência (o sistema por dentro)

> Documento vivo. Consolida o estudo profundo de **importação → roteirização → entrega (PWA do motorista) → montagem**, cruzado com a camada de banco (SQL), a integração n8n e os fluxos operacionais reais da loja.
>
> **Escopo deste manual:** entender o sistema. Nada aqui altera código. As correções conhecidas ficam catalogadas no diagnóstico (`/Users/junior/.claude/plans/objetivo-da-implementa-o-ajustamos-quiet-crown.md`) e nas memórias do projeto.
>
> Última consolidação: 2026-07-09.

---

## 0. O modelo mental em uma página

O SolidGo é um SaaS de **gestão de entrega e montagem de móveis** (Lojão dos Móveis). Ele importa pedidos de venda do ERP **Solidus Smart**, organiza rotas, o motorista entrega (PWA), e quando o móvel é entregue gera-se a **montagem**.

Existem **duas camadas coexistindo** no sistema:

| Camada | O que é | Tabelas | Status hoje |
|---|---|---|---|
| **LEGADO (order-level)** | Trata o pedido como um todo. É o que **roda em produção**. | `orders` + `items_json` (JSONB), `route_orders`, devolução gravada direto em `orders` | Fonte da verdade fiscal/operacional |
| **NOVO (item-level / "sombra")** | Controla saldo **por produto** (comprado / devolvido / entregável). Aditivo, derivado do legado. | `order_items`, view `order_item_shadow_balances`, `order_returns` / `order_return_items`, `route_order_items`, `assembly_products` | Em **modo sombra** — calcula e exibe, mas não governa o fiscal |

**Por que a camada nova existe:** no order-level o motorista era obrigado a marcar **tudo entregue OU tudo devolvido**. Exemplo real: cliente compra um roupeiro + uma cama king; a cama não coube no quarto. Precisa entregar o roupeiro e devolver só a cama → **entrega parcial por item**.

**Regra de ouro do projeto:** a camada nova **soma** ao legado, nunca substitui. Ao ligar em produção, tudo que já existe deve continuar aparecendo — nenhuma informação do banco de produção pode ser perdida.

### As feature flags que ligam/desligam a camada nova
`app_settings.item_fulfillment_control` (helpers em [src/utils/itemFulfillment.ts](../src/utils/itemFulfillment.ts)):
- `mode`: `'off' | 'shadow' | 'pilot' | 'enabled'` (default `'shadow'`).
- `shouldCreateRouteOrderItemSnapshots` = `mode !== 'off' && item_route_allocation_enabled` → decide se cria o snapshot por item da rota.
- `shouldEnforceRouteOrderItemSnapshots` = `mode === 'enabled' && item_route_allocation_enabled` → decide se **falha a operação** quando o snapshot não gera (senão degrada silencioso).
- No banco de teste: `mode: shadow`, `enabled: false`, mas `partial_returns_enabled` / `item_route_allocation_enabled` / `item_delivery_enabled` **ligados** → na prática o fluxo itemizado está ativo no teste.

> ⚠️ **Atenção:** a geração/poda de **montagem** no banco reage à view `order_item_shadow_balances` **independentemente** dessas flags. Desligar `partial_returns_enabled` na UI **não** desliga a reconciliação de montagem no banco.

---

## 1. IMPORTAÇÃO — de onde tudo começa

Tela: [src/pages/admin/OrdersImport.tsx](../src/pages/admin/OrdersImport.tsx).

### 1.1 Fluxo
1. Busca pedidos via **webhook** (ERP → payload de pedidos de venda).
2. **Deduplicação em 3 camadas** para nunca reimportar um pedido já existente:
   - por `order_id_erp` (chave do ERP);
   - checagem contra os pedidos já no banco;
   - update em vez de insert quando o pedido já existe.
3. Insere/atualiza `orders` (com `items_json` cru).
4. Chama a RPC **`sync_order_items_shadow(order_id)`** (`syncOrderItemsShadowForImport`) que estrutura o `items_json` em linhas de `order_items`.

### 1.2 Detalhes que importam para manutenção
- **`order_id_erp` tem fallback com `Math.random()`** quando o ERP não manda o id. Risco: dois pedidos sem id do ERP podem, teoricamente, escapar da dedup. Ponto sensível.
- **Regra escondida do `*montagem*`:** se as observações do pedido contêm a palavra-chave, o sistema força `has_assembly` no pedido **inteiro** (não por item).
- **`source_line_key = md5(sku|local|kit)`:** a estruturação agrega linhas com a mesma chave. Dois itens distintos que colidam nessa chave viram **uma** linha shadow. Sem esses campos, cai em `line:<ordinality>` (sensível à ordem do JSON) — pode distorcer o cálculo total-vs-parcial.
- **Sem trigger de re-sync:** `sync_order_items_shadow` só roda na **importação** e no **backfill**. Se alguém editar `items_json` de um pedido depois (item/quantidade), `order_items` **não** é recalculado sozinho → `purchased_quantity` velho contamina toda a cadeia (saldo → snapshot → montagem). **(brecha B5)**
- **Falha do shadow sync vira só toast:** o pedido fica inserido, mas se a estruturação falhar ele some da roteirização (que filtra `shadow_deliverable > 0`) — falha **silenciosa** de visibilidade. **(brecha B14)**

---

## 2. A CAMADA POR ITEM — a espinha dorsal da feature

Ordem da origem até a montagem:

1. **`orders` + `items_json`** — pedido bruto do ERP (legado; ainda é fonte de muitos caminhos).
2. **`order_items`** — estruturação por item, populada por `sync_order_items_shadow`.
3. **View `order_item_shadow_balances`** — o **coração** da feature. Por item calcula:
   - `purchased_quantity`;
   - `returned_quantity` = soma de `order_return_items` de devoluções com `processing_status = 'processed'`;
   - `shadow_deliverable_quantity = GREATEST(purchased − returned, 0)`;
   - `has_over_return` quando devolvido > comprado.
   - **É a fonte única de verdade operacional** do saldo entregável. (baseline `:5685`)
4. **`order_returns` + `order_return_items`** — evento de devolução e seus itens. Endurecimentos: over-return vira `divergent` + issue auditável; item com coleta criada fica imutável; um evento ↔ uma coleta.
5. **`route_order_items`** — snapshot **congelado por rota** (o saldo no momento em que a rota foi criada). Criado pela RPC `sync_route_order_item_snapshots_bulk`.
6. **`assembly_products` / `assembly_routes`** — montagem, gerada só para item entregue, com montagem, e não devolvido.

**Função central de reconciliação fiscal:** `sync_order_return_operational_state(order_id)` recalcula o estado do pedido (total/parcial, aguardando coleta / coleta gerada / bloqueado) e dispara a sincronização de montagem.

---

## 3. ROTEIRIZAÇÃO — montando a rota

Tela: [src/pages/admin/RouteCreation.tsx](../src/pages/admin/RouteCreation.tsx) (~7.9k linhas).

### 3.1 A fila de pedidos (o que aparece para rotear)
`loadData()` (`:2947`):
1. Busca `orders` com `status in ('pending','returned','assigned')`.
2. Monta `lockedOrderIds` — pedidos já em rota ativa não voltam para a fila.
3. Carrega saldos da view `order_item_shadow_balances` (indexado por `order_id`).
4. **Filtro de saldo** (`:3138`):
   - **sem balances** → legado: mostra se `!return_flag`;
   - **com balances** → mostra só se **algum** item tem `source_present && shadow_deliverable_quantity > 0`.
   - Consequência boa: pedido **totalmente devolvido** some da fila mesmo sem depender do `return_flag` legado.

### 3.2 Criando a rota + o snapshot por item
`createRoute()` (`:4163`):
1. Cria `routes` (`status: 'pending'`).
2. Insere `route_orders` (`status: 'pending'`, sequência).
3. **`syncRouteOrderItemSnapshots`** — se `shouldCreateRouteOrderItemSnapshots`, chama a RPC `sync_route_order_item_snapshots_bulk`.
4. `orders.status = 'assigned'` (some da fila).

A RPC `sync_route_order_item_snapshots_bulk` (baseline `:4128`, SECURITY DEFINER):
- Exige `item_fulfillment_can_manage()` (admin/service_role) senão exceção.
- Para cada route_order: **DELETE + reINSERT** dos `route_order_items` a partir da view sombra.
- Mapeia: `allocated_quantity = deliverable_quantity_snapshot = shadow_deliverable_quantity`; `returned_quantity_snapshot = returned_quantity`. Status inicial: `returned` (dev=0), `partial` (dev>0 com devolução) ou `pending`.

### 3.3 Romaneios (separação e entrega)
- Itens imprimíveis vêm do snapshot, **filtrando `allocated_quantity > 0`**; sem snapshot, cai no fallback `items_json`.
- Se o pedido não tem nenhum item alocado (tudo devolvido no ERP), ele é **descartado** do romaneio; a impressão individual instrui a **excluir o pedido da rota**.

---

## 4. ENTREGA — o PWA do motorista

Componente: [src/components/DeliveryMarking.tsx](../src/components/DeliveryMarking.tsx) (~1.9k linhas). Offline em [src/utils/offline/backgroundSync.ts](../src/utils/offline/backgroundSync.ts).

### 4.1 O que o motorista vê
- Carrega `route_orders` + `route_order_items` (com cache offline via `OfflineStorage`).
- **Regra de visibilidade do item:** `allocated_quantity > 0 || deliverable_quantity_snapshot > 0` (`:101`).
- Item **bloqueado** (devolvido no ERP antes da rota): `returned_snapshot > 0 && deliverable <= 0` → aparece com aviso vermelho, não pode ser entregue.
- Se não há itens estruturados → tela em **"Modo legado"**.

### 4.2 Marcar ENTREGUE — `markAsDelivered()` (`:598`)
1. **Guard anti-concorrência:** relê `route_order_items` do servidor e compara "assinaturas"; se a devolução mudou no meio, **aborta pedindo reconferência**.
2. Filtra itens entregáveis; comprovante (recebedor + GPS + fotos obrigatórias).
3. **Online:** por item `UPDATE route_order_items status='delivered'`; depois `route_orders='delivered'`, `orders='delivered'`, e RPC `reconcile_order_return_state`.
4. **Montagem NÃO nasce aqui** — só na finalização da rota.
5. **Offline:** enfileira `delivery_confirmation`.

> Itens bloqueados permanecem intactos; só os entregáveis viram `delivered` (entrega parcial real).

### 4.3 Marcar RETORNADO — `markAsReturned()` (`:809`)
- Exige motivo. Marca **todos** os `route_order_items` como `returned`, `route_orders='returned'`, `orders.return_flag=true`.
- **Assimetria PROPOSITAL (não é bug — confirmado pelo dono):** o retorno **NÃO** chama `reconcile` nem devolve `orders.status='pending'` na hora — o pedido fica **travado** (`assigned` + `return_flag`) e só é liberado pra fila na **finalização** da rota.
  - **Por quê:** o motorista pode marcar retornado **por engano**. Se o pedido voltasse pra fila na hora, o roteirizador poderia jogá-lo em **outra rota** imediatamente; aí o motorista desfaz o erro e marca como entregue, mas o pedido já saiu duplicado noutra rota dias depois → **entrega dupla**. A finalização é o "ponto de não-retorno": segura o pedido até a decisão estar estável (o motorista já não pode mais desfazer daquela rota).
  - Trade-off aceito: se a rota **nunca finalizar direito**, o pedido fica preso em `assigned` + `return_flag`. É o preço da proteção contra entrega dupla — não corrigir sem entender esse motivo.

### 4.4 Finalizar rota — `handleFinalizeRoute()` (`:1228`)
Ordem online:
1. `forceSync` (drena fila offline); se sobrar item da rota pendente, **aborta**.
2. Relê `route_orders`; se algum `pending`, aborta.
3. Detecta itens **recém-bloqueados** (devolução no ERP durante a rota) e pede confirmação.
4. `orders='delivered'` (entregues), `routes='completed'`.
5. Fecha MDF-e (`auto-close-route-mdfe`).
6. Retornados → `orders='pending', return_flag=true`.
7. **Loop `reconcile_order_return_state`** para todos os pedidos.
8. **`syncAssemblyProductsForRoute`** — gera a montagem.

> O passo 4 (`routes='completed'`) **também** dispara o trigger `trg_routes_reconcile_returns_after_completion`, que reconcilia de novo. Ou seja, a reconciliação roda **duas vezes** (trigger + loop JS). Idempotente, mas redundante e com risco de corrida. **(brecha B8)**

### 4.5 Offline (`backgroundSync.ts`)
- Singleton, timer 30s + gatilho no online, FIFO por timestamp.
- Tipos: `delivery_confirmation`, `assembly_confirmation`, `assembly_return`, `return_revert`, `delivery_revert`, `assembly_undo`, `route_completion`, `assembly_route_completion`.
- `syncRouteCompletion` espelha a finalização online (completa rota, fecha MDF-e, reconcilia, gera montagem).
- **Sem limite de tentativas:** item que falha é reprocessado a cada ciclo indefinidamente.

---

## 5. MONTAGEM — quando o móvel entregue vira serviço

Painel: [src/pages/admin/AssemblyManagement.tsx](../src/pages/admin/AssemblyManagement.tsx). Montador: [src/components/AssemblyMarking.tsx](../src/components/AssemblyMarking.tsx). Wrappers: [src/utils/assembly/syncAssemblyProducts.ts](../src/utils/assembly/syncAssemblyProducts.ts).

### 5.1 Modelo de dados
- **`assembly_products`** — 1 linha por **unidade** física a montar (quantidade N = N linhas; não há coluna de quantidade). Campos: `status` (`pending|assigned|in_progress|completed|cancelled`), `assembly_route_id`, `was_returned`, `returned_at`, `return_reason`, `import_source` (`avulsa|lote`), `mount_priority`.
- **`assembly_routes`** — rota de montagem (`assembler_id`, `vehicle_id`, `route_code`, `status`).

### 5.2 Onde a montagem NASCE — `sync_missing_assembly_products_for_order` (baseline `:3382`)
Condições:
1. Pedido `delivered`.
2. A **última rota não-COLETA** do pedido precisa estar `completed`.
3. Alvo por SKU = soma de `shadow_deliverable_quantity` dos itens que exigem montagem (`order_item_payload_requires_assembly(source_payload)`), com `HAVING target > 0`. **É aqui que a devolução por item entra:** item totalmente devolvido tem saldo 0 → não gera montagem.
4. Inserção **idempotente**: insere só `missing = target − existentes`, como `pending`.

Gatilhos que chamam a geração:

| Evento | Entrada | RPC | Exige rota completed? |
|---|---|---|---|
| Entrega finalizada | `DeliveryMarking:1392` | `sync_missing_assembly_products_for_route` → `_for_order` | Sim |
| Retirada (pickup) | `RouteCreation:3751` | `sync_missing_assembly_products_for_pickup` | **Não** (balcão) |
| Reparo manual | `AuditDashboard` | `sync_missing_assembly_products_for_order` | Sim |
| Devolução processada | trigger `order_returns` | `sync_order_return_operational_state` → `sync_assembly_products_with_returns` | poda + repõe |
| Import avulsa | `AssemblyManagement:1878` | INSERT direto (sem RPC) | Não |
| Retorno de montagem (clone) | `AssemblyMarking` | INSERT direto | na finalização da rota de montagem |

### 5.3 O montador em campo — `AssemblyMarking.tsx`
- **Montado:** `status='completed'` + fotos.
- **Retornado:** `status='cancelled'` + motivo. **`was_returned` NÃO é setado no item devolvido** — só no **clone** de remontagem (§5.4).
- **Desfazer:** apaga o clone fantasma mais recente (`limit 1`) e reverte para `pending`.

### 5.4 O CLONE de remontagem
Na **finalização** da rota de montagem, para cada item `cancelled` cria-se um **clone** `pending` com `was_returned=true` (a remontagem). Reconciliação por contagem (`missing = returnedCount − clones existentes`). Há dois caminhos que criam clone (JS online + fila offline) com o mesmo algoritmo — risco de duplicação sob corrida.

### 5.5 Como a montagem RESPEITA devolução — `sync_assembly_products_with_returns` (baseline `:3278`)
- Compara o alvo (saldo entregável por SKU) com quantos `assembly_products` existem; se sobra, remove o excedente (prioriza sem rota, depois `pending`, depois mais recentes).
- **ATUALIZADO (2026-07-09, migration `20260709160000`):** o `DELETE` físico virou **carimbo** (soft-delete) — o excedente vira `status='cancelled'` + `was_returned=true` + `returned_at` + `return_reason='Devolução do ERP'`, mantendo o registro. A contagem passou a considerar só montagens **ativas** (não-canceladas) nos dois lugares (reconciliador e repositor), garantindo idempotência. Verificado no teste.
- Depois repõe via `sync_missing_assembly_products_for_order` se o saldo subiu (devolução revertida).
- Disparada pelos triggers em `order_returns`/`order_return_items` → `sync_order_return_operational_state`.

---

## 6. DEVOLUÇÃO — como entra no sistema (o ponto mais delicado)

### 6.1 Em produção: só order-level, via n8n
A ponte ERP → SolidGo para devolução é uma **automação n8n** (fora do repositório):
1. Cron consulta o ERP Solidus e retorna pedidos com nota de devolução (inclui `produtos` = itens da devolução, mesmo parcial).
2. Nó "SALVA NO SUPABASE" faz **`UPDATE orders`** (via conexão Postgres **direta** no pooler, **não** REST API): grava `erp_status`, `blocked_at`, `requires_pickup`, dados da NF de retorno, etc.

> 🔴 **Descoberta crítica:** o n8n grava a devolução **só no nível do PEDIDO** (`orders`). Ele **NÃO** escreve em `order_returns` / `order_return_items`. Ou seja, **a feature de devolução por item NÃO é alimentada pelo fluxo real de produção** — só o `/simular` popula as tabelas itemizadas. Os dados por item já existem no n8n (campo `produtos`), só não são gravados.
>
> **Implicação:** para a devolução por item funcionar em produção, o **n8n precisa ser atualizado** para inserir em `order_returns`/`order_return_items`.

Como o n8n conecta como usuário Postgres privilegiado, ele **bypassa RLS** — as brechas de grant/RLS não afetam o caminho n8n. Mas o SQL usa interpolação de string → risco de injeção/quebra com aspas no XML.

### 6.2 Em teste: o `/simular`
[src/pages/admin/TemporaryReturnSimulator.tsx](../src/pages/admin/TemporaryReturnSimulator.tsx) chama a RPC `simulate_order_return_for_testing`, que insere `order_returns`/`order_return_items` **reais** e roda a reconciliação. É a **única** via no código que popula as tabelas itemizadas. Serve para bateria de testes antes do go-live.

> 🔴 A rota `/simular` está no bundle de produção, acessível a qualquer admin, e grava dados reais (`SIM-<pedido>-NN`). Deve ser gateada por ambiente antes do go-live. **(brecha B3)**

### 6.3 ⚠️ ARMADILHA CRÍTICA: teste (`/simular`) ≠ produção (n8n)
Verificado na fonte (2026-07-09). Devolver um item **já entregue e já com montagem gerada**:

| | `/simular` (teste) | n8n (produção real) |
|---|---|---|
| O que grava | `order_returns` + `order_return_items` como `processed` | só `UPDATE orders` (order-level) |
| Dispara reconciliação? | Sim (gatilho nas tabelas itemizadas) | **Não** — os únicos gatilhos em `orders` são `trg_calculate_deadlines` e `trg_clear_return_pickup_before_order_delete` (DELETE); nenhum reage à devolução |
| View de saldo muda? | Sim | **Não** (só conta `order_return_items` processados) |
| Montagem | **DELETA** o excedente (`sync_assembly_products_with_returns`) | **fica intacta, `pending`** — ninguém bloqueia/cancela/remove; pode até ser roteirizada pra montagem |

**Consequência para o go-live:** o dono validou tudo pelo `/simular`, então viu "devolver cancela a montagem, bloqueia o pedido, cria coleta". **Nada disso acontece em produção hoje**, porque o n8n não alimenta as tabelas itemizadas. O comportamento testado só passa a valer quando o n8n for atualizado para gravar em `order_returns`/`order_return_items` (a ponte que falta — ver §6.1). **Não confundir o que o teste mostra com o que a produção faz.**

---

## 7. FLUXOS OPERACIONAIS (o significado, além do código)

- **Liberação de loja** ([StoreReleaseManagement.tsx](../src/pages/gerente/StoreReleaseManagement.tsx), papel gerente): **NÃO é retirada de cliente.** É sinal interno **loja → logística**: o gerente da loja deixa o produto desmontado, embalado e pronto e "libera" (`store_release_status='released'`) = avisa a logística "pode buscar". A logística (admin) coleta e entrega por rota. Não marca entregue.
  - Por isso a tela de liberação usar `items_json` cru (sem descontar devolução) **não é problema prático hoje** — confirmado pelo dono.
- **Retirada cliente:** fluxo separado — o cliente busca na loja. Confirmar grava `order_withdrawals` e marca `orders='delivered'`. O comprovante só imprime **depois** de confirmada.
- **Entrega por motorista:** entrega normal em casa, por rota.
- **Retirada vs entrega** é escolha manual na tela de rotas (apoiada pela marcação `*retirada*`).

---

## 8. Riscos e brechas conhecidas (catálogo)

Detalhamento completo e ordem de correção no diagnóstico (`objetivo-da-implementa-o-ajustamos-quiet-crown.md`). Resumo:

### 🔴 Blockers de go-live
- **B1 — Schema não reproduzível.** Colunas e grants foram feitos manualmente no banco, fora das migrations. **Mitigado:** existe o baseline verificado `supabase/migrations/00000000000000_baseline_schema.sql`.
- **B2 — `route_order_items`: RLS ligado + só policy de SELECT.** Todo `UPDATE` direto do motorista/offline afeta **0 linhas sem erro** (não lança exceção → o código assume sucesso). Como é sombra, não quebra produção, mas os dados por item ficam inconsistentes. Só a **criação** de snapshot funciona (passa pela RPC SECURITY DEFINER).
- **B3 — `/simular` grava devolução real, sem gate de ambiente.**
- **B7 — Funções/view SECURITY DEFINER abertas a `anon`/`authenticated`** (advisor acusou 109 itens; a view `order_item_shadow_balances` está `SECURITY DEFINER`, deveria ser `security_invoker`).

### 🟠 Inconsistências
- **B4 — `was_returned` nunca setado no item devolvido** (só no clone); o filtro do romaneio faz o inverso do pretendido. **JÁ CORRIGIDO** em `AssemblyManagement.tsx:694` (filtra por `status !== 'cancelled'`).
- **B5 — Shadow não re-sincroniza quando `items_json` muda** (sem trigger).
- **B6 — Devolução do motorista (offline) não gera `order_returns`** → a montagem não enxerga devoluções feitas pelo motorista, só as do ERP. Os dois sistemas de retorno não se cruzam para montagem.
- **B8 — Reconciliação em duplicidade** (frontend + trigger) na finalização da rota.
- **B9 — Simulador insere `processed` direto**, driblando a validação forte (trigger é `BEFORE UPDATE`, não dispara em INSERT).

### 🟡 Menores / dívida técnica
- **B10** — `src/types/database.ts` diverge do schema (nullability, `route_code` via `as any`).
- **B11** — Leituras de `items_json` cru fora do saldo (comprovante de retirada, "Valor: R$" na tela do motorista).
- **B12** — `DeliverySheetGenerator` desenhava linha em branco com itens vazios. **JÁ CORRIGIDO** (guard no gerador).
- **B13** — Regra "devolvido total" replicada em ≥4 arquivos.
- **B14** — Falha do shadow sync na importação vira só toast (pedido fica invisível).
- **B15** — Agregação por `source_line_key` pode colapsar itens distintos.
- **B16** — Assembly report "Resumo" não filtra retorno; import avulsa fora do modelo `order_items` pode ser vista como excedente e apagada por reconciliação.

### Fontes duplas de verdade (a raiz de muitos riscos)
1. **Montagem:** geração por rota filtra por `items_json` cru, mas quantidade e poda usam `order_item_shadow_balances`/`source_payload`. Divergência entre os dois payloads → montagem fantasma ou faltante.
2. **Devolução:** `orders` (n8n, produção) vs `order_returns`/`order_return_items` (`/simular`, teste). Só o segundo alimenta a view sombra.
3. **Estado da entrega:** order-level (`orders`/`route_orders`) governa o fiscal; item-level (`route_order_items`) é sombra — nada downstream lê `delivered_quantity`/`returned_quantity` do item para decidir estado fiscal.

---

## 9. Arquivos-âncora (mapa de navegação)

- **Banco (verdade):** [supabase/migrations/00000000000000_baseline_schema.sql](../supabase/migrations/00000000000000_baseline_schema.sql) — view sombra `:5685`, snapshot `:4128`, reconcile `:2128`, montagem `:3382`/`:3278`, tabela+RLS `route_order_items` `:9223`.
- **Importação:** [src/pages/admin/OrdersImport.tsx](../src/pages/admin/OrdersImport.tsx).
- **Roteirização:** [src/pages/admin/RouteCreation.tsx](../src/pages/admin/RouteCreation.tsx) — fila `:2947`, createRoute `:4163`, snapshots `:211`.
- **PWA entrega:** [src/components/DeliveryMarking.tsx](../src/components/DeliveryMarking.tsx) — entrega `:598`, retorno `:809`, finalização `:1228`.
- **Offline:** [src/utils/offline/backgroundSync.ts](../src/utils/offline/backgroundSync.ts).
- **Montagem:** [src/pages/admin/AssemblyManagement.tsx](../src/pages/admin/AssemblyManagement.tsx), [src/components/AssemblyMarking.tsx](../src/components/AssemblyMarking.tsx), [src/utils/assembly/syncAssemblyProducts.ts](../src/utils/assembly/syncAssemblyProducts.ts).
- **Flags/gates:** [src/utils/itemFulfillment.ts](../src/utils/itemFulfillment.ts).
- **Simulador de devolução:** [src/pages/admin/TemporaryReturnSimulator.tsx](../src/pages/admin/TemporaryReturnSimulator.tsx).
- **Delta produção→teste (o que a feature adiciona):** [docs/lista-de-reforma-producao.md](lista-de-reforma-producao.md).
- **Diagnóstico das brechas:** `/Users/junior/.claude/plans/objetivo-da-implementa-o-ajustamos-quiet-crown.md`.
