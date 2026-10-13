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

INSERT INTO profiles (id, role, points, name, phone) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 0, 'Boss Owner', '0100000000'),
  ('a0000000-0000-0000-0000-000000000001', 'user', 0, 'Alice Wong', '012-345 6789'),
  ('a0000000-0000-0000-0000-000000000002', 'user', 0, 'Bob Tan', '0198887777'),
  ('a0000000-0000-0000-0000-000000000003', 'user', 0, 'Cara Lim', '0165554444'),
  ('a0000000-0000-0000-0000-000000000004', 'user', 0, 'Dan Lee', '0147776666'),
  ('a0000000-0000-0000-0000-000000000005', 'user', 0, 'Alice Sister', '+60 12-3456789'),
  ('a0000000-0000-0000-0000-000000000006', 'user', 0, 'Eve Low', NULL),
  ('a0000000-0000-0000-0000-000000000007', 'user', 0, 'Gus Munch', '0171112222'),
  ('a0000000-0000-0000-0000-000000000008', 'user', 0, 'Fay Capped', '0183334444');

-- ---------------------------------------------------------------------
-- 1. Server-side score check
-- ---------------------------------------------------------------------
DO $$
DECLARE r jsonb;
BEGIN
  r := pg_temp.run('a0000000-0000-0000-0000-000000000001', 'trex_runner', 60, 2000);
  PERFORM pg_temp.expect((r->>'verified')::boolean AND (r->>'is_best')::boolean, 'a plausible score is accepted and is a best');
  PERFORM pg_temp.expect((SELECT count(*) FROM arcade_scores WHERE user_id = 'a0000000-0000-0000-0000-000000000001') = 1, 'accepted run is recorded');
  PERFORM pg_temp.expect((r->>'points_awarded')::int = 25, 'the run that crosses the goal pays the goal bonus');
  PERFORM pg_temp.expect((SELECT points_awarded FROM game_plays WHERE user_id = 'a0000000-0000-0000-0000-000000000001') = 0, 'no per-run loyalty points any more');

  r := pg_temp.run('a0000000-0000-0000-0000-000000000002', 'trex_runner', 10, 5000);
  PERFORM pg_temp.expect(NOT (r->>'verified')::boolean, 'an impossible score for a 10 second run is rejected');
  PERFORM pg_temp.expect((SELECT count(*) FROM arcade_scores WHERE user_id = 'a0000000-0000-0000-0000-000000000002') = 0, 'rejected run is not recorded');
  PERFORM pg_temp.expect((SELECT score FROM game_plays WHERE user_id = 'a0000000-0000-0000-0000-000000000002') IS NULL, 'rejected score is not kept on the play');

  PERFORM pg_temp.as_user('a0000000-0000-0000-0000-000000000003');
  PERFORM pg_temp.expect_error($q$SELECT public.claim_trex_runner_reward(100)$q$, 'No unclaimed game session found for today.');
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.expect_error($q$SELECT public.claim_trex_runner_reward(100)$q$, 'User must be logged in');
END $$;

-- a browser cannot forge a play record
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000004', false);
INSERT INTO game_plays (user_id, game_name, played_at, reward_claimed, score, points_awarded)
VALUES ('a0000000-0000-0000-0000-000000000004', 'trex_runner', now() - interval '2 hours', true, 999999, 500);
RESET ROLE;
DO $$
DECLARE g record;
BEGIN
  SELECT * INTO g FROM game_plays WHERE user_id = 'a0000000-0000-0000-0000-000000000004' AND score IS NOT DISTINCT FROM NULL ORDER BY created_at DESC LIMIT 1;
  PERFORM pg_temp.expect(g.id IS NOT NULL, 'forged play row exists but is neutralised');
  PERFORM pg_temp.expect(g.reward_claimed = false AND g.points_awarded = 0 AND g.played_at > now() - interval '1 minute', 'forged play gets the real time, no score, not claimed');
END $$;

