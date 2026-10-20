-- Regression test for 20261026000000_rewards_only_at_checkout.sql:
-- the old counter-code route (redeem_prize) refuses and takes nothing, and
-- guests still cannot call it.
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

CREATE TABLE profiles (id uuid PRIMARY KEY, points integer DEFAULT 0);
CREATE TABLE loyalty_prizes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, points_cost integer, is_active boolean DEFAULT true);
CREATE TABLE redemptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, prize_id uuid, status text DEFAULT 'PENDING');

\i supabase/migrations/20261026000000_rewards_only_at_checkout.sql
-- run twice on purpose: the migration must be safe to repeat
\i supabase/migrations/20261026000000_rewards_only_at_checkout.sql

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

INSERT INTO profiles (id, points) VALUES ('a1111111-1111-1111-1111-111111111111', 500);
INSERT INTO loyalty_prizes (id, name, points_cost) VALUES ('b2222222-2222-2222-2222-222222222222', 'Free Egg', 60);

SELECT set_config('request.jwt.claim.sub', 'a1111111-1111-1111-1111-111111111111', false);
DO $$
BEGIN
  PERFORM pg_temp.expect_error($q$SELECT public.redeem_prize('a1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222')$q$,
    'Rewards are added to your order in the app');
  PERFORM pg_temp.expect((SELECT points FROM profiles WHERE id = 'a1111111-1111-1111-1111-111111111111') = 500, 'a refused counter claim takes no coins');
  PERFORM pg_temp.expect((SELECT count(*) FROM redemptions) = 0, 'a refused counter claim creates no code');
END $$;

SELECT set_config('request.jwt.claim.sub', '', false);
DO $$
BEGIN
  PERFORM pg_temp.expect_error($q$SELECT public.redeem_prize('', 'b2222222-2222-2222-2222-222222222222')$q$, 'User must be logged in');
  PERFORM pg_temp.expect(NOT has_function_privilege('anon', 'public.redeem_prize(text, uuid)', 'execute'), 'guests cannot call it');
  PERFORM pg_temp.expect(has_function_privilege('authenticated', 'public.redeem_prize(text, uuid)', 'execute'), 'signed-in customers get the friendly message, not a permission error');
END $$;

DO $$ BEGIN RAISE NOTICE 'PASS: rewards-only-at-checkout assertions passed'; END $$;

ROLLBACK;
