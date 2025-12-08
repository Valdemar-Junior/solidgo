-- Add vendedor_nome column to orders to avoid scanning raw_json
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS vendedor_nome TEXT;

