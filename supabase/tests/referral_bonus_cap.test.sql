-- Regression test for the pre-launch fix in
-- supabase/migrations/20260929000004_cap_referral_bonus_per_referrer.sql:
-- a single referrer must never earn more than 5 referral bonuses (750
-- points), no matter how many different people convert using their code --
-- and each referred user's own conversion must still be marked processed
-- even once the referrer's cap is already spent, so it's never re-evaluated.
--
-- Run via `npm run test:db` (supabase/tests/run-db-tests.sh), against a
-- disposable, freshly-created database -- never a real project database.
-- Wrapped in one transaction rolled back at the end.

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

CREATE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

-- Loads the real, shipped place_order() -- this test exercises actual
-- production code, not a copy that can drift from it.
\i supabase/migrations/20260929000004_cap_referral_bonus_per_referrer.sql

INSERT INTO store_settings (id, status, opening_time, closing_time, weekly_schedule, special_closures)
VALUES ('main_store', 'OPEN', '17:00', '23:00', '{}'::jsonb, '[]'::jsonb);

INSERT INTO menu_items (id, name, category, price, stock_quantity, in_stock)
VALUES ('drink', 'Drink', 'DRINKS', 300, 1000, true);

-- Note: is_store_open_now()/parse_time_to_minutes() come from the earlier
-- 20260929000000 migration, not reloaded here -- this test only needs
-- place_order() itself plus its own dependencies, so define the two it
-- calls directly rather than pulling in that whole file.
CREATE OR REPLACE FUNCTION public.is_store_open_now() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT true; $$;

DO $$
DECLARE
  v_referrer uuid := '00000000-0000-0000-0000-000000000001';
  v_referred uuid;
  v_i integer;
  v_referrer_points integer;
  v_bonus_count integer;
  v_uncapped_count integer;
BEGIN
  INSERT INTO profiles (id, points) VALUES (v_referrer, 0);

  -- 6 distinct referred users, all pointing at the same referrer, each
  -- placing their first real order -- only the first 5 should pay out.
  FOR v_i IN 1..6 LOOP
    v_referred := ('00000000-0000-0000-0000-00000000001' || v_i)::uuid;
    INSERT INTO profiles (id, referred_by, referral_converted_at, points)
    VALUES (v_referred, v_referrer, NULL, 0);

    PERFORM set_config('request.jwt.claim.sub', v_referred::text, true);
    PERFORM public.place_order(
      jsonb_build_array(jsonb_build_object('item_id', 'drink', 'quantity', 1)),
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id', 'drink', 'quantity', 1)), 'status', 'PENDING', 'payment_method', 'Cash')
    );
  END LOOP;

  SELECT points INTO v_referrer_points FROM profiles WHERE id = v_referrer;
  IF v_referrer_points <> 750 THEN
    RAISE EXCEPTION 'FAIL: referrer should have exactly 750 points (5 x 150, capped), got %', v_referrer_points;
  END IF;

  SELECT COUNT(*) INTO v_bonus_count FROM referral_rewards_log WHERE referrer_id = v_referrer AND reward_type = 'referrer_bonus';
  IF v_bonus_count <> 5 THEN
    RAISE EXCEPTION 'FAIL: expected exactly 5 referrer_bonus log rows, got %', v_bonus_count;
  END IF;

  -- Every referred user's own conversion must be marked, including the 6th
  -- whose referrer was already capped -- otherwise this check would keep
  -- re-running (and re-locking the referrer's row) on every future order.
  SELECT COUNT(*) INTO v_uncapped_count FROM profiles
  WHERE referred_by = v_referrer AND referral_converted_at IS NULL;
  IF v_uncapped_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: all 6 referred users should have referral_converted_at set, % still NULL', v_uncapped_count;
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'PASS: referral bonus per-referrer cap assertions passed'; END $$;

ROLLBACK;
