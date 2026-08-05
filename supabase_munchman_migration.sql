-- ====================================================================
-- MUNCH-MAN ARCADE GAME & STREAK SYSTEM SUPABASE MIGRATION
-- ====================================================================

-- 1. Create game_plays tracking table
CREATE TABLE IF NOT EXISTS public.game_plays (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  game_name TEXT NOT NULL DEFAULT 'munch_man',
  played_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for fast daily play checking
CREATE INDEX IF NOT EXISTS idx_game_plays_user_game_date 
ON public.game_plays (user_id, game_name, played_at);

-- Enable RLS
ALTER TABLE public.game_plays ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can read own game plays" 
ON public.game_plays FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own game plays" 
ON public.game_plays FOR INSERT 
WITH CHECK (auth.uid() = user_id);


-- 2. Add streak tracking columns to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS game_streak INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_game_date DATE;


-- 3. RPC: Check if user can play today & get current streak
CREATE OR REPLACE FUNCTION public.check_can_play_munchman()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_played_today BOOLEAN;
  v_streak INT;
  v_last_date DATE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('can_play', true, 'played_today', false, 'streak', 0);
  END IF;

  -- Check if played today (using server DATE)
  SELECT EXISTS (
    SELECT 1 FROM public.game_plays 
    WHERE user_id = v_user_id 
      AND game_name = 'munch_man' 
      AND (played_at AT TIME ZONE 'UTC')::DATE = CURRENT_DATE
  ) INTO v_played_today;

  -- Fetch user streak
  SELECT COALESCE(game_streak, 0), last_game_date
  INTO v_streak, v_last_date
  FROM public.profiles
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'can_play', NOT v_played_today,
    'played_today', v_played_today,
    'streak', COALESCE(v_streak, 0)
  );
END;
$$;


-- 4. RPC: Start Munch-Man session, log play & update streak
CREATE OR REPLACE FUNCTION public.start_munchman_session()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;


-- 5. RPC: Claim Munch-Man game reward (secure server-side computation)
CREATE OR REPLACE FUNCTION public.claim_munchman_reward(
  p_won BOOLEAN,
  p_dots_eaten INT,
  p_total_dots INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_points_awarded INT := 0;
  v_new_total INT := 0;
  v_msg TEXT := '';
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be logged in to claim rewards.';
  END IF;

  -- Compute reward based on server rules
  IF p_won THEN
    v_points_awarded := 50;
    v_msg := '+50 Loyalty Points Earned for Victory!';
  ELSIF p_total_dots > 0 AND (p_dots_eaten::FLOAT / p_total_dots::FLOAT) >= 0.5 THEN
    v_points_awarded := 20;
    v_msg := '+20 Loyalty Points Earned for Progress!';
  ELSE
    v_points_awarded := 0;
    v_msg := 'No reward points earned this round.';
  END IF;

  -- Update user points atomically
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
    'message', v_msg
  );
END;
$$;


-- 6. (Optional) Midnight Cron Reset Job for Inactive Streaks
-- Requires pg_cron extension enabled in Supabase Dashboard (Database -> Extensions -> pg_cron)
-- SELECT cron.schedule(
--   'reset-inactive-streaks',
--   '0 0 * * *', -- At 00:00 every day UTC
--   $$ UPDATE public.profiles SET game_streak = 0 WHERE last_game_date < (CURRENT_DATE - INTERVAL '1 day'); $$
-- );
