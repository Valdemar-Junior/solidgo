-- Catalog of standardized delivery route names
create table if not exists public.delivery_route_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint delivery_route_catalog_name_not_blank check (char_length(btrim(name)) > 0)
);

create unique index if not exists delivery_route_catalog_name_unique_idx
  on public.delivery_route_catalog ((lower(btrim(name))));

create index if not exists delivery_route_catalog_active_idx
  on public.delivery_route_catalog (active);

create or replace function public.set_delivery_route_catalog_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_delivery_route_catalog_updated_at on public.delivery_route_catalog;

create trigger trg_delivery_route_catalog_updated_at
before update on public.delivery_route_catalog
for each row
execute function public.set_delivery_route_catalog_updated_at();

alter table public.delivery_route_catalog enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'delivery_route_catalog'
      and policyname = 'delivery_route_catalog_select_authenticated'
  ) then
    create policy delivery_route_catalog_select_authenticated
      on public.delivery_route_catalog
      for select
      using (auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'delivery_route_catalog'
      and policyname = 'delivery_route_catalog_insert_authenticated'
  ) then
    create policy delivery_route_catalog_insert_authenticated
      on public.delivery_route_catalog
      for insert
      with check (auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'delivery_route_catalog'
      and policyname = 'delivery_route_catalog_update_authenticated'
  ) then
    create policy delivery_route_catalog_update_authenticated
      on public.delivery_route_catalog
      for update
      using (auth.role() = 'authenticated')
      with check (auth.role() = 'authenticated');
  end if;
end
$$;

grant select, insert, update on public.delivery_route_catalog to authenticated;
