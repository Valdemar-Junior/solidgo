-- Remover trigger de montagem automática
-- A lógica agora ficará no código de importação (OrdersImport.tsx)
-- que detecta a keyword *montagem* e seta has_assembly = 'Sim' nos itens

DROP TRIGGER IF EXISTS tr_sync_assembly_products ON public.orders;
DROP FUNCTION IF EXISTS public.sync_assembly_products_from_order();
