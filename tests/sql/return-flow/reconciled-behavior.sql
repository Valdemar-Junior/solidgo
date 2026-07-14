\set ON_ERROR_STOP on

truncate public.route_order_items, public.order_return_items, public.order_returns,
  public.order_items, public.route_orders, public.routes, public.orders restart identity cascade;

-- 1. Motorista marcou Entregue; devolução chegou depois; rota ainda aberta.
with o as (
  insert into public.orders (order_id_erp, status)
  values ('T1-ENTREGUE-DEPOIS-DEV', 'delivered') returning id
), rt as (
  insert into public.routes (name, status, created_at)
  values ('T1 ROTA', 'in_progress', now() - interval '2 hours') returning id
), ro as (
  insert into public.route_orders (route_id, order_id, status, delivered_at, created_at)
  select rt.id, o.id, 'delivered', now() - interval '30 minutes', now() - interval '2 hours'
  from rt, o returning id, route_id, order_id
), oi as (
  insert into public.order_items (order_id, source_line_key, product_name, purchased_quantity)
  select id, 'a', 'Produto A', 1 from o returning id, order_id
), roi as (
  insert into public.route_order_items (
    route_order_id, route_id, order_id, order_item_id, source_line_key,
    delivered_quantity, status
  )
  select ro.id, ro.route_id, ro.order_id, oi.id, 'a', 1, 'delivered' from ro, oi
), ret as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date, processing_status, reason
  )
  select order_id, 't1-dev', 'T1-NF', now(), 'processed', 'Devolução após marcar entregue'
  from oi returning id
)
insert into public.order_return_items (return_id, order_item_id, source_item_key, returned_quantity)
select ret.id, oi.id, 'a', 1 from ret, oi;

select public.reconcile_order_return_state(
  (select id from public.orders where order_id_erp = 'T1-ENTREGUE-DEPOIS-DEV')
);

select public.test_assert(
  not (select requires_pickup from public.orders where order_id_erp = 'T1-ENTREGUE-DEPOIS-DEV'),
  'T1: rota aberta apenas bloqueia e avisa; ainda não cria pendência de coleta'
);

update public.routes set status = 'completed', completed_at = now()
where name = 'T1 ROTA';

select public.test_assert(
  (select requires_pickup from public.orders where order_id_erp = 'T1-ENTREGUE-DEPOIS-DEV'),
  'T1: finalizar rota como entregue cria a pendência de coleta automaticamente'
);

-- 2. O motorista desfez Entregue e terminou o pedido como Retornado.
with o as (
  insert into public.orders (order_id_erp, status)
  values ('T2-DESFEZ', 'pending') returning id
), rt as (
  insert into public.routes (name, status, created_at)
  values ('T2 ROTA', 'in_progress', now() - interval '2 hours') returning id
), ro as (
  insert into public.route_orders (route_id, order_id, status, returned_at, created_at)
  select rt.id, o.id, 'returned', now(), now() - interval '2 hours'
  from rt, o returning id, route_id, order_id
), oi as (
  insert into public.order_items (order_id, source_line_key, product_name, purchased_quantity)
  select id, 'a', 'Produto A', 1 from o returning id, order_id
), roi as (
  insert into public.route_order_items (
    route_order_id, route_id, order_id, order_item_id, source_line_key,
    returned_quantity, status
  )
  select ro.id, ro.route_id, ro.order_id, oi.id, 'a', 1, 'returned' from ro, oi
), ret as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date, processing_status, reason
  )
  select order_id, 't2-dev', 'T2-NF', now() - interval '1 hour', 'processed', 'Devolução durante rota'
  from oi returning id
)
insert into public.order_return_items (return_id, order_item_id, source_item_key, returned_quantity)
select ret.id, oi.id, 'a', 1 from ret, oi;

update public.routes set status = 'completed', completed_at = now()
where name = 'T2 ROTA';

select public.test_assert(
  not (select requires_pickup from public.orders where order_id_erp = 'T2-DESFEZ'),
  'T2: pedido finalizado como retornado pelo motorista não gera coleta'
);

