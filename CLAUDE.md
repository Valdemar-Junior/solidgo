# SolidGo — contexto do projeto

SaaS de **gestão de entrega e montagem** (móveis), **já em produção**. Este diretório é uma **cópia de teste** ligada a um Supabase de testes (projeto `Banco_Teste_Soligo`, ref `lbidznhkhtwamgaexgyy`).

> O dono é **não-programador** (conhecimento básico-médio). Explique em **português claro, sem jargão**. Discorde quando a ideia dele não for a melhor. Entregue migrations/arquivos como **link clicável**. Prefira executar você mesmo a mandar ele mexer em arquivo.

## Stack
- **Front:** React + TypeScript + Vite (dev na porta **5175**) + PWA (offline via idb/backgroundSync).
- **Back:** Supabase (Postgres, sessão em **UTC**). Automação por **n8n**.
- Login por **nome + senha** (resolve pra email via `resolve_login_email`), auth do Supabase.

## Arquitetura de dados (2 camadas convivendo)
1. **Legado (nível pedido):** `orders` + `items_json` — pedido bruto do ERP.
2. **Nova (nível item):** `order_items`, view **`order_item_shadow_balances`** (saldo por item: comprado/devolvido/entregável/restante), `order_returns`/`order_return_items`, `route_order_items` (snapshot por rota), `assembly_products`/`assembly_routes` (montagem).

**Funcionalidade central:** **entrega parcial por item** — o motorista entrega um item e retorna outro ("roupeiro entregue, cama não coube"); só o item que falta volta pra fila (modelo "mesmo pedido re-fila"). Montagem só do item entregue.

## Regras/armadilhas importantes
- **MCP do Supabase é READ-ONLY.** Migrations são aplicadas **na mão** pelo dono no SQL Editor (entregue como link clicável). Nunca escreva/delete no banco real sem permissão explícita.
- **As migrations versionadas NÃO batem 100% com o banco real** (várias IAs mexeram: Trae, Codex, Gemini). Ao aplicar em banco limpo/produção, confira colunas faltantes.
- **Timezone:** produção roda UTC; testes locais precisam `ALTER DATABASE ... SET timezone TO 'UTC'` pra refletir a realidade.
- **n8n** grava devolução do ERP via `ingest_erp_return(jsonb)` (casa por código do produto). A feature itemizada NÃO é alimentada pelo fluxo real ainda — só pela devolução do ERP + entregas.
- **Montagem/reconciliação no banco** reage à view shadow **independente** dos feature flags de UI (`item_fulfillment_control`).

## Testes (os "robôs")
- **Lógica** (rápido, sempre): `npm test` — regras das telas de entrega/fila (Vitest, `src/**/*.test.ts`).
- **Tela** (navegador real): `npm run e2e` — login + telas + **fluxo completo** (criar rota → entrega parcial → finalizar). ⚠️ Escreve no banco de TESTE. Senhas em `tests/e2e/credentials.local.json` (fora do git).
- **Banco** (18 cenários devolução/montagem): `bash tests/sql/massive/run-local.sh`.
- **Skill:** `/testar-tudo` roda tudo e resume sem jargão.
- Verificar build: `npm run build`. Type-check: `npm run check`.

## Documentação detalhada
- `docs/como-o-solidgo-funciona.md` — manual mestre (importação → roteirização → PWA → montagem + n8n).
- `docs/robos-de-teste.md` — como rodar os testes (linguagem simples).
- `docs/plano-entrega-parcial.md` — desenho da entrega parcial.
- `docs/ponte-n8n-devolucao.md` — configuração da ponte n8n.
- `docs/relatorio-testes-massivos.md` — relatório da bateria de banco.
