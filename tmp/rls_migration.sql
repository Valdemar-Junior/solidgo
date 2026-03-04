DROP POLICY IF EXISTS "Authenticated users can view audit logs" ON "public"."order_audit_log";
CREATE POLICY "Authenticated users can view audit logs" ON "public"."order_audit_log" AS PERMISSIVE FOR SELECT TO public
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON "public"."order_audit_log";
CREATE POLICY "Authenticated users can insert audit logs" ON "public"."order_audit_log" AS PERMISSIVE FOR INSERT TO public
WITH CHECK (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Admin acesso total a fotos" ON "public"."assembly_photos";
CREATE POLICY "Admin acesso total a fotos" ON "public"."assembly_photos" AS PERMISSIVE FOR ALL TO authenticated
USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = (select auth.uid())) AND (users.role = 'admin'::text)))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = (select auth.uid())) AND (users.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Montador vê fotos da rota ativa" ON "public"."assembly_photos";
CREATE POLICY "Montador vê fotos da rota ativa" ON "public"."assembly_photos" AS PERMISSIVE FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM (assembly_products ap
     JOIN assembly_routes ar ON ((ap.assembly_route_id = ar.id)))
  WHERE ((ap.id = assembly_photos.assembly_product_id) AND (ar.status = ANY (ARRAY['pending'::text, 'assigned'::text, 'in_progress'::text])) AND (ap.installer_id = (select auth.uid()))))));

DROP POLICY IF EXISTS "Montador insere fotos" ON "public"."assembly_photos";
CREATE POLICY "Montador insere fotos" ON "public"."assembly_photos" AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK ((EXISTS ( SELECT 1
   FROM assembly_products ap
  WHERE ((ap.id = assembly_photos.assembly_product_id) AND (ap.installer_id = (select auth.uid()))))));

DROP POLICY IF EXISTS "Montador atualiza próprias fotos" ON "public"."assembly_photos";
CREATE POLICY "Montador atualiza próprias fotos" ON "public"."assembly_photos" AS PERMISSIVE FOR UPDATE TO authenticated
USING ((created_by = (select auth.uid())))
WITH CHECK ((created_by = (select auth.uid())));

DROP POLICY IF EXISTS "All authenticated users can view vehicles" ON "public"."vehicles";
CREATE POLICY "All authenticated users can view vehicles" ON "public"."vehicles" AS PERMISSIVE FOR SELECT TO public
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Enable select for authenticated users" ON "public"."sync_logs";
CREATE POLICY "Enable select for authenticated users" ON "public"."sync_logs" AS PERMISSIVE FOR SELECT TO authenticated
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "rc_insert_authenticated" ON "public"."route_conferences";
CREATE POLICY "rc_insert_authenticated" ON "public"."route_conferences" AS PERMISSIVE FOR INSERT TO public
WITH CHECK (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "rcs_select_authenticated" ON "public"."route_conference_scans";
CREATE POLICY "rcs_select_authenticated" ON "public"."route_conference_scans" AS PERMISSIVE FOR SELECT TO public
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "rcs_insert_authenticated" ON "public"."route_conference_scans";
CREATE POLICY "rcs_insert_authenticated" ON "public"."route_conference_scans" AS PERMISSIVE FOR INSERT TO public
WITH CHECK (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Debug: Allow All Updates" ON "public"."assembly_products";
CREATE POLICY "Debug: Allow All Updates" ON "public"."assembly_products" AS PERMISSIVE FOR UPDATE TO authenticated
USING (((select auth.role()) = 'authenticated'::text))
WITH CHECK (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Users can view all delivery photos" ON "public"."delivery_photos";
CREATE POLICY "Users can view all delivery photos" ON "public"."delivery_photos" AS PERMISSIVE FOR SELECT TO public
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Users can insert delivery photos" ON "public"."delivery_photos";
CREATE POLICY "Users can insert delivery photos" ON "public"."delivery_photos" AS PERMISSIVE FOR INSERT TO public
WITH CHECK (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Users can update their own delivery photos" ON "public"."delivery_photos";
CREATE POLICY "Users can update their own delivery photos" ON "public"."delivery_photos" AS PERMISSIVE FOR UPDATE TO public
USING (((select auth.uid()) = created_by));

DROP POLICY IF EXISTS "All authenticated users can view return reasons" ON "public"."return_reasons";
CREATE POLICY "All authenticated users can view return reasons" ON "public"."return_reasons" AS PERMISSIVE FOR SELECT TO public
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Users can delete delivery photos" ON "public"."delivery_photos";
CREATE POLICY "Users can delete delivery photos" ON "public"."delivery_photos" AS PERMISSIVE FOR DELETE TO public
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "All authenticated users can view orders" ON "public"."orders";
CREATE POLICY "All authenticated users can view orders" ON "public"."orders" AS PERMISSIVE FOR SELECT TO public
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "route_orders_select_driver" ON "public"."route_orders";
CREATE POLICY "route_orders_select_driver" ON "public"."route_orders" AS PERMISSIVE FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM (routes r
     JOIN drivers d ON ((d.id = r.driver_id)))
  WHERE ((r.id = route_orders.route_id) AND (d.user_id = (select auth.uid()))))));

DROP POLICY IF EXISTS "route_orders_update_driver" ON "public"."route_orders";
CREATE POLICY "route_orders_update_driver" ON "public"."route_orders" AS PERMISSIVE FOR UPDATE TO authenticated
USING ((EXISTS ( SELECT 1
   FROM (routes r
     JOIN drivers d ON ((d.id = r.driver_id)))
  WHERE ((r.id = route_orders.route_id) AND (d.user_id = (select auth.uid()))))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM (routes r
     JOIN drivers d ON ((d.id = r.driver_id)))
  WHERE ((r.id = route_orders.route_id) AND (d.user_id = (select auth.uid()))))));

