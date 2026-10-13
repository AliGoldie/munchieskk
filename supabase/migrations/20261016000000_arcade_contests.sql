-- Arcade contests, Arcade Score and the weekly goal.
--
-- Games stop paying loyalty points for every personal best. Instead:
--   * Every verified T-Rex Runner / Speed Grab / Munch-Man run is recorded as an Arcade
--     Score (never spent; only for the leaderboard and the weekly goal).
--   * Weekly goal: reach the goal score (default 1,000, the sum of your best
--     score in each game this week) for a one-off loyalty bonus (default 25).
--   * Contests: the owner sets a start, an end and up to three prizes (1st,
--     2nd, 3rd). The ranking is the sum of each game's best score inside the
--     period; ties go to whoever reached the total first; one account per
--     phone number. Winners are worked out automatically the first time anyone
--     opens the app after a contest ends, and get a claim code.
--   * Scores are checked on the server: a score that could not be reached in
--     the time the run lasted is rejected and never recorded.
--
-- Munch-Man still pays its own win and streak points; its score also counts toward Arcade Score.
-- Safe to re-run. Run after 20261015000000_points_expiry_fries_100.sql.

-- =====================================================================
-- PART 1: tables and settings
-- =====================================================================

-- Arcade points are no longer the only kind of engagement bonus.
ALTER TABLE public.engagement_points_log DROP CONSTRAINT IF EXISTS engagement_points_log_source_check;
ALTER TABLE public.engagement_points_log ADD CONSTRAINT engagement_points_log_source_check
  CHECK (source IN ('arcade_trex', 'arcade_speed_grab', 'munchman_streak', 'munchman_win', 'arcade_goal'));

-- Every verified run. Written only by the claim functions below.
CREATE TABLE IF NOT EXISTS public.arcade_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  game text NOT NULL CHECK (game IN ('trex_runner', 'speed_grab', 'munch_man')),
  score integer NOT NULL CHECK (score >= 0),
  run_seconds numeric NOT NULL,
  scored_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS arcade_scores_game_time_idx ON public.arcade_scores (game, scored_at);
CREATE INDEX IF NOT EXISTS arcade_scores_user_time_idx ON public.arcade_scores (user_id, scored_at);
ALTER TABLE public.arcade_scores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arcade_scores FROM PUBLIC, anon, authenticated;

-- One row: the weekly goal.
CREATE TABLE IF NOT EXISTS public.arcade_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  goal_score integer NOT NULL DEFAULT 1000 CHECK (goal_score > 0),
  goal_points integer NOT NULL DEFAULT 25 CHECK (goal_points >= 0)
);
INSERT INTO public.arcade_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.arcade_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arcade_settings FROM PUBLIC, anon, authenticated;

-- One weekly goal bonus per player per week (Monday start, Malaysia time).
CREATE TABLE IF NOT EXISTS public.arcade_goal_awards (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  points integer NOT NULL DEFAULT 0,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_start)
);
ALTER TABLE public.arcade_goal_awards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arcade_goal_awards FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.arcade_contests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT true,
  min_score integer NOT NULL DEFAULT 300 CHECK (min_score >= 0),
  claim_days integer NOT NULL DEFAULT 14 CHECK (claim_days > 0),
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS public.arcade_contest_prizes (
  contest_id uuid NOT NULL REFERENCES public.arcade_contests(id) ON DELETE CASCADE,
  rank smallint NOT NULL CHECK (rank BETWEEN 1 AND 3),
  prize_name text NOT NULL,
  menu_item_id text,
  image_url text,
  PRIMARY KEY (contest_id, rank)
);
CREATE TABLE IF NOT EXISTS public.arcade_contest_winners (
  contest_id uuid NOT NULL REFERENCES public.arcade_contests(id) ON DELETE CASCADE,
  rank smallint NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  first_name text,
  total_score integer NOT NULL,
  claim_code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'AWARDED' CHECK (status IN ('AWARDED', 'CLAIMED')),
  awarded_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  PRIMARY KEY (contest_id, rank)
);

ALTER TABLE public.arcade_contests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_contest_prizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_contest_winners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arcade_contests, public.arcade_contest_prizes, public.arcade_contest_winners FROM PUBLIC, anon, authenticated;

