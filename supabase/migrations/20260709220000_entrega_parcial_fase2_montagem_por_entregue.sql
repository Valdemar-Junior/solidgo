-- ============================================================================
-- Entrega parcial por item — FASE 2: montagem pelo que foi ENTREGUE (não "entregável")
-- ============================================================================
-- Muda sync_missing_assembly_products_for_order pra que, numa entrega PARCIAL,
-- a montagem seja gerada só do item ENTREGUE (não do "não coube").
--
-- REGRA (robusta, não quebra nada):
--   * Detecta se o pedido é PARCIAL = tem ao mesmo tempo item já entregue
--     (delivered_quantity > 0) E item ainda faltando (remaining > 0).
--   * SE parcial → alvo por SKU = LEAST(entregue, saldo-ERP). Ou seja: o que foi
--     entregue E ainda é válido (não devolvido no ERP). Item "não coube" (entregue=0)
--     → alvo 0 → sem montagem. Item devolvido no ERP depois de entregue → saldo cai
--     → LEAST cai → carimba certo.
--   * SE NÃO parcial (tudo-ou-nada, retirada, legado, pedido sem entrega por item)
--     → alvo = saldo-ERP (shadow_deliverable_quantity), EXATAMENTE como hoje.
--
-- Casos preservados (comportamento idêntico ao atual):
--   - Entrega tudo-ou-nada: entregue = entregável → não é "parcial" (nada faltando)
--     → usa saldo → mesmo resultado.
--   - Pedido entregue sem marcação por item (delivered=0 em tudo): não é "parcial"
--     (nada entregue por item) → usa saldo → montagem gera normal.
--   - Retirada (sem route_order_items): delivered=0 → usa saldo (a RPC _for_pickup
--     nem é tocada).
--
-- Só muda o resultado quando o pedido é DE FATO parcial (parte entregue, parte não)
-- — que é exatamente a feature nova. Hoje não existe pedido assim, então aplicar
-- não muda nada até a tela do motorista (Fase 3/4) começar a gerar entregas parciais.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_missing_assembly_products_for_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_latest_route_status text;
  v_is_partial boolean := false;
  v_target_item record;
  v_existing_count int;
  v_missing_count int;
  v_inserted_products int := 0;
  i int;
begin
  if p_order_id is null then
    raise exception 'order_id e obrigatorio';
  end if;

  select o.id, o.status, o.customer_name, o.phone, o.address_json
  into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'Pedido % nao encontrado', p_order_id;
  end if;

  if v_order.status <> 'delivered' then
    raise exception 'Pedido % precisa estar delivered para sincronizar montagem. Status atual: %', p_order_id, v_order.status;
  end if;

  select r.status
  into v_latest_route_status
  from public.route_orders ro
  join public.routes r on r.id = ro.route_id
  where ro.order_id = p_order_id
    and upper(coalesce(r.name, '')) not like 'COLETA-%'
  order by coalesce(r.updated_at, r.created_at) desc
  limit 1;

  if v_latest_route_status is null or v_latest_route_status <> 'completed' then
    raise exception 'Pedido % ainda nao pertence a uma rota finalizada. Status da ultima rota: %',
      p_order_id, coalesce(v_latest_route_status, 'sem rota');
  end if;

  -- Pedido é PARCIAL? (tem item entregue E item faltando ao mesmo tempo)
  select coalesce(bool_or(bal.delivered_quantity > 0), false)
         and coalesce(bool_or(bal.remaining_deliverable_quantity > 0), false)
  into v_is_partial
  from public.order_item_shadow_balances bal
  join public.order_items oi on oi.id = bal.order_item_id
  where oi.order_id = p_order_id
    and oi.source_present;

  for v_target_item in
    select
      coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF') as product_sku,
      max(oi.product_name) as product_name,
      greatest(floor(sum(
        case when v_is_partial
          then least(coalesce(bal.delivered_quantity, 0), coalesce(bal.shadow_deliverable_quantity, 0))
          else coalesce(bal.shadow_deliverable_quantity, 0)
        end
      )), 0)::int as target_quantity
    from public.order_item_shadow_balances bal
    join public.order_items oi on oi.id = bal.order_item_id
    where oi.order_id = p_order_id
      and oi.source_present
      and public.order_item_payload_requires_assembly(oi.source_payload)
    group by coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF')
    having greatest(floor(sum(
        case when v_is_partial
          then least(coalesce(bal.delivered_quantity, 0), coalesce(bal.shadow_deliverable_quantity, 0))
          else coalesce(bal.shadow_deliverable_quantity, 0)
        end
      )), 0)::int > 0
  loop
    select count(*)
    into v_existing_count
    from public.assembly_products ap
    where ap.order_id = p_order_id
      and coalesce(ap.product_sku, 'SKU-INDEF') = v_target_item.product_sku
      and ap.status <> 'cancelled';   -- canceladas (devolvidas) nao contam como existentes

    v_missing_count := v_target_item.target_quantity - coalesce(v_existing_count, 0);

    if v_missing_count > 0 then
      for i in 1..v_missing_count loop
        insert into public.assembly_products (
          order_id, product_name, product_sku, customer_name, customer_phone,
          installation_address, status, created_at, updated_at
        ) values (
          p_order_id, v_target_item.product_name, v_target_item.product_sku,
          v_order.customer_name, v_order.phone, v_order.address_json,
          'pending', timezone('utc', now()), timezone('utc', now())
        );
      end loop;

      v_inserted_products := v_inserted_products + v_missing_count;
    end if;
  end loop;

  return jsonb_build_object('order_id', p_order_id, 'inserted_products', v_inserted_products);
end;
$function$;

COMMIT;
