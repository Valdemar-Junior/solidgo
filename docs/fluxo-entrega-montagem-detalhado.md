# Fluxo detalhado: Entrega → Montagem (e onde a Devolução real cruza)

> Documento de **validação**. É o meu entendimento detalhado do fluxo, escrito pra você (dono) **conferir e corrigir** antes de a gente construir a entrega parcial por item. Onde eu tiver dúvida, marquei com ❓ pra você responder.
>
> Foco: entender **em detalhe** como um pedido caminha da rota até a montagem, e **onde a devolução real (n8n → `ingest_erp_return`) toca** cada passo — porque essa parte ainda não foi testada de ponta a ponta.

---

## Parte A — O caminho normal (sem devolução)

### A1. Criação da rota → snapshot por item
- Admin monta a rota em `RouteCreation`. Ao criar (`createRoute`), insere `route_orders` e chama `sync_route_order_item_snapshots_bulk`.
- Esse snapshot (`route_order_items`) é **fotografado do saldo** (`order_item_shadow_balances` = comprado − devolvido-ERP):
  - `allocated_quantity = deliverable_quantity_snapshot = saldo entregável`;
  - `returned_quantity_snapshot = devolvido no ERP` (antes da rota);
  - `status` inicial: `pending` (normal), `partial`/`returned` se já veio devolução-ERP.
- `orders.status → 'assigned'` (some da fila de roteirização).

### A2. Motorista marca ENTREGUE (`markAsDelivered`)
- Hoje é **tudo-ou-nada**: entrega **todos** os itens com saldo (`deliverable_quantity_snapshot > 0`).
- Grava por item: `route_order_items.status='delivered'`, `delivered_quantity = deliverable_quantity_snapshot`.
- Grava `route_orders.status='delivered'`, `orders.status='delivered'`.
- Chama `reconcile_order_return_state` (que só faz algo se houver devolução processada).
- **Montagem NÃO nasce aqui** — só na finalização da rota.

### A3. Finalização da rota (`handleFinalizeRoute`)
1. Drena a fila offline; se sobrar item pendente de sync, **aborta**.
2. `orders.status='delivered'` (entregues), `routes.status='completed'`.
3. Fecha MDF-e.
4. Loop `reconcile_order_return_state` por pedido.
5. **`syncAssemblyProductsForRoute`** → gera a montagem.

### A4. Geração da montagem (`sync_missing_assembly_products_for_order`)
- Exige `orders.status='delivered'` **e** última rota (não-COLETA) `completed`.
- **Alvo = `shadow_deliverable_quantity`** dos itens que exigem montagem (`has_assembly`).
- Cria `alvo − existentes` registros `assembly_products` (`pending`).

> ⚠️ **Aqui está a suposição-raiz:** o alvo usa o **saldo entregável**, assumindo que "entregável = entregue". No tudo-ou-nada isso é verdade. Na entrega parcial, não seria (geraria montagem de item não entregue).

---

## Parte B — O caminho da devolução do MOTORISTA (retorno na rua)

### B1. Motorista marca RETORNADO (`markAsReturned`)
- Exige motivo. Grava **todos** os itens: `delivered_quantity=0`, `returned_quantity = deliverable_quantity_snapshot`, `status='returned'`.
- `route_orders.status='returned'`, `orders.return_flag=true` (**NÃO** muda `orders.status`).
- **Trava proposital:** não reconcilia nem libera na hora — só na finalização (anti-entrega-dupla).

### B2. Na finalização
- Pedidos `route_orders.status='returned'` → `orders.status='pending'`, `return_flag=true` → **voltam pra fila** inteiros.
- Como o saldo (view) é comprado − devolvido-**ERP** e **não** desconta o `delivered_quantity`, o pedido volta com o saldo **cheio** → re-roteirizado inteiro. (Hoje ok, porque foi tudo-ou-nada.)

> ⚠️ **Importante:** a devolução do MOTORISTA (retorno na rua) **NÃO** cria `order_returns`. Ela só mexe em `route_order_items` + `return_flag`. Então ela **não** aparece no saldo por item nem afeta montagem — o pedido simplesmente volta pra fila.

---

## Parte C — O caminho da devolução do ERP (a "devolução real")

