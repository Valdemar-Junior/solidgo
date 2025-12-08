-- Adicionar novos campos à tabela orders baseado no JSON reformulado
-- Script seguro que apenas adiciona colunas que não existem

-- Campos principais do pedido
ALTER TABLE orders ADD COLUMN IF NOT EXISTS numero_lancamento BIGINT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS observacoes_publicas TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS observacoes_internas TEXT;

-- Campos adicionais de produtos (sem campos XML pois usaremos o xml_documento existente)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quantidade_volumes INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS etiquetas TEXT[];

-- Índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_orders_numero_lancamento ON orders(numero_lancamento);