-- ============================================================================
-- Snapshot da rota PULA item já retirado (picked_up)
-- ----------------------------------------------------------------------------
-- A rota é montada por PEDIDO, e o snapshot (route_order_items) era feito a
-- partir do saldo (order_item_shadow_balances), que NÃO conhece a retirada.
-- Resultado: um item já retirado entrava na rota e aparecia pro motorista —
-- risco de entrega em dobro.
--
-- Aqui as DUAS RPCs de snapshot passam a EXCLUIR os itens que têm uma retirada
-- registrada em order_item_holds (status 'picked_up'). Casa por order_item_id,
-- por source_line_key ou por SKU+local (cobre retiradas feitas na roteirização
-- e na tela do gerente).
-- ============================================================================

BEGIN;

-- 1) Versão _bulk (com trava de admin) — criação/edição de rota pelo app.
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
        and not exists (
          select 1 from public.order_item_holds h
          where h.order_id = v_route_order.order_id
            and h.status = 'picked_up'
            and (
              h.order_item_id = oi.id
              or (h.source_line_key is not null and h.source_line_key = oi.source_line_key)
              or (h.sku is not null and oi.sku is not null
                  and lower(btrim(h.sku)) = lower(btrim(oi.sku))
                  and lower(coalesce(h.storage_location, '')) = lower(coalesce(oi.storage_location, '')))
            )
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

-- 2) Versão _system (sem trava) — usada por gatilhos/sistema.
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
        and not exists (
          select 1 from public.order_item_holds h
          where h.order_id = v_route_order.order_id
            and h.status = 'picked_up'
            and (
              h.order_item_id = oi.id
              or (h.source_line_key is not null and h.source_line_key = oi.source_line_key)
              or (h.sku is not null and oi.sku is not null
                  and lower(btrim(h.sku)) = lower(btrim(oi.sku))
                  and lower(coalesce(h.storage_location, '')) = lower(coalesce(oi.storage_location, '')))
            )
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
