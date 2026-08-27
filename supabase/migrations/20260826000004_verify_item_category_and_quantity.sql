-- CRITICAL FIX: place_order stored orders.items verbatim from the client, and
-- trg_order_placed_award_points (recreated in this same session — see notes
-- below) awards points purely from that stored items[].category/quantity.
-- Verified live and exploitable: a direct RPC call claiming a real item's
-- category as "PLATTERS" (30pts) and quantity 50, with an EMPTY deductions
-- array (no real stock touched), awarded +1500 real points for a fake order.
--
-- This closes it by:
--   1. Sourcing `category` and `price` from the LIVE menu_items row, never
--      from the client's claim (also fixes admin analytics trusting a
--      client-supplied per-line price, the original ask that led here).
--   2. Capping the quantity actually priced/stored/points-eligible per item
--      at how much was ACTUALLY deducted from real stock for that item id
--      (via a running pool built from `deductions`), not the client's
--      independently-claimed items[].quantity. Two cart lines sharing an
--      item id are capped against the same pool cumulatively, so splitting
--      a claim across lines can't double-credit it.
--   3. Same treatment for add-on prices (already partially done) plus names.
--
-- Side effect (intentional, not a regression): a legitimate free/BOGO promo
-- line has no corresponding `deductions` entry (the client already skips
-- stock deduction for it), so its verified quantity is correctly 0 — a $0
-- promotional item contributing 0 points is the desired behavior, not a bug.
--
-- NOTE ON WHY THIS MIGRATION EXISTS: 20260825000002/20260825000003 (the
-- points-trigger migrations from the prior session) were discovered THIS
-- session to have never actually been applied to production, despite being
-- marked applied in git/handoff history — customers earned zero order
-- placement/collection points until they were manually re-applied moments
-- before this migration. Re-verify this class of drift periodically.
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
  v_item_id text;
  v_menu_name text;
  v_menu_category text;
  v_menu_price integer;
  v_menu_promo_price integer;
  v_menu_promo_start timestamptz;
  v_menu_promo_end timestamptz;
  v_unit_price integer;
  v_base_unit_price integer;
  v_addon_id text;
  v_addon_name text;
  v_addon_price integer;
  v_addons_json jsonb;
  v_claimed_qty integer;
  v_available_qty integer;
  v_verified_qty integer;
  v_ded_pool jsonb := '{}'::jsonb;
  v_subtotal integer := 0;
  v_items_verified jsonb := '[]'::jsonb;
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

      -- Build the verified-quantity pool from the same deductions that were
      -- just bounds-checked against real stock above.
      v_ded_pool := jsonb_set(
        v_ded_pool,
        ARRAY[d.item_id],
        to_jsonb(COALESCE((v_ded_pool->>d.item_id)::integer, 0) + d.quantity)
      );
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

  -- 3. Recompute subtotal AND rebuild the stored items array entirely from
  --    server-verified data: live category/price (never the client's claim)
  --    and a quantity capped at what was actually deducted from real stock.
  IF payload->'items' IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items')
    LOOP
      v_item_id := v_item->>'id';

      SELECT name, category, price, promo_price, promo_start, promo_end
      INTO v_menu_name, v_menu_category, v_menu_price, v_menu_promo_price, v_menu_promo_start, v_menu_promo_end
      FROM public.menu_items
      WHERE id = v_item_id;

      IF v_menu_price IS NULL THEN
        RAISE EXCEPTION 'Item % not found for pricing', v_item_id;
      END IF;

      v_base_unit_price := v_menu_price;
      IF v_menu_promo_price IS NOT NULL
         AND (v_menu_promo_start IS NULL OR now() >= v_menu_promo_start)
         AND (v_menu_promo_end IS NULL OR now() <= v_menu_promo_end) THEN
        v_base_unit_price := v_menu_promo_price;
      END IF;
      v_unit_price := v_base_unit_price;

      v_claimed_qty := COALESCE((v_item->>'quantity')::integer, 1);
      v_available_qty := COALESCE((v_ded_pool->>v_item_id)::integer, 0);
      v_verified_qty := LEAST(GREATEST(v_claimed_qty, 0), v_available_qty);
      v_ded_pool := jsonb_set(v_ded_pool, ARRAY[v_item_id], to_jsonb(v_available_qty - v_verified_qty));

      v_addons_json := '[]'::jsonb;
      FOR v_addon IN SELECT * FROM jsonb_array_elements(COALESCE(v_item->'selectedAddons', '[]'::jsonb))
      LOOP
        v_addon_id := v_addon->>'id';
        SELECT name, price INTO v_addon_name, v_addon_price
        FROM public.addons
        WHERE id = v_addon_id;

        IF v_addon_price IS NULL THEN
          RAISE EXCEPTION 'Add-on % not found for pricing', v_addon_id;
        END IF;

        v_addons_json := v_addons_json || jsonb_build_object('id', v_addon_id, 'name', v_addon_name, 'price', v_addon_price);
        v_unit_price := v_unit_price + v_addon_price;
      END LOOP;

      v_subtotal := v_subtotal + (v_unit_price * v_verified_qty);

      v_items_verified := v_items_verified || jsonb_build_object(
        'id', v_item_id,
        'name', COALESCE(v_item->>'name', v_menu_name),
        'category', v_menu_category,
        'price', v_base_unit_price,
        'quantity', v_verified_qty,
        'selectedAddons', v_addons_json
      );
    END LOOP;
  END IF;

  v_original_total := v_subtotal;

  -- 4. Server-Side Promo Code Validation & Application (fed the real subtotal)
  IF p_promo_code IS NOT NULL AND p_promo_code <> '' THEN
    v_promo_result := validate_and_apply_promo(
      p_promo_code,
      v_original_total,
      v_user_uuid,
      v_items_verified
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

  -- 5. Calculate Final Total and Insert Order (items are now the server-verified array)
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
    v_items_verified,
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
