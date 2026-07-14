\set ON_ERROR_STOP on

truncate public.route_order_items, public.order_return_items, public.order_returns,
  public.order_items, public.route_orders, public.routes, public.orders restart identity cascade;

-- S1: devolução total antes do início deve impedir a rota.
with o as (
  insert into public.orders (order_id_erp, status)
  values ('START-TOTAL', 'assigned') returning id
), item as (
  insert into public.order_items (order_id, source_line_key, product_name, purchased_quantity)
  select id, 'a', 'Produto A', 1 from o returning id, order_id
), ret as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date, processing_status
  ) select order_id, 'start-total-return', 'START-NF', now(), 'processed' from item returning id
), return_item as (
  insert into public.order_return_items (return_id, order_item_id, source_item_key, returned_quantity)
  select ret.id, item.id, 'a', 1 from ret, item
), rt as (
  insert into public.routes (name, status)
  values ('START ROTA TOTAL', 'pending') returning id
)
insert into public.route_orders (route_id, order_id, status)
select rt.id, o.id, 'pending' from rt, o;

do $test$
declare v_rejected boolean := false;
begin
  begin
    update public.routes set status = 'in_progress' where name = 'START ROTA TOTAL';
  exception when others then
    v_rejected := true;
  end;
  perform public.test_assert(v_rejected, 'S1: rota com pedido totalmente devolvido não inicia');
end;
$test$;

select public.test_assert(
  (select status = 'pending' from public.routes where name = 'START ROTA TOTAL'),
  'S1: rota permanece pendente depois da tentativa bloqueada'
);

-- S2: devolução parcial permite iniciar com o saldo restante.
with o as (
  insert into public.orders (order_id_erp, status)
  values ('START-PARCIAL', 'assigned') returning id
), a as (
  insert into public.order_items (order_id, source_line_key, product_name, purchased_quantity)
  select id, 'a', 'Produto A', 1 from o returning id, order_id
), b as (
  insert into public.order_items (order_id, source_line_key, product_name, purchased_quantity)
  select id, 'b', 'Produto B', 1 from o returning id
), ret as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date, processing_status
  ) select order_id, 'start-partial-return', 'START-P-NF', now(), 'processed' from a returning id
), return_item as (
  insert into public.order_return_items (return_id, order_item_id, source_item_key, returned_quantity)
  select ret.id, a.id, 'a', 1 from ret, a
), rt as (
  insert into public.routes (name, status)
  values ('START ROTA PARCIAL', 'pending') returning id
)
insert into public.route_orders (route_id, order_id, status)
select rt.id, o.id, 'pending' from rt, o;

update public.routes set status = 'in_progress' where name = 'START ROTA PARCIAL';

select public.test_assert(
  (select status = 'in_progress' from public.routes where name = 'START ROTA PARCIAL'),
  'S2: rota com devolução parcial e saldo restante pode iniciar'
);
