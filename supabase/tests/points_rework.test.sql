-- Regression test for supabase/migrations/20261012000000_points_rework.sql:
-- collection bonus, referral paid on collection (min RM20), arcade points
-- need a live order, share bonus 20 + screenshot proof (40), and expiry of
-- uncollected redemptions.
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


CREATE FUNCTION pg_temp.pts(p_id uuid) RETURNS integer LANGUAGE sql AS $$ SELECT points FROM public.profiles WHERE id = p_id $$;
CREATE FUNCTION pg_temp.expect(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; END $$;

-- ---------------------------------------------------------------------------
-- 1. Collection bonus is 6
-- ---------------------------------------------------------------------------
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
DO $$
DECLARE v_id text; v_before integer;
BEGIN
  v_id := public.place_order('[{"item_id":"pepsi","quantity":1}]'::jsonb,
    '{"items":[{"id":"pepsi","quantity":1}],"status":"PENDING","payment_method":"Cash"}'::jsonb);
  v_before := pg_temp.pts('11111111-1111-1111-1111-111111111111');
  UPDATE orders SET status = 'COLLECTED' WHERE id = v_id;
  PERFORM pg_temp.expect(pg_temp.pts('11111111-1111-1111-1111-111111111111') - v_before = 6,
    'collecting an order must give exactly 6 points');
END $$;

-- ---------------------------------------------------------------------------
-- 2. Referral: paid when the friend's first RM20+ order is COLLECTED
-- ---------------------------------------------------------------------------
UPDATE profiles SET referred_by = '11111111-1111-1111-1111-111111111111'
WHERE id IN ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444');

SET request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
DO $$
DECLARE
  v_ref_before integer; v_small text; v_big text;
BEGIN
  v_ref_before := pg_temp.pts('11111111-1111-1111-1111-111111111111');

  -- A RM3.50 order: no referral reward at placement or collection.
  v_small := public.place_order('[{"item_id":"pepsi","quantity":1}]'::jsonb,
    '{"items":[{"id":"pepsi","quantity":1}],"status":"PENDING","payment_method":"Cash"}'::jsonb);
  PERFORM pg_temp.expect(pg_temp.pts('11111111-1111-1111-1111-111111111111') = v_ref_before,
    'placing an order must not pay the referral');
  UPDATE orders SET status = 'COLLECTED' WHERE id = v_small;
  PERFORM pg_temp.expect(pg_temp.pts('11111111-1111-1111-1111-111111111111') = v_ref_before,
    'an order under RM20 must not convert the referral');
  PERFORM pg_temp.expect((SELECT referral_converted_at FROM profiles WHERE id = '22222222-2222-2222-2222-222222222222') IS NULL,
    'the referral must stay open after a small order');

  -- A RM69.90 order: placing it pays nothing yet, collecting it pays 150.
  v_big := public.place_order('[{"item_id":"platter","quantity":1}]'::jsonb,
    '{"items":[{"id":"platter","quantity":1}],"status":"PENDING","payment_method":"Cash"}'::jsonb);
  PERFORM pg_temp.expect(pg_temp.pts('11111111-1111-1111-1111-111111111111') = v_ref_before,
    'placing a big order must not pay the referral yet');
  UPDATE orders SET status = 'COLLECTED' WHERE id = v_big;
  PERFORM pg_temp.expect(pg_temp.pts('11111111-1111-1111-1111-111111111111') = v_ref_before + 150,
    'the referrer must get 150 when the friend collects a RM20+ order');
  PERFORM pg_temp.expect((SELECT COUNT(*) FROM referral_rewards_log WHERE referrer_id = '11111111-1111-1111-1111-111111111111') = 1,
    'one referral reward must be logged');
END $$;

-- Place-and-cancel farming: a cancelled order never pays the referrer.
SET request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
DO $$
DECLARE v_ref_before integer; v_id text;
BEGIN
  v_ref_before := pg_temp.pts('11111111-1111-1111-1111-111111111111');
  v_id := public.place_order('[{"item_id":"platter","quantity":1}]'::jsonb,
    '{"items":[{"id":"platter","quantity":1}],"status":"PENDING","payment_method":"Cash"}'::jsonb);
  PERFORM public.cancel_order(v_id, 'Test', NULL, NULL);
  PERFORM pg_temp.expect(pg_temp.pts('11111111-1111-1111-1111-111111111111') = v_ref_before,
    'a cancelled order must not pay the referral');
  PERFORM pg_temp.expect((SELECT referral_converted_at FROM profiles WHERE id = '44444444-4444-4444-4444-444444444444') IS NULL,
    'a cancelled order must not convert the referral');
END $$;

-- ---------------------------------------------------------------------------
-- 3. Arcade points: free for a new account's first 30 days, then need a purchase
-- ---------------------------------------------------------------------------
RESET request.jwt.claim.sub;
INSERT INTO profiles (id, role, points, created_at) VALUES
  ('55555555-5555-5555-5555-555555555555', 'user', 0, now() - interval '40 days'),
  ('66666666-6666-6666-6666-666666666666', 'user', 0, now() - interval '40 days');
DO $$
DECLARE
  v_new uuid := '33333333-3333-3333-3333-333333333333';   -- created just now
  v_old uuid := '55555555-5555-5555-5555-555555555555';   -- 40 days old, never bought
  v_buyer uuid := '66666666-6666-6666-6666-666666666666'; -- 40 days old, has bought
BEGIN
  PERFORM pg_temp.expect(public.award_engagement_points(v_new, 'trex_runner', 20) = 20,
    'a new account must earn arcade points without any order');
  PERFORM pg_temp.expect(public.award_engagement_points(v_new, 'speed_grab', 500) = 130,
    'the 150/week ceiling must still apply');

  PERFORM pg_temp.expect(public.award_engagement_points(v_old, 'trex_runner', 20) = 0,
    'an account older than 30 days with no purchase must earn nothing');
  INSERT INTO orders (id, status, total, user_id, created_at) VALUES ('GATE-PEND', 'PENDING', 1000, v_old, now());
  INSERT INTO orders (id, status, total, user_id, created_at) VALUES ('GATE-CANC', 'CANCELLED', 1000, v_old, now());
  PERFORM pg_temp.expect(public.award_engagement_points(v_old, 'trex_runner', 20) = 0,
    'pending or cancelled orders must not unlock arcade points');

  INSERT INTO orders (id, status, total, user_id, created_at) VALUES ('GATE-DONE', 'COLLECTED', 1000, v_buyer, now() - interval '20 days');
  PERFORM pg_temp.expect(public.award_engagement_points(v_buyer, 'trex_runner', 20) = 20,
    'an old account that has completed a purchase must earn arcade points');
END $$;

-- ---------------------------------------------------------------------------
-- 4. Share bonus 20, screenshot proof tops it up to 40
-- ---------------------------------------------------------------------------
RESET request.jwt.claim.sub;
INSERT INTO orders (id, status, total, user_id, created_at) VALUES
  ('SH-1', 'COLLECTED', 1000, '11111111-1111-1111-1111-111111111111', now()),
  ('SH-2', 'COLLECTED', 1000, '11111111-1111-1111-1111-111111111111', now()),
  ('SH-3', 'COLLECTED', 1000, '11111111-1111-1111-1111-111111111111', now()),
  ('SH-OLD', 'COLLECTED', 1000, '11111111-1111-1111-1111-111111111111', now() - interval '30 days'),
  ('SH-PEND', 'COOKING', 1000, '11111111-1111-1111-1111-111111111111', now());

SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
DO $$
DECLARE v_before integer; v_proof uuid;
BEGIN
  v_before := pg_temp.pts('11111111-1111-1111-1111-111111111111');
  PERFORM public.claim_share_bonus('SH-1');
  PERFORM pg_temp.expect(pg_temp.pts('11111111-1111-1111-1111-111111111111') - v_before = 20,
    'sharing must give 20 points');

  -- bad paths / ineligible orders are rejected
  PERFORM pg_temp.expect_error($q$SELECT public.submit_share_proof('SH-1', '22222222-2222-2222-2222-222222222222/x.webp')$q$, 'Invalid screenshot path');
  PERFORM pg_temp.expect_error($q$SELECT public.submit_share_proof('SH-1', '11111111-1111-1111-1111-111111111111/../x.webp')$q$, 'Invalid screenshot path');
  PERFORM pg_temp.expect_error($q$SELECT public.submit_share_proof('SH-OLD', '11111111-1111-1111-1111-111111111111/a.webp')$q$, 'This order is not eligible');
  PERFORM pg_temp.expect_error($q$SELECT public.submit_share_proof('SH-PEND', '11111111-1111-1111-1111-111111111111/a.webp')$q$, 'This order is not eligible');

  v_proof := public.submit_share_proof('SH-1', '11111111-1111-1111-1111-111111111111/sh1.webp');
  PERFORM pg_temp.expect_error($q$SELECT public.submit_share_proof('SH-1', '11111111-1111-1111-1111-111111111111/again.webp')$q$, 'A screenshot has already been submitted');

  -- a customer cannot approve their own screenshot
  PERFORM pg_temp.expect_error(format('SELECT public.review_share_proof(%L, true)', v_proof), 'permission denied');
  PERFORM pg_temp.expect(pg_temp.pts('11111111-1111-1111-1111-111111111111') - v_before = 20, 'no points before approval');
END $$;

SET request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
DO $$
DECLARE v_before integer; v_proof uuid; v_award integer;
BEGIN
  v_before := pg_temp.pts('11111111-1111-1111-1111-111111111111');
  SELECT id INTO v_proof FROM share_proofs WHERE order_id = 'SH-1';
  v_award := public.review_share_proof(v_proof, true);
  PERFORM pg_temp.expect(v_award = 20, 'approval after a share must top up by 20 (40 in total)');
  PERFORM pg_temp.expect(pg_temp.pts('11111111-1111-1111-1111-111111111111') - v_before = 20, 'balance must rise by 20');
  PERFORM pg_temp.expect_error(format('SELECT public.review_share_proof(%L, true)', v_proof), 'This screenshot was already reviewed');
END $$;

-- Never shared, then proof approved: pays the full 40 and closes the share claim.
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
SELECT public.submit_share_proof('SH-2', '11111111-1111-1111-1111-111111111111/sh2.webp');
SET request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
DO $$
DECLARE v_before integer; v_proof uuid;
BEGIN
  v_before := pg_temp.pts('11111111-1111-1111-1111-111111111111');
  SELECT id INTO v_proof FROM share_proofs WHERE order_id = 'SH-2';
  PERFORM pg_temp.expect(public.review_share_proof(v_proof, true) = 40, 'proof without a prior share must pay 40');
  PERFORM pg_temp.expect(pg_temp.pts('11111111-1111-1111-1111-111111111111') - v_before = 40, 'balance must rise by 40');
END $$;
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
SELECT pg_temp.expect_error($q$SELECT public.claim_share_bonus('SH-2')$q$, 'Share bonus already claimed');

-- Rejection pays nothing and allows one fresh try.
SELECT public.submit_share_proof('SH-3', '11111111-1111-1111-1111-111111111111/sh3.webp');
SET request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
DO $$
DECLARE v_before integer; v_proof uuid;
BEGIN
  v_before := pg_temp.pts('11111111-1111-1111-1111-111111111111');
  SELECT id INTO v_proof FROM share_proofs WHERE order_id = 'SH-3';
  PERFORM pg_temp.expect(public.review_share_proof(v_proof, false, 'not public') = 0, 'rejection pays nothing');
  PERFORM pg_temp.expect(pg_temp.pts('11111111-1111-1111-1111-111111111111') = v_before, 'rejection must not change points');
END $$;
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
SELECT public.submit_share_proof('SH-3', '11111111-1111-1111-1111-111111111111/sh3b.webp');
DO $$ BEGIN
  PERFORM pg_temp.expect((SELECT status FROM share_proofs WHERE order_id = 'SH-3') = 'PENDING', 'a rejected proof can be resubmitted');
END $$;

-- RLS: a customer sees only their own proofs; anonymous sees none.
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT SELECT ON profiles TO anon, authenticated;
INSERT INTO share_proofs (order_id, user_id, image_path)
SELECT 'SH-OLD', '22222222-2222-2222-2222-222222222222', 'x' ;
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM pg_temp.expect((SELECT COUNT(*) FROM share_proofs WHERE user_id <> auth.uid()) = 0, 'customers must not see other people''s proofs');
  PERFORM pg_temp.expect((SELECT COUNT(*) FROM share_proofs WHERE user_id = auth.uid()) = 3, 'customers see their own proofs');
END $$;
RESET request.jwt.claim.sub;
SET ROLE anon;
DO $$ BEGIN
  PERFORM pg_temp.expect((SELECT COUNT(*) FROM share_proofs) = 0, 'anonymous must see no proofs');
END $$;
RESET ROLE;
DELETE FROM share_proofs WHERE image_path = 'x';

-- ---------------------------------------------------------------------------
-- 5. Redemptions nobody collects expire after 14 days
-- ---------------------------------------------------------------------------
RESET request.jwt.claim.sub;
INSERT INTO loyalty_prizes (id, name, points_cost, menu_item_id, deduct_stock) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Pepsi', 100, 'pepsi', true);
INSERT INTO redemptions (id, redemption_code, user_id, prize_id, prize_name, points_spent, status, redeemed_at) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', 'OLD111', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001', 'Pepsi', 100, 'PENDING', now() - interval '15 days'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'NEW222', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001', 'Pepsi', 100, 'PENDING', now() - interval '2 days'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'DON333', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001', 'Pepsi', 100, 'FULFILLED', now() - interval '40 days');
DO $$
DECLARE v_pts integer; v_stock integer;
BEGIN
  v_pts := pg_temp.pts('22222222-2222-2222-2222-222222222222');
  SELECT stock_quantity INTO v_stock FROM menu_items WHERE id = 'pepsi';
  PERFORM pg_temp.expect(public.expire_stale_redemptions() = 1, 'exactly one stale redemption must expire');
  PERFORM pg_temp.expect(pg_temp.pts('22222222-2222-2222-2222-222222222222') = v_pts + 100, 'points must be refunded');
  PERFORM pg_temp.expect((SELECT stock_quantity FROM menu_items WHERE id = 'pepsi') = v_stock + 1, 'reserved stock must come back');
  PERFORM pg_temp.expect((SELECT status FROM redemptions WHERE redemption_code = 'OLD111') = 'EXPIRED', 'stale one is EXPIRED');
  PERFORM pg_temp.expect((SELECT status FROM redemptions WHERE redemption_code = 'NEW222') = 'PENDING', 'fresh one stays PENDING');
  PERFORM pg_temp.expect((SELECT status FROM redemptions WHERE redemption_code = 'DON333') = 'FULFILLED', 'fulfilled one is untouched');
  PERFORM pg_temp.expect(public.expire_stale_redemptions() = 0, 'running it again must not refund twice');
