-- Regression test for 20261111000000_online_payments.sql.
-- Run via `npm run test:db`. One transaction, rolled back.
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE TABLE store_settings (id text PRIMARY KEY DEFAULT 'main_store', status text DEFAULT 'OPEN');
INSERT INTO store_settings (id) VALUES ('main_store');
CREATE TABLE orders (id text PRIMARY KEY, status text NOT NULL DEFAULT 'PENDING', total integer NOT NULL, channel text DEFAULT 'web',
  items jsonb, user_id uuid, cancel_reason text, cancel_note text);
CREATE TABLE menu_items (id text PRIMARY KEY, stock_quantity integer, in_stock boolean DEFAULT true);
CREATE TABLE addons (id text PRIMARY KEY, stock_quantity integer, in_stock boolean DEFAULT true);
CREATE TABLE profiles (id uuid PRIMARY KEY, points integer DEFAULT 0);
CREATE TABLE redemptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, order_id text, status text, points_spent integer);
GRANT SELECT, UPDATE ON orders TO authenticated, service_role;
GRANT SELECT ON store_settings TO anon, authenticated;

INSERT INTO menu_items VALUES ('1', 5, true);
INSERT INTO addons VALUES ('ad1', 4, true);
INSERT INTO profiles VALUES ('11111111-1111-1111-1111-111111111111', 100);

\i supabase/migrations/20261111000000_online_payments.sql
\i supabase/migrations/20261111000000_online_payments.sql

