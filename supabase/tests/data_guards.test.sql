-- Regression test for 20261106000000_data_guards.sql: negative stock, price,
-- order total and coin balance are refused; normal values and empty (NULL)
-- stock still work; running the migration twice is harmless.
--
-- Run via `npm run test:db`. Wrapped in one transaction that is rolled back.

BEGIN;

CREATE TABLE menu_items (id text PRIMARY KEY, price integer NOT NULL, stock_quantity integer DEFAULT 99);
CREATE TABLE addons (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), price integer, stock_quantity integer DEFAULT 99);
CREATE TABLE orders (id text PRIMARY KEY, total integer NOT NULL);
CREATE TABLE profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), points integer DEFAULT 0);
CREATE TABLE swap_slots (menu_item_id text, slot_no integer, default_meat text);

INSERT INTO menu_items VALUES ('1', 1290, 5);
INSERT INTO addons (price, stock_quantity) VALUES (150, 3);
INSERT INTO orders VALUES ('A', 1290);
INSERT INTO profiles (points) VALUES (10);

\i supabase/migrations/20261106000000_data_guards.sql
-- run twice on purpose: the migration must be safe to repeat
\i supabase/migrations/20261106000000_data_guards.sql

CREATE FUNCTION pg_temp.expect(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; END $$;
CREATE FUNCTION pg_temp.expect_error(p_sql text, p_expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_expected || '%' THEN
      RAISE EXCEPTION 'FAIL: expected error containing "%" but got "%"', p_expected, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: expected error containing "%" but the call succeeded', p_expected;
END $$;

-- Refused.
SELECT pg_temp.expect_error($q$UPDATE menu_items SET stock_quantity = -1 WHERE id = '1'$q$, 'menu_items_stock_not_negative');
SELECT pg_temp.expect_error($q$UPDATE addons SET stock_quantity = -1$q$, 'addons_stock_not_negative');
SELECT pg_temp.expect_error($q$UPDATE menu_items SET price = -100 WHERE id = '1'$q$, 'menu_items_price_not_negative');
SELECT pg_temp.expect_error($q$UPDATE addons SET price = -1$q$, 'addons_price_not_negative');
SELECT pg_temp.expect_error($q$UPDATE orders SET total = -5 WHERE id = 'A'$q$, 'orders_total_not_negative');
SELECT pg_temp.expect_error($q$UPDATE profiles SET points = -1$q$, 'profiles_points_not_negative');

-- Still fine: zero, normal values, and "no stock tracking" (NULL).
UPDATE menu_items SET stock_quantity = 0 WHERE id = '1';
UPDATE menu_items SET stock_quantity = NULL WHERE id = '1';
UPDATE menu_items SET price = 1490 WHERE id = '1';
UPDATE addons SET price = 0, stock_quantity = 0;
UPDATE orders SET total = 0 WHERE id = 'A';
UPDATE profiles SET points = 0;
SELECT pg_temp.expect((SELECT price FROM menu_items WHERE id = '1') = 1490, 'normal price edit works');

-- The new index exists.
SELECT pg_temp.expect(EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_swap_slots_default_meat'), 'default_meat index exists');

DO $$ BEGIN RAISE NOTICE 'PASS: data guards assertions passed'; END $$;

ROLLBACK;