-- =====================================================================
-- PART 2: server-side score check and weekly goal helpers
-- =====================================================================

-- The most a run can plausibly score for its length. Generous on purpose: it
-- only stops obviously impossible scores, not a patient cheater.
CREATE OR REPLACE FUNCTION public.arcade_score_ceiling(p_game text, p_seconds numeric)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_game
    WHEN 'trex_runner' THEN floor(GREATEST(p_seconds, 0) * 70 + 150)::integer
    WHEN 'munch_man' THEN LEAST(6000, floor(GREATEST(p_seconds, 0) * 100 + 300))::integer
    ELSE floor(GREATEST(p_seconds, 0) * 110 + 100)::integer
  END;
$$;

-- Monday 00:00 Malaysia time of the current week.
CREATE OR REPLACE FUNCTION public.arcade_week_start()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT date_trunc('week', now() AT TIME ZONE 'Asia/Kuching') AT TIME ZONE 'Asia/Kuching';
$$;

-- This week's score: the best verified score in each game, added together.
CREATE OR REPLACE FUNCTION public.arcade_week_score(p_uid uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(b.best), 0)::integer
  FROM (
    SELECT MAX(s.score) AS best
    FROM public.arcade_scores s
    WHERE s.user_id = p_uid AND s.scored_at >= public.arcade_week_start()
    GROUP BY s.game
  ) b;
$$;

-- Same rule as game bonuses: free for the first 30 days, after that the
-- account needs at least one collected order.
CREATE OR REPLACE FUNCTION public.arcade_goal_eligible(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT created_at FROM public.profiles WHERE id = p_uid), now()) >= now() - interval '30 days'
         OR EXISTS (SELECT 1 FROM public.orders WHERE user_id = p_uid AND status = 'COLLECTED');
$$;
REVOKE EXECUTE ON FUNCTION public.arcade_goal_eligible(uuid) FROM PUBLIC, anon, authenticated;

