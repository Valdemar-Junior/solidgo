-- Update users.role check constraint to include 'conferente'
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY['admin','driver','helper','montador','conferente']));
