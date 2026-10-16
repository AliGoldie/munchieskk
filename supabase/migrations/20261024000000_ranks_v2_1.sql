-- Rewards Plan v2.1: new ranks, ranks never go down, rank perks, RM to next rank.
-- (Owner approved the ranks and perks, 16 Oct 2026.) Safe to run more than once.
--
--   * Rank thresholds from lifetime spend on collected orders:
--       Regular RM100, Pro RM300, Master RM600, Ultimate RM1,200.
--     Bonuses (+0/+5/+8/+12 %) and monthly reward limits (1/2/3/4/5) are unchanged.
--   * Ranks never go down: profiles.top_tier_sort remembers the highest rank. It is
--     raised when an order is collected, and every time rank thresholds are about to
--     change (so nobody loses rank even if thresholds go UP later).
--   * Rank perks, claimed on a paid order through the same checkout reward
--     (one reward per order, RM20 minimum, RM30 for the platter). Perks never use up
--     the monthly reward limit and cost no points:
--       Regular  free Cheese add-on        once
--       Pro      birthday Ice BB           once a year, in the birthday month
--       Master   free Egg add-on           once a month
--       Ultimate free Kawan MONSTA platter once a year
--     A higher rank keeps the lower perks. Cancelling the order frees the perk.
--   * Birthday: month and day only, optional, can be saved once (staff can fix it).
--   * my_tier() also returns the RM still to spend for the next rank.

-- ---- 1. columns -----------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS top_tier_sort integer NOT NULL DEFAULT 1;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birth_month smallint CHECK (birth_month BETWEEN 1 AND 12);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birth_day smallint CHECK (birth_day BETWEEN 1 AND 31);
ALTER TABLE public.loyalty_prizes ADD COLUMN IF NOT EXISTS perk_rank_order integer;
ALTER TABLE public.loyalty_prizes ADD COLUMN IF NOT EXISTS perk_period text
  CHECK (perk_period IS NULL OR perk_period IN ('once', 'month', 'year', 'birthday'));

-- A customer cannot write these from the browser.
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user = 'postgres' OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  NEW.id := OLD.id;
  NEW.points := OLD.points;
  NEW.role := OLD.role;
  NEW.is_admin := OLD.is_admin;
  NEW.tier := OLD.tier;
  NEW.last_bonus_claim_at := OLD.last_bonus_claim_at;
  NEW.benefits_used_this_month := OLD.benefits_used_this_month;
  NEW.created_at := OLD.created_at;
  NEW.game_streak := OLD.game_streak;
  NEW.last_game_date := OLD.last_game_date;
  NEW.referred_by := OLD.referred_by;
  NEW.referral_converted_at := OLD.referral_converted_at;
  NEW.short_code := OLD.short_code;
  NEW.top_tier_sort := OLD.top_tier_sort;
  NEW.birth_month := OLD.birth_month;
  NEW.birth_day := OLD.birth_day;

  RETURN NEW;
END;
$$;

-- ---- 2. ranks never go down -----------------------------------------
-- Remember each customer's current rank (by spend, thresholds as they are now).
CREATE OR REPLACE FUNCTION public.lock_in_ranks()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.profiles p
  SET top_tier_sort = x.sort_order
  FROM (
    SELECT o.user_id,
           (SELECT t.sort_order FROM public.loyalty_tiers t
            WHERE t.min_spend_cents <= SUM(GREATEST(0, o.total - COALESCE(o.refund_amount, 0)))
            ORDER BY t.sort_order DESC LIMIT 1) AS sort_order
    FROM public.orders o
    WHERE o.status = 'COLLECTED' AND o.user_id IS NOT NULL
    GROUP BY o.user_id
  ) x
  WHERE p.id = x.user_id AND x.sort_order IS NOT NULL AND x.sort_order > p.top_tier_sort;
$$;
REVOKE EXECUTE ON FUNCTION public.lock_in_ranks() FROM PUBLIC, anon, authenticated;

