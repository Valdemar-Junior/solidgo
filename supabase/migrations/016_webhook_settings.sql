create table if not exists public.webhook_settings (
  id uuid default gen_random_uuid() primary key,
  key text not null unique,
  url text not null,
  active boolean default true not null,
  updated_at timestamptz default now() not null
);

alter table public.webhook_settings enable row level security;

create policy webhook_settings_select_authenticated on public.webhook_settings
  for select
  to authenticated
  using (true);

create policy webhook_settings_modify_admin on public.webhook_settings
  for all
  to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

