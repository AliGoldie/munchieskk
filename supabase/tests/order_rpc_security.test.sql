-- Regression test for the pre-launch fix in
-- supabase/migrations/20260929000000_lock_down_order_rpcs.sql: place_order()
-- must ignore a client-supplied p_user_id in favor of auth.uid(), must
-- reject orders while the store is closed, must not double-award a referral
-- bonus; cancel_order() must reject a non-owner, non-admin caller.
--
-- Run via `npm run test:db` (supabase/tests/run-db-tests.sh), against a
-- disposable, freshly-created database -- never a real project database.
-- Wrapped in one transaction rolled back at the end, so even a stray direct
-- `psql -f` run against a real database leaves no trace. auth.uid() is
-- stubbed to read a GUC (request.jwt.claim.sub) that each scenario below
-- sets via `SET LOCAL`, mirroring how PostgREST actually populates it from
-- the caller's JWT.

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

-- Loads the real, shipped functions -- this test exercises actual
-- production code, not a copy that can drift from it.
\i supabase/migrations/20260929000000_lock_down_order_rpcs.sql

INSERT INTO store_settings (id, status, opening_time, closing_time, weekly_schedule, special_closures)
VALUES ('main_store', 'CLOSED', '17:00', '23:00', '{}'::jsonb, '[]'::jsonb);

INSERT INTO menu_items (id, name, category, price, stock_quantity, in_stock)
VALUES ('burger', 'Burger', 'BURGERS', 1000, 10, true),
       ('fries', 'Fries', 'SIDES', 500, 5, true),
       ('drink', 'Drink', 'DRINKS', 300, 100, true);

-- ============================================================
-- A. Store CLOSED must reject place_order server-side, not just in the UI.
-- ============================================================
SET LOCAL request.jwt.claim.sub = '';
DO $$
DECLARE
  v_caught boolean := false;
