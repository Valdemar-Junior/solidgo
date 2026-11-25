-- Conferência (só leitura) da busca por CPF com índice.
-- Rode DEPOIS da migration 20261125120000_orders_cpf_search_index.sql, no mesmo banco.
-- Rode cada parte separada (selecione as linhas e Cmd+Enter).

-- 1) O índice ficou pronto? (indisvalid = true é o esperado)
select c.relname as indice, i.indisvalid as pronto
from pg_index i
join pg_class c on c.oid = i.indexrelid
where c.relname = 'orders_cpf_keys_idx';

-- 2) Tempo da busca nova (CPF inventado). Olhe a última linha, "Execution Time",
--    e se aparece "orders_cpf_keys_idx" no texto (sinal de que usou o índice).
explain (analyze, buffers)
select o.id
from public.orders o
where public.orders_cpf_keys(o.customer_cpf, o.raw_json) @> array['00000000000'];

-- 3) A busca nova acha pelo menos o que a antiga achava? Compara 5 clientes sorteados.
--    Esperado: coluna "faltando" = 0 em todas as linhas (a nova pode achar MAIS, nunca menos).
with amostra as (
  select regexp_replace(customer_cpf, '[^0-9]', '', 'g') as cpf
  from orders
  where customer_cpf ~ '[0-9]{11}'
  order by random()
  limit 5
),
comparacao as (
  select
    a.cpf,
    (select count(*) from orders o
      where o.customer_cpf ilike a.cpf
         or o.customer_cpf ilike substr(a.cpf,1,3)||'.'||substr(a.cpf,4,3)||'.'||substr(a.cpf,7,3)||'-'||substr(a.cpf,10,2)
         or o.raw_json->>'destinatario_cpf' ilike a.cpf
         or o.raw_json->>'cliente_cpf' ilike a.cpf
         or o.raw_json->>'cpf' ilike a.cpf)                              as busca_antiga,
    (select count(*) from public.search_orders_by_cpf(a.cpf))            as busca_nova
  from amostra a
)
select
  'cliente ' || row_number() over () as cliente,   -- não mostra o CPF
  busca_antiga,
  busca_nova,
  greatest(busca_antiga - busca_nova, 0) as faltando
from comparacao;
