-- Pre-launch audit found place_order() and cancel_order() -- the two RPCs
-- that actually create/void a real order -- never checked who was calling
-- them, unlike every sibling RPC in this file's history (collect_order,
-- claim_share_bonus, redeem_prize all correctly gate on auth.uid()/is_admin()).
--
-- Concretely, before this migration:
--   1. place_order() took v_user_uuid straight from the client-supplied
--      p_user_id parameter with no check against auth.uid() at all. A logged-in
--      attacker could pass any other user's UUID and have a real order (stock
--      deduction, loyalty points via the order-placed trigger, even a 150-pt
--      referral bonus) attributed to a victim's account instead of their own.
--   2. place_order() never read store_settings, so the OPEN/CLOSED/PAUSED gate
--      that isShopOpenNow() enforces client-side (StoreContext.jsx) was purely
--      cosmetic -- anyone could call the RPC directly (devtools, curl) with the
--      public anon key and place real orders, draining real stock, at any hour.
--   3. cancel_order() had no ownership check whatsoever -- unlike collect_order
--      (which correctly requires auth.uid() = owner OR is_admin()), anyone who
--      knew or guessed an order id (format MP-DDMM-### is sequential, so this
--      is trivial) could cancel any live order and restore/waste its stock.
--   4. The referral-bonus award inside place_order read the referred user's
--      profile without locking the row, so two concurrent first-orders for the
--      same newly-referred user could both pass the "is this their first
--      order" check before either committed, paying the referrer 300 points
--      instead of 150.
--
-- Guest checkout (ordering without an account, p_user_id/user_id NULL) is a
-- deliberate, real feature of this app (Payment.jsx passes user?.id || null),
-- so this fix does NOT require auth.uid() to be non-null -- it only ever
-- trusts auth.uid() over the client-supplied value, never invents a
-- requirement to log in. cancel_order's ownership check follows the exact
-- same pattern collect_order already uses, including its (intentional) "NULL
-- IS DISTINCT FROM NULL is false" behavior that lets an anonymous caller
-- manage a guest order they placed -- guest "auth" is knowing the order id,
-- same as collect_order already assumes.

-- Mirrors utils/timeUtils.js's parseTimeToMinutes() exactly (including its
-- "bare 1-6 defaults to PM" rule), so the server-side open/closed check
-- below parses opening/closing-time strings identically to the client.
CREATE OR REPLACE FUNCTION public.parse_time_to_minutes(p_time text, p_default text DEFAULT '17:00')
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_str text;
  v_is_pm boolean;
  v_is_am boolean;
  v_digits text;
  v_h int;
  v_m int;
BEGIN
  v_str := lower(trim(COALESCE(NULLIF(p_time, ''), p_default)));
  v_is_pm := v_str LIKE '%pm%';
  v_is_am := v_str LIKE '%am%';
  v_digits := regexp_replace(v_str, '[^0-9:]', '', 'g');

  v_h := COALESCE(NULLIF(split_part(v_digits, ':', 1), '')::int, 17);
  v_m := COALESCE(NULLIF(split_part(v_digits, ':', 2), '')::int, 0);

  IF v_is_pm AND v_h < 12 THEN
    v_h := v_h + 12;
  ELSIF NOT v_is_am AND NOT v_is_pm AND v_h BETWEEN 1 AND 6 THEN
    v_h := v_h + 12;
  ELSIF v_is_am AND v_h = 12 THEN
    v_h := 0;
  END IF;

  RETURN v_h * 60 + v_m;
END;
$$;

-- Mirrors StoreContext.jsx's isShopOpenNow() exactly: same precedence
-- (manual OPEN/CLOSED/PAUSED status always wins; anything else falls through
-- to special closures, then today's weekly-schedule entry, then the global
-- opening/closing-time fallback), same Malaysia wall-clock source. This is
-- the one place the "is the shop actually open" decision is now enforced
-- for real, instead of trusting the client not to skip its own copy of it.
CREATE OR REPLACE FUNCTION public.is_store_open_now()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_weekly jsonb;
  v_closures jsonb;
  v_opening text;
  v_closing text;
  v_my_ts timestamp;
  v_my_date date;
  v_dow int;
  v_day_key text;
  v_current_mins int;
  v_today_schedule jsonb;
  v_open_mins int;
  v_close_mins int;
