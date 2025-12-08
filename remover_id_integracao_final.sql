-- 🚀 REMOVER COLUNA id_unico_integracao
-- Execute este script para remover a coluna que não é mais usada

-- ============================================
-- 1. BACKUP DOS DADOS (se ainda não foi feito)
-- ============================================

-- Criar backup completo (se não existir)
CREATE TABLE IF NOT EXISTS orders_backup_completo_20241130 AS 
SELECT * FROM orders;

-- ============================================
-- 2. REMOVER CONSTRAINTS E ÍNDICES
-- ============================================

-- Remover constraints
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_id_unico_integracao_key;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_id_unico_integracao_check;

-- Remover índices
DROP INDEX IF EXISTS idx_orders_id_unico_integracao;
DROP INDEX IF EXISTS idx_orders_id_unico;

-- ============================================
-- 3. FORÇAR REMOÇÃO DA COLUNA
-- ============================================

-- Remover coluna com CASCADE (força remoção mesmo com dependências)
ALTER TABLE orders DROP COLUMN IF EXISTS id_unico_integracao CASCADE;

-- ============================================
-- 4. VERIFICAR RESULTADO
-- ============================================

-- Verificar se a coluna foi removida
SELECT 
    CASE 
        WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns 
                        WHERE table_schema = 'public' 
                          AND table_name = 'orders' 
                          AND column_name = 'id_unico_integracao') 
        THEN '✅ id_unico_integracao REMOVIDA COM SUCESSO!'
        ELSE '❌ id_unico_integracao AINDA EXISTE'
    END as resultado;

-- Verificar estrutura final da tabela
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'orders' 
ORDER BY ordinal_position;

-- Contar total de colunas
SELECT 
    (SELECT COUNT(*) FROM information_schema.columns 
     WHERE table_schema = 'public' AND table_name = 'orders') as total_colunas,
    'Colunas removidas: cliente_celular, tipo, tem_montagem, id_unico_integracao' as acao_realizada;

-- ============================================
-- 5. ATUALIZAR CÓDIGO (IMPORTANTE!)
-- ============================================

-- Mensagem para lembrar de atualizar o código
SELECT '📋 LEMBRETE: Atualize o código para não usar mais id_unico_integracao!' as lembrete;

-- Mensagem final
SELECT '🎯 Migração completa! Todas as colunas obsoletas removidas.' as status;