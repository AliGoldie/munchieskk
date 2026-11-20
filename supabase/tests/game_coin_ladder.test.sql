-- Game coins: the weekly ladder (month 1 and month 2 onward), its overall limits, the welcome bonus,
-- Munch-Man replays and the admin settings. Run against the default numbers from 20261121000000_game_coin_ladder.sql.
-- Regression test for 20261016000000_arcade_contests.sql:
-- server-side score check, weekly goal bonus, contest ranking (best per game,
-- ties, minimum score, one account per phone), winners and claim codes,
-- first-name-only public view, admin view, and who can call what.
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

CREATE TABLE profiles (
  id uuid PRIMARY KEY,
  role text DEFAULT 'user',
  points integer DEFAULT 0,
  name text,
  phone text,
  game_streak integer DEFAULT 0,
  last_game_date date,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE orders (
  id text PRIMARY KEY,
  user_id uuid,
  status text,
  total integer,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE game_plays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  game_name text NOT NULL DEFAULT 'munch_man',
  played_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  reward_claimed boolean DEFAULT false,
  score integer,
  points_awarded integer NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT ON game_plays TO authenticated;
CREATE TABLE engagement_points_log (
  id bigserial PRIMARY KEY,
  user_id uuid,
  source text NOT NULL CONSTRAINT engagement_points_log_source_check
    CHECK (source IN ('arcade_trex', 'arcade_speed_grab', 'munchman_streak', 'munchman_win')),
  points integer,
  awarded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE monthly_prizes (claim_code text);

CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;
CREATE FUNCTION public.generate_unique_redemption_code() RETURNS text LANGUAGE sql AS $$
  SELECT upper(substr(md5(random()::text), 1, 6));
$$;

\i supabase/migrations/20261012000002_arcade_points_grace_period.sql
\i supabase/migrations/20261016000000_arcade_contests.sql
\i supabase/migrations/20261017000000_munchman_match_games.sql
\i supabase/migrations/20261019000000_arcade_score_cap.sql
\i supabase/migrations/20261031000000_leaderboard.sql
\i supabase/migrations/20261020000000_contest_claim_needs_phone.sql
\i supabase/migrations/20261023000000_weekly_goal_rules.sql
\i supabase/migrations/20261121000000_game_coin_ladder.sql
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
CREATE FUNCTION pg_temp.as_user(p_id text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', p_id, false);
$$;
-- start a run that began p_secs ago, then submit a score for it
CREATE FUNCTION pg_temp.run(p_user text, p_game text, p_secs numeric, p_score integer) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO game_plays (user_id, game_name, played_at) VALUES (p_user::uuid, p_game, now() - make_interval(secs => p_secs));
  PERFORM pg_temp.as_user(p_user);
  IF p_game = 'trex_runner' THEN RETURN public.claim_trex_runner_reward(p_score);
  ELSE RETURN public.claim_speed_grab_reward(p_score); END IF;
END $$;
CREATE FUNCTION pg_temp.pts(p_id text) RETURNS integer LANGUAGE sql AS $$
  SELECT points FROM public.profiles WHERE id = p_id::uuid $$;


CREATE FUNCTION pg_temp.munch(p_user text, p_secs numeric, p_score integer) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO game_plays (user_id, game_name, played_at) VALUES (p_user::uuid, 'munch_man', now() - make_interval(secs => p_secs));
  PERFORM pg_temp.as_user(p_user);
  RETURN public.record_munchman_score(p_score);
END $$;

INSERT INTO profiles (id, role, points, name, phone, created_at) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 0, 'Boss Owner', '0100000000', now() - interval '200 days'),
  ('a0000000-0000-0000-0000-000000000001', 'user', 0, 'Nina New', '0121000001', now() - interval '3 days'),
  ('a0000000-0000-0000-0000-000000000002', 'user', 0, 'Olga Limit', '0121000002', now() - interval '3 days'),
  ('a0000000-0000-0000-0000-000000000003', 'user', 0, 'Ivy Old', '0121000003', now() - interval '90 days'),
  ('a0000000-0000-0000-0000-000000000004', 'user', 0, 'Wendy Welcome', '0121000004', now() - interval '2 days'),
  ('a0000000-0000-0000-0000-000000000005', 'user', 0, 'Shy Short', '0121000005', now() - interval '2 days'),
  ('a0000000-0000-0000-0000-000000000006', 'user', 0, 'Boundary Bea', '0121000006', now() - interval '35 days');

-- ---------------------------------------------------------------------
-- 1. Defaults
-- ---------------------------------------------------------------------
DO $$
DECLARE s arcade_settings;
BEGIN
  SELECT * INTO s FROM arcade_settings;
  PERFORM pg_temp.expect(s.ladder_m1_step_xp = 1000 AND s.ladder_m1_step_coins = 3 AND s.ladder_m1_week_max = 15 AND s.ladder_m1_total_max = 60, 'month 1 defaults: 3 coins per 1,000 XP, 15 a week, 60 in total');
  PERFORM pg_temp.expect(s.ladder_m2_step_xp = 1500 AND s.ladder_m2_step_coins = 2 AND s.ladder_m2_week_max = 10 AND s.ladder_m2_window_max = 40, 'month 2 defaults: 2 coins per 1,500 XP, 10 a week, 40 in any 30 days');
  PERFORM pg_temp.expect(s.welcome_coins = 5 AND s.welcome_min_seconds = 15 AND s.welcome_min_trex = 300 AND s.welcome_min_grab = 200 AND s.welcome_min_munch = 300, 'welcome defaults: 5 coins, 15 seconds, floors 300 / 200 / 300');
END $$;

-- ---------------------------------------------------------------------
-- 2. Month 1 ladder: coins for every 1,000 Burger XP in the week, 15 a week at most
-- ---------------------------------------------------------------------
DO $$
DECLARE r jsonb;
  n constant text := 'a0000000-0000-0000-0000-000000000001';
BEGIN
  r := pg_temp.run(n, 'trex_runner', 60, 900);
  PERFORM pg_temp.expect((r->>'points_awarded')::int = 0 AND pg_temp.pts(n) = 0, 'under 1,000 XP pays nothing');
  PERFORM pg_temp.expect((r->'goal'->>'goal_score')::int = 1000 AND (r->'goal'->>'goal_points')::int = 3, 'the next rung is 1,000 XP for 3 coins');
  r := pg_temp.run(n, 'trex_runner', 60, 1000);
  PERFORM pg_temp.expect((r->>'points_awarded')::int = 3 AND pg_temp.pts(n) = 3, '1,000 XP pays 3 coins');
  PERFORM pg_temp.expect((r->'goal'->>'goal_score')::int = 2000 AND (r->'goal'->>'coins_this_week')::int = 3, 'then the next rung is 2,000 XP and 3 coins are counted this week');
  r := pg_temp.run(n, 'trex_runner', 60, 1900);
  PERFORM pg_temp.expect((r->>'points_awarded')::int = 0 AND pg_temp.pts(n) = 3, '1,900 XP is still one rung, nothing more');
  r := pg_temp.run(n, 'trex_runner', 60, 2000);
  PERFORM pg_temp.expect((r->>'points_awarded')::int = 3 AND pg_temp.pts(n) = 6, '2,000 XP pays the second rung (6 coins in all)');
  r := pg_temp.run(n, 'speed_grab', 40, 3000);
  PERFORM pg_temp.expect((r->>'points_awarded')::int = 9 AND pg_temp.pts(n) = 15, 'a second game lifts the week to 5,000 XP and pays up to the weekly limit of 15');
  r := pg_temp.munch(n, 100, 3000);
  PERFORM pg_temp.expect((r->>'welcome_awarded')::int = 5 AND (r->>'points_awarded')::int = 5 AND pg_temp.pts(n) = 20, 'the weekly limit of 15 holds: only the 5-coin welcome bonus is paid (all three games now played)');
  PERFORM pg_temp.expect((r->'goal'->>'done')::boolean, 'the status shows the ladder as finished for the week');
  PERFORM pg_temp.expect((SELECT points FROM arcade_goal_awards WHERE user_id = n::uuid) = 15, 'the week row records 15 coins');
END $$;

-- ---------------------------------------------------------------------
-- 3. The overall limit for the first 30 days (60 coins in total)
-- ---------------------------------------------------------------------
DO $$
DECLARE r jsonb;
  o constant text := 'a0000000-0000-0000-0000-000000000002';
BEGIN
  INSERT INTO engagement_points_log (user_id, source, points) VALUES (o::uuid, 'arcade_goal', 58);
  UPDATE profiles SET points = 58 WHERE id = o::uuid;
  r := pg_temp.run(o, 'trex_runner', 60, 3000);   -- 3 rungs = 9 coins, only 2 left under the 60 limit
  PERFORM pg_temp.expect((r->>'points_awarded')::int = 2 AND pg_temp.pts(o) = 60, 'only the 2 coins left under the 60-coin limit are paid');
  r := pg_temp.run(o, 'speed_grab', 40, 2000);
  PERFORM pg_temp.expect((r->>'points_awarded')::int = 0 AND pg_temp.pts(o) = 60, 'nothing more after the first-30-days limit is used');
END $$;

-- ---------------------------------------------------------------------
-- 4. Month 2 onward: needs a collected order, 2 coins per 1,500 XP, 10 a week, 40 in any 30 days
-- ---------------------------------------------------------------------
DO $$
DECLARE r jsonb;
  v constant text := 'a0000000-0000-0000-0000-000000000003';
BEGIN
  r := pg_temp.run(v, 'trex_runner', 60, 1600);
  PERFORM pg_temp.expect((r->>'points_awarded')::int = 0 AND pg_temp.pts(v) = 0, 'after the first 30 days nothing is paid without a collected order');
  PERFORM pg_temp.expect((r->'goal'->>'eligible')::boolean = false AND (r->'goal'->>'phase')::int = 2, 'the status says the player is in month 2 and not eligible yet');
  INSERT INTO orders (id, user_id, status, total, created_at) VALUES ('LAD-1', v::uuid, 'COLLECTED', 2500, now() - interval '5 days');
  r := pg_temp.run(v, 'trex_runner', 60, 1700);
  PERFORM pg_temp.expect((r->>'points_awarded')::int = 2 AND pg_temp.pts(v) = 2, 'with a collected order 1,500 XP pays 2 coins');
  PERFORM pg_temp.expect((r->'goal'->>'goal_score')::int = 3000 AND (r->'goal'->>'week_max')::int = 10, 'the next rung is 3,000 XP and the weekly limit is 10');
  -- window limit: 38 coins earned in the last 10 days already, so only 2 more fit under 40
  INSERT INTO engagement_points_log (user_id, source, points, awarded_at) VALUES (v::uuid, 'arcade_goal', 38, now() - interval '10 days');
  r := pg_temp.run(v, 'speed_grab', 40, 3000);    -- week 4,700 XP = 3 rungs = 6 coins target, 2 already paid, 4 wanted, 2 allowed
  PERFORM pg_temp.expect((r->>'points_awarded')::int = 0 AND pg_temp.pts(v) = 2, 'the 40-coin window is already full (2 + 38 coins in 30 days)');
  DELETE FROM engagement_points_log WHERE user_id = v::uuid AND points = 38;
  INSERT INTO engagement_points_log (user_id, source, points, awarded_at) VALUES (v::uuid, 'arcade_goal', 36, now() - interval '10 days');
  r := pg_temp.run(v, 'speed_grab', 40, 3000);
  PERFORM pg_temp.expect((r->>'points_awarded')::int = 2 AND pg_temp.pts(v) = 4, 'only the 2 coins left in the 40-coin window are paid');
  -- coins older than 30 days no longer count
  DELETE FROM engagement_points_log WHERE user_id = v::uuid AND points = 36;
  INSERT INTO engagement_points_log (user_id, source, points, awarded_at) VALUES (v::uuid, 'arcade_goal', 40, now() - interval '31 days');
  r := pg_temp.munch(v, 100, 3000);
  PERFORM pg_temp.expect((r->>'points_awarded')::int = 11 AND pg_temp.pts(v) = 15, 'coins from more than 30 days ago do not count against the window (6 ladder coins up to the weekly limit of 10, plus the 5-coin welcome bonus)');
END $$;

-- coins earned in the first 30 days never count against the month-2 window
DO $$
DECLARE r jsonb;
  b constant text := 'a0000000-0000-0000-0000-000000000006';
BEGIN
  INSERT INTO orders (id, user_id, status, total, created_at) VALUES ('LAD-2', b::uuid, 'COLLECTED', 2500, now() - interval '3 days');
  INSERT INTO engagement_points_log (user_id, source, points, awarded_at)
  SELECT id, 'arcade_goal', 60, created_at + interval '10 days' FROM profiles WHERE id = b::uuid;
  r := pg_temp.run(b, 'trex_runner', 60, 1600);
  PERFORM pg_temp.expect((r->>'points_awarded')::int = 2, 'the 60 coins from the first 30 days do not use up the month-2 window');
END $$;

-- ---------------------------------------------------------------------
-- 5. The welcome bonus: once, for really playing all three games
-- ---------------------------------------------------------------------
DO $$
DECLARE r jsonb;
  w constant text := 'a0000000-0000-0000-0000-000000000004';
  sh constant text := 'a0000000-0000-0000-0000-000000000005';
BEGIN
  r := pg_temp.run(w, 'trex_runner', 20, 350);
  PERFORM pg_temp.expect((r->>'welcome_awarded')::int = 0, 'one game is not enough');
  r := pg_temp.run(w, 'speed_grab', 20, 250);
  PERFORM pg_temp.expect((r->>'welcome_awarded')::int = 0, 'two games are not enough');
  r := pg_temp.munch(w, 20, 400);
  PERFORM pg_temp.expect((r->>'welcome_awarded')::int = 5 AND (r->>'points_awarded')::int = 8 AND pg_temp.pts(w) = 8, 'the third game pays the 5-coin welcome bonus plus the 3-coin ladder rung (1,000 XP)');
  PERFORM pg_temp.expect(r->>'message' LIKE '%Welcome bonus%', 'the player is told about the welcome bonus');
  r := pg_temp.run(w, 'trex_runner', 20, 500);
  PERFORM pg_temp.expect((r->>'welcome_awarded')::int = 0 AND pg_temp.pts(w) = 8, 'the welcome bonus is paid only once');
  PERFORM pg_temp.expect((SELECT count(*) FROM arcade_welcome_awards WHERE user_id = w::uuid) = 1, 'one welcome row per account');

  -- a run that is too short, or too low, does not count as really playing
  r := pg_temp.run(sh, 'trex_runner', 10, 400);    -- 10 seconds: under the 15-second minimum
  r := pg_temp.run(sh, 'speed_grab', 20, 250);
  r := pg_temp.munch(sh, 20, 400);
  PERFORM pg_temp.expect((r->>'welcome_awarded')::int = 0, 'a 10-second run does not count towards the welcome bonus');
  r := pg_temp.run(sh, 'trex_runner', 20, 200);    -- long enough but under the 300 floor
  PERFORM pg_temp.expect((r->>'welcome_awarded')::int = 0, 'a run under the minimum score does not count');
  r := pg_temp.run(sh, 'trex_runner', 20, 320);
  PERFORM pg_temp.expect((r->>'welcome_awarded')::int = 5, 'once every game has a real run the bonus is paid');
END $$;

-- ---------------------------------------------------------------------
-- 6. Munch-Man: play as often as you like
-- ---------------------------------------------------------------------
DO $$
DECLARE r jsonb;
  w constant text := 'a0000000-0000-0000-0000-000000000004';
BEGIN
  PERFORM pg_temp.as_user(w);
  r := public.start_munchman_session();
  PERFORM pg_temp.expect((r->>'success')::boolean, 'a first play today starts');
  r := public.start_munchman_session();
  PERFORM pg_temp.expect((r->>'success')::boolean, 'a second play today starts too');
  r := public.start_munchman_session();
  PERFORM pg_temp.expect((r->>'success')::boolean, 'and a third');
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.expect_error($q$SELECT public.start_munchman_session()$q$, 'User must be logged in to play.');
END $$;

-- ---------------------------------------------------------------------
-- 7. The status screen, the guest view and the admin settings
-- ---------------------------------------------------------------------
DO $$
DECLARE r jsonb;
  n constant text := 'a0000000-0000-0000-0000-000000000001';
  adm constant text := 'a0000000-0000-0000-0000-00000000000a';
BEGIN
  PERFORM pg_temp.as_user('');
  r := public.arcade_contest_status();
  PERFORM pg_temp.expect((r->'goal'->>'goal_score')::int = 1000 AND (r->'goal'->>'goal_points')::int = 3 AND (r->'goal'->>'week_score')::int = 0, 'guests see the month-1 ladder with nothing earned');
  PERFORM pg_temp.as_user(n);
  r := public.arcade_contest_status();
  PERFORM pg_temp.expect((r->'goal'->>'coins_this_week')::int = 15 AND (r->'goal'->>'done')::boolean, 'a player sees their own coins this week');

  PERFORM pg_temp.expect_error($q$SELECT public.admin_get_game_coin_settings()$q$, 'permission denied');
  PERFORM pg_temp.expect_error($q$SELECT public.admin_set_game_coin_settings('{"ladder_m1_step_coins": 5}'::jsonb)$q$, 'permission denied');
  PERFORM pg_temp.as_user(adm);
  PERFORM public.admin_set_game_coin_settings('{"ladder_m1_step_coins": 5, "ladder_m1_week_max": 25, "ladder_m1_total_max": 100}'::jsonb);
  PERFORM pg_temp.expect((public.admin_get_game_coin_settings()->>'ladder_m1_step_coins')::int = 5, 'the owner can change the numbers');
  PERFORM pg_temp.expect((public.admin_get_game_coin_settings()->>'ladder_m2_step_coins')::int = 2, 'numbers that are not sent stay as they were');
  PERFORM pg_temp.expect_error($q$SELECT public.admin_set_game_coin_settings('{"ladder_m1_step_xp": 0}'::jsonb)$q$, 'new row for relation "arcade_settings" violates check constraint');
END $$;

DO $$
BEGIN
  PERFORM pg_temp.expect(NOT has_function_privilege('authenticated', 'public.arcade_check_weekly_goal(uuid)', 'execute'), 'players cannot trigger the ladder for others');
  PERFORM pg_temp.expect(NOT has_function_privilege('authenticated', 'public.arcade_check_welcome(uuid)', 'execute'), 'players cannot trigger the welcome bonus for others');
  PERFORM pg_temp.expect(NOT has_function_privilege('authenticated', 'public.arcade_ladder_info(uuid)', 'execute'), 'players cannot read other players ladders');
  PERFORM pg_temp.expect(NOT has_table_privilege('authenticated', 'public.arcade_welcome_awards', 'select'), 'welcome rows are not readable from the browser');
  PERFORM pg_temp.expect(NOT has_function_privilege('anon', 'public.admin_set_game_coin_settings(jsonb)', 'execute'), 'guests cannot change the numbers');
  PERFORM pg_temp.expect(has_function_privilege('anon', 'public.arcade_contest_status()', 'execute'), 'guests can still see the status');
END $$;

DO $$ BEGIN RAISE NOTICE 'PASS: game coin ladder assertions passed'; END $$;
