-- ============================================================================
-- BATERIA MASSIVA — entrega + montagem. Cada cenario cria seus proprios dados
-- (IDs unicos) e chama pd_assert (PASS/BUG). Nao usa ON_ERROR_STOP: roda tudo.
-- ============================================================================
select set_config('request.jwt.claim.role', 'service_role', false);

-- S1: Entrega completa (2 itens: 1 com montagem, 1 sem) -----------------------
DO $$
DECLARE o uuid; ro uuid;
BEGIN
  o := pd_make_order('S1', '[{"sku":"ROUP","name":"Roupeiro","purchased_quantity":1,"has_assembly":"Sim"},{"sku":"MESA","name":"Mesa","purchased_quantity":1,"has_assembly":"Nao"}]');
  ro := pd_make_route(o, 'R-S1'); PERFORM pd_deliver_all(ro); PERFORM pd_finalize(ro);
  PERFORM pd_assert((SELECT status FROM orders WHERE id=o)='delivered', 'S1 pedido entregue');
  PERFORM pd_assert((SELECT count(*) FROM assembly_products WHERE order_id=o AND product_sku='ROUP' AND status<>'cancelled')=1, 'S1 montagem do roupeiro=1');
  PERFORM pd_assert((SELECT count(*) FROM assembly_products WHERE order_id=o AND product_sku='MESA')=0, 'S1 mesa sem montagem');
  PERFORM pd_assert((SELECT coalesce(sum(remaining_deliverable_quantity),0) FROM order_item_shadow_balances WHERE order_id=o)=0, 'S1 nada restante');
END $$;

-- S2: Retorno completo do pedido (motorista devolve tudo) ---------------------
DO $$
DECLARE o uuid; ro uuid;
BEGIN
  o := pd_make_order('S2', '[{"sku":"ROUP","name":"Roupeiro","purchased_quantity":1,"has_assembly":"Sim"}]');
  ro := pd_make_route(o, 'R-S2');
  UPDATE route_order_items SET status='returned', delivered_quantity=0, returned_quantity=deliverable_quantity_snapshot WHERE route_order_id=ro;
  UPDATE route_orders SET status='returned' WHERE id=ro;
  UPDATE orders SET return_flag=true WHERE id=o;
  PERFORM pd_finalize(ro);
  PERFORM pd_assert((SELECT status FROM orders WHERE id=o)='pending', 'S2 pedido voltou pra fila');
  PERFORM pd_assert((SELECT count(*) FROM assembly_products WHERE order_id=o AND status<>'cancelled')=0, 'S2 sem montagem (nada entregue)');
  PERFORM pd_assert((SELECT remaining_deliverable_quantity FROM order_item_shadow_balances WHERE order_id=o)=1, 'S2 item inteiro ainda a entregar');
END $$;

-- S3: Entrega PARCIAL (roupeiro entregue, mesa "nao coube") -------------------
DO $$
DECLARE o uuid; ro uuid;
BEGIN
  o := pd_make_order('S3', '[{"sku":"ROUP","name":"Roupeiro","purchased_quantity":1,"has_assembly":"Sim"},{"sku":"MESA","name":"Mesa","purchased_quantity":1,"has_assembly":"Sim"}]');
  ro := pd_make_route(o, 'R-S3'); PERFORM pd_deliver_skus(ro, ARRAY['ROUP']); PERFORM pd_finalize(ro);
  PERFORM pd_assert((SELECT remaining_deliverable_quantity FROM order_item_shadow_balances WHERE order_id=o AND sku='ROUP')=0, 'S3 roupeiro entregue (restante 0)');
  PERFORM pd_assert((SELECT remaining_deliverable_quantity FROM order_item_shadow_balances WHERE order_id=o AND sku='MESA')=1, 'S3 mesa a re-entregar (restante 1)');
  PERFORM pd_assert((SELECT count(*) FROM assembly_products WHERE order_id=o AND product_sku='ROUP' AND status<>'cancelled')=1, 'S3 montagem SO do roupeiro entregue');
  PERFORM pd_assert((SELECT count(*) FROM assembly_products WHERE order_id=o AND product_sku='MESA' AND status<>'cancelled')=0, 'S3 mesa sem montagem (nao coube)');
  PERFORM pd_assert((SELECT status FROM orders WHERE id=o)='pending', 'S3 pedido parcial voltou pra fila');
