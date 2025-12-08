SELECT policyname, permissive, roles, cmd 
FROM pg_policies 
WHERE tablename = 'routes' AND schemaname = 'public';

CREATE POLICY "Permitir inserção de rotas para usuários autenticados" ON public.routes
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Permitir visualização de rotas para usuários autenticados" ON public.routes
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Permitir atualização de rotas para usuários autenticados" ON public.routes
    FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

GRANT ALL ON public.routes TO authenticated;
GRANT ALL ON public.routes TO anon;

SELECT policyname, permissive, roles, cmd 
FROM pg_policies 
WHERE tablename = 'routes' AND schemaname = 'public';