-- Permitir upsert em webhook_settings para usuários autenticados (UI de admin)
do $$
begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' 
      and tablename = 'webhook_settings' 
      and policyname = 'webhook_settings_modify_authenticated'
  ) then
    create policy webhook_settings_modify_authenticated on public.webhook_settings
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end
$$;
