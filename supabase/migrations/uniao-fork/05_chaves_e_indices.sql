-- ============================================================================
-- PARTE 5 — chaves, indices e relacionamentos
-- ----------------------------------------------------------------------------
-- Gerado em 20/08/2026 a partir do dump FRESCO do Banco_Teste_Soligo.
-- RASCUNHO: nao aplicar em producao sem o ensaio sobre backup restaurado.
-- ============================================================================

--
-- Name: item_fulfillment_sync_issues item_fulfillment_sync_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_fulfillment_sync_issues
    ADD CONSTRAINT item_fulfillment_sync_issues_pkey PRIMARY KEY (id);



--
-- Name: item_fulfillment_sync_issues item_fulfillment_sync_issues_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_fulfillment_sync_issues
    ADD CONSTRAINT item_fulfillment_sync_issues_unique UNIQUE (order_id, issue_type, issue_key);



--
-- Name: order_item_holds order_item_holds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_holds
    ADD CONSTRAINT order_item_holds_pkey PRIMARY KEY (id);



--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);



--
-- Name: order_items order_items_source_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_source_key_unique UNIQUE (order_id, source_line_key);



--
-- Name: order_return_items order_return_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_return_items
    ADD CONSTRAINT order_return_items_pkey PRIMARY KEY (id);



--
-- Name: order_return_items order_return_items_source_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_return_items
    ADD CONSTRAINT order_return_items_source_unique UNIQUE (return_id, source_item_key);



--
-- Name: order_returns order_returns_external_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_returns
    ADD CONSTRAINT order_returns_external_key_unique UNIQUE (order_id, external_key);



--
-- Name: order_returns order_returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_returns
    ADD CONSTRAINT order_returns_pkey PRIMARY KEY (id);



--
-- Name: route_order_items route_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_order_items
    ADD CONSTRAINT route_order_items_pkey PRIMARY KEY (id);



--
-- Name: route_order_items route_order_items_route_order_line_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_order_items
    ADD CONSTRAINT route_order_items_route_order_line_unique UNIQUE (route_order_id, source_line_key);



--
-- Name: idx_item_fulfillment_sync_issues_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_fulfillment_sync_issues_order_id ON public.item_fulfillment_sync_issues USING btree (order_id);



--
-- Name: idx_item_fulfillment_sync_issues_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_fulfillment_sync_issues_status ON public.item_fulfillment_sync_issues USING btree (status, detected_at DESC);



--
-- Name: idx_order_item_holds_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_item_holds_order_id ON public.order_item_holds USING btree (order_id);



--
-- Name: idx_order_item_holds_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_item_holds_status ON public.order_item_holds USING btree (status);



--
-- Name: idx_order_items_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order_id ON public.order_items USING btree (order_id);



--
-- Name: idx_order_items_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_sku ON public.order_items USING btree (sku);



--
-- Name: idx_order_items_source_present; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_source_present ON public.order_items USING btree (order_id, source_present);



--
-- Name: idx_order_return_items_order_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_return_items_order_item_id ON public.order_return_items USING btree (order_item_id);



--
-- Name: idx_order_return_items_return_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_return_items_return_id ON public.order_return_items USING btree (return_id);



--
-- Name: idx_order_returns_nfe_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_returns_nfe_key ON public.order_returns USING btree (return_nfe_key);



--
-- Name: idx_order_returns_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_returns_order_id ON public.order_returns USING btree (order_id);



--
-- Name: idx_order_returns_pickup_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_returns_pickup_order_id ON public.order_returns USING btree (pickup_order_id) WHERE (pickup_order_id IS NOT NULL);



--
-- Name: idx_order_returns_pickup_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_returns_pickup_queue ON public.order_returns USING btree (requires_pickup, pickup_created_at, return_date DESC, created_at DESC);



--
-- Name: idx_order_returns_pickup_route_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_returns_pickup_route_id ON public.order_returns USING btree (pickup_route_id) WHERE (pickup_route_id IS NOT NULL);



--
-- Name: idx_order_returns_processing_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_returns_processing_status ON public.order_returns USING btree (processing_status);



--
-- Name: idx_route_order_items_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_route_order_items_order_id ON public.route_order_items USING btree (order_id);



--
-- Name: idx_route_order_items_order_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_route_order_items_order_item_id ON public.route_order_items USING btree (order_item_id);



--
-- Name: idx_route_order_items_route_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_route_order_items_route_id ON public.route_order_items USING btree (route_id);



--
-- Name: idx_route_order_items_route_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_route_order_items_route_order_id ON public.route_order_items USING btree (route_order_id);



--
-- Name: order_item_holds_active_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX order_item_holds_active_uq ON public.order_item_holds USING btree (order_id, COALESCE(source_line_key, ''::text), COALESCE(sku, ''::text)) WHERE (status = 'active'::text);



--
-- Name: order_returns_pickup_order_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX order_returns_pickup_order_unique ON public.order_returns USING btree (pickup_order_id) WHERE (pickup_order_id IS NOT NULL);



--
-- Name: order_returns_pickup_route_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX order_returns_pickup_route_unique ON public.order_returns USING btree (pickup_route_id) WHERE (pickup_route_id IS NOT NULL);



--
-- Name: item_fulfillment_sync_issues item_fulfillment_sync_issues_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_fulfillment_sync_issues
    ADD CONSTRAINT item_fulfillment_sync_issues_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;



--
-- Name: item_fulfillment_sync_issues item_fulfillment_sync_issues_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_fulfillment_sync_issues
    ADD CONSTRAINT item_fulfillment_sync_issues_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE SET NULL;



--
-- Name: item_fulfillment_sync_issues item_fulfillment_sync_issues_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_fulfillment_sync_issues
    ADD CONSTRAINT item_fulfillment_sync_issues_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;



--
-- Name: order_item_holds order_item_holds_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_holds
    ADD CONSTRAINT order_item_holds_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;



--
-- Name: order_item_holds order_item_holds_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_holds
    ADD CONSTRAINT order_item_holds_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE SET NULL;



--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;



--
-- Name: order_return_items order_return_items_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_return_items
    ADD CONSTRAINT order_return_items_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE RESTRICT;



--
-- Name: order_return_items order_return_items_return_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_return_items
    ADD CONSTRAINT order_return_items_return_id_fkey FOREIGN KEY (return_id) REFERENCES public.order_returns(id) ON DELETE CASCADE;



--
-- Name: order_returns order_returns_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_returns
    ADD CONSTRAINT order_returns_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;



--
-- Name: order_returns order_returns_pickup_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_returns
    ADD CONSTRAINT order_returns_pickup_order_id_fkey FOREIGN KEY (pickup_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;



--
-- Name: order_returns order_returns_pickup_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_returns
    ADD CONSTRAINT order_returns_pickup_route_id_fkey FOREIGN KEY (pickup_route_id) REFERENCES public.routes(id) ON DELETE SET NULL;



--
-- Name: route_order_items route_order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_order_items
    ADD CONSTRAINT route_order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;



--
-- Name: route_order_items route_order_items_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_order_items
    ADD CONSTRAINT route_order_items_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE SET NULL;



--
-- Name: route_order_items route_order_items_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_order_items
    ADD CONSTRAINT route_order_items_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE CASCADE;



--
-- Name: route_order_items route_order_items_route_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_order_items
    ADD CONSTRAINT route_order_items_route_order_id_fkey FOREIGN KEY (route_order_id) REFERENCES public.route_orders(id) ON DELETE CASCADE;


