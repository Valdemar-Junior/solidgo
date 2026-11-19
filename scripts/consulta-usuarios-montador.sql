-- Consulta (só leitura): todos os usuários com papel de montador, para separar
-- as pessoas reais dos usuários genéricos (ex.: "montador") no Painel de montagem.
-- Mostra quantas rotas cada um tem e quantas montagens concluiu em 2026.
select u.name                                   as nome,
       u.email                                  as email,
       coalesce(u.active, true)                 as ativo,
       count(distinct ar.id)                    as rotas,
       count(ap.id) filter (
         where ap.status = 'completed'
           and ap.completion_date >= timestamptz '2026-01-01 00:00:00-03'
       )                                        as montagens_concluidas_2026
from users u
left join assembly_routes ar   on ar.assembler_id = u.id
left join assembly_products ap on ap.assembly_route_id = ar.id
where u.role = 'montador'
group by u.id, u.name, u.email, u.active
order by u.name;
