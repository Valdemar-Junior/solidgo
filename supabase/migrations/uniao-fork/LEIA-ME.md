# União do fork: entrega por item, devoluções e conferência

**STATUS: RASCUNHO. Nada aqui foi aplicado em produção.**

Gerado em 20/08/2026 a partir de dois dumps `--schema-only` frescos:
`dump_producao_estrutura.sql` e `dump_teste_estrutura.sql`.

## O que este pacote faz

| Arquivo | O que constrói |
|---|---|
| `01_tabelas_novas.sql` | 6 tabelas: order_items, route_order_items, order_returns, order_return_items, item_fulfillment_sync_issues, order_item_holds |
| `02_colunas_novas.sql` | 3 colunas: order_withdrawals.items, routes.fulfillment_mode, routes.fulfillment_version |
| `03_funcoes.sql` | 31 funções novas + 2 substituídas (montagem por item) |
| `04_view_saldos.sql` | a view do saldo (comprado − devolvido − entregue) |
| `05_chaves_e_indices.sql` | chaves primárias, índices e relacionamentos |
| `06_seguranca_rls.sql` | políticas de acesso e permissões |
| `07_gatilhos.sql` | 17 gatilhos automáticos |
| `08_store_release_fusao.sql` | **peça escrita à mão** — ver abaixo |

## O que ele NÃO toca (verificado)

Preservados, confirmados por teste:

- tabelas `assembly_audit_records`, `fleet_vehicles`, `orders_backup_20241130`
- funções `apply_assembly_audit_decision`, `assembly_audit_item_sku`,
  `guard_assembly_route_completion`, `set_assembly_audit_updated_at`,
  `sync_store_release_for_order_before_route_lifecycle_fix`
- **`get_product_commitment_report` com o fuso de Brasília** (o fork tem uma
  versão antiga sem essa correção; copiá-la seria regressão silenciosa)
- as 4 funções de frota na versão de produção (o fork fundiu `fleet_vehicles`
  dentro de `vehicles`; produção não fez isso e continua com as duas)

## A peça manual: `08_store_release_fusao.sql`

`sync_store_release_for_order` evoluiu **nos dois lados** depois da separação:

- fork (10/07): retirada parcial não zera a liberação do pedido inteiro
- produção (16/07): ciclo de rota não revoga liberação

Onde discordam, **produção vence** (decisão mais recente; preservar não perde
dado). As duas melhorias do fork entram no caminho normal. Detalhes no
cabeçalho do arquivo.

## A virada é gradual

`routes.fulfillment_mode` nasce `'legacy'` em toda rota. Com o pacote aplicado,
o sistema se comporta **exatamente como hoje**. A entrega por item só vale nas
rotas marcadas como `'itemized'`.

Ressalva: o banco já respeita a chave, mas o **código ainda não se ramifica
nela** — isso é trabalho da etapa seguinte (união do código, 18 arquivos).

## Verificação já feita

Aplicado sobre a estrutura **real** de produção (dump de 20/08 restaurado num
Postgres local): **8 de 8 arquivos sem erro**; 43 → 49 tabelas; 52 → 83 funções;
nenhum objeto de produção perdido.

Isso prova que o pacote encaixa e não derruba nada. **Não prova** que funciona
com os dados reais — isso é o ensaio sobre backup restaurado, que ainda falta.

## Quando for aplicar

1. Backup completo da produção, com dados, minutos antes.
2. Restaurar em banco separado e aplicar `01` → `08` na ordem.
3. Rodar a carga inicial: `select public.sync_all_order_items_shadow(null);`
4. Conferir `select * from public.item_fulfillment_sync_issues;` — cada linha
   é um pedido antigo que não espelhou limpo.
5. Só então produção, fora do horário de operação.
