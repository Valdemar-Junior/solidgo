\set ORDER '22222222-2222-2222-2222-222222222222'
\set RO2   '66666666-6666-6666-6666-666666666666'

-- A1: view remaining (roupeiro entregue=0, armario faltando=1)
DO $$
DECLARE v_roup numeric; v_arm numeric;
BEGIN
  SELECT remaining_deliverable_quantity INTO v_roup FROM public.order_item_shadow_balances
    WHERE order_id='22222222-2222-2222-2222-222222222222' AND sku='ROUP-1';
  SELECT remaining_deliverable_quantity INTO v_arm FROM public.order_item_shadow_balances
    WHERE order_id='22222222-2222-2222-2222-222222222222' AND sku='ARM-1';
  IF coalesce(v_roup,-1) <> 0 THEN RAISE EXCEPTION 'FALHA A1: roupeiro remaining=% (esperado 0)', v_roup; END IF;
  IF coalesce(v_arm,-1) <> 1 THEN RAISE EXCEPTION 'FALHA A1: armario remaining=% (esperado 1)', v_arm; END IF;
  RAISE NOTICE 'OK A1: remaining roupeiro=0, armario=1';
END $$;

-- A2: montagem SO do roupeiro (1 ativo), armario 0
DO $$
DECLARE v_roup int; v_arm int;
BEGIN
  SELECT count(*) INTO v_roup FROM public.assembly_products
    WHERE order_id='22222222-2222-2222-2222-222222222222' AND product_sku='ROUP-1' AND status<>'cancelled';
  SELECT count(*) INTO v_arm FROM public.assembly_products
    WHERE order_id='22222222-2222-2222-2222-222222222222' AND product_sku='ARM-1' AND status<>'cancelled';
  IF v_roup <> 1 THEN RAISE EXCEPTION 'FALHA A2: montagens roupeiro=% (esperado 1)', v_roup; END IF;
  IF v_arm <> 0 THEN RAISE EXCEPTION 'FALHA A2: montagem armario=% (esperado 0 - nao coube)', v_arm; END IF;
  RAISE NOTICE 'OK A2: montagem so do item entregue (roupeiro=1, armario=0)';
END $$;

-- A3: pedido voltou pra fila (pending)
DO $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.orders WHERE id='22222222-2222-2222-2222-222222222222';
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'FALHA A3: order status=% (esperado pending)', v_status; END IF;
  RAISE NOTICE 'OK A3: pedido parcial voltou pra fila (pending)';
END $$;

-- A4: snapshot da rota 2 traz SO o armario (roupeiro entregue NAO volta = sem entrega dupla)
DO $$
DECLARE v_cnt int; v_roup int;
BEGIN
  SELECT count(*) INTO v_cnt FROM public.route_order_items WHERE route_order_id='66666666-6666-6666-6666-666666666666';
  SELECT count(*) INTO v_roup FROM public.route_order_items
    WHERE route_order_id='66666666-6666-6666-6666-666666666666' AND sku_snapshot='ROUP-1';
  IF v_roup <> 0 THEN RAISE EXCEPTION 'FALHA A4: roupeiro (JA ENTREGUE) voltou no snapshot da rota 2 -> RISCO DE ENTREGA DUPLA'; END IF;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'FALHA A4: rota 2 tem % itens (esperado 1: so o armario)', v_cnt; END IF;
  RAISE NOTICE 'OK A4: re-fila traz so o armario; roupeiro entregue nao voltou (sem entrega dupla)';
END $$;

\echo '===================================='
\echo '  TODOS OS 4 ASSERTS PASSARAM  ✅'
\echo '===================================='
