-- Make capacity column nullable (not used), to prevent NOT NULL constraint errors
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='vehicles' and column_name='capacity'
  ) then
    execute 'alter table public.vehicles alter column capacity drop not null';
  end if;
exception when others then null; end $$;

