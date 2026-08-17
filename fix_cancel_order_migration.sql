-- SQL Migration to fix cancel_order RPC and add cancel_reason column
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancel_reason text;

CREATE OR REPLACE FUNCTION public.cancel_order(
  p_order_id text,
  p_reason text,
  p_waste_action text DEFAULT 'restore'
) RETURNS void AS $$
DECLARE
  v_order_item record;
  v_order_status text;
BEGIN
  -- 1. Get current order status
  SELECT status INTO v_order_status 
  FROM public.orders 
  WHERE id = p_order_id FOR UPDATE;

  -- 2. Validate order exists and can be cancelled
  IF v_order_status IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order_status = 'COLLECTED' OR v_order_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Cannot cancel an order that is already collected or cancelled';
  END IF;

  -- 3. Mark order as cancelled and set reason
  UPDATE public.orders
  SET 
    status = 'CANCELLED',
    cancel_reason = p_reason
  WHERE id = p_order_id;

  -- 4. Process inventory (Restore OR Mark as Waste)
  FOR v_order_item IN 
    SELECT 
      (elem->>'id') AS menu_item_id,
      COALESCE((elem->>'quantity')::integer, 1) AS quantity
    FROM (
      SELECT jsonb_array_elements(items) AS elem
      FROM public.orders 
      WHERE id = p_order_id AND items IS NOT NULL
    ) sub
  LOOP
    IF v_order_item.menu_item_id IS NOT NULL THEN
      IF p_waste_action = 'restore' THEN
        -- Standard behavior: restore stock atomically
        UPDATE public.menu_items
        SET 
          stock_quantity = COALESCE(stock_quantity, 0) + v_order_item.quantity,
          in_stock = true
        WHERE id = v_order_item.menu_item_id;
      ELSIF p_waste_action = 'waste' THEN
        -- Waste behavior: do NOT restore stock, log it to waste_log
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
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
