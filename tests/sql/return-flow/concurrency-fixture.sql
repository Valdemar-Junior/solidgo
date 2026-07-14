\set ON_ERROR_STOP on

with o as (
  insert into public.orders (order_id_erp, status)
  values ('CONCORRENCIA-BASE', 'delivered') returning id
), delivery_route as (
  insert into public.routes (name, status, completed_at, created_at)
  values ('CONCORRENCIA ENTREGA', 'completed', now() - interval '2 hours', now() - interval '4 hours')
  returning id
), delivery_ro as (
  insert into public.route_orders (route_id, order_id, status, delivered_at, created_at)
  select delivery_route.id, o.id, 'delivered', now() - interval '2 hours', now() - interval '4 hours'
  from delivery_route, o
), item as (
  insert into public.order_items (order_id, source_line_key, product_name, purchased_quantity)
  select id, 'a', 'Produto A', 1 from o returning id, order_id
), ret as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date, processing_status
  ) select order_id, 'conc-return', 'CONC-NF', now(), 'processed' from item returning id
)
insert into public.order_return_items (return_id, order_item_id, source_item_key, returned_quantity)
select ret.id, item.id, 'a', 1 from ret, item;

with source_return as (
  select id, order_id from public.order_returns where external_key = 'conc-return'
), pickup_order as (
  insert into public.orders (order_id_erp, status, raw_json)
  select candidate.order_erp, 'pending', jsonb_build_object(
    'pickup_context', jsonb_build_object(
      'source_return_id', source_return.id,
      'source_order_id', source_return.order_id
    )
  )
  from source_return
  cross join (values ('CONC-COLETA-A'), ('CONC-COLETA-B')) candidate(order_erp)
  returning id, order_id_erp
), pickup_route as (
  insert into public.routes (name, status)
  values ('COLETA-CONCORRENCIA-A', 'pending'), ('COLETA-CONCORRENCIA-B', 'pending')
  returning id, name
)
insert into public.route_orders (route_id, order_id, status)
select pickup_route.id, pickup_order.id, 'pending'
from pickup_order
join pickup_route on right(pickup_order.order_id_erp, 1) = right(pickup_route.name, 1);
