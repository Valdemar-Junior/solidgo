-- Consulta (só leitura): como está a rota "Aguardando montagem" em produção.
-- Serve para o Painel de montagem saber qual rota contar no card AGENDADAS.
-- Lista toda rota de montagem com "aguardando" no nome, com quantos produtos tem em cada situação
-- e em quais cidades estão esses produtos.
select ar.route_code                                            as codigo_rota,
       ar.name                                                  as nome_rota,
       ar.status                                                as status_rota,
       coalesce(u.name, '(sem montador)')                       as montador,
       to_char(ar.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') as criada_em,
       count(ap.id)                                             as produtos_total,
       count(ap.id) filter (where ap.status = 'completed')      as produtos_montados,
       count(ap.id) filter (where ap.status = 'cancelled')      as produtos_cancelados,
       count(ap.id) filter (where ap.status not in ('completed', 'cancelled')) as produtos_esperando,
       string_agg(distinct coalesce(o.address_json->>'city', '(sem cidade)'), ', ') as cidades
from assembly_routes ar
left join users u            on u.id = ar.assembler_id
left join assembly_products ap on ap.assembly_route_id = ar.id
left join orders o           on o.id = ap.order_id
where ar.name ilike '%aguardando%'
group by ar.id, ar.route_code, ar.name, ar.status, u.name, ar.created_at
order by ar.created_at;
