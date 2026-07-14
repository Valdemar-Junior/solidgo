-- ============================================================================
-- Saldo (view) DESCONTA o item retirado (picked_up)
-- ----------------------------------------------------------------------------
-- Até aqui, remaining_deliverable_quantity = saldo − entregue, e NÃO considerava
-- a retirada (order_item_holds status 'picked_up'). Consequência real observada:
-- ao finalizar a rota, o sistema via o item retirado ainda com saldo > 0, achava
-- que faltava entregar, e re-enfileirava o pedido com return_flag = true ("Devolução
-- parcial" falsa). Também deixava o item retirado "entregável" em relatórios/consulta.
--
-- Aqui remaining_deliverable_quantity passa a ser:
--     saldo(ERP) − entregue − RETIRADO
-- Assim um item retirado por inteiro fica com remaining = 0 e some de TODO o caminho
-- de entrega (fila, snapshot da rota, reconciliação, consulta), de forma consistente.
--
-- NÃO muda shadow_deliverable_quantity (comprado − devolvido-ERP), que a montagem e a
-- reconciliação de devolução do ERP continuam usando. Aditivo e seguro.
-- Preserva security_invoker = true. Grants mantidos pelo REPLACE.
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.order_item_shadow_balances
WITH (security_invoker = true) AS
  SELECT
    oi.id AS order_item_id,
    oi.order_id,
    oi.source_line_key,
    oi.sku,
    oi.product_name,
    oi.storage_location,
    oi.kit_code,
    oi.source_present,
    oi.purchased_quantity,
    COALESCE(ret.returned_quantity, 0::numeric) AS returned_quantity,
    GREATEST(oi.purchased_quantity - COALESCE(ret.returned_quantity, 0::numeric), 0::numeric) AS shadow_deliverable_quantity,
    COALESCE(ret.returned_quantity, 0::numeric) > oi.purchased_quantity AS has_over_return,
    COALESCE(del.delivered_quantity, 0::numeric) AS delivered_quantity,
    -- remaining = saldo − entregue − RETIRADO
    GREATEST(
      GREATEST(oi.purchased_quantity - COALESCE(ret.returned_quantity, 0::numeric), 0::numeric)
        - COALESCE(del.delivered_quantity, 0::numeric)
        - COALESCE(pick.picked_up_quantity, 0::numeric),
      0::numeric
    ) AS remaining_deliverable_quantity
  FROM order_items oi
    LEFT JOIN (
      SELECT ori.order_item_id,
             sum(ori.returned_quantity) AS returned_quantity
      FROM order_return_items ori
        JOIN order_returns r ON r.id = ori.return_id
      WHERE ori.order_item_id IS NOT NULL
        AND r.processing_status = 'processed'::text
      GROUP BY ori.order_item_id
    ) ret ON ret.order_item_id = oi.id
    LEFT JOIN (
      SELECT roi.order_item_id,
             sum(roi.delivered_quantity) AS delivered_quantity
      FROM route_order_items roi
        JOIN routes rt ON rt.id = roi.route_id
      WHERE roi.order_item_id IS NOT NULL
        AND roi.delivered_quantity > 0
        AND rt.status = 'completed'::text
        AND upper(COALESCE(rt.name, ''::text)) NOT LIKE 'COLETA-%'
      GROUP BY roi.order_item_id
    ) del ON del.order_item_id = oi.id
    -- NOVO: quantidade retirada (linha inteira) quando há uma retirada 'picked_up'.
    LEFT JOIN (
      SELECT oi2.id AS order_item_id, oi2.purchased_quantity AS picked_up_quantity
      FROM order_items oi2
      WHERE EXISTS (
        SELECT 1 FROM order_item_holds h
        WHERE h.order_id = oi2.order_id
          AND h.status = 'picked_up'
          AND (
            h.order_item_id = oi2.id
            OR (h.source_line_key IS NOT NULL AND h.source_line_key = oi2.source_line_key)
            OR (h.sku IS NOT NULL AND oi2.sku IS NOT NULL
                AND lower(btrim(h.sku)) = lower(btrim(oi2.sku))
                AND lower(COALESCE(h.storage_location, '')) = lower(COALESCE(oi2.storage_location, '')))
          )
      )
    ) pick ON pick.order_item_id = oi.id;

COMMIT;
