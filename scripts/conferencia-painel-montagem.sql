-- Conferência (só leitura) do Painel de montagem. Refaz no banco a mesma conta da tela,
-- para comparar os números. Período: troque as duas datas em "periodo" (fim é exclusivo:
-- para outubro inteiro use 2026-10-01 e 2026-11-01).
-- Regras: kit vale 1 (peças / receita); troca e assistência fora de geradas e realizadas;
-- kit conta como realizado quando a última peça foi montada, para o montador dessa peça;
-- usuários genéricos (montador, montadorteste) fora das realizadas; agendadas = rotas "aguardando", agora.
with periodo as (
  select timestamptz '2026-10-01 00:00:00-03' as ini,
         timestamptz '2026-11-01 00:00:00-03' as fim
),
base as (
  select ap.id, ap.order_id, ap.product_sku, ap.status, ap.created_at, ap.completion_date,
         ar.name as rota, ar.assembler_id,
         upper(coalesce(o.address_json->>'city', '')) as cidade,
         (coalesce(lower(o.service_type::text), '') in ('troca', 'assistencia')
           or coalesce(o.order_id_erp, '') ~ '-(A|T)-[0-9]+$') as troca_ou_assist,
         kit.codigo_kit_pai,
         coalesce(nullif(kit.qtde_receita, '')::numeric, 1) as receita
  from assembly_products ap
  join orders o on o.id = ap.order_id
  left join assembly_routes ar on ar.id = ap.assembly_route_id
  left join lateral (
    select it->>'codigo_kit_pai' as codigo_kit_pai, it->>'qtde_receita' as qtde_receita
    from jsonb_array_elements(coalesce(o.items_json::jsonb, '[]'::jsonb) || coalesce(o.raw_json::jsonb->'items', '[]'::jsonb)) it
    where it->>'sku' = ap.product_sku and it->>'faz_parte_de_kit' = 'SIM' and coalesce(it->>'codigo_kit_pai', '') <> ''
    limit 1
  ) kit on true
),
geradas as (
  select b.* from base b, periodo p
  where b.created_at >= p.ini and b.created_at < p.fim and not b.troca_ou_assist
),
geradas_total as (
  select (select count(*) from geradas where codigo_kit_pai is null)
       + coalesce((select sum(q) from (
           select distinct on (order_id, codigo_kit_pai) count(*) over (partition by order_id, codigo_kit_pai, product_sku) / receita as q
           from geradas where codigo_kit_pai is not null
           order by order_id, codigo_kit_pai, product_sku
         ) k), 0) as total
),
kits_realizados as (
  select order_id, codigo_kit_pai,
         (array_agg(assembler_id order by completion_date desc))[1] as montador,
         max(completion_date) as ultima
  from base
  where codigo_kit_pai is not null and not troca_ou_assist
  group by order_id, codigo_kit_pai
  having bool_and(status = 'completed' and completion_date is not null)
),
kits_realizados_qtd as (
  select kr.montador, kr.ultima,
         (select count(*) from base b2
           where b2.order_id = kr.order_id and b2.codigo_kit_pai = kr.codigo_kit_pai
             and b2.product_sku = (select min(b3.product_sku) from base b3
                                   where b3.order_id = kr.order_id and b3.codigo_kit_pai = kr.codigo_kit_pai))
         / (select min(b4.receita) from base b4
             where b4.order_id = kr.order_id and b4.codigo_kit_pai = kr.codigo_kit_pai) as q
  from kits_realizados kr, periodo p
  where kr.ultima >= p.ini and kr.ultima < p.fim
),
realizadas as (
  select b.assembler_id as montador, 1::numeric as q
  from base b, periodo p
  where b.status = 'completed' and b.completion_date >= p.ini and b.completion_date < p.fim
    and b.codigo_kit_pai is null and not b.troca_ou_assist
  union all
  select montador, q from kits_realizados_qtd
),
realizadas_por_montador as (
  select coalesce(u.name, '(sem montador)') as montador, u.email, sum(r.q) as realizadas
  from realizadas r
  left join users u on u.id = r.montador
  group by u.name, u.email
)
select 'GERADAS' as card, null as montador, (select total from geradas_total) as quantidade
union all
select 'REALIZADAS (sem genéricos)', null,
       (select sum(realizadas) from realizadas_por_montador
         where email is not null and email not in ('montador@solidgo.local', 'montadorteste@solidgo.local'))
union all
select 'AGENDADAS (agora, peças sem regra de kit)', null,
       (select count(*) from base where rota ilike '%aguardando%' and status not in ('completed', 'cancelled'))
union all
select 'REALIZADAS por montador', montador || coalesce(' <' || email || '>', ''), realizadas
from realizadas_por_montador
order by 1, 3 desc;
