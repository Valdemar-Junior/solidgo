-- ============================================================================
-- PARTE 6 — seguranca (RLS) e permissoes
-- ----------------------------------------------------------------------------
-- Gerado em 20/08/2026 a partir do dump FRESCO do Banco_Teste_Soligo.
-- RASCUNHO: nao aplicar em producao sem o ensaio sobre backup restaurado.
-- ============================================================================

--
-- Name: item_fulfillment_sync_issues; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.item_fulfillment_sync_issues ENABLE ROW LEVEL SECURITY;


--
-- Name: item_fulfillment_sync_issues item_fulfillment_sync_issues_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_fulfillment_sync_issues_select_admin ON public.item_fulfillment_sync_issues FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text)))));



--
-- Name: order_item_holds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_item_holds ENABLE ROW LEVEL SECURITY;


--
-- Name: order_item_holds order_item_holds_delete_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_item_holds_delete_authenticated ON public.order_item_holds FOR DELETE TO authenticated USING (true);



--
-- Name: order_item_holds order_item_holds_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_item_holds_insert_authenticated ON public.order_item_holds FOR INSERT TO authenticated WITH CHECK (true);



--
-- Name: order_item_holds order_item_holds_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_item_holds_select_authenticated ON public.order_item_holds FOR SELECT TO authenticated USING (true);



--
-- Name: order_item_holds order_item_holds_update_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_item_holds_update_authenticated ON public.order_item_holds FOR UPDATE TO authenticated USING (true) WITH CHECK (true);



--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;


--
-- Name: order_items order_items_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_items_select_authenticated ON public.order_items FOR SELECT TO authenticated USING (true);



--
-- Name: order_return_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_return_items ENABLE ROW LEVEL SECURITY;


--
-- Name: order_return_items order_return_items_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_return_items_select_authenticated ON public.order_return_items FOR SELECT TO authenticated USING (true);



--
-- Name: order_returns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_returns ENABLE ROW LEVEL SECURITY;


--
-- Name: order_returns order_returns_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_returns_select_authenticated ON public.order_returns FOR SELECT TO authenticated USING (true);



--
-- Name: route_order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.route_order_items ENABLE ROW LEVEL SECURITY;


--
-- Name: route_order_items route_order_items_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY route_order_items_select_authenticated ON public.route_order_items FOR SELECT TO authenticated USING (true);



--
-- Name: route_order_items route_order_items_update_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY route_order_items_update_authenticated ON public.route_order_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);



--
-- Name: FUNCTION clear_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.clear_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.clear_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.clear_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid) TO service_role;



