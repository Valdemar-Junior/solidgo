-- ============================================================================
-- Entrega parcial por item — FASE 1A: "entregue até agora" na view de saldo
-- ============================================================================
-- Adiciona DUAS colunas novas à view order_item_shadow_balances, SEM mexer nas
-- existentes (aditivo, não quebra nada):
--   * delivered_quantity            = quanto do item JÁ foi entregue (soma de
--     route_order_items.delivered_quantity em rotas de ENTREGA finalizadas).
--   * remaining_deliverable_quantity = saldo − entregue (o que ainda falta entregar).
--
-- shadow_deliverable_quantity (comprado − devolvido-ERP) CONTINUA IGUAL — é o que
-- a reconciliação de devolução do ERP usa. As fases seguintes vão passar a usar as
-- colunas novas na fila/snapshot (roteirização) e na montagem.
--
-- Como HOJE não existe pedido parcialmente entregue (entrega é tudo-ou-nada),
-- delivered_quantity ainda é 0 ou = entregável em todos os casos atuais, então
-- remaining = shadow e o comportamento não muda. É infraestrutura pura.
--
-- Preserva security_invoker=true (Bloco 2). Grants são mantidos pelo REPLACE.
-- ============================================================================

BEGIN;

-- Índice pra a soma de entregues não pesar (idempotente).
CREATE INDEX IF NOT EXISTS idx_route_order_items_order_item_id
  ON public.route_order_items (order_item_id);

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
    -- NOVO: quanto já foi entregue deste item (rotas de ENTREGA finalizadas).
    COALESCE(del.delivered_quantity, 0::numeric) AS delivered_quantity,
    -- NOVO: o que ainda falta entregar = saldo − entregue.
    GREATEST(
      GREATEST(oi.purchased_quantity - COALESCE(ret.returned_quantity, 0::numeric), 0::numeric)
        - COALESCE(del.delivered_quantity, 0::numeric),
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
    ) del ON del.order_item_id = oi.id;

COMMIT;
