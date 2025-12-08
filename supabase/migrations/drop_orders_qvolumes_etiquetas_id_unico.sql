-- Drop redundant top-level columns from orders
do $$
begin
  -- quantidade_volumes
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='quantidade_volumes') then
    alter table public.orders drop column quantidade_volumes;
  end if;

  -- etiquetas
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='etiquetas') then
    alter table public.orders drop column etiquetas;
  end if;

  -- id_unico_integracao
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='id_unico_integracao') then
    alter table public.orders drop column id_unico_integracao;
  end if;
end $$;

