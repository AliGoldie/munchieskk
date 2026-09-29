-- Owner's call after reviewing the combined loyalty economics: the free,
-- no-spend-required engagement channels (arcade games, Munch-Man's daily
-- streak bonus, Munch-Man's win bonus) had no ceiling relative to EACH
-- OTHER -- each had its own daily cap, but a user hitting all of them every
-- day could earn ~930 pts/week from pure engagement alone, enough for a
-- full prize redemption in under a week without ever placing an order.
-- That dwarfs the RM1=1pt order-based model this loyalty program is
-- actually meant to reward.
--
-- Two changes:
-- 1. Arcade daily cap per game: 30 -> 20 (T-Rex Runner, Speed Grab).
-- 2. A new shared weekly ceiling of 150 points across ALL FOUR free
--    channels combined (arcade x2 + Munch-Man streak + Munch-Man win),
--    via a rolling 7-day window, so no combination of engagement alone
--    can out-earn a real order. Sized so an active, spend-free user nets
--    roughly 1-2 prize redemptions a month from engagement, not weekly.
--
-- Deliberately excluded from this shared cap: the RM1=1pt order points
-- (tied to real revenue), the referral bonus (tied to a real converted
-- referral, already capped at 5 lifetime), and claim_share_bonus (tied to
-- one real COLLECTED order per claim, per the 20260923100000 migration --
-- already proportional to real business activity, not free farming).

CREATE TABLE IF NOT EXISTS public.engagement_points_log (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('arcade_trex', 'arcade_speed_grab', 'munchman_streak', 'munchman_win')),
  points integer NOT NULL,
  awarded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagement_points_log_user_window
  ON public.engagement_points_log (user_id, awarded_at);

ALTER TABLE public.engagement_points_log ENABLE ROW LEVEL SECURITY;

-- Read-only for the owning user (e.g. a future "how I earned this" view).
-- No insert/update/delete policy for anyone -- only the SECURITY DEFINER
-- helper below (running as the table owner) ever writes to this table.
DROP POLICY IF EXISTS "Users can read own engagement points log" ON public.engagement_points_log;
CREATE POLICY "Users can read own engagement points log" ON public.engagement_points_log
  FOR SELECT USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON public.engagement_points_log FROM anon, authenticated;

-- Shared gate every free-engagement award goes through. Locks the user's
-- own profile row first (serializing this against every other call this
-- migration wires through it, including a different source claimed at the
-- same instant), sums the last 7 days of engagement_points_log, and pays
-- out only what's left of the weekly budget -- silently clamping to 0 once
-- it's spent, never raising, so the underlying gameplay/streak logic in the
-- caller always completes normally.
CREATE OR REPLACE FUNCTION public.award_engagement_points(
  p_user_id uuid,
  p_source text,
  p_desired_points integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_weekly_cap constant integer := 150;
  v_used_this_week integer := 0;
  v_award integer := 0;
BEGIN
  IF p_desired_points <= 0 THEN
    RETURN 0;
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;

  SELECT COALESCE(SUM(points), 0) INTO v_used_this_week
  FROM public.engagement_points_log
  WHERE user_id = p_user_id
    AND awarded_at >= now() - interval '7 days';

  v_award := GREATEST(0, LEAST(p_desired_points, v_weekly_cap - v_used_this_week));

  IF v_award > 0 THEN
    INSERT INTO public.engagement_points_log (user_id, source, points)
    VALUES (p_user_id, p_source, v_award);

    UPDATE public.profiles
    SET points = COALESCE(points, 0) + v_award
    WHERE id = p_user_id;
  END IF;

  RETURN v_award;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.award_engagement_points(uuid, text, integer) FROM PUBLIC;
-- Internal helper only, called from other SECURITY DEFINER functions
-- (all owned by postgres) -- never meant to be called directly by a client.

-- --- T-Rex Runner: daily sub-cap 30 -> 20, payout now routed through the
-- shared weekly ceiling. ---
CREATE OR REPLACE FUNCTION public.claim_trex_runner_reward(p_score integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_play_id uuid;
  v_previous_best integer;
  v_raw_award integer := 0;
  v_daily_clamped integer := 0;
  v_points_awarded integer := 0;
  v_today_points integer := 0;
  v_new_total integer := 0;
  v_msg text := '';
  v_is_best boolean := false;
  v_daily_cap constant integer := 20;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be logged in to claim rewards.';
  END IF;

  IF p_score IS NULL OR p_score < 0 THEN
    RAISE EXCEPTION 'Invalid score.';
  END IF;

  SELECT id INTO v_play_id
  FROM public.game_plays
  WHERE user_id = v_user_id
    AND game_name = 'trex_runner'
    AND (played_at AT TIME ZONE 'UTC')::date = CURRENT_DATE
    AND reward_claimed = false
  ORDER BY played_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_play_id IS NULL THEN
    RAISE EXCEPTION 'No unclaimed game session found for today.';
  END IF;

  SELECT COALESCE(MAX(score), 0) INTO v_previous_best
  FROM public.game_plays
  WHERE user_id = v_user_id AND game_name = 'trex_runner' AND score IS NOT NULL;

  SELECT COALESCE(SUM(points_awarded), 0) INTO v_today_points
  FROM public.game_plays
  WHERE user_id = v_user_id
    AND game_name = 'trex_runner'
    AND (played_at AT TIME ZONE 'UTC')::date = CURRENT_DATE;

  IF p_score > v_previous_best THEN
    v_is_best := true;
    v_raw_award := LEAST(p_score - v_previous_best, 40);
    v_daily_clamped := GREATEST(0, LEAST(v_raw_award, v_daily_cap - v_today_points));
    v_points_awarded := public.award_engagement_points(v_user_id, 'arcade_trex', v_daily_clamped);
    IF v_points_awarded > 0 THEN
      v_msg := format('+%s Loyalty Points Earned for a New Best!', v_points_awarded);
    ELSE
      v_msg := 'New best! Points earning limit reached for now -- come back later for more.';
    END IF;
  ELSE
    v_msg := 'Beat your best score to earn points!';
  END IF;

  UPDATE public.game_plays
  SET reward_claimed = true, score = p_score, points_awarded = v_points_awarded
  WHERE id = v_play_id;

  SELECT COALESCE(points, 0) INTO v_new_total FROM public.profiles WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'points_awarded', v_points_awarded,
    'total_points', v_new_total,
    'message', v_msg,
    'is_best', v_is_best,
    'previous_best', v_previous_best
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_trex_runner_reward(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_trex_runner_reward(integer) TO authenticated;

-- --- Speed Grab: same change. ---
CREATE OR REPLACE FUNCTION public.claim_speed_grab_reward(p_score integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_play_id uuid;
  v_previous_best integer;
  v_raw_award integer := 0;
  v_daily_clamped integer := 0;
  v_points_awarded integer := 0;
  v_today_points integer := 0;
  v_new_total integer := 0;
  v_msg text := '';
  v_is_best boolean := false;
  v_daily_cap constant integer := 20;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be logged in to claim rewards.';
  END IF;

  IF p_score IS NULL OR p_score < 0 THEN
    RAISE EXCEPTION 'Invalid score.';
  END IF;

  SELECT id INTO v_play_id
  FROM public.game_plays
  WHERE user_id = v_user_id
    AND game_name = 'speed_grab'
    AND (played_at AT TIME ZONE 'UTC')::date = CURRENT_DATE
    AND reward_claimed = false
  ORDER BY played_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_play_id IS NULL THEN
    RAISE EXCEPTION 'No unclaimed game session found for today.';
  END IF;

  SELECT COALESCE(MAX(score), 0) INTO v_previous_best
  FROM public.game_plays
  WHERE user_id = v_user_id AND game_name = 'speed_grab' AND score IS NOT NULL;

  SELECT COALESCE(SUM(points_awarded), 0) INTO v_today_points
  FROM public.game_plays
  WHERE user_id = v_user_id
    AND game_name = 'speed_grab'
    AND (played_at AT TIME ZONE 'UTC')::date = CURRENT_DATE;

  IF p_score > v_previous_best THEN
    v_is_best := true;
    v_raw_award := LEAST(p_score - v_previous_best, 40);
    v_daily_clamped := GREATEST(0, LEAST(v_raw_award, v_daily_cap - v_today_points));
    v_points_awarded := public.award_engagement_points(v_user_id, 'arcade_speed_grab', v_daily_clamped);
    IF v_points_awarded > 0 THEN
      v_msg := format('+%s Loyalty Points Earned for a New Best!', v_points_awarded);
    ELSE
      v_msg := 'New best! Points earning limit reached for now -- come back later for more.';
    END IF;
  ELSE
    v_msg := 'Beat your best score to earn points!';
  END IF;

  UPDATE public.game_plays
  SET reward_claimed = true, score = p_score, points_awarded = v_points_awarded
  WHERE id = v_play_id;

  SELECT COALESCE(points, 0) INTO v_new_total FROM public.profiles WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'points_awarded', v_points_awarded,
    'total_points', v_new_total,
    'message', v_msg,
    'is_best', v_is_best,
    'previous_best', v_previous_best
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_speed_grab_reward(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_speed_grab_reward(integer) TO authenticated;

-- --- Munch-Man streak bonus: payout now routed through the shared weekly
-- ceiling. Streak/last_game_date tracking is untouched and still updates
-- every day regardless of whether the weekly points budget is spent. ---
CREATE OR REPLACE FUNCTION public.start_munchman_session()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_played_today BOOLEAN;
  v_last_date DATE;
  v_current_streak INT;
  v_new_streak INT;
  v_raw_bonus INT := 0;
  v_bonus_points INT := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be logged in to play.';
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM public.game_plays
    WHERE user_id = v_user_id
      AND game_name = 'munch_man'
      AND (played_at AT TIME ZONE 'UTC')::DATE = CURRENT_DATE
  ) INTO v_played_today;

  IF v_played_today THEN
    RAISE EXCEPTION 'You have already used your free play today!';
  END IF;

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

  IF v_new_streak = 3 THEN
    v_raw_bonus := 30;
  ELSIF v_new_streak = 7 THEN
    v_raw_bonus := 100;
  END IF;

  v_bonus_points := public.award_engagement_points(v_user_id, 'munchman_streak', v_raw_bonus);

  UPDATE public.profiles
  SET
    game_streak = v_new_streak,
    last_game_date = CURRENT_DATE
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'streak', v_new_streak,
    'bonus_points', v_bonus_points
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.start_munchman_session() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_munchman_session() TO authenticated;

-- --- Munch-Man win/progress bonus: payout now routed through the shared
-- weekly ceiling. The unclaimed-session lock (once per day, per the
-- 20260826000005 migration) is unchanged. ---
CREATE OR REPLACE FUNCTION public.claim_munchman_reward(p_won boolean, p_dots_eaten integer, p_total_dots integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID;
  v_raw_award INT := 0;
  v_points_awarded INT := 0;
  v_new_total INT := 0;
  v_msg TEXT := '';
  v_play_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be logged in to claim rewards.';
  END IF;

  SELECT id INTO v_play_id
  FROM public.game_plays
  WHERE user_id = v_user_id
    AND game_name = 'munch_man'
    AND (played_at AT TIME ZONE 'UTC')::DATE = CURRENT_DATE
    AND reward_claimed = false
  ORDER BY played_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_play_id IS NULL THEN
    RAISE EXCEPTION 'No unclaimed game session found for today.';
  END IF;

  UPDATE public.game_plays SET reward_claimed = true WHERE id = v_play_id;

  IF p_won THEN
    v_raw_award := 50;
  ELSIF p_total_dots > 0 AND (p_dots_eaten::FLOAT / p_total_dots::FLOAT) >= 0.5 THEN
    v_raw_award := 20;
  END IF;

  v_points_awarded := public.award_engagement_points(v_user_id, 'munchman_win', v_raw_award);

  IF v_raw_award = 0 THEN
    v_msg := 'No reward points earned this round.';
  ELSIF v_points_awarded > 0 AND p_won THEN
    v_msg := format('+%s Loyalty Points Earned for Victory!', v_points_awarded);
  ELSIF v_points_awarded > 0 THEN
    v_msg := format('+%s Loyalty Points Earned for Progress!', v_points_awarded);
  ELSE
    v_msg := 'Points earning limit reached for now -- come back later for more.';
  END IF;

  SELECT COALESCE(points, 0) INTO v_new_total FROM public.profiles WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'points_awarded', v_points_awarded,
    'total_points', v_new_total,
    'message', v_msg
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_munchman_reward(boolean, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_munchman_reward(boolean, integer, integer) TO authenticated;
