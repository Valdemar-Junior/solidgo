DROP POLICY IF EXISTS "Allow authenticated users to update orders" ON "public"."orders";
CREATE POLICY "Allow authenticated users to update orders" ON "public"."orders" AS PERMISSIVE FOR UPDATE TO authenticated
USING (((select auth.role()) = 'authenticated'))
WITH CHECK (((select auth.role()) = 'authenticated'));

DROP POLICY IF EXISTS "webhook_settings_select_authenticated" ON "public"."webhook_settings";
CREATE POLICY "webhook_settings_select_authenticated" ON "public"."webhook_settings" AS PERMISSIVE FOR SELECT TO authenticated
USING (((select auth.role()) = 'authenticated'));

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON "public"."assembly_photos";
CREATE POLICY "Enable read access for authenticated users" ON "public"."assembly_photos" AS PERMISSIVE FOR SELECT TO authenticated
USING (((select auth.role()) = 'authenticated'));

DROP POLICY IF EXISTS "Enable insert for authenticated users" ON "public"."assembly_photos";
CREATE POLICY "Enable insert for authenticated users" ON "public"."assembly_photos" AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (((select auth.role()) = 'authenticated'));

DROP POLICY IF EXISTS "Enable delete for authenticated users" ON "public"."assembly_photos";
CREATE POLICY "Enable delete for authenticated users" ON "public"."assembly_photos" AS PERMISSIVE FOR DELETE TO authenticated
USING (((select auth.role()) = 'authenticated'));

DROP POLICY IF EXISTS "Debug: Allow All Insert Logs" ON "public"."sync_logs";
CREATE POLICY "Debug: Allow All Insert Logs" ON "public"."sync_logs" AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (((select auth.role()) = 'authenticated'));

DROP POLICY IF EXISTS "Allow authenticated users to read drivers" ON "public"."drivers";
CREATE POLICY "Allow authenticated users to read drivers" ON "public"."drivers" AS PERMISSIVE FOR SELECT TO authenticated
USING (((select auth.role()) = 'authenticated'));

DROP POLICY IF EXISTS "Allow authenticated users to insert drivers" ON "public"."drivers";
CREATE POLICY "Allow authenticated users to insert drivers" ON "public"."drivers" AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (((select auth.role()) = 'authenticated'));

DROP POLICY IF EXISTS "Enable read access for all users" ON "public"."assembly_routes";
CREATE POLICY "Enable read access for all users" ON "public"."assembly_routes" AS PERMISSIVE FOR SELECT TO public
USING (((select auth.role()) IN ('authenticated', 'anon', 'service_role')));

DROP POLICY IF EXISTS "Enable read access for all users" ON "public"."assembly_products";
CREATE POLICY "Enable read access for all users" ON "public"."assembly_products" AS PERMISSIVE FOR SELECT TO public
USING (((select auth.role()) IN ('authenticated', 'anon', 'service_role')));

DROP POLICY IF EXISTS "vehicles_select_authenticated" ON "public"."vehicles";
CREATE POLICY "vehicles_select_authenticated" ON "public"."vehicles" AS PERMISSIVE FOR SELECT TO authenticated
USING (((select auth.role()) = 'authenticated'));

DROP POLICY IF EXISTS "app_settings_select_authenticated" ON "public"."app_settings";
CREATE POLICY "app_settings_select_authenticated" ON "public"."app_settings" AS PERMISSIVE FOR SELECT TO authenticated
USING (((select auth.role()) = 'authenticated'));

DROP POLICY IF EXISTS "webhook_settings_modify_authenticated" ON "public"."webhook_settings";
CREATE POLICY "webhook_settings_modify_authenticated" ON "public"."webhook_settings" AS PERMISSIVE FOR ALL TO authenticated
USING (((select auth.role()) = 'authenticated'))
WITH CHECK (((select auth.role()) = 'authenticated'));

DROP POLICY IF EXISTS "enable_update_for_authenticated" ON "public"."route_orders";
CREATE POLICY "enable_update_for_authenticated" ON "public"."route_orders" AS PERMISSIVE FOR UPDATE TO authenticated
USING (((select auth.role()) = 'authenticated'))
WITH CHECK (((select auth.role()) = 'authenticated'));
