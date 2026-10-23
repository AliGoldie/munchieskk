-- Regression test for 20261030000000_meat_swaps.sql: meat swaps on burgers and
-- platters. One ladder (beef 0, chicken +RM1, lamb +RM2), charged going UP,
-- free going down or level, and always worked out by the server.
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
INSERT INTO profiles (id, role, points) VALUES
  ('11111111-1111-1111-1111-111111111111', 'user', 0),
  ('22222222-2222-2222-2222-222222222222', 'user', 500);

-- Same ids and prices as the live menu (selling prices only).
INSERT INTO menu_items (id, name, category, price, stock_quantity, in_stock) VALUES
  ('1',  'BBQ Beef',        'BBQ',      1290, 100, true),
  ('5',  'BBQ Chicken',     'BBQ',      1390, 100, true),
  ('4',  'BBQ Lamb',        'BBQ',      1490, 100, true),
  ('16', 'BBQ EGGY',        'BBQ',       890, 100, true),
  ('11', 'Big-G Burger',    'PREMIUM',  1690, 100, true),
  ('7',  'Mushy2 Burger',   'PREMIUM',  1590, 100, true),
  ('8',  'Jucy Bae',        'PREMIUM',  1890, 100, true),
  ('12', 'SUMANDAK Burger', 'PREMIUM',  1790, 100, true),
  ('10', 'CZ Chix Burger',  'PREMIUM',  1690, 100, true),
  ('17', 'Kawan MONSTA',    'PLATTERS', 3590, 100, true),
  ('14', 'MONSTA Platter',  'PLATTERS', 6690, 100, true),
  ('2',  'Regular Fries',   'SIDES',     650, 100, true);

\i supabase/migrations/20261030000000_meat_swaps.sql
-- run twice on purpose: the migration must be safe to repeat
\i supabase/migrations/20261030000000_meat_swaps.sql

CREATE FUNCTION pg_temp.expect(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; END $$;
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

-- Prices a single choice list for one item and returns the charge in cents.
CREATE FUNCTION pg_temp.charge(p_item text, p_choices text) RETURNS integer LANGUAGE sql AS $$
  SELECT (public.price_meat_choices(p_item, p_choices::jsonb)->>'charge')::integer $$;

-- Places a one-line order as a user and returns the stored order row's total.
CREATE FUNCTION pg_temp.order_total(p_user text, p_item_json text, p_qty integer DEFAULT 1) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_id text; v_item jsonb := p_item_json::jsonb; v_total integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user, false);
  v_id := public.place_order(
    jsonb_build_array(jsonb_build_object('item_id', v_item->>'id', 'quantity', p_qty)),
    jsonb_build_object('items', jsonb_build_array(v_item || jsonb_build_object('quantity', p_qty)), 'status', 'PENDING', 'payment_method', 'Cash'));
  SELECT total INTO v_total FROM public.orders WHERE id = v_id;
  -- a customer may only have a few unaccepted orders open: close this one
  UPDATE public.orders SET status = 'CANCELLED' WHERE id = v_id;
  RETURN v_total;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The ladder: every swap and its charge (cents)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- BBQ Beef (1): chicken +100, lamb +200
  PERFORM pg_temp.expect(pg_temp.charge('1', '[{"slot":1,"meat":"chicken"}]') = 100, 'BBQ Beef -> chicken is +RM1');
  PERFORM pg_temp.expect(pg_temp.charge('1', '[{"slot":1,"meat":"lamb"}]') = 200, 'BBQ Beef -> lamb is +RM2');
  PERFORM pg_temp.expect(pg_temp.charge('1', '[{"slot":1,"meat":"beef"}]') = 0, 'BBQ Beef -> beef is free');
  -- BBQ Chicken (5): beef free, lamb +100
  PERFORM pg_temp.expect(pg_temp.charge('5', '[{"slot":1,"meat":"beef"}]') = 0, 'BBQ Chicken -> beef is free');
  PERFORM pg_temp.expect(pg_temp.charge('5', '[{"slot":1,"meat":"lamb"}]') = 100, 'BBQ Chicken -> lamb is +RM1');
  -- BBQ Lamb (4): anything is free
  PERFORM pg_temp.expect(pg_temp.charge('4', '[{"slot":1,"meat":"beef"}]') = 0, 'BBQ Lamb -> beef is free');
  PERFORM pg_temp.expect(pg_temp.charge('4', '[{"slot":1,"meat":"chicken"}]') = 0, 'BBQ Lamb -> chicken is free');
  -- Premium (Aus beef): chicken +100, lamb +200
  PERFORM pg_temp.expect(pg_temp.charge('11', '[{"slot":1,"meat":"chicken"}]') = 100, 'Big-G -> chicken is +RM1');
  PERFORM pg_temp.expect(pg_temp.charge('7',  '[{"slot":1,"meat":"lamb"}]') = 200, 'Mushy2 -> lamb is +RM2');
  PERFORM pg_temp.expect(pg_temp.charge('8',  '[{"slot":1,"meat":"lamb"}]') = 200, 'Jucy Bae -> lamb is +RM2');
  PERFORM pg_temp.expect(pg_temp.charge('12', '[{"slot":1,"meat":"chicken"}]') = 100, 'Sumandak -> chicken is +RM1');
  -- No choice at all = normal burger, no charge
  PERFORM pg_temp.expect(pg_temp.charge('1', NULL) = 0 AND pg_temp.charge('11', '[]') = 0, 'no choice means no charge');
  -- The stored list always shows every slot (defaults filled in)
  PERFORM pg_temp.expect((public.price_meat_choices('1', '[]')->'choices'->0->>'meat') = 'beef', 'default meat is recorded');
