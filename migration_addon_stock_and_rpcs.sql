-- =========================================================================
-- COMPLETE MIGRATION: ADD-ON STOCK TRACKING, ATOMIC RPCS, AND REALTIME
-- =========================================================================

-- 1. Add stock_quantity, low_stock_threshold, and in_stock to addons table
ALTER TABLE public.addons ADD COLUMN IF NOT EXISTS stock_quantity integer DEFAULT 99;
ALTER TABLE public.addons ADD COLUMN IF NOT EXISTS low_stock_threshold integer DEFAULT 10;
ALTER TABLE public.addons ADD COLUMN IF NOT EXISTS in_stock boolean DEFAULT true;

-- Update existing addons to have 99 stock if null
UPDATE public.addons SET stock_quantity = 99 WHERE stock_quantity IS NULL;
UPDATE public.addons SET low_stock_threshold = 10 WHERE low_stock_threshold IS NULL;
UPDATE public.addons SET in_stock = true WHERE in_stock IS NULL;

-- 2. Ensure RLS policies on addons
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'addons' AND policyname = 'Allow public update addons'
  ) THEN
    CREATE POLICY "Allow public update addons" ON public.addons
      FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 3. Ensure addons table is in supabase_realtime
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.addons;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4. Update place_order RPC to support atomic deduction for addons
CREATE OR REPLACE FUNCTION public.place_order(
  deductions jsonb,
  payload jsonb,
  p_promo_code text DEFAULT NULL,
  p_user_id text DEFAULT NULL,
  addon_deductions jsonb DEFAULT '[]'::jsonb
) RETURNS text AS $$
DECLARE
  d record;
  ad record;
  current_stock integer;
  current_addon_stock integer;
  order_id text;
BEGIN
  -- Validate and deduct main items stock atomically
  FOR d IN SELECT * FROM jsonb_to_recordset(deductions) AS x(item_id text, quantity integer)
  LOOP
    SELECT stock_quantity INTO current_stock
    FROM public.menu_items
    WHERE id = d.item_id
    FOR UPDATE;

    IF current_stock IS NULL THEN
      RAISE EXCEPTION 'Item % not found', d.item_id;
    END IF;

    IF current_stock < d.quantity THEN
      RAISE EXCEPTION 'Insufficient stock for item %', d.item_id;
    END IF;

    UPDATE public.menu_items
    SET 
      stock_quantity = current_stock - d.quantity,
      in_stock = (current_stock - d.quantity > 0)
    WHERE id = d.item_id;
  END LOOP;

  -- Validate and deduct addons stock atomically
  IF addon_deductions IS NOT NULL AND jsonb_array_length(addon_deductions) > 0 THEN
    FOR ad IN SELECT * FROM jsonb_to_recordset(addon_deductions) AS y(addon_id text, quantity integer)
    LOOP
      SELECT stock_quantity INTO current_addon_stock
      FROM public.addons
      WHERE id = ad.addon_id
      FOR UPDATE;

      IF current_addon_stock IS NOT NULL THEN
        IF current_addon_stock < ad.quantity THEN
          RAISE EXCEPTION 'Insufficient stock for add-on %', ad.addon_id;
        END IF;

        UPDATE public.addons
        SET 
          stock_quantity = current_addon_stock - ad.quantity,
          in_stock = (current_addon_stock - ad.quantity > 0)
        WHERE id = ad.addon_id;
      END IF;
    END LOOP;
  END IF;

  -- If promo code was applied, record usage
  IF p_promo_code IS NOT NULL AND p_promo_code <> '' THEN
    UPDATE public.promotions
    SET current_uses = COALESCE(current_uses, 0) + 1
    WHERE UPPER(code) = UPPER(p_promo_code);

    IF p_user_id IS NOT NULL THEN
      INSERT INTO public.user_promo_usages (user_id, promo_code, used_at)
      VALUES (p_user_id, UPPER(p_promo_code), NOW());
    END IF;
  END IF;

  -- Insert order
  order_id := payload->>'id';
  INSERT INTO public.orders (
    id,
    items,
    total,
    status,
    payment_method,
    customer_name,
    customer_phone,
    user_id,
    promo_code_used,
    discount_amount,
    created_at
  ) VALUES (
    order_id,
    payload->'items',
    (payload->>'total')::integer,
    payload->>'status',
    payload->>'payment_method',
    payload->>'customer_name',
    payload->>'customer_phone',
    payload->>'user_id',
    payload->>'promo_code_used',
    COALESCE((payload->>'discount_amount')::integer, 0),
    NOW()
  );

  RETURN order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Update cancel_order RPC to restore / waste-log both main items AND addons
CREATE OR REPLACE FUNCTION public.cancel_order(
  p_order_id text,
  p_reason text,
  p_waste_action text DEFAULT 'restore'
) RETURNS void AS $$
DECLARE
  v_order_item record;
  v_addon_item record;
  v_order_status text;
  v_order_items jsonb;
BEGIN
  -- 1. Get current order status and items
  SELECT status, items INTO v_order_status, v_order_items 
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

  -- 4. Process main items and addons inventory
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
    -- Restore/waste main item
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

    -- Restore/waste addons for this item (multiplied by item quantity)
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
