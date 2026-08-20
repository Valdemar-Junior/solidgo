-- ============================================================================
-- PARTE 2 — 3 colunas em tabelas existentes
-- ----------------------------------------------------------------------------
-- Gerado em 20/08/2026 a partir do dump FRESCO do Banco_Teste_Soligo.
-- RASCUNHO: nao aplicar em producao sem o ensaio sobre backup restaurado.
-- ============================================================================

-- Tres colunas novas em tabelas que JA existem em producao.
-- Nenhuma delas altera comportamento: 'items' fica nula nas retiradas antigas e
-- 'fulfillment_mode' nasce 'legacy', que e exatamente como o sistema opera hoje.

ALTER TABLE public.order_withdrawals ADD COLUMN IF NOT EXISTS items jsonb;

ALTER TABLE public.routes ADD COLUMN IF NOT EXISTS fulfillment_mode text DEFAULT 'legacy'::text NOT NULL;
ALTER TABLE public.routes ADD COLUMN IF NOT EXISTS fulfillment_version integer DEFAULT 1 NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'routes_fulfillment_mode_check') THEN
    ALTER TABLE public.routes ADD CONSTRAINT routes_fulfillment_mode_check
      CHECK ((fulfillment_mode = ANY (ARRAY['legacy'::text, 'itemized'::text])));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'routes_fulfillment_version_check') THEN
    ALTER TABLE public.routes ADD CONSTRAINT routes_fulfillment_version_check
      CHECK ((fulfillment_version >= 1));
  END IF;
END $$;
