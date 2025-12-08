create table if not exists public.user_preferences (
  user_id uuid not null references public.users(id) on delete cascade,
  pref_key text not null,
  pref_value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, pref_key)
);

alter table public.user_preferences enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_preferences' and policyname='upsert_own_prefs'
  ) then
    create policy upsert_own_prefs on public.user_preferences
      for all
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;

