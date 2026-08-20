-- ============================================================================
-- Entrega parcial por item — FASE 1B: snapshot da rota usa o RESTANTE (não o saldo cheio)
-- ============================================================================
-- Muda as DUAS RPCs de snapshot (_bulk com trava de admin e _system sem trava,
-- usada por gatilhos) pra alocar o item pela quantidade que AINDA FALTA entregar
-- (remaining_deliverable_quantity = saldo − entregue), em vez do saldo cheio.
--
-- Efeito: quando um pedido parcialmente entregue voltar pra fila e for re-roteirizado,
-- o snapshot da nova rota traz SÓ o item que falta (o já entregue tem remaining=0 e
-- some do snapshot). O item que ainda falta entra normal.
--
-- O que NÃO muda:
--   * `returned_quantity_snapshot` continua = devolvido-ERP (bal.returned_quantity);
--   * o `status` (returned/partial/pending) continua baseado no saldo-ERP
--     (é o eixo de bloqueio por devolução do ERP, independente da entrega).
--
-- Como hoje delivered_quantity é 0 em tudo, remaining = saldo cheio, então este
-- snapshot produz EXATAMENTE o mesmo resultado de antes. Só passa a diferir quando
-- a entrega parcial (fases seguintes) começar a gravar delivered_quantity.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) Versão _bulk (com trava de admin) — usada na criação/edição de rota pelo app.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_route_order_item_snapshots_bulk(p_route_order_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_route_order record;
  v_route_orders integer := 0;
  v_items integer := 0;
  v_inserted_count integer := 0;
begin
  if not public.item_fulfillment_can_manage() then
    raise exception 'Acesso permitido apenas para administradores';
  end if;

  if p_route_order_ids is null or coalesce(array_length(p_route_order_ids, 1), 0) = 0 then
    return jsonb_build_object('synced_route_orders', 0, 'synced_items', 0);
  end if;

  for v_route_order in
    select ro.id, ro.route_id, ro.order_id
    from public.route_orders ro
    where ro.id = any(p_route_order_ids)
    order by ro.created_at, ro.id
  loop
    delete from public.route_order_items roi
    where roi.route_order_id = v_route_order.id;

    with snapshot_rows as (
      select
        v_route_order.id as route_order_id,
        v_route_order.route_id,
        v_route_order.order_id,
        oi.id as order_item_id,
        oi.source_line_key,
        oi.sku as sku_snapshot,
        oi.product_name as product_name_snapshot,
        oi.storage_location as storage_location_snapshot,
        oi.kit_code as kit_code_snapshot,
        oi.purchased_quantity,
        bal.remaining_deliverable_quantity as allocated_quantity,
        bal.returned_quantity as returned_quantity_snapshot,
        bal.remaining_deliverable_quantity as deliverable_quantity_snapshot,
        case
          when bal.returned_quantity > 0 and bal.shadow_deliverable_quantity = 0 then 'returned'
          when bal.returned_quantity > 0 and bal.shadow_deliverable_quantity > 0 then 'partial'
          else 'pending'
        end as status
      from public.order_item_shadow_balances bal
      join public.order_items oi on oi.id = bal.order_item_id
      where bal.order_id = v_route_order.order_id
        and oi.source_present
        and (
          bal.remaining_deliverable_quantity > 0
          or bal.returned_quantity > 0
        )
    ), inserted as (
      insert into public.route_order_items (
        route_order_id, route_id, order_id, order_item_id, source_line_key,
        sku_snapshot, product_name_snapshot, storage_location_snapshot, kit_code_snapshot,
        purchased_quantity, allocated_quantity, returned_quantity_snapshot,
        deliverable_quantity_snapshot, status
      )
      select
        route_order_id, route_id, order_id, order_item_id, source_line_key,
        sku_snapshot, product_name_snapshot, storage_location_snapshot, kit_code_snapshot,
        purchased_quantity, allocated_quantity, returned_quantity_snapshot,
        deliverable_quantity_snapshot, status
      from snapshot_rows
      returning id
    )
    select count(*) into v_inserted_count from inserted;

    v_route_orders := v_route_orders + 1;
    v_items := v_items + coalesce(v_inserted_count, 0);
  end loop;

  return jsonb_build_object('synced_route_orders', v_route_orders, 'synced_items', v_items);
end;
$function$;

-- ----------------------------------------------------------------------------
-- 2) Versão _system (sem trava) — usada por gatilhos/sistema.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_route_order_item_snapshots_system(p_route_order_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_route_order record;
  v_route_orders integer := 0;
  v_items integer := 0;
  v_inserted_count integer := 0;
begin
  if p_route_order_ids is null or coalesce(array_length(p_route_order_ids, 1), 0) = 0 then
    return jsonb_build_object('synced_route_orders', 0, 'synced_items', 0);
  end if;

  for v_route_order in
    select ro.id, ro.route_id, ro.order_id
    from public.route_orders ro
    where ro.id = any(p_route_order_ids)
    order by ro.created_at, ro.id
  loop
    delete from public.route_order_items roi
    where roi.route_order_id = v_route_order.id;

    with inserted as (
      insert into public.route_order_items (
        route_order_id, route_id, order_id, order_item_id, source_line_key,
        sku_snapshot, product_name_snapshot, storage_location_snapshot, kit_code_snapshot,
        purchased_quantity, allocated_quantity, returned_quantity_snapshot,
        deliverable_quantity_snapshot, status
      )
      select
        v_route_order.id as route_order_id,
        v_route_order.route_id,
        v_route_order.order_id,
        oi.id as order_item_id,
        oi.source_line_key,
        oi.sku as sku_snapshot,
        oi.product_name as product_name_snapshot,
        oi.storage_location as storage_location_snapshot,
        oi.kit_code as kit_code_snapshot,
        oi.purchased_quantity,
        bal.remaining_deliverable_quantity as allocated_quantity,
        bal.returned_quantity as returned_quantity_snapshot,
        bal.remaining_deliverable_quantity as deliverable_quantity_snapshot,
        case
          when bal.returned_quantity > 0 and bal.shadow_deliverable_quantity = 0 then 'returned'
          when bal.returned_quantity > 0 and bal.shadow_deliverable_quantity > 0 then 'partial'
          else 'pending'
        end as status
      from public.order_item_shadow_balances bal
      join public.order_items oi on oi.id = bal.order_item_id
      where bal.order_id = v_route_order.order_id
        and oi.source_present
        and (
          bal.remaining_deliverable_quantity > 0
          or bal.returned_quantity > 0
        )
      returning id
    )
    select count(*) into v_inserted_count from inserted;

    v_route_orders := v_route_orders + 1;
    v_items := v_items + coalesce(v_inserted_count, 0);
  end loop;

  return jsonb_build_object('synced_route_orders', v_route_orders, 'synced_items', v_items);
end;
$function$;

COMMIT;