END $$;

-- ---------------------------------------------------------------------------
-- 2. Not swappable, and never-allowed combinations
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.expect_error($q$SELECT pg_temp.charge('10', '[{"slot":1,"meat":"lamb"}]')$q$, 'The meat cannot be changed on this item');
  PERFORM pg_temp.expect_error($q$SELECT pg_temp.charge('16', '[{"slot":1,"meat":"chicken"}]')$q$, 'The meat cannot be changed on this item');
  PERFORM pg_temp.expect_error($q$SELECT pg_temp.charge('2',  '[{"slot":1,"meat":"chicken"}]')$q$, 'The meat cannot be changed on this item');
  PERFORM pg_temp.expect_error($q$SELECT pg_temp.charge('1', '[{"slot":1,"meat":"pork"}]')$q$, 'That meat is not available');
  PERFORM pg_temp.expect_error($q$SELECT pg_temp.charge('1', '[{"slot":2,"meat":"lamb"}]')$q$, 'That burger slot does not exist');
  PERFORM pg_temp.expect_error($q$SELECT pg_temp.charge('17', '[{"slot":1,"meat":"lamb"},{"slot":1,"meat":"lamb"}]')$q$, 'The same burger was chosen twice');
  PERFORM pg_temp.expect_error($q$SELECT pg_temp.charge('1', '[{"slot":1,"meat":"lamb"},{"slot":2,"meat":"lamb"}]')$q$, 'Too many meat choices');
  PERFORM pg_temp.expect_error($q$SELECT pg_temp.charge('1', '{"slot":1}')$q$, 'Invalid meat choice');
  PERFORM pg_temp.expect_error($q$SELECT pg_temp.charge('1', '[{"slot":"x","meat":"lamb"}]')$q$, 'Invalid meat choice');
  PERFORM pg_temp.expect_error($q$SELECT pg_temp.charge('1', '[{"slot":1,"item_id":"11","meat":"lamb"}]')$q$, 'You cannot choose a different burger here');
END $$;