END $$;

-- S4: Re-entrega do item que faltou (2a rota traz SO ele) ---------------------
DO $$
DECLARE o uuid; ro uuid; ro2 uuid; n int;
BEGIN
  o := pd_make_order('S4', '[{"sku":"ROUP","name":"Roupeiro","purchased_quantity":1,"has_assembly":"Sim"},{"sku":"MESA","name":"Mesa","purchased_quantity":1,"has_assembly":"Sim"}]');
  ro := pd_make_route(o, 'R-S4a'); PERFORM pd_deliver_skus(ro, ARRAY['ROUP']); PERFORM pd_finalize(ro);
  ro2 := pd_make_route(o, 'R-S4b');
  SELECT count(*) INTO n FROM route_order_items WHERE route_order_id=ro2;
  PERFORM pd_assert(n=1, '2a rota traz so 1 item', 'esperado 1 (mesa), veio '||n);
  PERFORM pd_assert((SELECT count(*) FROM route_order_items WHERE route_order_id=ro2 AND sku_snapshot='ROUP')=0, 'S4 roupeiro entregue NAO volta (sem entrega dupla)');
  PERFORM pd_deliver_all(ro2); PERFORM pd_finalize(ro2);
  PERFORM pd_assert((SELECT status FROM orders WHERE id=o)='delivered', 'S4 pedido finalmente entregue completo');
  PERFORM pd_assert((SELECT count(*) FROM assembly_products WHERE order_id=o AND product_sku='MESA' AND status<>'cancelled')=1, 'S4 montagem da mesa gerada na re-entrega');
END $$;

-- S5: Item com quantidade > 1 (3 unidades com montagem) ----------------------
DO $$
DECLARE o uuid; ro uuid;
BEGIN
  o := pd_make_order('S5', '[{"sku":"CAD","name":"Cadeira","purchased_quantity":3,"has_assembly":"Sim"}]');
  ro := pd_make_route(o, 'R-S5'); PERFORM pd_deliver_all(ro); PERFORM pd_finalize(ro);
  PERFORM pd_assert((SELECT count(*) FROM assembly_products WHERE order_id=o AND product_sku='CAD' AND status<>'cancelled')=3, 'S5 3 unidades = 3 montagens');
END $$;

-- S6: Devolucao ERP TOTAL antes da rota -> bloqueia iniciar -------------------
DO $$
DECLARE o uuid; ro uuid; v_route uuid; blk int;
BEGIN
  o := pd_make_order('S6', '[{"sku":"ROUP","name":"Roupeiro","purchased_quantity":1,"has_assembly":"Sim"}]');
  PERFORM public.ingest_erp_return('S6','[{"codigo":"ROUP","qtd":1}]'::jsonb,'NF-S6','ch-S6',null,now(),'devolucao');
  ro := pd_make_route(o, 'R-S6'); SELECT route_id INTO v_route FROM route_orders WHERE id=ro;
  SELECT count(*) INTO blk FROM public.get_route_start_return_blockers(v_route);
  PERFORM pd_assert(blk>=1, 'S6 rota bloqueada por pedido totalmente devolvido no ERP', 'blockers='||blk);
END $$;

-- S7: Devolucao ERP parcial APOS entrega -> coleta + carimbo ------------------
DO $$
DECLARE o uuid; ro uuid;
BEGIN
  o := pd_make_order('S7', '[{"sku":"ROUP","name":"Roupeiro","purchased_quantity":1,"has_assembly":"Sim"},{"sku":"MESA","name":"Mesa","purchased_quantity":1,"has_assembly":"Sim"}]');
  ro := pd_make_route(o, 'R-S7'); PERFORM pd_deliver_all(ro); PERFORM pd_finalize(ro);
  PERFORM public.ingest_erp_return('S7','[{"codigo":"MESA","qtd":1}]'::jsonb,'NF-S7','ch-S7',null,now(),'devolucao');
  PERFORM public.reconcile_order_return_state(o);
  PERFORM pd_assert((SELECT requires_pickup FROM orders WHERE id=o)=true, 'S7 gerou pendencia de coleta');
  PERFORM pd_assert((SELECT count(*) FROM assembly_products WHERE order_id=o AND product_sku='MESA' AND status='cancelled' AND was_returned)=1, 'S7 montagem da mesa devolvida foi CARIMBADA');
  PERFORM pd_assert((SELECT count(*) FROM assembly_products WHERE order_id=o AND product_sku='ROUP' AND status<>'cancelled')=1, 'S7 montagem do roupeiro (nao devolvido) intacta');
