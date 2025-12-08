-- RPC function to insert vehicle with SECURITY DEFINER to bypass RLS safely
-- Grants EXECUTE to authenticated role

create or replace function public.insert_vehicle(p_model text, p_plate text)
returns uuid
language plpgsql
security definer
as $$
declare
  vid uuid;
begin
  insert into public.vehicles (id, model, plate, active)
  values (gen_random_uuid(), trim(p_model), upper(trim(p_plate)), true)
  returning id into vid;
  return vid;
end;
$$;

grant execute on function public.insert_vehicle(text, text) to authenticated;

