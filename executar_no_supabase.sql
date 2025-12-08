-- 🚀 MIGRAÇÃO FINAL - REMOVER COLUNAS OBSOLETAS
-- Execute estes comandos no SQL Editor do Supabase

-- ============================================
-- 1. BACKUP DOS DADOS (execute primeiro)
-- ============================================

-- Criar backup antes de remover colunas
CREATE TABLE orders_backup_20241130 AS 
SELECT id, order_id_erp, id_unico_integracao, tipo, cliente_celular, phone, tem_montagem 
FROM orders;

-- ============================================
-- 2. MIGRAR DADOS NECESSÁRIOS
-- ============================================

-- Migrar cliente_celular para phone (somente se phone estiver vazio)
UPDATE orders 
SET phone = COALESCE(NULLIF(TRIM(phone), ''), cliente_celular)
WHERE (phone IS NULL OR TRIM(phone) = '') 
  AND (cliente_celular IS NOT NULL AND TRIM(cliente_celular) != '');

-- ============================================
-- 3. REMOVER COLUNAS OBSOLETAS
-- ============================================

-- Remover coluna cliente_celular (redundante com phone)
ALTER TABLE orders DROP COLUMN IF EXISTS cliente_celular;

-- Remover coluna tipo (não está sendo usada)
ALTER TABLE orders DROP COLUMN IF EXISTS tipo;

-- Remover coluna tem_montagem (substituído por has_assembly nos items_json)
ALTER TABLE orders DROP COLUMN IF EXISTS tem_montagem;

-- ============================================
-- 4. LIMPAR DADOS INCONSISTENTES
-- ============================================

-- Limpar campos vazios e padronizar
UPDATE orders 
SET phone = NULLIF(TRIM(phone), '')
WHERE TRIM(phone) = '';

-- ============================================
-- 5. VERIFICAÇÃO FINAL
-- ============================================

-- Verificar estrutura final da tabela
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'orders' 
ORDER BY ordinal_position;

-- Contar registros com dados principais
SELECT 
    COUNT(*) as total_registros,
    COUNT(phone) as com_telefone,
    COUNT(numero_lancamento) as com_numero_lancamento
FROM orders;

-- Mensagem de sucesso
SELECT '✅ Migração concluída com sucesso!' as status;