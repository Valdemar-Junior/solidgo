-- Consulta (só leitura): as montagens GERADAS em novembro que saíram atrasadas.
-- Objetivo: entender por que o atraso médio deu 77,9 dias (maior 262) em montagem gerada no mês.
-- Rode no SQL Editor de PRODUÇÃO.
select
  o.order_id_erp                                                         as pedido,
  (o.data_venda        at time zone 'America/Sao_Paulo')::date           as venda,
  (o.previsao_montagem at time zone 'America/Sao_Paulo')::date           as previsao_montagem,
  (ap.created_at       at time zone 'America/Sao_Paulo')::date           as montagem_gerada,
  (ap.completion_date  at time zone 'America/Sao_Paulo')::date           as montado_em,
  (ap.completion_date  at time zone 'America/Sao_Paulo')::date
- (o.previsao_montagem at time zone 'America/Sao_Paulo')::date           as atraso_sobre_previsao,
  (ap.completion_date  at time zone 'America/Sao_Paulo')::date
- (ap.created_at       at time zone 'America/Sao_Paulo')::date           as dias_entre_gerada_e_montada,
  r.name                                                                 as rota,
  o.address_json->>'city'                                                as cidade
from assembly_products ap
join orders o on o.id = ap.order_id
left join assembly_routes r on r.id = ap.assembly_route_id
where ap.status = 'completed'
  and coalesce(r.name, '') not ilike 'BAIXA DE MONTAGE%'
  and coalesce(upper(o.service_type), '') not in ('TROCA', 'ASSISTENCIA', 'ASSISTÊNCIA')
  and coalesce(o.order_id_erp, '') !~ '-(A|T)-[0-9]+$'   -- sem troca (-T-) e assistência (-A-)
  and ap.created_at >= '2026-11-01 00:00:00-03'
  and ap.created_at <  '2026-11-26 00:00:00-03'
  and o.previsao_montagem is not null
  and (ap.completion_date at time zone 'America/Sao_Paulo')::date
    > (o.previsao_montagem at time zone 'America/Sao_Paulo')::date
order by atraso_sobre_previsao desc;
