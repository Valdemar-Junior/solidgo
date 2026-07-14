# Relatório — Bateria massiva de testes (Entrega + Montagem)

> Testes automatizados do fluxo inteiro de gestão de entrega e montagem, rodados num banco de teste isolado. Linguagem simples, sem termos técnicos. Data: 2026-07-09.

## Resumo em uma linha
Rodei **18 situações diferentes** com **35 verificações** cobrindo tudo que envolve entrega e montagem. **Achei 1 bug de verdade e já corrigi.** Depois da correção, **passou tudo (35 de 35).**

---

## O que eu testei (as 18 situações)

**Entrega:**
1. Entrega completa (todos os itens entregues) → montagem gerada certo.
2. Retorno do pedido inteiro pelo motorista → volta pra fila, sem montagem.
3. **Entrega parcial** (entrega o roupeiro, retorna a cama "não coube") → cama volta pra fila, roupeiro fica entregue.
4. **Re-entrega** do item que faltou numa 2ª rota → só a cama volta (o roupeiro entregue **não** volta = sem entrega dupla).
5. Item com **quantidade maior que 1** (3 unidades) → 3 montagens.

**Montagem:**
6. Pedido **sem montagem** → não gera montagem nenhuma.
7. Montagem só do item **entregue** na entrega parcial.
8. **Retirada** (cliente busca na loja) → gera montagem.
9. Rodar a geração de montagem **2 vezes** → não duplica.
10. Todas as formas de escrever "tem montagem" (Sim, SIM, s, true, 1, yes) reconhecidas.

**Devolução do ERP (a parte que a ponte n8n alimenta):**
11. Devolução **total** antes da rota → bloqueia iniciar a rota.
12. Devolução **parcial** → **não** bloqueia iniciar (só a total bloqueia).
13. Devolução **depois de entregue** → gera pendência de coleta + **carimba** a montagem.
14. A ponte casa a devolução por **código do produto** corretamente.
15. **Código repetido** no mesmo pedido (2 linhas do mesmo produto) → total devolvido soma certo (não duplica nem some).
16. Rodar a **mesma nota 2 vezes** → não duplica a devolução (idempotente).
17. Editar "tem montagem" de um pedido → a camada por item **re-sincroniza** sozinha.
18. Carimbo: a devolução **não apaga** a montagem, só marca como cancelada com registro.

---

## O bug que achei (e já corrigi)

**Situação:** devolução do ERP com quantidade **maior que a comprada** (over-return).
Exemplo: o pedido tem **1** cadeira, mas o ERP manda uma devolução de **5** (por erro de dado, ou somando várias notas).

**O que acontecia:** a ponte (`ingest_erp_return`) **quebrava** com erro de "chave duplicada" — ela tentava registrar a mesma linha duas vezes. Em produção, isso **derrubaria o processamento daquela devolução** e a informação seria perdida (o n8n registraria erro naquele item).

**Por que só apareceu agora:** só acontece num caso raro (ERP mandar quantidade acima do comprado). O `/simular` nunca testou isso. A bateria massiva pegou.

**A correção:** em vez de tentar inserir duas vezes, agora a ponte **acumula** a quantidade na mesma linha. Resultado:
- **Não quebra mais.**
- A devolução acima do comprado é **isolada como "divergente"** (fica marcada pra auditoria e **não corrompe o saldo** do pedido).

> Correção na migration `20260709230000_fix_ingest_over_return_conflict.sql`. Precisa aplicar no banco (é um `CREATE OR REPLACE`, seguro).

---

## Dois "alarmes falsos" (não eram bugs do sistema)

Na primeira rodada, dois testes acusaram — mas investigando na fonte, **não era o sistema, era o meu ambiente de teste:**

1. **Coleta (pickup):** meu teste rodava num **fuso horário diferente da produção** (-3h). Isso fazia parecer que a entrega aconteceu *depois* da devolução. No Supabase (que roda em UTC) isso não ocorre. Ajustei o teste pra rodar em UTC igual à produção → passou.
2. **Over-return (a checagem):** meu teste checava a coisa errada. O certo é a devolução virar "divergente" (que é o comportamento seguro), e é isso que acontece. Corrigi a checagem.

Registro esses pra ser transparente: **nem tudo que "falha" num teste é bug do sistema** — às vezes é o teste que precisa refletir melhor a realidade. Investiguei cada um na fonte antes de concluir.

---

## O que isso significa pra você

- **O núcleo de entrega + montagem está sólido.** 35 verificações passando, incluindo os casos que mais te preocupam (entrega dupla, carimbo, coleta, entrega parcial).
- **Achei e fechei uma brecha real** (o crash no over-return) antes de ir pra produção.
- **Isso é teste de LÓGICA (banco).** A tela do motorista você já testou na mão e funcionou; esta bateria cobre o que roda por baixo.

## Como rodar você mesmo (1 comando)
```
bash tests/sql/massive/run-local.sh
```
Sobe um banco de teste, roda as 18 situações e imprime PASS/BUG em segundos. Toda vez que a gente mexer no código, roda isso e vê na hora se quebrou algo.

## O que ainda falta pra ter 100% de confiança em produção
1. Aplicar a migration da correção (`20260709230000`) no banco.
2. Testar a **tela do motorista** com mais casos (isso é manual, na tela — a lógica por baixo já está coberta aqui).
3. Ligar a ponte n8n em produção com o cuidado do primeiro disparo (backfill), como já conversamos.
