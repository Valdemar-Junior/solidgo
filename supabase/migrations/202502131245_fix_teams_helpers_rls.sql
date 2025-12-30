-- Enable RLS on teams and helpers tables
alter table public.teams enable row level security;
alter table public.helpers enable row level security;

-- Policies for Teams
create policy "Teams are viewable by everyone" 
  on public.teams for select 
  using (true);

create policy "Teams are insertable by authenticated users" 
  on public.teams for insert 
  with check (auth.role() = 'authenticated');

create policy "Teams are updatable by authenticated users" 
  on public.teams for update 
  using (auth.role() = 'authenticated');

-- Policies for Helpers
create policy "Helpers are viewable by everyone" 
  on public.helpers for select 
  using (true);

create policy "Helpers are insertable by authenticated users" 
  on public.helpers for insert 
  with check (auth.role() = 'authenticated');

create policy "Helpers are updatable by authenticated users" 
  on public.helpers for update 
  using (auth.role() = 'authenticated');
