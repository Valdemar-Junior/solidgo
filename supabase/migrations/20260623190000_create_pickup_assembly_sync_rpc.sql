CREATE OR REPLACE FUNCTION public.sync_missing_assembly_products_for_pickup(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_order record;
    v_item jsonb;
    v_has_assembly_raw text;
    v_has_mount_bool_raw text;
    v_item_sku text;
    v_item_name text;
    v_item_qty int;
    v_existing_count int;
    v_missing_count int;
    v_inserted_products int := 0;
    i int;
BEGIN
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'order_id e obrigatorio';
    END IF;

    SELECT
        o.id,
        o.status,
        o.customer_name,
        o.phone,
        o.address_json,
        o.items_json
    INTO v_order
    FROM public.orders o
    WHERE o.id = p_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido % nao encontrado', p_order_id;
    END IF;

    IF v_order.status <> 'delivered' THEN
        RAISE EXCEPTION 'Pedido % precisa estar delivered para sincronizar montagem da retirada. Status atual: %', p_order_id, v_order.status;
    END IF;

    IF v_order.items_json IS NULL OR jsonb_typeof(v_order.items_json) <> 'array' THEN
        RETURN jsonb_build_object(
            'order_id', p_order_id,
            'inserted_products', 0
        );
    END IF;

    FOR v_item IN
        SELECT * FROM jsonb_array_elements(v_order.items_json)
    LOOP
        v_has_assembly_raw := lower(trim(COALESCE(v_item->>'has_assembly', '')));
        v_has_mount_bool_raw := lower(trim(COALESCE(v_item->>'possui_montagem', '')));

        IF NOT (
            v_has_assembly_raw IN ('sim', 's', 'true', '1', 'yes', 'y') OR
            v_has_mount_bool_raw IN ('sim', 's', 'true', '1', 'yes', 'y')
        ) THEN
            CONTINUE;
        END IF;

        v_item_sku := trim(COALESCE(
            v_item->>'sku',
            v_item->>'codigo',
            v_item->>'codigo_produto',
            ''
        ));

        IF v_item_sku = '' THEN
            v_item_sku := 'SKU-INDEF';
        END IF;

        v_item_name := COALESCE(
            NULLIF(trim(v_item->>'name'), ''),
            NULLIF(trim(v_item->>'produto'), ''),
            NULLIF(trim(v_item->>'descricao'), ''),
            NULLIF(trim(v_item->>'descricao_produto'), ''),
            NULLIF(trim(v_item->>'nome_do_produto'), ''),
            'Produto sem nome'
        );

        v_item_qty := GREATEST(
            COALESCE(
                CASE WHEN COALESCE(v_item->>'purchased_quantity', '') ~ '^\d+$' THEN (v_item->>'purchased_quantity')::int END,
                CASE WHEN COALESCE(v_item->>'quantity', '') ~ '^\d+$' THEN (v_item->>'quantity')::int END,
                1
            ),
            1
        );

        SELECT COUNT(*)
          INTO v_existing_count
          FROM public.assembly_products ap
         WHERE ap.order_id = p_order_id
           AND COALESCE(ap.product_sku, 'SKU-INDEF') = v_item_sku;

        v_missing_count := v_item_qty - COALESCE(v_existing_count, 0);

        IF v_missing_count > 0 THEN
            FOR i IN 1..v_missing_count LOOP
                INSERT INTO public.assembly_products (
                    order_id,
                    product_name,
                    product_sku,
                    customer_name,
                    customer_phone,
                    installation_address,
                    status,
                    created_at,
                    updated_at
                ) VALUES (
                    p_order_id,
                    v_item_name,
                    v_item_sku,
                    v_order.customer_name,
                    v_order.phone,
                    v_order.address_json,
                    'pending',
                    timezone('utc', now()),
                    timezone('utc', now())
                );
            END LOOP;

            v_inserted_products := v_inserted_products + v_missing_count;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'order_id', p_order_id,
        'inserted_products', v_inserted_products
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_missing_assembly_products_for_pickup(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.sync_missing_assembly_products_for_pickup(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_missing_assembly_products_for_pickup(uuid) TO service_role;
