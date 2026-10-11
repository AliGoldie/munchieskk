-- Regression test for supabase/migrations/20261011000000_order_integrity_hardening.sql
-- (security audit). Each section reproduces an exploit that worked against
-- the previous place_order / cancel_order / collect_order and asserts it no
-- longer does, plus that the normal ordering flow is unchanged.
--
-- NOTE: supabase/tests/order_rpc_security.test.sql still loads only the
-- 20260929000000 migration, so its "guest checkout" / "anonymous cancel of a
-- guest order" scenarios describe that older behaviour on purpose; this test
-- covers the current rules.
--
-- Run via `npm run test:db`. Wrapped in one transaction that is rolled back.

BEGIN;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE TABLE profiles (
  id uuid PRIMARY KEY,
  role text DEFAULT 'user',
  points integer DEFAULT 0,
  referred_by uuid,
  referral_converted_at timestamptz
);

CREATE TABLE menu_items (
  id text PRIMARY KEY,
  name text,
  category text,
  price integer,
  promo_price integer,
  promo_start timestamptz,
  promo_end timestamptz,
  stock_quantity integer,
  in_stock boolean
);

CREATE TABLE addons (
  id text PRIMARY KEY,
  name text,
  price integer,
  stock_quantity integer,
  in_stock boolean
);

CREATE TABLE addon_deduction_log (
  id bigserial PRIMARY KEY,
  order_id text,
  addon_id text,
  quantity integer,
  stock_before integer,
  stock_after integer,
  logged_at timestamptz
);

CREATE TABLE orders (
  id text PRIMARY KEY,
  items jsonb,
  total integer,
  status text,
  payment_method text,
  customer_name text,
  customer_phone text,
  user_id uuid,
  promo_code_used text,
  discount_amount integer,
  notes text,
  cancel_reason text,
  cancel_note text,
  created_at timestamptz
);

CREATE TABLE store_settings (
  id text PRIMARY KEY,
  status text,
  opening_time text,
  closing_time text,
  weekly_schedule jsonb,
  special_closures jsonb
);

CREATE TABLE referral_rewards_log (
  id bigserial PRIMARY KEY,
  referrer_id uuid,
  referred_id uuid,
  reward_type text,
  points_awarded integer,
  order_id text,
  logged_at timestamptz
);

CREATE TABLE waste_log (
  id bigserial PRIMARY KEY,
  order_id text,
  item_id text,
  quantity integer,
  reason text,
  logged_by uuid
);

CREATE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;


-- Roles exist cluster-wide (run-db-tests.sh creates them).
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Supabase hands EXECUTE on every new function straight to anon and
-- authenticated (not via PUBLIC), which is why the earlier REVOKE ... FROM
-- PUBLIC calls never closed anything. Simulate that default here.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;

\i supabase/migrations/20260929000000_lock_down_order_rpcs.sql
\i supabase/migrations/20260929000003_switch_order_points_to_rm1_equals_1pt.sql
\i supabase/migrations/20260929000004_cap_referral_bonus_per_referrer.sql

