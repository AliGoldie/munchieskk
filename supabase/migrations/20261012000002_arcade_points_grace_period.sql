-- Arcade points: new accounts can earn game points freely for their first
-- 30 days. After that, an account that has never completed a purchase (no
-- COLLECTED order) earns no more game points until it does.
--
-- Replaces the "needs an order in the last 24 hours" rule from
-- 20261012000000_points_rework.sql. The daily cap per game and the 150
-- points-per-week ceiling are unchanged.
--
-- To tighten later (e.g. require an order in the last 30 days instead of
-- ever), change the EXISTS check below. Safe to re-run.

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
  c_grace_days constant integer := 30;
  v_used_this_week integer := 0;
  v_award integer := 0;
  v_created timestamptz;
BEGIN
  IF p_desired_points <= 0 THEN
    RETURN 0;
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;

  -- Free play is a welcome gift for the first month; after that it is a
  -- thank-you for customers who have actually bought something.
  SELECT created_at INTO v_created FROM public.profiles WHERE id = p_user_id;
  IF COALESCE(v_created, now()) < now() - make_interval(days => c_grace_days)
     AND NOT EXISTS (
       SELECT 1 FROM public.orders
       WHERE user_id = p_user_id AND status = 'COLLECTED'
     ) THEN
    RETURN 0;
  END IF;

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

REVOKE EXECUTE ON FUNCTION public.award_engagement_points(uuid, text, integer) FROM PUBLIC, anon, authenticated;
