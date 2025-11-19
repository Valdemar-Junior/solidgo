create or replace function public.complete_route_if_all_delivered(p_route_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare cnt_total int; cnt_delivered int;
begin
  select count(*), sum(case when status='delivered' then 1 else 0 end)
  into cnt_total, cnt_delivered
  from route_orders where route_id = p_route_id;
  if cnt_total > 0 and cnt_delivered = cnt_total then
    update routes set status='completed' where id = p_route_id;
    update orders set status='delivered'
      where id in (select order_id from route_orders where route_id = p_route_id);
    return true;
  end if;
  return false;
end;
$$;

grant execute on function public.complete_route_if_all_delivered(uuid) to authenticated;

