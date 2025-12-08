-- Add resolution metadata to route_conferences and allow admin updates
alter table public.route_conferences
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.users(id),
  add column if not exists resolution jsonb;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='route_conferences' and policyname='rc_update_admin'
  ) then
    create policy rc_update_admin on public.route_conferences
      for update
      using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
      with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));
  end if;
end $$;

