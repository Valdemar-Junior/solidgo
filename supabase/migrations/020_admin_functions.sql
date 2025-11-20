-- RPC functions to allow admin create users/helpers bypassing RLS (security definer)

create or replace function public.admin_create_user(
  p_id uuid,
  p_email text,
  p_name text,
  p_role text default 'driver',
  p_must_change_password boolean default true
)
returns void
language plpgsql
security definer
as $$
declare has_mcp boolean;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'Not authorized';
  end if;

  select exists(
    select 1 from information_schema.columns 
    where table_schema='public' and table_name='users' and column_name='must_change_password'
  ) into has_mcp;

  if has_mcp then
    insert into public.users (id,email,name,role,must_change_password) values (p_id, p_email, p_name, p_role, p_must_change_password);
  else
    insert into public.users (id,email,name,role) values (p_id, p_email, p_name, p_role);
  end if;
end;
$$;

grant execute on function public.admin_create_user(uuid, text, text, text, boolean) to authenticated;

create or replace function public.admin_create_helper(
  p_name text
)
returns uuid
language plpgsql
security definer
as $$
declare new_id uuid := gen_random_uuid();
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'Not authorized';
  end if;
  insert into public.helpers(id,name,active) values (new_id, p_name, true);
  return new_id;
end;
$$;

grant execute on function public.admin_create_helper(text) to authenticated;