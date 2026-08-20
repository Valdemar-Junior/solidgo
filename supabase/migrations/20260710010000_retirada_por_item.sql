-- =====================================================================
-- Retirada POR ITEM (parcial)
-- ---------------------------------------------------------------------
-- O cliente pode levar so parte do pedido (ex: ventilador) e deixar o
-- resto (ex: roupeiro) pra entregar depois. Para isso:
--   1) order_item_holds ganha o status terminal 'picked_up' (item retirado
--      -> some da fila e da aba Em Espera, mas o pedido continua com o resto);
--   2) order_withdrawals ganha a coluna 'items' (snapshot dos itens retirados,
--      pro comprovante sair so com o que o cliente levou);
--   3) uma versao "por item" da funcao de montagem da retirada, que cria as
--      tarefas de montagem SO dos itens retirados (nao dos que ficaram).
-- Nao altera o comportamento da retirada de pedido inteiro (que continua igual).
-- =====================================================================

-- 1) Novo status terminal 'picked_up' -----------------------------------
ALTER TABLE public.order_item_holds
  DROP CONSTRAINT IF EXISTS order_item_holds_status_check;
ALTER TABLE public.order_item_holds
  ADD CONSTRAINT order_item_holds_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'released'::text, 'picked_up'::text]));

-- 2) Snapshot dos itens retirados no comprovante ------------------------
ALTER TABLE public.order_withdrawals
  ADD COLUMN IF NOT EXISTS items jsonb;

COMMENT ON COLUMN public.order_withdrawals.items IS
  'Snapshot dos itens efetivamente retirados (null = pedido inteiro, usa items_json do pedido).';

-- 3) Montagem da retirada POR ITEM --------------------------------------
CREATE OR REPLACE FUNCTION public.sync_missing_assembly_products_for_pickup_items(
  p_order_id uuid,
  p_skus text[]
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order record;
  v_target_item record;
  v_existing_count int;
  v_missing_count int;
  v_inserted_products int := 0;
  v_norm_skus text[];
  i int;
begin
  if p_order_id is null then
    raise exception 'order_id e obrigatorio';
  end if;

  if p_skus is null or array_length(p_skus, 1) is null then
    return jsonb_build_object('order_id', p_order_id, 'inserted_products', 0);
  end if;

  -- normaliza os SKUs recebidos (mesma regra do restante do sistema)
  select array_agg(distinct coalesce(nullif(trim(s), ''), 'SKU-INDEF'))
  into v_norm_skus
  from unnest(p_skus) as s;

  select o.id, o.customer_name, o.phone, o.address_json
  into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'Pedido % nao encontrado', p_order_id;
  end if;

  for v_target_item in
    select
      coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF') as product_sku,
      max(oi.product_name) as product_name,
      greatest(floor(sum(coalesce(bal.shadow_deliverable_quantity, 0))), 0)::int as target_quantity
    from public.order_item_shadow_balances bal
    join public.order_items oi on oi.id = bal.order_item_id
    where oi.order_id = p_order_id
      and oi.source_present
      and public.order_item_payload_requires_assembly(oi.source_payload)
      and coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF') = any (v_norm_skus)
    group by coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF')
    having greatest(floor(sum(coalesce(bal.shadow_deliverable_quantity, 0))), 0)::int > 0
  loop
    select count(*)
    into v_existing_count
    from public.assembly_products ap
    where ap.order_id = p_order_id
      and coalesce(ap.product_sku, 'SKU-INDEF') = v_target_item.product_sku;

    v_missing_count := v_target_item.target_quantity - coalesce(v_existing_count, 0);

    if v_missing_count > 0 then
      for i in 1..v_missing_count loop
        insert into public.assembly_products (
          order_id, product_name, product_sku, customer_name, customer_phone,
          installation_address, status, created_at, updated_at
        ) values (
          p_order_id, v_target_item.product_name, v_target_item.product_sku,
          v_order.customer_name, v_order.phone, v_order.address_json,
          'pending', timezone('utc', now()), timezone('utc', now())
        );
      end loop;
      v_inserted_products := v_inserted_products + v_missing_count;
    end if;
  end loop;

  return jsonb_build_object('order_id', p_order_id, 'inserted_products', v_inserted_products);
end;
$$;

ALTER FUNCTION public.sync_missing_assembly_products_for_pickup_items(uuid, text[]) OWNER TO postgres;
GRANT ALL ON FUNCTION public.sync_missing_assembly_products_for_pickup_items(uuid, text[]) TO anon;
GRANT ALL ON FUNCTION public.sync_missing_assembly_products_for_pickup_items(uuid, text[]) TO authenticated;
GRANT ALL ON FUNCTION public.sync_missing_assembly_products_for_pickup_items(uuid, text[]) TO service_role;
