-- Drop orders.total and orders.observations (now derived from items_json and observacoes_* or raw_json)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='total') then
    alter table public.orders drop column total;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='observations') then
    alter table public.orders drop column observations;
  end if;
end $$;

