-- Points move from "when the order is placed" to "when it is collected".
--
--   * Order points (RM1 = 1 point, rank bonus, weekday boost) are worked out at
--     placement and shown to the customer, but only added to their balance when
--     the order is COLLECTED, together with the +6 collection bonus.
--   * A cancelled order therefore never held points, so there is nothing to take back.
--     (Orders placed before this migration were already credited; they are
--     marked so they are not credited twice and cancel/refund still work.)
--   * The friend's +30 sign-up points are paid at their first collected order of
--     RM20 or more (the same moment the referrer's 150 is paid), not at sign-up.
--   * Weekday boost: orders placed on the chosen days (Tue, Wed, Thu by default,
--     Malaysia time) earn double points. The owner can switch it off, change the
--     multiplier or the days in Admin > Prizes CRM.
-- Safe to re-run. Run after 20261017000000_munchman_match_games.sql.

-- 1. Which orders have had their points paid. Everything that exists today was
--    paid at placement, so it is marked as paid (this runs only the first time).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'points_credited_at'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN points_credited_at timestamptz;
    UPDATE public.orders SET points_credited_at = created_at WHERE user_id IS NOT NULL;
  END IF;
END $$;

-- 2. Weekday boost settings (one row).
CREATE TABLE IF NOT EXISTS public.points_boost (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  multiplier integer NOT NULL DEFAULT 2 CHECK (multiplier BETWEEN 1 AND 5),
  days integer[] NOT NULL DEFAULT '{2,3,4}'
);
INSERT INTO public.points_boost (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.points_boost ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.points_boost FROM PUBLIC, anon, authenticated;

-- The multiplier for an order placed at p_at (Malaysia time; Sunday = 0 ... Saturday = 6).
CREATE OR REPLACE FUNCTION public.points_boost_multiplier(p_at timestamptz)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN b.enabled
              AND extract(dow FROM (p_at AT TIME ZONE 'Asia/Kuching'))::integer = ANY (b.days)
         THEN b.multiplier ELSE 1 END
  FROM public.points_boost b WHERE b.id;
$$;
REVOKE EXECUTE ON FUNCTION public.points_boost_multiplier(timestamptz) FROM PUBLIC, anon, authenticated;

-- What the app shows (safe for guests).
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
    'active_now', public.points_boost_multiplier(now()) > 1)
  FROM public.points_boost b WHERE b.id;
$$;
REVOKE EXECUTE ON FUNCTION public.points_boost_info() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.points_boost_info() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_points_boost(p_enabled boolean, p_multiplier integer, p_days integer[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;
  IF p_multiplier IS NULL OR p_multiplier < 1 OR p_multiplier > 5 THEN
    RAISE EXCEPTION 'The multiplier must be between 1 and 5.';
  END IF;
  IF p_days IS NULL OR EXISTS (SELECT 1 FROM unnest(p_days) d WHERE d < 0 OR d > 6) THEN
    RAISE EXCEPTION 'Days must be 0 (Sunday) to 6 (Saturday).';
  END IF;
  UPDATE public.points_boost SET enabled = COALESCE(p_enabled, true), multiplier = p_multiplier, days = p_days WHERE id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_points_boost(boolean, integer, integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_points_boost(boolean, integer, integer[]) TO authenticated;

-- 3. Placement: work out the points (with the weekday boost and rank bonus) and
--    store them on the order. They are added to the balance at collection.
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
    -- A lapsed customer's fade is applied when they come back to order.
    PERFORM public.expire_points_if_stale(NEW.user_id, NEW.id);
    v_base := ROUND(COALESCE(NEW.total, 0) / 100.0)::integer * public.points_boost_multiplier(COALESCE(NEW.created_at, now()));
    IF v_base > 0 THEN
      SELECT COALESCE(t.bonus_percent, 0) INTO v_bonus FROM public.customer_tier(NEW.user_id) t;
      v_earned := ROUND(v_base * (100 + COALESCE(v_bonus, 0)) / 100.0)::integer;
    END IF;
    UPDATE public.orders SET points_earned = v_earned WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Collection: pay the order points (if not paid yet) and the +6 bonus, then
--    the referral rewards (referrer 150, friend 30).
CREATE OR REPLACE FUNCTION public.handle_order_collected()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer uuid;
  v_converted timestamptz;
  v_bonus_count integer;
  v_credit integer;
  c_collection_bonus constant integer := 6;
  c_referral_reward constant integer := 150;
  c_referral_cap constant integer := 5;
  c_friend_bonus constant integer := 30;
  c_referral_min_total constant integer := 2000; -- RM20.00 in cents
BEGIN
  IF NEW.status = 'COLLECTED' AND (OLD.status IS DISTINCT FROM 'COLLECTED') AND NEW.user_id IS NOT NULL THEN
    v_credit := c_collection_bonus;
    IF NEW.points_credited_at IS NULL THEN
      v_credit := v_credit + COALESCE(NEW.points_earned, ROUND(COALESCE(NEW.total, 0) / 100.0)::integer);
      UPDATE public.orders SET points_credited_at = now() WHERE id = NEW.id;
    END IF;

    UPDATE public.profiles
    SET points = COALESCE(points, 0) + v_credit
    WHERE id = NEW.user_id;

    -- Referral: the first collected order worth at least RM20 converts it.
    SELECT referred_by, referral_converted_at
    INTO v_referrer, v_converted
    FROM public.profiles
    WHERE id = NEW.user_id
    FOR UPDATE;

    IF v_referrer IS NOT NULL AND v_converted IS NULL
       AND v_referrer <> NEW.user_id
       AND COALESCE(NEW.total, 0) >= c_referral_min_total THEN
      PERFORM 1 FROM public.profiles WHERE id = v_referrer FOR UPDATE;

      SELECT COUNT(*) INTO v_bonus_count
      FROM public.referral_rewards_log
      WHERE referrer_id = v_referrer AND reward_type = 'referrer_bonus';

      IF v_bonus_count < c_referral_cap THEN
        UPDATE public.profiles
        SET points = COALESCE(points, 0) + c_referral_reward
        WHERE id = v_referrer;

        INSERT INTO public.referral_rewards_log (
          referrer_id, referred_id, reward_type, points_awarded, order_id, logged_at
        ) VALUES (
          v_referrer, NEW.user_id, 'referrer_bonus', c_referral_reward, NEW.id, NOW()
        );
      END IF;

      -- The friend's welcome points, paid now (older accounts that already
      -- got them at sign-up are not paid twice).
      IF NOT EXISTS (
        SELECT 1 FROM public.referral_rewards_log
        WHERE referred_id = NEW.user_id AND reward_type = 'signup_bonus'
      ) THEN
        UPDATE public.profiles
        SET points = COALESCE(points, 0) + c_friend_bonus
        WHERE id = NEW.user_id;

        INSERT INTO public.referral_rewards_log (
          referrer_id, referred_id, reward_type, points_awarded, order_id, logged_at
        ) VALUES (
          v_referrer, NEW.user_id, 'signup_bonus', c_friend_bonus, NEW.id, NOW()
        );
      END IF;

      UPDATE public.profiles
      SET referral_converted_at = NOW()
      WHERE id = NEW.user_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 5. A refund only takes points back from an order whose points were paid.
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
  IF NEW.user_id IS NULL OR COALESCE(NEW.total, 0) <= 0 OR NEW.status = 'CANCELLED'
     OR NEW.points_credited_at IS NULL THEN
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

-- 6. Cancel: take points back only if they were already paid (orders placed
--    before this migration). New orders never held points before collection.
CREATE OR REPLACE FUNCTION public.cancel_order(
  p_order_id text,
  p_reason text,
  p_waste_action text DEFAULT 'restore',
  p_note text DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_order_item record;
  v_addon_item record;
  v_order_status text;
  v_order_items jsonb;
  v_owner uuid;
  v_total integer;
  v_points_earned integer;
  v_credited timestamptz;
  v_reward record;
BEGIN
  SELECT status, items, user_id, total, points_earned, points_credited_at
  INTO v_order_status, v_order_items, v_owner, v_total, v_points_earned, v_credited
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_status IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF NOT public.is_admin() AND (v_owner IS NULL OR v_owner IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to cancel this order';
  END IF;

  IF v_order_status = 'COLLECTED' OR v_order_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Cannot cancel an order that is already collected or cancelled';
  END IF;

  UPDATE public.orders
  SET
    status = 'CANCELLED',
    cancel_reason = p_reason,
    cancel_note = NULLIF(TRIM(BOTH FROM p_note), '')
  WHERE id = p_order_id;

  IF v_owner IS NOT NULL AND v_credited IS NOT NULL THEN
    UPDATE public.profiles
    SET points = GREATEST(0, COALESCE(points, 0) - COALESCE(v_points_earned, ROUND(COALESCE(v_total, 0) / 100.0)::integer))
    WHERE id = v_owner;
  END IF;

  SELECT id, user_id, points_spent INTO v_reward
  FROM public.redemptions
  WHERE order_id = p_order_id AND status = 'FULFILLED'
  FOR UPDATE;
  IF FOUND THEN
    UPDATE public.redemptions SET status = 'CANCELLED' WHERE id = v_reward.id;
    UPDATE public.profiles
    SET points = COALESCE(points, 0) + v_reward.points_spent
    WHERE id = v_reward.user_id;
  END IF;

  FOR v_order_item IN
    SELECT
      (elem->>'id') AS menu_item_id,
      COALESCE((elem->>'quantity')::integer, 1) AS quantity,
      (elem->'selectedAddons') AS selected_addons
    FROM (
      SELECT jsonb_array_elements(v_order_items) AS elem
      WHERE v_order_items IS NOT NULL
    ) sub
  LOOP
    IF v_order_item.menu_item_id IS NOT NULL THEN
      IF p_waste_action = 'restore' THEN
        UPDATE public.menu_items
        SET
          stock_quantity = COALESCE(stock_quantity, 0) + v_order_item.quantity,
          in_stock = true
        WHERE id = v_order_item.menu_item_id;
      ELSIF p_waste_action = 'waste' THEN
        INSERT INTO public.waste_log (order_id, item_id, quantity, reason, logged_by)
        VALUES (
          p_order_id,
          v_order_item.menu_item_id,
          v_order_item.quantity,
          p_reason,
          auth.uid()
        );
      END IF;
    END IF;

    IF v_order_item.selected_addons IS NOT NULL AND jsonb_array_length(v_order_item.selected_addons) > 0 THEN
      FOR v_addon_item IN
        SELECT (add_elem->>'id') AS addon_id
        FROM jsonb_array_elements(v_order_item.selected_addons) AS add_elem
      LOOP
        IF v_addon_item.addon_id IS NOT NULL THEN
          IF p_waste_action = 'restore' THEN
            UPDATE public.addons
            SET
              stock_quantity = COALESCE(stock_quantity, 0) + v_order_item.quantity,
              in_stock = true
            WHERE id = v_addon_item.addon_id;
          ELSIF p_waste_action = 'waste' THEN
            INSERT INTO public.waste_log (order_id, item_id, quantity, reason, logged_by)
            VALUES (
              p_order_id,
              v_addon_item.addon_id,
              v_order_item.quantity,
              p_reason,
              auth.uid()
            );
          END IF;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.cancel_order(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order(text, text, text, text) TO authenticated;

-- 7. Sign-up no longer pays the friend's 30 points (see handle_order_collected).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref_raw text;
  v_referrer_id uuid := NULL;
  v_new_short_code text;
BEGIN
  v_new_short_code := public.generate_unique_short_code();

  INSERT INTO public.profiles (id, name, phone, role, points, short_code)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', NEW.phone, ''),
    'user',
    0,
    v_new_short_code
  )
  ON CONFLICT (id) DO NOTHING;

  v_ref_raw := NEW.raw_user_meta_data->>'referred_by';

  IF v_ref_raw IS NOT NULL AND v_ref_raw <> '' THEN
    SELECT id INTO v_referrer_id
    FROM public.profiles
    WHERE short_code = UPPER(TRIM(v_ref_raw));

    IF v_referrer_id IS NOT NULL AND v_referrer_id <> NEW.id THEN
      UPDATE public.profiles SET referred_by = v_referrer_id WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
