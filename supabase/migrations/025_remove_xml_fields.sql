-- Remover campos XML desnecessários da tabela orders
-- Esses campos foram adicionados anteriormente mas não serão mais usados

-- Remover índices relacionados aos campos XML primeiro
DROP INDEX IF EXISTS idx_orders_numero_nfe;
DROP INDEX IF EXISTS idx_orders_chave_acesso;
DROP INDEX IF EXISTS idx_orders_xml_danfe_remessa;

-- Remover as colunas XML que não serão mais usadas
ALTER TABLE orders DROP COLUMN IF EXISTS xml_danfe_remessa;
ALTER TABLE orders DROP COLUMN IF EXISTS numero_nfe_remessa;
ALTER TABLE orders DROP COLUMN IF EXISTS chave_acesso_nfe;
ALTER TABLE IF EXISTS orders DROP COLUMN IF EXISTS conteudo_xml;

-- Verificar quais colunas restaram
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'orders' 
AND table_schema = 'public'
ORDER BY ordinal_position;