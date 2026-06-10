alter table public.mdfe_settings
  add column if not exists auto_close_on_route_complete boolean not null default false;
