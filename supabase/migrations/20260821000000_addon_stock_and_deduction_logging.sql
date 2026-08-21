-- =========================================================================
-- COMPLETE MIGRATION: ADD-ON STOCK TRACKING, PROMO VALIDATION & ATOMIC RPCS
-- =========================================================================

-- 1. Add stock_quantity, low_stock_threshold, and in_stock to addons table
ALTER TABLE public.addons ADD COLUMN IF NOT EXISTS stock_quantity integer DEFAULT 99;
ALTER TABLE public.addons ADD COLUMN IF NOT EXISTS low_stock_threshold integer DEFAULT 10;
ALTER TABLE public.addons ADD COLUMN IF NOT EXISTS in_stock boolean DEFAULT true;

UPDATE public.addons SET stock_quantity = 99 WHERE stock_quantity IS NULL;
UPDATE public.addons SET low_stock_threshold = 10 WHERE low_stock_threshold IS NULL;
UPDATE public.addons SET in_stock = true WHERE in_stock IS NULL;

-- 2. Create addon_deduction_log table
CREATE TABLE IF NOT EXISTS public.addon_deduction_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id text,
  addon_id text,
  quantity integer,
  stock_before integer,
  stock_after integer,
  logged_at timestamptz DEFAULT now()
);

-- 3. Ensure addons table is in supabase_realtime
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.addons;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4. Drop older overloaded signatures of place_order
DROP FUNCTION IF EXISTS public.place_order(jsonb, jsonb, text, text, jsonb);
DROP FUNCTION IF EXISTS public.place_order(jsonb, jsonb, text, text);
DROP FUNCTION IF EXISTS public.place_order(jsonb, jsonb, text, uuid);
DROP FUNCTION IF EXISTS public.place_order(jsonb, jsonb, text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.place_order(jsonb, jsonb);

-- 5. Atomic place_order RPC (Menu Items + Add-ons + Promo Validation + Redemptions)
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
  v_original_total integer;
  v_final_discount integer := 0;
  v_promo_result jsonb;
  v_promo_code_id uuid := NULL;
  v_user_uuid uuid := NULL;
BEGIN
  order_id := payload->>'id';

  -- Cast user ID to uuid if provided
  IF p_user_id IS NOT NULL AND p_user_id <> '' THEN
    v_user_uuid := p_user_id::uuid;
  END IF;

  -- 1. Deduct Base Menu Items Stock (Atomic with FOR UPDATE locks)
  IF deductions IS NOT NULL AND jsonb_array_length(deductions) > 0 THEN
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
  END IF;

  -- 2. Deduct Add-ons Stock (Atomic with FOR UPDATE locks)
  IF addon_deductions IS NOT NULL AND jsonb_array_length(addon_deductions) > 0 THEN
    FOR ad IN SELECT * FROM jsonb_to_recordset(addon_deductions) AS y(addon_id text, quantity integer)
    LOOP
      SELECT stock_quantity INTO current_addon_stock 
      FROM public.addons 
      WHERE id = ad.addon_id 
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Add-on % not found', ad.addon_id;
      END IF;

      IF current_addon_stock IS NULL THEN
        RAISE EXCEPTION 'Add-on % has NULL stock_quantity', ad.addon_id;
      END IF;

      IF current_addon_stock < ad.quantity THEN
        RAISE EXCEPTION 'Insufficient stock for add-on %', ad.addon_id;
      END IF;

      UPDATE public.addons
      SET 
        stock_quantity = current_addon_stock - ad.quantity,
        in_stock = (current_addon_stock - ad.quantity > 0)
      WHERE id = ad.addon_id;

      INSERT INTO public.addon_deduction_log (
        order_id,
        addon_id,
        quantity,
        stock_before,
        stock_after,
        logged_at
      ) VALUES (
        order_id,
        ad.addon_id,
        ad.quantity,
        current_addon_stock,
        current_addon_stock - ad.quantity,
        NOW()
      );
    END LOOP;
  END IF;

  -- 3. Server-Side Promo Code Validation & Application
  v_original_total := (payload->>'total')::integer;

  IF p_promo_code IS NOT NULL AND p_promo_code <> '' THEN
    v_promo_result := validate_and_apply_promo(
      p_promo_code,
      v_original_total,
      v_user_uuid,
      payload->'items'
    );

    IF (v_promo_result->>'valid')::boolean = true THEN
      v_final_discount := (v_promo_result->>'discount_cents')::integer;
      v_promo_code_id := (v_promo_result->>'promo_code_id')::uuid;

      -- Update promo code usage count atomically
      UPDATE public.promo_codes 
      SET usage_count = COALESCE(usage_count, 0) + 1 
      WHERE id = v_promo_code_id;
    ELSE
      -- Reject and roll back entire transaction if promo validation fails
      RAISE EXCEPTION 'Promo validation failed: %', (v_promo_result->>'message');
    END IF;
  END IF;

  -- 4. Calculate Final Total and Insert Order
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
    GREATEST(0, v_original_total - v_final_discount),
    payload->>'status',
    payload->>'payment_method',
    payload->>'customer_name',
    payload->>'customer_phone',
    v_user_uuid,
    p_promo_code,
    v_final_discount,
    NOW()
  );

  -- 5. Insert Promo Redemption Audit Record
  IF v_promo_code_id IS NOT NULL THEN
    INSERT INTO public.promo_redemptions (
      promo_code_id,
      order_id,
      user_id,
      discount_amount,
      redeemed_at
    ) VALUES (
      v_promo_code_id,
      order_id,
      v_user_uuid,
      v_final_discount,
      NOW()
    );
  END IF;

  RETURN order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Drop and recreate cancel_order RPC with Add-on Stock Restoration & Waste Logging
DROP FUNCTION IF EXISTS public.cancel_order(text, text, text);
DROP FUNCTION IF EXISTS public.cancel_order(text, text);

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

  -- 3. Mark order as cancelled and record reason
  UPDATE public.orders
  SET 
    status = 'CANCELLED',
    cancel_reason = p_reason
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
