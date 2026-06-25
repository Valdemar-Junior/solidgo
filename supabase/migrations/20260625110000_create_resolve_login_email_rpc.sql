create or replace function public.resolve_login_email(identifier text)
returns table(email text)
language sql
security definer
set search_path = public
as $$
  select u.email
  from public.users u
  where u.active is distinct from false
    and (
      lower(trim(u.name)) = lower(trim(identifier))
      or lower(trim(u.email)) = lower(trim(identifier))
    )
  order by u.created_at desc nulls last
  limit 1;
$$;

revoke all on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon;
grant execute on function public.resolve_login_email(text) to authenticated;
grant execute on function public.resolve_login_email(text) to service_role;
