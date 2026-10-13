-- Regression test for the Burger Ranks migrations (20261014000000 .. 02):
-- rank from lifetime spend, bonus points with exact cancel/refund reversal,
-- the rank-based monthly claim limit, and the monthly top-spender prize.
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, description text, points_cost integer,
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

ALTER TABLE profiles ADD COLUMN name text;
ALTER TABLE profiles ADD COLUMN phone text;
ALTER TABLE orders ADD COLUMN refund_amount integer;
CREATE TABLE item_addons (menu_item_id text NOT NULL, addon_id text NOT NULL);
CREATE FUNCTION public.generate_unique_redemption_code() RETURNS text LANGUAGE sql AS $$ SELECT upper(substr(md5(random()::text), 1, 6)) $$;
\i supabase/migrations/20261013000000_rewards_at_checkout.sql
\i supabase/migrations/20261013000001_rewards_cancel_refund.sql
\i supabase/migrations/20261013000002_monthly_reward_cap_and_ladder.sql
\i supabase/migrations/20261014000000_burger_ranks.sql
\i supabase/migrations/20261014000001_burger_ranks_cancel.sql
\i supabase/migrations/20261014000002_monthly_prize.sql
INSERT INTO loyalty_prizes (name, description, points_cost) VALUES ('FREE FRIES', 'x', 150);
\i supabase/migrations/20261015000000_points_expiry_fries_100.sql

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
CREATE FUNCTION pg_temp.tier_of(p_user text) RETURNS text LANGUAGE sql AS $$ SELECT name FROM public.customer_tier(p_user::uuid) $$;
CREATE FUNCTION pg_temp.order_of(p_user text, p_item text, p_qty int) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user, false);
  RETURN public.place_order(
    jsonb_build_array(jsonb_build_object('item_id', p_item, 'quantity', p_qty)),
    jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id', p_item, 'quantity', p_qty)), 'status', 'PENDING', 'payment_method', 'Cash'));
END $$;

RESET request.jwt.claim.sub;
INSERT INTO profiles (id, role, points, name) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'user', 0, 'Rita Rookie'),
  ('a0000000-0000-0000-0000-000000000002', 'user', 0, 'Reggie Regular'),
  ('a0000000-0000-0000-0000-000000000003', 'user', 0, 'Pia Pro'),
  ('a0000000-0000-0000-0000-000000000004', 'user', 0, 'Mo Master'),
  ('a0000000-0000-0000-0000-000000000005', 'user', 0, 'Ulla Ultimate'),
  ('a0000000-0000-0000-0000-000000000006', 'user', 0, 'Edge Case');

-- ---------------------------------------------------------------------------
-- 1. Rank comes from lifetime spend on COLLECTED orders only
-- ---------------------------------------------------------------------------
INSERT INTO orders (id, status, total, user_id, created_at) VALUES
  ('S-R2',  'COLLECTED', 19999,  'a0000000-0000-0000-0000-000000000001', now()),
  ('S-REG', 'COLLECTED', 20000,  'a0000000-0000-0000-0000-000000000002', now()),
  ('S-PRO', 'COLLECTED', 85000,  'a0000000-0000-0000-0000-000000000003', now()),
  ('S-MAS', 'COLLECTED', 150000, 'a0000000-0000-0000-0000-000000000004', now()),
  ('S-ULT', 'COLLECTED', 300000, 'a0000000-0000-0000-0000-000000000005', now()),
  -- orders that must NOT count: not collected, or cancelled
  ('S-X1',  'PENDING',   999999, 'a0000000-0000-0000-0000-000000000001', now()),
  ('S-X2',  'CANCELLED', 999999, 'a0000000-0000-0000-0000-000000000001', now()),
  ('S-X3',  'COOKING',   999999, 'a0000000-0000-0000-0000-000000000001', now());
DO $$
BEGIN
  PERFORM pg_temp.expect(pg_temp.tier_of('a0000000-0000-0000-0000-000000000001') = 'Rookie',   'RM199.99 is still a Rookie (and uncollected/cancelled orders do not count)');
  PERFORM pg_temp.expect(pg_temp.tier_of('a0000000-0000-0000-0000-000000000002') = 'Regular',  'RM200 is a Regular');
  PERFORM pg_temp.expect(pg_temp.tier_of('a0000000-0000-0000-0000-000000000003') = 'Pro',      'RM850 is a Pro');
  PERFORM pg_temp.expect(pg_temp.tier_of('a0000000-0000-0000-0000-000000000004') = 'Master',   'RM1,500 is a Master');
  PERFORM pg_temp.expect(pg_temp.tier_of('a0000000-0000-0000-0000-000000000005') = 'Ultimate', 'RM3,000 is an Ultimate');
  PERFORM pg_temp.expect(pg_temp.tier_of('33333333-3333-3333-3333-333333333333') = 'Rookie',   'a customer with no orders is a Rookie');
