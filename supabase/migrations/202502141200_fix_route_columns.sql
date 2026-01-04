-- Fix route columns for team tracking
-- Ensure team_id exists
alter table public.routes 
add column if not exists team_id uuid references public.teams(id) on delete set null;

-- Ensure helper_id exists (referencing users as helper role is in users table)
alter table public.routes 
add column if not exists helper_id uuid references public.users(id) on delete set null;

-- Ensure conferente_id exists
alter table public.routes 
add column if not exists conferente_id uuid references public.users(id) on delete set null;

-- Add indexes for performance
create index if not exists idx_routes_team_id on public.routes(team_id);
create index if not exists idx_routes_helper_id on public.routes(helper_id);
create index if not exists idx_routes_conferente_id on public.routes(conferente_id);