-- Before ANY change to the rank thresholds, remember everyone's current rank.
CREATE OR REPLACE FUNCTION public.lock_in_ranks_before_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.lock_in_ranks();
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_lock_in_ranks_before_change ON public.loyalty_tiers;
CREATE TRIGGER trg_lock_in_ranks_before_change
  BEFORE UPDATE OR DELETE ON public.loyalty_tiers
  FOR EACH STATEMENT EXECUTE FUNCTION public.lock_in_ranks_before_change();

-- Raise the remembered rank whenever an order is collected.
CREATE OR REPLACE FUNCTION public.raise_top_tier_on_collect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sort integer;
BEGIN
  IF NEW.user_id IS NULL OR NEW.status IS DISTINCT FROM 'COLLECTED' THEN
    RETURN NEW;
  END IF;
  SELECT t.sort_order INTO v_sort FROM public.loyalty_tiers t
  WHERE t.min_spend_cents <= public.customer_spend_cents(NEW.user_id)
  ORDER BY t.sort_order DESC LIMIT 1;
  UPDATE public.profiles SET top_tier_sort = v_sort
  WHERE id = NEW.user_id AND v_sort IS NOT NULL AND v_sort > top_tier_sort;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_raise_top_tier_on_collect ON public.orders;
CREATE TRIGGER trg_raise_top_tier_on_collect
  AFTER INSERT OR UPDATE OF status, total, refund_amount ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.raise_top_tier_on_collect();

