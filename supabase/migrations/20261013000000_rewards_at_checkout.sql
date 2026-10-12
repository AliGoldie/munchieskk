-- Rewards at checkout (points rework, release 2), part 1 of 2.
--
-- A customer can spend points on a free item or a free add-on while paying
-- for an order in the app. The app places the order first (place_order is
-- unchanged), then calls apply_order_reward, which -- in one transaction --
-- checks everything on the server, takes the points, adds the free line at
-- RM0.00 and records it in `redemptions` so it shows up in Admin and the
-- customer's history. cancel_order (part 2) gives the points back.
--
-- Run this first, then 20261013000001_rewards_cancel_refund.sql. Safe to re-run.

-- A prize can now be a free ADD-ON (addon_id) instead of a menu item, and can
-- need a minimum order value (min_order_cents, null = a default by cost).
ALTER TABLE public.loyalty_prizes ADD COLUMN IF NOT EXISTS addon_id text;
ALTER TABLE public.loyalty_prizes ADD COLUMN IF NOT EXISTS min_order_cents integer;

UPDATE public.loyalty_prizes
SET min_order_cents = CASE
      WHEN points_cost >= 2000 THEN 4000   -- RM40
      WHEN points_cost >= 300  THEN 2000   -- RM20
      ELSE 1000                            -- RM10
    END
WHERE min_order_cents IS NULL;

-- Links a checkout reward to its order. One live reward per order.
ALTER TABLE public.redemptions ADD COLUMN IF NOT EXISTS order_id text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_redemptions_one_per_order
  ON public.redemptions (order_id)
  WHERE order_id IS NOT NULL AND status <> 'CANCELLED';

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
