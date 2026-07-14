\set ON_ERROR_STOP on

truncate public.order_return_items, public.order_returns, public.order_items,
  public.route_orders, public.routes, public.orders restart identity cascade;

-- Cenário 1: devolução chega enquanto a rota está aberta.
with o as (
  insert into public.orders (order_id_erp, status)
  values ('TESTE-ROTA-ABERTA', 'delivered') returning id
), rt as (
  insert into public.routes (name, status)
  values ('ROTA TESTE ABERTA', 'in_progress') returning id
), ro as (
  insert into public.route_orders (route_id, order_id, status, delivered_at)
  select rt.id, o.id, 'delivered', now() from rt, o
), oi as (
  insert into public.order_items (order_id, source_line_key, product_name, purchased_quantity)
  select id, 'produto-a', 'Produto A', 1 from o returning id, order_id
), r as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date,
    processing_status, reason
  )
  select order_id, 'dev-a', 'NF-A', now(), 'processed', 'Devolução A' from oi
  returning id
)
insert into public.order_return_items (return_id, order_item_id, source_item_key, returned_quantity)
select r.id, oi.id, 'produto-a', 1 from r, oi;

select public.sync_order_return_operational_state(
  (select id from public.orders where order_id_erp = 'TESTE-ROTA-ABERTA')
);

select public.test_assert(
  not (select requires_pickup from public.orders where order_id_erp = 'TESTE-ROTA-ABERTA'),
  'rota aberta não envia a devolução para coletas pendentes'
);

-- O encerramento atual muda a rota, mas não chama o recálculo.
update public.routes
set status = 'completed', completed_at = now()
where name = 'ROTA TESTE ABERTA';

select public.test_assert(
  not (select requires_pickup from public.orders where order_id_erp = 'TESTE-ROTA-ABERTA'),
  'reprodução do defeito: encerrar a rota sozinho não recalcula a coleta'
);

-- Ao chamar o recálculo no fim, a coleta passa a ser reconhecida.
select public.sync_order_return_operational_state(
  (select id from public.orders where order_id_erp = 'TESTE-ROTA-ABERTA')
);

select public.test_assert(
  (select requires_pickup from public.orders where order_id_erp = 'TESTE-ROTA-ABERTA'),
  'recalcular depois do encerramento reconhece a coleta necessária'
);

-- Cenário 2: a confirmação offline antiga apaga o aviso fiscal.
update public.orders
set return_flag = false, last_return_reason = null, last_return_notes = null
where order_id_erp = 'TESTE-ROTA-ABERTA';

select public.test_assert(
  not (select return_flag from public.orders where order_id_erp = 'TESTE-ROTA-ABERTA'),
  'reprodução do defeito: sincronização antiga consegue apagar o aviso fiscal'
);

select public.sync_order_return_operational_state(
  (select id from public.orders where order_id_erp = 'TESTE-ROTA-ABERTA')
);

select public.test_assert(
  (select return_flag from public.orders where order_id_erp = 'TESTE-ROTA-ABERTA'),
  'recalcular por último restaura o aviso fiscal'
);

-- Cenário 3: motorista desfaz e termina como retornado; não deve haver coleta.
update public.routes
set status = 'in_progress', completed_at = null
where name = 'ROTA TESTE ABERTA';

update public.route_orders
set status = 'returned', delivered_at = null, returned_at = now()
where order_id = (select id from public.orders where order_id_erp = 'TESTE-ROTA-ABERTA');

update public.orders
set status = 'pending'
where order_id_erp = 'TESTE-ROTA-ABERTA';

update public.routes
set status = 'completed', completed_at = now()
where name = 'ROTA TESTE ABERTA';

select public.sync_order_return_operational_state(
  (select id from public.orders where order_id_erp = 'TESTE-ROTA-ABERTA')
);

select public.test_assert(
  not (select requires_pickup from public.orders where order_id_erp = 'TESTE-ROTA-ABERTA'),
  'pedido finalizado como retornado pelo motorista não gera coleta'
);

-- Cenário 4: devolução anterior à rota não pode virar coleta só porque outro item foi entregue.
with o as (
  insert into public.orders (order_id_erp, status)
  values ('TESTE-DEV-ANTES', 'pending') returning id
), a as (
  insert into public.order_items (order_id, source_line_key, product_name, purchased_quantity)
  select id, 'produto-a', 'Produto A', 1 from o returning id, order_id
), b as (
  insert into public.order_items (order_id, source_line_key, product_name, purchased_quantity)
  select id, 'produto-b', 'Produto B', 1 from o returning id
), r as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date,
    processing_status, reason, created_at
  )
  select order_id, 'dev-antes', 'NF-ANTES', now() - interval '2 hours',
    'processed', 'Devolução antes da rota', now() - interval '2 hours'
  from a returning id
)
insert into public.order_return_items (return_id, order_item_id, source_item_key, returned_quantity)
select r.id, a.id, 'produto-a', 1 from r, a;

with o as (
  select id from public.orders where order_id_erp = 'TESTE-DEV-ANTES'
), rt as (
  insert into public.routes (name, status, created_at)
  values ('ROTA APOS DEVOLUCAO', 'completed', now() - interval '1 hour') returning id
)
insert into public.route_orders (route_id, order_id, status, delivered_at, created_at)
select rt.id, o.id, 'delivered', now(), now() - interval '1 hour' from rt, o;

update public.orders set status = 'delivered'
where order_id_erp = 'TESTE-DEV-ANTES';

select public.sync_order_return_operational_state(
  (select id from public.orders where order_id_erp = 'TESTE-DEV-ANTES')
);

select public.test_assert(
  (select requires_pickup from public.orders where order_id_erp = 'TESTE-DEV-ANTES'),
  'reprodução do defeito: regra atual transforma devolução anterior à rota em coleta'
);
