-- ============================================================================
-- DESFAZER — remove tudo que o pacote da uniao acrescentou
-- ----------------------------------------------------------------------------
-- Use SOMENTE se algo der errado depois de aplicar 01..08 e antes/depois do
-- deploy do codigo. Rodar este arquivo devolve o banco ao estado anterior.
--
-- SEGURO porque o pacote e ADITIVO: as 6 tabelas nascem vazias, entao apaga-las
-- nao perde nada que existisse antes. As 3 colunas novas idem.
--
-- A UNICA peca que nao e "nova" e a funcao sync_store_release_for_order, que o
-- arquivo 08 substituiu. Este script devolve a versao que estava em producao
-- em 20/08/2026 (a fachada que preserva a liberacao durante o ciclo da rota).
--
-- IMPORTANTE: se o codigo novo JA estiver no ar, desfaca o deploy ANTES de
-- rodar isto — senao as telas novas procuram tabelas que deixaram de existir.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Gatilhos que o pacote colocou em tabelas que JA existiam
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_clear_return_pickup_before_order_delete    ON public.orders;
DROP TRIGGER IF EXISTS trg_orders_resync_items_shadow                 ON public.orders;
DROP TRIGGER IF EXISTS trg_clear_return_pickup_after_route_order_delete ON public.route_orders;
DROP TRIGGER IF EXISTS trg_clear_return_pickup_before_route_delete    ON public.routes;
DROP TRIGGER IF EXISTS trg_prevent_route_start_with_return_blockers   ON public.routes;
DROP TRIGGER IF EXISTS trg_routes_reconcile_returns_after_completion  ON public.routes;

-- ----------------------------------------------------------------------------
-- 2. View e tabelas novas (CASCADE leva junto indices, politicas e gatilhos delas)
-- ----------------------------------------------------------------------------
DROP VIEW  IF EXISTS public.order_item_shadow_balances CASCADE;
DROP TABLE IF EXISTS public.route_order_items          CASCADE;
DROP TABLE IF EXISTS public.order_item_holds           CASCADE;
DROP TABLE IF EXISTS public.order_return_items         CASCADE;
DROP TABLE IF EXISTS public.order_returns              CASCADE;
DROP TABLE IF EXISTS public.item_fulfillment_sync_issues CASCADE;
DROP TABLE IF EXISTS public.order_items                CASCADE;

-- ----------------------------------------------------------------------------
-- 3. Colunas acrescentadas em tabelas existentes
-- ----------------------------------------------------------------------------
ALTER TABLE public.routes DROP CONSTRAINT IF EXISTS routes_fulfillment_mode_check;
ALTER TABLE public.routes DROP CONSTRAINT IF EXISTS routes_fulfillment_version_check;
ALTER TABLE public.routes DROP COLUMN IF EXISTS fulfillment_mode;
ALTER TABLE public.routes DROP COLUMN IF EXISTS fulfillment_version;
ALTER TABLE public.order_withdrawals DROP COLUMN IF EXISTS items;

