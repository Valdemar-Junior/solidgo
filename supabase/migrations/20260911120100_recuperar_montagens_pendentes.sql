-- ============================================================================
-- RECUPERACAO (v3): camada nova + montagem que faltou
-- ----------------------------------------------------------------------------
-- QUEM FOI AFETADO: pedidos importados a partir de 07/09/2026 pelo site antigo
-- (commit 3d418e0), que nao preenche a camada nova (order_items). Sem ela, a
-- montagem falha EM SILENCIO quando a rota e finalizada ou a retirada registrada.
--
-- ETAPA 1 - preencher a camada nova de TODO pedido que esta sem ela (qualquer
--   status). E o que conserta os pedidos que AINDA vao ser entregues: com a
--   camada preenchida, o proprio site (antigo ou novo) gera a montagem normal
--   quando o motorista finalizar a rota.
--
-- ETAPA 2 - gerar a montagem dos pedidos JA entregues que ficaram sem ela,
--   pela MESMA funcao que o site teria chamado:
--     * retirada na loja (order_withdrawals)  -> ..._for_pickup
--     * rota finalizada                      -> ..._for_order
--     * rota ainda na rua                    -> nada (nasce sozinha ao finalizar)
--
-- NAO inventa, NAO duplica (as funcoes contam o que existe e criam so a
-- diferenca), NAO gera montagem de item devolvido (o saldo ja desconta).
-- Rodar duas vezes nao cria nada a mais. Erro em um pedido desfaz so ele.
--
-- >>> RODAR DEPOIS DO GATILHO (20260911120000_order_items_nasce_no_insert.sql) <<<
-- ============================================================================

CREATE TEMP TABLE IF NOT EXISTS recuperacao_montagem (
  order_id_erp text, cliente text, caminho text, situacao text,
  itens_camada_nova int, montagens_criadas int, observacao text);
TRUNCATE recuperacao_montagem;
CREATE TEMP TABLE IF NOT EXISTS recuperacao_camada (etapa text, pedidos int);
TRUNCATE recuperacao_camada;

-- ETAPA 1 --------------------------------------------------------------------
DO $$
DECLARE r record; v_ok int := 0; v_falhas int := 0;
BEGIN
  FOR r IN
    SELECT o.id, o.order_id_erp, o.customer_name
    FROM public.orders o
    WHERE jsonb_typeof(o.items_json) = 'array'
      AND jsonb_array_length(o.items_json) > 0
      AND NOT EXISTS (SELECT 1 FROM public.order_items oi
                      WHERE oi.order_id = o.id AND oi.source_present)
  LOOP
    BEGIN
      PERFORM public.sync_order_items_shadow(r.id);
      v_ok := v_ok + 1;
    EXCEPTION WHEN others THEN
      v_falhas := v_falhas + 1;
      INSERT INTO recuperacao_montagem VALUES (
        r.order_id_erp, r.customer_name, 'camada', 'ERRO ao preencher a camada', NULL, 0, sqlerrm);
    END;
  END LOOP;
  INSERT INTO recuperacao_camada VALUES
    ('1. camada nova preenchida', v_ok),
    ('1. falhas ao preencher a camada', v_falhas);
END $$;

-- ETAPA 2 --------------------------------------------------------------------
DO $$
DECLARE
  r record; v_resultado jsonb; v_rota_status text;
  v_retirada boolean; v_retirada_parc boolean; v_caminho text; v_criadas int;
BEGIN
  FOR r IN
    SELECT o.id, o.order_id_erp, o.customer_name
    FROM public.orders o
    WHERE o.status = 'delivered'
      AND o.created_at >= '2026-08-01'
      AND public.order_item_payload_requires_assembly(o.items_json)
      AND NOT EXISTS (SELECT 1 FROM public.assembly_products ap
                      WHERE ap.order_id = o.id AND ap.status <> 'cancelled')
    ORDER BY o.order_id_erp
  LOOP
    SELECT count(*) > 0, coalesce(bool_or(w.items IS NOT NULL), false)
      INTO v_retirada, v_retirada_parc
      FROM public.order_withdrawals w WHERE w.order_id = r.id;

    SELECT rt.status INTO v_rota_status
      FROM public.route_orders ro JOIN public.routes rt ON rt.id = ro.route_id
     WHERE ro.order_id = r.id AND upper(coalesce(rt.name, '')) NOT LIKE 'COLETA-%'
     ORDER BY coalesce(rt.updated_at, rt.created_at) DESC LIMIT 1;

    IF v_retirada AND v_retirada_parc THEN
      INSERT INTO recuperacao_montagem VALUES (r.order_id_erp, r.customer_name, 'retirada',
        'PULADO - tratar a mao', NULL, 0, 'retirada PARCIAL: conferir quais itens o cliente levou');
      CONTINUE;
    ELSIF v_retirada THEN
      v_caminho := 'retirada';
    ELSIF v_rota_status = 'completed' THEN
      v_caminho := 'rota';
    ELSIF v_rota_status IS NOT NULL THEN
      INSERT INTO recuperacao_montagem VALUES (r.order_id_erp, r.customer_name, 'rota',
        'AGUARDANDO - rota na rua', NULL, 0,
        'camada ja preenchida; a montagem nasce sozinha quando o motorista finalizar a rota');
      CONTINUE;
    ELSE
      INSERT INTO recuperacao_montagem VALUES (r.order_id_erp, r.customer_name, '-',
        'PULADO - tratar a mao', NULL, 0, 'sem retirada registrada e sem rota');
      CONTINUE;
    END IF;

    BEGIN
      PERFORM public.sync_order_items_shadow(r.id);
      IF v_caminho = 'retirada' THEN
        v_resultado := public.sync_missing_assembly_products_for_pickup(r.id);
      ELSE
        v_resultado := public.sync_missing_assembly_products_for_order(r.id);
      END IF;
      v_criadas := coalesce((v_resultado->>'inserted_products')::int, 0);
      INSERT INTO recuperacao_montagem SELECT
        r.order_id_erp, r.customer_name, v_caminho,
        CASE WHEN v_criadas > 0 THEN 'OK - montagem gerada' ELSE 'SEM MONTAGEM - conferir' END,
        (SELECT count(*)::int FROM public.order_items oi WHERE oi.order_id = r.id AND oi.source_present),
        v_criadas,
        CASE WHEN v_criadas > 0 THEN NULL
             ELSE 'camada preenchida, mas saldo zerado (item devolvido no ERP?)' END;
    EXCEPTION WHEN others THEN
      INSERT INTO recuperacao_montagem VALUES (r.order_id_erp, r.customer_name, v_caminho,
        'ERRO - nada foi feito neste pedido', NULL, 0, sqlerrm);
    END;
  END LOOP;
END $$;

-- RELATORIO (para ver pedido por pedido, NA MESMA ABA:
--   select * from recuperacao_montagem order by situacao, order_id_erp;)
SELECT etapa AS o_que, pedidos, NULL::int AS montagens_criadas FROM recuperacao_camada
UNION ALL
SELECT '2. ' || caminho || ' | ' || situacao, count(*)::int, sum(montagens_criadas)::int
FROM recuperacao_montagem WHERE caminho <> 'camada'
GROUP BY caminho, situacao
ORDER BY 1;