-- ---------------------------------------------------------------------
-- 2. Weekly goal: best per game, once a week, only for eligible accounts
-- ---------------------------------------------------------------------
DO $$
DECLARE r jsonb;
  u constant text := 'a0000000-0000-0000-0000-000000000001';
BEGIN
  -- Alice has trex 2000 this week already: goal (1000) reached on the first run above
  PERFORM pg_temp.expect(pg_temp.pts(u) = 25, 'weekly goal paid once (25 points) on reaching 1,000');
  r := pg_temp.run(u, 'speed_grab', 30, 900);
  PERFORM pg_temp.expect((r->>'points_awarded')::int = 0 AND pg_temp.pts(u) = 25, 'goal is not paid twice in one week');
  PERFORM pg_temp.expect((r->>'week_score')::int = 2900, 'week score is the best of each game added together');
  r := pg_temp.run(u, 'trex_runner', 60, 1500);
  PERFORM pg_temp.expect((r->>'week_score')::int = 2900 AND NOT (r->>'is_best')::boolean, 'a lower run does not change the best');
END $$;

-- an old account with no collected order cannot cash the goal until it has one
UPDATE profiles SET created_at = now() - interval '90 days' WHERE id = 'a0000000-0000-0000-0000-000000000002';
DO $$
DECLARE r jsonb;
  u constant text := 'a0000000-0000-0000-0000-000000000002';
BEGIN
  r := pg_temp.run(u, 'trex_runner', 60, 1200);
  PERFORM pg_temp.expect((r->>'points_awarded')::int = 0 AND pg_temp.pts(u) = 0, 'old account without a purchase gets no goal bonus');
  INSERT INTO orders (id, user_id, status, total) VALUES ('O-1', u::uuid, 'COLLECTED', 2000);
  r := pg_temp.run(u, 'trex_runner', 60, 1300);
  PERFORM pg_temp.expect((r->>'points_awarded')::int = 25 AND pg_temp.pts(u) = 25, 'after a collected order the goal bonus is paid');
END $$;

-- ---------------------------------------------------------------------
-- 2b. Munch-Man counts too, and the goal bonus is not blocked by the weekly cap
-- ---------------------------------------------------------------------
CREATE FUNCTION pg_temp.munch(p_user text, p_secs numeric, p_score integer) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO game_plays (user_id, game_name, played_at) VALUES (p_user::uuid, 'munch_man', now() - make_interval(secs => p_secs));
  PERFORM pg_temp.as_user(p_user);
  RETURN public.record_munchman_score(p_score);
END $$;
DO $$
DECLARE r jsonb;
  g constant text := 'a0000000-0000-0000-0000-000000000007';
  f constant text := 'a0000000-0000-0000-0000-000000000008';
BEGIN
  r := pg_temp.munch(g, 90, 1800);
  PERFORM pg_temp.expect((r->>'verified')::boolean, 'a plausible Munch-Man score is accepted');
  PERFORM pg_temp.expect((SELECT count(*) FROM arcade_scores WHERE user_id = g::uuid AND game = 'munch_man') = 1, 'Munch-Man run is recorded as Arcade Score');
  PERFORM pg_temp.expect((SELECT reward_claimed FROM game_plays WHERE user_id = g::uuid AND game_name = 'munch_man') = false, 'Munch-Man win/streak flow is left untouched');
  INSERT INTO game_plays (user_id, game_name, played_at) VALUES (f::uuid, 'munch_man', now() - interval '20 seconds');
  PERFORM pg_temp.as_user(f);
  r := public.record_munchman_score(5500);
  PERFORM pg_temp.expect(NOT (r->>'verified')::boolean, 'an impossible Munch-Man score for 20 seconds is rejected');
  DELETE FROM game_plays WHERE user_id = f::uuid;

  -- Fay has already used up the 150-a-week game points; the goal bonus still pays
  INSERT INTO engagement_points_log (user_id, source, points) VALUES (f::uuid, 'munchman_win', 150);
  r := pg_temp.run(f, 'trex_runner', 60, 700);
  PERFORM pg_temp.expect((r->>'points_awarded')::int = 0, 'below the goal: nothing yet');
  r := pg_temp.munch(f, 90, 400);
  PERFORM pg_temp.expect((r->>'week_score')::int = 1100 AND (r->>'points_awarded')::int = 25 AND pg_temp.pts(f) = 25, 'three games add up to the goal and it pays even with the weekly cap used');
