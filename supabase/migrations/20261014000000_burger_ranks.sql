-- Burger Ranks (loyalty tiers), part 1 of 3.
--
-- Tiers come from LIFETIME SPEND on collected orders (order total minus any
-- refund), never from points, so games, shares and referrals cannot move
-- anyone up a rank. Each rank sets how many rewards a customer may claim per
-- calendar month and a bonus on the points they earn from orders:
--
--   Rookie RM0 (1 claim)   Regular RM200 (2)   Pro RM850 (3, +5%)
--   Master RM1,500 (4, +8%)   Ultimate RM3,000 (5, +12%)
--
-- The ladder lives in the loyalty_tiers table, so it can be re-tuned later
-- with a plain UPDATE. Also here:
--   * order points are stored per order (points_earned), so a cancel takes
--     back EXACTLY what was earned, bonus included
--   * a refund takes back the matching share of points (and undoing a refund
--     gives them back)
--   * the monthly claim limit now follows the customer's rank
--
-- Run first, then 20261014000001_burger_ranks_cancel.sql. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.loyalty_tiers (
  name text PRIMARY KEY,
  sort_order integer NOT NULL UNIQUE,
  min_spend_cents integer NOT NULL CHECK (min_spend_cents >= 0),
  claims_per_month integer NOT NULL CHECK (claims_per_month >= 0),
  bonus_percent integer NOT NULL DEFAULT 0 CHECK (bonus_percent BETWEEN 0 AND 100)
);

ALTER TABLE public.loyalty_tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read loyalty tiers" ON public.loyalty_tiers;
CREATE POLICY "Anyone can read loyalty tiers" ON public.loyalty_tiers FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins manage loyalty tiers" ON public.loyalty_tiers;
CREATE POLICY "Admins manage loyalty tiers" ON public.loyalty_tiers FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

INSERT INTO public.loyalty_tiers (name, sort_order, min_spend_cents, claims_per_month, bonus_percent) VALUES
  ('Rookie',   1,      0, 1,  0),
  ('Regular',  2,  20000, 2,  0),
  ('Pro',      3,  85000, 3,  5),
  ('Master',   4, 150000, 4,  8),
  ('Ultimate', 5, 300000, 5, 12)
ON CONFLICT (name) DO NOTHING;

-- Exact points each order earned (null on orders placed before this change).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS points_earned integer;

-- Lifetime spend: collected orders only, minus refunds.
CREATE OR REPLACE FUNCTION public.customer_spend_cents(p_user uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(GREATEST(0, total - COALESCE(refund_amount, 0))), 0)::integer
  FROM public.orders
  WHERE user_id = p_user AND status = 'COLLECTED';
$$;