BEGIN
  SELECT status, weekly_schedule, special_closures, opening_time, closing_time
  INTO v_status, v_weekly, v_closures, v_opening, v_closing
  FROM public.store_settings
  WHERE id = 'main_store';

  IF v_status = 'OPEN' THEN
    RETURN true;
  END IF;
  IF v_status = 'CLOSED' OR v_status = 'PAUSED' THEN
    RETURN false;
  END IF;

  v_my_ts := (now() AT TIME ZONE 'Asia/Kuala_Lumpur');
  v_my_date := v_my_ts::date;
  v_dow := EXTRACT(DOW FROM v_my_ts)::int; -- 0=Sun..6=Sat, matches JS getDay()
  v_day_key := (ARRAY['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[v_dow + 1];
  v_current_mins := EXTRACT(HOUR FROM v_my_ts)::int * 60 + EXTRACT(MINUTE FROM v_my_ts)::int;

  IF v_closures IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_closures) c
    WHERE c->>'date' = to_char(v_my_date, 'YYYY-MM-DD')
  ) THEN
    RETURN false;
  END IF;

  v_today_schedule := v_weekly -> v_day_key;
  IF v_today_schedule IS NOT NULL THEN
    IF COALESCE((v_today_schedule->>'enabled')::boolean, true) = false THEN
      RETURN false;
    END IF;
    v_open_mins := public.parse_time_to_minutes(v_today_schedule->>'open', '17:00');
    v_close_mins := public.parse_time_to_minutes(v_today_schedule->>'close', '23:00');
    IF v_open_mins <= v_close_mins THEN
      RETURN v_current_mins >= v_open_mins AND v_current_mins <= v_close_mins;
    ELSE
      RETURN v_current_mins >= v_open_mins OR v_current_mins <= v_close_mins;
    END IF;
  END IF;

  v_open_mins := public.parse_time_to_minutes(v_opening, '17:00');
  v_close_mins := public.parse_time_to_minutes(v_closing, '23:00');
  IF v_open_mins <= v_close_mins THEN
    RETURN v_current_mins >= v_open_mins AND v_current_mins <= v_close_mins;
  ELSE
    RETURN v_current_mins >= v_open_mins OR v_current_mins <= v_close_mins;
  END IF;
END;
$$;

-- Same signature as the live function (20260902000000_add_order_notes.sql,
-- search_path-pinned by 20260918000000_security_lint_fixes.sql) -- only the
-- body changes: a store-open gate up front, auth.uid() replacing the
-- client-supplied p_user_id for identity, and a row lock on the referral
-- check. p_user_id is kept in the signature (still harmlessly accepted from
-- the frontend) but its value is no longer trusted for anything.
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
  -- Server-side store-open gate. Fails fast, before any stock is touched.
  IF NOT public.is_store_open_now() THEN
    RAISE EXCEPTION 'Store is currently closed. Online ordering is not available right now.';
  END IF;

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

  -- Identity always comes from the caller's own JWT, never from a
  -- client-supplied parameter. An unauthenticated caller places a guest
  -- order (user_id NULL) exactly as before -- they just can no longer claim
  -- to be someone else, and a logged-in caller can no longer be spoofed into
  -- placing an order (and its referral bonus) under a different account.
  v_user_uuid := auth.uid();

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

  -- 7. Referral Conversion Check & Award. The FOR UPDATE lock on the
  --    referred user's own profile row serializes concurrent place_order
  --    calls for that same user, so a second concurrent call always sees
  --    the first call's referral_converted_at write before deciding whether
  --    to award the referrer -- closing a real double-award race.
  IF v_user_uuid IS NOT NULL THEN
    SELECT referred_by, referral_converted_at
    INTO v_user_referrer, v_user_ref_converted
    FROM public.profiles
    WHERE id = v_user_uuid
    FOR UPDATE;

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Guest checkout genuinely needs anon to call this -- there's no login
-- requirement to order. Explicit grant/revoke (rather than relying on the
-- implicit PUBLIC default) so the intent is auditable instead of accidental.
REVOKE EXECUTE ON FUNCTION public.place_order(jsonb, jsonb, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_order(jsonb, jsonb, text, text, jsonb, text) TO anon, authenticated;

-- Same signature as the live function (20260902000003_add_cancel_note.sql,
-- search_path-pinned by 20260918000000_security_lint_fixes.sql) -- adds the
-- same ownership check collect_order already uses. Guest orders (user_id
-- NULL) remain cancellable by an anonymous caller, matching collect_order's
-- existing behavior: knowing the order id is the only "credential" a guest
-- ever has.
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
BEGIN
  -- 1. Get current order status, items, and owner with row lock
  SELECT status, items, user_id INTO v_order_status, v_order_items, v_owner
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  -- 2. Validate order exists and can be cancelled
  IF v_order_status IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_owner IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
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

REVOKE EXECUTE ON FUNCTION public.cancel_order(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_order(text, text, text, text) TO anon, authenticated;
