-- ANÁLISE DAS COLUNAS DA TABELA ORDERS
-- Execute estas queries no Supabase para verificar a situação

-- 1. Verificar estrutura atual da tabela
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default,
    CASE 
        WHEN column_name IN ('id_unico_integracao', 'tipo', 'cliente_celular', 'tem_montagem') 
        THEN 'CANDIDATO A REMOÇÃO'
        ELSE 'OK'
    END as status
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'orders' 
ORDER BY ordinal_position;

-- 2. Verificar preenchimento das colunas problemáticas
SELECT 
    COUNT(*) AS total_registros,
    
    -- Análise id_unico_integracao
    COUNT(*) FILTER (WHERE id_unico_integracao IS NOT NULL) AS id_unico_preenchidos,
    ROUND(COUNT(*) FILTER (WHERE id_unico_integracao IS NOT NULL) * 100.0 / COUNT(*), 2) AS id_unico_percentual,
    
    -- Análise tipo
    COUNT(*) FILTER (WHERE tipo IS NOT NULL) AS tipo_preenchidos,
    ROUND(COUNT(*) FILTER (WHERE tipo IS NOT NULL) * 100.0 / COUNT(*), 2) AS tipo_percentual,
    
    -- Análise cliente_celular (redundante com phone)
    COUNT(*) FILTER (WHERE cliente_celular IS NOT NULL AND cliente_celular != '') AS cliente_celular_preenchidos,
    ROUND(COUNT(*) FILTER (WHERE cliente_celular IS NOT NULL AND cliente_celular != '') * 100.0 / COUNT(*), 2) AS cliente_celular_percentual,
    
    -- Análise phone (coluna principal)
    COUNT(*) FILTER (WHERE phone IS NOT NULL AND phone != '') AS phone_preenchidos,
    ROUND(COUNT(*) FILTER (WHERE phone IS NOT NULL AND phone != '') * 100.0 / COUNT(*), 2) AS phone_percentual,
    
    -- Análise tem_montagem
    COUNT(*) FILTER (WHERE tem_montagem IS NOT NULL AND tem_montagem != '') AS tem_montagem_preenchidos,
    ROUND(COUNT(*) FILTER (WHERE tem_montagem IS NOT NULL AND tem_montagem != '') * 100.0 / COUNT(*), 2) AS tem_montagem_percentual

FROM orders;

-- 3. Verificar se existe divergência entre cliente_celular e phone
SELECT 
    COUNT(*) FILTER (WHERE cliente_celular IS NOT NULL AND phone IS NULL) AS so_cliente_celular,
    COUNT(*) FILTER (WHERE cliente_celular IS NULL AND phone IS NOT NULL) AS so_phone,
    COUNT(*) FILTER (WHERE cliente_celular IS NOT NULL AND phone IS NOT NULL AND cliente_celular != phone) AS diferentes,
    COUNT(*) FILTER (WHERE cliente_celular IS NOT NULL AND phone IS NOT NULL AND cliente_celular = phone) AS iguais
FROM orders;

-- 4. Verificar se há id_unico_integracao duplicado (importante para a lógica atual)
SELECT 
    id_unico_integracao,
    COUNT(*) as quantidade
FROM orders 
WHERE id_unico_integracao IS NOT NULL 
GROUP BY id_unico_integracao 
HAVING COUNT(*) > 1;

-- 5. Verificar uso atual de tem_montagem vs has_assembly nos items
SELECT 
    tem_montagem,
    COUNT(*) as quantidade,
    CASE 
        WHEN tem_montagem IN ('SIM', 'sim') THEN 'Com montagem'
        WHEN tem_montagem IS NULL THEN 'Sem dados'
        ELSE 'Sem montagem'
    END as classificacao
FROM orders 
GROUP BY tem_montagem
ORDER BY quantidade DESC;