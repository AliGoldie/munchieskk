-- place_order previously trusted payload->>'total' exactly as sent by the client,
-- with no server-side recomputation from real menu_items/addons prices. Any client
-- could place a real order for any price they chose, including 0, independent of
-- every RLS fix around it.
--
-- This replaces that trust with a server-side recompute: for every item in
-- payload->'items', look up the item's LIVE price (respecting an active promo_price
-- window) and its selected add-ons' LIVE prices from public.addons, ignoring
-- whatever 'price' the client attached to the item object. The client-supplied
-- per-item 'price' field is never read.
--
-- This is safe for the free-item/BOGO promo flow: confirmed via src/pages/Payment.jsx
-- that free_item_id/free_item_name come from validate_and_apply_promo's own response
-- (server-computed), and that RPC already receives payload->'items' and computes
-- discount_cents from real data. The free item is priced at its real menu price in
-- this recompute like any other line, and the promo's discount_cents (subtracted
-- below, unchanged) is what makes it free — so this recompute is strictly more
-- correct than before, not a functional change to that flow.
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
  v_user_referrer uuid := NULL;
  v_user_ref_converted timestamptz := NULL;
  v_prior_order_count integer := 0;
  v_item jsonb;
  v_addon jsonb;
  v_menu_price integer;
  v_menu_promo_price integer;
  v_menu_promo_start timestamptz;
  v_menu_promo_end timestamptz;
  v_unit_price integer;
  v_addon_price integer;
  v_addons_total integer;
  v_qty integer;
  v_subtotal integer := 0;
BEGIN
  order_id := payload->>'id';

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
        order_id, addon_id, quantity, stock_before, stock_after, logged_at
      ) VALUES (
        order_id, ad.addon_id, ad.quantity, current_addon_stock, current_addon_stock - ad.quantity, NOW()
      );
    END LOOP;
  END IF;

  -- 3. Recompute subtotal server-side from live prices. Never trust
  --    payload->>'total' or any per-item 'price'/'selectedAddons[].price'
  --    sent by the client.
  IF payload->'items' IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items')
    LOOP
      SELECT price, promo_price, promo_start, promo_end
      INTO v_menu_price, v_menu_promo_price, v_menu_promo_start, v_menu_promo_end
      FROM public.menu_items
      WHERE id = (v_item->>'id');

      IF v_menu_price IS NULL THEN
        RAISE EXCEPTION 'Item % not found for pricing', (v_item->>'id');
      END IF;

      v_unit_price := v_menu_price;
      IF v_menu_promo_price IS NOT NULL
         AND (v_menu_promo_start IS NULL OR now() >= v_menu_promo_start)
         AND (v_menu_promo_end IS NULL OR now() <= v_menu_promo_end) THEN
        v_unit_price := v_menu_promo_price;
      END IF;

      v_addons_total := 0;
      FOR v_addon IN SELECT * FROM jsonb_array_elements(COALESCE(v_item->'selectedAddons', '[]'::jsonb))
      LOOP
        SELECT price INTO v_addon_price
        FROM public.addons
        WHERE id = (v_addon->>'id');

        IF v_addon_price IS NULL THEN
          RAISE EXCEPTION 'Add-on % not found for pricing', (v_addon->>'id');
        END IF;

        v_addons_total := v_addons_total + v_addon_price;
      END LOOP;

      v_qty := COALESCE((v_item->>'quantity')::integer, 1);
      v_subtotal := v_subtotal + ((v_unit_price + v_addons_total) * v_qty);
    END LOOP;
  END IF;

  v_original_total := v_subtotal;

  -- 4. Server-Side Promo Code Validation & Application (now fed the real subtotal)
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

      UPDATE public.promo_codes
      SET usage_count = COALESCE(usage_count, 0) + 1
      WHERE id = v_promo_code_id;
    ELSE
      RAISE EXCEPTION 'Promo validation failed: %', (v_promo_result->>'message');
    END IF;
  END IF;

  -- 5. Calculate Final Total and Insert Order
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

  -- 6. Insert Promo Redemption Audit Record
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

  -- 7. Referral Conversion Check & Award
  IF v_user_uuid IS NOT NULL THEN
    SELECT referred_by, referral_converted_at
    INTO v_user_referrer, v_user_ref_converted
    FROM public.profiles
    WHERE id = v_user_uuid;

    IF v_user_referrer IS NOT NULL AND v_user_ref_converted IS NULL THEN
      SELECT COUNT(*) INTO v_prior_order_count
      FROM public.orders
      WHERE user_id = v_user_uuid
        AND id <> order_id
        AND status <> 'PENDING';

      IF v_prior_order_count = 0 THEN
        UPDATE public.profiles
        SET points = COALESCE(points, 0) + 150
        WHERE id = v_user_referrer;

        UPDATE public.profiles
        SET referral_converted_at = NOW()
        WHERE id = v_user_uuid;

        INSERT INTO public.referral_rewards_log (
          referrer_id, referred_id, reward_type, points_awarded, order_id, logged_at
        ) VALUES (
          v_user_referrer, v_user_uuid, 'referrer_bonus', 150, order_id, NOW()
        );
      END IF;
    END IF;
  END IF;

  RETURN order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