END $$;
SET request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
DO $$ BEGIN
  PERFORM pg_temp.expect((public.fulfill_redemption('bbbbbbbb-0000-0000-0000-000000000001', 'x')->>'success')::boolean = false,
    'an expired redemption cannot be fulfilled');
  PERFORM pg_temp.expect((public.fulfill_redemption('bbbbbbbb-0000-0000-0000-000000000002', 'x')->>'success')::boolean = true,
    'a pending redemption can still be fulfilled');
END $$;

-- ---------------------------------------------------------------------------
-- 6. Function privileges for the public key
-- ---------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.submit_share_proof(text,text)', 'public.review_share_proof(uuid,boolean,text)',
                           'public.expire_stale_redemptions()', 'public.claim_share_bonus(text)'] LOOP
    PERFORM pg_temp.expect(NOT has_function_privilege('anon', f, 'execute'), f || ' must not be callable by anon');
  END LOOP;
  PERFORM pg_temp.expect(NOT has_function_privilege('authenticated', 'public.award_engagement_points(uuid,text,integer)', 'execute'),
    'award_engagement_points must stay server-only');
END $$;


-- ---------------------------------------------------------------------------
-- 4b. Share bonus monthly cap (20261025000000): 4 instant shares a month
-- ---------------------------------------------------------------------------
\i supabase/migrations/20261025000000_share_bonus_monthly_cap.sql
\i supabase/migrations/20261025000000_share_bonus_monthly_cap.sql