END $$;

-- A refund lowers spend and can drop a rank
UPDATE orders SET refund_amount = 1 WHERE id = 'S-PRO';
DO $$
BEGIN
  PERFORM pg_temp.expect(pg_temp.tier_of('a0000000-0000-0000-0000-000000000003') = 'Regular', 'a RM850 order refunded by 1 cent is below Pro');
END $$;
UPDATE orders SET refund_amount = NULL WHERE id = 'S-PRO';
DO $$
BEGIN
  PERFORM pg_temp.expect(pg_temp.tier_of('a0000000-0000-0000-0000-000000000003') = 'Pro', 'undoing the refund restores Pro');
END $$;

-- ---------------------------------------------------------------------------
-- 2. Bonus points on order points, stored per order and reversed exactly
-- ---------------------------------------------------------------------------
-- Platter is RM69.90 -> base 70 points.
DO $$
DECLARE v_o text; v_before integer;
BEGIN
  -- Regular: no bonus
  v_before := pg_temp.pts('a0000000-0000-0000-0000-000000000002');
  v_o := pg_temp.order_of('a0000000-0000-0000-0000-000000000002', 'platter', 1);
  PERFORM pg_temp.expect(pg_temp.pts('a0000000-0000-0000-0000-000000000002') - v_before = 70, 'Regular earns 70 points on RM69.90 (no bonus)');
  PERFORM pg_temp.expect((SELECT points_earned FROM orders WHERE id = v_o) = 70, 'the exact points are stored on the order');

  -- Pro +5% -> 73.5 rounds to 74
  v_before := pg_temp.pts('a0000000-0000-0000-0000-000000000003');
  v_o := pg_temp.order_of('a0000000-0000-0000-0000-000000000003', 'platter', 1);
  PERFORM pg_temp.expect(pg_temp.pts('a0000000-0000-0000-0000-000000000003') - v_before = 74, 'Pro earns 74 (+5%)');

  -- Master +8% -> 75.6 -> 76 ; Ultimate +12% -> 78.4 -> 78
  v_before := pg_temp.pts('a0000000-0000-0000-0000-000000000004');
  PERFORM pg_temp.order_of('a0000000-0000-0000-0000-000000000004', 'platter', 1);
  PERFORM pg_temp.expect(pg_temp.pts('a0000000-0000-0000-0000-000000000004') - v_before = 76, 'Master earns 76 (+8%)');
  v_before := pg_temp.pts('a0000000-0000-0000-0000-000000000005');
  PERFORM pg_temp.order_of('a0000000-0000-0000-0000-000000000005', 'platter', 1);
  PERFORM pg_temp.expect(pg_temp.pts('a0000000-0000-0000-0000-000000000005') - v_before = 78, 'Ultimate earns 78 (+12%)');
END $$;

-- Place and cancel in a loop: the bonus must never be kept
DO $$
DECLARE v_u text := 'a0000000-0000-0000-0000-000000000005'; v_o text; v_before integer; i integer;
BEGIN
  v_before := pg_temp.pts(v_u);
  FOR i IN 1..5 LOOP
    v_o := pg_temp.order_of(v_u, 'platter', 1);
    PERFORM public.cancel_order(v_o, 'test', 'restore', NULL);
  END LOOP;
  PERFORM pg_temp.expect(pg_temp.pts(v_u) = v_before, 'five place-and-cancel loops must leave the points exactly where they were (no bonus kept)');
END $$;

-- Orders placed before points were recorded still reverse with RM1 = 1 point
INSERT INTO orders (id, status, total, user_id, created_at, points_earned) VALUES
  ('LEGACY-1', 'PENDING', 5000, 'a0000000-0000-0000-0000-000000000002', now(), NULL);
-- (the insert trigger just recorded the points; clear them to mimic an old order)
UPDATE orders SET points_earned = NULL WHERE id = 'LEGACY-1';
UPDATE profiles SET points = 500 WHERE id = 'a0000000-0000-0000-0000-000000000002';
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
SELECT public.cancel_order('LEGACY-1', 'test', 'restore', NULL);
DO $$
BEGIN
  PERFORM pg_temp.expect(pg_temp.pts('a0000000-0000-0000-0000-000000000002') = 450, 'a legacy order takes back RM1 = 1 point');
END $$;

-- ---------------------------------------------------------------------------
-- 3. A refund takes back the matching share of points; undoing gives it back
-- ---------------------------------------------------------------------------
RESET request.jwt.claim.sub;
INSERT INTO orders (id, status, total, user_id, created_at) VALUES
  ('REF-1', 'COLLECTED', 10000, 'a0000000-0000-0000-0000-000000000006', now());
