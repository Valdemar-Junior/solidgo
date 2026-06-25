alter table public.users drop constraint if exists users_role_check;

alter table public.users
  add constraint users_role_check
  check (role = any (array['admin', 'driver', 'helper', 'montador', 'conferente', 'consultor', 'gerente']));

insert into public.app_settings (key, value)
values
  ('store_release_control', jsonb_build_object('enabled', false, 'only_block_disassemblable_items', true))
on conflict (key) do nothing;

alter table public.orders
  add column if not exists requires_store_release boolean not null default false,
  add column if not exists store_release_status text not null default 'not_applicable';

alter table public.orders drop constraint if exists orders_store_release_status_check;

alter table public.orders
  add constraint orders_store_release_status_check
  check (store_release_status = any (array['not_applicable', 'pending', 'partial', 'released']));

create index if not exists idx_orders_store_release_status
  on public.orders (requires_store_release, store_release_status);

create table if not exists public.user_store_release_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  store_location text not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists user_store_release_locations_user_location_idx
  on public.user_store_release_locations (user_id, store_location);

create index if not exists user_store_release_locations_location_idx
  on public.user_store_release_locations (store_location);

create table if not exists public.store_release_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  store_location text not null,
  status text not null default 'pending',
  released_at timestamptz null,
  released_by_user_id uuid null references public.users(id) on delete set null,
  release_notes text null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.store_release_assignments drop constraint if exists store_release_assignments_status_check;

alter table public.store_release_assignments
  add constraint store_release_assignments_status_check
  check (status = any (array['pending', 'released']));

create unique index if not exists store_release_assignments_order_location_idx
  on public.store_release_assignments (order_id, store_location);

create index if not exists store_release_assignments_status_idx
  on public.store_release_assignments (status, store_location);

create table if not exists public.store_release_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  store_location text not null,
  action text not null,
  notes text null,
  acted_by_user_id uuid null references public.users(id) on delete set null,
  acted_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.store_release_history drop constraint if exists store_release_history_action_check;

alter table public.store_release_history
  add constraint store_release_history_action_check
  check (action = any (array['auto_created', 'auto_cleared', 'released', 'reverted']));

create index if not exists store_release_history_order_idx
  on public.store_release_history (order_id, acted_at desc);

create or replace function public.set_store_release_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$function$;

drop trigger if exists trg_user_store_release_locations_updated_at on public.user_store_release_locations;
create trigger trg_user_store_release_locations_updated_at
before update on public.user_store_release_locations
for each row
execute function public.set_store_release_updated_at();

drop trigger if exists trg_store_release_assignments_updated_at on public.store_release_assignments;
create trigger trg_store_release_assignments_updated_at
before update on public.store_release_assignments
for each row
execute function public.set_store_release_updated_at();

alter table public.user_store_release_locations enable row level security;
alter table public.store_release_assignments enable row level security;
alter table public.store_release_history enable row level security;

drop policy if exists user_store_release_locations_select_policy on public.user_store_release_locations;
create policy user_store_release_locations_select_policy
  on public.user_store_release_locations
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.role = 'admin'
    )
  );

drop policy if exists user_store_release_locations_modify_admin_policy on public.user_store_release_locations;
create policy user_store_release_locations_modify_admin_policy
  on public.user_store_release_locations
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.role = 'admin'
    )
  );

drop policy if exists store_release_assignments_select_policy on public.store_release_assignments;
create policy store_release_assignments_select_policy
  on public.store_release_assignments
  for select
  to authenticated
  using (true);

drop policy if exists store_release_history_select_policy on public.store_release_history;
create policy store_release_history_select_policy
  on public.store_release_history
  for select
  to authenticated
  using (true);

grant select, insert, update, delete on public.user_store_release_locations to authenticated;
grant select on public.store_release_assignments to authenticated;
grant select on public.store_release_history to authenticated;

create or replace function public.normalize_store_release_location(p_value text)
returns text
language plpgsql
immutable
as $function$
declare
  v_raw text;
  v_plain text;
