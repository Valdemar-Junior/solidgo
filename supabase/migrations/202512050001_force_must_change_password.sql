-- Ensure must_change_password is enforced by default and on new auth users

-- 1) Add column if not exists and set default
alter table if exists public.users
  add column if not exists must_change_password boolean default true;

-- 2) Backfill nulls to true (first login required)
update public.users
set must_change_password = true
where must_change_password is null;

-- 3) Recreate handle_new_user to set must_change_password=true on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, name, role, phone, must_change_password)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    coalesce(new.raw_user_meta_data->>'role', 'driver'),
    new.raw_user_meta_data->>'phone',
    true
  );

  if new.raw_user_meta_data->>'role' = 'driver' then
    insert into public.drivers (user_id, cpf, vehicle_id, active)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'cpf', '00000000000'),
      null,
      true
    );
  end if;

  return new;
end;
$$ language plpgsql security definer;

-- 4) Ensure trigger exists and points to the updated function
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5) Helper view: pending first-login users (optional for reporting)
create or replace view public.pending_first_login_users as
select id, email, name, role, created_at
from public.users
where must_change_password = true;

