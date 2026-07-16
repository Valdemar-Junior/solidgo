-- BUG (achado no teste do cenário 4, pedido 140264, 2026-07-16):
-- Entregar um pedido que tem devolução do ERP APAGAVA a entrega do motorista.
--
-- Cadeia: motorista marca entregue → app chama reconcile_order_return_state →
-- sync_order_return_operational_state ATUALIZA order_returns (requires_pickup)
-- → gatilho trg_order_returns_snapshot_refresh → resync_open_route_order_item_
-- snapshots_for_order → sync_route_order_item_snapshots_system faz DELETE +
-- INSERT de TODOS os itens da parada — zerando status/quantidade entregue que
-- o motorista tinha acabado de marcar. Na finalização, a rota re-filava tudo
-- como se nada tivesse sido entregue (risco de ENTREGA DUPLICADA em produção).
--
-- Conserto: o resync só reconstrói o snapshot de paradas ainda PENDENTES.
-- Parada entregue/retornada é registro histórico do que aconteceu na rua —
-- não se reescreve. (Marcas de motorista só existem em paradas concluídas,
-- então preservar as pendentes cobre todos os casos.)

CREATE OR REPLACE FUNCTION public.resync_open_route_order_item_snapshots_for_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_route_order_ids uuid[];
begin
  if p_order_id is null then
    return jsonb_build_object(
      'order_id', null,
      'synced_route_orders', 0,
      'synced_items', 0
    );
  end if;

  select coalesce(array_agg(ro.id order by ro.created_at, ro.id), '{}'::uuid[])
  into v_route_order_ids
  from public.route_orders ro
  join public.routes r on r.id = ro.route_id
  where ro.order_id = p_order_id
    and r.status <> 'completed'
    -- Só paradas AINDA PENDENTES: parada entregue/retornada tem as marcas do
    -- motorista (status, delivered_quantity) e NÃO pode ser reconstruída.
    and ro.status = 'pending';

  return jsonb_build_object(
    'order_id', p_order_id,
    'result', public.sync_route_order_item_snapshots_system(v_route_order_ids)
  );
end;
$function$;