END $$;

-- S8: Ponte ingest casa por SKU ----------------------------------------------
DO $$
DECLARE o uuid; ro uuid;
BEGIN
  o := pd_make_order('S8', '[{"sku":"ROUP","name":"Roupeiro","purchased_quantity":1,"has_assembly":"Sim"}]');
  ro := pd_make_route(o, 'R-S8'); PERFORM pd_deliver_all(ro); PERFORM pd_finalize(ro);
  PERFORM public.ingest_erp_return('S8','[{"codigo":"ROUP","qtd":1}]'::jsonb,'NF-S8','ch-S8',null,now(),'dev');
  PERFORM pd_assert((SELECT count(*) FROM order_return_items ri JOIN order_returns r ON r.id=ri.return_id WHERE r.order_id=o AND ri.sku_snapshot='ROUP')=1, 'S8 ponte gravou o item devolvido por SKU');
  PERFORM pd_assert((SELECT returned_quantity FROM order_item_shadow_balances WHERE order_id=o AND sku='ROUP')=1, 'S8 saldo refletiu a devolucao');
END $$;

-- S9: SKU REPETIDO (2 linhas mesmo codigo, locais diferentes) ----------------
DO $$
DECLARE o uuid; ro uuid; tot numeric;
BEGIN
  o := pd_make_order('S9', '[{"sku":"DUP","name":"Prod A","location":"CD-A","purchased_quantity":1,"has_assembly":"Nao"},{"sku":"DUP","name":"Prod B","location":"CD-B","purchased_quantity":1,"has_assembly":"Nao"}]');
  ro := pd_make_route(o, 'R-S9'); PERFORM pd_deliver_all(ro); PERFORM pd_finalize(ro);
  PERFORM public.ingest_erp_return('S9','[{"codigo":"DUP","qtd":1}]'::jsonb,'NF-S9','ch-S9',null,now(),'dev');
  SELECT coalesce(sum(returned_quantity),0) INTO tot FROM order_item_shadow_balances WHERE order_id=o AND sku='DUP';
  PERFORM pd_assert(tot=1, 'S9 SKU repetido: total devolvido = 1 (nao duplicou nem sumiu)', 'total='||tot);
END $$;

-- S10: Idempotencia da ponte (mesma nota 2x) ---------------------------------
DO $$
DECLARE o uuid; ro uuid; n int;
BEGIN
  o := pd_make_order('S10', '[{"sku":"ROUP","name":"Roupeiro","purchased_quantity":1,"has_assembly":"Sim"}]');
  ro := pd_make_route(o, 'R-S10'); PERFORM pd_deliver_all(ro); PERFORM pd_finalize(ro);
  PERFORM public.ingest_erp_return('S10','[{"codigo":"ROUP","qtd":1}]'::jsonb,'NF-S10','ch',null,now(),'dev');
  PERFORM public.ingest_erp_return('S10','[{"codigo":"ROUP","qtd":1}]'::jsonb,'NF-S10','ch',null,now(),'dev');
  SELECT count(*) INTO n FROM order_returns WHERE external_key='erp-return-NF-S10';
  PERFORM pd_assert(n=1, 'S10 ponte idempotente: mesma nota nao duplica', 'devolucoes='||n);
END $$;

