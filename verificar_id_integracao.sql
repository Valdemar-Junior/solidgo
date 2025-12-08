-- 🔍 ANÁLISE DA COLUNA id_unico_integracao
-- Execute para verificar se esta coluna ainda é necessária

-- 1. Verificar quantos registros têm id_unico_integracao
SELECT 
    COUNT(*) as total_registros,
    COUNT(id_unico_integracao) as com_id_integracao,
    COUNT(*) - COUNT(id_unico_integracao) as sem_id_integracao,
    ROUND(COUNT(id_unico_integracao) * 100.0 / COUNT(*), 2) as percentual_com_dados
FROM orders;

-- 2. Verificar se há valores duplicados em id_unico_integracao
SELECT 
    id_unico_integracao,
    COUNT(*) as quantidade
FROM orders 
WHERE id_unico_integracao IS NOT NULL 
GROUP BY id_unico_integracao 
HAVING COUNT(*) > 1
ORDER BY quantidade DESC
LIMIT 10;

-- 3. Verificar os últimos registros inseridos
SELECT 
    id,
    order_id_erp,
    numero_lancamento,
    id_unico_integracao,
    created_at
FROM orders 
ORDER BY created_at DESC 
LIMIT 10;

-- 4. Verificar se a coluna é NULLABLE (pode ser removida)
SELECT 
    column_name,
    is_nullable,
    data_type,
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'orders' 
  AND column_name = 'id_unico_integracao';

-- 5. Verificar se existem constraints ou índices
SELECT 
    constraint_name,
    constraint_type
FROM information_schema.constraint_column_usage 
WHERE table_schema = 'public' 
  AND table_name = 'orders' 
  AND column_name = 'id_unico_integracao';

-- Índices
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND tablename = 'orders' 
  AND indexdef LIKE '%id_unico_integracao%';

-- 6. Mensagem de status
SELECT 
    CASE 
        WHEN COUNT(id_unico_integracao) = 0 THEN '🔴 Coluna VAZIA - pode ser removida'
        WHEN COUNT(id_unico_integracao) > 0 AND COUNT(*) = COUNT(id_unico_integracao) THEN '🟡 Coluna COMPLETAMENTE preenchida'
        ELSE '🟢 Coluna PARCIALMENTE preenchida'
    END as status_removacao
FROM orders;