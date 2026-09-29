-- Regression test for the pre-launch fix in
-- supabase/migrations/20260929000002_cap_arcade_daily_points.sql:
-- claim_trex_runner_reward/claim_speed_grab_reward must never pay out more
-- than the daily points budget per user per game, no matter how many times
-- a script claims an ever-increasing "new best" score in a loop.
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
  points integer DEFAULT 0
);

-- points_awarded is deliberately omitted here -- the migration under test
-- adds it via ALTER TABLE ... ADD COLUMN IF NOT EXISTS, same as it will
-- against the real (already-existing) table.
CREATE TABLE game_plays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  game_name text,
  played_at timestamptz DEFAULT now(),
  reward_claimed boolean DEFAULT false,
  score integer
);

-- Loads the real, shipped functions -- this test exercises actual
-- production code, not a copy that can drift from it.
\i supabase/migrations/20260929000002_cap_arcade_daily_points.sql

INSERT INTO profiles (id, points) VALUES ('11111111-1111-1111-1111-111111111111', 0);
SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- A script looping start_session -> claim(everHigherScore) should be capped
-- at the daily budget (120), never able to farm unlimited points by always
-- reporting a new "best".
DO $$
DECLARE
  v_result jsonb;
  v_total_awarded integer := 0;
  v_score integer := 0;
  i integer;
BEGIN
  FOR i IN 1..10 LOOP
    v_score := v_score + 50; -- always higher than the last -- always "a new best"
    INSERT INTO game_plays (user_id, game_name, reward_claimed) VALUES ('11111111-1111-1111-1111-111111111111', 'trex_runner', false);
    v_result := public.claim_trex_runner_reward(v_score);
    v_total_awarded := v_total_awarded + (v_result->>'points_awarded')::integer;
  END LOOP;

  IF v_total_awarded <> 120 THEN
    RAISE EXCEPTION 'FAIL: expected exactly 120 points awarded across 10 escalating claims (the daily cap), got %', v_total_awarded;
  END IF;

  DECLARE
    v_profile_points integer;
  BEGIN
    SELECT points INTO v_profile_points FROM profiles WHERE id = '11111111-1111-1111-1111-111111111111';
    IF v_profile_points <> 120 THEN
      RAISE EXCEPTION 'FAIL: expected profile points to be exactly 120, got %', v_profile_points;
    END IF;
  END;

  -- The player's recorded best score must still update even once the daily
  -- points budget is exhausted -- only the payout stops, not the tracking.
  DECLARE
    v_best integer;
  BEGIN
    SELECT COALESCE(MAX(score), 0) INTO v_best FROM game_plays WHERE user_id = '11111111-1111-1111-1111-111111111111' AND game_name = 'trex_runner';
    IF v_best <> v_score THEN
      RAISE EXCEPTION 'FAIL: best score should still track the latest (uncapped) score of %, got %', v_score, v_best;
    END IF;
  END;
END $$;

-- A prior day's points must not count against today's budget.
INSERT INTO profiles (id, points) VALUES ('22222222-2222-2222-2222-222222222222', 0);
SET LOCAL request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

INSERT INTO game_plays (user_id, game_name, played_at, reward_claimed, score, points_awarded)
VALUES ('22222222-2222-2222-2222-222222222222', 'speed_grab', now() - interval '1 day', true, 100, 120);

DO $$
DECLARE
  v_result jsonb;
BEGIN
  INSERT INTO game_plays (user_id, game_name, reward_claimed) VALUES ('22222222-2222-2222-2222-222222222222', 'speed_grab', false);
  v_result := public.claim_speed_grab_reward(140); -- beats yesterday's 100 by 40
  IF (v_result->>'points_awarded')::integer <> 40 THEN
    RAISE EXCEPTION 'FAIL: yesterday''s spent budget should not carry over to today, expected 40 points awarded, got %', v_result->>'points_awarded';
  END IF;
END $$;

-- The two games track separate daily budgets -- maxing out trex_runner must
-- not block speed_grab for the same user on the same day.
SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
DO $$
DECLARE
  v_result jsonb;
BEGIN
  INSERT INTO game_plays (user_id, game_name, reward_claimed) VALUES ('11111111-1111-1111-1111-111111111111', 'speed_grab', false);
  v_result := public.claim_speed_grab_reward(50);
  IF (v_result->>'points_awarded')::integer <> 40 THEN
    RAISE EXCEPTION 'FAIL: speed_grab should have its own separate daily budget from trex_runner, got %', v_result->>'points_awarded';
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'PASS: all arcade daily points cap assertions passed'; END $$;

ROLLBACK;
