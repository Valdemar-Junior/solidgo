-- SCRIPT PARA CORRIGIR COLUNAS FALTANTES NA TABELA ORDERS
-- Execute cada comando separadamente para verificar erros

-- 1. Verificar quais colunas já existem
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'orders' AND table_schema = 'public'
ORDER BY ordinal_position;

-- 2. Adicionar apenas as colunas que não existem
DO $$
BEGIN
    -- Adicionar cliente_celular (se não existir)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'orders' AND column_name = 'cliente_celular') THEN
        ALTER TABLE orders ADD COLUMN cliente_celular TEXT;
        RAISE NOTICE 'Coluna cliente_celular adicionada';
    ELSE
        RAISE NOTICE 'Coluna cliente_celular já existe';
    END IF;

    -- Adicionar destinatario_complemento (se não existir)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'orders' AND column_name = 'destinatario_complemento') THEN
        ALTER TABLE orders ADD COLUMN destinatario_complemento TEXT;
        RAISE NOTICE 'Coluna destinatario_complemento adicionada';
    ELSE
        RAISE NOTICE 'Coluna destinatario_complemento já existe';
    END IF;

    -- Adicionar tem_frete_full (se não existir)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'orders' AND column_name = 'tem_frete_full') THEN
        ALTER TABLE orders ADD COLUMN tem_frete_full TEXT;
        RAISE NOTICE 'Coluna tem_frete_full adicionada';
    ELSE
        RAISE NOTICE 'Coluna tem_frete_full já existe';
    END IF;

    -- Adicionar local_estocagem (se não existir)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'orders' AND column_name = 'local_estocagem') THEN
        ALTER TABLE orders ADD COLUMN local_estocagem TEXT;
        RAISE NOTICE 'Coluna local_estocagem adicionada';
    ELSE
        RAISE NOTICE 'Coluna local_estocagem já existe';
    END IF;

    -- Adicionar tem_montagem (se não existir)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'orders' AND column_name = 'tem_montagem') THEN
        ALTER TABLE orders ADD COLUMN tem_montagem TEXT;
        RAISE NOTICE 'Coluna tem_montagem adicionada';
    ELSE
        RAISE NOTICE 'Coluna tem_montagem já existe';
    END IF;

END $$;

-- 3. Verificar estrutura final
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'orders' AND table_schema = 'public'
ORDER BY ordinal_position;