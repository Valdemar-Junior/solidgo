-- 🔍 DIAGNÓSTICO - VERIFICAR POR QUE COLUNAS NÃO FORAM REMOVIDAS
-- Execute este script para entender o que aconteceu

-- 1. Verificar se as colunas ainda existem
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    ordinal_position
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'orders' 
  AND column_name IN ('cliente_celular', 'tipo', 'tem_montagem', 'id_unico_integracao')
ORDER BY ordinal_position;

-- 2. Verificar se existe alguma constraint impedindo a remoção
SELECT 
    constraint_name,
    constraint_type,
    table_name,
    column_name
FROM information_schema.constraint_column_usage 
WHERE table_schema = 'public' 
  AND table_name = 'orders' 
  AND column_name IN ('cliente_celular', 'tipo', 'tem_montagem', 'id_unico_integracao');

-- 3. Verificar se existe índices nessas colunas
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND tablename = 'orders' 
  AND indexdef LIKE ANY (ARRAY[
    '%cliente_celular%',
    '%tipo%',
    '%tem_montagem%',
    '%id_unico_integracao%'
  ]);

-- 4. Verificar se a tabela de backup foi criada
SELECT 
    table_name,
    table_type
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name LIKE 'orders_backup_%'
ORDER BY table_name DESC
LIMIT 5;

-- 5. Tentar remover manualmente cada coluna com FORCE
-- Execute um por vez para ver o erro específico:

-- ALTER TABLE orders DROP COLUMN IF EXISTS cliente_celular CASCADE;
-- ALTER TABLE orders DROP COLUMN IF EXISTS tipo CASCADE;
-- ALTER TABLE orders DROP COLUMN IF EXISTS tem_montagem CASCADE;

-- 6. Verificar estrutura atual completa
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'orders' 
ORDER BY ordinal_position;

-- Mensagem para debug
SELECT '🔍 Diagnóstico concluído. Verifique os resultados acima.' as status;