-- (the insert trigger awarded points: pin the figures this test relies on)
UPDATE orders SET points_earned = 105 WHERE id = 'REF-1';
UPDATE profiles SET points = 1000 WHERE id = 'a0000000-0000-0000-0000-000000000006';
DO $$
DECLARE v_u text := 'a0000000-0000-0000-0000-000000000006';
BEGIN
  UPDATE orders SET refund_amount = 5000 WHERE id = 'REF-1';
  PERFORM pg_temp.expect(pg_temp.pts(v_u) = 1000 - 53, 'half refund takes back half of the 105 points (53)');
  UPDATE orders SET refund_amount = NULL WHERE id = 'REF-1';
  PERFORM pg_temp.expect(pg_temp.pts(v_u) = 1000, 'undoing the refund gives the points back');
  UPDATE orders SET refund_amount = 10000 WHERE id = 'REF-1';
  PERFORM pg_temp.expect(pg_temp.pts(v_u) = 1000 - 105, 'full refund takes back all 105 points');
  UPDATE orders SET refund_amount = 99999 WHERE id = 'REF-1';
  PERFORM pg_temp.expect(pg_temp.pts(v_u) = 1000 - 105, 'a refund larger than the order cannot take back more than it earned');
END $$;

-- ---------------------------------------------------------------------------
-- 4. Monthly claim limit follows the rank: 1 / 2 / 3 / 4 / 5
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_users text[] := ARRAY['a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000005'];
  v_caps integer[] := ARRAY[1,2,3,4,5];
  i integer; j integer; v_blocked boolean;
BEGIN
  FOR i IN 1..5 LOOP
    FOR j IN 1..v_caps[i] LOOP
      INSERT INTO redemptions (user_id, redemption_code, prize_name, points_spent) VALUES (v_users[i]::uuid, 'C' || i || j, 'Test', 10);
    END LOOP;
    v_blocked := false;
    BEGIN
      INSERT INTO redemptions (user_id, redemption_code, prize_name, points_spent) VALUES (v_users[i]::uuid, 'X' || i, 'Test', 10);
    EXCEPTION WHEN raise_exception THEN v_blocked := true; END;
    PERFORM pg_temp.expect(v_blocked, 'rank ' || i || ' must be limited to ' || v_caps[i] || ' claim(s) a month');
  END LOOP;

  -- a cancelled claim frees its slot
  UPDATE redemptions SET status = 'CANCELLED' WHERE redemption_code = 'C11';
  INSERT INTO redemptions (user_id, redemption_code, prize_name, points_spent) VALUES (v_users[1]::uuid, 'AGAIN1', 'Test', 10);
END $$;

-- ---------------------------------------------------------------------------
-- 5. my_tier() for the Loyalty page
-- ---------------------------------------------------------------------------
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$
DECLARE t jsonb;
BEGIN
  t := public.my_tier();
  PERFORM pg_temp.expect(t->>'tier' = 'Pro', 'my_tier reports Pro');
  PERFORM pg_temp.expect((t->>'claims_per_month')::int = 3 AND (t->>'bonus_percent')::int = 5, 'my_tier reports Pro perks');
  PERFORM pg_temp.expect((t->>'claims_used')::int = 3, 'my_tier counts this month''s claims');
  PERFORM pg_temp.expect(t->>'next_tier' = 'Master' AND (t->>'next_min_spend_cents')::int = 150000, 'my_tier points at Master RM1,500');
  PERFORM pg_temp.expect(jsonb_array_length(t->'tiers') = 5, 'my_tier lists all five ranks');
END $$;

-- ---------------------------------------------------------------------------
-- 6. Monthly top-spender prize
-- ---------------------------------------------------------------------------
RESET request.jwt.claim.sub;
-- Start the monthly section from a clean order book so earlier sections' orders
-- (all created 'now') don't count towards this month's ranking.
DELETE FROM orders;
DO $$
DECLARE
  v_cur date := date_trunc('month', now() AT TIME ZONE 'Asia/Kuching')::date;
  v_last date := (date_trunc('month', now() AT TIME ZONE 'Asia/Kuching') - interval '1 month')::date;
  v_twoago date := (date_trunc('month', now() AT TIME ZONE 'Asia/Kuching') - interval '2 month')::date;
  v_old timestamptz;
