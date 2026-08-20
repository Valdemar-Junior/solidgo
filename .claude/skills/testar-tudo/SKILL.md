---
name: testar-tudo
description: Roda a bateria completa de testes do SolidGo (lógica + tela + build) e entrega um relatório simples, sem termos técnicos. Use quando o dono pedir "testa tudo", "roda os testes", "confere se quebrou algo" ou antes de subir mudanças pra produção/GitHub.
---

# Testar tudo — SolidGo

Objetivo: rodar todos os robôs de teste e dizer, em português claro, se está tudo certo ou o que quebrou.

## Passos (rodar nesta ordem)

1. **Lógica (rápido, sempre seguro):**
   ```
   npm test
   ```
   Espere `Tests  NN passed`. Se aparecer `failed`, algo na regra quebrou.

2. **Compila (o app builda?):**
   ```
   npm run build
   ```
   Espere `built in ...`. Erro aqui = o app não compila.

3. **Tela — fluxo completo (abre o navegador de verdade):**
   ```
   npm run e2e
   ```
   Faz login, cria rota, entrega parcial e finaliza no banco de TESTE.
   ⚠️ **Consome 1 pedido multi-item de teste por rodada** (é esperado; há bastante munição).
   Espere `N passed`.

## Como reportar (sem jargão)

Depois de rodar os três, escreva um resumo curto assim:

- ✅ **Lógica:** X de X verificações passaram
- ✅ **Compilação:** app compila normal
- ✅ **Tela:** fluxo completo (criar rota → entrega parcial → finalizar) passou

Se **algo falhar**:
- Diga em linguagem simples **o que** quebrou (qual passo) e **onde** (arquivo/ação).
- Se der pra ver a causa, explique. Se precisar investigar, diga que vai investigar e olhe o print da falha em `test-results/` e o relatório visual (`npm run e2e:report`).
- **Não minimize falha:** se quebrou, diga que quebrou.

## Observações

- Se `npm run e2e` reclamar de **senha** faltando, o dono precisa preencher `tests/e2e/credentials.local.json` (ver `docs/robos-de-teste.md`).
- Se disser que **acabou a munição** de pedidos multi-item, gere uma lista nova com a consulta do banco (multi-item, entregável, liberado, fora de rota) e atualize `MULTI_ITEM_CANDIDATES` em `tests/e2e/flow-helpers.ts`.
- Extra opcional (banco, 18 cenários de devolução/montagem): `bash tests/sql/massive/run-local.sh` (precisa de Postgres local).
