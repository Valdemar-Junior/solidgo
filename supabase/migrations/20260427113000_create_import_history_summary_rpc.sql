create or replace function public.get_import_history_summary(
  p_search text default null,
  p_limit integer default 10,
  p_offset integer default 0
)
returns table (
  manifest_key text,
  manifest_id text,
  imported_at timestamptz,
  total_orders bigint,
  is_avulso boolean,
  total_groups bigint
)
language sql
stable
as $$
  with grouped as (
    select
      coalesce(o.manifest_id, 'avulsos') as manifest_key,
      o.manifest_id,
      max(o.created_at) as imported_at,
      count(*)::bigint as total_orders,
      (o.manifest_id is null) as is_avulso
    from public.orders o
    where
      p_search is null
      or p_search = ''
      or coalesce(o.manifest_id, 'avulsos') ilike '%' || p_search || '%'
    group by coalesce(o.manifest_id, 'avulsos'), o.manifest_id
  )
  select
    g.manifest_key,
    g.manifest_id,
    g.imported_at,
    g.total_orders,
    g.is_avulso,
    count(*) over()::bigint as total_groups
  from grouped g
  order by
    case when g.is_avulso then 1 else 0 end,
    case
      when g.manifest_id ~ '^\d+$' then g.manifest_id::bigint
      else null
    end desc nulls last,
    g.manifest_id desc nulls last,
    g.imported_at desc
  limit greatest(coalesce(p_limit, 10), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.get_import_history_summary(text, integer, integer) to authenticated;