CREATE OR REPLACE FUNCTION public.customer_tier(p_user uuid)
RETURNS TABLE (name text, sort_order integer, min_spend_cents integer,
               claims_per_month integer, bonus_percent integer, spend_cents integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH s AS (
    SELECT public.customer_spend_cents(p_user) AS spend,
           COALESCE((SELECT top_tier_sort FROM public.profiles WHERE id = p_user), 1) AS floor_sort
  )
  SELECT t.name, t.sort_order, t.min_spend_cents, t.claims_per_month, t.bonus_percent, s.spend
  FROM public.loyalty_tiers t, s
  WHERE t.min_spend_cents <= s.spend OR t.sort_order <= s.floor_sort
  ORDER BY t.sort_order DESC
  LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.customer_tier(uuid) FROM PUBLIC, anon, authenticated;

-- ---- 3. enable the new thresholds -----------------------------------
-- (The statement trigger above remembers everyone's current rank first.)
UPDATE public.loyalty_tiers SET min_spend_cents = 10000  WHERE name = 'Regular';
UPDATE public.loyalty_tiers SET min_spend_cents = 30000  WHERE name = 'Pro';
UPDATE public.loyalty_tiers SET min_spend_cents = 60000  WHERE name = 'Master';
UPDATE public.loyalty_tiers SET min_spend_cents = 120000 WHERE name = 'Ultimate';
-- Now remember the ranks under the new thresholds too.
SELECT public.lock_in_ranks();

-- Ranks are decided, so the launch profile switch no longer carries them.
DO $$
BEGIN
  IF to_regclass('public.launch_profiles') IS NOT NULL THEN
    UPDATE public.launch_profiles SET config = config - 'tiers' WHERE name = 'v2';
  END IF;
END $$;

-- ---- 4. perks ---------------------------------------------------------
INSERT INTO public.loyalty_prizes (name, description, points_cost, menu_item_id, addon_id, min_order_cents, deduct_stock, is_active, perk_rank_order, perk_period)
SELECT 'Regular perk: free Cheese', 'Free extra cheese on any burger. Regular rank perk, once.', 0, NULL, a.id, 2000, false, true, 2, 'once'
FROM public.addons a WHERE a.name = 'Cheese'
  AND NOT EXISTS (SELECT 1 FROM public.loyalty_prizes WHERE name = 'Regular perk: free Cheese');

INSERT INTO public.loyalty_prizes (name, description, points_cost, menu_item_id, addon_id, min_order_cents, deduct_stock, is_active, perk_rank_order, perk_period)
SELECT 'Pro perk: birthday Ice BB', 'A free Ice BB in your birthday month. Pro rank perk, once a year.', 0, m.id, NULL, 2000, true, true, 3, 'birthday'
FROM public.menu_items m WHERE m.name = 'Ice BB'
  AND NOT EXISTS (SELECT 1 FROM public.loyalty_prizes WHERE name = 'Pro perk: birthday Ice BB');

INSERT INTO public.loyalty_prizes (name, description, points_cost, menu_item_id, addon_id, min_order_cents, deduct_stock, is_active, perk_rank_order, perk_period)
SELECT 'Master perk: monthly free Egg', 'A free egg on any burger, every month. Master rank perk.', 0, NULL, a.id, 2000, false, true, 4, 'month'
FROM public.addons a WHERE a.name = 'Egg'
  AND NOT EXISTS (SELECT 1 FROM public.loyalty_prizes WHERE name = 'Master perk: monthly free Egg');

INSERT INTO public.loyalty_prizes (name, description, points_cost, menu_item_id, addon_id, min_order_cents, deduct_stock, is_active, perk_rank_order, perk_period)
SELECT 'Ultimate perk: yearly free platter', 'A free Kawan MONSTA platter once a year. Ultimate rank perk.', 0, m.id, NULL, 3000, true, true, 5, 'year'
FROM public.menu_items m WHERE m.name = 'Kawan MONSTA'
  AND NOT EXISTS (SELECT 1 FROM public.loyalty_prizes WHERE name = 'Ultimate perk: yearly free platter');

-- ---- 5. monthly reward limit ignores perks ----------------------------
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

  -- Rank perks are extra: they never use up the monthly reward limit.
  IF EXISTS (SELECT 1 FROM public.loyalty_prizes lp WHERE lp.id = NEW.prize_id AND lp.perk_rank_order IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  SELECT t.claims_per_month, t.name INTO v_cap, v_tier FROM public.customer_tier(NEW.user_id) t;
  v_cap := COALESCE(v_cap, 1);
  v_tier := COALESCE(v_tier, 'Rookie');

  v_month_start := date_trunc('month', now() AT TIME ZONE 'Asia/Kuching') AT TIME ZONE 'Asia/Kuching';

  SELECT COUNT(*) INTO v_used
  FROM public.redemptions r
  WHERE r.user_id = NEW.user_id
    AND r.status <> 'CANCELLED'
    AND r.redeemed_at >= v_month_start
    AND NOT EXISTS (SELECT 1 FROM public.loyalty_prizes lp WHERE lp.id = r.prize_id AND lp.perk_rank_order IS NOT NULL);

  IF v_used >= v_cap THEN
    RAISE EXCEPTION 'You have used your % reward(s) for this month (% rank). Keep ordering to unlock more.', v_cap, v_tier;
  END IF;
  RETURN NEW;
END;
$$;

-- ---- 6. the checkout reward now understands perks ---------------------
CREATE OR REPLACE FUNCTION public.apply_order_reward(p_order_id text, p_prize_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order record;
  v_prize record;
  v_points integer;
  v_min integer;
  v_stock integer;
  v_name text;
  v_category text;
  v_addon_name text;
  v_addon_stock integer;
  v_items jsonb;
  v_new_items jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_free_addon jsonb;
  v_qty integer;
  v_attached boolean := false;
  v_code text;
  v_rank integer;
  v_birth_month integer;
  v_since timestamptz;
  c_suffix constant text := ' (FREE reward)';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please log in to use a reward.';
  END IF;

  SELECT id, user_id, status, items, total, created_at INTO v_order
  FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;
  IF v_order.status <> 'PENDING' OR v_order.created_at < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'A reward can only be added while your order is waiting for the kitchen.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.redemptions WHERE order_id = p_order_id AND status <> 'CANCELLED') THEN
    RAISE EXCEPTION 'This order already has a reward.';
  END IF;

  SELECT * INTO v_prize FROM public.loyalty_prizes WHERE id = p_prize_id;
  IF NOT FOUND OR v_prize.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'This reward is not available.';
  END IF;
  IF v_prize.menu_item_id IS NULL AND v_prize.addon_id IS NULL THEN
    RAISE EXCEPTION 'This reward can only be collected at the counter.';
  END IF;

  -- The free item has to come with a real, paid order.
  v_min := GREATEST(COALESCE(v_prize.min_order_cents, 0), 1);
  IF COALESCE(v_order.total, 0) < v_min THEN
    RAISE EXCEPTION 'Spend at least RM % to use this reward.', to_char(v_min / 100.0, 'FM999990.00');
  END IF;

  SELECT points INTO v_points FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF COALESCE(v_points, 0) < v_prize.points_cost THEN
    RAISE EXCEPTION 'Not enough points for this reward.';
  END IF;

  -- Rank perks: right rank, and once per period (Malaysia time). The profile row
  -- is locked above, so two taps cannot both pass.
  IF v_prize.perk_rank_order IS NOT NULL THEN
    SELECT COALESCE(t.sort_order, 1) INTO v_rank FROM public.customer_tier(v_uid) t;
    IF COALESCE(v_rank, 1) < v_prize.perk_rank_order THEN
      RAISE EXCEPTION 'This perk is for a higher rank.';
    END IF;
    IF v_prize.perk_period = 'birthday' THEN
      SELECT birth_month INTO v_birth_month FROM public.profiles WHERE id = v_uid;
      IF v_birth_month IS NULL THEN
        RAISE EXCEPTION 'Add your birthday (month and day) to your profile to use this perk.';
      END IF;
      IF v_birth_month <> EXTRACT(MONTH FROM now() AT TIME ZONE 'Asia/Kuching')::integer THEN
        RAISE EXCEPTION 'This perk can only be used in your birthday month.';
      END IF;
    END IF;
    v_since := CASE v_prize.perk_period
      WHEN 'month' THEN date_trunc('month', now() AT TIME ZONE 'Asia/Kuching') AT TIME ZONE 'Asia/Kuching'
      WHEN 'year' THEN date_trunc('year', now() AT TIME ZONE 'Asia/Kuching') AT TIME ZONE 'Asia/Kuching'
      WHEN 'birthday' THEN date_trunc('year', now() AT TIME ZONE 'Asia/Kuching') AT TIME ZONE 'Asia/Kuching'
      ELSE '-infinity'::timestamptz END;
    IF EXISTS (SELECT 1 FROM public.redemptions
               WHERE user_id = v_uid AND prize_id = v_prize.id AND status <> 'CANCELLED' AND redeemed_at >= v_since) THEN
      RAISE EXCEPTION 'You have already used this perk for this period.';
    END IF;
  END IF;

  v_items := COALESCE(v_order.items, '[]'::jsonb);

  IF v_prize.menu_item_id IS NOT NULL THEN
    -- Free menu item: its own line at RM0.00. Stock is always taken (and
    -- given back by cancel_order, which restores every line).
    SELECT name, category, stock_quantity INTO v_name, v_category, v_stock
    FROM public.menu_items WHERE id = v_prize.menu_item_id FOR UPDATE;
    IF NOT FOUND OR COALESCE(v_stock, 0) < 1 THEN
      RAISE EXCEPTION 'This reward is out of stock right now.';
    END IF;
    UPDATE public.menu_items
    SET stock_quantity = v_stock - 1, in_stock = (v_stock - 1 > 0)
    WHERE id = v_prize.menu_item_id;

    v_items := v_items || jsonb_build_object(
      'id', v_prize.menu_item_id,
      'name', v_name || c_suffix,
      'category', v_category,
      'price', 0,
      'quantity', 1,
      'selectedAddons', '[]'::jsonb,
      'reward', true
    );
  ELSE
    -- Free add-on: attach it, at RM0.00, to the first paid item in the order
    -- that can take it. If that line has several units, split one unit off so
    -- only one gets the free add-on.
    SELECT name, stock_quantity INTO v_addon_name, v_addon_stock
    FROM public.addons WHERE id = v_prize.addon_id FOR UPDATE;
    IF NOT FOUND OR COALESCE(v_addon_stock, 0) < 1 THEN
      RAISE EXCEPTION 'This reward is out of stock right now.';
    END IF;

    v_free_addon := jsonb_build_object(
      'id', v_prize.addon_id, 'name', v_addon_name || c_suffix, 'price', 0, 'free', true
    );

    FOR v_elem IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      IF NOT v_attached
         AND COALESCE((v_elem->>'reward')::boolean, false) = false
         AND COALESCE((v_elem->>'price')::integer, 0) > 0
         AND EXISTS (
           SELECT 1 FROM public.item_addons
           WHERE menu_item_id = v_elem->>'id' AND addon_id = v_prize.addon_id
         ) THEN
        v_qty := COALESCE((v_elem->>'quantity')::integer, 1);
        IF v_qty <= 1 THEN
          v_new_items := v_new_items || jsonb_set(
            v_elem, '{selectedAddons}',
            COALESCE(v_elem->'selectedAddons', '[]'::jsonb) || v_free_addon
          );
        ELSE
          v_new_items := v_new_items
            || jsonb_set(v_elem, '{quantity}', to_jsonb(v_qty - 1))
            || jsonb_set(
                 jsonb_set(v_elem, '{quantity}', to_jsonb(1)),
                 '{selectedAddons}',
                 COALESCE(v_elem->'selectedAddons', '[]'::jsonb) || v_free_addon
               );
        END IF;
        v_attached := true;
      ELSE
        v_new_items := v_new_items || v_elem;
      END IF;
    END LOOP;

    IF NOT v_attached THEN
      RAISE EXCEPTION 'None of the items in your order can take this add-on.';
    END IF;
    v_items := v_new_items;

    UPDATE public.addons
    SET stock_quantity = v_addon_stock - 1, in_stock = (v_addon_stock - 1 > 0)
    WHERE id = v_prize.addon_id;
  END IF;

  UPDATE public.profiles
  SET points = COALESCE(points, 0) - v_prize.points_cost
  WHERE id = v_uid;

  v_code := public.generate_unique_redemption_code();
  INSERT INTO public.redemptions (
    redemption_code, user_id, prize_id, prize_name, points_spent,
    status, redeemed_at, fulfilled_at, order_id
  ) VALUES (
    v_code, v_uid, v_prize.id, v_prize.name, v_prize.points_cost,
    'FULFILLED', now(), now(), p_order_id
  );

  UPDATE public.orders SET items = v_items WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'redemption_code', v_code,
    'points_spent', v_prize.points_cost,
    'prize_name', v_prize.name
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_order_reward(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_order_reward(text, uuid) TO authenticated;

-- ---- 7. what the Loyalty page shows -----------------------------------
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
  v_tiers jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO t FROM public.customer_tier(v_uid);
  SELECT lt.name, lt.min_spend_cents INTO nx
  FROM public.loyalty_tiers lt
  WHERE lt.sort_order > COALESCE(t.sort_order, 1)
  ORDER BY lt.sort_order
  LIMIT 1;

  v_month_start := date_trunc('month', now() AT TIME ZONE 'Asia/Kuching') AT TIME ZONE 'Asia/Kuching';
  SELECT COUNT(*) INTO v_used
  FROM public.redemptions r
  WHERE r.user_id = v_uid AND r.status <> 'CANCELLED' AND r.redeemed_at >= v_month_start
    AND NOT EXISTS (SELECT 1 FROM public.loyalty_prizes lp WHERE lp.id = r.prize_id AND lp.perk_rank_order IS NOT NULL);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'name', x.name, 'min_spend_cents', x.min_spend_cents,
           'claims_per_month', x.claims_per_month, 'bonus_percent', x.bonus_percent
         ) ORDER BY x.sort_order), '[]'::jsonb)
  INTO v_tiers
  FROM public.loyalty_tiers x;

  RETURN jsonb_build_object(
    'tier', COALESCE(t.name, 'Rookie'),
    'spend_cents', COALESCE(t.spend_cents, 0),
    'min_spend_cents', COALESCE(t.min_spend_cents, 0),
    'claims_per_month', COALESCE(t.claims_per_month, 1),
    'claims_used', v_used,
    'bonus_percent', COALESCE(t.bonus_percent, 0),
    'next_tier', nx.name,
    'next_min_spend_cents', nx.min_spend_cents,
    'rm_to_next_cents', CASE WHEN nx.name IS NULL THEN NULL ELSE GREATEST(nx.min_spend_cents - COALESCE(t.spend_cents, 0), 0) END,
    'tiers', v_tiers
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.my_tier() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_tier() TO authenticated;

-- Save a birthday (month and day only). Can be saved once; staff can correct it.
CREATE OR REPLACE FUNCTION public.save_my_birthday(p_month integer, p_day integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please log in.';
  END IF;
  IF p_month IS NULL OR p_day IS NULL OR p_month NOT BETWEEN 1 AND 12 OR p_day NOT BETWEEN 1 AND 31 THEN
    RAISE EXCEPTION 'Please enter a real day and month.';
  END IF;
  -- days in that month (29 for February, so 29 Feb birthdays are allowed)
  IF p_day > EXTRACT(DAY FROM (make_date(2024, p_month, 1) + interval '1 month' - interval '1 day'))::integer THEN
    RAISE EXCEPTION 'Please enter a real day and month.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND birth_month IS NOT NULL) THEN
    RAISE EXCEPTION 'Your birthday is already saved. Ask us at the counter if it needs fixing.';
  END IF;
  UPDATE public.profiles SET birth_month = p_month, birth_day = p_day WHERE id = v_uid;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_my_birthday(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_birthday(integer, integer) TO authenticated;

-- The signed-in customer's perks and whether each can be used right now.
CREATE OR REPLACE FUNCTION public.my_perks()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rank integer;
  v_birth integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  SELECT COALESCE(t.sort_order, 1) INTO v_rank FROM public.customer_tier(v_uid) t;
  SELECT birth_month INTO v_birth FROM public.profiles WHERE id = v_uid;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'description', p.description,
      'rank', (SELECT t.name FROM public.loyalty_tiers t WHERE t.sort_order = p.perk_rank_order),
      'period', p.perk_period, 'min_order_cents', p.min_order_cents,
      'unlocked', COALESCE(v_rank, 1) >= p.perk_rank_order,
      'needs_birthday', p.perk_period = 'birthday' AND v_birth IS NULL,
      'birthday_month_now', p.perk_period <> 'birthday' OR v_birth = EXTRACT(MONTH FROM now() AT TIME ZONE 'Asia/Kuching')::integer,
      'used', EXISTS (
        SELECT 1 FROM public.redemptions r
        WHERE r.user_id = v_uid AND r.prize_id = p.id AND r.status <> 'CANCELLED'
          AND r.redeemed_at >= CASE p.perk_period
            WHEN 'month' THEN date_trunc('month', now() AT TIME ZONE 'Asia/Kuching') AT TIME ZONE 'Asia/Kuching'
            WHEN 'year' THEN date_trunc('year', now() AT TIME ZONE 'Asia/Kuching') AT TIME ZONE 'Asia/Kuching'
            WHEN 'birthday' THEN date_trunc('year', now() AT TIME ZONE 'Asia/Kuching') AT TIME ZONE 'Asia/Kuching'
            ELSE '-infinity'::timestamptz END)
    ) ORDER BY p.perk_rank_order)
    FROM public.loyalty_prizes p
    WHERE p.is_active AND p.perk_rank_order IS NOT NULL), '[]'::jsonb);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.my_perks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_perks() TO authenticated;
