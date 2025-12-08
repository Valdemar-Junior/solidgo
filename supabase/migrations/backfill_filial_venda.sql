-- Backfill filial_venda from raw_json where missing
do $$
begin
  update public.orders
    set filial_venda = coalesce(filial_venda, nullif(raw_json->>'filial_venda',''))
    where (filial_venda is null or filial_venda='')
      and (raw_json->>'filial_venda') is not null;

  -- Optional index to accelerate filters
  create index if not exists orders_filial_venda_idx on public.orders (filial_venda);
end $$;

