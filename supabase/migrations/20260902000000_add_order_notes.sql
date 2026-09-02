-- Let customers leave a short note ("no onions", "extra napkins please") when
-- checking out. place_order() is the only insert path into public.orders
-- (see 20260825000004_lock_down_orders_insert.sql), so the new p_notes
-- argument has to be threaded through it for a note to ever reach the table.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS notes text;

DROP FUNCTION IF EXISTS public.place_order(jsonb, jsonb, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.place_order(
  deductions jsonb,
  payload jsonb,
  p_promo_code text DEFAULT NULL,
  p_user_id text DEFAULT NULL,
  addon_deductions jsonb DEFAULT '[]'::jsonb,
  p_notes text DEFAULT NULL
) RETURNS text AS $$
DECLARE
  d record;
  ad record;
  current_stock integer;
  current_addon_stock integer;
  order_id text;
  v_day_key text;
  v_seq_name text;
  v_seed integer;
  v_counter bigint;
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
  v_notes text;
BEGIN
  -- Mint the order id from a non-transactional per-day sequence (see
  -- migration header) instead of a table counter, so a failed attempt can
  -- never make a later attempt reproduce the same id.
  v_day_key := to_char(NOW(), 'DDMM');
  v_seq_name := 'order_seq_' || v_day_key;

  IF to_regclass('public.' || v_seq_name) IS NULL THEN
    SELECT COALESCE(MAX(substring(id from 9)::integer), 0)
    INTO v_seed
    FROM public.orders
    WHERE id ~ ('^MP-' || v_day_key || '-[0-9]{3}$');

    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS public.%I START %s', v_seq_name, v_seed + 1);
  END IF;

  EXECUTE format('SELECT nextval(%L)', 'public.' || v_seq_name) INTO v_counter;
  order_id := 'MP-' || v_day_key || '-' || lpad(v_counter::text, 3, '0');

  -- Trim and cap server-side too — the client enforces a 300-char limit but
  -- this is the only insert path into orders, so it's the actual boundary.
  v_notes := NULLIF(LEFT(TRIM(BOTH FROM p_notes), 300), '');

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
    notes,
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
    v_notes,
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
