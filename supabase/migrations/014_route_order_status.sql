alter table public.orders add column if not exists status text default 'pending' not null;
alter table public.routes add column if not exists status text default 'pending' not null;

