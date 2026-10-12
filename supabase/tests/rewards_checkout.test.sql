-- Regression test for supabase/migrations/20261013000000_rewards_at_checkout.sql
-- and 20261013000001_rewards_cancel_refund.sql: spending points on a free item
-- or add-on while paying for an order, and the refund when it is cancelled.
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


-- Tables the points-rework migration builds on (created by older migrations
-- this test does not load).
ALTER TABLE orders ADD COLUMN share_bonus_claimed_at timestamptz;
ALTER TABLE profiles ADD COLUMN created_at timestamptz DEFAULT now();
CREATE TABLE engagement_points_log (
  id bigserial PRIMARY KEY, user_id uuid, source text, points integer,
  awarded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE loyalty_prizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, points_cost integer,
  menu_item_id text, deduct_stock boolean DEFAULT false, is_active boolean DEFAULT true
);
CREATE TABLE redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), redemption_code text, user_id uuid,
  prize_id uuid, prize_name text, points_spent integer, status text DEFAULT 'PENDING',
  redeemed_at timestamptz DEFAULT now(), fulfilled_at timestamptz, fulfilled_by uuid
);

-- The migrations under test (hardening is the base the rework builds on).
\i supabase/migrations/20261011000000_order_integrity_hardening.sql
\i supabase/migrations/20261012000000_points_rework.sql
\i supabase/migrations/20261012000001_points_rework_place_order.sql
\i supabase/migrations/20261012000002_arcade_points_grace_period.sql

CREATE TABLE item_addons (menu_item_id text NOT NULL, addon_id text NOT NULL);
CREATE FUNCTION public.generate_unique_redemption_code() RETURNS text LANGUAGE sql AS $$ SELECT upper(substr(md5(random()::text), 1, 6)) $$;
\i supabase/migrations/20261013000000_rewards_at_checkout.sql
\i supabase/migrations/20261013000001_rewards_cancel_refund.sql

INSERT INTO store_settings (id, status, opening_time, closing_time, weekly_schedule, special_closures)
VALUES ('main_store', 'OPEN', '17:00', '23:00', '{}'::jsonb, '[]'::jsonb);
INSERT INTO menu_items (id, name, category, price, stock_quantity, in_stock) VALUES
  ('platter', 'Platter', 'PLATTERS', 6990, 200, true),
  ('pepsi', 'Pepsi', 'DRINKS', 350, 100, true);
INSERT INTO profiles (id, role, points) VALUES
  ('11111111-1111-1111-1111-111111111111', 'user', 0),
  ('22222222-2222-2222-2222-222222222222', 'user', 0),
  ('33333333-3333-3333-3333-333333333333', 'admin', 0),
  ('44444444-4444-4444-4444-444444444444', 'user', 0);

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