-- ---------------------------------------------------------------------------
-- 3. Platters: Kawan (2 BBQ slots) and MONSTA Platter (3 premium picks)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Kawan: one chicken (+100) and one lamb (+200), charged once per burger
  PERFORM pg_temp.expect(pg_temp.charge('17', '[{"slot":1,"meat":"chicken"},{"slot":2,"meat":"lamb"}]') = 300, 'Kawan: chicken + lamb = +RM3');
  PERFORM pg_temp.expect(pg_temp.charge('17', '[{"slot":1,"meat":"lamb"},{"slot":2,"meat":"lamb"}]') = 400, 'Kawan: two lamb = +RM4');
  PERFORM pg_temp.expect(pg_temp.charge('17', '[]') = 0, 'Kawan with no choice is the normal price');
  PERFORM pg_temp.expect(jsonb_array_length(public.price_meat_choices('17', '[{"slot":2,"meat":"lamb"}]')->'choices') = 2, 'Kawan: both slots are recorded');

  -- Platter: every slot must pick a premium burger
  PERFORM pg_temp.expect_error($q$SELECT pg_temp.charge('14', '[]')$q$, 'Please choose a burger for every slot');
  PERFORM pg_temp.expect_error($q$SELECT pg_temp.charge('14', '[{"slot":1,"item_id":"11"},{"slot":2,"item_id":"7"}]')$q$, 'Please choose a burger for every slot');
  PERFORM pg_temp.expect(pg_temp.charge('14', '[{"slot":1,"item_id":"11"},{"slot":2,"item_id":"7"},{"slot":3,"item_id":"8"}]') = 0, 'Platter: plain picks cost nothing extra');
  PERFORM pg_temp.expect(pg_temp.charge('14', '[{"slot":1,"item_id":"11","meat":"lamb"},{"slot":2,"item_id":"7","meat":"chicken"},{"slot":3,"item_id":"10"}]') = 300, 'Platter: lamb +2 and chicken +1, CZ Chix plain');
  -- Wrong picks
  PERFORM pg_temp.expect_error($q$SELECT pg_temp.charge('14', '[{"slot":1,"item_id":"1"},{"slot":2,"item_id":"7"},{"slot":3,"item_id":"8"}]')$q$, 'That burger cannot be chosen here');
  PERFORM pg_temp.expect_error($q$SELECT pg_temp.charge('14', '[{"slot":1,"item_id":"nope"},{"slot":2,"item_id":"7"},{"slot":3,"item_id":"8"}]')$q$, 'That burger cannot be chosen here');
  PERFORM pg_temp.expect_error($q$SELECT pg_temp.charge('14', '[{"slot":1,"item_id":"10","meat":"lamb"},{"slot":2,"item_id":"7"},{"slot":3,"item_id":"8"}]')$q$, 'The meat cannot be changed on that burger');
END $$;

-- ---------------------------------------------------------------------------
-- 4. Through place_order: the SERVER sets the price, whatever the browser says
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  u1 text := '11111111-1111-1111-1111-111111111111';
  v_id text; v_items jsonb;
