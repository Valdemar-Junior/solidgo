create extension if not exists pgcrypto;

do $$ begin
  create role authenticated;
exception when duplicate_object then null;
end $$;

do $$ begin
  create role service_role;
exception when duplicate_object then null;
end $$;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_id_erp text not null unique,
  status text not null default 'pending',
  return_flag boolean not null default false,
  requires_pickup boolean not null default false,
  pickup_created_at timestamptz,
  blocked_at timestamptz,
  blocked_reason text,
  last_return_reason text,
  last_return_notes text,
  return_nfe_number text,
  return_nfe_key text,
  return_nfe_xml text,
  return_date timestamptz,
  return_type text,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  route_code text,
  status text not null default 'pending',
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.route_orders (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  sequence integer not null default 1,
  status text not null default 'pending',
  delivered_at timestamptz,
  returned_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (route_id, order_id)
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  source_line_key text not null,
  product_name text not null,
  purchased_quantity numeric(12, 3) not null,
  source_present boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  unique (order_id, source_line_key)
);

create table public.order_returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  external_key text,
  return_nfe_number text,
  return_nfe_key text,
  return_date timestamptz,
  return_type text,
  return_xml text,
  reason text,
  processing_status text not null default 'pending',
  processing_notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (order_id, external_key)
);

create table public.order_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.order_returns(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete restrict,
  source_item_key text not null,
  returned_quantity numeric(12, 3) not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (return_id, source_item_key)
);

create table public.route_order_items (
  id uuid primary key default gen_random_uuid(),
  route_order_id uuid not null references public.route_orders(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete set null,
  source_line_key text not null,
  delivered_quantity numeric(12, 3) not null default 0,
  returned_quantity numeric(12, 3) not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (route_order_id, source_line_key)
);

create table public.item_fulfillment_sync_issues (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete set null,
  issue_type text not null,
  issue_key text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  detected_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  resolved_by uuid,
  unique (order_id, issue_type, issue_key)
);

create or replace view public.order_item_shadow_balances as
select
  oi.id as order_item_id,
  oi.order_id,
  oi.source_line_key,
  oi.source_present,
  oi.purchased_quantity,
  coalesce(ret.returned_quantity, 0::numeric) as returned_quantity,
  greatest(oi.purchased_quantity - coalesce(ret.returned_quantity, 0::numeric), 0::numeric) as shadow_deliverable_quantity,
  coalesce(ret.returned_quantity, 0::numeric) > oi.purchased_quantity as has_over_return
from public.order_items oi
left join (
  select ori.order_item_id, sum(ori.returned_quantity) as returned_quantity
  from public.order_return_items ori
  join public.order_returns r on r.id = ori.return_id
  where r.processing_status = 'processed'
  group by ori.order_item_id
) ret on ret.order_item_id = oi.id;

create or replace function public.item_fulfillment_can_manage()
returns boolean language sql stable as $$ select true $$;

create or replace function public.test_assert(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'FALHOU: %', p_message;
  end if;
  raise notice 'PASSOU: %', p_message;
end;
$$;
