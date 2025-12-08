-- 🚀 SCRIPT AGRESSIVO - REMOVER COLUNAS COM FORCE
-- Execute este script para forçar a remoção das colunas obsoletas

-- ============================================
-- 1. REMOVER CONSTRAINTS DAS COLUNAS (se existirem)
-- ============================================

-- Remover constraints de cliente_celular
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_cliente_celular_key;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_cliente_celular_check;

-- Remover constraints de tipo
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_tipo_check;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_tipo_key;

-- Remover constraints de tem_montagem
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_tem_montagem_check;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_tem_montagem_key;

-- ============================================
-- 2. REMOVER ÍNDICES DAS COLUNAS (se existirem)
-- ============================================

-- Remover índices
DROP INDEX IF EXISTS idx_orders_cliente_celular;
DROP INDEX IF EXISTS idx_orders_tipo;
DROP INDEX IF EXISTS idx_orders_tem_montagem;

-- ============================================
-- 3. FORÇAR REMOÇÃO DAS COLUNAS COM CASCADE
-- ============================================

-- Criar backup antes de remover (se ainda não existir)
CREATE TABLE IF NOT EXISTS orders_backup_20241130 AS 
SELECT id, order_id_erp, id_unico_integracao, tipo, cliente_celular, phone, tem_montagem 
FROM orders;

-- REMOVER COLUNAS COM CASCADE (força remoção mesmo com dependências)
ALTER TABLE orders DROP COLUMN IF EXISTS cliente_celular CASCADE;
ALTER TABLE orders DROP COLUMN IF EXISTS tipo CASCADE;
ALTER TABLE orders DROP COLUMN IF EXISTS tem_montagem CASCADE;

-- ============================================
-- 4. VERIFICAR RESULTADO
-- ============================================

-- Verificar se as colunas foram removidas
SELECT 
    CASE 
        WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns 
                        WHERE table_schema = 'public' 
                          AND table_name = 'orders' 
                          AND column_name = 'cliente_celular') 
        THEN '✅ cliente_celular REMOVIDA'
        ELSE '❌ cliente_celular AINDA EXISTE'
    END as cliente_celular_status,
    
    CASE 
        WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns 
                        WHERE table_schema = 'public' 
                          AND table_name = 'orders' 
                          AND column_name = 'tipo') 
        THEN '✅ tipo REMOVIDA'
        ELSE '❌ tipo AINDA EXISTE'
    END as tipo_status,
    
    CASE 
        WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns 
                        WHERE table_schema = 'public' 
                          AND table_name = 'orders' 
                          AND column_name = 'tem_montagem') 
        THEN '✅ tem_montagem REMOVIDA'
        ELSE '❌ tem_montagem AINDA EXISTE'
    END as tem_montagem_status;

-- Verificar estrutura final
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'orders' 
ORDER BY ordinal_position;

-- Contar total de colunas antes e depois
SELECT 
    (SELECT COUNT(*) FROM information_schema.columns 
     WHERE table_schema = 'public' AND table_name = 'orders') as total_colunas_atual,
    'Colunas removidas: cliente_celular, tipo, tem_montagem' as acao_realizada;

-- Mensagem final
SELECT '🎯 Migração forçada concluída! Verifique os status acima.' as status;