BEGIN
  PERFORM pg_temp.expect(pg_temp.order_total(u1, '{"id":"1","name":"BBQ Beef","choices":[]}') = 1290, 'no choice: normal price');
  PERFORM pg_temp.expect(pg_temp.order_total(u1, '{"id":"1","name":"BBQ Beef","choices":[{"slot":1,"meat":"lamb"}]}') = 1490, 'BBQ Beef -> lamb: RM12.90 + 2.00');
  PERFORM pg_temp.expect(pg_temp.order_total(u1, '{"id":"5","name":"BBQ Chicken","choices":[{"slot":1,"meat":"beef"}]}') = 1390, 'BBQ Chicken -> beef: no discount, no charge');
  PERFORM pg_temp.expect(pg_temp.order_total(u1, '{"id":"11","name":"Big-G","choices":[{"slot":1,"meat":"chicken"}]}', 2) = 2 * 1790, 'Big-G -> chicken x2: charged per unit');
  PERFORM pg_temp.expect(pg_temp.order_total(u1, '{"id":"17","name":"Kawan","choices":[{"slot":1,"meat":"chicken"},{"slot":2,"meat":"lamb"}]}') = 3590 + 300, 'Kawan: +RM3 for the swaps');
  PERFORM pg_temp.expect(pg_temp.order_total(u1, '{"id":"14","name":"Platter","choices":[{"slot":1,"item_id":"11","meat":"lamb"},{"slot":2,"item_id":"7"},{"slot":3,"item_id":"10"}]}') = 6690 + 200, 'Platter: one lamb swap');

  -- A cheating browser: it sends its own low prices, charges and a fake swap
  -- total. None of it is believed.
  PERFORM pg_temp.expect(pg_temp.order_total(u1, '{"id":"1","name":"BBQ Beef","price":1,"swapCharge":0,"choices":[{"slot":1,"meat":"lamb","charge":0}]}') = 1490, 'fake charge and price are ignored');

  -- Illegal choices fail the whole order
  PERFORM pg_temp.expect_error(format($q$SELECT pg_temp.order_total(%L, %L)$q$, u1, '{"id":"10","name":"CZ Chix","choices":[{"slot":1,"meat":"lamb"}]}'), 'The meat cannot be changed on this item');
  PERFORM pg_temp.expect_error(format($q$SELECT pg_temp.order_total(%L, %L)$q$, u1, '{"id":"14","name":"Platter","choices":[]}'), 'Please choose a burger for every slot');

  -- What is stored for the kitchen
  PERFORM set_config('request.jwt.claim.sub', u1, false);
  v_id := public.place_order('[{"item_id":"17","quantity":1}]'::jsonb,
    '{"items":[{"id":"17","name":"Kawan","quantity":1,"choices":[{"slot":1,"meat":"chicken"},{"slot":2,"meat":"lamb"}]}],"payment_method":"Cash"}'::jsonb);
  SELECT items INTO v_items FROM orders WHERE id = v_id;
  PERFORM pg_temp.expect((v_items->0->>'swapCharge')::integer = 300, 'the order records the swap charge');
  PERFORM pg_temp.expect(v_items->0->'choices'->0->>'meat' = 'chicken' AND v_items->0->'choices'->1->>'meat' = 'lamb', 'the order records each burger''s meat');
  PERFORM pg_temp.expect((v_items->0->>'price')::integer = 3590, 'the line keeps its base price; the swap is shown separately');
  UPDATE orders SET status = 'CANCELLED' WHERE id = v_id;
  -- A normal item has no choices noise on it
  v_id := public.place_order('[{"item_id":"2","quantity":1}]'::jsonb,
    '{"items":[{"id":"2","name":"Fries","quantity":1}],"payment_method":"Cash"}'::jsonb);
  SELECT items INTO v_items FROM orders WHERE id = v_id;
  PERFORM pg_temp.expect(NOT (v_items->0 ? 'choices') AND NOT (v_items->0 ? 'swapCharge'), 'items without slots are stored as before');
END $$;

-- ---------------------------------------------------------------------------
-- 5. The free Kawan reward still pays for swaps
-- ---------------------------------------------------------------------------
INSERT INTO loyalty_prizes (id, name, points_cost, menu_item_id, min_order_cents, is_active)
VALUES ('aaaaaaaa-0000-0000-0000-00000000f017', 'Free Kawan MONSTA', 100, '17', 1000, true);

