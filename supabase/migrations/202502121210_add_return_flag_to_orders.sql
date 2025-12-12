-- Marca pedidos retornados para reaproveitar na roteirização com histórico
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS return_flag BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_return_reason TEXT,
ADD COLUMN IF NOT EXISTS last_return_notes TEXT;
