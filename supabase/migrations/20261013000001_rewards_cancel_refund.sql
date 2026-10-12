-- Rewards at checkout, part 2 of 2: cancel_order gives reward points back.
--
-- Identical to cancel_order in 20261011000000_order_integrity_hardening.sql
-- except for step 3c, which refunds the points spent on a checkout reward
-- (apply_order_reward) when the order is cancelled, by the customer or by
-- staff. Run AFTER 20261013000000_rewards_at_checkout.sql. Safe to re-run.

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
  v_reward record;
BEGIN
  -- 1. Get current order status, items, and owner with row lock
  SELECT status, items, user_id, total INTO v_order_status, v_order_items, v_owner, v_total
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  -- 2. Validate order exists and can be cancelled
  IF v_order_status IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Only the order's own customer, or an admin. An order with NO owner (old
  -- guest orders) is admin-only: order ids are sequential and guessable, so
  -- "knowing the id" proves nothing and let anyone cancel anyone's order.
  IF NOT public.is_admin() AND (v_owner IS NULL OR v_owner IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to cancel this order';
  END IF;

  IF v_order_status = 'COLLECTED' OR v_order_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Cannot cancel an order that is already collected or cancelled';
  END IF;

  -- 3. Mark order as cancelled and record reason + optional note
  UPDATE public.orders
  SET
    status = 'CANCELLED',
    cancel_reason = p_reason,
    cancel_note = NULLIF(TRIM(BOTH FROM p_note), '')
  WHERE id = p_order_id;

  -- 3b. Take back the loyalty points this order earned when it was placed
  --     (handle_order_placed: 1 point per RM1). Without this, placing and
  --     cancelling an order in a loop printed unlimited points while the
  --     stock was handed straight back.
  IF v_owner IS NOT NULL AND COALESCE(v_total, 0) > 0 THEN
    UPDATE public.profiles
    SET points = GREATEST(0, COALESCE(points, 0) - ROUND(v_total / 100.0)::integer)
    WHERE id = v_owner;
  END IF;

  -- 3c. Give back the points spent on a checkout reward (apply_order_reward).
  --     The free item or add-on itself goes back to stock in step 4 like any
  --     other line of the order.
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

  -- 4. Process main items and selected add-ons inventory
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
    -- Restore / Waste base menu item
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

    -- Restore / Waste each add-on (multiplied by parent item quantity)
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
