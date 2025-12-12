-- Garante que existe FK drivers.user_id -> users.id (necessário para join do Supabase REST)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'drivers_user_id_fkey'
      AND conrelid = 'public.drivers'::regclass
  ) THEN
    ALTER TABLE public.drivers
      ADD CONSTRAINT drivers_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id)
      ON DELETE CASCADE;
  END IF;
END;
$$;

-- Índice para user_id (se ainda não existir)
CREATE INDEX IF NOT EXISTS drivers_user_id_idx ON public.drivers(user_id);
