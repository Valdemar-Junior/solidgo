-- Helpers da bateria massiva de testes. Roda como service_role pra passar os gates.
select set_config('request.jwt.claim.role', 'service_role', false);

-- Driver/user compartilhado (routes.driver_id -> drivers -> users)
insert into auth.users (id, email) values ('77777777-7777-7777-7777-777777777777','d@t.com') on conflict do nothing;
insert into public.users (id, email, name, role, active) values ('77777777-7777-7777-7777-777777777777','d@t.com','Driver','driver',true) on conflict do nothing;
insert into public.drivers (id, user_id, active) values ('77777777-7777-7777-7777-777777777777','77777777-7777-7777-7777-777777777777',true) on conflict do nothing;

-- Assert: imprime PASS ou BUG (nao aborta a bateria).
create or replace function pd_assert(p_cond boolean, p_label text, p_detail text default '') returns void
language plpgsql as $$
begin
  if p_cond then raise notice 'PASS: %', p_label;
  else raise warning 'BUG: % | %', p_label, p_detail; end if;
end $$;

-- Cria pedido + estrutura order_items. Retorna order uuid.
create or replace function pd_make_order(p_erp text, p_items jsonb) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.orders(id, order_id_erp, customer_name, phone, address_json, status, items_json)
    values (v_id, p_erp, 'Cliente '||p_erp, '84999999999', '{"street":"Rua","city":"Cidade"}'::jsonb, 'pending', p_items);
  perform public.sync_order_items_shadow(v_id);
  return v_id;
end $$;

-- Cria rota + route_order + snapshot. Retorna route_order uuid.
create or replace function pd_make_route(p_order uuid, p_name text) returns uuid
language plpgsql as $$
declare v_route uuid := gen_random_uuid(); v_ro uuid := gen_random_uuid();
begin
  insert into public.routes(id, name, driver_id, status) values (v_route, p_name, '77777777-7777-7777-7777-777777777777', 'pending');
  insert into public.route_orders(id, route_id, order_id, sequence, status) values (v_ro, v_route, p_order, 1, 'pending');
  perform public.sync_route_order_item_snapshots_system(array[v_ro]::uuid[]);
  return v_ro;
end $$;

-- Entrega TODOS os itens entregaveis de um route_order (marca delivered).
create or replace function pd_deliver_all(p_ro uuid) returns void
language plpgsql as $$
begin
  update public.route_order_items set status='delivered', delivered_quantity=deliverable_quantity_snapshot
    where route_order_id=p_ro and deliverable_quantity_snapshot > 0;
  update public.route_orders set status='delivered', delivered_at=timezone('utc',now()) where id=p_ro;
  update public.orders set status='delivered' where id=(select order_id from public.route_orders where id=p_ro);
end $$;

-- Entrega so os itens de certos SKUs; RETORNA o resto (nao coube).
create or replace function pd_deliver_skus(p_ro uuid, p_skus text[]) returns void
language plpgsql as $$
begin
  update public.route_order_items set status='delivered', delivered_quantity=deliverable_quantity_snapshot
    where route_order_id=p_ro and deliverable_quantity_snapshot>0 and sku_snapshot = any(p_skus);
  update public.route_order_items set status='returned', delivered_quantity=0, returned_quantity=deliverable_quantity_snapshot
    where route_order_id=p_ro and deliverable_quantity_snapshot>0 and not (sku_snapshot = any(p_skus));
  update public.route_orders set status='delivered', delivered_at=timezone('utc',now()) where id=p_ro;
  update public.orders set status='delivered', return_flag=true where id=(select order_id from public.route_orders where id=p_ro);
end $$;

-- Retirada por item: marca picked_up nos SKUs dados + gera montagem dos retirados.
create or replace function pd_pickup(p_order uuid, p_skus text[]) returns void
language plpgsql as $$
begin
  insert into public.order_item_holds
    (order_id, order_item_id, source_line_key, sku, storage_location, product_name, hold_type, status)
  select oi.order_id, oi.id, oi.source_line_key, oi.sku, oi.storage_location, oi.product_name, 'retirada', 'picked_up'
  from public.order_items oi
  where oi.order_id = p_order and oi.sku = any(p_skus)
    and not exists (select 1 from public.order_item_holds h
                    where h.order_id=oi.order_id and h.status='picked_up' and h.order_item_id=oi.id);
  perform public.sync_missing_assembly_products_for_pickup_items(p_order, p_skus);
end $$;

-- Finaliza a rota do route_order: completa, gera montagem, re-fila parcial.
create or replace function pd_finalize(p_ro uuid) returns void
language plpgsql as $$
declare v_route uuid; v_order uuid;
begin
  select route_id, order_id into v_route, v_order from public.route_orders where id=p_ro;
  update public.routes set status='completed' where id=v_route;
  -- retornados (pedido inteiro) voltam pra pending
  update public.orders set status='pending', return_flag=true
    where id=v_order and (select status from public.route_orders where id=p_ro)='returned';
  perform public.reconcile_order_return_state(v_order);
  begin perform public.sync_missing_assembly_products_for_order(v_order); exception when others then null; end;
  -- re-fila parcial: entregue mas ainda falta item
  update public.orders set status='pending', return_flag=true
    where id=v_order
      and (select status from public.route_orders where id=p_ro)='delivered'
      and exists (select 1 from public.order_item_shadow_balances b where b.order_id=v_order and b.source_present and b.remaining_deliverable_quantity>0);
end $$;
