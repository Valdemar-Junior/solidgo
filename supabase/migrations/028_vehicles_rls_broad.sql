-- Broaden vehicles policies: allow any authenticated user to insert/update/read

alter table public.vehicles enable row level security;

create or replace policy "vehicles_select_authenticated"
on public.vehicles
for select
to authenticated
using ( true );

create or replace policy "vehicles_insert_authenticated"
on public.vehicles
for insert
to authenticated
with check ( true );

create or replace policy "vehicles_update_authenticated"
on public.vehicles
for update
to authenticated
using ( true )
with check ( true );