CREATE OR REPLACE FUNCTION public.customer_tier(p_user uuid)
RETURNS TABLE (name text, sort_order integer, min_spend_cents integer,
               claims_per_month integer, bonus_percent integer, spend_cents integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH s AS (SELECT public.customer_spend_cents(p_user) AS spend)
  SELECT t.name, t.sort_order, t.min_spend_cents, t.claims_per_month, t.bonus_percent, s.spend
  FROM public.loyalty_tiers t, s
  WHERE t.min_spend_cents <= s.spend
  ORDER BY t.min_spend_cents DESC
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.customer_spend_cents(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.customer_tier(uuid) FROM PUBLIC, anon, authenticated;

-- Order points: RM1 = 1 point, plus the customer's rank bonus. The exact
-- amount is stored on the order so a cancel can take back precisely that.
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

-- A refund takes back the matching share of the points the order earned;
-- undoing a refund gives them back. (Cancelled orders were already reversed
-- in full by cancel_order.)
CREATE OR REPLACE FUNCTION public.handle_order_refund_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delta integer;
  v_basis integer;
  v_back integer;
BEGIN
  IF NEW.user_id IS NULL OR COALESCE(NEW.total, 0) <= 0 OR NEW.status = 'CANCELLED' THEN
    RETURN NEW;
  END IF;
  v_delta := LEAST(COALESCE(NEW.refund_amount, 0), NEW.total) - LEAST(COALESCE(OLD.refund_amount, 0), NEW.total);
  IF v_delta = 0 THEN
    RETURN NEW;
  END IF;
  v_basis := COALESCE(NEW.points_earned, ROUND(NEW.total / 100.0)::integer);
  v_back := ROUND(v_basis * ABS(v_delta) / NEW.total::numeric)::integer;
  IF v_delta > 0 THEN
    UPDATE public.profiles SET points = GREATEST(0, COALESCE(points, 0) - v_back) WHERE id = NEW.user_id;
  ELSE
    UPDATE public.profiles SET points = COALESCE(points, 0) + v_back WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_refund_points ON public.orders;
CREATE TRIGGER trg_order_refund_points
  AFTER UPDATE OF refund_amount ON public.orders
  FOR EACH ROW
  WHEN (NEW.refund_amount IS DISTINCT FROM OLD.refund_amount)
  EXECUTE FUNCTION public.handle_order_refund_points();

-- The monthly claim limit now follows the customer's rank.
CREATE OR REPLACE FUNCTION public.enforce_monthly_reward_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cap integer;
  v_tier text;
  v_month_start timestamptz;
  v_used integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('reward_cap:' || NEW.user_id::text));

  SELECT t.claims_per_month, t.name INTO v_cap, v_tier FROM public.customer_tier(NEW.user_id) t;
  v_cap := COALESCE(v_cap, 1);
  v_tier := COALESCE(v_tier, 'Rookie');

  v_month_start := date_trunc('month', now() AT TIME ZONE 'Asia/Kuching') AT TIME ZONE 'Asia/Kuching';

  SELECT COUNT(*) INTO v_used
  FROM public.redemptions
  WHERE user_id = NEW.user_id
    AND status <> 'CANCELLED'
    AND redeemed_at >= v_month_start;

  IF v_used >= v_cap THEN
    RAISE EXCEPTION 'You have used your % reward(s) for this month (% rank). Keep ordering to unlock more.', v_cap, v_tier;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_monthly_reward_cap ON public.redemptions;
CREATE TRIGGER trg_enforce_monthly_reward_cap
  BEFORE INSERT ON public.redemptions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_monthly_reward_cap();

-- What the Loyalty page shows the signed-in customer.
CREATE OR REPLACE FUNCTION public.my_tier()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  t record;
  nx record;
  v_used integer;
  v_month_start timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO t FROM public.customer_tier(v_uid);
  SELECT lt.name, lt.min_spend_cents INTO nx
  FROM public.loyalty_tiers lt
  WHERE lt.min_spend_cents > COALESCE(t.spend_cents, 0)
  ORDER BY lt.min_spend_cents
  LIMIT 1;

  v_month_start := date_trunc('month', now() AT TIME ZONE 'Asia/Kuching') AT TIME ZONE 'Asia/Kuching';
  SELECT COUNT(*) INTO v_used
  FROM public.redemptions
  WHERE user_id = v_uid AND status <> 'CANCELLED' AND redeemed_at >= v_month_start;

  RETURN jsonb_build_object(
    'tier', COALESCE(t.name, 'Rookie'),
    'spend_cents', COALESCE(t.spend_cents, 0),
    'min_spend_cents', COALESCE(t.min_spend_cents, 0),
    'claims_per_month', COALESCE(t.claims_per_month, 1),
    'claims_used', v_used,
    'bonus_percent', COALESCE(t.bonus_percent, 0),
    'next_tier', nx.name,
    'next_min_spend_cents', nx.min_spend_cents,
    'tiers', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', x.name, 'min_spend_cents', x.min_spend_cents,
        'claims_per_month', x.claims_per_month, 'bonus_percent', x.bonus_percent
      ) ORDER BY x.sort_order), '[]'::jsonb)
      FROM public.loyalty_tiers x
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.my_tier() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_tier() TO authenticated;
