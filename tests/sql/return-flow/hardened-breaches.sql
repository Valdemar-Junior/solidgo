\set ON_ERROR_STOP on

truncate public.route_order_items, public.order_return_items, public.order_returns,
  public.order_items, public.route_orders, public.routes, public.orders restart identity cascade;

-- Base entregue com dois produtos.
with o as (
  insert into public.orders (order_id_erp, status)
  values ('HARDEN-BASE', 'delivered') returning id
), rt as (
  insert into public.routes (name, status, completed_at, created_at)
  values ('HARDEN ROTA ENTREGA', 'completed', now() - interval '2 hours', now() - interval '4 hours')
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

-- H1: segunda devolução acima da compra deve virar divergência, sem contaminar saldo.
with a as (
  select * from public.order_items where source_line_key = 'a'
), r1 as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date, processing_status
  ) select order_id, 'h-over-1', 'H-OVER-1', now() - interval '1 hour', 'processed' from a
  returning id
), r2 as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date, processing_status
  ) select order_id, 'h-over-2', 'H-OVER-2', now(), 'processed' from a
  returning id
), i1 as (
  insert into public.order_return_items (return_id, order_item_id, source_item_key, returned_quantity)
  select r1.id, a.id, 'a', 1 from r1, a
)
insert into public.order_return_items (return_id, order_item_id, source_item_key, returned_quantity)
select r2.id, a.id, 'a', 1 from r2, a;

select public.test_assert(
  (select processing_status = 'divergent' from public.order_returns where external_key = 'h-over-2'),
  'H1: evento acima da quantidade comprada fica divergente'
);

select public.test_assert(
  (select returned_quantity = 1 and not has_over_return
   from public.order_item_shadow_balances where source_line_key = 'a'),
  'H1: evento divergente não reduz o saldo nem cria over-return operacional'
);

select public.test_assert(
  (select count(*) = 1 from public.item_fulfillment_sync_issues
   where issue_type = 'return_quantity_exceeded' and status = 'open'),
  'H1: divergência fica registrada para auditoria'
);

do $test$
declare v_rejected boolean := false;
begin
  begin
    update public.order_returns set processing_status = 'processed' where external_key = 'h-over-2';
  exception when others then
    v_rejected := true;
  end;
  perform public.test_assert(v_rejected, 'H1: evento excessivo não pode ser reprocessado sem correção');
end;
$test$;

-- H2: pedido/rota sem contexto de origem devem ser rejeitados.
with pickup_order as (
  insert into public.orders (order_id_erp, status, raw_json)
  values ('H-COLETA-ERRADA', 'pending', '{}'::jsonb) returning id
), pickup_route as (
  insert into public.routes (name, status)
  values ('ROTA NORMAL ERRADA', 'pending') returning id
)
insert into public.route_orders (route_id, order_id, status)
select pickup_route.id, pickup_order.id, 'pending' from pickup_route, pickup_order;

do $test$
declare v_rejected boolean := false;
begin
  begin
    perform public.register_order_return_pickup(
      (select id from public.order_returns where external_key = 'h-over-1'),
      (select id from public.orders where order_id_erp = 'H-COLETA-ERRADA'),
      (select id from public.routes where name = 'ROTA NORMAL ERRADA')
    );
  exception when others then
    v_rejected := true;
  end;
  perform public.test_assert(v_rejected, 'H2: coleta sem origem comprovada é rejeitada');
end;
$test$;

-- Cria uma coleta válida para o primeiro evento.
with source_return as (
  select id, order_id from public.order_returns where external_key = 'h-over-1'
), pickup_order as (
  insert into public.orders (order_id_erp, status, raw_json)
  select 'H-COLETA-VALIDA', 'pending', jsonb_build_object(
    'pickup_context', jsonb_build_object(
      'source_return_id', id,
      'source_order_id', order_id
    )
  ) from source_return returning id
), pickup_route as (
  insert into public.routes (name, status)
  values ('COLETA-H-VALIDA', 'pending') returning id
)
insert into public.route_orders (route_id, order_id, status)
select pickup_route.id, pickup_order.id, 'pending' from pickup_route, pickup_order;

select public.register_order_return_pickup(
  (select id from public.order_returns where external_key = 'h-over-1'),
  (select id from public.orders where order_id_erp = 'H-COLETA-VALIDA'),
  (select id from public.routes where name = 'COLETA-H-VALIDA')
);

select public.test_assert(
  (select pickup_created_at is not null from public.order_returns where external_key = 'h-over-1'),
  'H3: coleta com origem, pedido e rota corretos é aceita'
);

-- A mesma chamada é idempotente.
select public.register_order_return_pickup(
  (select id from public.order_returns where external_key = 'h-over-1'),
  (select id from public.orders where order_id_erp = 'H-COLETA-VALIDA'),
  (select id from public.routes where name = 'COLETA-H-VALIDA')
);

-- Outro evento válido não pode reutilizar a coleta.
with b as (
  select * from public.order_items where source_line_key = 'b'
), ret as (
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_date, processing_status
  ) select order_id, 'h-valid-b', 'H-B', now(), 'processed' from b returning id
)
insert into public.order_return_items (return_id, order_item_id, source_item_key, returned_quantity)
select ret.id, b.id, 'b', 1 from ret, b;

do $test$
declare v_rejected boolean := false;
begin
  begin
    perform public.register_order_return_pickup(
      (select id from public.order_returns where external_key = 'h-valid-b'),
      (select id from public.orders where order_id_erp = 'H-COLETA-VALIDA'),
      (select id from public.routes where name = 'COLETA-H-VALIDA')
    );
  exception when others then
    v_rejected := true;
  end;
  perform public.test_assert(v_rejected, 'H3: outra devolução não reutiliza a mesma coleta');
end;
$test$;

-- Itens de uma devolução coletada ficam imutáveis.
do $test$
declare v_rejected boolean := false;
begin
  begin
    update public.order_return_items set returned_quantity = 0.5
    where return_id = (select id from public.order_returns where external_key = 'h-over-1');
  exception when others then
    v_rejected := true;
  end;
  perform public.test_assert(v_rejected, 'H4: itens de devolução com coleta criada não podem ser alterados');
end;
$test$;

-- Excluir a rota deve limpar todo o vínculo e devolver o evento à fila.
delete from public.routes where name = 'COLETA-H-VALIDA';

select public.test_assert(
  (select pickup_created_at is null and pickup_order_id is null and pickup_route_id is null
   from public.order_returns where external_key = 'h-over-1'),
  'H5: excluir rota limpa o vínculo inteiro'
);

select public.test_assert(
  (select requires_pickup from public.order_returns where external_key = 'h-over-1'),
  'H5: evento volta para coletas pendentes depois da exclusão'
);

-- A limpeza manual não aceita filtros misturados.
do $test$
declare v_rejected boolean := false;
begin
  begin
    perform public.clear_order_return_pickup(
      p_return_id := (select id from public.order_returns where external_key = 'h-over-1'),
      p_pickup_order_id := (select id from public.orders where order_id_erp = 'H-COLETA-VALIDA')
    );
  exception when others then
    v_rejected := true;
  end;
  perform public.test_assert(v_rejected, 'H6: limpeza exige um único identificador e não afeta eventos por engano');
end;
$test$;
