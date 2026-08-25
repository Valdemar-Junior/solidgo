-- ============================================================================
-- PARTE 3 — 31 funcoes novas + 2 substituidas
-- ----------------------------------------------------------------------------
-- Gerado em 20/08/2026 a partir do dump FRESCO do Banco_Teste_Soligo.
-- RASCUNHO: nao aplicar em producao sem o ensaio sobre backup restaurado.
-- ============================================================================

SET check_function_bodies = false;

--
-- Name: clear_order_return_pickup(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.clear_order_return_pickup(p_return_id uuid DEFAULT NULL::uuid, p_pickup_order_id uuid DEFAULT NULL::uuid, p_pickup_route_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order_ids uuid[];
  i integer;
begin
  if not public.item_fulfillment_can_manage() then
    raise exception 'Acesso permitido apenas para administradores';
  end if;

  if num_nonnulls(p_return_id, p_pickup_order_id, p_pickup_route_id) <> 1 then
    raise exception 'Informe exatamente um identificador para limpar a coleta';
  end if;

  select coalesce(array_agg(distinct r.order_id), '{}'::uuid[])
  into v_order_ids
  from public.order_returns r
  where (p_return_id is not null and r.id = p_return_id)
     or (p_pickup_order_id is not null and r.pickup_order_id = p_pickup_order_id)
     or (p_pickup_route_id is not null and r.pickup_route_id = p_pickup_route_id);

  update public.order_returns
  set pickup_created_at = null, pickup_order_id = null, pickup_route_id = null
  where (p_return_id is not null and id = p_return_id)
     or (p_pickup_order_id is not null and pickup_order_id = p_pickup_order_id)
     or (p_pickup_route_id is not null and pickup_route_id = p_pickup_route_id);

  if coalesce(array_length(v_order_ids, 1), 0) > 0 then
    for i in 1..array_length(v_order_ids, 1) loop
      perform public.sync_order_return_operational_state(v_order_ids[i]);
    end loop;
  end if;

  return jsonb_build_object('cleared', true, 'order_ids', coalesce(v_order_ids, '{}'::uuid[]));
end;
$$;



--
-- Name: clear_return_pickup_after_route_order_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.clear_return_pickup_after_route_order_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order_id uuid;
begin
  select r.order_id into v_order_id
  from public.order_returns r
  where r.pickup_order_id = old.order_id
    and r.pickup_route_id = old.route_id;

  if v_order_id is not null then
    update public.order_returns
    set pickup_created_at = null, pickup_order_id = null, pickup_route_id = null
    where pickup_order_id = old.order_id
      and pickup_route_id = old.route_id;

    perform public.sync_order_return_operational_state(v_order_id);
  end if;

  return old;
end;
$$;



--
-- Name: clear_return_pickup_before_parent_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.clear_return_pickup_before_parent_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order_ids uuid[];
  i integer;
begin
  if tg_table_name = 'routes' then
    select coalesce(array_agg(distinct r.order_id), '{}'::uuid[])
    into v_order_ids
    from public.order_returns r
    where r.pickup_route_id = old.id;

    update public.order_returns
    set pickup_created_at = null, pickup_order_id = null, pickup_route_id = null
    where pickup_route_id = old.id;
  else
    select coalesce(array_agg(distinct r.order_id), '{}'::uuid[])
    into v_order_ids
    from public.order_returns r
    where r.pickup_order_id = old.id;

    update public.order_returns
    set pickup_created_at = null, pickup_order_id = null, pickup_route_id = null
    where pickup_order_id = old.id;
  end if;

  if coalesce(array_length(v_order_ids, 1), 0) > 0 then
    for i in 1..array_length(v_order_ids, 1) loop
      perform public.sync_order_return_operational_state(v_order_ids[i]);
    end loop;
  end if;

  return old;
end;
$$;



--
-- Name: flag_order_return_capacity_divergence(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.flag_order_return_capacity_divergence() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_return_id uuid;
  v_order_id uuid;
  v_violation jsonb;
  v_issue_key text;
begin
  v_return_id := case when tg_op = 'DELETE' then old.return_id else new.return_id end;

  select r.order_id into v_order_id
  from public.order_returns r
  where r.id = v_return_id;

  if v_order_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_violation := public.get_order_return_capacity_violation(v_return_id);
  v_issue_key := 'over-return:' || v_return_id::text;

  if v_violation is not null then
    update public.order_returns
    set
      processing_status = 'divergent',
      processing_notes = 'Divergência: quantidade devolvida acima da quantidade comprada.',
      requires_pickup = false,
      pickup_created_at = null,
      pickup_order_id = null,
      pickup_route_id = null
    where id = v_return_id
      and processing_status <> 'cancelled';

    insert into public.item_fulfillment_sync_issues (
      order_id, order_item_id, issue_type, issue_key, details, status, detected_at
    ) values (
      v_order_id,
      nullif(v_violation->>'order_item_id', '')::uuid,
      'return_quantity_exceeded',
      v_issue_key,
      v_violation || jsonb_build_object('return_id', v_return_id),
      'open',
      timezone('utc', now())
    )
    on conflict (order_id, issue_type, issue_key) do update set
      order_item_id = excluded.order_item_id,
      details = excluded.details,
      status = 'open',
      detected_at = excluded.detected_at,
      resolved_at = null,
      resolved_by = null;
  else
    update public.item_fulfillment_sync_issues
    set status = 'resolved', resolved_at = timezone('utc', now())
    where order_id = v_order_id
      and issue_type = 'return_quantity_exceeded'
      and issue_key = v_issue_key
      and status = 'open';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;



--
-- Name: get_item_fulfillment_shadow_diagnostics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.get_item_fulfillment_shadow_diagnostics() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_result jsonb;
begin
  if not public.item_fulfillment_can_manage() then
    raise exception 'Acesso permitido apenas para administradores';
  end if;

  select jsonb_build_object(
    'orders_total', (select count(*) from public.orders),
    'orders_with_source_items', (
      select count(distinct oi.order_id)
      from public.order_items oi
      where oi.source_present
    ),
    'orders_without_shadow_items', (
      select count(*)
      from public.orders o
      where jsonb_typeof(o.items_json) = 'array'
        and jsonb_array_length(o.items_json) > 0
        and not exists (
          select 1 from public.order_items oi
          where oi.order_id = o.id and oi.source_present
        )
    ),
    'source_items_total', (select count(*) from public.order_items where source_present),
    'source_items_missing', (select count(*) from public.order_items where not source_present),
    'over_return_items', (select count(*) from public.order_item_shadow_balances where has_over_return),
    'open_issues', (select count(*) from public.item_fulfillment_sync_issues where status = 'open'),
    'legacy_routes', (select count(*) from public.routes where fulfillment_mode = 'legacy'),
    'itemized_routes', (select count(*) from public.routes where fulfillment_mode = 'itemized')
  ) into v_result;

  return v_result;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;


--
-- Name: get_order_return_capacity_violation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.get_order_return_capacity_violation(p_return_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with target_return as (
    select r.id, r.order_id
    from public.order_returns r
    where r.id = p_return_id
  ), target_items as (
    select
      coalesce(ori.order_item_id, by_key.id) as order_item_id,
      max(coalesce(ori.source_item_key, by_key.source_line_key)) as source_item_key,
      sum(ori.returned_quantity) as target_quantity
    from public.order_return_items ori
    join target_return tr on tr.id = ori.return_id
    left join public.order_items by_key
      on by_key.order_id = tr.order_id
     and by_key.source_line_key = ori.source_item_key
    group by coalesce(ori.order_item_id, by_key.id)
  ), other_processed as (
    select
      coalesce(ori.order_item_id, by_key.id) as order_item_id,
      sum(ori.returned_quantity) as returned_quantity
    from public.order_return_items ori
    join public.order_returns r on r.id = ori.return_id
    join target_return tr on tr.order_id = r.order_id
    left join public.order_items by_key
      on by_key.order_id = r.order_id
     and by_key.source_line_key = ori.source_item_key
    where r.id <> p_return_id
      and r.processing_status = 'processed'
    group by coalesce(ori.order_item_id, by_key.id)
  ), violation as (
    select
      oi.id as order_item_id,
      oi.order_id,
      oi.source_line_key,
      oi.product_name,
      oi.purchased_quantity,
      coalesce(op.returned_quantity, 0::numeric) as previously_returned_quantity,
      ti.target_quantity,
      coalesce(op.returned_quantity, 0::numeric) + ti.target_quantity as resulting_returned_quantity
    from target_items ti
    join public.order_items oi on oi.id = ti.order_item_id
    left join other_processed op on op.order_item_id = ti.order_item_id
    where coalesce(op.returned_quantity, 0::numeric) + ti.target_quantity > oi.purchased_quantity
    order by oi.source_line_key
    limit 1
  )
  select case
    when exists (select 1 from violation) then (
      select jsonb_build_object(
        'order_item_id', v.order_item_id,
        'order_id', v.order_id,
        'source_line_key', v.source_line_key,
        'product_name', v.product_name,
        'purchased_quantity', v.purchased_quantity,
        'previously_returned_quantity', v.previously_returned_quantity,
        'event_returned_quantity', v.target_quantity,
        'resulting_returned_quantity', v.resulting_returned_quantity
      )
      from violation v
    )
    else null::jsonb
  end;
$$;



--
-- Name: get_route_start_return_blockers(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.get_route_start_return_blockers(p_route_id uuid) RETURNS TABLE(order_id uuid, order_id_erp text, blocked_reason text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    o.id as order_id,
    o.order_id_erp,
    o.blocked_reason
  from public.route_orders ro
  join public.orders o on o.id = ro.order_id
  where ro.route_id = p_route_id
    and exists (
      select 1
      from public.order_item_shadow_balances bal
      where bal.order_id = o.id
        and bal.source_present
        and bal.returned_quantity > 0
    )
    and not exists (
      select 1
      from public.order_item_shadow_balances bal
      where bal.order_id = o.id
        and bal.source_present
        and bal.shadow_deliverable_quantity > 0
    )
  order by ro.sequence, o.order_id_erp;
$$;



--
-- Name: handle_order_return_header_snapshot_refresh(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.handle_order_return_header_snapshot_refresh() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order_id uuid;
begin
  if tg_op = 'DELETE' then
    v_order_id := old.order_id;
  else
    v_order_id := new.order_id;
  end if;

  if v_order_id is not null then
    perform public.resync_open_route_order_item_snapshots_for_order(v_order_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;



--
-- Name: handle_order_return_item_operational_state_refresh(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.handle_order_return_item_operational_state_refresh() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_return_id uuid;
  v_order_id uuid;
begin
  if tg_op = 'DELETE' then
    v_return_id := old.return_id;
  else
    v_return_id := new.return_id;
  end if;

  if v_return_id is not null then
    select r.order_id
    into v_order_id
    from public.order_returns r
    where r.id = v_return_id;
  end if;

  if v_order_id is not null then
    perform public.sync_order_return_operational_state(v_order_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;



--
-- Name: handle_order_return_item_snapshot_refresh(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.handle_order_return_item_snapshot_refresh() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_return_id uuid;
  v_order_id uuid;
begin
  if tg_op = 'DELETE' then
    v_return_id := old.return_id;
  else
    v_return_id := new.return_id;
  end if;

  if v_return_id is not null then
    select r.order_id
    into v_order_id
    from public.order_returns r
    where r.id = v_return_id;
  end if;

  if v_order_id is not null then
    perform public.resync_open_route_order_item_snapshots_for_order(v_order_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;



--
-- Name: handle_order_return_operational_state_refresh(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.handle_order_return_operational_state_refresh() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order_id uuid;
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    return new;
  end if;

  if tg_op = 'DELETE' then
    v_order_id := old.order_id;
  else
    v_order_id := new.order_id;
  end if;

  if v_order_id is not null then
    perform public.sync_order_return_operational_state(v_order_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;



--
-- Name: ingest_erp_return(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.ingest_erp_return(p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_data timestamptz;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('matched', false, 'reason', 'payload invalido');
  end if;

  -- Data da devolucao (tolera vazio/nulo -> a versao de 7 args usa now() como fallback)
  begin
    v_data := nullif(trim(coalesce(p_payload->>'data_atualizacao_status', '')), '')::timestamptz;
  exception when others then
    v_data := null;
  end;

  return public.ingest_erp_return(
    p_payload->>'numero_pedido',
    coalesce(p_payload->'produtos', '[]'::jsonb),
    p_payload#>>'{xml_retorno,numero_nota_devolucao}',
    p_payload#>>'{xml_retorno,chave_acesso}',
    p_payload#>>'{xml_retorno,xml}',
    v_data,
    p_payload->>'status_pedido'
  );
end;
$$;



--
-- Name: ingest_erp_return(text, jsonb, text, text, text, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.ingest_erp_return(p_numero_pedido text, p_produtos jsonb, p_numero_nota_devolucao text DEFAULT NULL::text, p_chave_acesso text DEFAULT NULL::text, p_return_xml text DEFAULT NULL::text, p_return_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order record;
  v_external_key text;
  v_return_id uuid;
  v_return_date timestamptz := coalesce(p_return_date, timezone('utc', now()));
  v_prod jsonb;
  v_sku text;
  v_qty numeric;
  v_remaining numeric;
  v_line record;
  v_alloc numeric;
  v_matched_qty numeric := 0;
  v_return_type text;
  v_remaining_after numeric;
  v_items_inserted integer := 0;
  v_unmatched jsonb := '[]'::jsonb;
begin
  if nullif(trim(coalesce(p_numero_pedido, '')), '') is null then
    return jsonb_build_object('matched', false, 'reason', 'numero_pedido vazio');
  end if;

  if p_produtos is null or jsonb_typeof(p_produtos) <> 'array' or jsonb_array_length(p_produtos) = 0 then
    return jsonb_build_object('matched', false, 'numero_pedido', p_numero_pedido, 'reason', 'sem produtos');
  end if;

  select o.id, o.order_id_erp
  into v_order
  from public.orders o
  where o.order_id_erp = trim(p_numero_pedido)
  limit 1;

  if not found then
    return jsonb_build_object('matched', false, 'numero_pedido', p_numero_pedido, 'reason', 'pedido nao encontrado');
  end if;

  v_external_key := 'erp-return-' || coalesce(
    nullif(trim(coalesce(p_numero_nota_devolucao, '')), ''),
    nullif(trim(coalesce(p_chave_acesso, '')), ''),
    to_char(v_return_date, 'YYYYMMDDHH24MISS')
  );

  if exists (select 1 from public.order_returns r where r.external_key = v_external_key) then
    return jsonb_build_object(
      'matched', true, 'skipped', true, 'order_id', v_order.id,
      'numero_pedido', p_numero_pedido, 'reason', 'nota ja processada', 'external_key', v_external_key
    );
  end if;

  with sel as (
    select trim(elem->>'codigo') as sku,
           sum(coalesce(nullif(trim(elem->>'qtd'), ''), '0')::numeric) as qty
    from jsonb_array_elements(p_produtos) elem
    group by trim(elem->>'codigo')
  )
  select coalesce(sum(greatest(
           bal.purchased_quantity - bal.returned_quantity - coalesce(s.qty, 0), 0
         )), 0)
  into v_remaining_after
  from public.order_item_shadow_balances bal
  left join sel s on lower(s.sku) = lower(coalesce(bal.sku, ''))
  where bal.order_id = v_order.id and bal.source_present;

  v_return_type := case when v_remaining_after <= 0 then 'total' else 'partial' end;

  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_nfe_key,
    return_date, return_type, return_xml, reason, processing_status
  ) values (
    v_order.id, v_external_key,
    nullif(trim(coalesce(p_numero_nota_devolucao, '')), ''),
    nullif(trim(coalesce(p_chave_acesso, '')), ''),
    v_return_date, v_return_type, nullif(p_return_xml, ''),
    nullif(trim(coalesce(p_reason, '')), ''), 'processed'
  )
  returning id into v_return_id;

  for v_prod in select value from jsonb_array_elements(p_produtos)
  loop
    v_sku := trim(coalesce(v_prod->>'codigo', ''));
    v_qty := coalesce(nullif(trim(coalesce(v_prod->>'qtd', '')), ''), '0')::numeric;
    if v_sku = '' or v_qty <= 0 then continue; end if;
    v_remaining := v_qty;

    for v_line in
      select oi.id as order_item_id, oi.source_line_key, oi.sku, oi.product_name,
             greatest(bal.purchased_quantity - bal.returned_quantity, 0) as available
      from public.order_items oi
      join public.order_item_shadow_balances bal on bal.order_item_id = oi.id
      where oi.order_id = v_order.id and oi.source_present
        and lower(trim(coalesce(oi.sku, ''))) = lower(v_sku)
      order by greatest(bal.purchased_quantity - bal.returned_quantity, 0) desc, oi.id
    loop
      exit when v_remaining <= 0;
      v_alloc := least(v_remaining, greatest(v_line.available, 0));
      if v_alloc <= 0 then continue; end if;

      insert into public.order_return_items (
        return_id, order_item_id, source_item_key, sku_snapshot, product_name_snapshot, returned_quantity
      ) values (
        v_return_id, v_line.order_item_id, v_line.source_line_key, v_line.sku, v_line.product_name, v_alloc
      )
      on conflict (return_id, source_item_key) do update
        set returned_quantity = public.order_return_items.returned_quantity + excluded.returned_quantity;

      v_remaining := v_remaining - v_alloc;
      v_matched_qty := v_matched_qty + v_alloc;
      v_items_inserted := v_items_inserted + 1;
    end loop;

    -- Sobra (over-return ou SKU sem saldo): acumula na primeira linha do SKU.
    if v_remaining > 0 then
      select oi.id as order_item_id, oi.source_line_key, oi.sku, oi.product_name
      into v_line
      from public.order_items oi
      where oi.order_id = v_order.id
        and lower(trim(coalesce(oi.sku, ''))) = lower(v_sku)
      order by oi.id
      limit 1;

      if found then
        insert into public.order_return_items (
          return_id, order_item_id, source_item_key, sku_snapshot, product_name_snapshot, returned_quantity
        ) values (
          v_return_id, v_line.order_item_id, v_line.source_line_key, v_line.sku, v_line.product_name, v_remaining
        )
        on conflict (return_id, source_item_key) do update
          set returned_quantity = public.order_return_items.returned_quantity + excluded.returned_quantity;

        v_matched_qty := v_matched_qty + v_remaining;
        v_items_inserted := v_items_inserted + 1;
      else
        v_unmatched := v_unmatched || jsonb_build_object('codigo', v_sku, 'qtd', v_remaining);
      end if;
    end if;
  end loop;

  if v_items_inserted = 0 then
    delete from public.order_return_items where return_id = v_return_id;
    delete from public.order_returns where id = v_return_id;
    return jsonb_build_object(
      'matched', true, 'order_id', v_order.id, 'numero_pedido', p_numero_pedido,
      'inserted', false, 'reason', 'nenhum SKU casou com o pedido', 'unmatched', v_unmatched
    );
  end if;

  perform public.sync_order_return_operational_state(v_order.id);

  return jsonb_build_object(
    'matched', true, 'inserted', true, 'order_id', v_order.id,
    'numero_pedido', p_numero_pedido, 'return_id', v_return_id,
    'return_type', v_return_type, 'items_inserted', v_items_inserted,
    'quantity_returned', v_matched_qty, 'unmatched', v_unmatched
  );
end;
$$;



--
-- Name: item_fulfillment_can_manage(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.item_fulfillment_can_manage() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    auth.role() = 'service_role'
    or session_user in ('postgres', 'supabase_admin')
    or exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    );
$$;



--
-- Name: order_item_payload_requires_assembly(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.order_item_payload_requires_assembly(p_payload jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from jsonb_array_elements(
      case
        when p_payload is null then '[]'::jsonb
        when jsonb_typeof(p_payload) = 'array' then p_payload
        else jsonb_build_array(p_payload)
      end
    ) item
    where lower(trim(coalesce(item->>'has_assembly', ''))) in ('sim', 's', 'true', '1', 'yes', 'y')
       or lower(trim(coalesce(item->>'possui_montagem', ''))) in ('sim', 's', 'true', '1', 'yes', 'y')
  );
$$;



--
-- Name: prevent_collected_return_item_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.prevent_collected_return_item_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_return_id uuid;
  v_has_pickup boolean := false;
begin
  v_return_id := case when tg_op = 'DELETE' then old.return_id else new.return_id end;

  select (
    r.pickup_created_at is not null
    or r.pickup_order_id is not null
    or r.pickup_route_id is not null
  )
  into v_has_pickup
  from public.order_returns r
  where r.id = v_return_id;

  if coalesce(v_has_pickup, false) then
    raise exception 'Não é permitido alterar itens de uma devolução que já possui coleta criada';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;



--
-- Name: prevent_route_start_with_return_blockers(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.prevent_route_start_with_return_blockers() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_blocked_orders text;
begin
  if new.status = 'in_progress'
     and old.status is distinct from new.status
     and upper(coalesce(new.name, '')) not like 'COLETA-%' then
    select string_agg(blocker.order_id_erp, ', ' order by blocker.order_id_erp)
    into v_blocked_orders
    from public.get_route_start_return_blockers(new.id) blocker;

    if nullif(v_blocked_orders, '') is not null then
      raise exception 'Rota não pode ser iniciada. Remova os pedidos totalmente devolvidos: %',
        v_blocked_orders;
    end if;
  end if;

  return new;
end;
$$;



--
-- Name: reconcile_order_return_state(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.reconcile_order_return_state(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
-- AJUSTE DA UNIAO (nao veio assim do fork).
--
-- return_flag serve para DUAS coisas diferentes:
--   1. DEVOLUCAO do ERP  -> tem registro em order_returns
--   2. RETORNO NA ENTREGA -> o motorista nao conseguiu entregar e voltou com a
--      mercadoria. NAO gera order_returns; a marca vive em route_orders.status
--      = 'returned' e em orders.return_flag/last_return_reason.
--
-- A versao do fork so conhecia o caso 1: sem order_returns processado, ela
-- apagava return_flag/last_return_reason/last_return_notes. Como o gatilho
-- trg_routes_reconcile_returns_after_completion roda para TODO pedido da rota
-- ao finalizar, todo retorno na entrega perdia a marca no momento em que a
-- rota fechava — o pedido voltava para a fila sem o selo "Retornado".
--
-- Aqui a funcao passa a olhar a ULTIMA parada do pedido antes de limpar.
declare
  v_has_processed_return boolean := false;
  v_last_stop record;
  v_delivery_return boolean := false;
begin
  if p_order_id is null then
    raise exception 'p_order_id é obrigatório';
  end if;

  select exists (
    select 1
    from public.order_returns r
    where r.order_id = p_order_id
      and r.processing_status = 'processed'
  ) into v_has_processed_return;

  if v_has_processed_return then
    return public.sync_order_return_operational_state(p_order_id);
  end if;

  -- Ultima parada do pedido. Interessa o estado ATUAL: se ele foi retornado
  -- numa rota antiga mas entregue depois, a entrega manda e a marca sai.
  select ro.status, ro.return_reason, ro.return_notes
  into v_last_stop
  from public.route_orders ro
  where ro.order_id = p_order_id
  order by coalesce(ro.returned_at, ro.delivered_at, ro.updated_at, ro.created_at) desc,
    ro.created_at desc, ro.id desc
  limit 1;

  v_delivery_return := found and v_last_stop.status = 'returned';

  if v_delivery_return then
    -- Retorno na entrega: preserva a marca do motorista e limpa so o que
    -- pertence a devolucao (coleta e bloqueio por devolucao).
    update public.orders
    set
      return_flag = true,
      last_return_reason = coalesce(
        nullif(trim(coalesce(last_return_reason, '')), ''),
        nullif(trim(coalesce(v_last_stop.return_reason, '')), '')
      ),
      last_return_notes = coalesce(
        nullif(trim(coalesce(last_return_notes, '')), ''),
        nullif(trim(coalesce(v_last_stop.return_notes, '')), '')
      ),
      requires_pickup = false,
      pickup_created_at = null,
      blocked_at = case when coalesce(blocked_reason, '') like 'Devolu%' then null else blocked_at end,
      blocked_reason = case when coalesce(blocked_reason, '') like 'Devolu%' then null else blocked_reason end
    where id = p_order_id;

    return jsonb_build_object(
      'order_id', p_order_id,
      'processed_return', false,
      'delivery_return', true,
      'requires_pickup', false
    );
  end if;

  update public.orders
  set
    return_flag = false,
    requires_pickup = false,
    pickup_created_at = null,
    blocked_at = null,
    blocked_reason = null,
    last_return_reason = null,
    last_return_notes = null
  where id = p_order_id;

  return jsonb_build_object(
    'order_id', p_order_id,
    'processed_return', false,
    'delivery_return', false,
    'requires_pickup', false
  );
end;
$$;



--
-- Name: reconcile_returns_after_route_completion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.reconcile_returns_after_route_completion() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order_id uuid;
begin
  if new.status = 'completed' and old.status is distinct from new.status then
    for v_order_id in
      select distinct ro.order_id
      from public.route_orders ro
      where ro.route_id = new.id
    loop
      perform public.reconcile_order_return_state(v_order_id);
    end loop;
  end if;

  return new;
end;
$$;



--
-- Name: register_order_return_pickup(uuid, uuid, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.register_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid, p_pickup_created_at timestamp with time zone DEFAULT timezone('utc'::text, now())) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_return record;
  v_pickup_order record;
  v_pickup_route record;
  v_existing_return_id uuid;
  v_pickup_created_at timestamptz;
begin
  if not public.item_fulfillment_can_manage() then
    raise exception 'Acesso permitido apenas para administradores';
  end if;

  if p_return_id is null or p_pickup_order_id is null or p_pickup_route_id is null then
    raise exception 'Evento, pedido de coleta e rota de coleta são obrigatórios';
  end if;

  select r.* into v_return
  from public.order_returns r
  where r.id = p_return_id
  for update;

  if not found then
    raise exception 'Evento de devolução % não encontrado', p_return_id;
  end if;

  -- Repetir exatamente a mesma solicitação é seguro e não cria duplicidade.
  if v_return.pickup_created_at is not null
     and v_return.pickup_order_id = p_pickup_order_id
     and v_return.pickup_route_id = p_pickup_route_id then
    return jsonb_build_object(
      'return_id', p_return_id,
      'order_id', v_return.order_id,
      'pickup_order_id', p_pickup_order_id,
      'pickup_route_id', p_pickup_route_id,
      'pickup_created_at', v_return.pickup_created_at,
      'already_registered', true
    );
  end if;

  if num_nonnulls(v_return.pickup_created_at, v_return.pickup_order_id, v_return.pickup_route_id) > 0 then
    raise exception 'Este evento de devolução já possui outra coleta vinculada';
  end if;

  if v_return.processing_status <> 'processed' then
    raise exception 'Somente devolução processada pode gerar coleta';
  end if;

  if not v_return.requires_pickup then
    raise exception 'Este evento de devolução não está aguardando coleta';
  end if;

  select o.id, o.order_id_erp, o.raw_json into v_pickup_order
  from public.orders o
  where o.id = p_pickup_order_id;

  if not found then
    raise exception 'Pedido de coleta % não encontrado', p_pickup_order_id;
  end if;

  if coalesce(v_pickup_order.raw_json #>> '{pickup_context,source_return_id}', '') <> p_return_id::text
     or coalesce(v_pickup_order.raw_json #>> '{pickup_context,source_order_id}', '') <> v_return.order_id::text then
    raise exception 'O pedido de coleta não pertence a este evento de devolução';
  end if;

  select rt.id, rt.name into v_pickup_route
  from public.routes rt
  where rt.id = p_pickup_route_id;

  if not found then
    raise exception 'Rota de coleta % não encontrada', p_pickup_route_id;
  end if;

  if upper(coalesce(v_pickup_route.name, '')) not like 'COLETA-%' then
    raise exception 'A rota informada não é uma rota de coleta';
  end if;

  if not exists (
    select 1 from public.route_orders ro
    where ro.route_id = p_pickup_route_id
      and ro.order_id = p_pickup_order_id
  ) then
    raise exception 'O pedido de coleta não está vinculado à rota informada';
  end if;

  select r.id into v_existing_return_id
  from public.order_returns r
  where r.id <> p_return_id
    and (r.pickup_order_id = p_pickup_order_id or r.pickup_route_id = p_pickup_route_id)
  limit 1;

  if v_existing_return_id is not null then
    raise exception 'Esta coleta já pertence a outro evento de devolução';
  end if;

  v_pickup_created_at := coalesce(p_pickup_created_at, timezone('utc', now()));

  update public.order_returns
  set pickup_created_at = v_pickup_created_at,
      pickup_order_id = p_pickup_order_id,
      pickup_route_id = p_pickup_route_id
  where id = p_return_id;

  perform public.sync_order_return_operational_state(v_return.order_id);

  return jsonb_build_object(
    'return_id', p_return_id,
    'order_id', v_return.order_id,
    'pickup_order_id', p_pickup_order_id,
    'pickup_route_id', p_pickup_route_id,
    'pickup_created_at', v_pickup_created_at,
    'already_registered', false
  );
end;
$$;



--
-- Name: resync_open_route_order_item_snapshots_for_order(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.resync_open_route_order_item_snapshots_for_order(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_route_order_ids uuid[];
begin
  if p_order_id is null then
    return jsonb_build_object(
      'order_id', null,
      'synced_route_orders', 0,
      'synced_items', 0
    );
  end if;

  select coalesce(array_agg(ro.id order by ro.created_at, ro.id), '{}'::uuid[])
  into v_route_order_ids
  from public.route_orders ro
  join public.routes r on r.id = ro.route_id
  where ro.order_id = p_order_id
    and r.status <> 'completed'
    -- Só paradas AINDA PENDENTES: parada entregue/retornada tem as marcas do
    -- motorista (status, delivered_quantity) e NÃO pode ser reconstruída.
    and ro.status = 'pending';

  return jsonb_build_object(
    'order_id', p_order_id,
    'result', public.sync_route_order_item_snapshots_system(v_route_order_ids)
  );
end;
$$;



--
-- Name: set_store_return_confirmed(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.set_store_return_confirmed(p_return_id uuid, p_confirmed boolean) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count integer;
begin
  update public.order_returns
     set store_return_confirmed_at = case when p_confirmed then now() else null end,
         store_return_confirmed_by = case when p_confirmed then auth.uid() else null end
   where id = p_return_id;

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;



--
-- Name: simulate_order_return_for_testing(uuid, text, text, jsonb, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.simulate_order_return_for_testing(p_order_id uuid, p_return_nfe_number text, p_reason text, p_items jsonb, p_return_date timestamp with time zone DEFAULT timezone('utc'::text, now())) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order record;
  v_return_id uuid;
  v_return_type text;
  v_selected_count integer := 0;
  v_selected_total numeric := 0;
  v_remaining_after numeric := 0;
  v_item record;
  v_payload_item jsonb;
  v_requested_quantity numeric;
  v_available_quantity numeric;
  v_external_key text;
begin
  if not public.item_fulfillment_can_manage() then
    raise exception 'Acesso permitido apenas para administradores';
  end if;

  if p_order_id is null then
    raise exception 'Pedido é obrigatório';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Informe ao menos um item para devolução';
  end if;

  select o.id, o.order_id_erp
  into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'Pedido % não encontrado', p_order_id;
  end if;

  for v_payload_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    v_requested_quantity := nullif(trim(coalesce(v_payload_item->>'returned_quantity', '')), '')::numeric;

    if v_requested_quantity is null or v_requested_quantity <= 0 then
      raise exception 'Quantidade devolvida inválida no payload informado';
    end if;

    select
      bal.order_item_id,
      bal.source_line_key,
      bal.sku,
      bal.product_name,
      bal.purchased_quantity,
      bal.returned_quantity,
      greatest(bal.purchased_quantity - bal.returned_quantity, 0::numeric) as available_quantity
    into v_item
    from public.order_item_shadow_balances bal
    where bal.order_id = p_order_id
      and bal.order_item_id = nullif(v_payload_item->>'order_item_id', '')::uuid;

    if not found then
      raise exception 'Item % não encontrado para o pedido %',
        coalesce(v_payload_item->>'order_item_id', '?'),
        v_order.order_id_erp;
    end if;

    v_available_quantity := coalesce(v_item.available_quantity, 0::numeric);

    if v_requested_quantity > v_available_quantity then
      raise exception 'Quantidade solicitada para % excede o saldo disponível (%).',
        v_item.product_name,
        v_available_quantity;
    end if;

    v_selected_count := v_selected_count + 1;
    v_selected_total := v_selected_total + v_requested_quantity;
  end loop;

  with remaining_after as (
    select
      greatest(
        bal.purchased_quantity
        - bal.returned_quantity
        - coalesce(sel.selected_quantity, 0::numeric),
        0::numeric
      ) as deliverable_after
    from public.order_item_shadow_balances bal
    left join (
      select
        nullif(value->>'order_item_id', '')::uuid as order_item_id,
        sum((value->>'returned_quantity')::numeric) as selected_quantity
      from jsonb_array_elements(p_items)
      group by 1
    ) sel on sel.order_item_id = bal.order_item_id
    where bal.order_id = p_order_id
      and bal.source_present
  )
  select coalesce(sum(deliverable_after), 0::numeric)
  into v_remaining_after
  from remaining_after;

  v_return_type := case when v_remaining_after <= 0 then 'total' else 'partial' end;
  v_external_key := 'temp-return-' || v_order.order_id_erp || '-' || extract(epoch from clock_timestamp())::bigint::text;

  insert into public.order_returns (
    order_id,
    external_key,
    return_nfe_number,
    return_date,
    return_type,
    reason,
    processing_status
  ) values (
    p_order_id,
    v_external_key,
    nullif(trim(coalesce(p_return_nfe_number, '')), ''),
    coalesce(p_return_date, timezone('utc', now())),
    v_return_type,
    nullif(trim(coalesce(p_reason, '')), ''),
    'processed'
  )
  returning id into v_return_id;

  for v_payload_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    v_requested_quantity := (v_payload_item->>'returned_quantity')::numeric;

    select
      oi.id as order_item_id,
      oi.source_line_key,
      oi.sku,
      oi.product_name
    into v_item
    from public.order_items oi
    where oi.id = nullif(v_payload_item->>'order_item_id', '')::uuid
      and oi.order_id = p_order_id;

    insert into public.order_return_items (
      return_id,
      order_item_id,
      source_item_key,
      sku_snapshot,
      product_name_snapshot,
      returned_quantity
    ) values (
      v_return_id,
      v_item.order_item_id,
      v_item.source_line_key,
      v_item.sku,
      v_item.product_name,
      v_requested_quantity
    );
  end loop;

  perform public.sync_order_return_operational_state(p_order_id);

  return jsonb_build_object(
    'return_id', v_return_id,
    'order_id', p_order_id,
    'order_id_erp', v_order.order_id_erp,
    'return_type', v_return_type,
    'selected_items', v_selected_count,
    'selected_quantity', v_selected_total
  );
end;
$$;



--
-- Name: sync_all_order_items_shadow(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.sync_all_order_items_shadow(p_limit integer DEFAULT NULL::integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order record;
  v_orders integer := 0;
  v_items integer := 0;
  v_result jsonb;
begin
  if not public.item_fulfillment_can_manage() then
    raise exception 'Acesso permitido apenas para administradores';
  end if;

  if p_limit is null then
    for v_order in
      select o.id
      from public.orders o
      order by o.created_at, o.id
    loop
      v_result := public.sync_order_items_shadow(v_order.id);
      v_orders := v_orders + 1;
      v_items := v_items + coalesce((v_result->>'synced_items')::integer, 0);
    end loop;
  else
    for v_order in
      select o.id
      from public.orders o
      order by o.created_at, o.id
      limit greatest(p_limit, 0)
    loop
      v_result := public.sync_order_items_shadow(v_order.id);
      v_orders := v_orders + 1;
      v_items := v_items + coalesce((v_result->>'synced_items')::integer, 0);
    end loop;
  end if;

  return jsonb_build_object(
    'synced_orders', v_orders,
    'synced_items', v_items
  );
end;
$$;



--
-- Name: sync_assembly_products_with_returns(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.sync_assembly_products_with_returns(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_cancelled integer := 0;
  v_inserted integer := 0;
  v_route_result jsonb;
begin
  if p_order_id is null then
    return jsonb_build_object('order_id', null, 'deleted_products', 0, 'inserted_products', 0);
  end if;

  with target_counts as (
    select
      oi.order_id,
      coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF') as product_sku,
      greatest(floor(sum(coalesce(bal.shadow_deliverable_quantity, 0))), 0)::integer as target_count
    from public.order_item_shadow_balances bal
    join public.order_items oi on oi.id = bal.order_item_id
    where oi.order_id = p_order_id
      and oi.source_present
      and public.order_item_payload_requires_assembly(oi.source_payload)
    group by oi.order_id, coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF')
  ), assembly_counts as (
    select
      ap.order_id,
      coalesce(nullif(trim(ap.product_sku), ''), 'SKU-INDEF') as product_sku,
      count(*)::integer as current_count
    from public.assembly_products ap
    where ap.order_id = p_order_id
      and ap.status <> 'cancelled'   -- so montagens ATIVAS contam como existentes
    group by ap.order_id, coalesce(nullif(trim(ap.product_sku), ''), 'SKU-INDEF')
  ), sku_deltas as (
    select
      ac.order_id,
      ac.product_sku,
      greatest(ac.current_count - coalesce(tc.target_count, 0), 0) as extra_count
    from assembly_counts ac
    left join target_counts tc
      on tc.order_id = ac.order_id
     and tc.product_sku = ac.product_sku
    where ac.current_count > coalesce(tc.target_count, 0)
  ), ranked_products as (
    select
      ap.id,
      row_number() over (
        partition by ap.order_id, coalesce(nullif(trim(ap.product_sku), ''), 'SKU-INDEF')
        order by
          case when ap.assembly_route_id is null then 0 else 1 end,
          case ap.status
            when 'pending' then 0
            when 'assigned' then 1
            when 'in_progress' then 2
            when 'completed' then 3
            else 5
          end,
          ap.created_at desc,
          ap.id desc
      ) as rn,
      sd.extra_count
    from public.assembly_products ap
    join sku_deltas sd
      on sd.order_id = ap.order_id
     and sd.product_sku = coalesce(nullif(trim(ap.product_sku), ''), 'SKU-INDEF')
    where ap.order_id = p_order_id
      and ap.status <> 'cancelled'   -- nunca re-carimbar quem ja esta cancelado
  ), stamped as (
    update public.assembly_products ap
       set status = 'cancelled',
           was_returned = true,
           returned_at = coalesce(ap.returned_at, timezone('utc', now())),
           return_reason = coalesce(ap.return_reason, 'Devolução do ERP'),
           updated_at = timezone('utc', now())
    from ranked_products rp
    where ap.id = rp.id
      and rp.rn <= rp.extra_count
    returning ap.id
  )
  select count(*)::integer into v_cancelled from stamped;

  begin
    v_route_result := public.sync_missing_assembly_products_for_order(p_order_id);
    v_inserted := coalesce((v_route_result->>'inserted_products')::integer, 0);
  exception when others then
    v_inserted := 0;
  end;

  -- Mantem a chave 'deleted_products' por compatibilidade com quem consome o retorno;
  -- agora ela representa montagens CARIMBADAS (canceladas), nao apagadas.
  return jsonb_build_object(
    'order_id', p_order_id,
    'deleted_products', coalesce(v_cancelled, 0),
    'cancelled_products', coalesce(v_cancelled, 0),
    'inserted_products', coalesce(v_inserted, 0)
  );
end;
$$;



--
-- Name: sync_missing_assembly_products_for_order(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.sync_missing_assembly_products_for_order(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order record;
  v_latest_route_status text;
  v_is_partial boolean := false;
  v_target_item record;
  v_existing_count int;
  v_missing_count int;
  v_inserted_products int := 0;
  i int;
begin
  if p_order_id is null then
    raise exception 'order_id e obrigatorio';
  end if;

  select o.id, o.status, o.customer_name, o.phone, o.address_json
  into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'Pedido % nao encontrado', p_order_id;
  end if;

  if v_order.status <> 'delivered' then
    raise exception 'Pedido % precisa estar delivered para sincronizar montagem. Status atual: %', p_order_id, v_order.status;
  end if;

  select r.status
  into v_latest_route_status
  from public.route_orders ro
  join public.routes r on r.id = ro.route_id
  where ro.order_id = p_order_id
    and upper(coalesce(r.name, '')) not like 'COLETA-%'
  order by coalesce(r.updated_at, r.created_at) desc
  limit 1;

  if v_latest_route_status is null or v_latest_route_status <> 'completed' then
    raise exception 'Pedido % ainda nao pertence a uma rota finalizada. Status da ultima rota: %',
      p_order_id, coalesce(v_latest_route_status, 'sem rota');
  end if;

  -- Pedido é PARCIAL? (tem item entregue E item faltando ao mesmo tempo)
  select coalesce(bool_or(bal.delivered_quantity > 0), false)
         and coalesce(bool_or(bal.remaining_deliverable_quantity > 0), false)
  into v_is_partial
  from public.order_item_shadow_balances bal
  join public.order_items oi on oi.id = bal.order_item_id
  where oi.order_id = p_order_id
    and oi.source_present;

  for v_target_item in
    select
      coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF') as product_sku,
      max(oi.product_name) as product_name,
      greatest(floor(sum(
        case when v_is_partial
          then least(coalesce(bal.delivered_quantity, 0), coalesce(bal.shadow_deliverable_quantity, 0))
          else coalesce(bal.shadow_deliverable_quantity, 0)
        end
      )), 0)::int as target_quantity
    from public.order_item_shadow_balances bal
    join public.order_items oi on oi.id = bal.order_item_id
    where oi.order_id = p_order_id
      and oi.source_present
      and public.order_item_payload_requires_assembly(oi.source_payload)
    group by coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF')
    having greatest(floor(sum(
        case when v_is_partial
          then least(coalesce(bal.delivered_quantity, 0), coalesce(bal.shadow_deliverable_quantity, 0))
          else coalesce(bal.shadow_deliverable_quantity, 0)
        end
      )), 0)::int > 0
  loop
    select count(*)
    into v_existing_count
    from public.assembly_products ap
    where ap.order_id = p_order_id
      and coalesce(ap.product_sku, 'SKU-INDEF') = v_target_item.product_sku
      and ap.status <> 'cancelled';   -- canceladas (devolvidas) nao contam como existentes

    v_missing_count := v_target_item.target_quantity - coalesce(v_existing_count, 0);

    if v_missing_count > 0 then
      for i in 1..v_missing_count loop
        insert into public.assembly_products (
          order_id, product_name, product_sku, customer_name, customer_phone,
          installation_address, status, created_at, updated_at
        ) values (
          p_order_id, v_target_item.product_name, v_target_item.product_sku,
          v_order.customer_name, v_order.phone, v_order.address_json,
          'pending', timezone('utc', now()), timezone('utc', now())
        );
      end loop;

      v_inserted_products := v_inserted_products + v_missing_count;
    end if;
  end loop;

  return jsonb_build_object('order_id', p_order_id, 'inserted_products', v_inserted_products);
end;
$$;



--
-- Name: sync_missing_assembly_products_for_pickup(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.sync_missing_assembly_products_for_pickup(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order record;
  v_target_item record;
  v_existing_count int;
  v_missing_count int;
  v_inserted_products int := 0;
  i int;
begin
  if p_order_id is null then
    raise exception 'order_id e obrigatorio';
  end if;

  select o.id, o.status, o.customer_name, o.phone, o.address_json
  into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'Pedido % nao encontrado', p_order_id;
  end if;

  if v_order.status <> 'delivered' then
    raise exception 'Pedido % precisa estar delivered para sincronizar montagem da retirada. Status atual: %', p_order_id, v_order.status;
  end if;

  for v_target_item in
    select
      coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF') as product_sku,
      max(oi.product_name) as product_name,
      greatest(floor(sum(coalesce(bal.shadow_deliverable_quantity, 0))), 0)::int as target_quantity
    from public.order_item_shadow_balances bal
    join public.order_items oi on oi.id = bal.order_item_id
    where oi.order_id = p_order_id
      and oi.source_present
      and public.order_item_payload_requires_assembly(oi.source_payload)
    group by coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF')
    having greatest(floor(sum(coalesce(bal.shadow_deliverable_quantity, 0))), 0)::int > 0
  loop
    select count(*)
    into v_existing_count
    from public.assembly_products ap
    where ap.order_id = p_order_id
      and coalesce(ap.product_sku, 'SKU-INDEF') = v_target_item.product_sku;

    v_missing_count := v_target_item.target_quantity - coalesce(v_existing_count, 0);

    if v_missing_count > 0 then
      for i in 1..v_missing_count loop
        insert into public.assembly_products (
          order_id,
          product_name,
          product_sku,
          customer_name,
          customer_phone,
          installation_address,
          status,
          created_at,
          updated_at
        ) values (
          p_order_id,
          v_target_item.product_name,
          v_target_item.product_sku,
          v_order.customer_name,
          v_order.phone,
          v_order.address_json,
          'pending',
          timezone('utc', now()),
          timezone('utc', now())
        );
      end loop;

      v_inserted_products := v_inserted_products + v_missing_count;
    end if;
  end loop;

  return jsonb_build_object('order_id', p_order_id, 'inserted_products', v_inserted_products);
end;
$$;



--
-- Name: sync_missing_assembly_products_for_pickup_items(uuid, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.sync_missing_assembly_products_for_pickup_items(p_order_id uuid, p_skus text[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order record;
  v_target_item record;
  v_existing_count int;
  v_missing_count int;
  v_inserted_products int := 0;
  v_norm_skus text[];
  i int;
begin
  if p_order_id is null then
    raise exception 'order_id e obrigatorio';
  end if;

  if p_skus is null or array_length(p_skus, 1) is null then
    return jsonb_build_object('order_id', p_order_id, 'inserted_products', 0);
  end if;

  -- normaliza os SKUs recebidos (mesma regra do restante do sistema)
  select array_agg(distinct coalesce(nullif(trim(s), ''), 'SKU-INDEF'))
  into v_norm_skus
  from unnest(p_skus) as s;

  select o.id, o.customer_name, o.phone, o.address_json
  into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'Pedido % nao encontrado', p_order_id;
  end if;

  for v_target_item in
    select
      coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF') as product_sku,
      max(oi.product_name) as product_name,
      greatest(floor(sum(coalesce(bal.shadow_deliverable_quantity, 0))), 0)::int as target_quantity
    from public.order_item_shadow_balances bal
    join public.order_items oi on oi.id = bal.order_item_id
    where oi.order_id = p_order_id
      and oi.source_present
      and public.order_item_payload_requires_assembly(oi.source_payload)
      and coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF') = any (v_norm_skus)
    group by coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF')
    having greatest(floor(sum(coalesce(bal.shadow_deliverable_quantity, 0))), 0)::int > 0
  loop
    select count(*)
    into v_existing_count
    from public.assembly_products ap
    where ap.order_id = p_order_id
      and coalesce(ap.product_sku, 'SKU-INDEF') = v_target_item.product_sku;

    v_missing_count := v_target_item.target_quantity - coalesce(v_existing_count, 0);

    if v_missing_count > 0 then
      for i in 1..v_missing_count loop
        insert into public.assembly_products (
          order_id, product_name, product_sku, customer_name, customer_phone,
          installation_address, status, created_at, updated_at
        ) values (
          p_order_id, v_target_item.product_name, v_target_item.product_sku,
          v_order.customer_name, v_order.phone, v_order.address_json,
          'pending', timezone('utc', now()), timezone('utc', now())
        );
      end loop;
      v_inserted_products := v_inserted_products + v_missing_count;
    end if;
  end loop;

  return jsonb_build_object('order_id', p_order_id, 'inserted_products', v_inserted_products);
end;
$$;



--
-- Name: sync_order_items_shadow(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.sync_order_items_shadow(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_items jsonb;
  v_synced integer := 0;
  v_missing integer := 0;
begin
  if not public.item_fulfillment_can_manage() then
    raise exception 'Acesso permitido apenas para administradores';
  end if;

  select o.items_json into v_items
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'Pedido % não encontrado', p_order_id;
  end if;

  update public.order_items
  set source_present = false,
      source_synced_at = timezone('utc', now())
  where order_id = p_order_id;

  if v_items is not null and jsonb_typeof(v_items) = 'array' then
    with raw_items as (
      select value as item, ordinality
      from jsonb_array_elements(v_items) with ordinality
    ), normalized as (
      select
        item,
        ordinality,
        nullif(trim(coalesce(item->>'sku', item->>'codigo', item->>'codigo_produto', '')), '') as sku,
        coalesce(
          nullif(trim(item->>'name'), ''),
          nullif(trim(item->>'produto'), ''),
          nullif(trim(item->>'descricao'), ''),
          nullif(trim(item->>'nome_produto'), ''),
          'Produto sem nome'
        ) as product_name,
        nullif(trim(coalesce(item->>'location', item->>'local_estocagem', '')), '') as storage_location,
        nullif(trim(coalesce(item->>'codigo_kit_pai', '')), '') as kit_code,
        greatest(
          coalesce(
            case when coalesce(item->>'purchased_quantity', '') ~ '^\d+([.,]\d+)?$'
              then replace(item->>'purchased_quantity', ',', '.')::numeric end,
            case when coalesce(item->>'quantidade_comprada', '') ~ '^\d+([.,]\d+)?$'
              then replace(item->>'quantidade_comprada', ',', '.')::numeric end,
            1::numeric
          ),
          0.001::numeric
        ) as purchased_quantity,
        greatest(
          coalesce(
            case when coalesce(item->>'quantity', '') ~ '^\d+([.,]\d+)?$'
              then replace(item->>'quantity', ',', '.')::numeric end,
            case when coalesce(item->>'volumes_per_unit', '') ~ '^\d+([.,]\d+)?$'
              then replace(item->>'volumes_per_unit', ',', '.')::numeric end,
            0::numeric
          ),
          0::numeric
        ) as volume_quantity
      from raw_items
    ), keyed as (
      select
        *,
        case
          when sku is null and storage_location is null and kit_code is null then
            'line:' || ordinality::text
          else
            'item:' || md5(
              lower(coalesce(sku, '')) || '|' ||
              lower(coalesce(storage_location, '')) || '|' ||
              lower(coalesce(kit_code, ''))
            )
        end as source_line_key
      from normalized
    ), grouped as (
      select
        source_line_key,
        max(sku) as sku,
        max(product_name) as product_name,
        sum(purchased_quantity) as purchased_quantity,
        sum(volume_quantity) as volume_quantity,
        max(storage_location) as storage_location,
        max(kit_code) as kit_code,
        jsonb_agg(item order by ordinality) as source_payload
      from keyed
      group by source_line_key
    ), upserted as (
      insert into public.order_items (
        order_id,
        source_line_key,
        sku,
        product_name,
        purchased_quantity,
        volume_quantity,
        storage_location,
        kit_code,
        source_payload,
        source_present,
        source_synced_at
      )
      select
        p_order_id,
        source_line_key,
        sku,
        product_name,
        purchased_quantity,
        volume_quantity,
        storage_location,
        kit_code,
        source_payload,
        true,
        timezone('utc', now())
      from grouped
      on conflict (order_id, source_line_key) do update set
        sku = excluded.sku,
        product_name = excluded.product_name,
        purchased_quantity = excluded.purchased_quantity,
        volume_quantity = excluded.volume_quantity,
        storage_location = excluded.storage_location,
        kit_code = excluded.kit_code,
        source_payload = excluded.source_payload,
        source_present = true,
        source_synced_at = excluded.source_synced_at
      returning id
    )
    select count(*) into v_synced from upserted;
  end if;

  select count(*) into v_missing
  from public.order_items oi
  where oi.order_id = p_order_id
    and oi.source_present = false;

  if v_missing > 0 then
    insert into public.item_fulfillment_sync_issues (
      order_id,
      issue_type,
      issue_key,
      details
    ) values (
      p_order_id,
      'source_items_missing',
      'missing:' || p_order_id::text,
      jsonb_build_object('missing_count', v_missing)
    )
    on conflict (order_id, issue_type, issue_key) do update set
      details = excluded.details,
      status = 'open',
      detected_at = timezone('utc', now()),
      resolved_at = null,
      resolved_by = null;
  else
    update public.item_fulfillment_sync_issues
    set status = 'resolved',
        resolved_at = timezone('utc', now())
    where order_id = p_order_id
      and issue_type = 'source_items_missing'
      and status = 'open';
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'synced_items', v_synced,
    'missing_source_items', v_missing
  );
end;
$_$;



--
-- Name: sync_order_return_operational_state(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.sync_order_return_operational_state(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;



--
-- Name: sync_route_order_item_snapshots_bulk(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.sync_route_order_item_snapshots_bulk(p_route_order_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;



--
-- Name: sync_route_order_item_snapshots_system(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.sync_route_order_item_snapshots_system(p_route_order_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;



--
-- Name: trg_resync_order_items_shadow(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.trg_resync_order_items_shadow() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  begin
    perform public.sync_order_items_shadow(NEW.id);
  exception when others then
    -- Nunca bloqueia a edicao do pedido; so avisa no log.
    raise warning 'trg_resync_order_items_shadow: falha ao re-sincronizar order_items do pedido %: %', NEW.id, sqlerrm;
  end;
  return NEW;
end;
$$;



--
-- Name: validate_order_return_before_processing(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.validate_order_return_before_processing() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_violation jsonb;
begin
  if new.processing_status = 'processed'
     and old.processing_status is distinct from new.processing_status then
    v_violation := public.get_order_return_capacity_violation(new.id);
    if v_violation is not null then
      raise exception 'Quantidade devolvida acima da comprada para o produto %',
        coalesce(v_violation->>'product_name', v_violation->>'source_line_key', 'não identificado');
    end if;
  end if;
  return new;
end;
$$;


