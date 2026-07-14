\set ON_ERROR_STOP on

truncate public.route_order_items, public.order_return_items, public.order_returns,
  public.order_items, public.route_orders, public.routes, public.orders restart identity cascade;

-- Base: pedido entregue, com dois produtos, apto a gerar coleta por evento.
with o as (
  insert into public.orders (order_id_erp, status)
  values ('BRECHAS-BASE', 'delivered') returning id
), rt as (
  insert into public.routes (name, status, completed_at, created_at)
  values ('BRECHAS ROTA ENTREGA', 'completed', now() - interval '2 hours', now() - interval '4 hours')
  returning id
), ro as (
  insert into public.route_orders (route_id, order_id, status, delivered_at, created_at)
  select rt.id, o.id, 'delivered', now() - interval '2 hours', now() - interval '4 hours'
  from rt, o returning id, route_id, order_id
), a as (
  insert into public.order_items (order_id, source_line_key, product_name, purchased_quantity)
  select id, 'a', 'Produto A', 1 from o returning id, order_id
), b as (
  insert into public.order_items (order_id, source_line_key, product_name, purchased_quantity)
  select id, 'b', 'Produto B', 1 from o returning id
), roi_a as (
  insert into public.route_order_items (
    route_order_id, route_id, order_id, order_item_id, source_line_key, delivered_quantity, status
  )
  select ro.id, ro.route_id, ro.order_id, a.id, 'a', 1, 'delivered' from ro, a
)
insert into public.route_order_items (
  route_order_id, route_id, order_id, order_item_id, source_line_key, delivered_quantity, status
)
select ro.id, ro.route_id, ro.order_id, b.id, 'b', 1, 'delivered' from ro, b;

-- Brecha 1: duas devoluções de 1 unidade para um produto comprado com quantidade 1.
with o as (
  select id from public.orders where order_id_erp = 'BRECHAS-BASE'
), a as (
  select oi.id, oi.order_id from public.order_items oi join o on o.id = oi.order_id
  where oi.source_line_key = 'a'
), r1 as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date, processing_status
  )
  select order_id, 'over-1', 'OVER-1', now() - interval '1 hour', 'processed' from a
  returning id
), r2 as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date, processing_status
  )
  select order_id, 'over-2', 'OVER-2', now(), 'processed' from a
  returning id
), i1 as (
  insert into public.order_return_items (return_id, order_item_id, source_item_key, returned_quantity)
  select r1.id, a.id, 'a', 1 from r1, a
)
insert into public.order_return_items (return_id, order_item_id, source_item_key, returned_quantity)
select r2.id, a.id, 'a', 1 from r2, a;

select public.test_assert(
  (select has_over_return from public.order_item_shadow_balances
    where order_id = (select id from public.orders where order_id_erp = 'BRECHAS-BASE')
      and source_line_key = 'a'),
  'REPRODUZIDA: o banco aceita devolução maior que a quantidade comprada'
);

-- Brecha 2: vincular uma devolução a qualquer pedido/rota, sem comprovar origem.
with pickup_order as (
  insert into public.orders (order_id_erp, status, raw_json)
  values ('COLETA-ERRADA', 'pending', '{}'::jsonb) returning id
), pickup_route as (
  insert into public.routes (name, status)
  values ('ROTA NORMAL ERRADA', 'pending') returning id
), linked as (
  insert into public.route_orders (route_id, order_id, status)
  select pickup_route.id, pickup_order.id, 'pending' from pickup_route, pickup_order
)
select public.register_order_return_pickup(
  (select r.id from public.order_returns r where r.external_key = 'over-1'),
  pickup_order.id,
  pickup_route.id
)
from pickup_order, pickup_route;

select public.test_assert(
  (select pickup_order_id is not null from public.order_returns where external_key = 'over-1'),
  'REPRODUZIDA: evento aceita pedido e rota que não comprovam pertencer à devolução'
);

-- Brecha 3: outra devolução consegue reutilizar exatamente a mesma coleta.
select public.register_order_return_pickup(
  (select r.id from public.order_returns r where r.external_key = 'over-2'),
  (select id from public.orders where order_id_erp = 'COLETA-ERRADA'),
  (select id from public.routes where name = 'ROTA NORMAL ERRADA')
);

select public.test_assert(
  (select count(*) = 2 from public.order_returns
    where pickup_order_id = (select id from public.orders where order_id_erp = 'COLETA-ERRADA')),
  'REPRODUZIDA: duas devoluções aceitam a mesma coleta'
);

-- Brecha 4: excluir a rota deixa data/pedido preenchidos, mas rota nula.
delete from public.routes where name = 'ROTA NORMAL ERRADA';

select public.test_assert(
  (select bool_and(pickup_created_at is not null and pickup_order_id is not null and pickup_route_id is null)
   from public.order_returns where external_key in ('over-1', 'over-2')),
  'REPRODUZIDA: exclusão da rota deixa vínculo parcial e eventos fora da fila normal'
);
