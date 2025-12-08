-- RLS policies for vehicles table
-- Allow authenticated users to read vehicles; only admins can insert/update

do $$
begin
  -- Enable RLS
  perform 1 from pg_tables where schemaname='public' and tablename='vehicles';
  execute 'alter table public.vehicles enable row level security';
exception when others then null; end $$;

-- Read policy: any authenticated user
create or replace policy vehicles_select_authenticated
on public.vehicles
for select
using (auth.uid() is not null);

-- Insert policy: only admins
create or replace policy vehicles_insert_admin
on public.vehicles
for insert
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  )
);

-- Update policy: only admins
create or replace policy vehicles_update_admin
on public.vehicles
for update
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  )
);