DROP POLICY IF EXISTS "routes_update_driver" ON "public"."routes";
CREATE POLICY "routes_update_driver" ON "public"."routes" AS PERMISSIVE FOR UPDATE TO authenticated
USING ((EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = routes.driver_id) AND (d.user_id = (select auth.uid()))))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = routes.driver_id) AND (d.user_id = (select auth.uid()))))));

DROP POLICY IF EXISTS "orders_update_driver_delivered" ON "public"."orders";
CREATE POLICY "orders_update_driver_delivered" ON "public"."orders" AS PERMISSIVE FOR UPDATE TO authenticated
USING ((EXISTS ( SELECT 1
   FROM ((route_orders ro
     JOIN routes r ON ((ro.route_id = r.id)))
     JOIN drivers d ON ((r.driver_id = d.id)))
  WHERE ((ro.order_id = orders.id) AND (d.user_id = (select auth.uid()))))))
WITH CHECK (((status = 'delivered'::text) OR (status = 'assigned'::text) OR (status = 'pending'::text)));

DROP POLICY IF EXISTS "Permitir exclusão de rotas para usuários autenticados" ON "public"."routes";
CREATE POLICY "Permitir exclusão de rotas para usuários autenticados" ON "public"."routes" AS PERMISSIVE FOR DELETE TO public
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "delivery_receipts_select_admin" ON "public"."delivery_receipts";
CREATE POLICY "delivery_receipts_select_admin" ON "public"."delivery_receipts" AS PERMISSIVE FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u.role = 'admin'::text)))));

DROP POLICY IF EXISTS "delivery_receipts_select_own" ON "public"."delivery_receipts";
CREATE POLICY "delivery_receipts_select_own" ON "public"."delivery_receipts" AS PERMISSIVE FOR SELECT TO authenticated
USING ((delivered_by_user_id = (select auth.uid())));

DROP POLICY IF EXISTS "delivery_receipts_insert_own" ON "public"."delivery_receipts";
CREATE POLICY "delivery_receipts_insert_own" ON "public"."delivery_receipts" AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK ((delivered_by_user_id = (select auth.uid())));

DROP POLICY IF EXISTS "delivery_receipts_insert_admin" ON "public"."delivery_receipts";
CREATE POLICY "delivery_receipts_insert_admin" ON "public"."delivery_receipts" AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u.role = 'admin'::text)))));

