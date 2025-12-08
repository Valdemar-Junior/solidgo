-- Remove unused columns from orders safely (keep tem_frete_full for future filters)
do $$
begin
  -- filial_entrega: UI reads from raw_json only
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='filial_entrega') then
    alter table public.orders drop column filial_entrega;
  end if;

  -- status_logistica: not used in UI
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='status_logistica') then
    alter table public.orders drop column status_logistica;
  end if;

  -- codigo_cliente: not used in UI/logic
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='codigo_cliente') then
    alter table public.orders drop column codigo_cliente;
  end if;

  -- operacoes: UI reads from raw_json only
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='operacoes') then
    alter table public.orders drop column operacoes;
  end if;
end $$;

