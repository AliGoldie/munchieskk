-- start_munchman_session was live-only and never tracked in git until now
-- (recovered from the live database via pg_get_functiondef during the
-- pre-launch audit, since it predates this repo's migration history).
--
-- It has the same class of bug already fixed this audit in
-- place_order/claim_trex_runner_reward/claim_speed_grab_reward: the
-- "already played today?" check (SELECT EXISTS ...) and the streak-bonus
-- award happen with no row lock in between. Two concurrent calls for the
-- same user (trivial to script -- just fire the request twice at once) can
-- both pass the check before either commits, both insert a game_plays row,
-- and both award the 3-day/7-day streak bonus (30/100 points) -- doubling
-- it for free, repeatable every day. This does NOT affect the win/progress
-- reward in claim_munchman_reward, which already has its own FOR UPDATE
-- lock on the game_plays row via the 20260826000005 migration -- this is
-- specifically the streak-bonus path inside session start itself.
--
-- Fix: lock the caller's own profile row before checking eligibility, so a
-- second concurrent call for the same user blocks until the first
-- transaction commits, then correctly observes "already played today" and
-- raises instead of paying out a second time.

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
  v_bonus_points INT := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be logged in to play.';
  END IF;

  -- Serialize concurrent calls for the same user: a second call blocks here
  -- until the first transaction commits (or rolls back), instead of both
  -- reading "not played yet" at the same instant.
  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;

  -- Enforce 1 free play per day
  SELECT EXISTS (
    SELECT 1 FROM public.game_plays
    WHERE user_id = v_user_id
      AND game_name = 'munch_man'
      AND (played_at AT TIME ZONE 'UTC')::DATE = CURRENT_DATE
  ) INTO v_played_today;

  IF v_played_today THEN
    RAISE EXCEPTION 'You have already used your free play today!';
  END IF;

  -- Log session start in game_plays
  INSERT INTO public.game_plays (user_id, game_name, played_at)
  VALUES (v_user_id, 'munch_man', NOW());

  -- Calculate streak
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

  -- Streak rewards
  IF v_new_streak = 3 THEN
    v_bonus_points := 30; -- +30 Pts for 3-day streak
  ELSIF v_new_streak = 7 THEN
    v_bonus_points := 100; -- +100 Pts for 7-day streak
  END IF;

  -- Update profiles table
  UPDATE public.profiles
  SET
    game_streak = v_new_streak,
    last_game_date = CURRENT_DATE,
    points = COALESCE(points, 0) + v_bonus_points
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'streak', v_new_streak,
    'bonus_points', v_bonus_points
  );
END;
$function$;

-- Matches the auth posture of the sibling game RPCs (claim_munchman_reward,
-- claim_trex_runner_reward, claim_speed_grab_reward): requires a logged-in
-- caller, so anon has no legitimate use for it.
REVOKE EXECUTE ON FUNCTION public.start_munchman_session() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_munchman_session() TO authenticated;
