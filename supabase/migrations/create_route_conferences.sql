-- Create tables for route conference workflow
create table if not exists public.route_conferences (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes(id) on delete cascade,
  status text check (status = any(array['in_progress','completed'])) default 'in_progress',
  result_ok boolean,
  started_at timestamptz default timezone('utc', now()),
  finished_at timestamptz,
  user_id uuid references public.users(id),
  summary jsonb,
  created_at timestamptz default timezone('utc', now())
);

alter table public.route_conferences enable row level security;

create table if not exists public.route_conference_scans (
  id uuid primary key default gen_random_uuid(),
  route_conference_id uuid not null references public.route_conferences(id) on delete cascade,
  normalized_code text not null,
  order_id uuid references public.orders(id),
  product_code text,
  volume_index int,
  volume_total int,
  matched boolean default true,
  timestamp timestamptz default timezone('utc', now()),
  created_at timestamptz default timezone('utc', now())
);

alter table public.route_conference_scans enable row level security;

-- RLS policies: authenticated can select/insert; admin can update
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='route_conferences' and policyname='rc_select_authenticated'
  ) then
    create policy rc_select_authenticated on public.route_conferences for select using (auth.role() = 'authenticated');
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='route_conferences' and policyname='rc_insert_authenticated'
  ) then
    create policy rc_insert_authenticated on public.route_conferences for insert with check (auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='route_conference_scans' and policyname='rcs_select_authenticated'
  ) then
    create policy rcs_select_authenticated on public.route_conference_scans for select using (auth.role() = 'authenticated');
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='route_conference_scans' and policyname='rcs_insert_authenticated'
  ) then
    create policy rcs_insert_authenticated on public.route_conference_scans for insert with check (auth.role() = 'authenticated');
  end if;
end $$;
