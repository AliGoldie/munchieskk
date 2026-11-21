-- Game coins: a weekly "ladder" (more Burger XP in a week, more Monsta Coins, up to a weekly
-- limit), a one-time welcome bonus for really playing all three games, and Munch-Man can be
-- played as often as a player likes (only the best score counts, so there is nothing to farm).
--
-- All the numbers live in arcade_settings, so the owner can change them without a developer:
--   First 30 days of an account ("month 1"): ladder_m1_step_coins coins for every ladder_m1_step_xp
--     Burger XP reached in the week, at most ladder_m1_week_max a week and ladder_m1_total_max in
--     total over those 30 days.
--   After that ("month 2 onward"), and only with a collected order in the last 30 days:
--     ladder_m2_step_coins per ladder_m2_step_xp, at most ladder_m2_week_max a week and
--     ladder_m2_window_max in any 30 days (counting only coins earned after the first 30 days).
--   Welcome bonus: welcome_coins, once per account, when each of the three games has a run that
--     lasted at least welcome_min_seconds (measured by the server) and reached its minimum score.
-- Safe to run twice. Run after 20261112000000_pin_nickname_search_path.sql.

-- 1. Settings --------------------------------------------------------------------------------
ALTER TABLE public.arcade_settings
  ADD COLUMN IF NOT EXISTS ladder_m1_step_xp integer NOT NULL DEFAULT 1000 CHECK (ladder_m1_step_xp > 0),
  ADD COLUMN IF NOT EXISTS ladder_m1_step_coins integer NOT NULL DEFAULT 3 CHECK (ladder_m1_step_coins > 0),
  ADD COLUMN IF NOT EXISTS ladder_m1_week_max integer NOT NULL DEFAULT 15 CHECK (ladder_m1_week_max >= 0),
  ADD COLUMN IF NOT EXISTS ladder_m1_total_max integer NOT NULL DEFAULT 60 CHECK (ladder_m1_total_max >= 0),
  ADD COLUMN IF NOT EXISTS ladder_m2_step_xp integer NOT NULL DEFAULT 1500 CHECK (ladder_m2_step_xp > 0),
  ADD COLUMN IF NOT EXISTS ladder_m2_step_coins integer NOT NULL DEFAULT 2 CHECK (ladder_m2_step_coins > 0),
  ADD COLUMN IF NOT EXISTS ladder_m2_week_max integer NOT NULL DEFAULT 10 CHECK (ladder_m2_week_max >= 0),
  ADD COLUMN IF NOT EXISTS ladder_m2_window_max integer NOT NULL DEFAULT 40 CHECK (ladder_m2_window_max >= 0),
  ADD COLUMN IF NOT EXISTS welcome_coins integer NOT NULL DEFAULT 5 CHECK (welcome_coins >= 0),
  ADD COLUMN IF NOT EXISTS welcome_min_seconds integer NOT NULL DEFAULT 15 CHECK (welcome_min_seconds >= 0),
  ADD COLUMN IF NOT EXISTS welcome_min_trex integer NOT NULL DEFAULT 300 CHECK (welcome_min_trex >= 0),
  ADD COLUMN IF NOT EXISTS welcome_min_grab integer NOT NULL DEFAULT 200 CHECK (welcome_min_grab >= 0),
  ADD COLUMN IF NOT EXISTS welcome_min_munch integer NOT NULL DEFAULT 300 CHECK (welcome_min_munch >= 0);

