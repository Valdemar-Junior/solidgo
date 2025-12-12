-- Cria tabela de configurações gerais para flags simples
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);

-- RLS
alter table public.app_settings enable row level security;

create policy app_settings_select_authenticated on public.app_settings
  for select
  to authenticated
  using (true);

create policy app_settings_modify_admin on public.app_settings
  for all
  to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

-- Índice para buscas por chave
create index if not exists idx_app_settings_key on public.app_settings (key);

-- Seed: exige conferência por padrão
insert into public.app_settings (key, value)
values ('require_route_conference', jsonb_build_object('enabled', true))
on conflict (key) do nothing;