### C1. Como entra
- **Produção real:** n8n (cron 5min) → **`ingest_erp_return`** (a ponte nova) → grava `order_returns` + `order_return_items` (`processing_status='processed'`) → chama `sync_order_return_operational_state`.
- **Testes:** `/simular` (`simulate_order_return_for_testing`) faz o mesmo, casando por `order_item_id`.

### C2. O que a reconciliação faz (`sync_order_return_operational_state`)
- Recalcula, no `orders`: `return_flag`, `blocked_at`, `blocked_reason`, `requires_pickup`, `return_nfe_*`, `return_date`, `return_type` (total/parcial).
- `requires_pickup` é decidido comparando a **data da devolução** com as datas da rota/entrega — e usa `route_order_items.delivered_quantity > 0` como sinal de "esse item foi entregue" (por isso coleta).
- No fim, chama **`sync_assembly_products_with_returns`** → **carimba** (cancela) a montagem excedente quando o saldo cai. *(Foi o que a gente implementou e testou.)*

### C3. Onde a devolução-ERP cruza a entrega/montagem
- A view shadow desconta a devolução-ERP → o **snapshot** de novas rotas já nasce sem o item devolvido, e a **fila** esconde pedido totalmente devolvido.
- Item devolvido-ERP **antes** da rota → nasce `blocked`/`returned` no snapshot → o motorista vê bloqueado, não entrega.
- Item devolvido-ERP **durante** a rota → a tela do motorista detecta (compara assinatura) e pede reconferência; na finalização há um `confirm` de itens recém-bloqueados.
- Devolução-ERP **depois** da entrega → carimba a montagem já gerada.

---

## Parte D — ❓ Pontos que eu preciso que você confirme (interações NÃO testadas com devolução real)

Esses são os cruzamentos que, pelo que você disse, **não foram testados com a devolução real** (só com `/simular`). Preciso do seu conhecimento da operação:

1. **❓ A ponte (`ingest_erp_return`) casa por SKU; o `/simular` casa por `order_item_id`.** No `/simular` você escolhe o item exato. Na vida real, se o pedido tem **dois itens com o mesmo SKU** em linhas diferentes, o casamento por SKU pode alocar na linha errada. Isso acontece nos seus pedidos (SKU repetido)? Ou cada SKU é único por pedido?

2. **❓ Devolução-ERP de um pedido que ainda está EM ROTA (não entregue).** O n8n manda a devolução; a reconciliação roda. O que deve acontecer com a rota em andamento? Hoje o snapshot já foi criado com o saldo antigo — o motorista veria o item ainda como entregável até recarregar. Isso é problema na sua operação?

3. **❓ Devolução-ERP parcial vs coleta.** Quando o ERP devolve só 1 de 3 itens de um pedido já entregue, o `requires_pickup` liga "aguardando coleta". Na prática, como funciona essa coleta hoje na operação? O motorista vai buscar? Vira retirada?

4. **❓ O primeiro disparo do cron em produção** vai processar **todo o histórico** de devoluções de uma vez (reconciliando pedidos antigos já resolvidos). Isso pode re-bloquear/gerar coleta pra pedidos antigos. Você quer um **filtro por data** (só devoluções recentes) no primeiro disparo?

---

## Parte E — Onde a ENTREGA PARCIAL vai se plugar (o que ela toca)

Só pra deixar mapeado (ainda **não vamos construir**):

1. **Saldo "entregue até agora"** (novo) — pra fila mostrar só o restante e a montagem gerar só o entregue.
2. **Montagem** — alvo passa de "entregável" pra "entregue".
3. **Tela do motorista** — seleção por item (entregar / "não coube").
4. **Re-fila** — pedido parcial volta como `pending`, mas o snapshot da próxima rota exclui o já entregue.

E o cuidado que você reforçou: **não encostar** no fluxo da devolução-ERP (Parte C), que mexe em outro eixo (`*_snapshot` + `order_returns`).

---

## O que eu preciso de você agora
Confirmar/corrigir as **Partes A, B, C** (meu entendimento está certo?) e responder as **❓ da Parte D**. Com isso eu fico de fato expert no fluxo real, e aí sim a gente desenha a entrega parcial sem quebrar nada.
