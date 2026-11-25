-- Busca de pedido por CPF rápida (Consulta de Pedido).
--
-- Problema: a tela procurava o CPF com ILIKE em customer_cpf e em quatro campos do raw_json.
-- Sem índice que sirva para isso, o banco lia a tabela orders inteira (com o raw_json) a cada
-- busca e passava do limite de 8 s do papel authenticated, gerando "Erro ao buscar pedido".
--
-- Solução: uma lista com todos os CPFs do pedido, só com números, indexada (GIN).
-- A busca passa a ser "a lista contém este CPF", que usa o índice.
--
-- COMO RODAR (banco de TESTE primeiro, depois PRODUÇÃO):
--   Rode as PARTES 1, 2 e 3 separadas, nesta ordem. A parte 2 usa CONCURRENTLY
--   (não trava a tabela enquanto o índice é construído) e precisa rodar SOZINHA.
--   Nada aqui altera ou apaga dados.

-- PARTE 1 ---------------------------------------------------------------------
-- Todos os CPFs/CNPJs do pedido, só números, sem repetição.
create or replace function public.orders_cpf_keys(p_customer_cpf text, p_raw jsonb)
returns text[]
language sql
immutable
parallel safe
as $$
  select coalesce(array_agg(distinct d), '{}'::text[])
  from (
    select regexp_replace(v, '[^0-9]', '', 'g') as d
    from unnest(array[
      p_customer_cpf,
      p_raw->>'cpf_cliente',
      p_raw->>'destinatario_cpf',
      p_raw->>'cliente_cpf',
      p_raw->>'cpf'
    ]) as v
  ) x
  where d <> ''
$$;

-- PARTE 2 (rodar sozinha) -----------------------------------------------------
create index concurrently if not exists orders_cpf_keys_idx
  on public.orders
  using gin (public.orders_cpf_keys(customer_cpf, raw_json));

-- PARTE 3 ---------------------------------------------------------------------
-- Função que a tela chama. SECURITY INVOKER: respeita as mesmas regras de acesso (RLS)
-- de quem está logado, igual à busca antiga.
create or replace function public.search_orders_by_cpf(p_cpf text)
returns setof public.orders
language sql
stable
security invoker
set search_path = public
as $$
  select o.*
  from public.orders o
  where public.orders_cpf_keys(o.customer_cpf, o.raw_json)
        @> array[regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g')]
$$;

grant execute on function public.search_orders_by_cpf(text) to authenticated;
