create or replace function public.sync_store_release_for_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.orders%rowtype;
  v_item jsonb;
  v_location text;
  v_required_locations text[] := '{}';
  v_assign record;
  v_required_count integer := 0;
  v_released_count integer := 0;
  v_only_block_disassemblable boolean := true;
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

  if v_order.blocked_at is not null
     or v_order.status is distinct from 'pending'
     or v_has_withdrawal then
    for v_assign in
      select id, store_location
      from public.store_release_assignments
      where order_id = p_order_id
    loop
      insert into public.store_release_history (
        order_id,
        store_location,
        action,
        notes,
        acted_by_user_id
      ) values (
        p_order_id,
        v_assign.store_location,
        'auto_cleared',
        'Pendencia removida automaticamente porque o pedido nao esta mais aguardando roteirizacao.',
        null
      );

      delete from public.store_release_assignments
      where id = v_assign.id;
    end loop;

    update public.orders
      set requires_store_release = false,
          store_release_status = 'not_applicable'
    where id = p_order_id;

    return jsonb_build_object(
      'order_id', p_order_id,
      'required_locations', v_required_locations,
      'required_count', 0,
      'released_count', 0,
      'status', 'not_applicable'
    );
  end if;

  begin
    select coalesce((value->>'only_block_disassemblable_items')::boolean, true)
      into v_only_block_disassemblable
    from public.app_settings
    where key = 'store_release_control';
  exception
    when others then
      v_only_block_disassemblable := true;
  end;

  if v_order.items_json is not null and jsonb_typeof(v_order.items_json) = 'array' then
    for v_item in
      select value
      from jsonb_array_elements(v_order.items_json)
    loop
      v_location := public.normalize_store_release_location(v_item->>'location');

      if not public.store_release_location_is_controlled(v_location) then
        continue;
      end if;

      if v_only_block_disassemblable
         and not (
           public.store_release_is_truthy(v_item->>'possui_montagem')
           or public.store_release_is_truthy(v_item->>'produto_e_montavel')
         ) then
        continue;
      end if;

      if not (v_location = any (v_required_locations)) then
        v_required_locations := array_append(v_required_locations, v_location);
      end if;
    end loop;
  end if;

  if v_order.raw_json is not null then
    if jsonb_typeof(v_order.raw_json->'produtos_locais') = 'array' then
      for v_item in
        select value
        from jsonb_array_elements(v_order.raw_json->'produtos_locais')
      loop
        v_location := public.normalize_store_release_location(v_item->>'local_estocagem');

        if not public.store_release_location_is_controlled(v_location) then
          continue;
        end if;

        if v_only_block_disassemblable
           and not (
             public.store_release_is_truthy(v_item->>'possui_montagem')
             or public.store_release_is_truthy(v_item->>'produto_e_montavel')
           ) then
          continue;
        end if;

        if not (v_location = any (v_required_locations)) then
          v_required_locations := array_append(v_required_locations, v_location);
        end if;
      end loop;
    end if;

    if jsonb_typeof(v_order.raw_json->'produtos') = 'array' then
      for v_item in
        select value
        from jsonb_array_elements(v_order.raw_json->'produtos')
      loop
        v_location := public.normalize_store_release_location(v_item->>'local_estocagem');

        if not public.store_release_location_is_controlled(v_location) then
          continue;
        end if;

        if v_only_block_disassemblable
           and not (
             public.store_release_is_truthy(v_item->>'possui_montagem')
             or public.store_release_is_truthy(v_item->>'produto_e_montavel')
           ) then
          continue;
        end if;

        if not (v_location = any (v_required_locations)) then
          v_required_locations := array_append(v_required_locations, v_location);
        end if;
      end loop;
    end if;
  end if;

  for v_assign in
    select id, store_location
    from public.store_release_assignments
    where order_id = p_order_id
  loop
    if not (v_assign.store_location = any (v_required_locations)) then
      insert into public.store_release_history (
        order_id,
        store_location,
        action,
        notes,
        acted_by_user_id
      ) values (
        p_order_id,
        v_assign.store_location,
        'auto_cleared',
        'Pendencia removida por reclassificacao automatica.',
        null
      );

      delete from public.store_release_assignments
      where id = v_assign.id;
    end if;
  end loop;

  foreach v_location in array v_required_locations
  loop
    insert into public.store_release_assignments (
      order_id,
      store_location,
      status
    ) values (
      p_order_id,
      v_location,
      'pending'
    )
    on conflict (order_id, store_location) do nothing;

    if not exists (
      select 1
      from public.store_release_history h
      where h.order_id = p_order_id
        and h.store_location = v_location
        and h.action = 'auto_created'
    ) then
      insert into public.store_release_history (
        order_id,
        store_location,
        action,
        notes,
        acted_by_user_id
      ) values (
        p_order_id,
        v_location,
        'auto_created',
        'Pendencia criada por classificacao automatica.',
        null
      );
    end if;
  end loop;

  select count(*)
    into v_required_count
  from public.store_release_assignments
  where order_id = p_order_id;

  select count(*)
    into v_released_count
  from public.store_release_assignments
  where order_id = p_order_id
    and status = 'released';

  if v_required_count = 0 then
    update public.orders
      set requires_store_release = false,
          store_release_status = 'not_applicable'
    where id = p_order_id;
  elsif v_released_count = 0 then
    update public.orders
      set requires_store_release = true,
          store_release_status = 'pending'
    where id = p_order_id;
  elsif v_released_count < v_required_count then
    update public.orders
      set requires_store_release = true,
          store_release_status = 'partial'
    where id = p_order_id;
  else
    update public.orders
      set requires_store_release = true,
          store_release_status = 'released'
    where id = p_order_id;
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'required_locations', v_required_locations,
    'required_count', v_required_count,
    'released_count', v_released_count,
    'status', (
      select o.store_release_status
      from public.orders o
      where o.id = p_order_id
    )
  );
end;
$function$;

create or replace function public.sync_store_release_for_open_orders()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id uuid;
  v_processed integer := 0;
begin
  for v_order_id in
    select o.id
    from public.orders o
    where o.blocked_at is null
      and o.status = 'pending'
      and not exists (
        select 1
        from public.order_withdrawals ow
        where ow.order_id = o.id
      )
  loop
    perform public.sync_store_release_for_order(v_order_id);
    v_processed := v_processed + 1;
  end loop;

  for v_order_id in
    select distinct o.id
    from public.orders o
    join public.store_release_assignments sra on sra.order_id = o.id
    where o.blocked_at is not null
       or o.status is distinct from 'pending'
       or exists (
         select 1
         from public.order_withdrawals ow
         where ow.order_id = o.id
       )
  loop
    perform public.sync_store_release_for_order(v_order_id);
    v_processed := v_processed + 1;
  end loop;

  return jsonb_build_object('processed_orders', v_processed);
end;
$function$;

select public.sync_store_release_for_open_orders();
