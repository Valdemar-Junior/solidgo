-- Consulta (só leitura): por que a busca por CPF na Consulta de Pedido demora ou dá erro.
-- Rode no SQL Editor de PRODUÇÃO, cada parte separada, e mande o print de cada uma.
-- Usa um CPF inventado (00000000000): não traz dado de cliente, só mede o tempo da busca.

-- 1) Tamanho da tabela de pedidos
select count(*) as pedidos,
       pg_size_pretty(pg_total_relation_size('public.orders')) as tamanho_total
from orders;

-- 2) Índices que existem hoje na tabela de pedidos
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'orders'
order by indexname;

-- 3) Onde o CPF está guardado: na coluna própria ou só dentro do raw_json
select
  count(*)                                                                as pedidos,
  count(*) filter (where nullif(customer_cpf, '') is not null)            as com_customer_cpf,
  count(*) filter (where nullif(customer_cpf, '') is null
                     and coalesce(raw_json->>'destinatario_cpf', raw_json->>'cliente_cpf', raw_json->>'cpf', '') <> '')
                                                                          as cpf_so_no_raw_json,
  count(*) filter (where customer_cpf ~ '^[0-9]{11}$')                    as cpf_so_numeros,
  count(*) filter (where customer_cpf ~ '^[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}$') as cpf_com_pontos
from orders;

-- 4) Tempo da busca do jeito que a tela faz hoje (ao apertar Buscar com o CPF completo)
explain (analyze, buffers)
select id
from orders
where customer_cpf ilike '00000000000'
   or customer_cpf ilike '000.000.000-00'
   or raw_json->>'destinatario_cpf' ilike '00000000000'
   or raw_json->>'destinatario_cpf' ilike '000.000.000-00'
   or raw_json->>'cliente_cpf' ilike '00000000000'
   or raw_json->>'cliente_cpf' ilike '000.000.000-00'
   or raw_json->>'cpf' ilike '00000000000'
   or raw_json->>'cpf' ilike '000.000.000-00'
limit 10;

-- 5) Tempo da busca de SUGESTÕES (roda a cada número digitado, a partir do 3º)
explain (analyze, buffers)
select id
from orders
where order_id_erp ilike '%00000000000%'
   or customer_name ilike '%00000000000%'
   or customer_cpf ilike '%00000000000%'
   or customer_cpf ilike '%000.000.000-00%'
   or raw_json->>'destinatario_cpf' ilike '%00000000000%'
   or raw_json->>'cliente_cpf' ilike '%00000000000%'
   or raw_json->>'cpf' ilike '%00000000000%'
limit 10;

-- 6) Tempo máximo que o banco deixa uma consulta da tela rodar antes de cancelar
select rolname, rolconfig
from pg_roles
where rolname in ('anon', 'authenticated', 'authenticator');
