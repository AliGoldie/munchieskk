-- Regression test for 20261029000000_private_item_costs.sql: cost prices
-- leave the public menu tables, land in item_costs unchanged, and only an
-- admin can read or write them.
--
-- Run via `npm run test:db`. Wrapped in one transaction that is rolled back.

BEGIN;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;

CREATE TABLE profiles (id uuid PRIMARY KEY, role text DEFAULT 'customer');
CREATE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$$;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;

CREATE TABLE menu_items (id text PRIMARY KEY, name text, price integer, cost_price integer);
CREATE TABLE addons (id text PRIMARY KEY, name text, price integer, cost_price integer);
GRANT SELECT ON menu_items, addons TO anon, authenticated;

INSERT INTO profiles VALUES ('a0000000-0000-0000-0000-000000000001', 'admin'),
                            ('c0000000-0000-0000-0000-000000000002', 'customer');
INSERT INTO menu_items VALUES ('2', 'Fries', 700, 210), ('3', 'Ice BB', 650, NULL);
INSERT INTO addons VALUES ('a1', 'Cheese', 200, 80);

CREATE FUNCTION pg_temp.expect(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.expect(boolean, text) TO anon, authenticated;

\i supabase/migrations/20261029000000_private_item_costs.sql
-- run twice on purpose: the migration must be safe to repeat
\i supabase/migrations/20261029000000_private_item_costs.sql

-- Costs copied exactly; items without a cost get no row.
SELECT pg_temp.expect((SELECT cost_price FROM item_costs WHERE item_kind = 'menu' AND item_id = '2') = 210, 'menu cost copied');
SELECT pg_temp.expect((SELECT cost_price FROM item_costs WHERE item_kind = 'addon' AND item_id = 'a1') = 80, 'add-on cost copied');
SELECT pg_temp.expect((SELECT count(*) FROM item_costs) = 2, 'only items with a cost are copied');

-- The public tables no longer carry a cost column at all.
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_name IN ('menu_items', 'addons') AND column_name = 'cost_price'), 'public cost columns dropped');

-- A guest cannot touch the table.
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM 1 FROM item_costs;
  RAISE EXCEPTION 'FAIL: anon could read item_costs';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

-- A signed-in customer sees nothing and cannot write.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000002', true);
SELECT pg_temp.expect((SELECT count(*) FROM item_costs) = 0, 'customer sees no costs');
DO $$ BEGIN
  INSERT INTO item_costs (item_kind, item_id, cost_price) VALUES ('menu', '3', 1);
  RAISE EXCEPTION 'FAIL: customer could write a cost';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

-- An admin reads and saves costs.
SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
SELECT pg_temp.expect((SELECT count(*) FROM item_costs) = 2, 'admin sees all costs');
INSERT INTO item_costs (item_kind, item_id, cost_price) VALUES ('menu', '3', 195)
  ON CONFLICT (item_kind, item_id) DO UPDATE SET cost_price = EXCLUDED.cost_price, updated_at = now();
SELECT pg_temp.expect((SELECT cost_price FROM item_costs WHERE item_id = '3') = 195, 'admin can save a cost');
RESET ROLE;

-- Bad values are refused.
DO $$ BEGIN
  INSERT INTO item_costs (item_kind, item_id, cost_price) VALUES ('drink', 'x', 1);
  RAISE EXCEPTION 'FAIL: unknown item kind accepted';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
DO $$ BEGIN
  INSERT INTO item_costs (item_kind, item_id, cost_price) VALUES ('menu', 'x', -5);
  RAISE EXCEPTION 'FAIL: negative cost accepted';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

DO $$ BEGIN RAISE NOTICE 'PASS: private item costs assertions passed'; END $$;

ROLLBACK;