END $$;

-- ---------------------------------------------------------------------
-- 3. Contest: ranking, ties, minimum score, one account per phone
-- ---------------------------------------------------------------------
-- fresh data for the contest, with exact times
DELETE FROM arcade_scores;
DELETE FROM arcade_goal_awards;
INSERT INTO arcade_scores (user_id, game, score, run_seconds, scored_at) VALUES
  -- Alice: trex 800 (early) + grab 500 = 1300
  ('a0000000-0000-0000-0000-000000000001', 'trex_runner', 800, 60, now() - interval '30 hours'),
  ('a0000000-0000-0000-0000-000000000001', 'trex_runner', 300, 60, now() - interval '20 hours'),
  ('a0000000-0000-0000-0000-000000000001', 'speed_grab', 500, 30, now() - interval '25 hours'),
  -- Bob: trex 1300 only  (ties Alice at 1300, but reached later)
  ('a0000000-0000-0000-0000-000000000002', 'trex_runner', 1300, 60, now() - interval '5 hours'),
  -- Cara: 900 + 600 = 1500 (wins)
  ('a0000000-0000-0000-0000-000000000003', 'trex_runner', 900, 60, now() - interval '3 hours'),
  ('a0000000-0000-0000-0000-000000000003', 'speed_grab', 600, 30, now() - interval '2 hours'),
  -- Dan: 250 total (under the 300 minimum)
  ('a0000000-0000-0000-0000-000000000004', 'trex_runner', 250, 30, now() - interval '1 hour'),
  -- Alice's sister shares her phone number and scores more: only the better one counts
  ('a0000000-0000-0000-0000-000000000005', 'trex_runner', 1250, 60, now() - interval '6 hours'),
  -- Eve has no phone
  ('a0000000-0000-0000-0000-000000000006', 'trex_runner', 400, 60, now() - interval '1 hour'),
  -- Gus plays only Munch-Man: it still counts
  ('a0000000-0000-0000-0000-000000000007', 'munch_man', 350, 90, now() - interval '4 hours'),
  -- an old score outside the period
  ('a0000000-0000-0000-0000-000000000003', 'trex_runner', 5000, 100, now() - interval '10 days');

DO $$
DECLARE
  cid uuid;
  rk record;
  ids text := '';
  r jsonb;