DROP POLICY IF EXISTS "delivery_route_catalog_select_authenticated" ON "public"."delivery_route_catalog";
CREATE POLICY "delivery_route_catalog_select_authenticated" ON "public"."delivery_route_catalog" AS PERMISSIVE FOR SELECT TO public
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "delivery_route_catalog_insert_authenticated" ON "public"."delivery_route_catalog";
CREATE POLICY "delivery_route_catalog_insert_authenticated" ON "public"."delivery_route_catalog" AS PERMISSIVE FOR INSERT TO public
WITH CHECK (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "delivery_route_catalog_update_authenticated" ON "public"."delivery_route_catalog";
CREATE POLICY "delivery_route_catalog_update_authenticated" ON "public"."delivery_route_catalog" AS PERMISSIVE FOR UPDATE TO public
USING (((select auth.role()) = 'authenticated'::text))
WITH CHECK (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Users can view own or admins view all" ON "public"."users";
CREATE POLICY "Users can view own or admins view all" ON "public"."users" AS PERMISSIVE FOR SELECT TO public
USING ((((select auth.uid()) = id) OR is_admin()));

DROP POLICY IF EXISTS "Users can update own name" ON "public"."users";
CREATE POLICY "Users can update own name" ON "public"."users" AS PERMISSIVE FOR UPDATE TO public
USING ((((select auth.uid()) = id) OR is_admin()))
WITH CHECK (((((select auth.uid()) = id) AND (role = ( SELECT users_1.role
   FROM users users_1
  WHERE (users_1.id = (select auth.uid()))))) OR is_admin()));

DROP POLICY IF EXISTS "Users can view orders" ON "public"."orders";
CREATE POLICY "Users can view orders" ON "public"."orders" AS PERMISSIVE FOR SELECT TO public
USING (((select auth.uid()) IS NOT NULL));

DROP POLICY IF EXISTS "Admin can insert orders" ON "public"."orders";
CREATE POLICY "Admin can insert orders" ON "public"."orders" AS PERMISSIVE FOR INSERT TO public
WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = (select auth.uid())) AND (users.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admin can update orders" ON "public"."orders";
CREATE POLICY "Admin can update orders" ON "public"."orders" AS PERMISSIVE FOR UPDATE TO public
USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = (select auth.uid())) AND (users.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admin can delete orders" ON "public"."orders";
CREATE POLICY "Admin can delete orders" ON "public"."orders" AS PERMISSIVE FOR DELETE TO public
USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = (select auth.uid())) AND (users.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Permitir inserção de rotas para usuários autenticados" ON "public"."routes";
CREATE POLICY "Permitir inserção de rotas para usuários autenticados" ON "public"."routes" AS PERMISSIVE FOR INSERT TO public
WITH CHECK (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Permitir visualização de rotas para usuários autenticados" ON "public"."routes";
CREATE POLICY "Permitir visualização de rotas para usuários autenticados" ON "public"."routes" AS PERMISSIVE FOR SELECT TO public
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Permitir atualização de rotas para usuários autenticados" ON "public"."routes";
CREATE POLICY "Permitir atualização de rotas para usuários autenticados" ON "public"."routes" AS PERMISSIVE FOR UPDATE TO public
USING (((select auth.role()) = 'authenticated'::text))
WITH CHECK (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Permitir inserção de pedidos em rotas para usuários autentic" ON "public"."route_orders";
CREATE POLICY "Permitir inserção de pedidos em rotas para usuários autentic" ON "public"."route_orders" AS PERMISSIVE FOR INSERT TO public
WITH CHECK (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Permitir visualização de pedidos em rotas para usuários aute" ON "public"."route_orders";
CREATE POLICY "Permitir visualização de pedidos em rotas para usuários aute" ON "public"."route_orders" AS PERMISSIVE FOR SELECT TO public
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Permitir atualização de pedidos em rotas para usuários auten" ON "public"."route_orders";
CREATE POLICY "Permitir atualização de pedidos em rotas para usuários auten" ON "public"."route_orders" AS PERMISSIVE FOR UPDATE TO public
WITH CHECK (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Permitir exclusão de pedidos em rotas para usuários autentica" ON "public"."route_orders";
CREATE POLICY "Permitir exclusão de pedidos em rotas para usuários autentica" ON "public"."route_orders" AS PERMISSIVE FOR DELETE TO public
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Admins can manage assembly routes" ON "public"."assembly_routes";
CREATE POLICY "Admins can manage assembly routes" ON "public"."assembly_routes" AS PERMISSIVE FOR ALL TO public
USING (((((select auth.jwt()) ->> 'role'::text) = 'service_role'::text) OR ((((select auth.jwt()) -> 'user_metadata'::text) ->> 'role'::text) = 'admin'::text) OR (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = (select auth.uid())) AND (users.role = 'admin'::text))))));

DROP POLICY IF EXISTS "Admins can manage assembly products" ON "public"."assembly_products";
CREATE POLICY "Admins can manage assembly products" ON "public"."assembly_products" AS PERMISSIVE FOR ALL TO public
USING (((((select auth.jwt()) ->> 'role'::text) = 'service_role'::text) OR ((((select auth.jwt()) -> 'user_metadata'::text) ->> 'role'::text) = 'admin'::text) OR (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = (select auth.uid())) AND (users.role = 'admin'::text))))));