CREATE FUNCTION pg_temp.pts(p_id text) RETURNS integer LANGUAGE sql AS $$ SELECT points FROM public.profiles WHERE id = p_id::uuid $$;
CREATE FUNCTION pg_temp.expect(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; END $$;

RESET request.jwt.claim.sub;
INSERT INTO menu_items (id, name, category, price, stock_quantity, in_stock) VALUES
  ('burger', 'Burger', 'BURGERS', 1500, 100, true),
  ('fries', 'Fries', 'SIDES', 800, 50, true);
INSERT INTO addons (id, name, price, stock_quantity, in_stock) VALUES ('cheese', 'Extra Cheese', 300, 20, true);
INSERT INTO item_addons (menu_item_id, addon_id) VALUES ('burger', 'cheese');
INSERT INTO loyalty_prizes (id, name, points_cost, menu_item_id, addon_id, min_order_cents, is_active) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000f001', 'Free Fries',  100, 'fries', NULL,     1000, true),
  ('aaaaaaaa-0000-0000-0000-00000000f002', 'Free Pepsi',  300, 'pepsi', NULL,     2000, true),
  ('aaaaaaaa-0000-0000-0000-00000000f003', 'Free Cheese',  50, NULL,    'cheese', 1000, true),
  ('aaaaaaaa-0000-0000-0000-00000000f004', 'Counter only', 10, NULL,    NULL,     0,    true),
  ('aaaaaaaa-0000-0000-0000-00000000f005', 'Retired',      10, 'fries', NULL,     0,    false);
UPDATE profiles SET points = 1000 WHERE id = '11111111-1111-1111-1111-111111111111';
UPDATE profiles SET points = 10   WHERE id = '22222222-2222-2222-2222-222222222222';

CREATE FUNCTION pg_temp.order_of(p_user text, p_json text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_id text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user, false);
  v_id := public.place_order(p_json::jsonb,
    format('{"items":%s,"status":"PENDING","payment_method":"Cash"}', (SELECT jsonb_agg(jsonb_build_object('id', e->>'item_id', 'quantity', (e->>'quantity')::int)) FROM jsonb_array_elements(p_json::jsonb) e))::jsonb);
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 1. A free menu item: points taken, stock taken, RM0 line added, total unchanged
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_u1 text := '11111111-1111-1111-1111-111111111111';
  v_o text; v_before integer; v_total integer; v_res jsonb; v_items jsonb;
BEGIN
  v_o := pg_temp.order_of(v_u1, '[{"item_id":"burger","quantity":1}]');
  SELECT total INTO v_total FROM orders WHERE id = v_o;
  PERFORM pg_temp.expect(v_total = 1500, 'setup: order total is RM15');
  v_before := pg_temp.pts(v_u1);

  v_res := public.apply_order_reward(v_o, 'aaaaaaaa-0000-0000-0000-00000000f001');
  PERFORM pg_temp.expect((v_res->>'success')::boolean, 'reward applied');
  PERFORM pg_temp.expect(pg_temp.pts(v_u1) = v_before - 100, 'points are taken');
  PERFORM pg_temp.expect((SELECT stock_quantity FROM menu_items WHERE id = 'fries') = 49, 'reward stock is taken');
  SELECT items, total INTO v_items, v_total FROM orders WHERE id = v_o;
  PERFORM pg_temp.expect(v_total = 1500, 'a reward must not change what the customer pays');
  PERFORM pg_temp.expect(jsonb_array_length(v_items) = 2, 'a free line is added');
  PERFORM pg_temp.expect((v_items->1->>'price')::int = 0 AND (v_items->1->>'id') = 'fries' AND (v_items->1->>'name') LIKE '%FREE reward%', 'the free line is RM0 and labelled');
  PERFORM pg_temp.expect((SELECT status FROM redemptions WHERE order_id = v_o) = 'FULFILLED', 'a redemption record is kept');

  -- one reward per order
  PERFORM pg_temp.expect_error(format('SELECT public.apply_order_reward(%L, %L)', v_o, 'aaaaaaaa-0000-0000-0000-00000000f001'), 'This order already has a reward');

  -- ---- cancelling gives the points and the stock back
  v_before := pg_temp.pts(v_u1);
  PERFORM public.cancel_order(v_o, 'changed my mind', 'restore', NULL);
  PERFORM pg_temp.expect(pg_temp.pts(v_u1) = v_before + 100 - 15, 'cancel: reward points come back (order points are taken back as before)');
  PERFORM pg_temp.expect((SELECT stock_quantity FROM menu_items WHERE id = 'fries') = 50, 'cancel: reward stock comes back');
  PERFORM pg_temp.expect((SELECT status FROM redemptions WHERE order_id = v_o) = 'CANCELLED', 'cancel: redemption is marked cancelled');
END $$;

-- ---------------------------------------------------------------------------
-- 2. Rules: minimum order, points, ownership, status, stock, availability
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_u1 text := '11111111-1111-1111-1111-111111111111';
  v_u2 text := '22222222-2222-2222-2222-222222222222';
  v_o text; v_before integer;
BEGIN
  v_o := pg_temp.order_of(v_u1, '[{"item_id":"burger","quantity":1}]');
  v_before := pg_temp.pts(v_u1);

  PERFORM pg_temp.expect_error(format('SELECT public.apply_order_reward(%L, %L)', v_o, 'aaaaaaaa-0000-0000-0000-00000000f002'), 'Spend at least RM 20.00');
  PERFORM pg_temp.expect_error(format('SELECT public.apply_order_reward(%L, %L)', v_o, 'aaaaaaaa-0000-0000-0000-00000000f004'), 'This reward can only be collected at the counter');
  PERFORM pg_temp.expect_error(format('SELECT public.apply_order_reward(%L, %L)', v_o, 'aaaaaaaa-0000-0000-0000-00000000f005'), 'This reward is not available');
  PERFORM pg_temp.expect_error(format('SELECT public.apply_order_reward(%L, %L)', v_o, gen_random_uuid()), 'This reward is not available');
  PERFORM pg_temp.expect(pg_temp.pts(v_u1) = v_before, 'failed attempts must not cost points');

  -- someone else's order
  PERFORM set_config('request.jwt.claim.sub', v_u2, false);
  PERFORM pg_temp.expect_error(format('SELECT public.apply_order_reward(%L, %L)', v_o, 'aaaaaaaa-0000-0000-0000-00000000f001'), 'Order not found');

  -- not enough points (user 2 has 10, plus whatever this order earns)
  PERFORM set_config('request.jwt.claim.sub', v_u2, false);
  v_o := pg_temp.order_of(v_u2, '[{"item_id":"burger","quantity":1}]');
  UPDATE profiles SET points = 10 WHERE id = v_u2::uuid;
  PERFORM pg_temp.expect_error(format('SELECT public.apply_order_reward(%L, %L)', v_o, 'aaaaaaaa-0000-0000-0000-00000000f001'), 'Not enough points');

  -- the kitchen already has it
  PERFORM set_config('request.jwt.claim.sub', v_u1, false);
  v_o := pg_temp.order_of(v_u1, '[{"item_id":"burger","quantity":1}]');
  UPDATE orders SET status = 'COOKING' WHERE id = v_o;
  PERFORM pg_temp.expect_error(format('SELECT public.apply_order_reward(%L, %L)', v_o, 'aaaaaaaa-0000-0000-0000-00000000f001'), 'A reward can only be added while your order is waiting');

  -- too late
  v_o := pg_temp.order_of(v_u1, '[{"item_id":"burger","quantity":1}]');
  UPDATE orders SET created_at = now() - interval '1 hour' WHERE id = v_o;
  PERFORM pg_temp.expect_error(format('SELECT public.apply_order_reward(%L, %L)', v_o, 'aaaaaaaa-0000-0000-0000-00000000f001'), 'A reward can only be added while your order is waiting');

  -- out of stock
  v_o := pg_temp.order_of(v_u1, '[{"item_id":"burger","quantity":1}]');
  v_before := pg_temp.pts(v_u1);
  UPDATE menu_items SET stock_quantity = 0, in_stock = false WHERE id = 'fries';
  PERFORM pg_temp.expect_error(format('SELECT public.apply_order_reward(%L, %L)', v_o, 'aaaaaaaa-0000-0000-0000-00000000f001'), 'This reward is out of stock');
  PERFORM pg_temp.expect(pg_temp.pts(v_u1) = v_before, 'an out-of-stock reward must not cost points');
  UPDATE menu_items SET stock_quantity = 50, in_stock = true WHERE id = 'fries';

  -- a promo-discounted order that falls under the minimum is refused
  v_o := pg_temp.order_of(v_u1, '[{"item_id":"pepsi","quantity":1}]');
  PERFORM pg_temp.expect_error(format('SELECT public.apply_order_reward(%L, %L)', v_o, 'aaaaaaaa-0000-0000-0000-00000000f001'), 'Spend at least RM 10.00');
END $$;

-- ---------------------------------------------------------------------------
-- 3. A free add-on attaches to a burger (splitting one unit off a bigger line)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_u1 text := '11111111-1111-1111-1111-111111111111';
  v_o text; v_before integer; v_items jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_u1, false);
  UPDATE profiles SET points = 1000 WHERE id = v_u1::uuid;

  v_o := pg_temp.order_of(v_u1, '[{"item_id":"burger","quantity":2}]');
  v_before := pg_temp.pts(v_u1);
  PERFORM public.apply_order_reward(v_o, 'aaaaaaaa-0000-0000-0000-00000000f003');
  SELECT items INTO v_items FROM orders WHERE id = v_o;
  PERFORM pg_temp.expect(pg_temp.pts(v_u1) = v_before - 50, 'add-on reward: points are taken');
  PERFORM pg_temp.expect((SELECT stock_quantity FROM addons WHERE id = 'cheese') = 19, 'add-on reward: add-on stock is taken');
  PERFORM pg_temp.expect(jsonb_array_length(v_items) = 2, 'add-on reward: the 2-unit line is split');
  PERFORM pg_temp.expect((v_items->0->>'quantity')::int = 1 AND jsonb_array_length(v_items->0->'selectedAddons') = 0, 'add-on reward: one plain burger');
  PERFORM pg_temp.expect((v_items->1->>'quantity')::int = 1 AND (v_items->1->'selectedAddons'->0->>'price')::int = 0
                         AND (v_items->1->'selectedAddons'->0->>'name') LIKE '%FREE reward%', 'add-on reward: one burger with a free add-on');
  PERFORM pg_temp.expect((SELECT total FROM orders WHERE id = v_o) = 3000, 'add-on reward: total is unchanged');

  PERFORM public.cancel_order(v_o, 'test', 'restore', NULL);
  PERFORM pg_temp.expect((SELECT stock_quantity FROM addons WHERE id = 'cheese') = 20, 'add-on reward: cancelling gives the add-on stock back');

  -- an order with nothing that can take the add-on
  v_o := pg_temp.order_of(v_u1, '[{"item_id":"platter","quantity":1}]');
  PERFORM pg_temp.expect_error(format('SELECT public.apply_order_reward(%L, %L)', v_o, 'aaaaaaaa-0000-0000-0000-00000000f003'), 'None of the items in your order can take this add-on');
END $$;

-- ---------------------------------------------------------------------------
-- 4. Function privileges
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.expect(NOT has_function_privilege('anon', 'public.apply_order_reward(text,uuid)', 'execute'), 'anon must not call apply_order_reward');
  PERFORM pg_temp.expect(has_function_privilege('authenticated', 'public.apply_order_reward(text,uuid)', 'execute'), 'customers can call apply_order_reward');
  PERFORM pg_temp.expect(NOT has_function_privilege('anon', 'public.cancel_order(text,text,text,text)', 'execute'), 'anon must not call cancel_order');
END $$;

DO $$ BEGIN RAISE NOTICE 'PASS: rewards at checkout assertions passed'; END $$;

ROLLBACK;
