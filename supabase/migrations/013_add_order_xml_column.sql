-- Add single XML field to orders (unique per pedido)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS xml_documento TEXT;

-- Permissions remain governed by existing orders RLS policies
