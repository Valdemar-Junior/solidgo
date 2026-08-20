-- ============================================================================
-- Permite VÁRIAS retiradas por pedido (1 linha por evento de retirada)
-- ----------------------------------------------------------------------------
-- Antes, order_withdrawals tinha UNIQUE(order_id) e o app fazia upsert — então uma
-- segunda retirada parcial do mesmo pedido SOBRESCREVIA o registro/comprovante da
-- primeira (perda de auditoria). Removendo o UNIQUE, cada retirada vira um registro
-- próprio, com seu snapshot de itens (coluna items) e seu comprovante reimprimível.
-- Os itens em si já eram controlados por order_item_holds (picked_up), sem risco de
-- entrega dupla — isto é só sobre preservar o histórico/comprovante de cada retirada.
-- ============================================================================

ALTER TABLE public.order_withdrawals
  DROP CONSTRAINT IF EXISTS order_withdrawals_order_unique;

-- Índice comum pra consultar as retiradas de um pedido (não único).
CREATE INDEX IF NOT EXISTS idx_order_withdrawals_order_id
  ON public.order_withdrawals USING btree (order_id);
