# Lista de reforma — o que a feature "devolução por item" adiciona à produção

Gerado comparando duas fotografias reais dos bancos (schema-only, sem dados de cliente):
- **Produção (antes):** `schema_PRODUCAO_sem_feature.sql` (42 tabelas)
- **Teste (depois):** `schema_teste_COM_feature.sql` (47 tabelas, verificado 100% igual ao banco real)

Este é o **delta exato** que precisaria ser aplicado na produção para levar a feature — nada além disto. Ambos os dumps estão no `.gitignore` (não sobem ao GitHub).

## Delta (produção → teste)

### Tabelas novas (5)
- `public.order_items`
- `public.order_returns`
- `public.order_return_items`
- `public.route_order_items`
- `public.item_fulfillment_sync_issues`

### Colunas novas em tabelas existentes (2) — só em `public.routes`
- `fulfillment_mode`
- `fulfillment_version`

### View nova (1)
- `public.order_item_shadow_balances` ⚠️ está com `SECURITY DEFINER` (ver ressalva abaixo)

### Funções novas (27)
clear_order_return_pickup, clear_return_pickup_after_route_order_delete, clear_return_pickup_before_parent_delete, flag_order_return_capacity_divergence, get_item_fulfillment_shadow_diagnostics, get_order_return_capacity_violation, get_route_start_return_blockers, handle_order_return_header_snapshot_refresh, handle_order_return_item_operational_state_refresh, handle_order_return_item_snapshot_refresh, handle_order_return_operational_state_refresh, item_fulfillment_can_manage, order_item_payload_requires_assembly, prevent_collected_return_item_changes, prevent_route_start_with_return_blockers, reconcile_order_return_state, reconcile_returns_after_route_completion, register_order_return_pickup, resync_open_route_order_item_snapshots_for_order, simulate_order_return_for_testing, sync_all_order_items_shadow, sync_assembly_products_with_returns, sync_order_items_shadow, sync_order_return_operational_state, sync_route_order_item_snapshots_bulk, sync_route_order_item_snapshots_system, validate_order_return_before_processing

### Triggers novos (16)
Em `order_returns`, `order_return_items`, `order_items`, `route_order_items`, `routes`, `route_orders`, `orders` (ver lista completa no diff).

### Policies novas (5) — todas SELECT
order_items, order_returns, order_return_items, route_order_items (SELECT authenticated) + item_fulfillment_sync_issues (SELECT admin).

## Ressalvas a resolver ANTES de aplicar em produção (do relatório de diagnóstico)

- **B2:** `route_order_items` só ganhou policy de SELECT. O frontend faz `UPDATE` por item (marcação do motorista) → com RLS ligado, afeta 0 linhas silenciosamente. Falta policy de escrita.
- **B7 / segurança:** a view `order_item_shadow_balances` está `SECURITY DEFINER` (advisor do Supabase marcou como ERRO); e 27 funções novas ficaram executáveis por `anon` (herdaram GRANT amplo antigo). Endurecer antes do go-live.
- **`simulate_order_return_for_testing`** (e a tela `/simular`) é ferramenta de teste — não deveria ir pra produção.
- **Colunas fora das migrations** (`assembly_products.was_returned/returned_at/return_reason`, etc.) já existem na produção também — não são risco de deploy, mas indicam que as migrations não reproduzem o banco (resolver com o baseline).

## Próximo passo seguro

Gerar UMA migration de deploy contendo exatamente este delta (extraída do dump de teste), aplicá-la sobre uma cópia descartável da produção e confirmar que o resultado fica idêntico ao teste. Zero erros + resultado idêntico = deploy provado seguro.
