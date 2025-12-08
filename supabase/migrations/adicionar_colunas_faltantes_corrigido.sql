-- SCRIPT CORRIGIDO PARA ADICIONAR COLUNAS FALTANTES
-- Execute este script completo no Supabase

-- Criar função para adicionar coluna se não existir (CORRIGIDA)
CREATE OR REPLACE FUNCTION add_column_if_not_exists(
    p_table_name TEXT,
    p_column_name TEXT,
    p_column_type TEXT
) RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = p_table_name AND column_name = p_column_name
    ) THEN
        EXECUTE format('ALTER TABLE %I ADD COLUMN %I %s', p_table_name, p_column_name, p_column_type);
        RAISE NOTICE 'Coluna % adicionada à tabela %', p_column_name, p_table_name;
    ELSE
        RAISE NOTICE 'Coluna % já existe na tabela %', p_column_name, p_table_name;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Adicionar todas as colunas faltantes
SELECT add_column_if_not_exists('orders', 'cliente_celular', 'TEXT');
SELECT add_column_if_not_exists('orders', 'destinatario_complemento', 'TEXT');
SELECT add_column_if_not_exists('orders', 'destinatario_bairro', 'TEXT');
SELECT add_column_if_not_exists('orders', 'destinatario_cidade', 'TEXT');
SELECT add_column_if_not_exists('orders', 'tem_frete_full', 'TEXT');
SELECT add_column_if_not_exists('orders', 'local_estocagem', 'TEXT');
SELECT add_column_if_not_exists('orders', 'tem_montagem', 'TEXT');

-- Verificar estrutura final
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'orders' AND table_schema = 'public'
ORDER BY ordinal_position;