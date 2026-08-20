-- ============================================================================
-- PARTE 4 — view do saldo por item
-- ----------------------------------------------------------------------------
-- Gerado em 20/08/2026 a partir do dump FRESCO do Banco_Teste_Soligo.
-- RASCUNHO: nao aplicar em producao sem o ensaio sobre backup restaurado.
-- ============================================================================

--
-- Name: order_item_shadow_balances; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.order_item_shadow_balances WITH (security_invoker='true') AS
 SELECT oi.id AS order_item_id,
    oi.order_id,
    oi.source_line_key,
    oi.sku,
    oi.product_name,
    oi.storage_location,
    oi.kit_code,
    oi.source_present,
    oi.purchased_quantity,
    COALESCE(ret.returned_quantity, (0)::numeric) AS returned_quantity,
    GREATEST((oi.purchased_quantity - COALESCE(ret.returned_quantity, (0)::numeric)), (0)::numeric) AS shadow_deliverable_quantity,
    (COALESCE(ret.returned_quantity, (0)::numeric) > oi.purchased_quantity) AS has_over_return,
    COALESCE(del.delivered_quantity, (0)::numeric) AS delivered_quantity,
    GREATEST(((GREATEST((oi.purchased_quantity - COALESCE(ret.returned_quantity, (0)::numeric)), (0)::numeric) - COALESCE(del.delivered_quantity, (0)::numeric)) - COALESCE(pick.picked_up_quantity, (0)::numeric)), (0)::numeric) AS remaining_deliverable_quantity
   FROM (((public.order_items oi
     LEFT JOIN ( SELECT ori.order_item_id,
            sum(ori.returned_quantity) AS returned_quantity
           FROM (public.order_return_items ori
             JOIN public.order_returns r ON ((r.id = ori.return_id)))
          WHERE ((ori.order_item_id IS NOT NULL) AND (r.processing_status = 'processed'::text))
          GROUP BY ori.order_item_id) ret ON ((ret.order_item_id = oi.id)))
     LEFT JOIN ( SELECT roi.order_item_id,
            sum(roi.delivered_quantity) AS delivered_quantity
           FROM (public.route_order_items roi
             JOIN public.routes rt ON ((rt.id = roi.route_id)))
          WHERE ((roi.order_item_id IS NOT NULL) AND (roi.delivered_quantity > (0)::numeric) AND (rt.status = 'completed'::text) AND (upper(COALESCE(rt.name, ''::text)) !~~ 'COLETA-%'::text))
          GROUP BY roi.order_item_id) del ON ((del.order_item_id = oi.id)))
     LEFT JOIN ( SELECT oi2.id AS order_item_id,
            oi2.purchased_quantity AS picked_up_quantity
           FROM public.order_items oi2
          WHERE (EXISTS ( SELECT 1
                   FROM public.order_item_holds h
                  WHERE ((h.order_id = oi2.order_id) AND (h.status = 'picked_up'::text) AND ((h.order_item_id = oi2.id) OR ((h.source_line_key IS NOT NULL) AND (h.source_line_key = oi2.source_line_key)) OR ((h.sku IS NOT NULL) AND (oi2.sku IS NOT NULL) AND (lower(btrim(h.sku)) = lower(btrim(oi2.sku))) AND (lower(COALESCE(h.storage_location, ''::text)) = lower(COALESCE(oi2.storage_location, ''::text))))))))) pick ON ((pick.order_item_id = oi.id)));