BEGIN
  -- Last month: a tie on RM150 (Pia reached it first) and one below the RM100 minimum
  INSERT INTO orders (id, status, total, user_id, created_at) VALUES
    ('M-P1', 'COLLECTED', 15000, 'a0000000-0000-0000-0000-000000000003', ((v_last + 5)::timestamp + interval '10 hours') AT TIME ZONE 'Asia/Kuching'),
    ('M-M1', 'COLLECTED', 15000, 'a0000000-0000-0000-0000-000000000004', ((v_last + 9)::timestamp + interval '10 hours') AT TIME ZONE 'Asia/Kuching'),
    ('M-R1', 'COLLECTED',  9000, 'a0000000-0000-0000-0000-000000000001', ((v_last + 6)::timestamp + interval '10 hours') AT TIME ZONE 'Asia/Kuching'),
    -- must not count: cancelled, pending, and one at 00:30 on the 1st of THIS month (belongs to this month)
    ('M-X1', 'CANCELLED', 99999, 'a0000000-0000-0000-0000-000000000001', ((v_last + 7)::timestamp + interval '10 hours') AT TIME ZONE 'Asia/Kuching'),
    ('M-X2', 'PENDING',   99999, 'a0000000-0000-0000-0000-000000000001', ((v_last + 7)::timestamp + interval '11 hours') AT TIME ZONE 'Asia/Kuching'),
    ('M-X3', 'COLLECTED', 99999, 'a0000000-0000-0000-0000-000000000001', (v_cur::timestamp + interval '30 minutes') AT TIME ZONE 'Asia/Kuching');
  -- and a 23:30 order on the LAST day of last month still counts for last month
  INSERT INTO orders (id, status, total, user_id, created_at) VALUES
    ('M-EDGE', 'COLLECTED', 1000, 'a0000000-0000-0000-0000-000000000001', (v_cur::timestamp - interval '30 minutes') AT TIME ZONE 'Asia/Kuching');

  INSERT INTO monthly_prizes (month, prize_name, headline, min_spend_cents) VALUES
    (v_last, 'Solero Split', 'Top spender wins a Solero Split', 10000),
    (v_twoago, 'Ice BB', 'Nobody qualified', 500000),   -- nobody reaches RM5,000
    (v_cur, 'Ice BB', 'Win a free Ice BB', 10000);
END $$;

-- (role-switched checks below need the auth helper and the profiles lookup is_admin() uses)
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT SELECT ON profiles TO anon, authenticated;

-- A guest sees the prize but no personal data; finalizing picks last month's winner
SET ROLE anon;
DO $$
DECLARE s jsonb;
BEGIN
  s := public.monthly_prize_status();
  PERFORM pg_temp.expect(s->'prize'->>'name' = 'Ice BB', 'guests see this month''s prize');
  PERFORM pg_temp.expect(s->'my' = 'null'::jsonb OR s->'my' IS NULL, 'guests get no personal rank');
  PERFORM pg_temp.expect(s->'my_win' = 'null'::jsonb OR s->'my_win' IS NULL, 'guests get no claim code');
  PERFORM pg_temp.expect(s->'last_month'->>'winner_first_name' = 'Pia', 'last month''s winner is Pia (tie goes to whoever reached RM150 first), shown by first name only');
  PERFORM pg_temp.expect(position('Pro' IN s::text) = 0 AND position('Pia Pro' IN s::text) = 0, 'no surname leaks to guests');
END $$;
RESET ROLE;

DO $$
DECLARE v_last date := (date_trunc('month', now() AT TIME ZONE 'Asia/Kuching') - interval '1 month')::date;
        v_twoago date := (date_trunc('month', now() AT TIME ZONE 'Asia/Kuching') - interval '2 month')::date;
BEGIN
  PERFORM pg_temp.expect((SELECT status FROM monthly_prizes WHERE month = v_last) = 'AWARDED', 'last month is AWARDED');
  PERFORM pg_temp.expect((SELECT winner_user_id FROM monthly_prizes WHERE month = v_last) = 'a0000000-0000-0000-0000-000000000003', 'winner is Pia');
  PERFORM pg_temp.expect((SELECT claim_code FROM monthly_prizes WHERE month = v_last) IS NOT NULL, 'a claim code was created');
  PERFORM pg_temp.expect((SELECT status FROM monthly_prizes WHERE month = v_twoago) = 'NO_WINNER', 'a month where nobody reaches the minimum has no winner');
END $$;

-- Only the winner gets the claim code
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SET ROLE authenticated;
DO $$
DECLARE s jsonb;
BEGIN
  s := public.monthly_prize_status();
  PERFORM pg_temp.expect(s->'my_win'->>'claim_code' IS NOT NULL AND s->'my_win'->>'prize_name' = 'Solero Split', 'the winner sees their claim code');
END $$;
RESET ROLE;
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
SET ROLE authenticated;
DO $$
DECLARE s jsonb;
BEGIN
  s := public.monthly_prize_status();
  PERFORM pg_temp.expect(s->'my_win' = 'null'::jsonb OR s->'my_win' IS NULL, 'a customer who did not win gets no claim code');
  PERFORM pg_temp.expect((SELECT count(*) FROM monthly_prizes) = 0, 'customers cannot read the monthly_prizes table directly (claim codes stay private)');
END $$;
RESET ROLE;

