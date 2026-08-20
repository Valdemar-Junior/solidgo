-- =====================================================================
-- Funcionalidade "Em Espera" (agendamento / retirada por item)
-- ---------------------------------------------------------------------
-- Cria a tabela order_item_holds: guarda os ITENS que foram "pausados"
-- (tirados da fila de roteirizacao) manualmente, com o motivo e a data.
--
-- O move AUTOMATICO (palavra-chave na observacao ou operacao do ERP) NAO
-- grava linha aqui: e calculado na hora pela UI a partir de app_settings
-- ('waiting_auto_rules'). So vira registro nesta tabela quando o operador
-- informa uma data de agendamento ou libera/retira o item.
--
-- Nao mexe no status do pedido, na view de saldos, nem no app do motorista.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.order_item_holds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    order_item_id uuid,
    source_line_key text,
    sku text,
    storage_location text,
    product_name text,
    -- manual   = "cliente vai avisar o dia" (fica ate liberar na mao)
    -- scheduled = "entregar a partir de tal dia" (volta sozinho na data)
    -- retirada  = cliente vem buscar (usa o comprovante de retirada existente)
    hold_type text NOT NULL DEFAULT 'manual',
    scheduled_date date,
    reason text,
    -- active = parado / em espera ; released = liberado (override do automatico)
    status text NOT NULL DEFAULT 'active',
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    released_by uuid,
    released_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT order_item_holds_pkey PRIMARY KEY (id),
    CONSTRAINT order_item_holds_order_id_fkey FOREIGN KEY (order_id)
        REFERENCES public.orders(id) ON DELETE CASCADE,
    CONSTRAINT order_item_holds_order_item_id_fkey FOREIGN KEY (order_item_id)
        REFERENCES public.order_items(id) ON DELETE SET NULL,
    CONSTRAINT order_item_holds_type_check
        CHECK (hold_type = ANY (ARRAY['manual'::text, 'scheduled'::text, 'retirada'::text])),
    CONSTRAINT order_item_holds_status_check
        CHECK (status = ANY (ARRAY['active'::text, 'released'::text]))
);

COMMENT ON TABLE public.order_item_holds IS
    'Itens tirados da fila de roteirizacao (aba "Em Espera"): agendamento, espera do cliente e retirada, a nivel de item.';

-- Evita duas pausas ATIVAS para a mesma linha do mesmo pedido.
CREATE UNIQUE INDEX IF NOT EXISTS order_item_holds_active_uq
    ON public.order_item_holds (order_id, COALESCE(source_line_key, ''), COALESCE(sku, ''))
    WHERE (status = 'active');

CREATE INDEX IF NOT EXISTS idx_order_item_holds_order_id
    ON public.order_item_holds USING btree (order_id);

CREATE INDEX IF NOT EXISTS idx_order_item_holds_status
    ON public.order_item_holds USING btree (status);

-- ---------------------------------------------------------------------
-- RLS: mesmo padrao das outras tabelas operacionais (order_withdrawals):
-- qualquer usuario autenticado le e escreve (as telas ja sao restritas
-- por papel na aplicacao).
-- ---------------------------------------------------------------------
ALTER TABLE public.order_item_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_item_holds_select_authenticated ON public.order_item_holds;
CREATE POLICY order_item_holds_select_authenticated
    ON public.order_item_holds FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS order_item_holds_insert_authenticated ON public.order_item_holds;
CREATE POLICY order_item_holds_insert_authenticated
    ON public.order_item_holds FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS order_item_holds_update_authenticated ON public.order_item_holds;
CREATE POLICY order_item_holds_update_authenticated
    ON public.order_item_holds FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS order_item_holds_delete_authenticated ON public.order_item_holds;
CREATE POLICY order_item_holds_delete_authenticated
    ON public.order_item_holds FOR DELETE TO authenticated USING (true);

-- ---------------------------------------------------------------------
-- Config das regras de move automatico para "Em Espera".
-- keywords: casam como texto solto dentro de observacoes_internas.
-- operations: casam com raw_json.operacoes.
-- ---------------------------------------------------------------------
INSERT INTO public.app_settings (key, value)
VALUES ('waiting_auto_rules', '{"keywords": ["*retirada*"], "operations": []}'::jsonb)
ON CONFLICT (key) DO NOTHING;
