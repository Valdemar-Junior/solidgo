-- Policies for users table to allow admin manage users without switching session
-- Enable RLS (if not already enabled)
alter table if exists public.users enable row level security;

-- Allow admins to select all users; allow users to select their own profile
create policy if not exists users_select_admin_or_self on public.users
  for select to authenticated
  using (
    id = auth.uid() or exists(select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- Allow admins to insert any user row
create policy if not exists users_insert_admin on public.users
  for insert to authenticated
  with check (
    exists(select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- Allow admins to update any user; allow users to update their own row
create policy if not exists users_update_admin_or_self on public.users
  for update to authenticated
  using (
    id = auth.uid() or exists(select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  )
  with check (
    id = auth.uid() or exists(select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- Allow admins to delete any user
create policy if not exists users_delete_admin on public.users
  for delete to authenticated
  using (
    exists(select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );