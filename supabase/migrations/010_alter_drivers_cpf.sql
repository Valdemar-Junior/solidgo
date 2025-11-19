-- Make drivers.cpf optional and remove unique constraint
ALTER TABLE public.drivers ALTER COLUMN cpf DROP NOT NULL;
ALTER TABLE public.drivers DROP CONSTRAINT IF EXISTS drivers_cpf_key;

-- Optional: add index on user_id for lookups (if not exists already)
CREATE INDEX IF NOT EXISTS idx_drivers_user_id ON public.drivers(user_id);
