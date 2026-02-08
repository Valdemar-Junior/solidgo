-- RLS policies for delivery_receipts
-- Goal:
-- 1) Admin can view all receipts
-- 2) Authenticated user can view and insert only their own receipts

alter table if exists public.delivery_receipts enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'delivery_receipts'
      and policyname = 'delivery_receipts_select_admin'
  ) then
    create policy delivery_receipts_select_admin
      on public.delivery_receipts
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'delivery_receipts'
      and policyname = 'delivery_receipts_select_own'
  ) then
    create policy delivery_receipts_select_own
      on public.delivery_receipts
      for select
      to authenticated
      using (delivered_by_user_id = auth.uid());
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'delivery_receipts'
      and policyname = 'delivery_receipts_insert_own'
  ) then
    create policy delivery_receipts_insert_own
      on public.delivery_receipts
      for insert
      to authenticated
      with check (delivered_by_user_id = auth.uid());
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'delivery_receipts'
      and policyname = 'delivery_receipts_insert_admin'
  ) then
    create policy delivery_receipts_insert_admin
      on public.delivery_receipts
      for insert
      to authenticated
      with check (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'admin'
        )
      );
  end if;
end
$$;

