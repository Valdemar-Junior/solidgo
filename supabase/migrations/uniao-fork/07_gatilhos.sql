-- ============================================================================
-- PARTE 7 — gatilhos automaticos
-- ----------------------------------------------------------------------------
-- Gerado em 20/08/2026 a partir do dump FRESCO do Banco_Teste_Soligo.
-- RASCUNHO: nao aplicar em producao sem o ensaio sobre backup restaurado.
-- ============================================================================

--
-- Name: route_orders trg_clear_return_pickup_after_route_order_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_clear_return_pickup_after_route_order_delete AFTER DELETE ON public.route_orders FOR EACH ROW EXECUTE FUNCTION public.clear_return_pickup_after_route_order_delete();



--
-- Name: orders trg_clear_return_pickup_before_order_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_clear_return_pickup_before_order_delete BEFORE DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.clear_return_pickup_before_parent_delete();



--
-- Name: routes trg_clear_return_pickup_before_route_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_clear_return_pickup_before_route_delete BEFORE DELETE ON public.routes FOR EACH ROW EXECUTE FUNCTION public.clear_return_pickup_before_parent_delete();



--
-- Name: order_return_items trg_flag_order_return_capacity_divergence; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_flag_order_return_capacity_divergence AFTER INSERT OR DELETE OR UPDATE ON public.order_return_items FOR EACH ROW EXECUTE FUNCTION public.flag_order_return_capacity_divergence();



--
-- Name: order_items trg_order_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_order_items_updated_at BEFORE UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();



--
-- Name: order_return_items trg_order_return_items_operational_state_refresh; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_order_return_items_operational_state_refresh AFTER INSERT OR DELETE OR UPDATE ON public.order_return_items FOR EACH ROW EXECUTE FUNCTION public.handle_order_return_item_operational_state_refresh();



--
-- Name: order_return_items trg_order_return_items_snapshot_refresh; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_order_return_items_snapshot_refresh AFTER INSERT OR DELETE OR UPDATE ON public.order_return_items FOR EACH ROW EXECUTE FUNCTION public.handle_order_return_item_snapshot_refresh();



--
-- Name: order_return_items trg_order_return_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_order_return_items_updated_at BEFORE UPDATE ON public.order_return_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();



--
-- Name: order_returns trg_order_returns_operational_state_refresh; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_order_returns_operational_state_refresh AFTER INSERT OR DELETE OR UPDATE ON public.order_returns FOR EACH ROW EXECUTE FUNCTION public.handle_order_return_operational_state_refresh();



--
-- Name: order_returns trg_order_returns_snapshot_refresh; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_order_returns_snapshot_refresh AFTER INSERT OR DELETE OR UPDATE ON public.order_returns FOR EACH ROW EXECUTE FUNCTION public.handle_order_return_header_snapshot_refresh();



--
-- Name: order_returns trg_order_returns_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_order_returns_updated_at BEFORE UPDATE ON public.order_returns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();



--
-- Name: orders trg_orders_resync_items_shadow; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orders_resync_items_shadow AFTER UPDATE OF items_json ON public.orders FOR EACH ROW WHEN ((new.items_json IS DISTINCT FROM old.items_json)) EXECUTE FUNCTION public.trg_resync_order_items_shadow();



--
-- Name: order_return_items trg_prevent_collected_return_item_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_collected_return_item_changes BEFORE INSERT OR DELETE OR UPDATE ON public.order_return_items FOR EACH ROW EXECUTE FUNCTION public.prevent_collected_return_item_changes();



--
-- Name: routes trg_prevent_route_start_with_return_blockers; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_route_start_with_return_blockers BEFORE UPDATE OF status ON public.routes FOR EACH ROW EXECUTE FUNCTION public.prevent_route_start_with_return_blockers();



--
-- Name: route_order_items trg_route_order_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_route_order_items_updated_at BEFORE UPDATE ON public.route_order_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();



--
-- Name: routes trg_routes_reconcile_returns_after_completion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_routes_reconcile_returns_after_completion AFTER UPDATE OF status ON public.routes FOR EACH ROW EXECUTE FUNCTION public.reconcile_returns_after_route_completion();



--
-- Name: order_returns trg_validate_order_return_before_processing; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_order_return_before_processing BEFORE UPDATE OF processing_status ON public.order_returns FOR EACH ROW EXECUTE FUNCTION public.validate_order_return_before_processing();