-- This month: the 00:30 order (RM999.99) puts Edge/Rita on top; check rank, gap and refunds
RESET request.jwt.claim.sub;
INSERT INTO orders (id, status, total, user_id, created_at) VALUES
  ('C-1', 'COLLECTED', 50000, 'a0000000-0000-0000-0000-000000000002', now()),
  ('C-2', 'COLLECTED', 30000, 'a0000000-0000-0000-0000-000000000003', now());
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$
DECLARE s jsonb;
BEGIN
  s := public.monthly_prize_status();
  PERFORM pg_temp.expect((s->'my'->>'rank')::int = 3 AND (s->'my'->>'spend_cents')::int = 30000, 'Pia is #3 with RM300 this month');
  PERFORM pg_temp.expect((s->'my'->>'gap_to_first_cents')::int = 99999 - 30000, 'the gap to first (RM999.99 - RM300) is shown');
  PERFORM pg_temp.expect(jsonb_array_length(s->'top') = 3, 'only the top 3 first names are listed');
END $$;
RESET request.jwt.claim.sub;

-- Refunds count against the leaderboard
UPDATE orders SET refund_amount = 99999 WHERE id = 'M-X3';
DO $$
DECLARE v_cur date := date_trunc('month', now() AT TIME ZONE 'Asia/Kuching')::date;
BEGIN
  PERFORM pg_temp.expect((SELECT spend_cents FROM monthly_spend_ranking(v_cur) WHERE user_id = 'a0000000-0000-0000-0000-000000000001') = 0
                         OR NOT EXISTS (SELECT 1 FROM monthly_spend_ranking(v_cur) WHERE user_id = 'a0000000-0000-0000-0000-000000000001'),
                         'a fully refunded order no longer counts towards the month');
END $$;

-- Admin overview and marking a prize claimed
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT pg_temp.expect_error($q$SELECT public.admin_monthly_overview()$q$, 'permission denied');
SELECT pg_temp.expect_error($q$SELECT public.admin_mark_prize_claimed((date_trunc('month', now() AT TIME ZONE 'Asia/Kuching') - interval '1 month')::date)$q$, 'permission denied');
SET request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
DO $$
DECLARE o jsonb; v_last date := (date_trunc('month', now() AT TIME ZONE 'Asia/Kuching') - interval '1 month')::date;
BEGIN
  o := public.admin_monthly_overview();
  PERFORM pg_temp.expect(jsonb_array_length(o->'prizes') = 3, 'admin sees the recent prizes');
  PERFORM pg_temp.expect(o->'prizes'->1->>'winner_name' = 'Pia Pro' AND o->'prizes'->1->>'claim_code' IS NOT NULL, 'admin sees the full winner name and claim code');
  PERFORM public.admin_mark_prize_claimed(v_last);
  PERFORM pg_temp.expect((SELECT status FROM monthly_prizes WHERE month = v_last) = 'CLAIMED', 'prize marked claimed');
  PERFORM pg_temp.expect_error(format('SELECT public.admin_mark_prize_claimed(%L)', v_last), 'That prize is not waiting to be claimed');
END $$;
RESET request.jwt.claim.sub;

-- ---------------------------------------------------------------------------
-- 7. Privileges
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.expect(NOT has_function_privilege('anon', 'public.my_tier()', 'execute'), 'anon must not call my_tier');
  PERFORM pg_temp.expect(has_function_privilege('anon', 'public.monthly_prize_status()', 'execute'), 'guests can see the banner');
  PERFORM pg_temp.expect(NOT has_function_privilege('authenticated', 'public.customer_tier(uuid)', 'execute'), 'customers cannot look up anyone''s rank');
  PERFORM pg_temp.expect(NOT has_function_privilege('authenticated', 'public.customer_spend_cents(uuid)', 'execute'), 'customers cannot look up anyone''s spend');
  PERFORM pg_temp.expect(NOT has_function_privilege('authenticated', 'public.monthly_spend_ranking(date)', 'execute'), 'customers cannot read the full ranking');
  PERFORM pg_temp.expect(NOT has_function_privilege('anon', 'public.admin_monthly_overview()', 'execute'), 'anon must not call the admin overview');
END $$;

-- ---------------------------------------------------------------------------
-- 8. Gradual points expiry (25% a month after 12 months of inactivity);
--    Free Fries is 100 points
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.age_account(p_uid text, p_months numeric) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.profiles SET created_at = now() - make_interval(days => (p_months * 30.4)::int) WHERE id = p_uid::uuid;
  -- the fade keeps its start date while the customer stays inactive
  UPDATE public.points_fade SET anchor = (SELECT created_at FROM public.profiles WHERE id = p_uid::uuid) WHERE user_id = p_uid::uuid;
