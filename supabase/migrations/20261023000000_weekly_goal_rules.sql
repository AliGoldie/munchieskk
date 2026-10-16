-- Weekly goal rules (Rewards Plan v2, task 2).
--
--   1. After an account's first 30 days, the weekly goal bonus needs a COLLECTED
--      order in the last 30 days (before: any collected order ever).
--      Accounts under 30 days old still qualify freely.
--   2. A monthly limit on weekly goal bonuses per account: at most
--      arcade_settings.goal_max_per_month bonuses in a calendar month
--      (Malaysia time, by the Monday the week starts). Default 4, so a month with
--      five Mondays still pays at most 4. Points limit = this number x the goal points.
--
-- Safe to run more than once. Changes no stored points.

ALTER TABLE public.arcade_settings
  ADD COLUMN IF NOT EXISTS goal_max_per_month integer NOT NULL DEFAULT 4 CHECK (goal_max_per_month >= 1);

CREATE OR REPLACE FUNCTION public.arcade_goal_eligible(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT created_at FROM public.profiles WHERE id = p_uid), now()) >= now() - interval '30 days'
         OR EXISTS (SELECT 1 FROM public.orders
                    WHERE user_id = p_uid AND status = 'COLLECTED'
                      AND created_at >= now() - interval '30 days');
$$;
REVOKE EXECUTE ON FUNCTION public.arcade_goal_eligible(uuid) FROM PUBLIC, anon, authenticated;

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
  v_cap integer;
  v_paid integer := 0;
BEGIN
  SELECT goal_score, goal_points, goal_max_per_month INTO v_goal, v_bonus, v_cap FROM public.arcade_settings WHERE id;
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

  -- Eligible (new account, or a collected order in the last 30 days) AND under
  -- the monthly limit. The week row just inserted has points = 0 and is not counted.
  IF public.arcade_goal_eligible(p_uid)
     AND (SELECT count(*) FROM public.arcade_goal_awards
          WHERE user_id = p_uid AND points > 0
            AND date_trunc('month', week_start::timestamp) = date_trunc('month', v_week::timestamp)) < v_cap THEN
    UPDATE public.profiles SET points = COALESCE(points, 0) + v_bonus WHERE id = p_uid;
    INSERT INTO public.engagement_points_log (user_id, source, points) VALUES (p_uid, 'arcade_goal', v_bonus);
    UPDATE public.arcade_goal_awards SET points = v_bonus WHERE user_id = p_uid AND week_start = v_week;
    v_paid := v_bonus;
  ELSE
    -- not eligible yet, or the monthly limit is used: leave it open
    DELETE FROM public.arcade_goal_awards WHERE user_id = p_uid AND week_start = v_week;
  END IF;
  RETURN v_paid;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.arcade_check_weekly_goal(uuid) FROM PUBLIC, anon, authenticated;
