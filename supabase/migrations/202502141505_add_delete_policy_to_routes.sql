-- Add policy to allow authenticated users to delete routes
-- This fixes the issue where users could not delete empty routes
CREATE POLICY "Permitir exclusão de rotas para usuários autenticados" ON public.routes
    FOR DELETE USING (auth.role() = 'authenticated');