begin
  v_raw := upper(trim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')));
  v_plain := translate(v_raw, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC');

  if v_plain = 'ATACADO LOJA ASSU' then
    return 'ATACADO LOJA ASSU';
  end if;

  if v_plain = 'LOJA MOSSORO' then
    return 'LOJA MOSSORO';
  end if;

  if v_plain = 'LOJA MOSSORO PARTAGE' then
    return 'LOJA MOSSORO PARTAGE';
  end if;

  return v_raw;
end;
$function$;

create or replace function public.store_release_location_is_controlled(p_value text)
returns boolean
language sql
immutable
as $function$
  select public.normalize_store_release_location(p_value) = any (
    array[
      'ATACADO LOJA ASSU',
      'LOJA MOSSORO',
      'LOJA MOSSORO PARTAGE'
    ]
  );
$function$;

create or replace function public.store_release_is_truthy(p_value text)
returns boolean
language sql
immutable
as $function$
  select lower(trim(coalesce(p_value, ''))) = any (array['sim', 's', 'true', '1', 'yes', 'y']);
$function$;

create or replace function public.sync_store_release_for_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order record;
  v_only_block_disassemblable boolean := true;
  v_required_locations text[] := array[]::text[];
  v_required_count integer := 0;
  v_released_count integer := 0;
  v_location text;
  v_item jsonb;
  v_assign record;
begin
  if p_order_id is null then
    raise exception 'order_id e obrigatorio';
  end if;

  select
    o.id,
    o.items_json,
    o.raw_json
  into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'Pedido % nao encontrado', p_order_id;
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
    'required_locations', coalesce(v_required_locations, array[]::text[]),
    'required_count', v_required_count,
    'released_count', v_released_count
  );
end;
$function$;

create or replace function public.sync_store_release_for_orders(p_order_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id uuid;
  v_processed integer := 0;
begin
  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    return jsonb_build_object('processed_orders', 0);
  end if;

  foreach v_order_id in array p_order_ids
  loop
    perform public.sync_store_release_for_order(v_order_id);
    v_processed := v_processed + 1;
  end loop;

  return jsonb_build_object('processed_orders', v_processed);
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
      and o.status = any (array['pending', 'returned', 'assigned'])
      and not exists (
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

create or replace function public.set_store_release_assignment(
  p_order_id uuid,
  p_store_location text,
  p_released boolean,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_location text := public.normalize_store_release_location(p_store_location);
begin
  if v_user_id is null then
    raise exception 'Usuario autenticado obrigatorio';
  end if;

  select u.role
    into v_user_role
  from public.users u
  where u.id = v_user_id;

  if v_user_role is distinct from 'gerente' then
    raise exception 'Somente gerente pode liberar saida de loja';
  end if;

  if not exists (
    select 1
    from public.user_store_release_locations usrl
    where usrl.user_id = v_user_id
      and usrl.store_location = v_location
  ) then
    raise exception 'Gerente sem permissao para o local %', v_location;
  end if;

  if not exists (
    select 1
    from public.store_release_assignments sra
    where sra.order_id = p_order_id
      and sra.store_location = v_location
  ) then
    raise exception 'Pendencia nao encontrada para o local %', v_location;
  end if;

  update public.store_release_assignments
     set status = case when p_released then 'released' else 'pending' end,
         released_at = case when p_released then timezone('utc'::text, now()) else null end,
         released_by_user_id = case when p_released then v_user_id else null end,
         release_notes = nullif(trim(coalesce(p_notes, '')), '')
   where order_id = p_order_id
     and store_location = v_location;

  insert into public.store_release_history (
    order_id,
    store_location,
    action,
    notes,
    acted_by_user_id
  ) values (
    p_order_id,
    v_location,
    case when p_released then 'released' else 'reverted' end,
    nullif(trim(coalesce(p_notes, '')), ''),
    v_user_id
  );

  perform public.sync_store_release_for_order(p_order_id);

  return jsonb_build_object(
    'order_id', p_order_id,
    'store_location', v_location,
    'released', p_released
  );
end;
$function$;

grant execute on function public.sync_store_release_for_order(uuid) to authenticated;
grant execute on function public.sync_store_release_for_orders(uuid[]) to authenticated;
grant execute on function public.sync_store_release_for_open_orders() to authenticated;
grant execute on function public.set_store_release_assignment(uuid, text, boolean, text) to authenticated;
