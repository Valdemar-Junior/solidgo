-- Função para sincronizar produtos de montagem a partir do pedido
CREATE OR REPLACE FUNCTION public.sync_assembly_products_from_order()
RETURNS TRIGGER AS $$
DECLARE
    item jsonb;
    should_assemble boolean;
    order_has_keyword boolean;
    clean_sku text;
    clean_name text;
    normalized_obs text;
BEGIN
    -- Normalizar observações para verificação de keyword (*montagem*)
    normalized_obs := lower(coalesce(NEW.observacoes_internas, '') || ' ' || coalesce(NEW.observacoes_publicas, ''));
    order_has_keyword := normalized_obs LIKE '%*montagem*%';

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

            -- Inserir APENAS se não existir registro pendente/ativo para este pedido+sku
            -- Isso evita duplicar se o pedido for atualizado múltiplas vezes
            IF NOT EXISTS (
                SELECT 1 FROM public.assembly_products ap 
                WHERE ap.order_id = NEW.id 
                AND ap.product_sku = clean_sku
            ) THEN
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
            END IF;
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Remover trigger antigo se existir (para evitar duplicidade durante dev)
DROP TRIGGER IF EXISTS tr_sync_assembly_products ON public.orders;

-- Criar Trigger
CREATE TRIGGER tr_sync_assembly_products
AFTER INSERT OR UPDATE OF items_json, observacoes_internas ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_assembly_products_from_order();

-- BACKFILL: Corrigir pedidos passados que deveriam ter entrado e não entraram
-- Especialmente o caso reportado (ID 117875 e similares)
DO $$
DECLARE
    ord RECORD;
    item jsonb;
    clean_sku text;
    clean_name text;
    should_assemble boolean;
    normalized_obs text;
BEGIN
    FOR ord IN SELECT * FROM public.orders WHERE status != 'cancelled' LOOP
        normalized_obs := lower(coalesce(ord.observacoes_internas, '') || ' ' || coalesce(ord.observacoes_publicas, ''));
        
        IF ord.items_json IS NOT NULL AND jsonb_array_length(ord.items_json) > 0 THEN
            FOR item IN SELECT * FROM jsonb_array_elements(ord.items_json) LOOP
                should_assemble := (item->>'has_assembly')::text ~* '^(true|sim|1|yes|y)$' 
                                OR normalized_obs LIKE '%*montagem*%';

                IF should_assemble THEN
                    clean_sku := coalesce(item->>'sku', 'SKU-INDEF');
                    clean_name := coalesce(item->>'name', 'Produto sem nome');

                    IF NOT EXISTS (
                        SELECT 1 FROM public.assembly_products ap 
                        WHERE ap.order_id = ord.id 
                        AND ap.product_sku = clean_sku
                    ) THEN
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
                            ord.id,
                            clean_name,
                            clean_sku,
                            ord.customer_name,
                            ord.phone,
                            ord.address_json,
                            'pending',
                            NOW(),
                            NOW()
                        );
                    END IF;
                END IF;
            END LOOP;
        END IF;
    END LOOP;
END $$;
