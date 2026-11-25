-- Consulta (só leitura): de onde vêm os atrasos grandes do relatório de prazo,
-- e se o banco guarda que o produto passou por rota "Aguardando".
-- Rode no SQL Editor de PRODUÇÃO, cada parte separada.

-- 1) As 95 montagens fora do prazo de 01 a 25/11: em que rota estão hoje
select
  r.name                         as rota_atual,
  count(*)                       as produtos,
  round(avg(x.atraso), 1)        as atraso_medio,
  max(x.atraso)                  as maior_atraso
from (
  select ap.assembly_route_id,
         (ap.completion_date  at time zone 'America/Sao_Paulo')::date
       - (o.previsao_montagem at time zone 'America/Sao_Paulo')::date as atraso
  from assembly_products ap
  join orders o on o.id = ap.order_id
  where ap.status = 'completed'
    and o.previsao_montagem is not null
    and ap.completion_date >= '2026-11-01 00:00:00-03'
    and ap.completion_date <  '2026-11-26 00:00:00-03'
) x
left join assembly_routes r on r.id = x.assembly_route_id
where x.atraso > 0
group by r.name
order by produtos desc;

-- 2) Gatilhos na tabela assembly_products (algum deles pode gravar histórico)
select tgname as gatilho, pg_get_triggerdef(t.oid) as definicao
from pg_trigger t
where t.tgrelid = 'public.assembly_products'::regclass
  and not t.tgisinternal;

-- 3) Tabelas de histórico/log que existem no banco
select table_name
from information_schema.tables
where table_schema = 'public'
  and (table_name ilike '%log%' or table_name ilike '%hist%' or table_name ilike '%audit%')
order by table_name;
