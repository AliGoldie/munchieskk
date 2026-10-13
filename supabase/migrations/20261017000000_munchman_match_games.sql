-- Munch-Man now matches T-Rex Runner and Speed Grab: no loyalty points for a
-- win, for progress or for a daily streak. Its score counts toward the Arcade
-- Score instead (weekly goal and the monthly contest; see
-- 20261016000000_arcade_contests.sql). The daily streak counter stays as a
-- badge only.
-- Safe to re-run. Run after 20261016000000_arcade_contests.sql.

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

  IF EXISTS (
    SELECT 1 FROM public.game_plays
    WHERE user_id = v_user_id
      AND game_name = 'munch_man'
      AND (played_at AT TIME ZONE 'UTC')::DATE = CURRENT_DATE
  ) THEN
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

-- Kept so an older cached copy of the app does not error: it pays nothing.
CREATE OR REPLACE FUNCTION public.claim_munchman_reward(p_won boolean, p_dots_eaten integer, p_total_dots integer)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'points_awarded', 0,
    'total_points', COALESCE((SELECT points FROM public.profiles WHERE id = auth.uid()), 0),
    'message', 'Munch-Man no longer pays points. Your score counts toward your Arcade Score.'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.claim_munchman_reward(boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_munchman_reward(boolean, integer, integer) TO authenticated;
