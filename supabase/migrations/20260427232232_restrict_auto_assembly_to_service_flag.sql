CREATE OR REPLACE FUNCTION public.auto_create_assembly_products()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    item JSONB;
    item_sku TEXT;
    item_name TEXT;
    item_qty INT;
    existing_count INT;
    missing_count INT;
    route_status TEXT;
    i INT;
    has_assembly_raw TEXT;
    has_mount_bool_raw TEXT;
BEGIN
    -- So processa se o pedido estiver entregue
    IF NEW.status <> 'delivered' THEN
        RETURN NEW;
    END IF;

    -- So processa se items_json existir e for array
    IF NEW.items_json IS NULL OR jsonb_typeof(NEW.items_json) <> 'array' THEN
        RETURN NEW;
    END IF;

    -- So cria montagem quando a rota de entrega mais recente estiver finalizada
    SELECT r.status INTO route_status
    FROM route_orders ro
    JOIN routes r ON r.id = ro.route_id
    WHERE ro.order_id = NEW.id
    ORDER BY COALESCE(r.updated_at, r.created_at) DESC
    LIMIT 1;

    IF route_status IS NULL OR route_status <> 'completed' THEN
        RETURN NEW;
    END IF;

    FOR item IN SELECT * FROM jsonb_array_elements(NEW.items_json)
    LOOP
        -- has_assembly representa montagem contratada; produto_e_montavel e so caracteristica do produto.
        has_assembly_raw := lower(trim(COALESCE(item->>'has_assembly', '')));
        has_mount_bool_raw := lower(trim(COALESCE(item->>'possui_montagem', '')));

        IF NOT (
            has_assembly_raw IN ('sim', 's', 'true', '1', 'yes', 'y') OR
            has_mount_bool_raw IN ('true', '1', 'sim', 's', 'yes', 'y')
        ) THEN
            CONTINUE;
        END IF;

        item_sku := COALESCE(item->>'sku', item->>'codigo', '');
        item_name := COALESCE(
            item->>'name',
            item->>'nome_do_produto',
            item->>'produto',
            item->>'descricao',
            item->>'descricao_produto',
            'Produto sem nome'
        );

        item_qty := GREATEST(
            COALESCE(
                CASE WHEN COALESCE(item->>'purchased_quantity', '') ~ '^\d+$' THEN (item->>'purchased_quantity')::INT END,
                CASE WHEN COALESCE(item->>'quantity', '') ~ '^\d+$' THEN (item->>'quantity')::INT END,
                1
            ),
            1
        );

        SELECT COUNT(*) INTO existing_count
        FROM assembly_products
        WHERE order_id = NEW.id
          AND product_sku = item_sku;

        missing_count := item_qty - existing_count;

        IF missing_count > 0 THEN
            FOR i IN 1..missing_count LOOP
                INSERT INTO assembly_products (
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
                    NEW.id,
                    item_name,
                    item_sku,
                    NEW.customer_name,
                    NEW.phone,
                    NEW.address_json,
                    'pending',
                    NOW(),
                    NOW()
                );
            END LOOP;
        END IF;
    END LOOP;

    RETURN NEW;
END;
$function$;