-- Stand-ins for objects created by older migrations this test does not load.
CREATE FUNCTION public.award_engagement_points(p_user_id uuid, p_source text, p_desired_points integer)
RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT 0 $$;
CREATE FUNCTION public.collect_order(p_order_id text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.handle_order_collected() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'COLLECTED' AND OLD.status IS DISTINCT FROM 'COLLECTED' AND NEW.user_id IS NOT NULL THEN
    UPDATE public.profiles SET points = COALESCE(points, 0) + 10 WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_order_placed_award_points AFTER INSERT ON orders FOR EACH ROW EXECUTE FUNCTION handle_order_placed();
CREATE TRIGGER trg_order_collected_award_points AFTER UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION handle_order_collected();
CREATE POLICY "_test_probe_policy" ON public.orders FOR SELECT USING (false);

-- The migration under test.
\i supabase/migrations/20261011000000_order_integrity_hardening.sql

INSERT INTO store_settings (id, status, opening_time, closing_time, weekly_schedule, special_closures)
VALUES ('main_store', 'OPEN', '17:00', '23:00', '{}'::jsonb, '[]'::jsonb);
INSERT INTO menu_items (id, name, category, price, stock_quantity, in_stock) VALUES
  ('platter', 'Platter', 'PLATTERS', 6990, 200, true),
  ('pepsi', 'Pepsi', 'DRINKS', 350, 100, true);
INSERT INTO profiles (id, role, points) VALUES
  ('11111111-1111-1111-1111-111111111111', 'user', 0),
  ('22222222-2222-2222-2222-222222222222', 'user', 0),
  ('33333333-3333-3333-3333-333333333333', 'admin', 0);

-- Helper: expect an exception whose message starts with `expected`.
CREATE FUNCTION pg_temp.expect_error(p_sql text, p_expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE p_expected || '%' THEN
      RAISE EXCEPTION 'FAIL: expected error "%" but got "%"', p_expected, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: expected error "%" but the call succeeded', p_expected;
END $$;

SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- ---------------------------------------------------------------------------
-- 1. Negative / zero / oversized quantities are rejected (free food, stock inflation)
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect_error($q$
  SELECT public.place_order(
    '[{"item_id":"platter","quantity":1},{"item_id":"pepsi","quantity":-100}]'::jsonb,
    '{"items":[{"id":"platter","quantity":1},{"id":"pepsi","quantity":1}],"status":"PENDING","payment_method":"Cash"}'::jsonb)
$q$, 'Invalid item quantity');
SELECT pg_temp.expect_error($q$
  SELECT public.place_order('[{"item_id":"pepsi","quantity":0}]'::jsonb,
    '{"items":[{"id":"pepsi","quantity":1}],"status":"PENDING","payment_method":"Cash"}'::jsonb)
$q$, 'Invalid item quantity');
SELECT pg_temp.expect_error($q$
  SELECT public.place_order('[{"item_id":"pepsi","quantity":51}]'::jsonb,
    '{"items":[{"id":"pepsi","quantity":51}],"status":"PENDING","payment_method":"Cash"}'::jsonb)
$q$, 'Invalid item quantity');
SELECT pg_temp.expect_error($q$
  SELECT public.place_order('[{"item_id":"pepsi","quantity":1}]'::jsonb,
    '{"items":[],"status":"PENDING","payment_method":"Cash"}'::jsonb, NULL, NULL,
    '[{"addon_id":"x","quantity":-5}]'::jsonb)
$q$, 'Invalid add-on quantity');
DO $$
BEGIN
  IF (SELECT stock_quantity FROM menu_items WHERE id = 'pepsi') <> 100 THEN
    RAISE EXCEPTION 'FAIL: a rejected order must not change stock';
  END IF;
  IF EXISTS (SELECT 1 FROM orders) THEN
    RAISE EXCEPTION 'FAIL: a rejected order must not be saved';
  END IF;
END $$;

-- An order that lists nothing real is rejected, not saved as a RM0 order.
SELECT pg_temp.expect_error($q$
  SELECT public.place_order('[]'::jsonb, '{"items":[],"status":"PENDING","payment_method":"Cash"}'::jsonb)
$q$, 'Your order is empty');

-- ---------------------------------------------------------------------------
-- 2. A normal order still works; the status is always PENDING whatever the browser says
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id text;
  v_status text;
  v_total integer;
  v_points integer;
BEGIN
  v_id := public.place_order(
    '[{"item_id":"platter","quantity":2}]'::jsonb,
    '{"items":[{"id":"platter","quantity":2}],"status":"COLLECTED","payment_method":"Cash","customer_name":"Ali"}'::jsonb);
  SELECT status, total INTO v_status, v_total FROM orders WHERE id = v_id;
  IF v_status <> 'PENDING' THEN
    RAISE EXCEPTION 'FAIL: client-supplied status must be ignored, got %', v_status;
  END IF;
  IF v_total <> 13980 THEN
    RAISE EXCEPTION 'FAIL: expected total 13980 (2 x RM69.90), got %', v_total;
  END IF;
  SELECT points INTO v_points FROM profiles WHERE id = '11111111-1111-1111-1111-111111111111';
  IF v_points <> 140 THEN
    RAISE EXCEPTION 'FAIL: expected 140 points for RM139.80, got %', v_points;
  END IF;
  IF (SELECT stock_quantity FROM menu_items WHERE id = 'platter') <> 198 THEN
    RAISE EXCEPTION 'FAIL: expected platter stock 198';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Place + cancel is not a points machine: points are taken back, stock restored
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_before integer;
  v_after integer;
  v_id text;
BEGIN
  SELECT points INTO v_before FROM profiles WHERE id = '11111111-1111-1111-1111-111111111111';
  v_id := public.place_order('[{"item_id":"platter","quantity":10}]'::jsonb,
    '{"items":[{"id":"platter","quantity":10}],"status":"PENDING","payment_method":"Cash"}'::jsonb);
  IF (SELECT points FROM profiles WHERE id = '11111111-1111-1111-1111-111111111111') <> v_before + 699 THEN
    RAISE EXCEPTION 'FAIL: placing a RM699 order should earn 699 points';
  END IF;
  PERFORM public.cancel_order(v_id, 'changed my mind');
  SELECT points INTO v_after FROM profiles WHERE id = '11111111-1111-1111-1111-111111111111';
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'FAIL: cancelling must take the order points back (before %, after %)', v_before, v_after;
  END IF;
  IF (SELECT stock_quantity FROM menu_items WHERE id = 'platter') <> 198 THEN
    RAISE EXCEPTION 'FAIL: cancel must restore stock';
  END IF;
  -- cancelling twice is refused, so points cannot be clawed back twice either
  PERFORM pg_temp.expect_error(format('SELECT public.cancel_order(%L, ''again'')', v_id), 'Cannot cancel');
END $$;

-- ---------------------------------------------------------------------------
-- 4. Open-order cap per customer
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  i integer;
BEGIN
  -- the customer already has 1 PENDING order from section 2; add 4 more
  FOR i IN 1..4 LOOP
    PERFORM public.place_order('[{"item_id":"pepsi","quantity":1}]'::jsonb,
      '{"items":[{"id":"pepsi","quantity":1}],"status":"PENDING","payment_method":"Cash"}'::jsonb);
  END LOOP;
  PERFORM pg_temp.expect_error($q$
    SELECT public.place_order('[{"item_id":"pepsi","quantity":1}]'::jsonb,
      '{"items":[{"id":"pepsi","quantity":1}],"status":"PENDING","payment_method":"Cash"}'::jsonb)
  $q$, 'You already have');
END $$;

-- ---------------------------------------------------------------------------
-- 5. No login, no order
-- ---------------------------------------------------------------------------
SET request.jwt.claim.sub = '';
SELECT pg_temp.expect_error($q$
  SELECT public.place_order('[{"item_id":"pepsi","quantity":1}]'::jsonb,
    '{"items":[{"id":"pepsi","quantity":1}],"status":"PENDING","payment_method":"Cash"}'::jsonb)
$q$, 'Please log in');

-- ---------------------------------------------------------------------------
-- 6. Ownerless (old guest) orders: only an admin can cancel / collect them
-- ---------------------------------------------------------------------------
INSERT INTO orders (id, items, total, status, payment_method, user_id, created_at) VALUES
  ('GUEST-1', jsonb_build_array(jsonb_build_object('id','pepsi','name','Pepsi','category','DRINKS','price',350,'quantity',1,'selectedAddons','[]'::jsonb)), 350, 'PENDING', 'Cash', NULL, now());

SET request.jwt.claim.sub = '';
SELECT pg_temp.expect_error($q$SELECT public.cancel_order('GUEST-1', 'troll')$q$, 'Not authorized');
SET request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
SELECT pg_temp.expect_error($q$SELECT public.cancel_order('GUEST-1', 'another customer')$q$, 'Not authorized');
SET request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
DO $$
BEGIN
  PERFORM public.cancel_order('GUEST-1', 'admin cleanup');
  IF (SELECT status FROM orders WHERE id = 'GUEST-1') <> 'CANCELLED' THEN
    RAISE EXCEPTION 'FAIL: an admin must still be able to cancel any order';
  END IF;
END $$;

-- The real collect_order replaced the stand-in: anonymous callers are refused.
INSERT INTO orders (id, items, total, status, payment_method, user_id, created_at) VALUES
  ('GUEST-2', '[]'::jsonb, 350, 'READY', 'Cash', NULL, now());
SET request.jwt.claim.sub = '';
SELECT pg_temp.expect_error($q$SELECT public.collect_order('GUEST-2')$q$, 'Not authorized');
SET request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
DO $$
BEGIN
  IF NOT public.collect_order('GUEST-2') THEN
    RAISE EXCEPTION 'FAIL: admin should be able to collect';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Referral bonus for a first order still works
-- ---------------------------------------------------------------------------
INSERT INTO profiles (id, role, referred_by, points) VALUES
  ('44444444-4444-4444-4444-444444444444', 'user', NULL, 0),
  ('55555555-5555-5555-5555-555555555555', 'user', '44444444-4444-4444-4444-444444444444', 0);
SET request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
DO $$
BEGIN
  PERFORM public.place_order('[{"item_id":"pepsi","quantity":1}]'::jsonb,
    '{"items":[{"id":"pepsi","quantity":1}],"status":"PENDING","payment_method":"Cash"}'::jsonb);
  IF (SELECT points FROM profiles WHERE id = '44444444-4444-4444-4444-444444444444') <> 150 THEN
    RAISE EXCEPTION 'FAIL: referrer should still get +150 for the referred user''s first order';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 8. Who may call what (EXECUTE and table privileges)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.place_order(jsonb,jsonb,text,text,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon must not execute place_order'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.place_order(jsonb,jsonb,text,text,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: signed-in customers must still execute place_order'; END IF;
  IF has_function_privilege('anon', 'public.cancel_order(text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon must not execute cancel_order'; END IF;
  IF has_function_privilege('anon', 'public.collect_order(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon must not execute collect_order'; END IF;
  IF has_function_privilege('anon', 'public.award_engagement_points(uuid,text,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.award_engagement_points(uuid,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: award_engagement_points must be server-only'; END IF;
  IF has_table_privilege('anon', 'public.orders', 'INSERT')
     OR has_table_privilege('anon', 'public.menu_items', 'UPDATE')
     OR has_table_privilege('anon', 'public.profiles', 'DELETE')
     OR has_table_privilege('anon', 'public.orders', 'TRUNCATE') THEN
    RAISE EXCEPTION 'FAIL: anon must have no write privileges on tables'; END IF;
  IF has_table_privilege('authenticated', 'public.orders', 'TRUNCATE') THEN
    RAISE EXCEPTION 'FAIL: nobody needs TRUNCATE'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = '_test_probe_policy') THEN
    RAISE EXCEPTION 'FAIL: leftover probe policy should be dropped'; END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'PASS: all order-integrity assertions passed'; END $$;

ROLLBACK;