-- 3. Produto A devolvido antes da rota; somente o produto B foi entregue.
with o as (
  insert into public.orders (order_id_erp, status)
  values ('T3-DEV-ANTES', 'pending') returning id
), a as (
  insert into public.order_items (order_id, source_line_key, product_name, purchased_quantity)
  select id, 'a', 'Produto A', 1 from o returning id, order_id
), b as (
  insert into public.order_items (order_id, source_line_key, product_name, purchased_quantity)
  select id, 'b', 'Produto B', 1 from o returning id, order_id
), ret as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date, processing_status, reason, created_at
  )
  select order_id, 't3-dev', 'T3-NF', now() - interval '3 hours', 'processed',
    'Devolução antes da rota', now() - interval '3 hours'
  from a returning id
)
insert into public.order_return_items (return_id, order_item_id, source_item_key, returned_quantity)
select ret.id, a.id, 'a', 1 from ret, a;

with o as (
  select id from public.orders where order_id_erp = 'T3-DEV-ANTES'
), rt as (
  insert into public.routes (name, status, created_at)
  values ('T3 ROTA', 'in_progress', now() - interval '2 hours') returning id
), ro as (
  insert into public.route_orders (route_id, order_id, status, delivered_at, created_at)
  select rt.id, o.id, 'delivered', now(), now() - interval '2 hours'
  from rt, o returning id, route_id, order_id
), items as (
  select oi.* from public.order_items oi join o on o.id = oi.order_id
)
insert into public.route_order_items (
  route_order_id, route_id, order_id, order_item_id, source_line_key,
  delivered_quantity, returned_quantity, status
)
select ro.id, ro.route_id, ro.order_id, items.id, items.source_line_key,
  case when items.source_line_key = 'b' then 1 else 0 end,
  case when items.source_line_key = 'a' then 1 else 0 end,
  case when items.source_line_key = 'b' then 'delivered' else 'returned' end
from ro, items;

update public.orders set status = 'delivered' where order_id_erp = 'T3-DEV-ANTES';
update public.routes set status = 'completed', completed_at = now() where name = 'T3 ROTA';

select public.test_assert(
  not (select requires_pickup from public.orders where order_id_erp = 'T3-DEV-ANTES'),
  'T3: devolver A antes da rota e entregar B não cria coleta para A'
);

-- 4. Devolução chegou durante a rota antes da marcação; A ficou bloqueado e B foi entregue.
with o as (
  insert into public.orders (order_id_erp, status)
  values ('T4-BLOQUEADO-DURANTE', 'pending') returning id
), rt as (
  insert into public.routes (name, status, created_at)
  values ('T4 ROTA', 'in_progress', now() - interval '2 hours') returning id
), ro as (
  insert into public.route_orders (route_id, order_id, status, delivered_at, created_at)
  select rt.id, o.id, 'delivered', now(), now() - interval '2 hours'
  from rt, o returning id, route_id, order_id
), a as (
  insert into public.order_items (order_id, source_line_key, product_name, purchased_quantity)
  select id, 'a', 'Produto A', 1 from o returning id, order_id
), b as (
  insert into public.order_items (order_id, source_line_key, product_name, purchased_quantity)
  select id, 'b', 'Produto B', 1 from o returning id
), roi_a as (
  insert into public.route_order_items (
    route_order_id, route_id, order_id, order_item_id, source_line_key, returned_quantity, status
  )
  select ro.id, ro.route_id, ro.order_id, a.id, 'a', 1, 'returned' from ro, a
), roi_b as (
  insert into public.route_order_items (
    route_order_id, route_id, order_id, order_item_id, source_line_key, delivered_quantity, status
  )
  select ro.id, ro.route_id, ro.order_id, b.id, 'b', 1, 'delivered' from ro, b
), ret as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date, processing_status, reason
  )
  select order_id, 't4-dev', 'T4-NF', now() - interval '1 hour', 'processed', 'A bloqueado durante rota'
  from a returning id
)
insert into public.order_return_items (return_id, order_item_id, source_item_key, returned_quantity)
select ret.id, a.id, 'a', 1 from ret, a;