-- Pays the weekly goal bonus once a week. Returns the loyalty points paid
-- now (0 if not reached, already paid, or the account is not eligible for
-- game bonuses yet). It is not held back by the 150-a-week game points cap,
-- so reaching the goal always pays.
CREATE OR REPLACE FUNCTION public.arcade_check_weekly_goal(p_uid uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_goal integer;
  v_bonus integer;
  v_week date := (public.arcade_week_start() AT TIME ZONE 'Asia/Kuching')::date;
  v_inserted integer;
  v_paid integer := 0;
BEGIN
  SELECT goal_score, goal_points INTO v_goal, v_bonus FROM public.arcade_settings WHERE id;
  IF v_bonus <= 0 OR public.arcade_week_score(p_uid) < v_goal THEN
    RETURN 0;
  END IF;

  INSERT INTO public.arcade_goal_awards (user_id, week_start)
  VALUES (p_uid, v_week)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN 0;
  END IF;

  IF public.arcade_goal_eligible(p_uid) THEN
    UPDATE public.profiles SET points = COALESCE(points, 0) + v_bonus WHERE id = p_uid;
    INSERT INTO public.engagement_points_log (user_id, source, points) VALUES (p_uid, 'arcade_goal', v_bonus);
    UPDATE public.arcade_goal_awards SET points = v_bonus WHERE user_id = p_uid AND week_start = v_week;
    v_paid := v_bonus;
  ELSE
    -- not eligible yet: leave it open so a later run can still earn it
    DELETE FROM public.arcade_goal_awards WHERE user_id = p_uid AND week_start = v_week;
  END IF;
  RETURN v_paid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.arcade_week_score(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.arcade_check_weekly_goal(uuid) FROM PUBLIC, anon, authenticated;

-- =====================================================================
-- PART 3: recording runs (replaces the old per-run points)
-- =====================================================================

-- A browser can never forge a play record: whatever it inserts directly gets
-- the real time and no score. (Runs are only ever scored by the functions below.)
CREATE OR REPLACE FUNCTION public.protect_game_plays_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.played_at := now();
    NEW.created_at := now();
    NEW.reward_claimed := false;
    NEW.score := NULL;
    NEW.points_awarded := 0;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_game_plays_insert ON public.game_plays;
CREATE TRIGGER trg_protect_game_plays_insert
  BEFORE INSERT ON public.game_plays
  FOR EACH ROW EXECUTE FUNCTION public.protect_game_plays_insert();

CREATE OR REPLACE FUNCTION public.arcade_record_score(p_game text, p_score integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_play_id uuid;
  v_played_at timestamptz;
  v_seconds numeric;
  v_prev integer;
  v_ok boolean;
  v_best boolean := false;
  v_bonus integer := 0;
  v_msg text;
  v_total integer;
  v_goal integer;
  v_goal_points integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'User must be logged in to claim rewards.';
  END IF;
  IF p_score IS NULL OR p_score < 0 OR p_score > 1000000 THEN
    RAISE EXCEPTION 'Invalid score.';
  END IF;

  SELECT id, played_at INTO v_play_id, v_played_at
  FROM public.game_plays
  WHERE user_id = v_uid
    AND game_name = p_game
    AND (played_at AT TIME ZONE 'UTC')::date = CURRENT_DATE
    AND ((p_game = 'munch_man' AND score IS NULL) OR (p_game <> 'munch_man' AND reward_claimed = false))
  ORDER BY played_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_play_id IS NULL THEN
    RAISE EXCEPTION 'No unclaimed game session found for today.';
  END IF;

  v_seconds := GREATEST(0, extract(epoch FROM (now() - v_played_at)));
  SELECT COALESCE(MAX(score), 0) INTO v_prev
  FROM public.game_plays
  WHERE user_id = v_uid AND game_name = p_game AND score IS NOT NULL;

  v_ok := p_score <= public.arcade_score_ceiling(p_game, v_seconds);

  -- Munch-Man keeps its own win/streak points flow, so its flags are left alone.
  UPDATE public.game_plays
  SET reward_claimed = CASE WHEN p_game = 'munch_man' THEN reward_claimed ELSE true END,
      score = CASE WHEN v_ok THEN p_score ELSE NULL END,
      points_awarded = CASE WHEN p_game = 'munch_man' THEN points_awarded ELSE 0 END
  WHERE id = v_play_id;

  IF v_ok THEN
    INSERT INTO public.arcade_scores (user_id, game, score, run_seconds)
    VALUES (v_uid, p_game, p_score, round(v_seconds, 1));
    v_best := p_score > v_prev;
    v_bonus := public.arcade_check_weekly_goal(v_uid);
  END IF;

  SELECT goal_score, goal_points INTO v_goal, v_goal_points FROM public.arcade_settings WHERE id;
  SELECT COALESCE(points, 0) INTO v_total FROM public.profiles WHERE id = v_uid;

  IF NOT v_ok THEN
    v_msg := 'That score could not be verified, so it was not counted.';
  ELSIF v_bonus > 0 THEN
    v_msg := format('Weekly goal reached! +%s loyalty points', v_bonus);
  ELSIF v_best THEN
    v_msg := 'New best! Counted toward your Arcade Score.';
  ELSE
    v_msg := 'Counted toward your Arcade Score. Beat your best to climb.';
  END IF;

  RETURN jsonb_build_object(
    'points_awarded', v_bonus,
    'total_points', v_total,
    'message', v_msg,
    'is_best', v_best AND v_ok,
    'previous_best', v_prev,
    'verified', v_ok,
    'week_score', public.arcade_week_score(v_uid),
    'goal_score', v_goal,
    'goal_points', v_goal_points
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.arcade_record_score(text, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_trex_runner_reward(p_score integer)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT public.arcade_record_score('trex_runner', p_score); $$;
REVOKE EXECUTE ON FUNCTION public.claim_trex_runner_reward(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_trex_runner_reward(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_speed_grab_reward(p_score integer)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT public.arcade_record_score('speed_grab', p_score); $$;
REVOKE EXECUTE ON FUNCTION public.claim_speed_grab_reward(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_speed_grab_reward(integer) TO authenticated;

-- Munch-Man: record the day's score (its win/streak points still go through
-- claim_munchman_reward and start_munchman_session as before).
CREATE OR REPLACE FUNCTION public.record_munchman_score(p_score integer)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT public.arcade_record_score('munch_man', p_score); $$;
REVOKE EXECUTE ON FUNCTION public.record_munchman_score(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_munchman_score(integer) TO authenticated;

-- =====================================================================
-- PART 4: contest ranking and winners
-- =====================================================================

-- Ranking for one contest (internal). p_dedupe keeps only the best account
-- per phone number; the admin view turns it off to show duplicates.
CREATE OR REPLACE FUNCTION public.arcade_contest_ranking(p_contest uuid, p_dedupe boolean DEFAULT true)
RETURNS TABLE (user_id uuid, total integer, trex integer, grab integer, munch integer, reached_at timestamptz, max_rate numeric, rnk bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH c AS (SELECT * FROM public.arcade_contests WHERE id = p_contest),
  sc AS (
    SELECT s.* FROM public.arcade_scores s, c
    WHERE s.scored_at >= c.starts_at AND s.scored_at < c.ends_at
  ),
  best AS (
    SELECT DISTINCT ON (s.user_id, s.game) s.user_id, s.game, s.score, s.scored_at
    FROM sc s
    ORDER BY s.user_id, s.game, s.score DESC, s.scored_at ASC
  ),
  tot AS (
    SELECT b.user_id,
           SUM(b.score)::integer AS total,
           SUM(CASE WHEN b.game = 'trex_runner' THEN b.score ELSE 0 END)::integer AS trex,
           SUM(CASE WHEN b.game = 'speed_grab' THEN b.score ELSE 0 END)::integer AS grab,
           SUM(CASE WHEN b.game = 'munch_man' THEN b.score ELSE 0 END)::integer AS munch,
           MAX(b.scored_at) AS reached_at
    FROM best b
    GROUP BY b.user_id
  ),
  rate AS (
    SELECT s.user_id, MAX(s.score / GREATEST(s.run_seconds, 1)) AS max_rate
    FROM sc s GROUP BY s.user_id
  ),
  elig AS (
    SELECT t.*, r.max_rate,
           regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g') AS digits
    FROM tot t
    JOIN rate r ON r.user_id = t.user_id
    JOIN public.profiles p ON p.id = t.user_id
    WHERE t.total >= (SELECT min_score FROM c)
  ),
  dd AS (
    SELECT e.*,
           ROW_NUMBER() OVER (
             PARTITION BY CASE WHEN length(e.digits) >= 9 THEN right(e.digits, 9) ELSE e.user_id::text END
             ORDER BY e.total DESC, e.reached_at ASC, e.user_id
           ) AS pr
    FROM elig e
  )
  SELECT d.user_id, d.total, d.trex, d.grab, d.munch, d.reached_at, round(d.max_rate, 1),
         ROW_NUMBER() OVER (ORDER BY d.total DESC, d.reached_at ASC, d.user_id)
  FROM dd d
  WHERE (NOT p_dedupe) OR d.pr = 1;
$$;
REVOKE EXECUTE ON FUNCTION public.arcade_contest_ranking(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- Picks winners for every finished contest (internal).
CREATE OR REPLACE FUNCTION public.finalize_arcade_contests()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c record;
  pz record;
  w record;
  v_code text;
BEGIN
  FOR c IN
    SELECT * FROM public.arcade_contests
    WHERE active AND finalized_at IS NULL AND ends_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    FOR pz IN SELECT * FROM public.arcade_contest_prizes WHERE contest_id = c.id ORDER BY rank LOOP
      SELECT rk.user_id, rk.total INTO w
      FROM public.arcade_contest_ranking(c.id, true) rk
      WHERE rk.rnk = pz.rank;
      IF FOUND THEN
        LOOP
          v_code := public.generate_unique_redemption_code();
          EXIT WHEN NOT EXISTS (SELECT 1 FROM public.arcade_contest_winners WHERE claim_code = v_code)
                AND NOT EXISTS (SELECT 1 FROM public.monthly_prizes WHERE claim_code = v_code);
        END LOOP;
        INSERT INTO public.arcade_contest_winners (contest_id, rank, user_id, first_name, total_score, claim_code)
        VALUES (c.id, pz.rank, w.user_id,
                (SELECT NULLIF(split_part(trim(both from COALESCE(p.name, '')), ' ', 1), '')
                 FROM public.profiles p WHERE p.id = w.user_id),
                w.total, v_code)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
    UPDATE public.arcade_contests SET finalized_at = now() WHERE id = c.id;
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.finalize_arcade_contests() FROM PUBLIC, anon, authenticated;

-- =====================================================================
-- PART 5: what the Arcade page shows (safe for guests)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.arcade_contest_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  cur record;
  nxt record;
  lst record;
  me record;
  v_prizes jsonb := '[]'::jsonb;
  v_next_prizes jsonb := '[]'::jsonb;
  v_last_winners jsonb := '[]'::jsonb;
  v_my_wins jsonb := '[]'::jsonb;
  v_third integer;
  v_first integer;
  v_goal integer;
  v_goal_points integer;
  v_week integer := 0;
  v_goal_done boolean := false;
  v_current jsonb;
  v_next jsonb;
  v_last jsonb;
  v_my jsonb;
BEGIN
  PERFORM public.finalize_arcade_contests();
  SELECT goal_score, goal_points INTO v_goal, v_goal_points FROM public.arcade_settings WHERE id;

  SELECT * INTO cur FROM public.arcade_contests
  WHERE active AND starts_at <= now() AND ends_at > now()
  ORDER BY ends_at LIMIT 1;
  SELECT * INTO nxt FROM public.arcade_contests
  WHERE active AND starts_at > now()
  ORDER BY starts_at LIMIT 1;
  SELECT * INTO lst FROM public.arcade_contests
  WHERE active AND finalized_at IS NOT NULL AND ends_at > now() - interval '30 days'
  ORDER BY ends_at DESC LIMIT 1;

  IF cur.id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('rank', z.rank, 'name', z.prize_name, 'image_url', z.image_url) ORDER BY z.rank), '[]'::jsonb)
    INTO v_prizes FROM public.arcade_contest_prizes z WHERE z.contest_id = cur.id;
    SELECT rk.total INTO v_first FROM public.arcade_contest_ranking(cur.id, true) rk WHERE rk.rnk = 1;
    SELECT rk.total INTO v_third FROM public.arcade_contest_ranking(cur.id, true) rk WHERE rk.rnk = 3;
    v_current := jsonb_build_object('id', cur.id, 'title', cur.title, 'starts_at', cur.starts_at,
                                    'ends_at', cur.ends_at, 'min_score', cur.min_score, 'prizes', v_prizes);
  END IF;

  IF nxt.id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('rank', z.rank, 'name', z.prize_name, 'image_url', z.image_url) ORDER BY z.rank), '[]'::jsonb)
    INTO v_next_prizes FROM public.arcade_contest_prizes z WHERE z.contest_id = nxt.id;
    v_next := jsonb_build_object('title', nxt.title, 'starts_at', nxt.starts_at, 'ends_at', nxt.ends_at, 'prizes', v_next_prizes);
  END IF;

  IF lst.id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('rank', w.rank, 'first_name', COALESCE(w.first_name, 'Player'),
                                                 'prize', z.prize_name) ORDER BY w.rank), '[]'::jsonb)
    INTO v_last_winners
    FROM public.arcade_contest_winners w
    LEFT JOIN public.arcade_contest_prizes z ON z.contest_id = w.contest_id AND z.rank = w.rank
    WHERE w.contest_id = lst.id;
    v_last := jsonb_build_object('title', lst.title, 'ended_at', lst.ends_at, 'winners', v_last_winners);
  END IF;

  IF v_uid IS NOT NULL THEN
    v_week := public.arcade_week_score(v_uid);
    v_goal_done := EXISTS (
      SELECT 1 FROM public.arcade_goal_awards
      WHERE user_id = v_uid AND week_start = (public.arcade_week_start() AT TIME ZONE 'Asia/Kuching')::date
    );
    IF cur.id IS NOT NULL THEN
      SELECT rk.rnk, rk.total, rk.trex, rk.grab, rk.munch INTO me
      FROM public.arcade_contest_ranking(cur.id, true) rk WHERE rk.user_id = v_uid;
      v_my := jsonb_build_object(
        'rank', me.rnk,
        'total', COALESCE(me.total, 0),
        'trex', COALESCE(me.trex, 0),
        'grab', COALESCE(me.grab, 0),
        'munch', COALESCE(me.munch, 0),
        'gap_to_podium', CASE WHEN me.rnk IS NOT NULL AND me.rnk <= 3 THEN 0
                              WHEN v_third IS NULL THEN GREATEST(cur.min_score - COALESCE(me.total, 0), 0)
                              ELSE GREATEST(v_third - COALESCE(me.total, 0) + 1, 0) END,
        'qualifies', COALESCE(me.total, 0) >= cur.min_score);
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('contest', k.title, 'rank', w.rank,
                                                 'prize', z.prize_name, 'claim_code', w.claim_code) ORDER BY w.awarded_at DESC), '[]'::jsonb)
    INTO v_my_wins
    FROM public.arcade_contest_winners w
    JOIN public.arcade_contests k ON k.id = w.contest_id
    LEFT JOIN public.arcade_contest_prizes z ON z.contest_id = w.contest_id AND z.rank = w.rank
    WHERE w.user_id = v_uid AND w.status = 'AWARDED'
      AND w.awarded_at > now() - make_interval(days => k.claim_days);
  END IF;

  RETURN jsonb_build_object(
    'current', v_current,
    'next', v_next,
    'last', v_last,
    'my', v_my,
    'my_wins', v_my_wins,
    'goal', jsonb_build_object('goal_score', v_goal, 'goal_points', v_goal_points,
                               'week_score', v_week, 'done', v_goal_done));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.arcade_contest_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.arcade_contest_status() TO anon, authenticated;

-- =====================================================================
-- PART 6: admin
-- =====================================================================

CREATE OR REPLACE FUNCTION public.admin_arcade_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cur record;
  v_contests jsonb;
  v_leaders jsonb := '[]'::jsonb;
  v_goal integer;
  v_goal_points integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;
  PERFORM public.finalize_arcade_contests();
  SELECT goal_score, goal_points INTO v_goal, v_goal_points FROM public.arcade_settings WHERE id;

  SELECT * INTO cur FROM public.arcade_contests
  WHERE active AND starts_at <= now() AND ends_at > now()
  ORDER BY ends_at LIMIT 1;

  IF cur.id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(x ORDER BY x.rank), '[]'::jsonb) INTO v_leaders
    FROM (
      SELECT rk.rnk AS rank, p.name, p.phone, rk.total, rk.trex, rk.grab, rk.munch, rk.max_rate,
             rk.reached_at,
             (SELECT count(*) FROM public.arcade_contest_ranking(cur.id, false) o
              JOIN public.profiles q ON q.id = o.user_id
              WHERE length(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g')) >= 9
                AND right(regexp_replace(COALESCE(q.phone, ''), '\D', '', 'g'), 9)
                  = right(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g'), 9)) AS same_phone_accounts
      FROM public.arcade_contest_ranking(cur.id, false) rk
      JOIN public.profiles p ON p.id = rk.user_id
      ORDER BY rk.rnk
      LIMIT 15
    ) x;
  END IF;

  SELECT COALESCE(jsonb_agg(y ORDER BY y.starts_at DESC), '[]'::jsonb) INTO v_contests
  FROM (
    SELECT k.id, k.title, k.starts_at, k.ends_at, k.active, k.min_score, k.claim_days, k.finalized_at,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object('rank', z.rank, 'prize_name', z.prize_name,
                    'menu_item_id', z.menu_item_id, 'image_url', z.image_url) ORDER BY z.rank), '[]'::jsonb)
            FROM public.arcade_contest_prizes z WHERE z.contest_id = k.id) AS prizes,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object('rank', w.rank, 'name', pr.name, 'phone', pr.phone,
                    'first_name', w.first_name, 'total_score', w.total_score, 'claim_code', w.claim_code,
                    'status', w.status, 'awarded_at', w.awarded_at) ORDER BY w.rank), '[]'::jsonb)
            FROM public.arcade_contest_winners w
            LEFT JOIN public.profiles pr ON pr.id = w.user_id
            WHERE w.contest_id = k.id) AS winners
    FROM public.arcade_contests k
    ORDER BY k.starts_at DESC
    LIMIT 12
  ) y;

  RETURN jsonb_build_object(
    'current_id', cur.id,
    'leaders', v_leaders,
    'contests', v_contests,
    'goal', jsonb_build_object('goal_score', v_goal, 'goal_points', v_goal_points));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_arcade_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_arcade_overview() TO authenticated;

