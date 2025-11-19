-- Allow drivers (authenticated users linked to drivers.user_id) to view and update route_orders of their routes
create policy if not exists route_orders_select_driver on public.route_orders
  for select
  to authenticated
  using (
    exists (
      select 1 from public.routes r
      join public.drivers d on d.id = r.driver_id
      where r.id = route_orders.route_id and d.user_id = auth.uid()
    )
  );

create policy if not exists route_orders_update_driver on public.route_orders
  for update
  to authenticated
  using (
    exists (
      select 1 from public.routes r
      join public.drivers d on d.id = r.driver_id
      where r.id = route_orders.route_id and d.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.routes r
      join public.drivers d on d.id = r.driver_id
      where r.id = route_orders.route_id and d.user_id = auth.uid()
    )
  );

-- Allow assigned driver to update their route status
create policy if not exists routes_update_driver on public.routes
  for update
  to authenticated
  using (
    exists (
      select 1 from public.drivers d
      where d.id = routes.driver_id and d.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.drivers d
      where d.id = routes.driver_id and d.user_id = auth.uid()
    )
  );

-- Optionally allow driver to mark orders as delivered only for orders in their routes
create policy if not exists orders_update_driver_delivered on public.orders
  for update
  to authenticated
  using (
    exists (
      select 1 from public.route_orders ro
      join public.routes r on ro.route_id = r.id
      join public.drivers d on r.driver_id = d.id
      where ro.order_id = orders.id and d.user_id = auth.uid()
    )
  )
  with check (
    status = 'delivered'
  );

