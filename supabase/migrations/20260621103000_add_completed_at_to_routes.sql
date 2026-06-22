alter table public.routes
add column if not exists completed_at timestamptz;

with route_completion as (
  select
    ro.route_id,
    max(coalesce(ro.returned_at, ro.delivered_at)) as completed_at
  from public.route_orders ro
  where ro.status in ('delivered', 'returned')
    and coalesce(ro.returned_at, ro.delivered_at) is not null
  group by ro.route_id
)
update public.routes r
set
  completed_at = rc.completed_at,
  updated_at = case
    when r.updated_at is null or r.updated_at < rc.completed_at then rc.completed_at
    else r.updated_at
  end
from route_completion rc
where r.id = rc.route_id
  and r.status = 'completed'
  and r.completed_at is null;

create index if not exists idx_routes_completed_at on public.routes(completed_at);
create index if not exists idx_routes_status_completed_at on public.routes(status, completed_at);
