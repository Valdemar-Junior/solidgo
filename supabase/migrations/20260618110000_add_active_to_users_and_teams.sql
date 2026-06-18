alter table public.users
  add column if not exists active boolean not null default true;

alter table public.teams_user
  add column if not exists active boolean not null default true;

update public.users
set active = true
where active is distinct from true;

update public.teams_user
set active = true
where active is distinct from true;

alter table public.users drop constraint if exists users_role_check;

alter table public.users
  add constraint users_role_check
  check (role = any (array['admin', 'driver', 'helper', 'montador', 'conferente', 'consultor']));

create index if not exists idx_users_active on public.users(active);
create index if not exists idx_teams_user_active on public.teams_user(active);
