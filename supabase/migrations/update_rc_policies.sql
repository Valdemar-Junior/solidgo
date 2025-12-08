-- Allow authenticated updates to own conference records
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='route_conferences' AND policyname='rc_update_own'
  ) THEN
    CREATE POLICY rc_update_own ON public.route_conferences FOR UPDATE USING (auth.role() = 'authenticated' AND user_id = auth.uid()) WITH CHECK (auth.role() = 'authenticated' AND user_id = auth.uid());
  END IF;
END $$;
