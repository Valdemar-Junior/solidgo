\set ON_ERROR_STOP on

with o as (
  insert into public.orders (order_id_erp, status)
  values ('UPGRADE-BASE', 'delivered') returning id
), item as (
  insert into public.order_items (order_id, source_line_key, product_name, purchased_quantity)
  select id, 'a', 'Produto A', 1 from o returning id, order_id
), r1 as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date, processing_status
  ) select order_id, 'upgrade-r1', 'UP-1', now() - interval '2 hours', 'processed' from item
  returning id
), r2 as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date, processing_status
  ) select order_id, 'upgrade-r2', 'UP-2', now() - interval '1 hour', 'processed' from item
  returning id
), r3 as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date, processing_status
  ) select order_id, 'upgrade-partial-link', 'UP-3', now(), 'processed' from item
  returning id
), i1 as (
  insert into public.order_return_items (return_id, order_item_id, source_item_key, returned_quantity)
  select r1.id, item.id, 'a', 1 from r1, item
)
insert into public.order_return_items (return_id, order_item_id, source_item_key, returned_quantity)
select r2.id, item.id, 'a', 1 from r2, item;

with pickup_order as (
  insert into public.orders (order_id_erp, status)
  values ('UPGRADE-PICKUP', 'pending') returning id
), pickup_route as (
  insert into public.routes (name, status)
  values ('COLETA-UPGRADE', 'pending') returning id
)
update public.order_returns
set
  pickup_created_at = now(),
  pickup_order_id = pickup_order.id,
  pickup_route_id = pickup_route.id
from pickup_order, pickup_route
where external_key in ('upgrade-r1', 'upgrade-r2');

update public.order_returns
set pickup_created_at = now()
where external_key = 'upgrade-partial-link';
