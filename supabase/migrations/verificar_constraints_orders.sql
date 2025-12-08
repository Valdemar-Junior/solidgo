-- VERIFICAR E CORRIGIR CONSTRAINTS DA TABELA ORDERS
-- Script para identificar e resolver problema de duplicados

-- 1. Verificar todas as constraints da tabela orders
SELECT 
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    tc.constraint_type
FROM 
    information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
WHERE tc.table_name = 'orders' AND tc.table_schema = 'public'
ORDER BY tc.constraint_type, tc.constraint_name;

-- 2. Verificar se existe constraint única em lancamento_venda
SELECT constraint_name, column_name 
FROM information_schema.constraint_column_usage 
WHERE table_name = 'orders' AND constraint_name LIKE '%lancamento_venda%';

-- 3. Verificar se existe constraint única em id_unico_integracao
SELECT constraint_name, column_name 
FROM information_schema.constraint_column_usage 
WHERE table_name = 'orders' AND constraint_name LIKE '%id_unico_integracao%';

-- 4. Listar todos os índices únicos da tabela
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes 
WHERE tablename = 'orders' AND indexdef LIKE '%UNIQUE%';

-- 5. DROPAR constraints problemáticas (DESCOMENTE APÓS VERIFICAR)
-- ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_lancamento_venda_key;
-- ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_id_erp_key;

-- 6. Criar constraint única apenas em id_unico_integracao (DESCOMENTE APÓS VERIFICAR)
-- ALTER TABLE orders ADD CONSTRAINT orders_id_unico_integracao_unique UNIQUE (id_unico_integracao);

-- 7. Verificar dados duplicados existentes
SELECT lancamento_venda, COUNT(*) 
FROM orders 
GROUP BY lancamento_venda 
HAVING COUNT(*) > 1;

SELECT id_unico_integracao, COUNT(*) 
FROM orders 
GROUP BY id_unico_integracao 
HAVING COUNT(*) > 1;

-- 8. Limpar tabela se necessário (CUIDADO! DESCOMENTE APÓNAS SE QUISER LIMPAR TUDO)
-- TRUNCATE TABLE orders RESTART IDENTITY CASCADE;