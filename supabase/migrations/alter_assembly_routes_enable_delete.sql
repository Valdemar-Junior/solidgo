-- Allow DELETE on assembly_routes for admins
DROP POLICY IF EXISTS "Admins can delete assembly routes" ON public.assembly_routes;
CREATE POLICY "Admins can delete assembly routes" ON public.assembly_routes
  FOR DELETE USING (
    auth.uid() IN (SELECT id FROM public.users WHERE role = 'admin')
  );

GRANT DELETE ON public.assembly_routes TO authenticated;
