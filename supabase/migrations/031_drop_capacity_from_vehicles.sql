-- Drop unused capacity column from vehicles table
alter table public.vehicles drop column if exists capacity;

