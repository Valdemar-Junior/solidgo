-- Adiciona coluna para observação livre do retorno
ALTER TABLE route_orders
ADD COLUMN IF NOT EXISTS return_notes TEXT;
