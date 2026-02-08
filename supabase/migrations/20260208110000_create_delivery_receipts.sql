-- Create delivery_receipts table (proof-of-delivery shadow data)
create table if not exists public.delivery_receipts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete cascade,
  route_order_id uuid not null references public.route_orders(id) on delete cascade,
  delivered_by_user_id uuid references auth.users(id) on delete set null,
  delivered_at_server timestamptz not null default timezone('utc', now()),
  device_timestamp timestamptz,
  gps_lat numeric(10,7),
  gps_lng numeric(10,7),
  gps_accuracy_m numeric(8,2),
  gps_status text not null default 'ok' check (gps_status in ('ok', 'failed')),
  gps_failure_reason text,
  recipient_name text,
  recipient_relation text,
  recipient_notes text,
  photo_count integer not null default 0 check (photo_count >= 0),
  photo_refs jsonb not null default '[]'::jsonb,
  network_mode text not null default 'online' check (network_mode in ('online', 'offline')),
  device_info jsonb not null default '{}'::jsonb,
  app_version text,
  sync_status text not null default 'synced' check (sync_status in ('pending_sync', 'synced', 'failed')),
  proof_hash text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint delivery_receipts_gps_pair check (
    (gps_lat is null and gps_lng is null) or
    (gps_lat is not null and gps_lng is not null)
  )
);

comment on table public.delivery_receipts is 'Comprovacao digital de entrega (modo paralelo/sombra).';

-- Enable RLS now; policies will be added in TASK-03
alter table public.delivery_receipts enable row level security;

-- Indexes for lookup/reporting
create index if not exists idx_delivery_receipts_order_id on public.delivery_receipts(order_id);
create index if not exists idx_delivery_receipts_route_id on public.delivery_receipts(route_id);
create index if not exists idx_delivery_receipts_route_order_id on public.delivery_receipts(route_order_id);
create index if not exists idx_delivery_receipts_delivered_at_server on public.delivery_receipts(delivered_at_server desc);
create index if not exists idx_delivery_receipts_gps_status on public.delivery_receipts(gps_status);