END $$;
DO $$
DECLARE r jsonb; a text;
  u1 constant text := 'e0000000-0000-0000-0000-000000000001';
  u2 constant text := 'e0000000-0000-0000-0000-000000000002';
  u3 constant text := 'e0000000-0000-0000-0000-000000000003';
  u4 constant text := 'e0000000-0000-0000-0000-000000000004';
BEGIN
  PERFORM pg_temp.expect((SELECT points_cost FROM loyalty_prizes WHERE name = 'FREE FRIES') = 100, 'fries costs 100 points');
  INSERT INTO profiles (id, role, points, name, phone) VALUES
    (u1::uuid, 'user', 400, 'Lapsed', '0123'),
    (u2::uuid, 'user', 500, 'Active', '0124'),
    (u3::uuid, 'user', 500, 'Newish', '0125'),
    (u4::uuid, 'user', 400, 'Warned', '0126');
  PERFORM pg_temp.age_account(u1, 12.2);   -- inactive 12.2 months: first step due
  PERFORM pg_temp.age_account(u2, 14);
  INSERT INTO orders (id, status, total, user_id) VALUES ('EXP-OLD', 'COLLECTED', 2000, u2::uuid);
  UPDATE orders SET created_at = now() - interval '3 months' WHERE id = 'EXP-OLD';
  UPDATE profiles SET points = 500 WHERE id = u2::uuid;
  PERFORM pg_temp.age_account(u3, 10);
  PERFORM pg_temp.age_account(u4, 11.5);

  SET LOCAL request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000001';
  r := public.my_points_expiry();
  PERFORM pg_temp.expect(r->>'state' = 'fading' AND (r->>'points')::int = 300, 'step 1: 400 -> 300 (25% of 400 removed)');
  r := public.my_points_expiry();
  PERFORM pg_temp.expect((r->>'points')::int = 300, 'asking again does not remove more');

  -- 25 days later is still step 1; 35 days later is step 2 (base 400 -> 200)
  PERFORM pg_temp.age_account(u1, 13.2);
  r := public.my_points_expiry();
  PERFORM pg_temp.expect((r->>'points')::int = 200, 'step 2: down to 200');
  PERFORM pg_temp.age_account(u1, 16);
  r := public.my_points_expiry();
  PERFORM pg_temp.expect((r->>'points')::int = 0, 'after 4 steps the balance is gone');

  SET LOCAL request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000002';
  r := public.my_points_expiry();
  PERFORM pg_temp.expect(r->>'state' = 'ok' AND (r->>'points')::int = 500, 'recent order: nothing fades');
  SET LOCAL request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000003';
  r := public.my_points_expiry();
  PERFORM pg_temp.expect(r->>'state' = 'ok' AND (r->>'points')::int = 500, '10 months inactive: not yet in the warning window');
  SET LOCAL request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000004';
  r := public.my_points_expiry();
  PERFORM pg_temp.expect(r->>'state' = 'soon' AND (r->>'points')::int = 400 AND (r->>'next_loss_points')::int = 100, 'warned in month 11.5: 25% would go at the 12 month mark');
  RESET request.jwt.claim.sub;
  PERFORM pg_temp.expect(public.my_points_expiry()->>'state' = 'ok', 'guests see nothing');

  -- a returning customer: ordering stops the fade and the new order earns its points
  UPDATE profiles SET points = 400 WHERE id = u4::uuid;
  PERFORM pg_temp.age_account(u4, 12.2);
  a := pg_temp.order_of(u4, 'pepsi', 1);
  PERFORM pg_temp.expect(pg_temp.pts(u4) = 300 + 4, 'returning at month 12: one step taken (400->300), new order adds 4');
  SET LOCAL request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000004';
  r := public.my_points_expiry();
  PERFORM pg_temp.expect(r->>'state' = 'ok' AND (r->>'points')::int = 304, 'after ordering: ok, no more fading');
  RESET request.jwt.claim.sub;

  -- admin list: warned/fading customers only, with phone numbers
  SET LOCAL request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
  PERFORM pg_temp.age_account(u3, 11.5);
  r := public.admin_fading_points();
  PERFORM pg_temp.expect(jsonb_array_length(r) = 1 AND r->0->>'phone' = '0125' AND r->0->>'state' = 'soon', 'admin list shows Newish (soon) with phone');
  RESET request.jwt.claim.sub;
  PERFORM pg_temp.expect_error('SELECT public.admin_fading_points()', 'Admins only');

  PERFORM pg_temp.expect(NOT has_function_privilege('authenticated', 'public.expire_points_if_stale(uuid, text)', 'execute'), 'customers cannot expire others');
  PERFORM pg_temp.expect(NOT has_function_privilege('anon', 'public.my_points_expiry()', 'execute'), 'anon cannot call my_points_expiry');
  PERFORM pg_temp.expect(NOT has_function_privilege('anon', 'public.admin_fading_points()', 'execute'), 'anon cannot call the admin list');
  PERFORM pg_temp.expect(NOT has_table_privilege('authenticated', 'public.points_fade', 'select'), 'fade bookkeeping is private');
