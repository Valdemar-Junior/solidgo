-- ============================================================================
-- Montagem retornada pelo montador volta para a fila NA HORA
-- ----------------------------------------------------------------------------
-- COMO E HOJE:
--   Quando o montador nao consegue montar, o card vira status 'cancelled' com
--   returned_at e o motivo. O card novo ("clone de remontagem") so nasce quando
--   a ROTA DE MONTAGEM e finalizada (backgroundSync.syncAssemblyRouteCompletion).
--   Enquanto isso o pedido some da Gestao de Montagem: a tela esconde o card
--   cancelado, entao um pedido cujo unico card foi retornado desaparece da lista
--   e nao pode ser roteirizado de novo.
--
-- PROBLEMAS:
--   * Rota de montagem que fica aberta = cliente sem montagem, invisivel.
--   * A criacao do clone e "best effort" no aplicativo: se falhar, a rota ja foi
--     finalizada e o clone se perde EM SILENCIO.
--   * Depende do aplicativo sincronizar. O banco nao garante nada.
--
-- O QUE MUDA:
--   Um gatilho cria o card novo no instante do retorno, com os MESMOS campos que
--   o aplicativo usa (status pending, sem rota, was_returned = true).
--   Sem duplicar: a conta e a mesma do aplicativo (retornados do mesmo pedido+SKU
--   naquela rota x pendentes sem rota). Quando a rota for finalizada, o
--   aplicativo conta, acha o card ja criado e nao insere nada.
--
-- NAO MUDA A REGRA DE NEGOCIO: hoje a finalizacao da rota ja recria TODO item
-- retornado. O gatilho so antecipa e garante.
--
-- DEVOLUCAO DO ERP NAO ENTRA: card cancelado com was_returned = true e produto
-- que o cliente devolveu — nao ha o que remontar.
--
-- SEGURANCA: o gatilho e envelopado em bloco de excecao. Se falhar, grava
-- WARNING e NAO bloqueia o montador de registrar o retorno.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_assembly_return_requeue() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_retornados integer;
  v_pendentes  integer;
begin
  begin
    -- Devolucao do ERP nao gera remontagem.
    if coalesce(NEW.was_returned, false) then
      return NEW;
    end if;

    -- Mesma conta do aplicativo: retornados deste pedido+SKU NESTA rota...
    select count(*) into v_retornados
    from public.assembly_products ap
    where ap.order_id = NEW.order_id
      and ap.status = 'cancelled'
      and coalesce(ap.was_returned, false) = false
      and ap.product_sku is not distinct from NEW.product_sku
      and ap.assembly_route_id is not distinct from NEW.assembly_route_id;

    -- ...contra os cards ja esperando rota.
    select count(*) into v_pendentes
    from public.assembly_products ap
    where ap.order_id = NEW.order_id
      and ap.status = 'pending'
      and ap.assembly_route_id is null
      and ap.product_sku is not distinct from NEW.product_sku;

    if v_pendentes >= v_retornados then
      return NEW;
    end if;

    insert into public.assembly_products (
      order_id, product_name, product_sku, customer_name, customer_phone,
      installation_address, mount_priority, import_source,
      status, assembly_route_id, was_returned, created_at, updated_at
    ) values (
      NEW.order_id, NEW.product_name, NEW.product_sku, NEW.customer_name, NEW.customer_phone,
      NEW.installation_address, NEW.mount_priority, NEW.import_source,
      'pending', null, true, timezone('utc', now()), timezone('utc', now())
    );

  exception when others then
    -- Nunca impede o montador de registrar o retorno; so avisa no log.
    raise warning 'trg_assembly_return_requeue: falha ao recriar a montagem do pedido %: %', NEW.order_id, sqlerrm;
  end;

  return NEW;
end;
$$;

DROP TRIGGER IF EXISTS trg_assembly_products_requeue_on_return ON public.assembly_products;

CREATE TRIGGER trg_assembly_products_requeue_on_return
AFTER UPDATE OF status ON public.assembly_products
FOR EACH ROW
WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
EXECUTE FUNCTION public.trg_assembly_return_requeue();

COMMIT;

-- ----------------------------------------------------------------------------
-- CONFERENCIA (so leitura): o gatilho tem que aparecer.
-- ----------------------------------------------------------------------------
SELECT tgname AS gatilho, pg_get_triggerdef(t.oid) AS definicao
FROM pg_trigger t
WHERE t.tgrelid = 'public.assembly_products'::regclass
  AND NOT t.tgisinternal
ORDER BY tgname;
