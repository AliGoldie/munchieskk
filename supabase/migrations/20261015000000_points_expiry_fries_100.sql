-- Gradual points expiry + Free Fries at 100 points.
--
-- A customer is "inactive" after 12 months with no order, no arcade/engagement
-- points and no redemption (a new account counts from its sign-up date). Then
-- the balance fades by 25% of what it was when the fade began, once every 30
-- days, until it is gone (4 steps). Any order, game points or redemption stops
-- the fade straight away. Reminders: an in-app banner from month 11 and an
-- Admin list with a WhatsApp button.
--
-- Expiry is applied lazily (when the customer places an order or opens
-- Loyalty); a customer who never comes back keeps a stale balance in the
-- database, which is harmless because it is reduced before it can be used.
-- Rank is based on spend and never fades.

CREATE TABLE IF NOT EXISTS public.points_fade (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  anchor timestamptz NOT NULL,
  base integer NOT NULL
);
ALTER TABLE public.points_fade ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.points_fade FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.points_last_active(p_uid uuid, p_exclude_order text DEFAULT NULL)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(
    COALESCE((SELECT created_at FROM public.profiles WHERE id = p_uid), now()),
    COALESCE((SELECT max(created_at) FROM public.orders
              WHERE user_id = p_uid AND id <> COALESCE(p_exclude_order, '')), '-infinity'::timestamptz),
    COALESCE((SELECT max(awarded_at) FROM public.engagement_points_log WHERE user_id = p_uid), '-infinity'::timestamptz),
    COALESCE((SELECT max(redeemed_at) FROM public.redemptions WHERE user_id = p_uid), '-infinity'::timestamptz)
  );
$$;
REVOKE ALL ON FUNCTION public.points_last_active(uuid, text) FROM PUBLIC, anon, authenticated;

-- Applies any fade that is due. Returns how many points were removed.
CREATE OR REPLACE FUNCTION public.expire_points_if_stale(p_uid uuid, p_exclude_order text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_points integer;
  v_last timestamptz;
  v_start timestamptz;
  v_steps integer;
  v_base integer;
  v_anchor timestamptz;
  v_target integer;
BEGIN
  SELECT COALESCE(points, 0) INTO v_points FROM public.profiles WHERE id = p_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_last := public.points_last_active(p_uid, p_exclude_order);
  v_start := v_last + interval '12 months';

  IF now() < v_start THEN
    DELETE FROM public.points_fade WHERE user_id = p_uid;
    RETURN 0;
  END IF;
  IF v_points <= 0 THEN
    RETURN 0;
  END IF;

  v_steps := LEAST(4, 1 + floor(extract(epoch FROM (now() - v_start)) / 2592000.0))::integer;

  SELECT anchor, base INTO v_anchor, v_base FROM public.points_fade WHERE user_id = p_uid;
  IF NOT FOUND OR v_anchor <> v_last THEN
    v_base := v_points;
    INSERT INTO public.points_fade (user_id, anchor, base) VALUES (p_uid, v_last, v_base)
    ON CONFLICT (user_id) DO UPDATE SET anchor = EXCLUDED.anchor, base = EXCLUDED.base;
  END IF;

  v_target := ROUND(v_base * (4 - v_steps) / 4.0)::integer;
  IF v_points > v_target THEN
    UPDATE public.profiles SET points = v_target WHERE id = p_uid;
    RETURN v_points - v_target;
  END IF;
  RETURN 0;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_points_if_stale(uuid, text) FROM PUBLIC, anon, authenticated;

-- The customer's own expiry status (applies any due fade first).
-- state: ok | soon (month 11) | fading
CREATE OR REPLACE FUNCTION public.my_points_expiry()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_removed integer;
  v_points integer;
  v_last timestamptz;
  v_start timestamptz;
  v_state text := 'ok';
  v_steps integer;
  v_next_at timestamptz;
  v_next_pts integer := 0;
  v_base integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('state', 'ok', 'points', 0);
  END IF;
  v_removed := public.expire_points_if_stale(v_uid, NULL);
  SELECT COALESCE(points, 0) INTO v_points FROM public.profiles WHERE id = v_uid;
  v_last := public.points_last_active(v_uid, NULL);
  v_start := v_last + interval '12 months';

  IF v_points > 0 AND now() >= v_start THEN
    v_state := 'fading';
    v_steps := LEAST(4, 1 + floor(extract(epoch FROM (now() - v_start)) / 2592000.0))::integer;
    SELECT base INTO v_base FROM public.points_fade WHERE user_id = v_uid;
    IF v_steps < 4 THEN
      v_next_at := v_start + make_interval(days => 30 * v_steps);
      v_next_pts := LEAST(v_points, ROUND(COALESCE(v_base, v_points) / 4.0)::integer);
    END IF;
  ELSIF v_points > 0 AND now() >= v_start - interval '1 month' THEN
    v_state := 'soon';
    v_next_at := v_start;
    v_next_pts := ROUND(v_points / 4.0)::integer;
  END IF;

  RETURN jsonb_build_object(
    'state', v_state,
    'points', v_points,
    'removed', v_removed,
    'last_active', v_last,
    'fade_starts_at', v_start,
    'next_loss_at', v_next_at,
    'next_loss_points', v_next_pts
  );
END;
$$;
REVOKE ALL ON FUNCTION public.my_points_expiry() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_points_expiry() TO authenticated;

-- Admin: customers whose points are about to fade (from month 11) or are fading.
CREATE OR REPLACE FUNCTION public.admin_fading_points()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admins only';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.fade_starts_at), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT
      p.id,
      p.name,
      p.phone,
      COALESCE(p.points, 0) AS points,
      a.last_active,
      a.last_active + interval '12 months' AS fade_starts_at,
      CASE WHEN now() >= a.last_active + interval '12 months' THEN 'fading' ELSE 'soon' END AS state
    FROM public.profiles p
    CROSS JOIN LATERAL (SELECT public.points_last_active(p.id, NULL) AS last_active) a
    WHERE COALESCE(p.points, 0) > 0
      AND COALESCE(p.role, 'user') <> 'admin'
      AND now() >= a.last_active + interval '11 months'
  ) t;
  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_fading_points() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_fading_points() TO authenticated;

-- Order points: apply any fade that is due first, then add this order's points.
CREATE OR REPLACE FUNCTION public.handle_order_placed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base integer;
  v_bonus integer := 0;
  v_earned integer := 0;
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    PERFORM public.expire_points_if_stale(NEW.user_id, NEW.id);
    v_base := ROUND(COALESCE(NEW.total, 0) / 100.0)::integer;
    IF v_base > 0 THEN
      SELECT COALESCE(t.bonus_percent, 0) INTO v_bonus FROM public.customer_tier(NEW.user_id) t;
      v_earned := ROUND(v_base * (100 + COALESCE(v_bonus, 0)) / 100.0)::integer;
      UPDATE public.profiles
      SET points = COALESCE(points, 0) + v_earned
      WHERE id = NEW.user_id;
    END IF;
    UPDATE public.orders SET points_earned = v_earned WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- Free Fries: 100 points (about 1.5% of spend in food cost), still RM20 minimum order.
UPDATE public.loyalty_prizes SET points_cost = 100 WHERE name = 'FREE FRIES';
