alter table public.orders
  add column if not exists is_carrier_delivery boolean not null default false;

create table if not exists public.carrier_cities (
  id uuid primary key default gen_random_uuid(),
  city_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists carrier_cities_city_name_unique_idx
  on public.carrier_cities ((lower(btrim(city_name))));

create index if not exists carrier_cities_active_idx
  on public.carrier_cities (active);

create or replace function public.set_carrier_cities_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_carrier_cities_updated_at on public.carrier_cities;

create trigger trg_carrier_cities_updated_at
before update on public.carrier_cities
for each row
execute function public.set_carrier_cities_updated_at();

alter table public.carrier_cities enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'carrier_cities'
      and policyname = 'carrier_cities_select_authenticated'
  ) then
    create policy carrier_cities_select_authenticated
      on public.carrier_cities
      for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'carrier_cities'
      and policyname = 'carrier_cities_insert_authenticated'
  ) then
    create policy carrier_cities_insert_authenticated
      on public.carrier_cities
      for insert
      to authenticated
      with check (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'carrier_cities'
      and policyname = 'carrier_cities_update_authenticated'
  ) then
    create policy carrier_cities_update_authenticated
      on public.carrier_cities
      for update
      to authenticated
      using (true)
      with check (true);
  end if;
end
$$;

grant select, insert, update on public.carrier_cities to authenticated;