-- Create or update a contest with its prizes. Finished contests cannot change.
CREATE OR REPLACE FUNCTION public.admin_save_arcade_contest(
  p_id uuid,
  p_title text,
  p_starts timestamptz,
  p_ends timestamptz,
  p_active boolean,
  p_min_score integer,
  p_claim_days integer,
  p_prizes jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid := p_id;
  v_old record;
  z jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;
  IF COALESCE(trim(p_title), '') = '' THEN
    RAISE EXCEPTION 'Please give the contest a title.';
  END IF;
  IF p_ends <= p_starts THEN
    RAISE EXCEPTION 'The end must be after the start.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.arcade_contests k
    WHERE k.active AND COALESCE(p_active, true) AND k.id IS DISTINCT FROM p_id
      AND k.starts_at < p_ends AND k.ends_at > p_starts
  ) THEN
    RAISE EXCEPTION 'That overlaps another active contest. Change the dates or switch the other one off.';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.arcade_contests WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Contest not found.';
    END IF;
    IF v_old.finalized_at IS NOT NULL THEN
      RAISE EXCEPTION 'That contest has finished and cannot be changed.';
    END IF;
    UPDATE public.arcade_contests
    SET title = trim(p_title), starts_at = p_starts, ends_at = p_ends,
        active = COALESCE(p_active, true), min_score = COALESCE(p_min_score, 300),
        claim_days = COALESCE(p_claim_days, 14)
    WHERE id = v_id;
    DELETE FROM public.arcade_contest_prizes WHERE contest_id = v_id;
  ELSE
    INSERT INTO public.arcade_contests (title, starts_at, ends_at, active, min_score, claim_days)
    VALUES (trim(p_title), p_starts, p_ends, COALESCE(p_active, true), COALESCE(p_min_score, 300), COALESCE(p_claim_days, 14))
    RETURNING id INTO v_id;
  END IF;

  FOR z IN SELECT * FROM jsonb_array_elements(COALESCE(p_prizes, '[]'::jsonb)) LOOP
    IF COALESCE(trim(z->>'prize_name'), '') <> '' THEN
      INSERT INTO public.arcade_contest_prizes (contest_id, rank, prize_name, menu_item_id, image_url)
      VALUES (v_id, (z->>'rank')::smallint, trim(z->>'prize_name'),
              NULLIF(z->>'menu_item_id', ''), NULLIF(z->>'image_url', ''));
    END IF;
  END LOOP;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_save_arcade_contest(uuid, text, timestamptz, timestamptz, boolean, integer, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_arcade_contest(uuid, text, timestamptz, timestamptz, boolean, integer, integer, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_arcade_contest(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;
  IF EXISTS (SELECT 1 FROM public.arcade_contests WHERE id = p_id AND finalized_at IS NOT NULL) THEN
    RAISE EXCEPTION 'A finished contest cannot be deleted.';
  END IF;
  DELETE FROM public.arcade_contests WHERE id = p_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_delete_arcade_contest(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_arcade_contest(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_mark_arcade_claimed(p_contest uuid, p_rank integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;
  UPDATE public.arcade_contest_winners
  SET status = 'CLAIMED', claimed_at = now()
  WHERE contest_id = p_contest AND rank = p_rank AND status = 'AWARDED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That prize is not waiting to be claimed.';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_mark_arcade_claimed(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_arcade_claimed(uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_arcade_goal(p_goal_score integer, p_goal_points integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;
  IF p_goal_score IS NULL OR p_goal_score <= 0 OR p_goal_points IS NULL OR p_goal_points < 0 OR p_goal_points > 200 THEN
    RAISE EXCEPTION 'Goal score must be above 0 and the bonus between 0 and 200 points.';
  END IF;
  UPDATE public.arcade_settings SET goal_score = p_goal_score, goal_points = p_goal_points WHERE id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_arcade_goal(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_arcade_goal(integer, integer) TO authenticated;