BEGIN
  PERFORM pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
  cid := public.admin_save_arcade_contest(NULL, 'Fortnight 1', now() - interval '3 days', now() + interval '2 days', true, 300, 14,
    '[{"rank":1,"prize_name":"Free burger"},{"rank":2,"prize_name":"Free fries"},{"rank":3,"prize_name":"Free drink"}]'::jsonb);

  FOR rk IN SELECT * FROM public.arcade_contest_ranking(cid, true) ORDER BY rnk LOOP
    ids := ids || right(rk.user_id::text, 1) || ':' || rk.total || ' ';
  END LOOP;
  -- Cara 1500, then the tie at 1300 goes to Alice (reached her total at -20h vs Bob -5h)... Alice's sister (1250)
  -- shares Alice's phone so is removed, Eve 400; Dan under minimum; Cara's old 5000 is outside the period.
  PERFORM pg_temp.expect(ids = '3:1500 1:1300 2:1300 6:400 7:350 ', 'ranking: ' || ids);
  PERFORM pg_temp.expect((SELECT munch FROM public.arcade_contest_ranking(cid, true) WHERE user_id = 'a0000000-0000-0000-0000-000000000007') = 350, 'Munch-Man score is part of the total');
  -- Bob and Alice tie on 1300; Alice's best scores were reached at -20h/-25h -> latest -20h; Bob at -5h
  PERFORM pg_temp.expect((SELECT user_id FROM public.arcade_contest_ranking(cid, true) WHERE rnk = 2) = 'a0000000-0000-0000-0000-000000000001', 'tie goes to the earlier total');

  -- overlap is refused; a second contest after it is fine
  PERFORM pg_temp.expect_error(format($q$SELECT public.admin_save_arcade_contest(NULL, 'Clash', now(), now() + interval '1 day', true, 300, 14, '[]'::jsonb)$q$), 'That overlaps another active contest');
  PERFORM public.admin_save_arcade_contest(NULL, 'Fortnight 2', now() + interval '2 days', now() + interval '16 days', true, 300, 14,
    '[{"rank":1,"prize_name":"Solero"}]'::jsonb);

  -- a normal user cannot manage contests or see the admin view
  PERFORM pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.expect_error($q$SELECT public.admin_arcade_overview()$q$, 'permission denied');
  PERFORM pg_temp.expect_error($q$SELECT public.admin_save_arcade_contest(NULL, 'x', now(), now() + interval '1 day', true, 1, 1, '[]'::jsonb)$q$, 'permission denied');

  -- what Alice sees now: her rank, no one else's name, the current prizes
  r := public.arcade_contest_status();
  PERFORM pg_temp.expect((r->'current'->>'title') = 'Fortnight 1', 'current contest shown');
  PERFORM pg_temp.expect((r->'my'->>'rank')::int = 2 AND (r->'my'->>'total')::int = 1300, 'my rank and total');
  PERFORM pg_temp.expect((r->'my'->>'gap_to_podium')::int = 0, 'on the podium: no gap');
  PERFORM pg_temp.expect(jsonb_array_length(r->'current'->'prizes') = 3, 'three prizes listed');
  PERFORM pg_temp.expect(r->'next'->>'title' = 'Fortnight 2', 'next contest shown');
  PERFORM pg_temp.expect(NOT (r::text ILIKE '%Cara%'), 'no other player is named while a contest is running');
  -- a guest still gets the contest, but no personal data
  PERFORM pg_temp.as_user('');
  r := public.arcade_contest_status();
  PERFORM pg_temp.expect(r->'my' IS NULL OR jsonb_typeof(r->'my') = 'null', 'guest has no personal rank');

  -- admin view: full names, phones and a duplicate-phone flag
  PERFORM pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
  r := public.admin_arcade_overview();
  PERFORM pg_temp.expect((r->'leaders'->0->>'name') = 'Cara Lim' AND (r->'leaders'->0->>'phone') = '0165554444', 'admin sees full name and phone');
  PERFORM pg_temp.expect((SELECT max((x->>'same_phone_accounts')::int) FROM jsonb_array_elements(r->'leaders') x) = 2, 'admin sees the shared phone number');

  -- end the first contest and let the app notice
  UPDATE arcade_contests SET ends_at = now() - interval '1 minute', starts_at = now() - interval '3 days' WHERE id = cid;
  PERFORM pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
  r := public.arcade_contest_status();
  PERFORM pg_temp.expect((SELECT count(*) FROM arcade_contest_winners WHERE contest_id = cid) = 3, 'three winners picked automatically');
  PERFORM pg_temp.expect((r->'last'->'winners'->0->>'first_name') = 'Cara' AND (r->'last'->'winners'->1->>'first_name') = 'Alice', 'public winners are first names, in order');
  PERFORM pg_temp.expect(NOT (r::text ILIKE '%Cara Lim%') AND NOT (r::text ILIKE '%016555%'), 'no full name or phone leaks to players');
  PERFORM pg_temp.expect(jsonb_array_length(r->'my_wins') = 1 AND (r->'my_wins'->0->>'prize') = 'Free fries', 'Alice sees her own claim (2nd: fries)');
  PERFORM pg_temp.expect((r->'my_wins'->0->>'claim_code') = (SELECT claim_code FROM arcade_contest_winners WHERE contest_id = cid AND rank = 2), 'her claim code is her own');
  PERFORM pg_temp.expect((SELECT count(DISTINCT claim_code) FROM arcade_contest_winners WHERE contest_id = cid) = 3, 'claim codes are unique');

  -- Dan, who did not place, sees no wins
  PERFORM pg_temp.as_user('a0000000-0000-0000-0000-000000000004');
  PERFORM pg_temp.expect(jsonb_array_length(public.arcade_contest_status()->'my_wins') = 0, 'non-winners see no claim codes');

  -- a finished contest is locked, claims are marked once
  PERFORM pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
  PERFORM pg_temp.expect_error(format($q$SELECT public.admin_save_arcade_contest(%L, 'Edit', now(), now() + interval '1 day', true, 1, 1, '[]'::jsonb)$q$, cid), 'That contest has finished');
  PERFORM pg_temp.expect_error(format($q$SELECT public.admin_delete_arcade_contest(%L)$q$, cid), 'A finished contest cannot be deleted');
  PERFORM public.admin_mark_arcade_claimed(cid, 1);
  PERFORM pg_temp.expect((SELECT status FROM arcade_contest_winners WHERE contest_id = cid AND rank = 1) = 'CLAIMED', 'claim marked');
  PERFORM pg_temp.expect_error(format($q$SELECT public.admin_mark_arcade_claimed(%L, 1)$q$, cid), 'That prize is not waiting to be claimed');

  -- the weekly goal can be changed by the owner only
  PERFORM public.admin_set_arcade_goal(1500, 30);
  PERFORM pg_temp.expect((SELECT goal_score FROM arcade_settings) = 1500 AND (SELECT goal_points FROM arcade_settings) = 30, 'owner can change the goal');
  PERFORM pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.expect_error($q$SELECT public.admin_set_arcade_goal(10, 10)$q$, 'permission denied');
