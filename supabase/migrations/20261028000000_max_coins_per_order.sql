-- Optional limit on the Monsta Coins one order can earn (Rewards Plan v2, task 7).
--
-- OFF by default (the setting is empty). It exists as a safety net against a very
-- large order, or a boosted day, paying out far more than intended. When it is
-- on, an order earns at most this many coins (order coins after the rank bonus
-- and any double-day boost; the +6 collection bonus is added on top as usual).
--
--   Turn it on (example: 500 coins per order):
--     UPDATE public.points_boost SET max_coins_per_order = 500;
--   Turn it off again:
--     UPDATE public.points_boost SET max_coins_per_order = NULL;
--
-- It applies to orders placed AFTER it is set (the coins are worked out when the
-- order is placed and stored on the order, so cancels and refunds stay exact).
-- The checkout page reads it so its "you will earn about" estimate respects it.
--
-- Safe to run more than once. Changes no stored points and does NOT turn the limit on.

ALTER TABLE public.points_boost
  ADD COLUMN IF NOT EXISTS max_coins_per_order integer
  CHECK (max_coins_per_order IS NULL OR max_coins_per_order >= 1);

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
  v_max integer;
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    -- A lapsed customer's fade is applied when they come back to order.
    PERFORM public.expire_points_if_stale(NEW.user_id, NEW.id);
    v_base := ROUND(COALESCE(NEW.total, 0) / 100.0)::integer * public.points_boost_multiplier(COALESCE(NEW.created_at, now()));
    IF v_base > 0 THEN
      SELECT COALESCE(t.bonus_percent, 0) INTO v_bonus FROM public.customer_tier(NEW.user_id) t;
      v_earned := ROUND(v_base * (100 + COALESCE(v_bonus, 0)) / 100.0)::integer;
    END IF;
    -- Optional limit on the coins one order can earn (off while the setting is empty).
    SELECT max_coins_per_order INTO v_max FROM public.points_boost WHERE id;
    IF v_max IS NOT NULL THEN
      v_earned := LEAST(v_earned, v_max);
    END IF;
    UPDATE public.orders SET points_earned = v_earned WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.points_boost_info()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'enabled', b.enabled,
    'multiplier', b.multiplier,
    'days', to_jsonb(b.days),
    'active_now', public.points_boost_multiplier(now()) > 1,
    'max_coins_per_order', b.max_coins_per_order)
  FROM public.points_boost b WHERE b.id;
$$;
REVOKE EXECUTE ON FUNCTION public.points_boost_info() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.points_boost_info() TO anon, authenticated;