-- ----------------------------------------------------------------------------
-- 4. Funcoes novas (as 31 + as 2 assinaturas de ingest_erp_return)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.clear_order_return_pickup(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.clear_return_pickup_after_route_order_delete();
DROP FUNCTION IF EXISTS public.clear_return_pickup_before_parent_delete();
DROP FUNCTION IF EXISTS public.flag_order_return_capacity_divergence();
DROP FUNCTION IF EXISTS public.get_item_fulfillment_shadow_diagnostics();
DROP FUNCTION IF EXISTS public.get_order_return_capacity_violation(uuid);
DROP FUNCTION IF EXISTS public.get_route_start_return_blockers(uuid);
DROP FUNCTION IF EXISTS public.handle_order_return_header_snapshot_refresh();
DROP FUNCTION IF EXISTS public.handle_order_return_item_operational_state_refresh();
DROP FUNCTION IF EXISTS public.handle_order_return_item_snapshot_refresh();
DROP FUNCTION IF EXISTS public.handle_order_return_operational_state_refresh();
DROP FUNCTION IF EXISTS public.ingest_erp_return(text, jsonb, text, text, text, timestamptz, text);
DROP FUNCTION IF EXISTS public.ingest_erp_return(jsonb);
DROP FUNCTION IF EXISTS public.item_fulfillment_can_manage();
DROP FUNCTION IF EXISTS public.order_item_payload_requires_assembly(jsonb);
DROP FUNCTION IF EXISTS public.prevent_collected_return_item_changes();
DROP FUNCTION IF EXISTS public.prevent_route_start_with_return_blockers();
DROP FUNCTION IF EXISTS public.reconcile_order_return_state(uuid);
DROP FUNCTION IF EXISTS public.reconcile_returns_after_route_completion();
DROP FUNCTION IF EXISTS public.register_order_return_pickup(uuid, uuid, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.resync_open_route_order_item_snapshots_for_order(uuid);
DROP FUNCTION IF EXISTS public.set_store_return_confirmed(uuid, boolean);
DROP FUNCTION IF EXISTS public.simulate_order_return_for_testing(uuid, text, text, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.sync_all_order_items_shadow(integer);
DROP FUNCTION IF EXISTS public.sync_assembly_products_with_returns(uuid);
DROP FUNCTION IF EXISTS public.sync_missing_assembly_products_for_pickup_items(uuid, text[]);
DROP FUNCTION IF EXISTS public.sync_order_items_shadow(uuid);
DROP FUNCTION IF EXISTS public.sync_order_return_operational_state(uuid);
DROP FUNCTION IF EXISTS public.sync_route_order_item_snapshots_bulk(uuid[]);
DROP FUNCTION IF EXISTS public.sync_route_order_item_snapshots_system(uuid[]);
DROP FUNCTION IF EXISTS public.trg_resync_order_items_shadow();
DROP FUNCTION IF EXISTS public.validate_order_return_before_processing();

-- ----------------------------------------------------------------------------
-- 5. Devolve a versao de PRODUCAO da liberacao de saida de loja
--    (a que o arquivo 08 tinha substituido pela versao fundida)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_store_release_for_order(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order public.orders%rowtype;
  v_required_locations text[] := '{}';
  v_required_count integer := 0;
  v_released_count integer := 0;
  v_has_withdrawal boolean := false;
begin
  select *
    into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'Pedido % nao encontrado', p_order_id;
  end if;

  select exists (
    select 1
    from public.order_withdrawals ow
    where ow.order_id = p_order_id
  )
  into v_has_withdrawal;

  -- Mudancas do ciclo de rota nao revogam nem removem uma liberacao. A tela
  -- do gerente ja exibe somente pedidos pending, portanto basta manter aqui
  -- o estado atual ate o pedido voltar para a fila de roteirizacao.
  if v_order.blocked_at is not null
     or v_order.status is distinct from 'pending'
     or v_has_withdrawal then
    select
      coalesce(array_agg(sra.store_location order by sra.store_location), '{}'::text[]),
      count(*)::integer,
      (count(*) filter (where sra.status = 'released'))::integer
      into v_required_locations, v_required_count, v_released_count
    from public.store_release_assignments sra
    where sra.order_id = p_order_id;

    return jsonb_build_object(
      'order_id', p_order_id,
      'required_locations', v_required_locations,
      'required_count', v_required_count,
      'released_count', v_released_count,
      'status', v_order.store_release_status,
      'preserved_during_route_lifecycle', true
    );
  end if;

  return public.sync_store_release_for_order_before_route_lifecycle_fix(p_order_id);
end;
$$;


REVOKE ALL ON FUNCTION public.sync_store_release_for_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_store_release_for_order(uuid) TO authenticated, service_role;

COMMIT;

-- ----------------------------------------------------------------------------
-- Conferencia: as 3 linhas abaixo devem voltar a dizer "ausente".
-- ----------------------------------------------------------------------------
SELECT
  CASE WHEN to_regclass('public.order_items')       IS NULL THEN 'order_items: ausente (ok)'       ELSE 'order_items: AINDA EXISTE'       END,
  CASE WHEN to_regclass('public.route_order_items') IS NULL THEN 'route_order_items: ausente (ok)' ELSE 'route_order_items: AINDA EXISTE' END,
  CASE WHEN to_regclass('public.order_returns')     IS NULL THEN 'order_returns: ausente (ok)'     ELSE 'order_returns: AINDA EXISTE'     END;
