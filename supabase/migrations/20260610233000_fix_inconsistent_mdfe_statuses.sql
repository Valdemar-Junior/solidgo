update public.mdfe_manifests
set
  status = 'error',
  error_message = coalesce(
    response_json ->> 'mensagem_sefaz',
    response_json ->> 'mensagem',
    response_json ->> 'message',
    response_json ->> 'descricao',
    error_message,
    'Manifesto retornado com erro pela Focus.'
  ),
  issued_at = null,
  closed_at = null
where status in ('draft', 'processing', 'issued')
  and (
    lower(coalesce(response_json ->> 'status', '')) like '%erro%'
    or lower(coalesce(response_json ->> 'status', '')) like '%rejei%'
    or lower(coalesce(response_json ->> 'status', '')) like '%nao autoriz%'
    or lower(coalesce(response_json ->> 'situacao', '')) like '%erro%'
    or lower(coalesce(response_json ->> 'situacao', '')) like '%rejei%'
  );
