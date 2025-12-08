SELECT policyname, permissive, roles, cmd 
FROM pg_policies 
WHERE tablename = 'route_orders' AND schemaname = 'public';

CREATE POLICY "Permitir inserção de pedidos em rotas para usuários autenticados" ON public.route_orders
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Permitir visualização de pedidos em rotas para usuários autenticados" ON public.route_orders
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Permitir atualização de pedidos em rotas para usuários autenticados" ON public.route_orders
    FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Permitir exclusão de pedidos em rotas para usuários autenticados" ON public.route_orders
    FOR DELETE USING (auth.role() = 'authenticated');

GRANT ALL ON public.route_orders TO authenticated;
GRANT ALL ON public.route_orders TO anon;

SELECT policyname, permissive, roles, cmd 
FROM pg_policies 
WHERE tablename = 'route_orders' AND schemaname = 'public';