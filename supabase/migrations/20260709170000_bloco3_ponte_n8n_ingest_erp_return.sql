-- ============================================================================
-- Bloco 3 (parte 2) — A PONTE: ingest_erp_return
-- ============================================================================
-- OBJETIVO: dar ao n8n UMA funcao para chamar em vez do "UPDATE orders" cru.
-- Ela transforma a devolucao do ERP (nivel pedido + produtos da nota) na camada
-- itemizada (order_returns + order_return_items) e dispara a reconciliacao, que
-- por sua vez preenche TODO o legado no orders (return_flag, blocked_at,
-- requires_pickup, return_nfe_*, return_date, return_type) e carimba a montagem.
--
-- Por que isto e melhor que o n8n atual:
--   * A logica de negocio fica versionada no banco (nao em SQL interpolado no n8n).
--   * Alimenta a camada por item (hoje o n8n so mexe no orders -> feature itemizada
--     nunca recebia dado real). Agora a devolucao por item funciona em producao.
--   * requires_pickup passa a ser calculado com precisao (nao mais status='delivered').
--   * Passa os produtos como PARAMETRO jsonb (fim do risco de injecao por aspas no XML).
--
-- MAPEAMENTO confirmado na fonte (ERP -> SolidGo):
--   produtos[].codigo  == order_items.sku      (ex.: "1186-1")
--   produtos[].qtd     == quantidade devolvida
--   numero_pedido      == orders.order_id_erp
--   xml_retorno.numero_nota_devolucao/chave_acesso/xml -> NF de devolucao
--
-- IDEMPOTENTE: usa external_key = 'erp-return-<nota>' e nao reprocessa a mesma NF.
-- ROBUSTA EM LOTE: se o pedido nao existe ou o SKU nao casa, NAO derruba a
--   transacao — retorna um jsonb de status e segue (o n8n loga e continua).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.ingest_erp_return(
  p_numero_pedido text,
  p_produtos jsonb,
  p_numero_nota_devolucao text DEFAULT NULL,
  p_chave_acesso text DEFAULT NULL,
  p_return_xml text DEFAULT NULL,
  p_return_date timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_external_key text;
  v_return_id uuid;
  v_return_date timestamptz := coalesce(p_return_date, timezone('utc', now()));
  v_prod jsonb;
  v_sku text;
  v_qty numeric;
  v_remaining numeric;
  v_line record;
  v_alloc numeric;
  v_matched_qty numeric := 0;
  v_return_type text;
  v_remaining_after numeric;
  v_items_inserted integer := 0;
  v_unmatched jsonb := '[]'::jsonb;
begin
  -- Validacoes basicas (sem derrubar lote: retorna status)
  if nullif(trim(coalesce(p_numero_pedido, '')), '') is null then
    return jsonb_build_object('matched', false, 'reason', 'numero_pedido vazio');
  end if;

  if p_produtos is null or jsonb_typeof(p_produtos) <> 'array' or jsonb_array_length(p_produtos) = 0 then
    return jsonb_build_object('matched', false, 'numero_pedido', p_numero_pedido, 'reason', 'sem produtos');
  end if;

  -- Resolve o pedido pelo order_id_erp
  select o.id, o.order_id_erp
  into v_order
  from public.orders o
  where o.order_id_erp = trim(p_numero_pedido)
  limit 1;

  if not found then
    return jsonb_build_object('matched', false, 'numero_pedido', p_numero_pedido, 'reason', 'pedido nao encontrado');
  end if;

  -- Idempotencia: nao reprocessar a mesma nota de devolucao
  v_external_key := 'erp-return-' || coalesce(
    nullif(trim(coalesce(p_numero_nota_devolucao, '')), ''),
    nullif(trim(coalesce(p_chave_acesso, '')), ''),
    to_char(v_return_date, 'YYYYMMDDHH24MISS')
  );

  if exists (select 1 from public.order_returns r where r.external_key = v_external_key) then
    return jsonb_build_object(
      'matched', true, 'skipped', true, 'order_id', v_order.id,
      'numero_pedido', p_numero_pedido, 'reason', 'nota ja processada', 'external_key', v_external_key
    );
  end if;

  -- Tipo de devolucao (provisorio; a reconciliacao recalcula de forma autoritativa
  -- considerando TODAS as devolucoes processadas do pedido).
  with sel as (
    select trim(elem->>'codigo') as sku,
           sum(coalesce(nullif(trim(elem->>'qtd'), ''), '0')::numeric) as qty
    from jsonb_array_elements(p_produtos) elem
    group by trim(elem->>'codigo')
  )
  select coalesce(sum(greatest(
           bal.purchased_quantity - bal.returned_quantity - coalesce(s.qty, 0), 0
         )), 0)
  into v_remaining_after
  from public.order_item_shadow_balances bal
  left join sel s on lower(s.sku) = lower(coalesce(bal.sku, ''))
  where bal.order_id = v_order.id and bal.source_present;

  v_return_type := case when v_remaining_after <= 0 then 'total' else 'partial' end;

  -- Cabecalho da devolucao (processed, para acionar a reconciliacao)
  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_nfe_key,
    return_date, return_type, return_xml, reason, processing_status
  ) values (
    v_order.id,
    v_external_key,
    nullif(trim(coalesce(p_numero_nota_devolucao, '')), ''),
    nullif(trim(coalesce(p_chave_acesso, '')), ''),
    v_return_date,
    v_return_type,
    nullif(p_return_xml, ''),
    nullif(trim(coalesce(p_reason, '')), ''),
    'processed'
  )
  returning id into v_return_id;

  -- Itens: casa cada produto do ERP (codigo) com order_items por SKU e aloca a qtd.
  for v_prod in select value from jsonb_array_elements(p_produtos)
  loop
    v_sku := trim(coalesce(v_prod->>'codigo', ''));
    v_qty := coalesce(nullif(trim(coalesce(v_prod->>'qtd', '')), ''), '0')::numeric;

    if v_sku = '' or v_qty <= 0 then
      continue;
    end if;

    v_remaining := v_qty;

    -- Aloca de forma gulosa entre as linhas de order_items com o mesmo SKU,
    -- priorizando as com maior saldo disponivel.
    for v_line in
      select oi.id as order_item_id,
             oi.source_line_key,
             oi.sku,
             oi.product_name,
             greatest(bal.purchased_quantity - bal.returned_quantity, 0) as available
      from public.order_items oi
      join public.order_item_shadow_balances bal on bal.order_item_id = oi.id
      where oi.order_id = v_order.id
        and oi.source_present
        and lower(trim(coalesce(oi.sku, ''))) = lower(v_sku)
      order by greatest(bal.purchased_quantity - bal.returned_quantity, 0) desc, oi.id
    loop
      exit when v_remaining <= 0;
      v_alloc := least(v_remaining, greatest(v_line.available, 0));
      -- Se a linha nao tem saldo mas ainda ha qtd a alocar e e a unica, registra assim mesmo
      -- (over-return: os triggers de capacidade marcam divergencia para auditoria).
      if v_alloc <= 0 then
        continue;
      end if;

      insert into public.order_return_items (
        return_id, order_item_id, source_item_key, sku_snapshot, product_name_snapshot, returned_quantity
      ) values (
        v_return_id, v_line.order_item_id, v_line.source_line_key, v_line.sku, v_line.product_name, v_alloc
      );

      v_remaining := v_remaining - v_alloc;
      v_matched_qty := v_matched_qty + v_alloc;
      v_items_inserted := v_items_inserted + 1;
    end loop;

    -- Sobra de quantidade (ERP diz mais do que o saldo, ou SKU sem saldo):
    -- registra o excedente na primeira linha do SKU para nao perder a informacao
    -- do ERP; os triggers de capacidade marcam a divergencia.
    if v_remaining > 0 then
      select oi.id as order_item_id, oi.source_line_key, oi.sku, oi.product_name
      into v_line
      from public.order_items oi
      where oi.order_id = v_order.id
        and lower(trim(coalesce(oi.sku, ''))) = lower(v_sku)
      order by oi.id
      limit 1;

      if found then
        insert into public.order_return_items (
          return_id, order_item_id, source_item_key, sku_snapshot, product_name_snapshot, returned_quantity
        ) values (
          v_return_id, v_line.order_item_id, v_line.source_line_key, v_line.sku, v_line.product_name, v_remaining
        );
        v_matched_qty := v_matched_qty + v_remaining;
        v_items_inserted := v_items_inserted + 1;
      else
        -- SKU do ERP nao existe no pedido: nao ha como vincular. Registra para auditoria.
        v_unmatched := v_unmatched || jsonb_build_object('codigo', v_sku, 'qtd', v_remaining);
      end if;
    end if;
  end loop;

  -- Se nenhum item casou, desfaz o cabecalho (nao faz sentido uma devolucao vazia).
  if v_items_inserted = 0 then
    delete from public.order_return_items where return_id = v_return_id;
    delete from public.order_returns where id = v_return_id;
    return jsonb_build_object(
      'matched', true, 'order_id', v_order.id, 'numero_pedido', p_numero_pedido,
      'inserted', false, 'reason', 'nenhum SKU casou com o pedido', 'unmatched', v_unmatched
    );
  end if;

  -- Dispara a reconciliacao: preenche todo o legado no orders + carimba a montagem.
  perform public.sync_order_return_operational_state(v_order.id);

  return jsonb_build_object(
    'matched', true,
    'inserted', true,
    'order_id', v_order.id,
    'numero_pedido', p_numero_pedido,
    'return_id', v_return_id,
    'return_type', v_return_type,
    'items_inserted', v_items_inserted,
    'quantity_returned', v_matched_qty,
    'unmatched', v_unmatched
  );
end;
$function$;

-- Permissoes: a ponte e chamada pelo n8n (papel privilegiado/service_role), NUNCA
-- pelo cliente anon. Segue a mesma politica do Bloco 2.
REVOKE EXECUTE ON FUNCTION public.ingest_erp_return(text, jsonb, text, text, text, timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ingest_erp_return(text, jsonb, text, text, text, timestamptz, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.ingest_erp_return(text, jsonb, text, text, text, timestamptz, text) TO service_role;

COMMIT;
