-- MCP do SolidGo: a fila que o MCP enxerga tinha ~20 pedidos "sem cidade",
-- mas a tela Gestão de Entregas não mostra nenhum. Quem são eles?
-- Mesma regra da fila do MCP (api/_agente/ferramentas.ts):
--   status pending/returned, sem bloqueio, fora de rota ativa, sem retirada.
-- Somente leitura.

with fila as (
  select o.*
  from orders o
  where o.status in ('pending', 'returned')
    and o.blocked_at is null
    and not exists (
      select 1 from route_orders ro
      join routes r on r.id = ro.route_id
      where ro.order_id = o.id and r.status <> 'completed'
    )
    and not exists (select 1 from order_withdrawals w where w.order_id = o.id)
)
select
  (select count(*) from fila) as total_fila,
  (select count(*) from fila where (case when jsonb_typeof(items_json) = 'array' then jsonb_array_length(items_json) else 0 end) = 0) as fila_sem_itens,
  order_id_erp,
  status,
  coalesce(address_json->>'city', '(vazio)') as cidade,
  (case when jsonb_typeof(items_json) = 'array' then jsonb_array_length(items_json) else 0 end) as qtd_itens,
  data_venda,
  created_at at time zone 'America/Sao_Paulo' as criado_em,
  import_source,
  service_type,
  left(coalesce(observacoes_internas, ''), 80) as obs
from fila
where coalesce(trim(address_json->>'city'), '') = ''
order by created_at desc;
