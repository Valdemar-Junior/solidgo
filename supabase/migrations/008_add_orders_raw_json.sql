-- Add raw_json column to orders to store full webhook payload
ALTER TABLE orders ADD COLUMN IF NOT EXISTS raw_json JSONB;
