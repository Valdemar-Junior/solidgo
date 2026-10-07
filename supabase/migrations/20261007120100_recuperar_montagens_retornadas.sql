-- ============================================================================
-- RECUPERACAO: montagens retornadas pelo montador que ficaram sem card novo
-- ----------------------------------------------------------------------------
-- O gatilho 20261007120000 vale dali pra frente. Este script cuida de quem ja
-- estava parado: pedido cujo card foi RETORNADO pelo montador (cancelled com
-- was_returned = false) e que hoje NAO TEM NENHUM card ativo — ou seja, sumiu
-- da Gestao de Montagem e nao da pra roteirizar de novo.
--
-- NAO toca em: devolucao do ERP (was_returned = true), pedido que ja ganhou
-- card novo, e retorno antigo demais (corte em 01/09/2026 — historico anterior
-- ninguem vai reagendar).
--
-- Cria UM card por pedido+SKU, igual ao que o aplicativo criaria na finalizacao
-- da rota. Rodar duas vezes nao cria nada a mais.
-- ============================================================================

CREATE TEMP TABLE IF NOT EXISTS recuperacao_remontagem (
  order_id_erp text, cliente text, produto text, retornada_em timestamptz, motivo text);
TRUNCATE recuperacao_remontagem;

DO $$
DECLARE r record; v_criados integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (ap.order_id, ap.product_sku)
           ap.id, ap.order_id, ap.product_name, ap.product_sku, ap.customer_name,
           ap.customer_phone, ap.installation_address, ap.mount_priority, ap.import_source,
           ap.returned_at, coalesce(nullif(trim(ap.return_reason), ''), nullif(trim(ap.observations), ''), '(sem motivo)') AS motivo
    FROM public.assembly_products ap
    WHERE ap.status = 'cancelled'
      AND coalesce(ap.was_returned, false) = false
      AND ap.returned_at >= '2026-09-01'
      AND NOT EXISTS (SELECT 1 FROM public.assembly_products a2
                       WHERE a2.order_id = ap.order_id AND a2.status <> 'cancelled')
    ORDER BY ap.order_id, ap.product_sku, ap.returned_at DESC
  LOOP
    BEGIN
      INSERT INTO public.assembly_products (
        order_id, product_name, product_sku, customer_name, customer_phone,
        installation_address, mount_priority, import_source,
        status, assembly_route_id, was_returned, created_at, updated_at
      ) VALUES (
        r.order_id, r.product_name, r.product_sku, r.customer_name, r.customer_phone,
        r.installation_address, r.mount_priority, r.import_source,
        'pending', NULL, true, timezone('utc', now()), timezone('utc', now())
      );
      v_criados := v_criados + 1;

      INSERT INTO recuperacao_remontagem
      SELECT o.order_id_erp, r.customer_name, r.product_name, r.returned_at, r.motivo
      FROM public.orders o WHERE o.id = r.order_id;
    EXCEPTION WHEN others THEN
      INSERT INTO recuperacao_remontagem VALUES (NULL, r.customer_name, r.product_name, r.returned_at, 'ERRO: ' || sqlerrm);
    END;
  END LOOP;
  RAISE NOTICE 'cards de remontagem criados: %', v_criados;
END $$;

-- RELATORIO
SELECT order_id_erp AS pedido, cliente, produto,
       to_char(retornada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS retornada_em,
       motivo
FROM recuperacao_remontagem
ORDER BY retornada_em DESC NULLS LAST;