-- S11: Idempotencia da montagem (sync 2x) ------------------------------------
DO $$
DECLARE o uuid; ro uuid; n int;
BEGIN
  o := pd_make_order('S11', '[{"sku":"ROUP","name":"Roupeiro","purchased_quantity":2,"has_assembly":"Sim"}]');
  ro := pd_make_route(o, 'R-S11'); PERFORM pd_deliver_all(ro); PERFORM pd_finalize(ro);
  PERFORM public.sync_missing_assembly_products_for_order(o);
  SELECT count(*) INTO n FROM assembly_products WHERE order_id=o AND status<>'cancelled';
  PERFORM pd_assert(n=2, 'S11 montagem idempotente: rodar 2x nao duplica', 'montagens='||n);
END $$;

-- S12: Carimbo (devolucao ERP apos montagem, nao apaga) ----------------------
DO $$
DECLARE o uuid; ro uuid;
BEGIN
  o := pd_make_order('S12', '[{"sku":"ROUP","name":"Roupeiro","purchased_quantity":1,"has_assembly":"Sim"}]');
  ro := pd_make_route(o, 'R-S12'); PERFORM pd_deliver_all(ro); PERFORM pd_finalize(ro);
  PERFORM public.ingest_erp_return('S12','[{"codigo":"ROUP","qtd":1}]'::jsonb,'NF-S12','ch',null,now(),'dev');
  PERFORM public.reconcile_order_return_state(o);
  PERFORM pd_assert((SELECT count(*) FROM assembly_products WHERE order_id=o)=1, 'S12 montagem NAO foi apagada (registro existe)');
  PERFORM pd_assert((SELECT count(*) FROM assembly_products WHERE order_id=o AND status='cancelled' AND was_returned)=1, 'S12 montagem foi carimbada (cancelled+was_returned)');
END $$;

-- S13: B5 trigger (editar has_assembly no items_json re-sincroniza) ----------
DO $$
DECLARE o uuid; v text;
BEGIN
  o := pd_make_order('S13', '[{"sku":"MESA","name":"Mesa","purchased_quantity":1,"has_assembly":"Nao"}]');
  UPDATE orders SET items_json='[{"sku":"MESA","name":"Mesa","purchased_quantity":1,"has_assembly":"Sim"}]'::jsonb WHERE id=o;
  SELECT source_payload->0->>'has_assembly' INTO v FROM order_items WHERE order_id=o AND sku='MESA';
  PERFORM pd_assert(lower(coalesce(v,''))='sim', 'S13 editar tem-montagem re-sincronizou a camada por item', 'source_payload has_assembly='||coalesce(v,'null'));
END $$;

-- S14: Pedido sem nenhuma montagem -------------------------------------------
DO $$
DECLARE o uuid; ro uuid;
BEGIN
  o := pd_make_order('S14', '[{"sku":"MESA","name":"Mesa","purchased_quantity":1,"has_assembly":"Nao"},{"sku":"CAD","name":"Cadeira","purchased_quantity":1,"has_assembly":"Nao"}]');
  ro := pd_make_route(o, 'R-S14'); PERFORM pd_deliver_all(ro); PERFORM pd_finalize(ro);
  PERFORM pd_assert((SELECT count(*) FROM assembly_products WHERE order_id=o)=0, 'S14 pedido sem montagem nao gera montagem');
END $$;

-- S15: Retirada (pickup) gera montagem ---------------------------------------
DO $$
DECLARE o uuid;
BEGIN
  o := pd_make_order('S15', '[{"sku":"ROUP","name":"Roupeiro","purchased_quantity":1,"has_assembly":"Sim"}]');
  UPDATE orders SET status='delivered' WHERE id=o;  -- retirada balcao
  BEGIN PERFORM public.sync_missing_assembly_products_for_pickup(o); EXCEPTION WHEN others THEN RAISE WARNING 'BUG: S15 retirada gerou erro | %', sqlerrm; END;
  PERFORM pd_assert((SELECT count(*) FROM assembly_products WHERE order_id=o AND status<>'cancelled')=1, 'S15 retirada gera montagem');
END $$;

