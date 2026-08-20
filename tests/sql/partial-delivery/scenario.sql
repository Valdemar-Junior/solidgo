-- Cenario: ENTREGA PARCIAL (roupeiro entregue + armario retornado "nao coube")
-- Roda como service_role pra passar o gate item_fulfillment_can_manage().
select set_config('request.jwt.claim.role', 'service_role', false);

\set ORDER '22222222-2222-2222-2222-222222222222'
\set ROUTE '33333333-3333-3333-3333-333333333333'
\set RO    '44444444-4444-4444-4444-444444444444'
\set ROUTE2 '55555555-5555-5555-5555-555555555555'
\set RO2    '66666666-6666-6666-6666-666666666666'
\set DRIVER '77777777-7777-7777-7777-777777777777'

insert into auth.users (id, email) values (:'DRIVER', 'driver@test.com') on conflict do nothing;
insert into public.users (id, email, name, role, active) values (:'DRIVER', 'driver@test.com', 'Driver Teste', 'driver', true) on conflict do nothing;
insert into public.drivers (id, user_id, active) values (:'DRIVER', :'DRIVER', true) on conflict do nothing;

-- Pedido com 2 itens: roupeiro (tem montagem) + armario (sem montagem)
insert into public.orders (id, order_id_erp, customer_name, phone, address_json, status, items_json)
values (:'ORDER', 'PD-TEST-1', 'Cliente Teste', '84999999999', '{"street":"Rua Teste","city":"Cidade"}'::jsonb, 'pending',
  '[{"sku":"ROUP-1","name":"Roupeiro","purchased_quantity":1,"has_assembly":"Sim"},
    {"sku":"ARM-1","name":"Armario","purchased_quantity":1,"has_assembly":"Nao"}]'::jsonb);

-- Estrutura order_items (camada por item)
select public.sync_order_items_shadow(:'ORDER'::uuid);

-- Rota + route_order + snapshot
insert into public.routes (id, name, driver_id, status) values (:'ROUTE', 'ROTA-PD', :'DRIVER'::uuid, 'pending');
insert into public.route_orders (id, route_id, order_id, sequence, status) values (:'RO', :'ROUTE'::uuid, :'ORDER'::uuid, 1, 'pending');
select public.sync_route_order_item_snapshots_system(array[:'RO']::uuid[]);

-- === MOTORISTA: entrega o roupeiro, retorna o armario (nao coube) ===
update public.route_order_items roi
  set status='delivered', delivered_quantity = roi.deliverable_quantity_snapshot
  where roi.route_order_id = :'RO'::uuid and roi.sku_snapshot = 'ROUP-1';
update public.route_order_items roi
  set status='returned', delivered_quantity = 0, returned_quantity = roi.deliverable_quantity_snapshot
  where roi.route_order_id = :'RO'::uuid and roi.sku_snapshot = 'ARM-1';

update public.route_orders set status='delivered' where id = :'RO'::uuid;
update public.orders set status='delivered' where id = :'ORDER'::uuid;

-- === FINALIZACAO: completa rota, gera montagem, re-fila do parcial ===
update public.routes set status='completed' where id = :'ROUTE'::uuid;
select public.sync_missing_assembly_products_for_order(:'ORDER'::uuid);

update public.orders set status='pending'
  where id = :'ORDER'::uuid
    and exists (select 1 from public.order_item_shadow_balances b
                where b.order_id = :'ORDER'::uuid and b.source_present and b.remaining_deliverable_quantity > 0);

-- === Segunda rota (re-entrega): snapshot deve trazer SO o armario ===
insert into public.routes (id, name, driver_id, status) values (:'ROUTE2', 'ROTA-PD-2', :'DRIVER'::uuid, 'pending');
insert into public.route_orders (id, route_id, order_id, sequence, status) values (:'RO2', :'ROUTE2'::uuid, :'ORDER'::uuid, 1, 'pending');
select public.sync_route_order_item_snapshots_system(array[:'RO2']::uuid[]);
