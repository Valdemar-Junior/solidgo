create or replace view public.latest_route_conferences as
select distinct on (route_id)
  id, route_id, status, result_ok, started_at, finished_at, created_at, user_id, summary, resolved_at, resolved_by, resolution
from public.route_conferences
order by route_id, created_at desc;

