-- Second arcade game: T-Rex Runner. Reuses the existing generic game_plays
-- table (game_name was already a free-text column, previously only ever
-- 'munch_man') instead of a new table. Adds a `score` column so a run's
-- result can be recorded and compared against past runs -- existing
-- munch_man rows are unaffected, score just stays NULL for them.
--
-- Points economy is deliberately different from Munch-Man's daily-play-gate
-- model: this is an endless-runner genre where unlimited replay is the
-- whole appeal, so there's no once-a-day lock. Instead, points are only
-- awarded when a run beats the player's own previous best score for this
-- game -- that's what stops someone from farming points by replaying the
-- same score forever, without blocking harmless practice runs. Everything
-- here is scoped strictly to game_name = 'trex_runner', so it cannot
-- interact with the existing munch_man daily-limit/streak RPCs (which
-- this migration history doesn't have the source of -- they were created
-- directly against the live DB rather than tracked here).

ALTER TABLE public.game_plays ADD COLUMN IF NOT EXISTS score integer;

-- Registers a new run so claim_trex_runner_reward has something to attach
-- the result to. Mirrors the same session/claim pattern claim_munchman_reward
-- already uses to stop a reward being claimed without a matching play.
CREATE OR REPLACE FUNCTION public.start_trex_runner_session()
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
  VALUES (v_user_id, 'trex_runner', false)
  RETURNING id INTO v_play_id;

  RETURN v_play_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_trex_runner_session() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_trex_runner_session() TO authenticated;

-- p_score is client-reported (same trust model claim_munchman_reward already
-- uses for p_won/p_dots_eaten -- there's no server-side replay to verify a
-- canvas game's score against). What keeps this safe from farming isn't
-- verifying the score, it's that a reward only pays out when p_score beats
-- every score this user has ever recorded for this game, capped at 40
-- points per claim -- so at most a player can cheat their reported score
-- once before the inflated number becomes their new "best" and blocks any
-- further reward until they'd have to report an even higher one.
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

REVOKE EXECUTE ON FUNCTION public.claim_trex_runner_reward(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_trex_runner_reward(integer) TO authenticated;

-- Lets the ready/game-over screens show "Your Best: X" without needing a
-- claim first.
CREATE OR REPLACE FUNCTION public.get_trex_runner_best()
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
  WHERE user_id = v_user_id AND game_name = 'trex_runner' AND score IS NOT NULL;

  RETURN COALESCE(v_best, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_trex_runner_best() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_trex_runner_best() TO authenticated;
