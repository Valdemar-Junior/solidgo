-- ============================================================================
-- A camada por item (order_items) passa a nascer sozinha, no INSERT do pedido
-- ----------------------------------------------------------------------------
-- PROBLEMA (confirmado em producao em 11/09/2026):
--   A funcao que gera montagem no fechamento da rota
--   (sync_missing_assembly_products_for_order) le a camada NOVA: order_items +
--   order_item_shadow_balances. Quem preenche essa camada e a tela de Importacao,
--   chamando sync_order_items_shadow explicitamente.
--
--   So que NAO existe gatilho de INSERT em orders. So existe o de UPDATE
--   (trg_orders_resync_items_shadow, migration 20260709190000). A decisao na epoca
--   foi "a importacao ja chama o sync explicitamente".
--
--   Resultado: qualquer origem de pedido que NAO faca essa chamada (um commit
--   antigo do site, o n8n, um insert manual) cria o pedido com a camada nova
--   VAZIA. A funcao de montagem nao acha item nenhum, devolve inserted_products: 0
--   SEM ERRO, a rota finaliza normal e a montagem nunca nasce. Falha silenciosa.
--
--   Em 11/09/2026 isso deixou 54 pedidos entregues sem montagem.
--
-- SOLUCAO:
--   Um gatilho AFTER INSERT, irmao do de UPDATE que ja existe, usando a MESMA
--   funcao (trg_resync_order_items_shadow). A camada nova passa a nascer sozinha,
--   independente de qual versao do site esta no ar.
--
-- SEGURANCA:
--   * Reusa a funcao existente: nada novo pra dar errado.
--   * Ela ja envelopa a chamada em bloco de excecao: se falhar, grava WARNING no
--     log e NAO bloqueia a criacao do pedido. Importacao nunca quebra por causa disso.
--   * sync_order_items_shadow so mexe em order_items / item_fulfillment_sync_issues
--     (nunca em orders), entao nao ha risco de recursao do gatilho.
--   * A funcao e idempotente: se a tela nova ALEM disso chamar a RPC, o segundo
--     sync so reconfirma o mesmo resultado. Custa um pouco de tempo, nao duplica dado.
--   * So dispara quando o pedido ja nasce com itens (WHEN items_json IS NOT NULL).
--     Pedido que recebe os itens depois continua coberto pelo gatilho de UPDATE.
-- ============================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_orders_sync_items_shadow_insert ON public.orders;

CREATE TRIGGER trg_orders_sync_items_shadow_insert
AFTER INSERT ON public.orders
FOR EACH ROW
WHEN (NEW.items_json IS NOT NULL)
EXECUTE FUNCTION public.trg_resync_order_items_shadow();

COMMIT;

-- ----------------------------------------------------------------------------
-- CONFERENCIA (so leitura): devem aparecer DOIS gatilhos, o de insert e o de update.
-- ----------------------------------------------------------------------------
SELECT
  tgname                                  AS gatilho,
  pg_get_triggerdef(t.oid)                AS definicao
FROM pg_trigger t
WHERE t.tgrelid = 'public.orders'::regclass
  AND NOT t.tgisinternal
  AND tgname LIKE '%items_shadow%'
ORDER BY tgname;
