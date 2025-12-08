-- Backfill normalized columns from raw_json for existing orders
do $$
begin
  -- data_venda
  update public.orders
    set data_venda = coalesce(data_venda, nullif(raw_json->>'data_venda', '')::timestamptz)
    where data_venda is null and (raw_json->>'data_venda') is not null;

  -- previsao_entrega
  update public.orders
    set previsao_entrega = coalesce(previsao_entrega, nullif(raw_json->>'previsao_entrega', '')::timestamptz)
    where previsao_entrega is null and (raw_json->>'previsao_entrega') is not null;

  -- observacoes_publicas
  update public.orders
    set observacoes_publicas = coalesce(observacoes_publicas, nullif(raw_json->>'observacoes_publicas',''))
    where (observacoes_publicas is null or observacoes_publicas='') and (raw_json->>'observacoes_publicas') is not null;

  -- observacoes_internas
  update public.orders
    set observacoes_internas = coalesce(observacoes_internas, nullif(raw_json->>'observacoes_internas',''))
    where (observacoes_internas is null or observacoes_internas='') and (raw_json->>'observacoes_internas') is not null;

  -- tem_frete_full
  update public.orders
    set tem_frete_full = coalesce(tem_frete_full, nullif(raw_json->>'tem_frete_full',''))
    where (tem_frete_full is null or tem_frete_full='') and (raw_json->>'tem_frete_full') is not null;
end $$;

