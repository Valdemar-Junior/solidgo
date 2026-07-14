# Os robôs de teste do SolidGo (em linguagem simples)

Você tem **dois robôs** que conferem o sistema sozinhos. Servem pra, toda vez que a gente mexe no código, saber na hora se quebrou algo — sem você precisar testar tudo na mão.

---

## 🤖 Robô 1 — de LÓGICA (o "cérebro")

Confere as **regras** por baixo das telas: o que aparece na fila, o que já foi entregue, o valor do pedido, entrega parcial, etc. É **rápido** (~0,2s) e **sempre pode rodar** (não depende de senha nem de internet).

**Como rodar:**
```
npm test
```

**O que ele protege** (inclui os 2 bugs que você já achou):
- Item já entregue **não** volta pra fila (bug da entrega dupla).
- "Retornado na entrega" ≠ "Devolvido no ERP" (bug do rótulo).
- "Valor: R$" desconta o que foi devolvido.
- Fila mostra só o que **falta** entregar, na quantidade certa.

São **33 verificações**. Se todas passarem, aparece `33 passed`.

---

## 🤖 Robô 2 — de TELA (o "olho")

Abre um navegador de verdade, **faz login** como você faria e confere que as telas do fluxo de entrega/montagem **abrem sem quebrar**. Não cria rota nem altera nada no banco — só olha.

**Antes da 1ª vez:** preencher as senhas em `tests/e2e/credentials.local.json` (esse arquivo fica só na sua máquina, não vai pro GitHub).

**Como rodar:**
```
npm run e2e
```

Se quiser ver um relatório visual com print das telas:
```
npm run e2e:report
```

**O que ele confere:**
- Login do admin e do motorista funcionam.
- Telas de **criação de rota**, **gestão de montagem** e **consulta de pedido** abrem sem quebrar.
- Painel do **motorista** abre com "Minhas Rotas".
- **FLUXO COMPLETO ponta a ponta:** admin cria rota com um pedido multi-item → inicia a rota → o motorista faz **entrega parcial** (entrega os itens e **retorna 1** com motivo) → **finaliza a rota**. O teste confere que a rota termina como "Finalizada".

São **7 verificações**.

> ⚠️ **O fluxo completo CRIA rota e entrega REAIS no banco de teste** e consome **1 pedido multi-item por rodada** (há uma lista de ~40 de munição em `tests/e2e/flow-helpers.ts`). É banco de teste descartável, então tudo bem — mas não é "de graça" como o Robô 1. Quando a munição acabar, é só gerar uma lista nova (o robô avisa).

---

## Resumo rápido

| Quero... | Comando |
|---|---|
| Conferir as regras (rápido, sempre) | `npm test` |
| Conferir que as telas abrem | `npm run e2e` |
| Ver o app rodando pra testar na mão | `npm run dev` |
| Conferir que o código compila | `npm run build` |

E tem ainda a **bateria de banco** (18 situações de entrega+montagem):
```
bash tests/sql/massive/run-local.sh
```