END $$;
RESET request.jwt.claim.sub;

-- ---------------------------------------------------------------------------
-- 9. Points are paid at collection; friend's 30 after their first collected
--    order; weekday boost
-- ---------------------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS short_code text;
\i supabase/migrations/20261018000000_points_at_collection.sql

CREATE FUNCTION pg_temp.earned(p_order text) RETURNS integer LANGUAGE sql AS $$ SELECT points_earned FROM public.orders WHERE id = p_order $$;

INSERT INTO profiles (id, role, points, name) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'user', 0, 'Buyer One'),
  ('b0000000-0000-0000-0000-000000000003', 'user', 0, 'Referrer Three');
INSERT INTO profiles (id, role, points, name, referred_by) VALUES
  ('b0000000-0000-0000-0000-000000000002', 'user', 0, 'Friend Two', 'b0000000-0000-0000-0000-000000000003');

DO $$
DECLARE
  b constant text := 'b0000000-0000-0000-0000-000000000001';
  f constant text := 'b0000000-0000-0000-0000-000000000002';
  r constant text := 'b0000000-0000-0000-0000-000000000003';
  o1 text; o2 text; o3 text; o4 text;
BEGIN
  UPDATE points_boost SET enabled = false;   -- baseline without the weekday boost

  o1 := pg_temp.order_of(b, 'platter', 1);   -- RM69.90 -> 70 points
  PERFORM pg_temp.expect(pg_temp.earned(o1) = 70, 'order points are worked out at placement');
  PERFORM pg_temp.expect(pg_temp.pts(b) = 0, 'but not paid until the order is collected');
  UPDATE orders SET status = 'COOKING' WHERE id = o1;
  PERFORM pg_temp.expect(pg_temp.pts(b) = 0, 'still nothing while it is being cooked');
  UPDATE orders SET status = 'COLLECTED' WHERE id = o1;
  PERFORM pg_temp.expect(pg_temp.pts(b) = 76, 'collecting pays the order points plus the 6 bonus');
  PERFORM pg_temp.expect((SELECT points_credited_at FROM orders WHERE id = o1) IS NOT NULL, 'the order is marked as paid');
  UPDATE orders SET customer_name = 'touch' WHERE id = o1;
  PERFORM pg_temp.expect(pg_temp.pts(b) = 76, 'editing the order later never pays twice');

  -- a refund takes back the matching share of paid points
  UPDATE orders SET refund_amount = 3495 WHERE id = o1;
  PERFORM pg_temp.expect(pg_temp.pts(b) = 76 - 35, 'refunding half takes back half the order points');

  -- cancelling before collection: nothing was paid, nothing is taken back
  o2 := pg_temp.order_of(b, 'platter', 1);
  PERFORM pg_temp.expect(pg_temp.pts(b) = 41, 'placing a second order changes nothing yet');
  PERFORM set_config('request.jwt.claim.sub', b, false);
  PERFORM public.cancel_order(o2, 'Cancelled by Customer');
  PERFORM pg_temp.expect(pg_temp.pts(b) = 41, 'cancelling an uncollected order keeps the balance exactly as it was');

  -- an order placed before this change was paid at placement: cancel still takes it back
  INSERT INTO orders (id, status, total, user_id, points_earned, points_credited_at, created_at)
  VALUES ('LEGACY-1', 'PENDING', 2000, b::uuid, 20, now() - interval '1 hour', now() - interval '1 hour');
  UPDATE profiles SET points = points + 20 WHERE id = b::uuid;
  PERFORM public.cancel_order('LEGACY-1', 'Cancelled by Customer');
  PERFORM pg_temp.expect(pg_temp.pts(b) = 41, 'a legacy order that was paid at placement is taken back on cancel');
  RESET request.jwt.claim.sub;

  -- a legacy order (already paid at placement) is not paid a second time on collection
  INSERT INTO orders (id, status, total, user_id, points_earned, points_credited_at, created_at)
  VALUES ('LEGACY-2', 'READY', 3000, b::uuid, 30, now() - interval '2 hours', now() - interval '2 hours');
  UPDATE profiles SET points = points + 30 WHERE id = b::uuid;
  UPDATE orders SET status = 'COLLECTED' WHERE id = 'LEGACY-2';
  PERFORM pg_temp.expect(pg_temp.pts(b) = 41 + 30 + 6, 'a legacy order paid at placement only gets the 6 collection bonus on collection');
  UPDATE profiles SET points = points - 36 WHERE id = b::uuid;

  -- referral: the friend gets 30 on their first collected order of RM20 or more
  PERFORM pg_temp.expect(pg_temp.pts(f) = 0, 'the friend gets nothing at sign-up');
  o3 := pg_temp.order_of(f, 'pepsi', 2);     -- RM7: below the RM20 minimum
  UPDATE orders SET status = 'COLLECTED' WHERE id = o3;
  PERFORM pg_temp.expect(pg_temp.pts(f) = 7 + 6 AND pg_temp.pts(r) = 0, 'a small first order pays only its own points; no referral yet');
  o4 := pg_temp.order_of(f, 'platter', 1);
  UPDATE orders SET status = 'COLLECTED' WHERE id = o4;
  PERFORM pg_temp.expect(pg_temp.pts(f) = 13 + 70 + 6 + 30, 'the first collected order of RM20+ pays the friend 30 on top');
  PERFORM pg_temp.expect(pg_temp.pts(r) = 150, 'and pays the referrer 150');
  PERFORM pg_temp.expect((SELECT count(*) FROM referral_rewards_log WHERE referred_id = f::uuid AND reward_type = 'signup_bonus') = 1, 'the friend bonus is logged once');
  o3 := pg_temp.order_of(f, 'platter', 1);
  UPDATE orders SET status = 'COLLECTED' WHERE id = o3;
  PERFORM pg_temp.expect(pg_temp.pts(f) = 119 + 70 + 6 AND pg_temp.pts(r) = 150, 'later orders do not pay the referral again');

  -- weekday boost
  UPDATE points_boost SET enabled = true, multiplier = 2, days = '{0,1,2,3,4,5,6}';
  o1 := pg_temp.order_of(b, 'pepsi', 3);     -- RM10.50 -> 11 points, doubled
  PERFORM pg_temp.expect(pg_temp.earned(o1) = 22, 'the weekday boost doubles the order points');
  UPDATE points_boost SET days = '{}';
  o2 := pg_temp.order_of(b, 'pepsi', 3);
  PERFORM pg_temp.expect(pg_temp.earned(o2) = 11, 'on a day that is not boosted it is normal');
  UPDATE points_boost SET days = '{0,1,2,3,4,5,6}', enabled = false;
  o3 := pg_temp.order_of(b, 'pepsi', 3);
  PERFORM pg_temp.expect(pg_temp.earned(o3) = 11, 'switched off, it is normal');
  UPDATE points_boost SET enabled = true, multiplier = 2, days = '{2,3,4}';
  -- Tuesday to Thursday in Malaysia time
  PERFORM pg_temp.expect(public.points_boost_multiplier(timestamptz '2026-10-20 12:00+08') = 2, 'Tuesday is boosted');
  PERFORM pg_temp.expect(public.points_boost_multiplier(timestamptz '2026-10-22 23:30+08') = 2, 'Thursday night is boosted');
  PERFORM pg_temp.expect(public.points_boost_multiplier(timestamptz '2026-10-23 00:30+08') = 1, 'Friday just after midnight is not');
  PERFORM pg_temp.expect(public.points_boost_multiplier(timestamptz '2026-10-19 12:00+08') = 1, 'Monday is not');

