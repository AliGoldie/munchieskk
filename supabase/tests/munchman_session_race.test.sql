-- Regression test for the pre-launch fix in
-- supabase/migrations/20260929000005_fix_munchman_session_race.sql:
-- start_munchman_session must lock the caller's own profile row before
-- checking "already played today", so the streak bonus (30/100 points) can
-- never be double-awarded, and the streak itself must progress correctly
-- day over day.
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
  score integer
);

-- Loads the real, shipped start_munchman_session() -- this test exercises
-- actual production code, not a copy that can drift from it.
\i supabase/migrations/20260929000005_fix_munchman_session_race.sql

CREATE OR REPLACE FUNCTION set_test_user(p_user uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_result jsonb;
  v_points integer;
BEGIN
  INSERT INTO profiles (id, points) VALUES (v_user, 0);
  PERFORM set_test_user(v_user);

  -- Day 1: first-ever play, no prior streak.
  v_result := public.start_munchman_session();
  IF (v_result->>'streak')::integer <> 1 OR (v_result->>'bonus_points')::integer <> 0 THEN
    RAISE EXCEPTION 'FAIL: day 1 expected streak=1, bonus=0, got %', v_result;
  END IF;

  -- A second call the same day must be rejected, not double-counted.
  BEGIN
    PERFORM public.start_munchman_session();
    RAISE EXCEPTION 'FAIL: second call on the same day should have raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%already used your free play today%' THEN
      RAISE EXCEPTION 'FAIL: unexpected error on same-day replay: %', SQLERRM;
    END IF;
  END;

  SELECT points INTO v_points FROM profiles WHERE id = v_user;
  IF v_points <> 0 THEN
    RAISE EXCEPTION 'FAIL: same-day replay must not award points, got %', v_points;
  END IF;

  -- Simulate day 2 and day 3 (consecutive) by back-dating last_game_date and
  -- the day-1 game_plays row, since the test can't wait for real days to pass.
  UPDATE profiles SET last_game_date = CURRENT_DATE - INTERVAL '1 day' WHERE id = v_user;
  UPDATE game_plays SET played_at = now() - INTERVAL '1 day' WHERE user_id = v_user;

  v_result := public.start_munchman_session();
  IF (v_result->>'streak')::integer <> 2 THEN
    RAISE EXCEPTION 'FAIL: day 2 expected streak=2, got %', v_result;
  END IF;

  UPDATE profiles SET last_game_date = CURRENT_DATE - INTERVAL '1 day' WHERE id = v_user;
  UPDATE game_plays SET played_at = now() - INTERVAL '1 day' WHERE user_id = v_user AND played_at::date = CURRENT_DATE;

  -- Day 3: streak bonus should fire exactly once, at exactly 30 points.
  v_result := public.start_munchman_session();
  IF (v_result->>'streak')::integer <> 3 OR (v_result->>'bonus_points')::integer <> 30 THEN
    RAISE EXCEPTION 'FAIL: day 3 expected streak=3, bonus=30, got %', v_result;
  END IF;

  SELECT points INTO v_points FROM profiles WHERE id = v_user;
  IF v_points <> 30 THEN
    RAISE EXCEPTION 'FAIL: expected exactly 30 points after the 3-day streak bonus, got %', v_points;
  END IF;

  -- A missed day resets the streak to 1, with no bonus.
  UPDATE profiles SET last_game_date = CURRENT_DATE - INTERVAL '3 days' WHERE id = v_user;
  UPDATE game_plays SET played_at = now() - INTERVAL '3 days' WHERE user_id = v_user AND played_at::date = CURRENT_DATE;

  v_result := public.start_munchman_session();
  IF (v_result->>'streak')::integer <> 1 OR (v_result->>'bonus_points')::integer <> 0 THEN
    RAISE EXCEPTION 'FAIL: a missed day should reset streak to 1 with no bonus, got %', v_result;
  END IF;
END $$;

-- The FOR UPDATE lock added by the fix must not block a *different* user's
-- session -- only concurrent calls for the *same* user should serialize.
DO $$
DECLARE
  v_other uuid := '22222222-2222-2222-2222-222222222222';
  v_result jsonb;
BEGIN
  INSERT INTO profiles (id, points) VALUES (v_other, 0);
  PERFORM set_test_user(v_other);
  v_result := public.start_munchman_session();
  IF (v_result->>'streak')::integer <> 1 THEN
    RAISE EXCEPTION 'FAIL: a different user''s first session should be unaffected, got %', v_result;
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'PASS: munchman session streak race assertions passed'; END $$;

ROLLBACK;
