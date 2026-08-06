-- Part 1: Loyverse integration schema changes for orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel text DEFAULT 'web';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS external_id text UNIQUE;

-- Create index on external_id for fast upsert lookups
CREATE INDEX IF NOT EXISTS idx_orders_external_id ON orders(external_id);
