-- Centraliza a geracao de assembly_products no fechamento da rota.
-- Remove o trigger legado em orders para impedir comportamento dependente de timing.

DROP TRIGGER IF EXISTS trg_auto_assembly ON public.orders;
DROP TRIGGER IF EXISTS tr_sync_assembly_products ON public.orders;

DROP FUNCTION IF EXISTS public.auto_create_assembly_products();
DROP FUNCTION IF EXISTS public.sync_assembly_products_from_order();

CREATE OR REPLACE FUNCTION public.sync_missing_assembly_products_for_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_order record;
    v_latest_route_status text;
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
        RAISE EXCEPTION 'Pedido % precisa estar delivered para sincronizar montagem. Status atual: %', p_order_id, v_order.status;
    END IF;

    SELECT r.status
      INTO v_latest_route_status
      FROM public.route_orders ro
      JOIN public.routes r
        ON r.id = ro.route_id
     WHERE ro.order_id = p_order_id
     ORDER BY COALESCE(r.updated_at, r.created_at) DESC
     LIMIT 1;

    IF v_latest_route_status IS NULL OR v_latest_route_status <> 'completed' THEN
        RAISE EXCEPTION 'Pedido % ainda nao pertence a uma rota finalizada. Status da ultima rota: %', p_order_id, COALESCE(v_latest_route_status, 'sem rota');
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

CREATE OR REPLACE FUNCTION public.sync_missing_assembly_products_for_route(p_route_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_route_status text;
    v_route_order record;
    v_delivered_orders int := 0;
    v_eligible_orders int := 0;
    v_inserted_products int := 0;
    v_order_result jsonb;
    v_order_inserted int;
    v_order_has_eligible_items boolean;
    v_item jsonb;
BEGIN
    IF p_route_id IS NULL THEN
        RAISE EXCEPTION 'route_id e obrigatorio';
    END IF;

    SELECT status
      INTO v_route_status
      FROM public.routes
     WHERE id = p_route_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Rota % nao encontrada', p_route_id;
    END IF;

    IF v_route_status <> 'completed' THEN
        RAISE EXCEPTION 'A rota % precisa estar completed para sincronizar montagem. Status atual: %', p_route_id, v_route_status;
    END IF;

    FOR v_route_order IN
        SELECT
            ro.order_id,
            o.items_json
        FROM public.route_orders ro
        JOIN public.orders o
          ON o.id = ro.order_id
       WHERE ro.route_id = p_route_id
         AND ro.status = 'delivered'
         AND o.status = 'delivered'
    LOOP
        v_delivered_orders := v_delivered_orders + 1;
        v_order_has_eligible_items := false;

        IF v_route_order.items_json IS NOT NULL AND jsonb_typeof(v_route_order.items_json) = 'array' THEN
            FOR v_item IN
                SELECT * FROM jsonb_array_elements(v_route_order.items_json)
            LOOP
                IF lower(trim(COALESCE(v_item->>'has_assembly', ''))) IN ('sim', 's', 'true', '1', 'yes', 'y')
                   OR lower(trim(COALESCE(v_item->>'possui_montagem', ''))) IN ('sim', 's', 'true', '1', 'yes', 'y') THEN
                    v_order_has_eligible_items := true;
                    EXIT;
                END IF;
            END LOOP;
        END IF;

        IF NOT v_order_has_eligible_items THEN
            CONTINUE;
        END IF;

        v_eligible_orders := v_eligible_orders + 1;
        v_order_result := public.sync_missing_assembly_products_for_order(v_route_order.order_id);
        v_order_inserted := COALESCE((v_order_result->>'inserted_products')::int, 0);
        v_inserted_products := v_inserted_products + v_order_inserted;
    END LOOP;

    RETURN jsonb_build_object(
        'route_id', p_route_id,
        'delivered_orders', v_delivered_orders,
        'eligible_orders', v_eligible_orders,
        'inserted_products', v_inserted_products
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_missing_assembly_products_for_order(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_missing_assembly_products_for_route(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.sync_missing_assembly_products_for_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_missing_assembly_products_for_order(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_missing_assembly_products_for_route(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_missing_assembly_products_for_route(uuid) TO service_role;
