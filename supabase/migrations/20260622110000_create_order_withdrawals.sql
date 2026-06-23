create table if not exists public.order_withdrawals (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  responsible_name text not null,
  notes text,
  withdrawn_at timestamptz not null default timezone('utc'::text, now()),
  registered_by_user_id uuid references public.users(id) on delete set null,
  registered_by_name text,
  source text not null default 'manual',
  legacy_route_id uuid references public.routes(id) on delete set null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint order_withdrawals_order_unique unique (order_id),
  constraint order_withdrawals_responsible_name_not_blank check (char_length(btrim(responsible_name)) > 0),
  constraint order_withdrawals_source_check check (source in ('manual', 'legacy_route'))
);

create index if not exists order_withdrawals_withdrawn_at_idx
  on public.order_withdrawals (withdrawn_at desc);

create index if not exists order_withdrawals_registered_by_idx
  on public.order_withdrawals (registered_by_user_id);

create or replace function public.set_order_withdrawals_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists trg_order_withdrawals_updated_at on public.order_withdrawals;

create trigger trg_order_withdrawals_updated_at
before update on public.order_withdrawals
for each row
execute function public.set_order_withdrawals_updated_at();

alter table public.order_withdrawals enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'order_withdrawals'
      and policyname = 'order_withdrawals_select_authenticated'
  ) then
    create policy order_withdrawals_select_authenticated
      on public.order_withdrawals
      for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'order_withdrawals'
      and policyname = 'order_withdrawals_insert_authenticated'
  ) then
    create policy order_withdrawals_insert_authenticated
      on public.order_withdrawals
      for insert
      to authenticated
      with check (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'order_withdrawals'
      and policyname = 'order_withdrawals_update_authenticated'
  ) then
    create policy order_withdrawals_update_authenticated
      on public.order_withdrawals
      for update
      to authenticated
      using (true)
      with check (true);
  end if;
end
$$;

grant select, insert, update on public.order_withdrawals to authenticated;

insert into public.order_withdrawals (
  order_id,
  responsible_name,
  notes,
  withdrawn_at,
  registered_by_name,
  source,
  legacy_route_id
)
select
  ro.order_id,
  coalesce(nullif(btrim(r.conferente), ''), 'Não informado') as responsible_name,
  nullif(btrim(r.observations), '') as notes,
  coalesce(r.completed_at, r.updated_at, r.created_at, timezone('utc'::text, now())) as withdrawn_at,
  nullif(btrim(r.conferente), '') as registered_by_name,
  'legacy_route' as source,
  r.id as legacy_route_id
from public.routes r
join public.route_orders ro on ro.route_id = r.id
where r.status = 'completed'
  and r.name like 'RETIRADA%'
on conflict (order_id) do update set
  responsible_name = excluded.responsible_name,
  notes = excluded.notes,
  withdrawn_at = excluded.withdrawn_at,
  registered_by_name = coalesce(excluded.registered_by_name, public.order_withdrawals.registered_by_name),
  source = excluded.source,
  legacy_route_id = excluded.legacy_route_id,
  updated_at = timezone('utc'::text, now());
