# Plano: Entrega parcial por item (motorista entrega um, retorna outro)

> Modelo escolhido pelo dono: **mesmo pedido, re-fila**. Independente da devolução do ERP (que já está fechada).
> Objetivo: motorista entrega o roupeiro, retorna a cama king ("não coube"); a cama **volta pra fila** pra re-entrega; a montagem gera **só do roupeiro**.

---

## O nó central (a tensão de design)
Um pedido tem **um** status. Na entrega parcial ele precisa, ao mesmo tempo:
- **gerar montagem** do item entregue (hoje isso exige o pedido estar `delivered`), e
- **voltar pra fila** pra re-entregar o item que não coube (isso exige o pedido estar `pending`).

**Solução proposta:** parar de amarrar a montagem no *status do pedido* e amarrar no que **foi de fato entregue por item**. Assim o pedido pode voltar pra `pending` (re-fila) e a montagem do item entregue ainda nasce.

---

## O conceito novo: "entregue até agora" (por item)
Uma quantidade derivada: soma de `route_order_items.delivered_quantity` das **rotas finalizadas** (`completed`), por item (`order_item_id`). Hoje esse campo é gravado mas **quase ninguém lê** — vamos passar a ler.

Com ele:
- **Fila/roteirização** mostra o **restante** = `saldo − entregue` → volta só a cama.
- **Montagem** (na rota) tem alvo = **entregue** (não mais "entregável") → só o roupeiro.

---

## O que muda e o que NÃO pode quebrar

| Área | Mudança | Cuidado |
|---|---|---|
| **Snapshot da rota** (`sync_route_order_item_snapshots_bulk`) | `deliverable = saldo − entregue-até-agora` | preserva os `*_snapshot` de devolução-ERP |
| **Fila** (`RouteCreation` filtro) | mostra se `saldo − entregue > 0` | não afeta pedido sem itens estruturados (legado) |
| **Montagem na rota** (`sync_missing_assembly_products_for_order`) | alvo = entregue-até-agora (com montagem); afrouxar a trava de `status='delivered'` | no caso tudo-ou-nada, entregue = entregável → **comportamento idêntico** |
| **Montagem na retirada** (`sync_missing_assembly_products_for_pickup`) | **NÃO MEXER** | retirada não passa por route_order_items; segue com saldo |
| **Reconciliação ERP** (`sync_assembly_products_with_returns`) | mantém poda por saldo-ERP | continua carimbando devoluções normalmente |
| **Tela do motorista** | seleção por item (entregar / "não coube") | preserva itens bloqueados-ERP (outro eixo) |

> ⚠️ **Ponto sensível a testar:** o item "não coube" precisa de um status que **re-fila** sem virar devolução-ERP. Vou usar `route_order_items.status='returned'` + `delivered_quantity=0` só pra AQUELE item (não pro pedido), e a re-fila vem do "entregue < saldo". NÃO cria `order_returns` (não é devolução do ERP).

---

## Fases (cada uma testada no banco de teste antes da próxima)

**Fase 1 — "Entregue até agora" no saldo e na re-fila (banco).**
- Criar a fonte do "entregue por item" e fazer o snapshot/fila descontarem.
- Teste: simular um item entregue e ver o pedido voltar pra fila só com o item restante.

**Fase 2 — Montagem por "entregue" (banco).**
- Alvo da montagem na rota = entregue-até-agora; afrouxar a trava de status.
- Teste: entrega parcial → montagem só do item entregue; caso tudo-ou-nada → idêntico ao de hoje; retirada → intacta.

**Fase 3 — Tela do motorista (frontend).**
- Seleção por item: marcar quais entregou e quais "não coube".
- Handler grava `delivered_quantity` por item; itens não entregues re-filam.
- Online + offline (backgroundSync).
- Teste: fluxo completo na tela.

**Fase 4 — Finalização e status do pedido.**
- Pedido parcial: gera montagem do entregue e volta pra `pending` (re-fila).
- Teste: ponta a ponta, incluindo re-entrega da cama numa segunda rota.

---

## O que eu preciso de você antes da Fase 1
1. Confirmar o modelo: **mesmo pedido re-fila** (já confirmado) e a solução do nó (montagem amarrada no "entregue", não no status). Faz sentido?
2. Uma dúvida operacional: quando o motorista retorna a cama por "não coube", isso deve pedir **motivo** (igual ao retorno de hoje) ou é só "não entregue"?
