-- ============================================================================
-- FIX (achado pela bateria massiva de testes): ingest_erp_return quebrava com
-- ERRO de chave duplicada (order_return_items_source_unique = UNIQUE(return_id,
-- source_item_key)) quando:
--   (a) OVER-RETURN: o ERP manda quantidade MAIOR que a comprada -> o alocador
--       inseria a linha cheia e depois tentava inserir o excedente na MESMA linha;
--   (b) o mesmo codigo aparecia em DUAS entradas do payload de produtos.
-- Em producao isso derrubava o processamento daquela devolucao (dado perdido).
--
-- Correcao: os inserts de order_return_items passam a usar ON CONFLICT DO UPDATE,
-- ACUMULANDO a quantidade na linha existente em vez de duplicar. O saldo passa a
-- refletir o total devolvido (inclusive over-return -> has_over_return = true, que
-- os gatilhos de capacidade ja marcam como divergencia para auditoria).
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
  if nullif(trim(coalesce(p_numero_pedido, '')), '') is null then
    return jsonb_build_object('matched', false, 'reason', 'numero_pedido vazio');
  end if;

  if p_produtos is null or jsonb_typeof(p_produtos) <> 'array' or jsonb_array_length(p_produtos) = 0 then
    return jsonb_build_object('matched', false, 'numero_pedido', p_numero_pedido, 'reason', 'sem produtos');
  end if;

  select o.id, o.order_id_erp
  into v_order
  from public.orders o
  where o.order_id_erp = trim(p_numero_pedido)
  limit 1;

  if not found then
    return jsonb_build_object('matched', false, 'numero_pedido', p_numero_pedido, 'reason', 'pedido nao encontrado');
  end if;

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

  insert into public.order_returns (
    order_id, external_key, return_nfe_number, return_nfe_key,
    return_date, return_type, return_xml, reason, processing_status
  ) values (
    v_order.id, v_external_key,
    nullif(trim(coalesce(p_numero_nota_devolucao, '')), ''),
    nullif(trim(coalesce(p_chave_acesso, '')), ''),
    v_return_date, v_return_type, nullif(p_return_xml, ''),
    nullif(trim(coalesce(p_reason, '')), ''), 'processed'
  )
  returning id into v_return_id;

  for v_prod in select value from jsonb_array_elements(p_produtos)
  loop
    v_sku := trim(coalesce(v_prod->>'codigo', ''));
    v_qty := coalesce(nullif(trim(coalesce(v_prod->>'qtd', '')), ''), '0')::numeric;
    if v_sku = '' or v_qty <= 0 then continue; end if;
    v_remaining := v_qty;

    for v_line in
      select oi.id as order_item_id, oi.source_line_key, oi.sku, oi.product_name,
             greatest(bal.purchased_quantity - bal.returned_quantity, 0) as available
      from public.order_items oi
      join public.order_item_shadow_balances bal on bal.order_item_id = oi.id
      where oi.order_id = v_order.id and oi.source_present
        and lower(trim(coalesce(oi.sku, ''))) = lower(v_sku)
      order by greatest(bal.purchased_quantity - bal.returned_quantity, 0) desc, oi.id
    loop
      exit when v_remaining <= 0;
      v_alloc := least(v_remaining, greatest(v_line.available, 0));
      if v_alloc <= 0 then continue; end if;

      insert into public.order_return_items (
        return_id, order_item_id, source_item_key, sku_snapshot, product_name_snapshot, returned_quantity
      ) values (
        v_return_id, v_line.order_item_id, v_line.source_line_key, v_line.sku, v_line.product_name, v_alloc
      )
      on conflict (return_id, source_item_key) do update
        set returned_quantity = public.order_return_items.returned_quantity + excluded.returned_quantity;

      v_remaining := v_remaining - v_alloc;
      v_matched_qty := v_matched_qty + v_alloc;
      v_items_inserted := v_items_inserted + 1;
    end loop;

    -- Sobra (over-return ou SKU sem saldo): acumula na primeira linha do SKU.
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
        )
        on conflict (return_id, source_item_key) do update
          set returned_quantity = public.order_return_items.returned_quantity + excluded.returned_quantity;

        v_matched_qty := v_matched_qty + v_remaining;
        v_items_inserted := v_items_inserted + 1;
      else
        v_unmatched := v_unmatched || jsonb_build_object('codigo', v_sku, 'qtd', v_remaining);
      end if;
    end if;
  end loop;

  if v_items_inserted = 0 then
    delete from public.order_return_items where return_id = v_return_id;
    delete from public.order_returns where id = v_return_id;
    return jsonb_build_object(
      'matched', true, 'order_id', v_order.id, 'numero_pedido', p_numero_pedido,
      'inserted', false, 'reason', 'nenhum SKU casou com o pedido', 'unmatched', v_unmatched
    );
  end if;

  perform public.sync_order_return_operational_state(v_order.id);

  return jsonb_build_object(
    'matched', true, 'inserted', true, 'order_id', v_order.id,
    'numero_pedido', p_numero_pedido, 'return_id', v_return_id,
    'return_type', v_return_type, 'items_inserted', v_items_inserted,
    'quantity_returned', v_matched_qty, 'unmatched', v_unmatched
  );
end;
$function$;

COMMIT;
