-- SCRIPT COMPLETO PARA ADICIONAR TODAS AS COLUNAS FALTANTES
-- Execute este script completo no Supabase

-- Criar função para adicionar coluna se não existir
CREATE OR REPLACE FUNCTION add_column_if_not_exists(
    table_name TEXT,
    column_name TEXT,
    column_type TEXT
) RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = $1 AND column_name = $2
    ) THEN
        EXECUTE format('ALTER TABLE %I ADD COLUMN %I %s', $1, $2, $3);
        RAISE NOTICE 'Coluna % adicionada à tabela %', $2, $1;
    ELSE
        RAISE NOTICE 'Coluna % já existe na tabela %', $2, $1;
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