DROP POLICY IF EXISTS "Installers can view their assigned products" ON "public"."assembly_products";
CREATE POLICY "Installers can view their assigned products" ON "public"."assembly_products" AS PERMISSIVE FOR SELECT TO public
USING ((installer_id = (select auth.uid())));

DROP POLICY IF EXISTS "Installers can update their assigned products" ON "public"."assembly_products";
CREATE POLICY "Installers can update their assigned products" ON "public"."assembly_products" AS PERMISSIVE FOR UPDATE TO public
USING ((installer_id = (select auth.uid())));

DROP POLICY IF EXISTS "Allow all access for authenticated users" ON "public"."delivery_city_rules";
CREATE POLICY "Allow all access for authenticated users" ON "public"."delivery_city_rules" AS PERMISSIVE FOR ALL TO public
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Allow users to update drivers" ON "public"."drivers";
CREATE POLICY "Allow users to update drivers" ON "public"."drivers" AS PERMISSIVE FOR UPDATE TO authenticated
USING ((((select auth.uid()) = user_id) OR (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = (select auth.uid())) AND (users.role = 'admin'::text))))));

DROP POLICY IF EXISTS "Permitir leitura de rotas para usuários autenticados" ON "public"."assembly_routes";
CREATE POLICY "Permitir leitura de rotas para usuários autenticados" ON "public"."assembly_routes" AS PERMISSIVE FOR SELECT TO public
USING (((select auth.uid()) IS NOT NULL));

DROP POLICY IF EXISTS "Permitir criação de rotas para admin" ON "public"."assembly_routes";
CREATE POLICY "Permitir criação de rotas para admin" ON "public"."assembly_routes" AS PERMISSIVE FOR INSERT TO public
WITH CHECK (((select auth.uid()) IN ( SELECT users.id
   FROM users
  WHERE (users.role = 'admin'::text))));

DROP POLICY IF EXISTS "Permitir atualização de rotas para admin" ON "public"."assembly_routes";
CREATE POLICY "Permitir atualização de rotas para admin" ON "public"."assembly_routes" AS PERMISSIVE FOR UPDATE TO public
USING (((select auth.uid()) IN ( SELECT users.id
   FROM users
  WHERE (users.role = 'admin'::text))));

DROP POLICY IF EXISTS "Permitir leitura de produtos para usuários autenticados" ON "public"."assembly_products";
CREATE POLICY "Permitir leitura de produtos para usuários autenticados" ON "public"."assembly_products" AS PERMISSIVE FOR SELECT TO public
USING (((select auth.uid()) IS NOT NULL));

DROP POLICY IF EXISTS "Allow all access for authenticated users" ON "public"."company_holidays";
CREATE POLICY "Allow all access for authenticated users" ON "public"."company_holidays" AS PERMISSIVE FOR ALL TO public
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Permitir criação de produtos para admin" ON "public"."assembly_products";
CREATE POLICY "Permitir criação de produtos para admin" ON "public"."assembly_products" AS PERMISSIVE FOR INSERT TO public
WITH CHECK (((select auth.uid()) IN ( SELECT users.id
   FROM users
  WHERE (users.role = 'admin'::text))));

DROP POLICY IF EXISTS "Permitir atualização de produtos para admin e montador" ON "public"."assembly_products";
CREATE POLICY "Permitir atualização de produtos para admin e montador" ON "public"."assembly_products" AS PERMISSIVE FOR UPDATE TO public
USING ((((select auth.uid()) IN ( SELECT users.id
   FROM users
  WHERE (users.role = 'admin'::text))) OR ((select auth.uid()) = installer_id)));