END $$;

-- ---------------------------------------------------------------------
-- 4. Privileges
-- ---------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.expect(NOT has_table_privilege('authenticated', 'public.arcade_scores', 'select'), 'players cannot read all scores');
  PERFORM pg_temp.expect(NOT has_table_privilege('authenticated', 'public.arcade_scores', 'insert'), 'players cannot write scores');
  PERFORM pg_temp.expect(NOT has_table_privilege('authenticated', 'public.arcade_contest_winners', 'select'), 'players cannot read claim codes');
  PERFORM pg_temp.expect(NOT has_function_privilege('authenticated', 'public.arcade_record_score(text, integer)', 'execute'), 'scoring goes through the claim functions only');
  PERFORM pg_temp.expect(has_function_privilege('authenticated', 'public.record_munchman_score(integer)', 'execute') AND NOT has_function_privilege('anon', 'public.record_munchman_score(integer)', 'execute'), 'players, not guests, can record a Munch-Man score');
  PERFORM pg_temp.expect(NOT has_function_privilege('authenticated', 'public.arcade_check_weekly_goal(uuid)', 'execute'), 'players cannot trigger the goal for others');
  PERFORM pg_temp.expect(NOT has_function_privilege('authenticated', 'public.finalize_arcade_contests()', 'execute'), 'players cannot finalize');
  PERFORM pg_temp.expect(NOT has_function_privilege('authenticated', 'public.arcade_contest_ranking(uuid, boolean)', 'execute'), 'players cannot read the raw ranking');
  PERFORM pg_temp.expect(has_function_privilege('anon', 'public.arcade_contest_status()', 'execute'), 'guests can see the contest');
  PERFORM pg_temp.expect(NOT has_function_privilege('anon', 'public.admin_arcade_overview()', 'execute'), 'guests cannot call the admin view');
  PERFORM pg_temp.expect(has_function_privilege('authenticated', 'public.claim_trex_runner_reward(integer)', 'execute'), 'players can submit a T-Rex score');
  PERFORM pg_temp.expect(NOT has_function_privilege('anon', 'public.claim_speed_grab_reward(integer)', 'execute'), 'guests cannot submit scores');
END $$;

DO $$ BEGIN RAISE NOTICE 'PASS: arcade contest assertions passed'; END $$;

ROLLBACK;
