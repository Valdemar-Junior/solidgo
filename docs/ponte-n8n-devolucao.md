# Ponte n8n → SolidGo (devolução por item)

Guia para trocar o `UPDATE orders` cru do n8n por uma chamada única à função `ingest_erp_return`, ligando a devolução do ERP à camada por item.

> Migration que cria a função: [supabase/migrations/20260709170000_bloco3_ponte_n8n_ingest_erp_return.sql](../supabase/migrations/20260709170000_bloco3_ponte_n8n_ingest_erp_return.sql). Aplicar antes de mexer no n8n.

## O que muda

**Hoje** o nó "SALVA NO SUPABASE" faz um `UPDATE orders SET ... WHERE order_id_erp = ...` com o XML colado dentro do SQL. Isso: (a) só mexe no nível do pedido — a devolução por item nunca recebe dado real; (b) tem risco de injeção por aspas no XML.

**Depois** o nó chama uma função só, passando os dados como parâmetro. A função insere em `order_returns`/`order_return_items`, dispara a reconciliação (que preenche todo o legado no `orders` — `return_flag`, `blocked_at`, `requires_pickup`, `return_nfe_*`, `return_date`, `return_type`) e carimba a montagem devolvida.

## Passo a passo

1. **NÃO apague o nó atual.** Duplique-o ou desative-o (deixe como backup até validar).
2. Crie/edite o nó Postgres (credencial de conexão direta no Supabase) como **Execute Query**.
3. Cole esta query — **um parâmetro só** (o item inteiro do ERP como jsonb):

```sql
SELECT public.ingest_erp_return($1::jsonb) AS resultado;
```

4. **Query Parameters** — modo **Expression**, cole exatamente esta linha:

```
{{ [JSON.stringify($json)] }}
```

> - É uma lista com **um** elemento (`[ ... ]`): o item inteiro do ERP virado texto JSON. A função `ingest_erp_return(jsonb)` extrai `numero_pedido`, `produtos`, `xml_retorno.*` e `data_atualizacao_status` sozinha.
> - Os colchetes `[ ]` são obrigatórios (evitam que o n8n quebre o JSON pelas vírgulas internas).
> - No editor, sem dado de entrada, o preview pode mostrar "undefined" — é normal; quando o cron roda com dado real, funciona.
> - A função roda **1 vez por item** (por pedido devolvido) — mantenha "run once for each item".

> **Precisa aplicar antes:** a migration `20260709180000_bloco3_ingest_erp_return_payload_unico.sql` (cria a versão de payload único). As duas anteriores do Bloco 3 também.

## Por que é seguro

- **Idempotente:** a função usa `external_key = 'erp-return-<nota>'`. Se o cron reenviar a mesma nota, ela é **ignorada** (não duplica). Substitui o antigo `AND blocked_at IS NULL`.
- **Não derruba o lote:** se um pedido não existe no SolidGo, ou um `codigo` não casa com nenhum SKU, a função retorna um status e segue — não quebra os outros itens.
- **Sem injeção:** o XML vai como **parâmetro**, não colado no SQL.
- **Permissão:** a função é concedida a `service_role`. Se a conexão "SOLID GO" usar outro papel, rode uma vez:
  `GRANT EXECUTE ON FUNCTION public.ingest_erp_return(text, jsonb, text, text, text, timestamptz, text) TO <papel_do_n8n>;`

## O retorno (para logar/depurar)

A função devolve um JSON por item, ex.:
```json
{ "matched": true, "inserted": true, "order_id": "…", "numero_pedido": "60759",
  "return_type": "partial", "items_inserted": 1, "quantity_returned": 1, "unmatched": [] }
```
Casos: `matched:false` (pedido não encontrado), `skipped:true` (nota já processada), `unmatched:[…]` (SKUs do ERP que não casaram — vale investigar no cadastro).

## ⚠️ Cuidado no primeiro disparo em produção

O cron manda **todos** os devolvidos a cada execução (no exemplo, 262 itens). Na primeira vez em produção, a função vai processar **todo o histórico de devoluções de uma vez** — criando `order_returns` para cada nota antiga e rodando a reconciliação (que pode re-bloquear/gerar coleta para pedidos antigos já resolvidos).

Antes de ligar em produção, decidir com o dono: (a) deixar o cron fazer o backfill completo, ou (b) fazer um backfill controlado (ex.: filtrar só devoluções recentes por `data_atualizacao_status`) e só depois ligar o fluxo contínuo. **Testar primeiro no banco de teste.**

## Como testar (no banco de teste)

1. Aplicar as migrations do Bloco 3 (carimbo + ponte).
2. Pegar um pedido de teste `delivered` com montagem gerada.
3. Chamar a função direto no SQL Editor simulando o ERP:
```sql
SELECT public.ingest_erp_return(
  '<order_id_erp_do_pedido>',
  '[{"codigo":"<sku_do_pedido>","produto":"...","qtd":1,"valor_unit":100}]'::jsonb,
  'TESTE-001', 'chave-teste', '<xml>', now(), 'teste'
);
```
4. Conferir: surgiu `order_returns`/`order_return_items`? O `orders` ficou com `return_flag`/`blocked_reason`? A montagem foi **carimbada** (`cancelled` + `was_returned`) em vez de apagada?
