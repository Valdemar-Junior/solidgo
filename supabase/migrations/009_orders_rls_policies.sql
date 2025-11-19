-- Ensure RLS and permissions for orders table so admin can write
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Cleanup existing conflicting policies
DROP POLICY IF EXISTS "All authenticated users can view orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can manage orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can insert orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can update orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can delete orders" ON public.orders;

-- Read for any authenticated user
CREATE POLICY "All authenticated users can view orders"
  ON public.orders FOR SELECT
  USING (auth.role() = 'authenticated');

-- Admin write policies
CREATE POLICY "Admins can insert orders"
  ON public.orders FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

CREATE POLICY "Admins can update orders"
  ON public.orders FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

CREATE POLICY "Admins can delete orders"
  ON public.orders FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- Grants for authenticated role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
