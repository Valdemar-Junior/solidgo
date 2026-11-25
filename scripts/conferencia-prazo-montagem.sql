-- Conferência (só leitura) do relatório "Prazo de montagem".
-- Regra: entram as montagens GERADAS no período (assembly_products.created_at).
-- A rota "BAIXA DE MONTAGENS" fica de fora.
-- Rode no SQL Editor do Supabase de PRODUÇÃO.
-- Troque as datas nas duas linhas marcadas com <<<.
--
-- Conta por PRODUTO (não junta kit como a tela faz) e não tira troca/assistência,
-- então pode ficar um pouco acima da tela. Serve para conferir a ordem de grandeza.

with base as (
  select
    ap.status,
    o.previsao_montagem,
    case when ap.status = 'completed' and o.previsao_montagem is not null then
      (ap.completion_date  at time zone 'America/Sao_Paulo')::date
    - (o.previsao_montagem at time zone 'America/Sao_Paulo')::date
    end as atraso,
    case when ap.status <> 'completed' and o.previsao_montagem is not null then
      (now()               at time zone 'America/Sao_Paulo')::date
    - (o.previsao_montagem at time zone 'America/Sao_Paulo')::date
    end as atraso_em_aberto
  from assembly_products ap
  join orders o on o.id = ap.order_id
  left join assembly_routes r on r.id = ap.assembly_route_id
  where ap.status <> 'cancelled'
    and coalesce(r.name, '') not ilike 'BAIXA DE MONTAGE%'
    and ap.created_at >= '2026-11-01 00:00:00-03'   -- <<< início
    and ap.created_at <  '2026-11-26 00:00:00-03'   -- <<< dia seguinte ao fim
)
select
  count(*)                                                        as geradas,
  count(*) filter (where status = 'completed' and atraso <= 0)    as montadas_no_prazo,
  count(*) filter (where status = 'completed' and atraso > 0)     as montadas_fora_do_prazo,
  round(avg(atraso) filter (where atraso > 0), 1)                 as atraso_medio_dias,
  max(atraso)                                                     as maior_atraso_dias,
  count(*) filter (where status = 'completed' and previsao_montagem is null) as montadas_sem_previsao,
  count(*) filter (where status <> 'completed')                   as ainda_nao_montadas,
  count(*) filter (where atraso_em_aberto > 0)                    as nao_montadas_ja_vencidas
from base;
