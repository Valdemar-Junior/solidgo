-- Remove incorrect foreign keys from routes
alter table public.routes drop constraint if exists routes_team_id_fkey;
alter table public.routes drop constraint if exists routes_helper_id_fkey;

-- Drop incorrect tables
drop table if exists public.teams cascade;
drop table if exists public.helpers cascade;

-- Add correct foreign keys to routes
-- helper_id now references users (helpers are users with role='helper')
alter table public.routes 
  add constraint routes_helper_id_fkey 
  foreign key (helper_id) references public.users(id) on delete set null;

-- team_id now references teams_user
alter table public.routes 
  add constraint routes_team_id_fkey 
  foreign key (team_id) references public.teams_user(id) on delete set null;
