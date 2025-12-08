-- Add customer_cpf to orders and backfill from raw_json
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_schema='public' and table_name='orders' and column_name='customer_cpf'
  ) then
    alter table public.orders add column customer_cpf text;
  end if;

  -- Backfill from raw_json.cpf_cliente when available
  update public.orders
    set customer_cpf = coalesce(customer_cpf, nullif(raw_json->>'cpf_cliente',''))
    where (customer_cpf is null or customer_cpf='') and (raw_json->>'cpf_cliente') is not null;

  create index if not exists orders_customer_cpf_idx on public.orders (customer_cpf);
end $$;

