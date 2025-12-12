-- Mantém a assinatura e adiciona filtro de role=driver e drivers ativos
DROP FUNCTION IF EXISTS public.list_drivers();

CREATE OR REPLACE FUNCTION public.list_drivers()
RETURNS TABLE(driver_id uuid, user_id uuid, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id AS driver_id, d.user_id, u.name
  FROM public.drivers d
  JOIN public.users u ON u.id = d.user_id
  WHERE d.active = true
    AND u.role = 'driver';
$$;

GRANT EXECUTE ON FUNCTION public.list_drivers() TO authenticated;