-- 2. One welcome bonus per account --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.arcade_welcome_awards (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  coins integer NOT NULL DEFAULT 0,
  awarded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.arcade_welcome_awards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arcade_welcome_awards FROM PUBLIC, anon, authenticated;

ALTER TABLE public.engagement_points_log DROP CONSTRAINT IF EXISTS engagement_points_log_source_check;
ALTER TABLE public.engagement_points_log ADD CONSTRAINT engagement_points_log_source_check
  CHECK (source IN ('arcade_trex', 'arcade_speed_grab', 'munchman_streak', 'munchman_win', 'arcade_goal', 'arcade_welcome'));

-- 3. Where a player stands this week (internal; also used by the status screen) ----------------------
-- A null player (a guest) gets the month-1 ladder with nothing earned.
CREATE OR REPLACE FUNCTION public.arcade_ladder_info(p_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.arcade_settings;
  v_created timestamptz;
  v_phase1 boolean := true;
  v_eligible boolean := true;
  v_step_xp integer;
  v_step_coins integer;
  v_week_max integer;
  v_steps_max integer;
  v_xp integer := 0;
  v_steps integer;
  v_paid integer := 0;
BEGIN
  SELECT * INTO s FROM public.arcade_settings WHERE id;
  IF p_uid IS NOT NULL THEN
    SELECT created_at INTO v_created FROM public.profiles WHERE id = p_uid;
    v_phase1 := COALESCE(v_created, now()) > now() - interval '30 days';
    v_eligible := v_phase1 OR public.arcade_goal_eligible(p_uid);
    v_xp := public.arcade_week_score(p_uid);
    SELECT COALESCE(points, 0) INTO v_paid FROM public.arcade_goal_awards
    WHERE user_id = p_uid AND week_start = (public.arcade_week_start() AT TIME ZONE 'Asia/Kuching')::date;
  END IF;
  IF v_phase1 THEN
    v_step_xp := s.ladder_m1_step_xp; v_step_coins := s.ladder_m1_step_coins; v_week_max := s.ladder_m1_week_max;
  ELSE
    v_step_xp := s.ladder_m2_step_xp; v_step_coins := s.ladder_m2_step_coins; v_week_max := s.ladder_m2_week_max;
  END IF;
  v_steps_max := v_week_max / v_step_coins;
  v_steps := LEAST(v_steps_max, v_xp / v_step_xp);
  RETURN jsonb_build_object(
    'phase', CASE WHEN v_phase1 THEN 1 ELSE 2 END,
    'eligible', v_eligible,
    'week_score', v_xp,
    'step_xp', v_step_xp,
    'step_coins', v_step_coins,
    'week_max', v_week_max,
    'coins_this_week', COALESCE(v_paid, 0),
    'done', v_steps >= v_steps_max,
    'goal_score', CASE WHEN v_steps >= v_steps_max THEN v_steps_max * v_step_xp ELSE (v_steps + 1) * v_step_xp END,
    'goal_points', v_step_coins,
    'welcome_done', CASE WHEN p_uid IS NULL THEN false
                         ELSE EXISTS (SELECT 1 FROM public.arcade_welcome_awards WHERE user_id = p_uid) END,
    'welcome_coins', s.welcome_coins
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.arcade_ladder_info(uuid) FROM PUBLIC, anon, authenticated;

-- 4. Pays the ladder. Returns the coins paid by this call. ------------------------------------------
CREATE OR REPLACE FUNCTION public.arcade_check_weekly_goal(p_uid uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.arcade_settings;
  v_created timestamptz;
  v_phase1 boolean;
  v_step_xp integer;
  v_step_coins integer;
  v_week_max integer;
  v_xp integer;
  v_target integer;
  v_week date := (public.arcade_week_start() AT TIME ZONE 'Asia/Kuching')::date;
  v_paid_week integer;
  v_delta integer;
  v_used integer;
  v_left integer;
BEGIN
  -- one run at a time per player, so two tabs cannot both be paid
  SELECT created_at INTO v_created FROM public.profiles WHERE id = p_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT * INTO s FROM public.arcade_settings WHERE id;

  v_phase1 := v_created > now() - interval '30 days';
  IF v_phase1 THEN
    v_step_xp := s.ladder_m1_step_xp; v_step_coins := s.ladder_m1_step_coins; v_week_max := s.ladder_m1_week_max;
  ELSE
    IF NOT public.arcade_goal_eligible(p_uid) THEN RETURN 0; END IF;
    v_step_xp := s.ladder_m2_step_xp; v_step_coins := s.ladder_m2_step_coins; v_week_max := s.ladder_m2_week_max;
  END IF;

  v_xp := public.arcade_week_score(p_uid);
  v_target := LEAST(v_week_max, (v_xp / v_step_xp) * v_step_coins);
  SELECT COALESCE(points, 0) INTO v_paid_week FROM public.arcade_goal_awards WHERE user_id = p_uid AND week_start = v_week;
  v_delta := v_target - COALESCE(v_paid_week, 0);
  IF v_delta <= 0 THEN RETURN 0; END IF;

  -- the overall limits: 60 in total over the first 30 days, then 40 in any 30 days
  IF v_phase1 THEN
    SELECT COALESCE(SUM(points), 0) INTO v_used FROM public.engagement_points_log
    WHERE user_id = p_uid AND source = 'arcade_goal' AND awarded_at < v_created + interval '30 days';
    v_left := s.ladder_m1_total_max - v_used;
  ELSE
    SELECT COALESCE(SUM(points), 0) INTO v_used FROM public.engagement_points_log
    WHERE user_id = p_uid AND source = 'arcade_goal'
      AND awarded_at >= v_created + interval '30 days' AND awarded_at > now() - interval '30 days';
    v_left := s.ladder_m2_window_max - v_used;
  END IF;
  v_delta := LEAST(v_delta, GREATEST(v_left, 0));
  IF v_delta <= 0 THEN RETURN 0; END IF;

  UPDATE public.profiles SET points = COALESCE(points, 0) + v_delta WHERE id = p_uid;
  INSERT INTO public.engagement_points_log (user_id, source, points) VALUES (p_uid, 'arcade_goal', v_delta);
  INSERT INTO public.arcade_goal_awards (user_id, week_start, points) VALUES (p_uid, v_week, v_delta)
  ON CONFLICT (user_id, week_start) DO UPDATE SET points = public.arcade_goal_awards.points + EXCLUDED.points;
  RETURN v_delta;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.arcade_check_weekly_goal(uuid) FROM PUBLIC, anon, authenticated;

-- 5. The welcome bonus. Returns the coins paid (0 if not earned yet or already paid). ----------------
CREATE OR REPLACE FUNCTION public.arcade_check_welcome(p_uid uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.arcade_settings;
  v_inserted integer;
BEGIN
  PERFORM 1 FROM public.profiles WHERE id = p_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.arcade_welcome_awards WHERE user_id = p_uid) THEN RETURN 0; END IF;
  SELECT * INTO s FROM public.arcade_settings WHERE id;
  IF s.welcome_coins <= 0 THEN RETURN 0; END IF;

  -- each game needs a real run: long enough (timed by the server) and above its minimum score
  IF NOT (
    EXISTS (SELECT 1 FROM public.arcade_scores WHERE user_id = p_uid AND game = 'trex_runner' AND run_seconds >= s.welcome_min_seconds AND score >= s.welcome_min_trex)
    AND EXISTS (SELECT 1 FROM public.arcade_scores WHERE user_id = p_uid AND game = 'speed_grab' AND run_seconds >= s.welcome_min_seconds AND score >= s.welcome_min_grab)
    AND EXISTS (SELECT 1 FROM public.arcade_scores WHERE user_id = p_uid AND game = 'munch_man' AND run_seconds >= s.welcome_min_seconds AND score >= s.welcome_min_munch)
  ) THEN
    RETURN 0;
  END IF;

  INSERT INTO public.arcade_welcome_awards (user_id, coins) VALUES (p_uid, s.welcome_coins)
  ON CONFLICT (user_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN RETURN 0; END IF;

  UPDATE public.profiles SET points = COALESCE(points, 0) + s.welcome_coins WHERE id = p_uid;
  INSERT INTO public.engagement_points_log (user_id, source, points) VALUES (p_uid, 'arcade_welcome', s.welcome_coins);
  RETURN s.welcome_coins;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.arcade_check_welcome(uuid) FROM PUBLIC, anon, authenticated;

-- 6. The score recorder pays the ladder and the welcome bonus -----------------------------------------
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
  v_welcome integer := 0;
  v_info jsonb;
  v_parts text[] := ARRAY[]::text[];
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
    v_welcome := public.arcade_check_welcome(v_uid);
  END IF;

  v_info := public.arcade_ladder_info(v_uid);
  SELECT COALESCE(points, 0) INTO v_total FROM public.profiles WHERE id = v_uid;

  IF NOT v_ok THEN
    v_msg := 'That score could not be verified, so it was not counted.';
  ELSE
    IF v_bonus > 0 THEN v_parts := v_parts || format('+%s Monsta Coins from your weekly game goal.', v_bonus); END IF;
    IF v_welcome > 0 THEN v_parts := v_parts || format('Welcome bonus! +%s Monsta Coins for trying all three games.', v_welcome); END IF;
    IF array_length(v_parts, 1) IS NOT NULL THEN
      v_msg := array_to_string(v_parts, ' ');
    ELSIF v_best THEN
      v_msg := 'New best! Counted toward your Burger XP.';
    ELSE
      v_msg := 'Counted toward your Burger XP. Beat your best to climb.';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'points_awarded', v_bonus + v_welcome,
    'welcome_awarded', v_welcome,
    'total_points', v_total,
    'message', v_msg,
    'is_best', v_best AND v_ok,
    'previous_best', v_prev,
    'verified', v_ok,
    'week_score', (v_info->>'week_score')::integer,
    'goal_score', (v_info->>'goal_score')::integer,
    'goal_points', (v_info->>'goal_points')::integer,
    'goal', v_info
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.arcade_record_score(text, integer) FROM PUBLIC, anon, authenticated;

-- 7. The status screen (contest, ladder) ---------------------------------------------------------------
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
  v_has_phone boolean := false;
  v_third integer;
  v_first integer;
  v_goal integer;
  v_goal_points integer;
  v_week integer := 0;
  v_goal_done boolean := false;
  v_goal_info jsonb;
  v_current jsonb;
  v_next jsonb;
  v_last jsonb;
  v_my jsonb;
BEGIN
  PERFORM public.finalize_arcade_contests();
  v_goal_info := public.arcade_ladder_info(v_uid);
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
                                    'ends_at', cur.ends_at, 'min_score', cur.min_score,
                                    'claim_min_order_cents', cur.claim_min_order_cents, 'prizes', v_prizes);
  END IF;

  IF nxt.id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('rank', z.rank, 'name', z.prize_name, 'image_url', z.image_url) ORDER BY z.rank), '[]'::jsonb)
    INTO v_next_prizes FROM public.arcade_contest_prizes z WHERE z.contest_id = nxt.id;
    v_next := jsonb_build_object('title', nxt.title, 'starts_at', nxt.starts_at, 'ends_at', nxt.ends_at,
                                 'claim_min_order_cents', nxt.claim_min_order_cents, 'prizes', v_next_prizes);
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
    v_has_phone := public.phone_is_usable((SELECT phone FROM public.profiles WHERE id = v_uid));
    SELECT COALESCE(jsonb_agg(jsonb_build_object('contest', k.title, 'rank', w.rank,
                                                 'prize', z.prize_name,
                                                 'claim_code', CASE WHEN v_has_phone THEN w.claim_code END,
                                                 'needs_phone', NOT v_has_phone,
                                                 'claim_min_order_cents', k.claim_min_order_cents) ORDER BY w.awarded_at DESC), '[]'::jsonb)
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
    'goal', v_goal_info);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.arcade_contest_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.arcade_contest_status() TO anon, authenticated;

-- 8. Munch-Man: play as often as you like ------------------------------------------------------------
-- The one-free-play-a-day rule existed when each win paid points. Games no longer pay per run and only
-- the best score counts, so the rule only got in the way. The daily streak still counts the first play
-- of each day.
CREATE OR REPLACE FUNCTION public.start_munchman_session()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_last_date DATE;
  v_current_streak INT;
  v_new_streak INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be logged in to play.';
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;

  INSERT INTO public.game_plays (user_id, game_name, played_at)
  VALUES (v_user_id, 'munch_man', NOW());

  SELECT last_game_date, COALESCE(game_streak, 0)
  INTO v_last_date, v_current_streak
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_last_date IS NULL OR v_last_date < (CURRENT_DATE - INTERVAL '1 day') THEN
    v_new_streak := 1;
  ELSIF v_last_date = (CURRENT_DATE - INTERVAL '1 day') THEN
    v_new_streak := v_current_streak + 1;
  ELSE
    v_new_streak := GREATEST(1, v_current_streak);
  END IF;

  UPDATE public.profiles
  SET game_streak = v_new_streak,
      last_game_date = CURRENT_DATE
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'streak', v_new_streak,
    'bonus_points', 0
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.start_munchman_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_munchman_session() TO authenticated;

-- 9. Admin: read and change the numbers --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_game_coin_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;
  RETURN (SELECT to_jsonb(s) - 'id' FROM public.arcade_settings s WHERE id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_get_game_coin_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_game_coin_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_game_coin_settings(p jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.arcade_settings;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;
  SELECT * INTO s FROM public.arcade_settings WHERE id;
  UPDATE public.arcade_settings SET
    ladder_m1_step_xp    = COALESCE((p->>'ladder_m1_step_xp')::integer, s.ladder_m1_step_xp),
    ladder_m1_step_coins = COALESCE((p->>'ladder_m1_step_coins')::integer, s.ladder_m1_step_coins),
    ladder_m1_week_max   = COALESCE((p->>'ladder_m1_week_max')::integer, s.ladder_m1_week_max),
    ladder_m1_total_max  = COALESCE((p->>'ladder_m1_total_max')::integer, s.ladder_m1_total_max),
    ladder_m2_step_xp    = COALESCE((p->>'ladder_m2_step_xp')::integer, s.ladder_m2_step_xp),
    ladder_m2_step_coins = COALESCE((p->>'ladder_m2_step_coins')::integer, s.ladder_m2_step_coins),
    ladder_m2_week_max   = COALESCE((p->>'ladder_m2_week_max')::integer, s.ladder_m2_week_max),
    ladder_m2_window_max = COALESCE((p->>'ladder_m2_window_max')::integer, s.ladder_m2_window_max),
    welcome_coins        = COALESCE((p->>'welcome_coins')::integer, s.welcome_coins),
    welcome_min_seconds  = COALESCE((p->>'welcome_min_seconds')::integer, s.welcome_min_seconds),
    welcome_min_trex     = COALESCE((p->>'welcome_min_trex')::integer, s.welcome_min_trex),
    welcome_min_grab     = COALESCE((p->>'welcome_min_grab')::integer, s.welcome_min_grab),
    welcome_min_munch    = COALESCE((p->>'welcome_min_munch')::integer, s.welcome_min_munch)
  WHERE id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_game_coin_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_game_coin_settings(jsonb) TO authenticated;
