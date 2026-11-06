-- TESTE da função agente_aprovar_rota (fase 2 do Agente IA).
-- Roda DEPOIS da migração 20261106120000_agente_fase2.sql.
--
-- NÃO DEIXA NADA GRAVADO: tudo roda dentro de um bloco que termina com um erro
-- proposital, e o Postgres desfaz tudo. O resultado aparece na mensagem de erro:
--   "TESTE OK: ..."   -> funcionou (e foi desfeito)
--   qualquer outra    -> algo falhou (e também foi desfeito)

do $$
declare
  v_pedido    uuid;
  v_erp       text;
  v_motorista uuid;
  v_veiculo   uuid;
  v_conf      record;
  v_rota_nome text;
  v_admin     uuid;
  v_ap        uuid;
  v_res       jsonb;
  v_ro        int;
  v_status    text;
  v_ap_status text;
begin
  -- um pedido livre da fila (mesma regra da tela), com itens
  select o.id, o.order_id_erp into v_pedido, v_erp
  from orders o
  where o.status in ('pending', 'returned') and o.blocked_at is null
    and jsonb_typeof(o.items_json) = 'array' and jsonb_array_length(o.items_json) > 0
    and not exists (select 1 from route_orders ro join routes r on r.id = ro.route_id
                    where ro.order_id = o.id and r.status <> 'completed')
    and not exists (select 1 from order_withdrawals w where w.order_id = o.id)
  order by o.created_at desc limit 1;

  select id into v_motorista from drivers where active limit 1;
  select id into v_veiculo from vehicles where active limit 1;
  select id, name into v_conf from users where role = 'conferente' limit 1;
  select name into v_rota_nome from delivery_route_catalog where active limit 1;
  select id into v_admin from users where role = 'admin' limit 1;

  if v_pedido is null or v_motorista is null or v_veiculo is null or v_admin is null then
    raise exception 'TESTE NÃO RODOU: faltou pedido/motorista/veículo/admin para montar o teste.';
  end if;

  insert into agente_aprovacoes (tipo, dados, resumo)
  values ('nova_rota',
          jsonb_build_object('route_name', v_rota_nome, 'driver_id', v_motorista, 'vehicle_id', v_veiculo,
                             'conferente_id', v_conf.id, 'conferente_nome', v_conf.name,
                             'observations', 'TESTE AGENTE - desfeito', 'order_ids', jsonb_build_array(v_pedido)),
          jsonb_build_object('pedidos', '[]'::jsonb, 'pedidos_fora', '[]'::jsonb, 'avisos_gerais', '[]'::jsonb))
  returning id into v_ap;

  v_res := agente_aprovar_rota(v_ap, v_admin);

  if (v_res->>'ok')::boolean is not true then
    raise exception 'TESTE FALHOU: a função respondeu %', v_res;
  end if;

  select count(*) into v_ro from route_orders where route_id = (v_res->>'route_id')::uuid;
  select status into v_status from orders where id = v_pedido;
  select status into v_ap_status from agente_aprovacoes where id = v_ap;

  -- segunda aprovação da mesma proposta tem que ser recusada
  begin
    perform agente_aprovar_rota(v_ap, v_admin);
    raise exception 'TESTE FALHOU: aprovou a mesma proposta duas vezes';
  exception when others then
    if sqlerrm like 'TESTE FALHOU%' then raise; end if;
  end;

  raise exception 'TESTE OK: rota % (%) criada com % pedido(s) [pedido %], pedido ficou "%", proposta ficou "%". TUDO FOI DESFEITO.',
    v_res->>'route_code', v_rota_nome, v_ro, v_erp, v_status, v_ap_status;
end $$;
