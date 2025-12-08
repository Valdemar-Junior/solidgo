-- Drop legacy product columns (codigo_produto, nome_produto, local_estocagem) from orders
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='codigo_produto') then
    alter table public.orders drop column codigo_produto;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='nome_produto') then
    alter table public.orders drop column nome_produto;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='local_estocagem') then
    alter table public.orders drop column local_estocagem;
  end if;
end $$;

