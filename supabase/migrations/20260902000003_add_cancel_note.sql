-- Admin CRM brief §1 (Live Orders): "Cancel with reason" wants a coded
-- reason chip AND an optional free-text note as two separate fields.
-- orders.cancel_reason already existed; cancel_note is new.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancel_note text;

DROP FUNCTION IF EXISTS public.cancel_order(text, text, text);

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
BEGIN
  -- 1. Get current order status and items with row lock
  SELECT status, items INTO v_order_status, v_order_items
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  -- 2. Validate order exists and can be cancelled
  IF v_order_status IS NULL THEN
    RAISE EXCEPTION 'Order not found';
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