-- S16: Over-return (devolver mais que comprado) ------------------------------
DO $$
DECLARE o uuid; ro uuid;
BEGIN
  o := pd_make_order('S16', '[{"sku":"ROUP","name":"Roupeiro","purchased_quantity":1,"has_assembly":"Sim"}]');
  ro := pd_make_route(o, 'R-S16'); PERFORM pd_deliver_all(ro); PERFORM pd_finalize(ro);
  PERFORM public.ingest_erp_return('S16','[{"codigo":"ROUP","qtd":5}]'::jsonb,'NF-S16','ch',null,now(),'dev');
  -- Correto: over-return NAO deve quebrar (crash) e deve ser ISOLADO como divergente,
  -- sem corromper o saldo do pedido (o item entregue continua com restante 0).
  PERFORM pd_assert((SELECT processing_status FROM order_returns r JOIN orders o2 ON o2.id=r.order_id WHERE o2.order_id_erp='S16')='divergent', 'S16 over-return isolado como DIVERGENTE (sem crash, sem corromper saldo)');
  PERFORM pd_assert((SELECT remaining_deliverable_quantity FROM order_item_shadow_balances WHERE order_id=o AND sku='ROUP')=0, 'S16 saldo do pedido intacto apesar do over-return');
END $$;

-- S17: Variacoes de "tem montagem" (Sim/SIM/s/true/1/yes) ---------------------
DO $$
DECLARE o uuid; ro uuid; n int;
BEGIN
  o := pd_make_order('S17', '[{"sku":"A","name":"A","purchased_quantity":1,"has_assembly":"Sim"},{"sku":"B","name":"B","purchased_quantity":1,"has_assembly":"SIM"},{"sku":"C","name":"C","purchased_quantity":1,"has_assembly":"s"},{"sku":"D","name":"D","purchased_quantity":1,"has_assembly":"true"},{"sku":"E","name":"E","purchased_quantity":1,"has_assembly":"1"},{"sku":"F","name":"F","purchased_quantity":1,"has_assembly":"yes"}]');
  ro := pd_make_route(o, 'R-S17'); PERFORM pd_deliver_all(ro); PERFORM pd_finalize(ro);
  SELECT count(*) INTO n FROM assembly_products WHERE order_id=o AND status<>'cancelled';
  PERFORM pd_assert(n=6, 'S17 todas as formas de "tem montagem" reconhecidas', 'montagens='||n||' (esperado 6)');
END $$;

-- S18: Bloqueio de iniciar rota so p/ TOTAL (parcial NAO bloqueia) ------------
DO $$
DECLARE o uuid; ro uuid; v_route uuid; blk int;
BEGIN
  o := pd_make_order('S18', '[{"sku":"AA","name":"AA","purchased_quantity":1,"has_assembly":"Nao"},{"sku":"BB","name":"BB","purchased_quantity":1,"has_assembly":"Nao"}]');
  PERFORM public.ingest_erp_return('S18','[{"codigo":"AA","qtd":1}]'::jsonb,'NF-S18','ch',null,now(),'dev');
  ro := pd_make_route(o, 'R-S18'); SELECT route_id INTO v_route FROM route_orders WHERE id=ro;
  SELECT count(*) INTO blk FROM public.get_route_start_return_blockers(v_route);
  PERFORM pd_assert(blk=0, 'S18 devolucao PARCIAL nao bloqueia iniciar rota', 'blockers='||blk||' (esperado 0)');
END $$;

-- ===========================================================================
-- RETIRADA POR ITEM (picked_up) — bateria nova
-- ===========================================================================

-- SR1: retira 1 item; o restante segue pra rota, entrega e finaliza SEM re-fila.
DO $$
DECLARE o uuid; ro uuid; n int;
BEGIN
  o := pd_make_order('SR1', '[{"sku":"ROUP","name":"Roupeiro","purchased_quantity":1,"has_assembly":"Sim"},{"sku":"MESA","name":"Mesa","purchased_quantity":1,"has_assembly":"Nao"}]');
  PERFORM pd_pickup(o, ARRAY['MESA']);  -- cliente retira a mesa
  PERFORM pd_assert((SELECT remaining_deliverable_quantity FROM order_item_shadow_balances WHERE order_id=o AND sku='MESA')=0, 'SR1 mesa retirada: saldo restante 0');
  PERFORM pd_assert((SELECT remaining_deliverable_quantity FROM order_item_shadow_balances WHERE order_id=o AND sku='ROUP')=1, 'SR1 roupeiro segue: restante 1');
  ro := pd_make_route(o, 'R-SR1');
  SELECT count(*) INTO n FROM route_order_items WHERE route_order_id=ro;
  PERFORM pd_assert(n=1, 'SR1 snapshot da rota traz SO o roupeiro', 'itens='||n||' (esperado 1)');
  PERFORM pd_assert((SELECT count(*) FROM route_order_items WHERE route_order_id=ro AND sku_snapshot='MESA')=0, 'SR1 item retirado NAO entra na rota (sem entrega dupla)');
  PERFORM pd_deliver_all(ro); PERFORM pd_finalize(ro);
  PERFORM pd_assert((SELECT status FROM orders WHERE id=o)='delivered', 'SR1 pedido concluido (NAO re-enfileira o retirado)');
  PERFORM pd_assert((SELECT coalesce(return_flag,false) FROM orders WHERE id=o)=false, 'SR1 sem return_flag falso');
