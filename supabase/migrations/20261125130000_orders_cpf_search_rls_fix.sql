-- Correção da busca por CPF (20261125120000_orders_cpf_search_index.sql).
--
-- Problema: search_orders_by_cpf é SECURITY INVOKER. Para o usuário logado a tabela orders
-- tem RLS, e com RLS o Postgres não usa índice em condição com função "não leakproof"
-- (orders_cpf_keys / @>). Resultado: calculava os CPFs de todos os pedidos a cada busca,
-- passava do limite de 8 s e a tela mostrava "Erro ao buscar pedido".
-- No SQL Editor (postgres, sem RLS) o índice era usado, por isso o teste passou.
--
-- Solução: uma função SECURITY DEFINER que só devolve os IDs (usa o índice, sem RLS) e a
-- função da tela lê os pedidos por ID, com a RLS normal de quem está logado.
-- A tela não muda: continua chamando search_orders_by_cpf.
--
-- Rode as duas partes juntas, numa aba nova. Nada aqui altera ou apaga dados.

create or replace function public.search_order_ids_by_cpf(p_cpf text)
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select o.id
  from public.orders o
  where public.orders_cpf_keys(o.customer_cpf, o.raw_json)
        @> array[regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g')]
  limit 500
$$;

revoke execute on function public.search_order_ids_by_cpf(text) from public, anon;
grant execute on function public.search_order_ids_by_cpf(text) to authenticated;

create or replace function public.search_orders_by_cpf(p_cpf text)
returns setof public.orders
language sql
stable
security invoker
set search_path = public
as $$
  select o.*
  from public.orders o
  where o.id in (select f.id from public.search_order_ids_by_cpf(p_cpf) f)
$$;
