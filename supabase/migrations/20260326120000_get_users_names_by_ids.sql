-- Retorna nomes de usuarios por lista de IDs.
-- SECURITY DEFINER permite uso em telas operacionais mesmo com RLS restritiva na tabela users.

CREATE OR REPLACE FUNCTION public.get_users_names_by_ids(p_user_ids uuid[])
RETURNS TABLE(id uuid, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.name
  FROM public.users u
  WHERE u.id = ANY(COALESCE(p_user_ids, ARRAY[]::uuid[]));
$$;

REVOKE ALL ON FUNCTION public.get_users_names_by_ids(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_users_names_by_ids(uuid[]) TO authenticated;
