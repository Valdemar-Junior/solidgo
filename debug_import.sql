-- VERIFICAR O QUE ESTÁ ACONTECENDO COM A IMPORTAÇÃO

-- 1. Verificar se há algum pedido na tabela
SELECT COUNT(*) as total_pedidos FROM orders;

-- 2. Verificar estrutura da tabela orders
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'orders' 
ORDER BY ordinal_position;

-- 3. Verificar se o campo id_unico_integracao foi criado corretamente
SELECT COUNT(*) as pedidos_com_id_unico 
FROM orders 
WHERE id_unico_integracao IS NOT NULL;

-- 4. Verificar últimos pedidos inseridos
SELECT id, order_id_erp, id_unico_integracao, customer_name, created_at 
FROM orders 
ORDER BY created_at DESC 
LIMIT 10;

-- 5. Verificar se há índice único no id_unico_integracao
SELECT * 
FROM pg_indexes 
WHERE tablename = 'orders' 
AND indexname LIKE '%id_unico_integracao%';