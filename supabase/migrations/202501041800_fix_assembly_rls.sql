-- Drop restrictive policies
DROP POLICY IF EXISTS "Admins can update assembly products" ON assembly_products;
DROP POLICY IF EXISTS "Admins can update assembly routes" ON assembly_routes;

-- Create permissive policies for Admins
CREATE POLICY "Admins can update assembly products" ON assembly_products
  FOR UPDATE USING (
    (auth.jwt() ->> 'role') = 'service_role' OR
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
      AND (raw_user_meta_data->>'role')::text = 'admin'
    ) OR
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
      AND role = 'admin'
    )
  );

CREATE POLICY "Admins can update assembly routes" ON assembly_routes
  FOR UPDATE USING (
    (auth.jwt() ->> 'role') = 'service_role' OR
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
      AND (raw_user_meta_data->>'role')::text = 'admin'
    ) OR
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
      AND role = 'admin'
    )
  );
