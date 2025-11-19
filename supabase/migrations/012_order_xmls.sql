-- Store XML documents per order
CREATE TABLE IF NOT EXISTS public.order_xmls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  xml TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.order_xmls ENABLE ROW LEVEL SECURITY;

-- Allow admin to insert/select
DROP POLICY IF EXISTS "Auth can read order_xmls" ON public.order_xmls;
DROP POLICY IF EXISTS "Admin can manage order_xmls" ON public.order_xmls;

CREATE POLICY "Auth can read order_xmls" ON public.order_xmls
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin can manage order_xmls" ON public.order_xmls
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

GRANT SELECT, INSERT ON public.order_xmls TO authenticated;