END $$;

-- SR2: retirada de item COM montagem gera a montagem do item retirado.
DO $$
DECLARE o uuid;
BEGIN
  o := pd_make_order('SR2', '[{"sku":"ROUP","name":"Roupeiro","purchased_quantity":1,"has_assembly":"Sim"}]');
  PERFORM pd_pickup(o, ARRAY['ROUP']);
  PERFORM pd_assert((SELECT count(*) FROM assembly_products WHERE order_id=o AND product_sku='ROUP' AND status<>'cancelled')=1, 'SR2 montagem do item retirado gerada');
  PERFORM pd_assert((SELECT remaining_deliverable_quantity FROM order_item_shadow_balances WHERE order_id=o AND sku='ROUP')=0, 'SR2 retirado: restante 0');
END $$;

-- SR3: retira TODOS os itens -> nada entra na rota; saldo zerado.
DO $$
DECLARE o uuid; ro uuid; n int;
BEGIN
  o := pd_make_order('SR3', '[{"sku":"AA","name":"AA","purchased_quantity":1,"has_assembly":"Nao"},{"sku":"BB","name":"BB","purchased_quantity":1,"has_assembly":"Nao"}]');
  PERFORM pd_pickup(o, ARRAY['AA','BB']);
  PERFORM pd_assert((SELECT coalesce(sum(remaining_deliverable_quantity),0) FROM order_item_shadow_balances WHERE order_id=o)=0, 'SR3 tudo retirado: nada restante');
  ro := pd_make_route(o, 'R-SR3');
  SELECT count(*) INTO n FROM route_order_items WHERE route_order_id=ro;
  PERFORM pd_assert(n=0, 'SR3 nenhum item retirado entra na rota', 'itens='||n||' (esperado 0)');
END $$;

-- SR4: entrega parcial normal + retirada do que "nao coube" -> pedido conclui.
DO $$
DECLARE o uuid; ro uuid;
BEGIN
  o := pd_make_order('SR4', '[{"sku":"ROUP","name":"Roupeiro","purchased_quantity":1,"has_assembly":"Sim"},{"sku":"MESA","name":"Mesa","purchased_quantity":1,"has_assembly":"Nao"}]');
  ro := pd_make_route(o, 'R-SR4'); PERFORM pd_deliver_skus(ro, ARRAY['ROUP']); PERFORM pd_finalize(ro);
  PERFORM pd_assert((SELECT status FROM orders WHERE id=o)='pending', 'SR4 mesa nao coube: pedido volta pra fila');
  PERFORM pd_pickup(o, ARRAY['MESA']);  -- cliente decide retirar a mesa que faltava
  PERFORM pd_assert((SELECT coalesce(sum(remaining_deliverable_quantity),0) FROM order_item_shadow_balances WHERE order_id=o)=0, 'SR4 depois da retirada: nada restante');
END $$;

-- SR5: LIBERACAO DE LOJA respeita retirada PARCIAL (nao libera o que ficou).
INSERT INTO public.app_settings(key, value)
  VALUES ('store_release_control', '{"enabled":true,"only_block_disassemblable_items":true}'::jsonb)
  ON CONFLICT (key) DO UPDATE SET value=excluded.value;