DO $$
DECLARE
  u2 text := '22222222-2222-2222-2222-222222222222';
  v_o text; v_total integer; v_items jsonb; v_res jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', u2, false);
  v_o := public.place_order('[{"item_id":"11","quantity":1}]'::jsonb,
    '{"items":[{"id":"11","name":"Big-G","quantity":1}],"payment_method":"Cash"}'::jsonb);
  PERFORM public.apply_order_reward(v_o, 'aaaaaaaa-0000-0000-0000-00000000f017');
  SELECT total INTO v_total FROM orders WHERE id = v_o;
  PERFORM pg_temp.expect(v_total = 1690, 'setup: the free platter adds RM0');

  v_res := public.apply_reward_swaps(v_o, '[{"slot":1,"meat":"chicken"},{"slot":2,"meat":"lamb"}]');
  PERFORM pg_temp.expect((v_res->>'charge')::integer = 300 AND (v_res->>'applied')::boolean, 'the reward customer is charged RM3 for the swaps');
  SELECT total, items INTO v_total, v_items FROM orders WHERE id = v_o;
  PERFORM pg_temp.expect(v_total = 1690 + 300, 'the order total includes the swap charge');
  PERFORM pg_temp.expect((v_items->1->>'swapCharge')::integer = 300 AND (v_items->1->>'price')::integer = 0, 'the reward line stays RM0; the swap is recorded on it');

  -- Cannot be charged (or changed) a second time
  v_res := public.apply_reward_swaps(v_o, '[{"slot":1,"meat":"lamb"},{"slot":2,"meat":"lamb"}]');
  PERFORM pg_temp.expect(NOT (v_res->>'applied')::boolean, 'a second call does nothing');
  PERFORM pg_temp.expect((SELECT total FROM orders WHERE id = v_o) = 1990, 'total unchanged by the second call');
END $$;

DO $$
DECLARE
  u1 text := '11111111-1111-1111-1111-111111111111';
  u2 text := '22222222-2222-2222-2222-222222222222';
  v_o text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', u2, false);
  v_o := public.place_order('[{"item_id":"11","quantity":1}]'::jsonb,
    '{"items":[{"id":"11","name":"Big-G","quantity":1}],"payment_method":"Cash"}'::jsonb);
  PERFORM public.apply_order_reward(v_o, 'aaaaaaaa-0000-0000-0000-00000000f017');
  -- illegal slot on the reward line
  PERFORM pg_temp.expect_error(format($q$SELECT public.apply_reward_swaps(%L, %L)$q$, v_o, '[{"slot":3,"meat":"lamb"}]'), 'That burger slot does not exist');
  PERFORM pg_temp.expect((SELECT total FROM orders WHERE id = v_o) = 1690, 'a refused choice charges nothing');
  -- someone else cannot add choices to this order
  PERFORM set_config('request.jwt.claim.sub', u1, false);
  PERFORM pg_temp.expect_error(format($q$SELECT public.apply_reward_swaps(%L, %L)$q$, v_o, '[{"slot":1,"meat":"lamb"}]'), 'Order not found');
  -- a guest cannot call it at all
  PERFORM set_config('request.jwt.claim.sub', '', false);
  PERFORM pg_temp.expect_error(format($q$SELECT public.apply_reward_swaps(%L, %L)$q$, v_o, '[]'), 'Please log in');
END $$;

-- ---------------------------------------------------------------------------
-- 6. Permissions
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.expect(NOT has_function_privilege('anon', 'public.price_meat_choices(text, jsonb)', 'EXECUTE'), 'guests cannot call the price checker');
  PERFORM pg_temp.expect(NOT has_function_privilege('anon', 'public.apply_reward_swaps(text, jsonb)', 'EXECUTE'), 'guests cannot call apply_reward_swaps');
  PERFORM pg_temp.expect(has_function_privilege('authenticated', 'public.apply_reward_swaps(text, jsonb)', 'EXECUTE'), 'signed-in users can');
  PERFORM pg_temp.expect(has_table_privilege('anon', 'public.swap_slots', 'SELECT') AND NOT has_table_privilege('anon', 'public.swap_slots', 'INSERT'), 'rules are readable but not writable by guests');
  PERFORM pg_temp.expect(NOT has_table_privilege('authenticated', 'public.meat_ladder', 'UPDATE'), 'signed-in users cannot change the ladder');
END $$;

DO $$ BEGIN RAISE NOTICE 'PASS: meat swap assertions passed'; END $$;

ROLLBACK;
