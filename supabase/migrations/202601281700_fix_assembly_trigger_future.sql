-- Migration: Fix Assembly Trigger to support Quantities and Status Changes
-- Date: 2026-01-28
-- Description: 
-- 1. Updates sync_assembly_products_from_order to properly handle purchased_quantity (creating multiple cards).
-- 2. Updates tr_sync_assembly_products to fire on STATUS changes (handling Pending -> Delivered flow).

-- 1. Update the Function
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
            
            -- LÓGICA DE QUANTIDADE (Correção)
            -- Determina a quantidade alvo: purchased_quantity > quantity > 1
            qty := GREATEST(1, coalesce((item->>'purchased_quantity')::int, (item->>'quantity')::int, 1));

            -- Verificar quantos já existem para este pedido e SKU
            SELECT COUNT(*) INTO current_count
            FROM public.assembly_products ap 
            WHERE ap.order_id = NEW.id 
            AND ap.product_sku = clean_sku;

            -- Inserir FALTANTES (A Trava de Segurança)
            -- Se qty=2 e tem 0 -> Insere 2
            -- Se qty=2 e tem 1 -> Insere 1
            -- Se qty=2 e tem 2 -> Não faz nada
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
                        'pending', -- Status inicial da Montagem
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

-- 2. Update the Trigger
DROP TRIGGER IF EXISTS tr_sync_assembly_products ON public.orders;

CREATE TRIGGER tr_sync_assembly_products
AFTER INSERT OR UPDATE OF items_json, observacoes_internas, status
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_assembly_products_from_order();
