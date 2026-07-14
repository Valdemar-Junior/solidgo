-- ============================================================================
-- Bloco 3 (parte 3) — B5: re-sincronizar o saldo por item quando items_json muda
-- ============================================================================
-- PROBLEMA: sync_order_items_shadow() so roda na importacao e no backfill. Se um
-- pedido tem o items_json editado depois (item/quantidade), a camada order_items
-- fica velha e contamina toda a cadeia (saldo -> snapshot -> montagem).
--
-- SOLUCAO: um gatilho AFTER UPDATE OF items_json que re-sincroniza o pedido.
--
-- SEGURANCA/ROBUSTEZ:
--   * So dispara quando o items_json REALMENTE muda (WHEN ... IS DISTINCT FROM).
--   * Quem edita items_json e sempre admin/service_role/postgres, entao o gate de
--     sync_order_items_shadow passa. Ainda assim, a chamada vai dentro de um
--     bloco de excecao: se por qualquer motivo falhar, registra um WARNING e a
--     edicao do pedido NAO e bloqueada (rede de seguranca).
--   * sync so mexe em order_items / item_fulfillment_sync_issues (nao em orders),
--     entao nao ha risco de recursao do gatilho.
--   * Nao dispara em INSERT: a importacao ja chama o sync explicitamente. O gatilho
--     cobre o buraco real, que sao as EDICOES posteriores.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_resync_order_items_shadow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  begin
    perform public.sync_order_items_shadow(NEW.id);
  exception when others then
    -- Nunca bloqueia a edicao do pedido; so avisa no log.
    raise warning 'trg_resync_order_items_shadow: falha ao re-sincronizar order_items do pedido %: %', NEW.id, sqlerrm;
  end;
  return NEW;
end;
$function$;

DROP TRIGGER IF EXISTS trg_orders_resync_items_shadow ON public.orders;
CREATE TRIGGER trg_orders_resync_items_shadow
AFTER UPDATE OF items_json ON public.orders
FOR EACH ROW
WHEN (NEW.items_json IS DISTINCT FROM OLD.items_json)
EXECUTE FUNCTION public.trg_resync_order_items_shadow();

COMMIT;
