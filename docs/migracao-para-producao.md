# Migração do teste → produção (ligar este código à produção)

**Contexto (sempre foi o plano):** todas as features novas foram feitas neste **projeto de teste**. A produção é o sistema **que já roda** (Lojão), com dados reais. O objetivo é **ligar este código à produção** e **espelhar o schema** do teste na produção **sem perder os dados** que já existem lá.

## Situação atual (comparando os dumps de 09/jul)

| | Produção | Teste |
|---|---|---|
| Tabelas | 42 | 47 |
| Funções | 47 | 74 |
| Modelo | **legado** (pedido + `items_json`) | legado **+ camada de item** |

**A produção NÃO tem a camada de item** (evoluiu só no teste). O **delta base** (camada de item / devolução / entrega parcial) já está catalogado desde 09/jul em 📎 [lista-de-reforma-producao.md](lista-de-reforma-producao.md): **5 tabelas** (`order_items`, `order_returns`, `order_return_items`, `route_order_items`, `item_fulfillment_sync_issues`), **2 colunas** em `routes`, **1 view** (`order_item_shadow_balances`), **27 funções**, **16 triggers**, **5 policies**. Lá também estão as **ressalvas de go-live** (B2: falta policy de UPDATE em `route_order_items`; B7: view/funções SECURITY DEFINER; `/simular` não deve ir; etc.).

**Acréscimos DESTA sessão (jul/13), em cima daquele delta:**
- **Retirada por item** — migrations `20260710000000`..`20260710050000` (tabela `order_item_holds`, coluna `order_withdrawals.items`, status `picked_up`, RPC de montagem por item, view de saldo desconta retirado, store-release parcial, várias retiradas por pedido).
- **DANFE no app** — sem migration de schema (endpoint `/api/danfe` + config `nf_config` em `app_settings`, criada no primeiro save). Precisa a env `GOTENBERG_URL` e as deps `fast-xml-parser`/`bwip-js` (Vercel instala do package.json).

> Ou seja: "espelhar as migrations" = trazer **a plataforma de item-level inteira** + retirada + DANFE. É um **release grande** (meses de trabalho), não um paste de poucos arquivos.

## O que NÃO muda: os dados de produção

Tudo é **aditivo** — cria tabelas/colunas/funções **novas**, **não apaga nem altera** as existentes. Os pedidos e o histórico de produção **ficam intactos**. Risco de perda de dados = **zero**.

- **Backfill:** pra os pedidos ANTIGOS aparecerem nas telas de item, eles precisam ser "preenchidos" na camada nova (rodar `sync_order_items_shadow` pra cada pedido existente). O código tem **fallback pro modelo antigo**, então nada some mesmo sem backfill — mas o backfill é o que faz as features de item funcionarem no histórico.

## Plano seguro (recomendado)

1. **Dumps frescos** (schema-only) do **teste atual** e da **produção atual**:
   ```bash
   pg_dump "CONN_TESTE"     --schema-only -n public --no-owner --no-privileges > teste_atual.sql
   pg_dump "CONN_PRODUCAO"  --schema-only -n public --no-owner --no-privileges > producao_atual.sql
   ```
2. **Diff** (teste − produção) → gerar:
   - **Script APLICAR** (tudo que falta, na ordem certa de dependência: tabelas → view → funções → triggers → retirada → nf_config).
   - **Script DESFAZER** (guardando as versões atuais das funções/view da produção que forem substituídas).
   - **Backfill** dos pedidos existentes (`sync_order_items_shadow`).
3. **Ensaio numa CÓPIA da produção** (restaura um backup num Supabase de rascunho → aplica o script → sobe o código → confere: pedidos antigos abrem **E** features novas funcionam).
4. **Produção real:** backup na mão → aplica APLICAR → sobe o código.

## Lado do código (deploy)
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, **`GOTENBERG_URL`**.
- CSP já é portável (`*.supabase.co`).
- Deps novas (`fast-xml-parser`, `bwip-js`) — a Vercel instala do `package.json`.
- **Ordem:** aplicar o schema **ANTES** de subir o código (senão o código quebra procurando tabela que não existe).

## Cuidado extra (drift)
Algumas migrations fazem `CREATE OR REPLACE` de view/funções centrais. Se a produção tiver uma versão **diferente** (customizada), o replace pode sobrescrever. Por isso o **diff antes** e o **script de desfazer** — não aplicar às cegas.

## Resumo
- **Espelhar** = trazer a plataforma de item-level + retirada + DANFE (grande, mas **aditivo**).
- **Dados de produção:** intactos (zero perda).
- **Caminho:** dumps frescos → diff → aplicar/desfazer/backfill → **ensaio na cópia** → produção com backup.
