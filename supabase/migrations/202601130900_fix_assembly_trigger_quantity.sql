-- Migration to fix assembly product generation for multi-quantity items
-- This function now respects the 'purchased_quantity' or 'quantity' field in items_json
-- and generates multiple assembly tasks if needed.

CREATE OR REPLACE FUNCTION public.sync_assembly_products_from_order()
RETURNS TRIGGER AS $$
DECLARE
    item jsonb;
    should_assemble boolean;
    order_has_keyword boolean;
    clean_sku text;
    clean_name text;
    normalized_obs text;
    qty int;
    current_count int;
    i int;
BEGIN
    -- Normalizar observações para verificação de keyword (*montagem*)
    normalized_obs := lower(coalesce(NEW.observacoes_internas, '') || ' ' || coalesce(NEW.observacoes_publicas, ''));
    order_has_keyword := normalized_obs LIKE '%*montagem*%';

    -- CRÍTICO: Montagem só deve nascer quando o pedido tiver sido ENTREGUE (delivered)
    -- Se o status não for 'delivered', não gera assembly_product ainda.
    IF NEW.status != 'delivered' THEN
        RETURN NEW;
    END IF;

    -- Se não tiver itens, não faz nada
    IF NEW.items_json IS NULL OR jsonb_array_length(NEW.items_json) = 0 THEN
        RETURN NEW;
    END IF;

    -- Iterar sobre os itens do JSON
    FOR item IN SELECT * FROM jsonb_array_elements(NEW.items_json)
    LOOP
        -- Verifica critério: Flag explícita OU Keyword no pedido
        should_assemble := (item->>'has_assembly')::text ~* '^(true|sim|1|yes|y)$' 
                        OR order_has_keyword;

        IF should_assemble THEN
            clean_sku := coalesce(item->>'sku', 'SKU-INDEF');
            clean_name := coalesce(item->>'name', 'Produto sem nome');
            
            -- Determinar quantidade (fallback para 1 se não definido)
            qty := GREATEST(1, coalesce((item->>'purchased_quantity')::int, (item->>'quantity')::int, 1));

            -- Verificar quantos já existem para este pedido e SKU
            SELECT COUNT(*) INTO current_count
            FROM public.assembly_products ap 
            WHERE ap.order_id = NEW.id 
            AND ap.product_sku = clean_sku;

            -- Inserir faltantes (se qty=2 e tem 0, insere 2. Se tem 1, insere 1)
            IF current_count < qty THEN
                FOR i IN 1..(qty - current_count) LOOP
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
                    )
                    VALUES (
                        NEW.id,
                        clean_name,
                        clean_sku,
                        NEW.customer_name,
                        NEW.phone,
                        NEW.address_json,
                        'pending', -- Status inicial
                        NOW(),
                        NOW()
                    );
                END LOOP;
            END IF;
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Not dropping/recreating trigger as the function replacement is sufficient and trigger definition is unchanged.
