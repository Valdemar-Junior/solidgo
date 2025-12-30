-- Migration: Add team tracking columns to routes table
-- Description: Adds team_id and helper_id to routes table to snapshot the team composition at route creation time.

-- Add team_id column
alter table public.routes 
add column if not exists team_id uuid references public.teams(id) on delete set null;

-- Add helper_id column (Driver already exists as driver_id)
alter table public.routes 
add column if not exists helper_id uuid references public.helpers(id) on delete set null;

-- Add indexes for performance
create index if not exists idx_routes_team_id on public.routes(team_id);
create index if not exists idx_routes_helper_id on public.routes(helper_id);

-- Commentary:
-- driver_id is already present and remains the primary foreign key for app access (RLS).
-- team_id and helper_id are effectively snapshots for reporting purposes.
