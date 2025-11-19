-- RPC function to list active drivers with names, bypassing RLS via SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.list_drivers()
RETURNS TABLE(driver_id uuid, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id AS driver_id, u.name
  FROM public.drivers d
  JOIN public.users u ON u.id = d.user_id
  WHERE d.active = true;
$$;

GRANT EXECUTE ON FUNCTION public.list_drivers() TO authenticated;