DROP POLICY IF EXISTS "Enable insert for authenticated users" ON "public"."assembly_routes";
CREATE POLICY "Enable insert for authenticated users" ON "public"."assembly_routes" AS PERMISSIVE FOR INSERT TO public
WITH CHECK (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Enable update for authenticated users" ON "public"."assembly_routes";
CREATE POLICY "Enable update for authenticated users" ON "public"."assembly_routes" AS PERMISSIVE FOR UPDATE TO public
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Enable insert for authenticated users" ON "public"."assembly_products";
CREATE POLICY "Enable insert for authenticated users" ON "public"."assembly_products" AS PERMISSIVE FOR INSERT TO public
WITH CHECK (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "Enable update for authenticated users" ON "public"."assembly_products";
CREATE POLICY "Enable update for authenticated users" ON "public"."assembly_products" AS PERMISSIVE FOR UPDATE TO public
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "routes_select_authenticated" ON "public"."routes";
CREATE POLICY "routes_select_authenticated" ON "public"."routes" AS PERMISSIVE FOR SELECT TO public
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "route_orders_select_authenticated" ON "public"."route_orders";
CREATE POLICY "route_orders_select_authenticated" ON "public"."route_orders" AS PERMISSIVE FOR SELECT TO public
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "rc_select_authenticated" ON "public"."route_conferences";
CREATE POLICY "rc_select_authenticated" ON "public"."route_conferences" AS PERMISSIVE FOR SELECT TO public
USING (((select auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS "rc_update_own" ON "public"."route_conferences";
CREATE POLICY "rc_update_own" ON "public"."route_conferences" AS PERMISSIVE FOR UPDATE TO public
USING ((((select auth.role()) = 'authenticated'::text) AND (user_id = (select auth.uid()))))
WITH CHECK ((((select auth.role()) = 'authenticated'::text) AND (user_id = (select auth.uid()))));

DROP POLICY IF EXISTS "rc_update_admin" ON "public"."route_conferences";
CREATE POLICY "rc_update_admin" ON "public"."route_conferences" AS PERMISSIVE FOR UPDATE TO public
USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u.role = 'admin'::text)))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u.role = 'admin'::text)))));

DROP POLICY IF EXISTS "upsert_own_prefs" ON "public"."user_preferences";
CREATE POLICY "upsert_own_prefs" ON "public"."user_preferences" AS PERMISSIVE FOR ALL TO public
USING ((user_id = (select auth.uid())))
WITH CHECK ((user_id = (select auth.uid())));

DROP POLICY IF EXISTS "vehicles_insert_admin" ON "public"."vehicles";
CREATE POLICY "vehicles_insert_admin" ON "public"."vehicles" AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u.role = 'admin'::text)))));

DROP POLICY IF EXISTS "vehicles_update_admin" ON "public"."vehicles";
CREATE POLICY "vehicles_update_admin" ON "public"."vehicles" AS PERMISSIVE FOR UPDATE TO authenticated
USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u.role = 'admin'::text)))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u.role = 'admin'::text)))));

DROP POLICY IF EXISTS "app_settings_modify_admin" ON "public"."app_settings";
CREATE POLICY "app_settings_modify_admin" ON "public"."app_settings" AS PERMISSIVE FOR ALL TO authenticated
USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u.role = 'admin'::text)))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u.role = 'admin'::text)))));

DROP POLICY IF EXISTS "orders_update_driver_returned" ON "public"."orders";
CREATE POLICY "orders_update_driver_returned" ON "public"."orders" AS PERMISSIVE FOR UPDATE TO authenticated
USING ((EXISTS ( SELECT 1
   FROM ((route_orders ro
     JOIN routes r ON ((ro.route_id = r.id)))
     JOIN drivers d ON ((r.driver_id = d.id)))
  WHERE ((ro.order_id = orders.id) AND (d.user_id = (select auth.uid()))))))
WITH CHECK (((status = 'pending'::text) AND (return_flag = true)));

DROP POLICY IF EXISTS "Enable all access for authenticated users" ON "public"."operational_diary";
CREATE POLICY "Enable all access for authenticated users" ON "public"."operational_diary" AS PERMISSIVE FOR ALL TO public
USING (((select auth.role()) = 'authenticated'::text))
WITH CHECK (((select auth.role()) = 'authenticated'::text));