CREATE FUNCTION pg_temp.expect(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; END $$;
CREATE FUNCTION pg_temp.expect_error(p_sql text, p_expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_expected || '%' THEN RAISE EXCEPTION 'FAIL: expected "%" got "%"', p_expected, SQLERRM; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: expected error "%" but the call succeeded', p_expected;
END $$;

-- Switch OFF: behaves as today, orders are PAID.
INSERT INTO orders (id, total) VALUES ('OFF1', 1000);
SELECT pg_temp.expect((SELECT payment_status FROM orders WHERE id='OFF1') = 'PAID', 'flag off: order is PAID');

-- Switch ON: app orders are UNPAID with a window; other channels stay PAID.
UPDATE store_settings SET online_payments_enabled = true;
INSERT INTO orders (id, total, items, user_id) VALUES
  ('A1', 3590, '[{"id":"1","quantity":2,"selectedAddons":[{"id":"ad1"}]}]', '11111111-1111-1111-1111-111111111111');
INSERT INTO orders (id, total, channel) VALUES ('G1', 2000, 'Grab'), ('L1', 2000, 'Loyverse');
SELECT pg_temp.expect((SELECT payment_status FROM orders WHERE id='A1') = 'UNPAID', 'flag on: app order UNPAID');
SELECT pg_temp.expect((SELECT payment_expires_at > now() + interval '14 minutes' FROM orders WHERE id='A1'), '15 minute window');
SELECT pg_temp.expect((SELECT payment_status FROM orders WHERE id='G1') = 'PAID', 'Grab stays PAID');
SELECT pg_temp.expect((SELECT payment_status FROM orders WHERE id='L1') = 'PAID', 'Loyverse stays PAID');

-- An unpaid order cannot be cooked or collected; a browser cannot mark it paid.
SELECT pg_temp.expect_error($q$UPDATE orders SET status='COOKING' WHERE id='A1'$q$, 'not been paid');
SELECT pg_temp.expect_error($q$UPDATE orders SET status='COLLECTED' WHERE id='A1'$q$, 'not been paid');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$UPDATE orders SET payment_status='PAID' WHERE id='A1'$q$, 'only be changed by the payment system');
SELECT pg_temp.expect_error($q$UPDATE orders SET payment_expires_at = now() + interval '1 day' WHERE id='A1'$q$, 'only be changed by the payment system');
SELECT pg_temp.expect(NOT has_function_privilege('authenticated', 'public.confirm_order_payment(text,text,text,integer)', 'EXECUTE'), 'browsers cannot confirm payments');
RESET ROLE;
SELECT pg_temp.expect(has_function_privilege('service_role', 'public.confirm_order_payment(text,text,text,integer)', 'EXECUTE'), 'payment system can confirm');

-- Confirmation: exact amount only, once.
SELECT pg_temp.expect(public.confirm_order_payment('A1', 'testpay', 'ref-1', 3500) = 'AMOUNT_MISMATCH', 'wrong amount refused');
SELECT pg_temp.expect((SELECT payment_status FROM orders WHERE id='A1') = 'UNPAID', 'still unpaid after mismatch');
SELECT pg_temp.expect(public.confirm_order_payment('NOPE', 'testpay', 'ref-x', 1) = 'NOT_FOUND', 'unknown order');
SELECT pg_temp.expect(public.confirm_order_payment('A1', 'testpay', 'ref-1', 3590) = 'PAID', 'exact amount pays');
SELECT pg_temp.expect((SELECT paid_cents = 3590 AND paid_at IS NOT NULL AND payment_ref = 'ref-1' FROM orders WHERE id='A1'), 'payment recorded');
SELECT pg_temp.expect(public.confirm_order_payment('A1', 'testpay', 'ref-1', 3590) = 'ALREADY_PAID', 'webhook repeat is harmless');
UPDATE orders SET status = 'COOKING' WHERE id = 'A1';   -- paid orders move on normally
SELECT pg_temp.expect((SELECT status FROM orders WHERE id='A1') = 'COOKING', 'paid order can be cooked');

-- One gateway payment cannot settle two orders.
INSERT INTO orders (id, total) VALUES ('A2', 1000);
SELECT pg_temp.expect_error($q$SELECT public.confirm_order_payment('A2', 'testpay', 'ref-1', 1000)$q$, 'uq_orders_gateway_ref');

-- Expiry: overdue unpaid orders are cancelled, stock returns, coins refund.
INSERT INTO orders (id, total, items, user_id) VALUES
  ('E1', 3590, '[{"id":"1","quantity":2,"selectedAddons":[{"id":"ad1"}]}]', '11111111-1111-1111-1111-111111111111'),
  ('E2', 1000, '[{"id":"1","quantity":1}]', NULL);
UPDATE menu_items SET stock_quantity = 3 WHERE id = '1';
UPDATE addons SET stock_quantity = 2 WHERE id = 'ad1';
INSERT INTO redemptions (user_id, order_id, status, points_spent) VALUES ('11111111-1111-1111-1111-111111111111', 'E1', 'FULFILLED', 50);
UPDATE profiles SET points = 50;
ALTER TABLE orders DISABLE TRIGGER trg_protect_order_payment;
UPDATE orders SET payment_expires_at = now() - interval '1 minute' WHERE id = 'E1';
ALTER TABLE orders ENABLE TRIGGER trg_protect_order_payment;
SET LOCAL ROLE anon;
SELECT pg_temp.expect(public.expire_unpaid_orders() = 1, 'only the overdue order expires');
RESET ROLE;
SELECT pg_temp.expect((SELECT status = 'CANCELLED' AND payment_status = 'EXPIRED' FROM orders WHERE id='E1'), 'E1 cancelled + expired');
SELECT pg_temp.expect((SELECT status = 'PENDING' AND payment_status = 'UNPAID' FROM orders WHERE id='E2'), 'E2 still within its window');
SELECT pg_temp.expect((SELECT stock_quantity FROM menu_items WHERE id='1') = 5, 'burger stock returned (3 + 2)');
SELECT pg_temp.expect((SELECT stock_quantity FROM addons WHERE id='ad1') = 4, 'add-on stock returned (2 + 2)');
SELECT pg_temp.expect((SELECT points FROM profiles) = 100, 'reward coins refunded');
SELECT pg_temp.expect((SELECT status FROM redemptions WHERE order_id='E1') = 'CANCELLED', 'reward cancelled');
SELECT pg_temp.expect((SELECT status FROM orders WHERE id='A1') = 'COOKING', 'paid orders untouched');
SELECT pg_temp.expect(public.expire_unpaid_orders() = 0, 'second run changes nothing');

-- A payment that arrives after expiry is flagged, not accepted.
SELECT pg_temp.expect(public.confirm_order_payment('E1', 'testpay', 'ref-late', 3590) = 'LATE', 'late payment flagged');
SELECT pg_temp.expect((SELECT late_payment AND status = 'CANCELLED' AND payment_status = 'EXPIRED' FROM orders WHERE id='E1'), 'late order stays cancelled');

DO $$ BEGIN RAISE NOTICE 'PASS: online payments assertions passed'; END $$;
ROLLBACK;