--
-- Name: FUNCTION clear_return_pickup_after_route_order_delete(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.clear_return_pickup_after_route_order_delete() FROM PUBLIC;
GRANT ALL ON FUNCTION public.clear_return_pickup_after_route_order_delete() TO authenticated;
GRANT ALL ON FUNCTION public.clear_return_pickup_after_route_order_delete() TO service_role;



--
-- Name: FUNCTION clear_return_pickup_before_parent_delete(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.clear_return_pickup_before_parent_delete() FROM PUBLIC;
GRANT ALL ON FUNCTION public.clear_return_pickup_before_parent_delete() TO authenticated;
GRANT ALL ON FUNCTION public.clear_return_pickup_before_parent_delete() TO service_role;



--
-- Name: FUNCTION flag_order_return_capacity_divergence(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.flag_order_return_capacity_divergence() FROM PUBLIC;
GRANT ALL ON FUNCTION public.flag_order_return_capacity_divergence() TO authenticated;
GRANT ALL ON FUNCTION public.flag_order_return_capacity_divergence() TO service_role;



--
-- Name: FUNCTION get_item_fulfillment_shadow_diagnostics(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_item_fulfillment_shadow_diagnostics() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_item_fulfillment_shadow_diagnostics() TO authenticated;
GRANT ALL ON FUNCTION public.get_item_fulfillment_shadow_diagnostics() TO service_role;



--
-- Name: FUNCTION get_order_return_capacity_violation(p_return_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_order_return_capacity_violation(p_return_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_order_return_capacity_violation(p_return_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_order_return_capacity_violation(p_return_id uuid) TO service_role;



--
-- Name: FUNCTION get_route_start_return_blockers(p_route_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_route_start_return_blockers(p_route_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_route_start_return_blockers(p_route_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_route_start_return_blockers(p_route_id uuid) TO service_role;



--
-- Name: FUNCTION handle_order_return_header_snapshot_refresh(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.handle_order_return_header_snapshot_refresh() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_order_return_header_snapshot_refresh() TO authenticated;
GRANT ALL ON FUNCTION public.handle_order_return_header_snapshot_refresh() TO service_role;



--
-- Name: FUNCTION handle_order_return_item_operational_state_refresh(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.handle_order_return_item_operational_state_refresh() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_order_return_item_operational_state_refresh() TO authenticated;
GRANT ALL ON FUNCTION public.handle_order_return_item_operational_state_refresh() TO service_role;



--
-- Name: FUNCTION handle_order_return_item_snapshot_refresh(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.handle_order_return_item_snapshot_refresh() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_order_return_item_snapshot_refresh() TO authenticated;
GRANT ALL ON FUNCTION public.handle_order_return_item_snapshot_refresh() TO service_role;



--
-- Name: FUNCTION handle_order_return_operational_state_refresh(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.handle_order_return_operational_state_refresh() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_order_return_operational_state_refresh() TO authenticated;
GRANT ALL ON FUNCTION public.handle_order_return_operational_state_refresh() TO service_role;



--
-- Name: FUNCTION ingest_erp_return(p_payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ingest_erp_return(p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ingest_erp_return(p_payload jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.ingest_erp_return(p_payload jsonb) TO service_role;



--
-- Name: FUNCTION ingest_erp_return(p_numero_pedido text, p_produtos jsonb, p_numero_nota_devolucao text, p_chave_acesso text, p_return_xml text, p_return_date timestamp with time zone, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ingest_erp_return(p_numero_pedido text, p_produtos jsonb, p_numero_nota_devolucao text, p_chave_acesso text, p_return_xml text, p_return_date timestamp with time zone, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ingest_erp_return(p_numero_pedido text, p_produtos jsonb, p_numero_nota_devolucao text, p_chave_acesso text, p_return_xml text, p_return_date timestamp with time zone, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.ingest_erp_return(p_numero_pedido text, p_produtos jsonb, p_numero_nota_devolucao text, p_chave_acesso text, p_return_xml text, p_return_date timestamp with time zone, p_reason text) TO service_role;



--
-- Name: FUNCTION item_fulfillment_can_manage(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.item_fulfillment_can_manage() FROM PUBLIC;
GRANT ALL ON FUNCTION public.item_fulfillment_can_manage() TO authenticated;
GRANT ALL ON FUNCTION public.item_fulfillment_can_manage() TO service_role;



--
-- Name: FUNCTION order_item_payload_requires_assembly(p_payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.order_item_payload_requires_assembly(p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.order_item_payload_requires_assembly(p_payload jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.order_item_payload_requires_assembly(p_payload jsonb) TO service_role;



--
-- Name: FUNCTION prevent_collected_return_item_changes(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.prevent_collected_return_item_changes() FROM PUBLIC;
GRANT ALL ON FUNCTION public.prevent_collected_return_item_changes() TO authenticated;
GRANT ALL ON FUNCTION public.prevent_collected_return_item_changes() TO service_role;



--
-- Name: FUNCTION prevent_route_start_with_return_blockers(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.prevent_route_start_with_return_blockers() FROM PUBLIC;
GRANT ALL ON FUNCTION public.prevent_route_start_with_return_blockers() TO authenticated;
GRANT ALL ON FUNCTION public.prevent_route_start_with_return_blockers() TO service_role;



--
-- Name: FUNCTION reconcile_order_return_state(p_order_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reconcile_order_return_state(p_order_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_order_return_state(p_order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.reconcile_order_return_state(p_order_id uuid) TO service_role;



--
-- Name: FUNCTION reconcile_returns_after_route_completion(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reconcile_returns_after_route_completion() FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_returns_after_route_completion() TO authenticated;
GRANT ALL ON FUNCTION public.reconcile_returns_after_route_completion() TO service_role;



--
-- Name: FUNCTION register_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid, p_pickup_created_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.register_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid, p_pickup_created_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.register_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid, p_pickup_created_at timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.register_order_return_pickup(p_return_id uuid, p_pickup_order_id uuid, p_pickup_route_id uuid, p_pickup_created_at timestamp with time zone) TO service_role;



--
-- Name: FUNCTION resync_open_route_order_item_snapshots_for_order(p_order_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.resync_open_route_order_item_snapshots_for_order(p_order_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resync_open_route_order_item_snapshots_for_order(p_order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.resync_open_route_order_item_snapshots_for_order(p_order_id uuid) TO service_role;



--
-- Name: FUNCTION set_store_return_confirmed(p_return_id uuid, p_confirmed boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_store_return_confirmed(p_return_id uuid, p_confirmed boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_store_return_confirmed(p_return_id uuid, p_confirmed boolean) TO authenticated;
GRANT ALL ON FUNCTION public.set_store_return_confirmed(p_return_id uuid, p_confirmed boolean) TO service_role;



--
-- Name: FUNCTION simulate_order_return_for_testing(p_order_id uuid, p_return_nfe_number text, p_reason text, p_items jsonb, p_return_date timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.simulate_order_return_for_testing(p_order_id uuid, p_return_nfe_number text, p_reason text, p_items jsonb, p_return_date timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.simulate_order_return_for_testing(p_order_id uuid, p_return_nfe_number text, p_reason text, p_items jsonb, p_return_date timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.simulate_order_return_for_testing(p_order_id uuid, p_return_nfe_number text, p_reason text, p_items jsonb, p_return_date timestamp with time zone) TO service_role;



--
-- Name: FUNCTION sync_all_order_items_shadow(p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_all_order_items_shadow(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_all_order_items_shadow(p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.sync_all_order_items_shadow(p_limit integer) TO service_role;



--
-- Name: FUNCTION sync_assembly_products_with_returns(p_order_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_assembly_products_with_returns(p_order_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_assembly_products_with_returns(p_order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sync_assembly_products_with_returns(p_order_id uuid) TO service_role;



--
-- Name: FUNCTION sync_missing_assembly_products_for_order(p_order_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_missing_assembly_products_for_order(p_order_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_missing_assembly_products_for_order(p_order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sync_missing_assembly_products_for_order(p_order_id uuid) TO service_role;



--
-- Name: FUNCTION sync_missing_assembly_products_for_pickup(p_order_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_missing_assembly_products_for_pickup(p_order_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_missing_assembly_products_for_pickup(p_order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sync_missing_assembly_products_for_pickup(p_order_id uuid) TO service_role;



--
-- Name: FUNCTION sync_missing_assembly_products_for_pickup_items(p_order_id uuid, p_skus text[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_missing_assembly_products_for_pickup_items(p_order_id uuid, p_skus text[]) TO authenticated;
GRANT ALL ON FUNCTION public.sync_missing_assembly_products_for_pickup_items(p_order_id uuid, p_skus text[]) TO service_role;



--
-- Name: FUNCTION sync_order_items_shadow(p_order_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_order_items_shadow(p_order_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_order_items_shadow(p_order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sync_order_items_shadow(p_order_id uuid) TO service_role;



--
-- Name: FUNCTION sync_order_return_operational_state(p_order_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_order_return_operational_state(p_order_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_order_return_operational_state(p_order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sync_order_return_operational_state(p_order_id uuid) TO service_role;



--
-- Name: FUNCTION sync_route_order_item_snapshots_bulk(p_route_order_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_route_order_item_snapshots_bulk(p_route_order_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_route_order_item_snapshots_bulk(p_route_order_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.sync_route_order_item_snapshots_bulk(p_route_order_ids uuid[]) TO service_role;



--
-- Name: FUNCTION sync_route_order_item_snapshots_system(p_route_order_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_route_order_item_snapshots_system(p_route_order_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_route_order_item_snapshots_system(p_route_order_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.sync_route_order_item_snapshots_system(p_route_order_ids uuid[]) TO service_role;



--
-- Name: FUNCTION trg_resync_order_items_shadow(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_resync_order_items_shadow() TO anon;
GRANT ALL ON FUNCTION public.trg_resync_order_items_shadow() TO authenticated;
GRANT ALL ON FUNCTION public.trg_resync_order_items_shadow() TO service_role;



--
-- Name: FUNCTION validate_order_return_before_processing(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.validate_order_return_before_processing() FROM PUBLIC;
GRANT ALL ON FUNCTION public.validate_order_return_before_processing() TO authenticated;
GRANT ALL ON FUNCTION public.validate_order_return_before_processing() TO service_role;



--
-- Name: TABLE item_fulfillment_sync_issues; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.item_fulfillment_sync_issues TO anon;
GRANT ALL ON TABLE public.item_fulfillment_sync_issues TO authenticated;
GRANT ALL ON TABLE public.item_fulfillment_sync_issues TO service_role;



--
-- Name: TABLE order_item_holds; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_item_holds TO anon;
GRANT ALL ON TABLE public.order_item_holds TO authenticated;
GRANT ALL ON TABLE public.order_item_holds TO service_role;



--
-- Name: TABLE order_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_items TO authenticated;
GRANT ALL ON TABLE public.order_items TO service_role;



--
-- Name: TABLE order_return_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_return_items TO authenticated;
GRANT ALL ON TABLE public.order_return_items TO service_role;



--
-- Name: TABLE order_returns; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_returns TO authenticated;
GRANT ALL ON TABLE public.order_returns TO service_role;



--
-- Name: TABLE route_order_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.route_order_items TO authenticated;
GRANT ALL ON TABLE public.route_order_items TO service_role;



--
-- Name: TABLE order_item_shadow_balances; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_item_shadow_balances TO authenticated;
GRANT ALL ON TABLE public.order_item_shadow_balances TO service_role;