update public.orders set status = 'delivered' where order_id_erp = 'T4-BLOQUEADO-DURANTE';
update public.routes set status = 'completed', completed_at = now() where name = 'T4 ROTA';

select public.test_assert(
  not (select requires_pickup from public.orders where order_id_erp = 'T4-BLOQUEADO-DURANTE'),
  'T4: item bloqueado durante a rota não vira coleta quando somente o outro item foi entregue'
);

-- 5. Uma sincronização antiga apaga o aviso; o reconciliador deve restaurá-lo.
update public.orders
set return_flag = false, blocked_reason = null, last_return_reason = null
where order_id_erp = 'T1-ENTREGUE-DEPOIS-DEV';

select public.reconcile_order_return_state(
  (select id from public.orders where order_id_erp = 'T1-ENTREGUE-DEPOIS-DEV')
);

select public.test_assert(
  (select return_flag from public.orders where order_id_erp = 'T1-ENTREGUE-DEPOIS-DEV'),
  'T5: sincronização offline não consegue apagar definitivamente a devolução fiscal'
);

-- 6. Sem devolução fiscal, desfazer o retorno do motorista limpa o retorno operacional.
insert into public.orders (
  order_id_erp, status, return_flag, blocked_reason, last_return_reason
)
values (
  'T6-SO-RETORNO-MOTORISTA', 'assigned', true, 'Retornado pelo motorista', 'Cliente ausente'
);

select public.reconcile_order_return_state(
  (select id from public.orders where order_id_erp = 'T6-SO-RETORNO-MOTORISTA')
);

select public.test_assert(
  not (select return_flag from public.orders where order_id_erp = 'T6-SO-RETORNO-MOTORISTA'),
  'T6: desfazer retorno do motorista continua funcionando quando não existe devolução fiscal'
);

-- 7. Duas devoluções depois da entrega geram duas coletas independentes.
with o as (
  insert into public.orders (order_id_erp, status)
  values ('T7-DUAS-COLETAS', 'delivered') returning id
), rt as (
  insert into public.routes (name, status, completed_at, created_at)
  values ('T7 ROTA ENTREGA', 'completed', now() - interval '2 hours', now() - interval '4 hours')
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
), roi_b as (
  insert into public.route_order_items (
    route_order_id, route_id, order_id, order_item_id, source_line_key, delivered_quantity, status
  )
  select ro.id, ro.route_id, ro.order_id, b.id, 'b', 1, 'delivered' from ro, b
), ret_a as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date, processing_status, reason
  )
  select order_id, 't7-dev-a', 'T7-NF-A', now() - interval '1 hour', 'processed', 'Devolução A'
  from a returning id
), ret_b as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date, processing_status, reason
  )
  select order_id, 't7-dev-b', 'T7-NF-B', now(), 'processed', 'Devolução B'
  from a returning id
), item_a as (
  insert into public.order_return_items (return_id, order_item_id, source_item_key, returned_quantity)
  select ret_a.id, a.id, 'a', 1 from ret_a, a
)
insert into public.order_return_items (return_id, order_item_id, source_item_key, returned_quantity)
select ret_b.id, b.id, 'b', 1 from ret_b, b;

select public.reconcile_order_return_state(
  (select id from public.orders where order_id_erp = 'T7-DUAS-COLETAS')
);

select public.test_assert(
  (select count(*) = 2 from public.order_returns r
    join public.orders o on o.id = r.order_id
    where o.order_id_erp = 'T7-DUAS-COLETAS' and r.requires_pickup),
  'T7: os dois eventos entram separadamente em coletas pendentes'
);

