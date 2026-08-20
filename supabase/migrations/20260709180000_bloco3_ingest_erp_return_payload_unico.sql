-- ============================================================================
-- Bloco 3 (parte 2b) — ingest_erp_return: versao de PAYLOAD UNICO (para o n8n)
-- ============================================================================
-- Facilita a vida do n8n: em vez de mapear 7 parametros (o que quebrava por causa
-- dos object-literals na expressao), o n8n passa o ITEM INTEIRO do ERP como um
-- unico jsonb, e esta funcao extrai os campos e chama a versao de 7 args ja testada.
--
-- No n8n o no fica assim (um parametro so):
--   Query:            SELECT public.ingest_erp_return($1::jsonb) AS resultado;
--   Query Parameters: {{ [JSON.stringify($json)] }}
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.ingest_erp_return(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_data timestamptz;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('matched', false, 'reason', 'payload invalido');
  end if;

  -- Data da devolucao (tolera vazio/nulo -> a versao de 7 args usa now() como fallback)
  begin
    v_data := nullif(trim(coalesce(p_payload->>'data_atualizacao_status', '')), '')::timestamptz;
  exception when others then
    v_data := null;
  end;

  return public.ingest_erp_return(
    p_payload->>'numero_pedido',
    coalesce(p_payload->'produtos', '[]'::jsonb),
    p_payload#>>'{xml_retorno,numero_nota_devolucao}',
    p_payload#>>'{xml_retorno,chave_acesso}',
    p_payload#>>'{xml_retorno,xml}',
    v_data,
    p_payload->>'status_pedido'
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.ingest_erp_return(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ingest_erp_return(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.ingest_erp_return(jsonb) TO service_role;

COMMIT;
