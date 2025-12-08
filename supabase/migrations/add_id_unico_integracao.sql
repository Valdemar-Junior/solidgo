-- Adicionar campo id_unico_integracao na tabela orders para identificação única
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS id_unico_integracao bigint UNIQUE;

-- Criar índice para melhor performance nas buscas
CREATE INDEX IF NOT EXISTS idx_orders_id_unico_integracao ON orders(id_unico_integracao);

-- Atualizar pedidos existentes com base no order_id_erp se possível
UPDATE orders 
SET id_unico_integracao = CAST(order_id_erp AS bigint) 
WHERE id_unico_integracao IS NULL 
AND order_id_erp ~ '^\d+$';