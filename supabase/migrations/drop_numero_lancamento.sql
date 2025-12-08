-- Backfill order_id_erp from numero_lancamento if needed, then drop numero_lancamento
do $$
begin
  -- Backfill: ensure order_id_erp has value when numero_lancamento exists
  update public.orders
    set order_id_erp = coalesce(order_id_erp, numero_lancamento::text)
    where numero_lancamento is not null
      and (order_id_erp is null or order_id_erp = '');

  -- Drop column if exists
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='numero_lancamento') then
    alter table public.orders drop column numero_lancamento;
  end if;
end $$;

