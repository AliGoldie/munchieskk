-- Pre-launch audit found T-Rex Runner and Speed Grab have no real limit on
-- how many loyalty points a script can farm per day. Both games' economy
-- was designed around "you can replay unlimited times, but only a NEW BEST
-- score pays out" -- the idea being a human player's skill plateaus, so
-- repeat claims naturally stop earning anything. That assumption doesn't
-- hold against a scripted client: p_score is entirely client-reported (a
-- canvas/DOM game has nothing server-side to check it against), so a script
-- can call start_*_session() -> claim_*_reward(currentBest + 1) in a tight
-- loop, and since every call reports a strictly higher number than the last,
-- every single call is technically "a new best" and pays out up to 40
-- points -- unlimited, all day, every day.
--
-- This adds a real ceiling independent of the win/lose check: a per-user,
-- per-game, per-day points budget. Practice play stays unlimited (this
-- doesn't touch start_*_session, which still has no daily play cap -- that's
-- the intended, deliberate design for an endless-runner/reflex genre); once
-- today's budget is spent, further genuine new-best runs still update the
-- player's recorded best (so a human's real improvement is never lost) but
-- stop paying loyalty points until the next calendar day.
--
-- ARCADE_DAILY_POINTS_CAP (30) is a judgment call about how much
-- free-points-per-day is acceptable, not a pure engineering constant --
-- adjust it to whatever the business wants by changing the two CREATE OR
-- REPLACE bodies below and re-running them.

ALTER TABLE public.game_plays ADD COLUMN IF NOT EXISTS points_awarded integer NOT NULL DEFAULT 0;

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
  v_points_awarded integer := 0;
  v_today_points integer := 0;
  v_new_total integer := 0;
  v_msg text := '';
  v_is_best boolean := false;
  v_daily_cap constant integer := 30;
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
    v_points_awarded := GREATEST(0, LEAST(v_raw_award, v_daily_cap - v_today_points));
    IF v_points_awarded > 0 THEN
      v_msg := format('+%s Loyalty Points Earned for a New Best!', v_points_awarded);
    ELSE
      v_msg := 'New best! Daily bonus points limit reached -- come back tomorrow for more.';
    END IF;
  ELSE
    v_msg := 'Beat your best score to earn points!';
  END IF;

  UPDATE public.game_plays
  SET reward_claimed = true, score = p_score, points_awarded = v_points_awarded
  WHERE id = v_play_id;

  IF v_points_awarded > 0 THEN
    UPDATE public.profiles
    SET points = COALESCE(points, 0) + v_points_awarded
    WHERE id = v_user_id
    RETURNING points INTO v_new_total;
  ELSE
    SELECT COALESCE(points, 0) INTO v_new_total FROM public.profiles WHERE id = v_user_id;
  END IF;

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
  v_points_awarded integer := 0;
  v_today_points integer := 0;
  v_new_total integer := 0;
  v_msg text := '';
  v_is_best boolean := false;
  v_daily_cap constant integer := 30;
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
    v_points_awarded := GREATEST(0, LEAST(v_raw_award, v_daily_cap - v_today_points));
    IF v_points_awarded > 0 THEN
      v_msg := format('+%s Loyalty Points Earned for a New Best!', v_points_awarded);
    ELSE
      v_msg := 'New best! Daily bonus points limit reached -- come back tomorrow for more.';
    END IF;
  ELSE
    v_msg := 'Beat your best score to earn points!';
  END IF;

  UPDATE public.game_plays
  SET reward_claimed = true, score = p_score, points_awarded = v_points_awarded
  WHERE id = v_play_id;

  IF v_points_awarded > 0 THEN
    UPDATE public.profiles
    SET points = COALESCE(points, 0) + v_points_awarded
    WHERE id = v_user_id
    RETURNING points INTO v_new_total;
  ELSE
    SELECT COALESCE(points, 0) INTO v_new_total FROM public.profiles WHERE id = v_user_id;
  END IF;

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