DO $$
DECLARE o uuid; st text; rc int;
BEGIN
  o := pd_make_order('SRL5', '[{"sku":"AA","name":"A","purchased_quantity":1,"location":"LOJA MOSSORO","possui_montagem":"Sim"},{"sku":"BB","name":"B","purchased_quantity":1,"location":"ATACADO LOJA ASSU","possui_montagem":"Sim"}]');
  UPDATE public.orders SET import_source='lote' WHERE id=o;
  PERFORM public.sync_store_release_for_order(o);
  SELECT store_release_status INTO st FROM public.orders WHERE id=o;
  PERFORM pd_assert(st='pending', 'SR5 liberacao exigida nos 2 locais controlados', 'status='||coalesce(st,'null'));
  SELECT count(*) INTO rc FROM public.store_release_assignments WHERE order_id=o;
  PERFORM pd_assert(rc=2, 'SR5 2 locais pendentes', 'count='||rc);

  PERFORM pd_pickup(o, ARRAY['AA']);  -- cliente retira o item da LOJA MOSSORO
  PERFORM public.sync_store_release_for_order(o);
  SELECT store_release_status INTO st FROM public.orders WHERE id=o;
  PERFORM pd_assert(st='pending', 'SR5 retirada PARCIAL NAO zera a liberacao do que ficou', 'status='||coalesce(st,'null'));
  SELECT count(*) INTO rc FROM public.store_release_assignments WHERE order_id=o AND store_location='ATACADO LOJA ASSU';
  PERFORM pd_assert(rc=1, 'SR5 item que ficou ainda exige liberacao', 'count='||rc);
  SELECT count(*) INTO rc FROM public.store_release_assignments WHERE order_id=o AND store_location='LOJA MOSSORO';
  PERFORM pd_assert(rc=0, 'SR5 local do item retirado nao exige mais liberacao', 'count='||rc);
END $$;

-- SR6: retirada do PEDIDO INTEIRO (items null) zera a liberacao (comportamento antigo).
DO $$
DECLARE o uuid; st text;
BEGIN
  o := pd_make_order('SRL6', '[{"sku":"CC","name":"C","purchased_quantity":1,"location":"LOJA MOSSORO","possui_montagem":"Sim"}]');
  UPDATE public.orders SET import_source='lote' WHERE id=o;
  PERFORM public.sync_store_release_for_order(o);
  PERFORM pd_assert((SELECT store_release_status FROM public.orders WHERE id=o)='pending', 'SR6 exige liberacao antes da retirada');
  -- retirada do pedido inteiro: order_withdrawals com items NULL
  INSERT INTO public.order_withdrawals(order_id, responsible_name, items) VALUES (o, 'Gerente', NULL);
  PERFORM public.sync_store_release_for_order(o);
  SELECT store_release_status INTO st FROM public.orders WHERE id=o;
  PERFORM pd_assert(st='not_applicable', 'SR6 retirada INTEIRA zera a liberacao', 'status='||coalesce(st,'null'));
END $$;

-- SR7: VARIAS retiradas por pedido (a 2a nao sobrescreve a 1a).
DO $$
DECLARE o uuid; n int;
BEGIN
  o := pd_make_order('SRL7', '[{"sku":"XX","name":"X","purchased_quantity":1},{"sku":"YY","name":"Y","purchased_quantity":1}]');
  INSERT INTO public.order_withdrawals(order_id, responsible_name, items) VALUES (o, 'Gerente A', '[{"sku":"XX"}]'::jsonb);
  INSERT INTO public.order_withdrawals(order_id, responsible_name, items) VALUES (o, 'Gerente B', '[{"sku":"YY"}]'::jsonb);
  SELECT count(*) INTO n FROM public.order_withdrawals WHERE order_id=o;
  PERFORM pd_assert(n=2, 'SR7 pedido aceita 2 retiradas (registros preservados)', 'count='||n||' (esperado 2)');
  PERFORM pd_assert((SELECT count(*) FROM public.order_withdrawals WHERE order_id=o AND responsible_name='Gerente A')=1, 'SR7 comprovante da 1a retirada nao foi sobrescrito');
END $$;

\echo '==== FIM DA BATERIA ===='
