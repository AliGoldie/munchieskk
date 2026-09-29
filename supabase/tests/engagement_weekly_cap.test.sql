-- Regression test for the pre-launch fix in
-- supabase/migrations/20260929000006_engagement_weekly_points_cap.sql:
-- arcade daily sub-cap drops to 20/day/game, and all four free-engagement
-- channels (arcade x2, Munch-Man streak, Munch-Man win) now share one
-- rolling 150-points-per-7-days ceiling, on top of their own per-source
-- limits, no matter how they're combined.
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
  points integer DEFAULT 0,
  game_streak integer DEFAULT 0,
  last_game_date date
);

CREATE TABLE game_plays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  game_name text,
  played_at timestamptz DEFAULT now(),
  reward_claimed boolean DEFAULT false,
  score integer,
  points_awarded integer NOT NULL DEFAULT 0
);

-- Loads the real, shipped functions -- this test exercises actual
-- production code, not a copy that can drift from it.
\i supabase/migrations/20260929000006_engagement_weekly_points_cap.sql

CREATE OR REPLACE FUNCTION set_test_user(p_user uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END;
$$ LANGUAGE plpgsql;

-- 1. Arcade's own daily sub-cap is now 20, not 30.
DO $$
DECLARE
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_result jsonb;
  v_total_awarded integer := 0;
  v_score integer := 0;
  i integer;
BEGIN
  INSERT INTO profiles (id, points) VALUES (v_user, 0);
  PERFORM set_test_user(v_user);

  FOR i IN 1..10 LOOP
    v_score := v_score + 50;
    INSERT INTO game_plays (user_id, game_name, reward_claimed) VALUES (v_user, 'trex_runner', false);
    v_result := public.claim_trex_runner_reward(v_score);
    v_total_awarded := v_total_awarded + (v_result->>'points_awarded')::integer;
  END LOOP;

  IF v_total_awarded <> 20 THEN
    RAISE EXCEPTION 'FAIL: expected trex_runner daily sub-cap of 20 (not 30), got %', v_total_awarded;
  END IF;
END $$;

-- 2. The shared weekly ceiling (150) binds across DIFFERENT sources, even
-- though none of them individually hit their own per-source cap.
DO $$
DECLARE
  v_user uuid := '22222222-2222-2222-2222-222222222222';
  v_result jsonb;
  v_points integer;
BEGIN
  INSERT INTO profiles (id, points) VALUES (v_user, 0);
  PERFORM set_test_user(v_user);

  -- Day 1: trex_runner earns its full 20/day sub-cap.
  INSERT INTO game_plays (user_id, game_name, reward_claimed) VALUES (v_user, 'trex_runner', false);
  v_result := public.claim_trex_runner_reward(100);
  IF (v_result->>'points_awarded')::integer <> 20 THEN
    RAISE EXCEPTION 'FAIL: expected 20 from trex_runner, got %', v_result->>'points_awarded';
  END IF;

  -- Day 1: speed_grab earns its full 20/day sub-cap. Running total: 40.
  INSERT INTO game_plays (user_id, game_name, reward_claimed) VALUES (v_user, 'speed_grab', false);
  v_result := public.claim_speed_grab_reward(100);
  IF (v_result->>'points_awarded')::integer <> 20 THEN
    RAISE EXCEPTION 'FAIL: expected 20 from speed_grab, got %', v_result->>'points_awarded';
  END IF;

  -- Munch-Man session 1: no streak bonus yet (day 1), but the win bonus
  -- (50) pushes the weekly running total to 90 (40 + 50).
  PERFORM public.start_munchman_session();
  v_result := public.claim_munchman_reward(true, 10, 10);
  IF (v_result->>'points_awarded')::integer <> 50 THEN
    RAISE EXCEPTION 'FAIL: expected 50 from munchman win, got %', v_result->>'points_awarded';
  END IF;

  SELECT points INTO v_points FROM profiles WHERE id = v_user;
  IF v_points <> 90 THEN
    RAISE EXCEPTION 'FAIL: expected running weekly total of 90 (20+20+50), got %', v_points;
  END IF;

  -- Day 2: back-date so it's "yesterday" for the streak, then play again.
  -- Both arcade games' daily sub-caps reset fresh (20 each available), and
  -- the shared budget (60 left, 150-90) is enough to pay both in full.
  UPDATE game_plays SET played_at = now() - interval '1 day' WHERE user_id = v_user;
  UPDATE profiles SET last_game_date = CURRENT_DATE - INTERVAL '1 day' WHERE id = v_user;

  INSERT INTO game_plays (user_id, game_name, reward_claimed) VALUES (v_user, 'trex_runner', false);
  v_result := public.claim_trex_runner_reward(300);
  IF (v_result->>'points_awarded')::integer <> 20 THEN
    RAISE EXCEPTION 'FAIL: day-2 trex_runner sub-cap should be a fresh 20 (60 still left in the shared budget), got %', v_result->>'points_awarded';
  END IF;

  INSERT INTO game_plays (user_id, game_name, reward_claimed) VALUES (v_user, 'speed_grab', false);
  v_result := public.claim_speed_grab_reward(300);
  IF (v_result->>'points_awarded')::integer <> 20 THEN
    RAISE EXCEPTION 'FAIL: day-2 speed_grab sub-cap should be a fresh 20 (40 still left in the shared budget), got %', v_result->>'points_awarded';
  END IF;

  -- Running total is now 130 (90 + 20 + 20); only 20 remains in the shared
  -- budget. Munch-Man's win bonus wants to pay 50 -- this is where the
  -- SHARED cap, not any per-source cap, must clamp it down to exactly 20.
  PERFORM public.start_munchman_session();
  v_result := public.claim_munchman_reward(true, 10, 10);
  IF (v_result->>'points_awarded')::integer <> 20 THEN
    RAISE EXCEPTION 'FAIL: expected the shared weekly budget to clamp a 50-point win bonus down to the 20 remaining, got %', v_result->>'points_awarded';
  END IF;

  SELECT points INTO v_points FROM profiles WHERE id = v_user;
  IF v_points <> 150 THEN
    RAISE EXCEPTION 'FAIL: expected exactly 150 total points once the weekly budget is exhausted, got %', v_points;
  END IF;

  -- Day 3: sub-caps reset fresh again (a full 20 available per game), but
  -- the shared weekly budget is still fully spent (all of it awarded within
  -- the last 7 days) -- so this must be clamped to 0 by the SHARED cap
  -- alone, with its own per-source cap not binding at all.
  UPDATE game_plays SET played_at = now() - interval '1 day' WHERE user_id = v_user;
  INSERT INTO game_plays (user_id, game_name, reward_claimed) VALUES (v_user, 'trex_runner', false);
  v_result := public.claim_trex_runner_reward(500);
  IF (v_result->>'points_awarded')::integer <> 0 THEN
    RAISE EXCEPTION 'FAIL: weekly budget is exhausted, expected 0 from trex_runner even with its own daily sub-cap fully available, got %', v_result->>'points_awarded';
  END IF;

  SELECT points INTO v_points FROM profiles WHERE id = v_user;
  IF v_points <> 150 THEN
    RAISE EXCEPTION 'FAIL: points must not exceed the weekly cap of 150, got %', v_points;
  END IF;
END $$;

-- 3. A week later, the budget rolls off and refills.
DO $$
DECLARE
  v_user uuid := '22222222-2222-2222-2222-222222222222';
  v_result jsonb;
BEGIN
  PERFORM set_test_user(v_user);
  UPDATE engagement_points_log SET awarded_at = now() - interval '8 days' WHERE user_id = v_user;

  INSERT INTO game_plays (user_id, game_name, reward_claimed) VALUES (v_user, 'trex_runner', false);
  v_result := public.claim_trex_runner_reward(600);
  IF (v_result->>'points_awarded')::integer <> 20 THEN
    RAISE EXCEPTION 'FAIL: once the 7-day window rolls off, a fresh 20 should be awardable, got %', v_result->>'points_awarded';
  END IF;
END $$;

-- 4. A different user is completely unaffected by user 2's exhausted budget.
DO $$
DECLARE
  v_other uuid := '33333333-3333-3333-3333-333333333333';
  v_result jsonb;
BEGIN
  INSERT INTO profiles (id, points) VALUES (v_other, 0);
  PERFORM set_test_user(v_other);

  INSERT INTO game_plays (user_id, game_name, reward_claimed) VALUES (v_other, 'trex_runner', false);
  v_result := public.claim_trex_runner_reward(100);
  IF (v_result->>'points_awarded')::integer <> 20 THEN
    RAISE EXCEPTION 'FAIL: a different user''s weekly budget should be untouched, got %', v_result->>'points_awarded';
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'PASS: engagement weekly cap assertions passed'; END $$;

ROLLBACK;
