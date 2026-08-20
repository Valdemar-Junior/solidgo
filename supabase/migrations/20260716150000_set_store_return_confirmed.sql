-- BUG: o botão "Confirmar retorno à loja" dizia "confirmado" mas a situação
-- não mudava. Causa: order_returns tem RLS ligada e SÓ política de SELECT —
-- nenhuma de UPDATE. O UPDATE direto do navegador (client anon/authenticated)
-- é barrado em silêncio (0 linhas, sem erro), então o carimbo nunca gravava.
--
-- Conserto: escrever via função SECURITY DEFINER (roda com permissão do dono
-- da função, ignora a RLS), igual o resto das escritas do app. auth.uid()
-- continua sendo o usuário que chamou (vem do JWT, não do DEFINER). A função
-- devolve TRUE só se achou a devolução — assim o front nunca dá "sucesso" falso.

CREATE OR REPLACE FUNCTION public.set_store_return_confirmed(
  p_return_id uuid,
  p_confirmed boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  update public.order_returns
     set store_return_confirmed_at = case when p_confirmed then now() else null end,
         store_return_confirmed_by = case when p_confirmed then auth.uid() else null end
   where id = p_return_id;

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$function$;

REVOKE ALL ON FUNCTION public.set_store_return_confirmed(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.set_store_return_confirmed(uuid, boolean) TO authenticated;
