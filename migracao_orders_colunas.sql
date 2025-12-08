-- SUGESTÕES DE MIGRAÇÃO PARA CORRIGIR COLUNAS OBSOLETAS
-- Execute no Supabase na ordem sugerida

-- ============================================
-- 1. ANÁLISE E BACKUP (execute primeiro)
-- ============================================

-- Criar backup dos dados antes de remover colunas
CREATE TABLE orders_backup_$(date +%Y%m%d) AS 
SELECT id, order_id_erp, id_unico_integracao, tipo, cliente_celular, phone, tem_montagem 
FROM orders;

-- ============================================
-- 2. MIGRAÇÃO DE DADOS (se necessário)
-- ============================================

-- 2.1 Migrar cliente_celular para phone (se phone estiver vazio)
UPDATE orders 
SET phone = COALESCE(phone, cliente_celular)
WHERE (phone IS NULL OR phone = '') 
  AND (cliente_celular IS NOT NULL AND cliente_celular != '');

-- 2.2 Verificar se há divergências entre cliente_celular e phone
-- Se houver divergências, decidir qual manter (geralmente phone é o principal)
SELECT 
    id, 
    order_id_erp, 
    phone as telefone_principal, 
    cliente_celular as telefone_celular,
    CASE 
        WHEN phone != cliente_celular THEN 'DIVERGENTE'
        ELSE 'OK'
    END as status
FROM orders 
WHERE cliente_celular IS NOT NULL 
  AND phone IS NOT NULL 
  AND cliente_celular != phone;

-- ============================================
-- 3. REMOÇÃO DE COLUNAS OBSOLETAS
-- ============================================

-- 3.1 Remover coluna cliente_celular (redundante com phone)
ALTER TABLE orders DROP COLUMN IF EXISTS cliente_celular;

-- 3.2 Remover coluna tipo (não está sendo usada no código)
ALTER TABLE orders DROP COLUMN IF EXISTS tipo;

-- 3.3 Remover coluna tem_montagem (substituído por has_assembly nos items_json)
ALTER TABLE orders DROP COLUMN IF EXISTS tem_montagem;

-- ============================================
-- 4. ATUALIZAR CÓDIGO DE IMPORTAÇÃO
-- ============================================

-- 4.1 Remover mapeamento dessas colunas do código
-- Arquivo: src/pages/admin/OrdersImport.tsx
-- Remover as linhas:
--   tipo: o.tipo ? parseInt(String(o.tipo)) : null,
--   cliente_celular: String(o.cliente_celular ?? ''),
--   tem_montagem: String(o.tem_montagem ?? ''),

-- 4.2 Manter apenas o mapeamento para phone:
--   phone: String(o.cliente_celular ?? ''),

-- ============================================
-- 5. ATUALIZAR COLUNA id_unico_integracao (OPCIONAL)
-- ============================================

-- 5.1 Se id_unico_integracao não estiver vindo mais no JSON,
-- mas ainda é usado para verificação de duplicados,
-- podemos mantê-lo por enquanto ou criar uma lógica alternativa

-- 5.2 Verificar se ainda existem valores únicos
SELECT 
    COUNT(DISTINCT id_unico_integracao) as unicos,
    COUNT(*) as total,
    CASE 
        WHEN COUNT(DISTINCT id_unico_integracao) = COUNT(*) THEN 'TODOS UNICOS'
        ELSE 'EXISTEM DUPLICADOS'
    END as status
FROM orders 
WHERE id_unico_integracao IS NOT NULL;

-- ============================================
-- 6. LIMPAR DADOS INCONSISTENTES
-- ============================================

-- 6.1 Limpar campos vazios e padronizar
UPDATE orders 
SET phone = NULLIF(TRIM(phone), ''),
    id_unico_integracao = NULLIF(TRIM(CAST(id_unico_integracao AS TEXT)), '')
WHERE phone = '' OR CAST(id_unico_integracao AS TEXT) = '';

-- ============================================
-- 7. ATUALIZAR INDICES
-- ============================================

-- Remover índices das colunas deletadas (se existirem)
DROP INDEX IF EXISTS idx_orders_cliente_celular;
DROP INDEX IF EXISTS idx_orders_tipo;
DROP INDEX IF EXISTS idx_orders_tem_montagem;

-- Garantir índice na coluna phone (principal)
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);

-- ============================================
-- 8. VERIFICAÇÃO FINAL
-- ============================================

-- Verificar estrutura final
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'orders' AND table_schema = 'public'
ORDER BY ordinal_position;

-- Contar registros com dados principais
SELECT 
    COUNT(*) as total,
    COUNT(phone) as com_telefone,
    COUNT(id_unico_integracao) as com_id_unico
FROM orders;