ALTER TABLE public.assembly_products
ADD COLUMN IF NOT EXISTS mount_priority text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'assembly_products_mount_priority_check'
  ) THEN
    ALTER TABLE public.assembly_products
    ADD CONSTRAINT assembly_products_mount_priority_check
    CHECK (mount_priority IS NULL OR mount_priority IN ('baixa', 'media', 'alta'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_assembly_products_mount_priority
ON public.assembly_products (mount_priority);

COMMENT ON COLUMN public.assembly_products.mount_priority IS 'Prioridade manual de montagem definida pelo usuário: baixa, media, alta ou null.';
