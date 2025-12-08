-- Allow authenticated users (incl. conferente) to read routes and route_orders
DO $$
BEGIN
  -- routes SELECT for authenticated
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='routes' AND policyname='routes_select_authenticated'
  ) THEN
    CREATE POLICY routes_select_authenticated ON public.routes FOR SELECT USING (auth.role() = 'authenticated');
  END IF;

  -- route_orders SELECT for authenticated
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='route_orders' AND policyname='route_orders_select_authenticated'
  ) THEN
    CREATE POLICY route_orders_select_authenticated ON public.route_orders FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
END $$;