RESET request.jwt.claim.sub;
INSERT INTO profiles (id, role, points) VALUES ('77777777-7777-7777-7777-777777777777', 'user', 0);
INSERT INTO orders (id, status, total, user_id, created_at) VALUES
  ('CAP-1', 'COLLECTED', 1000, '77777777-7777-7777-7777-777777777777', now()),
  ('CAP-2', 'COLLECTED', 1000, '77777777-7777-7777-7777-777777777777', now()),
  ('CAP-3', 'COLLECTED', 1000, '77777777-7777-7777-7777-777777777777', now()),
  ('CAP-4', 'COLLECTED', 1000, '77777777-7777-7777-7777-777777777777', now()),
  ('CAP-5', 'COLLECTED', 1000, '77777777-7777-7777-7777-777777777777', now()),
  ('CAP-6', 'COLLECTED', 1000, '77777777-7777-7777-7777-777777777777', now());

SET request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';
DO $$
DECLARE
  u constant text := '77777777-7777-7777-7777-777777777777';
  b integer;
BEGIN
  b := pg_temp.pts(u::uuid);   -- starting balance (the test orders earn their own order points)
  PERFORM pg_temp.expect((SELECT share_max_per_month FROM share_settings) = 4, 'the share limit defaults to 4 a month');
  PERFORM public.claim_share_bonus('CAP-1');
  PERFORM public.claim_share_bonus('CAP-2');
  PERFORM public.claim_share_bonus('CAP-3');
  PERFORM public.claim_share_bonus('CAP-4');
  PERFORM pg_temp.expect(pg_temp.pts(u::uuid) - b = 80, 'four shares pay 20 each');

  PERFORM pg_temp.expect_error($q$SELECT public.claim_share_bonus('CAP-5')$q$, 'You have used your 4 share bonuses for this month');
  PERFORM pg_temp.expect(pg_temp.pts(u::uuid) - b = 80, 'a capped share pays nothing');
  PERFORM pg_temp.expect((SELECT share_bonus_claimed_at FROM orders WHERE id = 'CAP-5') IS NULL, 'a capped order stays unclaimed');

  -- last month's shares do not count: move one claim to 40 days ago
  UPDATE orders SET share_bonus_claimed_at = now() - interval '40 days' WHERE id = 'CAP-1';
  PERFORM public.claim_share_bonus('CAP-5');
  PERFORM pg_temp.expect(pg_temp.pts(u::uuid) - b = 100, 'a freed slot pays again');
  PERFORM pg_temp.expect_error($q$SELECT public.claim_share_bonus('CAP-6')$q$, 'You have used your 4 share bonuses');

  -- the limit is a setting
  UPDATE share_settings SET share_max_per_month = 6;
  PERFORM public.claim_share_bonus('CAP-6');
  PERFORM pg_temp.expect(pg_temp.pts(u::uuid) - b = 120, 'raising the limit lets another share through');
  UPDATE share_settings SET share_max_per_month = 4;

  -- the old rules still hold
  PERFORM pg_temp.expect_error($q$SELECT public.claim_share_bonus('CAP-2')$q$, 'You have used your 4 share bonuses');
  PERFORM pg_temp.expect(NOT has_function_privilege('anon', 'public.claim_share_bonus(text)', 'execute'), 'guests cannot claim a share bonus');
  PERFORM pg_temp.expect(NOT has_table_privilege('authenticated', 'public.share_settings', 'select'), 'players cannot read the limit table');
END $$;
RESET request.jwt.claim.sub;

DO $$ BEGIN RAISE NOTICE 'PASS: points rework assertions passed'; END $$;

ROLLBACK;