with source_return as (
  select r.id, r.order_id
  from public.order_returns r join public.orders o on o.id = r.order_id
  where o.order_id_erp = 'T7-DUAS-COLETAS' and r.external_key = 't7-dev-a'
), pickup_order as (
  insert into public.orders (order_id_erp, status, raw_json)
  select 'T7-COLETA-A', 'pending', jsonb_build_object(
    'pickup_context', jsonb_build_object(
      'source_return_id', source_return.id,
      'source_order_id', source_return.order_id
    )
  ) from source_return
  returning id
), pickup_route as (
  insert into public.routes (name, status)
  values ('COLETA-T7-A', 'pending') returning id
), linked as (
  insert into public.route_orders (route_id, order_id, status)
  select pickup_route.id, pickup_order.id, 'pending' from pickup_route, pickup_order
  returning id
)
select public.register_order_return_pickup(
  (select r.id from public.order_returns r join public.orders o on o.id = r.order_id
    where o.order_id_erp = 'T7-DUAS-COLETAS' and r.external_key = 't7-dev-a'),
  pickup_order.id,
  pickup_route.id
)
from pickup_order, pickup_route, linked;

select public.test_assert(
  (select requires_pickup from public.orders where order_id_erp = 'T7-DUAS-COLETAS'),
  'T7: depois da primeira coleta o segundo evento continua pendente'
);

with source_return as (
  select r.id, r.order_id
  from public.order_returns r join public.orders o on o.id = r.order_id
  where o.order_id_erp = 'T7-DUAS-COLETAS' and r.external_key = 't7-dev-b'
), pickup_order as (
  insert into public.orders (order_id_erp, status, raw_json)
  select 'T7-COLETA-B', 'pending', jsonb_build_object(
    'pickup_context', jsonb_build_object(
      'source_return_id', source_return.id,
      'source_order_id', source_return.order_id
    )
  ) from source_return
  returning id
), pickup_route as (
  insert into public.routes (name, status)
  values ('COLETA-T7-B', 'pending') returning id
), linked as (
  insert into public.route_orders (route_id, order_id, status)
  select pickup_route.id, pickup_order.id, 'pending' from pickup_route, pickup_order
  returning id
)
select public.register_order_return_pickup(
  (select r.id from public.order_returns r join public.orders o on o.id = r.order_id
    where o.order_id_erp = 'T7-DUAS-COLETAS' and r.external_key = 't7-dev-b'),
  pickup_order.id,
  pickup_route.id
)
from pickup_order, pickup_route, linked;

select public.test_assert(
  not (select requires_pickup from public.orders where order_id_erp = 'T7-DUAS-COLETAS'),
  'T7: depois das duas coletas não sobra evento pendente'
);

-- 8. Duas unidades iguais: uma devolvida antes da marcação e a outra entregue.
with o as (
  insert into public.orders (order_id_erp, status)
  values ('T8-QTD-PARCIAL', 'pending') returning id
), rt as (
  insert into public.routes (name, status, created_at)
  values ('T8 ROTA', 'in_progress', now() - interval '2 hours') returning id
), ro as (
  insert into public.route_orders (route_id, order_id, status, delivered_at, created_at)
  select rt.id, o.id, 'delivered', now(), now() - interval '2 hours'
  from rt, o returning id, route_id, order_id
), item as (
  insert into public.order_items (order_id, source_line_key, product_name, purchased_quantity)
  select id, 'produto-2-unidades', 'Produto com duas unidades', 2 from o
  returning id, order_id, source_line_key
), roi as (
  insert into public.route_order_items (
    route_order_id, route_id, order_id, order_item_id, source_line_key, delivered_quantity, status
  )
  select ro.id, ro.route_id, ro.order_id, item.id, item.source_line_key, 1, 'delivered'
  from ro, item
), ret as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date, processing_status
  )
  select order_id, 't8-dev', 'T8-NF', now() - interval '1 hour', 'processed'
  from item returning id
)
insert into public.order_return_items (return_id, order_item_id, source_item_key, returned_quantity)
select ret.id, item.id, item.source_line_key, 1 from ret, item;

update public.orders set status = 'delivered' where order_id_erp = 'T8-QTD-PARCIAL';
update public.routes set status = 'completed', completed_at = now() where name = 'T8 ROTA';

select public.test_assert(
  not (select requires_pickup from public.orders where order_id_erp = 'T8-QTD-PARCIAL'),
  'T8: devolver uma unidade e entregar somente a unidade restante não gera coleta indevida'
);
