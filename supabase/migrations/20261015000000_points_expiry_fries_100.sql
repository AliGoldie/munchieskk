-- Points expire after 12 months of inactivity; Free Fries drops to 100 points.
--
-- "Inactivity" = no order, no arcade/engagement points and no redemption for
-- 12 months (a new account counts from its sign-up date). Any of those resets
-- the clock. Rank is based on spend, so an expiry never changes a customer's rank.
-- Expiry is applied lazily: when the customer places an order or opens Loyalty.

CREATE OR REPLACE FUNCTION public.expire_points_if_stale(p_uid uuid, p_exclude_order text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_points integer;
  v_created timestamptz;
  v_last timestamptz;
BEGIN
  SELECT COALESCE(points, 0), created_at INTO v_points, v_created
  FROM public.profiles WHERE id = p_uid FOR UPDATE;
  IF NOT FOUND OR v_points <= 0 THEN
    RETURN 0;
  END IF;

  v_last := GREATEST(
    COALESCE(v_created, now()),
    COALESCE((SELECT max(created_at) FROM public.orders
              WHERE user_id = p_uid AND id <> COALESCE(p_exclude_order, '')), '-infinity'),
    COALESCE((SELECT max(awarded_at) FROM public.engagement_points_log WHERE user_id = p_uid), '-infinity'),
    COALESCE((SELECT max(redeemed_at) FROM public.redemptions WHERE user_id = p_uid), '-infinity')
  );

  IF v_last < now() - interval '12 months' THEN
    UPDATE public.profiles SET points = 0 WHERE id = p_uid;
    RETURN v_points;
  END IF;
  RETURN 0;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_points_if_stale(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.expire_my_points()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;
  RETURN public.expire_points_if_stale(auth.uid(), NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.expire_my_points() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_my_points() TO authenticated;

-- Order points: clear a stale balance first, then add this order's points.
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
