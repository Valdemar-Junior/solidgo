-- Devolução PARCIAL de pedido NÃO entregue não deve bloquear o pedido inteiro.
-- Antes: sync_order_return_operational_state carimbava blocked_at pra QUALQUER
-- devolução processada → pedido parcial ia pra aba "Bloqueados" e os itens que
-- restavam sumiam da roteirização.
-- Agora: só bloqueia quando é devolução TOTAL ou quando precisa de coleta
-- (entregue-e-devolvido). Parcial sem coleta mantém return_flag (badge) mas
-- fica roteirizável (modelo "mesmo pedido re-fila").
-- Única mudança em relação à versão anterior: variável v_should_block + os
-- campos blocked_at / blocked_reason viraram condicionais.

CREATE OR REPLACE FUNCTION public.sync_order_return_operational_state(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_latest_return record;
  v_has_processed_return boolean := false;
  v_has_open_delivery_route boolean := false;
  v_has_completed_delivery boolean := false;
  v_total_items integer := 0;
  v_returned_items integer := 0;
  v_fully_returned_items integer := 0;
  v_is_total_return boolean := false;
  v_any_return_requires_pickup boolean := false;
  v_has_pending_pickup_return boolean := false;
  v_last_pickup_created_at timestamptz;
  v_reason text;
  v_blocked_reason text;
  v_effective_return_type text;
  v_assembly_sync_result jsonb;
  v_should_block boolean := false;
begin
  if p_order_id is null then
    return jsonb_build_object('order_id', null, 'processed_return', false, 'requires_pickup', false);
  end if;

  select
    o.id, o.status, o.blocked_at, o.blocked_reason,
    o.last_return_reason, o.last_return_notes,
    o.return_nfe_number, o.return_nfe_key, o.return_type, o.return_date
  into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    return jsonb_build_object('order_id', p_order_id, 'processed_return', false, 'requires_pickup', false, 'order_found', false);
  end if;

  select exists (
    select 1
    from public.order_returns r
    where r.order_id = p_order_id
      and r.processing_status = 'processed'
  ) into v_has_processed_return;

  if not v_has_processed_return then
    return jsonb_build_object('order_id', p_order_id, 'processed_return', false, 'requires_pickup', false, 'order_found', true);
  end if;

  select r.id, r.return_nfe_number, r.return_nfe_key, r.return_date,
         r.return_type, r.return_xml, r.reason, r.processing_notes
  into v_latest_return
  from public.order_returns r
  where r.order_id = p_order_id
    and r.processing_status = 'processed'
  order by coalesce(r.return_date, r.updated_at, r.created_at) desc,
    r.updated_at desc, r.created_at desc, r.id desc
  limit 1;

  select exists (
    select 1
    from public.route_orders ro
    join public.routes rt on rt.id = ro.route_id
    where ro.order_id = p_order_id
      and rt.status <> 'completed'
      and upper(coalesce(rt.name, '')) not like 'COLETA-%'
  ) into v_has_open_delivery_route;

  select exists (
    select 1
    from public.route_orders ro
    join public.routes rt on rt.id = ro.route_id
    where ro.order_id = p_order_id
      and ro.status = 'delivered'
      and rt.status = 'completed'
      and upper(coalesce(rt.name, '')) not like 'COLETA-%'
  ) into v_has_completed_delivery;

  select
    count(*),
    count(*) filter (where coalesce(bal.returned_quantity, 0) > 0),
    count(*) filter (
      where coalesce(bal.returned_quantity, 0) >= coalesce(bal.purchased_quantity, 0)
        and coalesce(bal.purchased_quantity, 0) > 0
    )
  into v_total_items, v_returned_items, v_fully_returned_items
  from public.order_item_shadow_balances bal
  where bal.order_id = p_order_id
    and bal.source_present;

  v_is_total_return := (
    v_total_items > 0
    and v_returned_items > 0
    and v_fully_returned_items = v_total_items
  );

  update public.order_returns r
  set requires_pickup = (
    r.processing_status = 'processed'
    and (
      (r.pickup_created_at is not null and r.pickup_order_id is not null and r.pickup_route_id is not null)
      or (
        not exists (
          select 1
          from public.route_orders open_ro
          join public.routes open_rt on open_rt.id = open_ro.route_id
          where open_ro.order_id = r.order_id
            and open_rt.status <> 'completed'
            and upper(coalesce(open_rt.name, '')) not like 'COLETA-%'
            and open_ro.created_at <= coalesce(r.return_date, r.created_at)
        )
        and exists (
          select 1
          from public.route_orders delivered_ro
          join public.routes delivered_rt on delivered_rt.id = delivered_ro.route_id
          where delivered_ro.order_id = r.order_id
            and delivered_ro.status = 'delivered'
            and delivered_rt.status = 'completed'
            and upper(coalesce(delivered_rt.name, '')) not like 'COLETA-%'
            and delivered_ro.created_at <= coalesce(r.return_date, r.created_at)
            and (
              (
                delivered_ro.delivered_at is not null
                and delivered_ro.delivered_at <= coalesce(r.return_date, r.created_at)
              )
              or not exists (
                select 1
                from public.route_order_items legacy_roi
                where legacy_roi.route_order_id = delivered_ro.id
              )
              or (
                delivered_ro.delivered_at is null
                and exists (
                  select 1
                  from public.order_return_items ori
                  join public.route_order_items delivered_roi
                    on delivered_roi.route_order_id = delivered_ro.id
                   and (
                     (ori.order_item_id is not null and delivered_roi.order_item_id = ori.order_item_id)
                     or delivered_roi.source_line_key = ori.source_item_key
                   )
                  where ori.return_id = r.id
                    and (
                      delivered_roi.status = 'delivered'
                      or delivered_roi.delivered_quantity > 0
                    )
                )
              )
            )
        )
      )
    )
  )
  where r.order_id = p_order_id;

  select exists (
    select 1
    from public.order_returns r
    where r.order_id = p_order_id
      and r.processing_status = 'processed'
      and r.requires_pickup
  ) into v_any_return_requires_pickup;

  select exists (
    select 1
    from public.order_returns r
    where r.order_id = p_order_id
      and r.processing_status = 'processed'
      and r.requires_pickup
      and r.pickup_created_at is null
  ) into v_has_pending_pickup_return;

  select max(r.pickup_created_at)
  into v_last_pickup_created_at
  from public.order_returns r
  where r.order_id = p_order_id
    and r.processing_status = 'processed'
    and r.pickup_created_at is not null;

  v_reason := coalesce(
    nullif(trim(coalesce(v_latest_return.reason, '')), ''),
    nullif(trim(coalesce(v_order.last_return_reason, '')), ''),
    case when v_is_total_return then 'Devolução total' else 'Devolução parcial' end
  );

  v_effective_return_type := coalesce(
    nullif(trim(coalesce(v_latest_return.return_type, '')), ''),
    case when v_is_total_return then 'total' else 'partial' end
  );

  v_blocked_reason := case
    when v_has_pending_pickup_return and v_is_total_return then 'Devolução total após entrega - aguardando coleta'
    when v_has_pending_pickup_return and not v_is_total_return then 'Devolução parcial após entrega - aguardando coleta'
    when v_any_return_requires_pickup and v_is_total_return then 'Devolução total após entrega - coleta gerada'
    when v_any_return_requires_pickup and not v_is_total_return then 'Devolução parcial após entrega - coleta gerada'
    when v_is_total_return then 'Devolução total registrada no ERP'
    else 'Devolução parcial registrada no ERP'
  end;

  -- Só bloqueia (tira da roteirização) quando é TOTAL ou quando precisa de
  -- coleta (entregue e devolvido). Parcial de pedido NÃO entregue não bloqueia:
  -- o item devolvido some pelo saldo e o resto continua roteirizável.
  v_should_block := v_is_total_return or v_any_return_requires_pickup;

  update public.orders
  set
    return_flag = true,
    requires_pickup = v_has_pending_pickup_return,
    pickup_created_at = case when v_has_pending_pickup_return then null else v_last_pickup_created_at end,
    blocked_at = case when v_should_block then coalesce(v_latest_return.return_date, blocked_at, timezone('utc', now())) else null end,
    blocked_reason = case when v_should_block then v_blocked_reason else null end,
    last_return_reason = v_reason,
    last_return_notes = coalesce(nullif(trim(coalesce(v_latest_return.processing_notes, '')), ''), last_return_notes),
    return_nfe_number = coalesce(nullif(trim(coalesce(v_latest_return.return_nfe_number, '')), ''), return_nfe_number),
    return_nfe_key = coalesce(nullif(trim(coalesce(v_latest_return.return_nfe_key, '')), ''), return_nfe_key),
    return_nfe_xml = coalesce(nullif(coalesce(v_latest_return.return_xml, ''), ''), return_nfe_xml),
    return_date = coalesce(v_latest_return.return_date, return_date),
    return_type = coalesce(v_effective_return_type, return_type)
  where id = p_order_id;

  v_assembly_sync_result := public.sync_assembly_products_with_returns(p_order_id);

  return jsonb_build_object(
    'order_id', p_order_id,
    'processed_return', true,
    'has_open_delivery_route', v_has_open_delivery_route,
    'has_completed_delivery', v_has_completed_delivery,
    'is_total_return', v_is_total_return,
    'requires_pickup', v_has_pending_pickup_return,
    'returned_items', v_returned_items,
    'total_items', v_total_items,
    'blocked', v_should_block,
    'assembly_deleted_products', coalesce((v_assembly_sync_result->>'deleted_products')::integer, 0),
    'assembly_inserted_products', coalesce((v_assembly_sync_result->>'inserted_products')::integer, 0)
  );
end;
$function$;
