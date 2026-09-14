-- Third arcade game: Speed Grab, a whack-a-mole style reflex game. Reuses
-- the existing generic game_plays table/score column (see the trex_runner
-- migration) rather than a new one -- everything here is scoped to
-- game_name = 'speed_grab' so it can't interact with munch_man's or
-- trex_runner's RPCs.
--
-- Same economy as trex_runner: unlimited replays per day (a reflex game's
-- whole appeal is quick repeat rounds), reward only on beating your own
-- previous best, capped per claim. That's what stops someone farming points
-- by replaying the same score forever without blocking harmless practice.

CREATE OR REPLACE FUNCTION public.start_speed_grab_session()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_play_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be logged in to start a session.';
  END IF;

  INSERT INTO public.game_plays (user_id, game_name, reward_claimed)
  VALUES (v_user_id, 'speed_grab', false)
  RETURNING id INTO v_play_id;

  RETURN v_play_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_speed_grab_session() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_speed_grab_session() TO authenticated;

-- p_score is client-reported, same trust model as claim_trex_runner_reward --
-- there's no server-side replay to verify a DOM reflex game's score against.
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
  v_points_awarded integer := 0;
  v_new_total integer := 0;
  v_msg text := '';
  v_is_best boolean := false;
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

  UPDATE public.game_plays
  SET reward_claimed = true, score = p_score
  WHERE id = v_play_id;

  IF p_score > v_previous_best THEN
    v_is_best := true;
    v_points_awarded := LEAST(p_score - v_previous_best, 40);
    v_msg := format('+%s Loyalty Points Earned for a New Best!', v_points_awarded);
  ELSE
    v_msg := 'Beat your best score to earn points!';
  END IF;

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

CREATE OR REPLACE FUNCTION public.get_speed_grab_best()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_best integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(MAX(score), 0) INTO v_best
  FROM public.game_plays
  WHERE user_id = v_user_id AND game_name = 'speed_grab' AND score IS NOT NULL;

  RETURN COALESCE(v_best, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_speed_grab_best() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_speed_grab_best() TO authenticated;