END $$;
RESET request.jwt.claim.sub;

SET request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  PERFORM pg_temp.expect_error($q$SELECT public.admin_set_points_boost(true, 3, '{1}')$q$, 'permission denied');
  PERFORM pg_temp.expect(public.points_boost_info() ? 'multiplier', 'players can read the boost settings');
END $$;
SET request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
DO $$
BEGIN
  PERFORM public.admin_set_points_boost(true, 3, '{1,5}');
  PERFORM pg_temp.expect((SELECT multiplier FROM points_boost) = 3 AND (SELECT days FROM points_boost) = '{1,5}', 'the owner can change the boost');
  PERFORM pg_temp.expect_error($q$SELECT public.admin_set_points_boost(true, 9, '{1}')$q$, 'The multiplier must be between 1 and 5.');
  PERFORM pg_temp.expect_error($q$SELECT public.admin_set_points_boost(true, 2, '{8}')$q$, 'Days must be 0');
END $$;
RESET request.jwt.claim.sub;
DO $$
BEGIN
  PERFORM pg_temp.expect(NOT has_function_privilege('authenticated', 'public.points_boost_multiplier(timestamptz)', 'execute'), 'the multiplier helper is internal');
  PERFORM pg_temp.expect(has_function_privilege('anon', 'public.points_boost_info()', 'execute'), 'guests can see whether the boost is on');
  PERFORM pg_temp.expect(NOT has_table_privilege('authenticated', 'public.points_boost', 'select'), 'the settings table is private');
END $$;

DO $$ BEGIN RAISE NOTICE 'PASS: burger ranks and monthly prize assertions passed'; END $$;

ROLLBACK;