BEGIN
  BEGIN
    PERFORM public.place_order(
      '[{"item_id":"burger","quantity":1}]'::jsonb,
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id','burger','quantity',1)), 'status','PENDING','payment_method','Cash')
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    IF SQLERRM NOT LIKE 'Store is currently closed%' THEN
      RAISE EXCEPTION 'FAIL: expected closed-store error, got: %', SQLERRM;
    END IF;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'FAIL: place_order should reject an order while the store is CLOSED';
  END IF;
END $$;

UPDATE store_settings SET status = 'OPEN' WHERE id = 'main_store';

-- ============================================================
-- B. Guest checkout (anonymous caller) must still work: user_id ends up NULL.
-- ============================================================
SET LOCAL request.jwt.claim.sub = '';
DO $$
DECLARE
  v_order_id text;
  v_owner uuid;
  v_stock integer;
BEGIN
  v_order_id := public.place_order(
    '[{"item_id":"burger","quantity":2}]'::jsonb,
    jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id','burger','quantity',2)), 'status','PENDING','payment_method','Cash','customer_name','Guest Test','customer_phone','0123456789')
  );

  SELECT user_id INTO v_owner FROM public.orders WHERE id = v_order_id;
  IF v_owner IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: guest order should have NULL user_id, got %', v_owner;
  END IF;

  SELECT stock_quantity INTO v_stock FROM public.menu_items WHERE id = 'burger';
  IF v_stock <> 8 THEN
    RAISE EXCEPTION 'FAIL: expected burger stock 8 after deducting 2 from 10, got %', v_stock;
  END IF;
END $$;

-- ============================================================
-- C. Identity spoofing: an authenticated caller's order must be attributed
--    to their own auth.uid(), never to a client-supplied p_user_id.
-- ============================================================
INSERT INTO profiles (id, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'user'),
  ('22222222-2222-2222-2222-222222222222', 'user'),
  ('33333333-3333-3333-3333-333333333333', 'admin');

SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
DO $$
DECLARE
  v_order_id text;
  v_owner uuid;
BEGIN
  v_order_id := public.place_order(
    '[{"item_id":"burger","quantity":1}]'::jsonb,
    jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id','burger','quantity',1)), 'status','PENDING','payment_method','Cash'),
    NULL,
    '22222222-2222-2222-2222-222222222222' -- attacker-supplied p_user_id, must be ignored
  );
  SELECT user_id INTO v_owner FROM public.orders WHERE id = v_order_id;
  IF v_owner IS DISTINCT FROM '11111111-1111-1111-1111-111111111111'::uuid THEN
    RAISE EXCEPTION 'FAIL: order must be attributed to the authenticated caller, got %', v_owner;
  END IF;
END $$;

-- ============================================================
-- D/E/F/G. cancel_order ownership enforcement. Fixtures inserted directly
-- (not via place_order) so each scenario is independent of the others.
-- ============================================================
INSERT INTO orders (id, items, total, status, payment_method, user_id, created_at) VALUES
  ('TEST-D', jsonb_build_array(jsonb_build_object('id','fries','name','Fries','category','SIDES','price',500,'quantity',1,'selectedAddons','[]'::jsonb)), 500, 'PENDING', 'Cash', '11111111-1111-1111-1111-111111111111', now()),
  ('TEST-E', jsonb_build_array(jsonb_build_object('id','fries','name','Fries','category','SIDES','price',500,'quantity',1,'selectedAddons','[]'::jsonb)), 500, 'PENDING', 'Cash', '11111111-1111-1111-1111-111111111111', now()),
  ('TEST-F', jsonb_build_array(jsonb_build_object('id','fries','name','Fries','category','SIDES','price',500,'quantity',1,'selectedAddons','[]'::jsonb)), 500, 'PENDING', 'Cash', '11111111-1111-1111-1111-111111111111', now()),
  ('TEST-G', jsonb_build_array(jsonb_build_object('id','fries','name','Fries','category','SIDES','price',500,'quantity',1,'selectedAddons','[]'::jsonb)), 500, 'PENDING', 'Cash', NULL, now());

-- D. Non-owner, non-admin caller must be rejected; order left untouched.
SET LOCAL request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
DO $$
DECLARE
  v_caught boolean := false;
  v_status text;
BEGIN
  BEGIN
    PERFORM public.cancel_order('TEST-D', 'unauthorized attempt');
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    IF SQLERRM NOT LIKE 'Not authorized%' THEN
      RAISE EXCEPTION 'FAIL: expected not-authorized error, got: %', SQLERRM;
    END IF;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'FAIL: cancel_order should reject a non-owner, non-admin caller';
  END IF;

  SELECT status INTO v_status FROM public.orders WHERE id = 'TEST-D';
  IF v_status <> 'PENDING' THEN
    RAISE EXCEPTION 'FAIL: order should be unaffected by a rejected cancel, status=%', v_status;
  END IF;
END $$;

-- E. The actual owner can cancel their own order; stock is restored.
SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
DO $$
DECLARE
  v_status text;
  v_stock integer;
BEGIN
  PERFORM public.cancel_order('TEST-E', 'customer changed mind');
  SELECT status INTO v_status FROM public.orders WHERE id = 'TEST-E';
  IF v_status <> 'CANCELLED' THEN
    RAISE EXCEPTION 'FAIL: owner should be able to cancel their own order, status=%', v_status;
  END IF;
  SELECT stock_quantity INTO v_stock FROM public.menu_items WHERE id = 'fries';
  IF v_stock <> 6 THEN
    RAISE EXCEPTION 'FAIL: expected fries stock restored to 6, got %', v_stock;
  END IF;
END $$;

-- F. An admin can cancel someone else's order.
SET LOCAL request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
DO $$
DECLARE
  v_status text;
BEGIN
  PERFORM public.cancel_order('TEST-F', 'admin override');
  SELECT status INTO v_status FROM public.orders WHERE id = 'TEST-F';
  IF v_status <> 'CANCELLED' THEN
    RAISE EXCEPTION 'FAIL: admin should be able to cancel any order, status=%', v_status;
  END IF;
END $$;

-- G. A guest order (user_id NULL) can still be cancelled anonymously --
--    knowing the order id is the only "credential" a guest ever has, same
--    assumption collect_order already makes.
SET LOCAL request.jwt.claim.sub = '';
DO $$
DECLARE
  v_status text;
BEGIN
  PERFORM public.cancel_order('TEST-G', 'guest changed mind');
  SELECT status INTO v_status FROM public.orders WHERE id = 'TEST-G';
  IF v_status <> 'CANCELLED' THEN
    RAISE EXCEPTION 'FAIL: an anonymous caller should still be able to cancel a guest order, status=%', v_status;
  END IF;
END $$;

-- ============================================================
-- H. Referral bonus awards exactly once, not once per order.
-- ============================================================
INSERT INTO profiles (id, role, referred_by, referral_converted_at, points) VALUES
  ('44444444-4444-4444-4444-444444444444', 'user', NULL, NULL, 0),
  ('55555555-5555-5555-5555-555555555555', 'user', '44444444-4444-4444-4444-444444444444', NULL, 0);

SET LOCAL request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
DO $$
DECLARE
  v_referrer_points integer;
  v_converted timestamptz;
BEGIN
  PERFORM public.place_order(
    '[{"item_id":"drink","quantity":1}]'::jsonb,
    jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id','drink','quantity',1)), 'status','PENDING','payment_method','Cash')
  );

  SELECT points INTO v_referrer_points FROM public.profiles WHERE id = '44444444-4444-4444-4444-444444444444';
  IF v_referrer_points <> 150 THEN
    RAISE EXCEPTION 'FAIL: referrer should have +150 points after the referred user''s first order, got %', v_referrer_points;
  END IF;

  SELECT referral_converted_at INTO v_converted FROM public.profiles WHERE id = '55555555-5555-5555-5555-555555555555';
  IF v_converted IS NULL THEN
    RAISE EXCEPTION 'FAIL: referred user should have referral_converted_at set after their first order';
  END IF;

  -- A second order by the same referred user must NOT award the referrer again.
  PERFORM public.place_order(
    '[{"item_id":"drink","quantity":1}]'::jsonb,
    jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id','drink','quantity',1)), 'status','PENDING','payment_method','Cash')
  );

  SELECT points INTO v_referrer_points FROM public.profiles WHERE id = '44444444-4444-4444-4444-444444444444';
  IF v_referrer_points <> 150 THEN
    RAISE EXCEPTION 'FAIL: referrer should still have exactly 150 points after the referred user''s second order, got %', v_referrer_points;
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'PASS: all place_order/cancel_order security assertions passed'; END $$;

ROLLBACK;
