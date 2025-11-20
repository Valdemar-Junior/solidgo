-- Helpers (Ajudantes)
create table if not exists public.helpers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean default true,
  created_at timestamp with time zone default now()
);

-- Teams (Equipes)
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete restrict,
  helper_id uuid not null references public.helpers(id) on delete restrict,
  name text not null,
  created_at timestamp with time zone default now()
);

-- Add must_change_password to users
alter table if exists public.users add column if not exists must_change_password boolean default true;