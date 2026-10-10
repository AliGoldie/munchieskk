-- Order integrity hardening (security audit, 2026-10-11).
--
-- Found by reading the live functions and reproducing each issue on an
-- exact copy of them (supabase/tests/order_integrity.test.sql):
--
--   1. FREE FOOD: place_order() trusted the browser's item quantities. A
--      NEGATIVE quantity on a cheap item subtracted from the order total
--      (a RM69.90 platter cost RM0.00) and ADDED to that item's stock.
--   2. SKIP THE KITCHEN: the order status came from the browser too, so an
--      order could be placed already COLLECTED (then farm claim_share_bonus).
--   3. INFINITE POINTS: points are awarded when an order is placed, but
--      cancelling never took them back: place + cancel in a loop = unlimited
--      points, with the stock returned each time.
--   4. Anyone with the public key could place orders without logging in
--      (stock-drain spam) and cancel / collect other people's guest orders,
--      because order ids are sequential and "no owner" matched "no login".
--   5. award_engagement_points() was callable by anyone for any user. (Earlier
--      migrations REVOKEd it from PUBLIC, but Supabase also grants EXECUTE to
--      anon/authenticated directly, so that revoke did nothing.)
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1 + 2 + 4. place_order: login required, validated quantities, forced PENDING
-- ---------------------------------------------------------------------------
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
  v_referrer_bonus_count integer := 0;
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
  v_referral_cap constant integer := 5;
  v_max_line_qty constant integer := 50;
  v_max_open_orders constant integer := 5;
  v_open_orders integer;
BEGIN
  -- Ordering needs a signed-in customer. The app already sends everyone to
  -- the login page at checkout; this makes the server enforce it too, so the
  -- public API key alone can no longer be used to spam orders and drain stock.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Please log in to place an order.';
  END IF;

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

  -- A customer can only have a few unpaid/unaccepted orders open at once.
  SELECT COUNT(*) INTO v_open_orders
  FROM public.orders
  WHERE user_id = v_user_uuid AND status = 'PENDING';
  IF v_open_orders >= v_max_open_orders THEN
    RAISE EXCEPTION 'You already have % orders waiting. Please wait for the kitchen to accept them first.', v_open_orders;
  END IF;

  -- Quantities come straight from the customer's browser. They must be whole
  -- numbers from 1 up to a sane cap: a zero or NEGATIVE quantity used to
  -- subtract from an order's total (free food) and ADD to stock.
  IF deductions IS NOT NULL AND jsonb_typeof(deductions) = 'array' THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_to_recordset(deductions) AS x(item_id text, quantity integer)
      WHERE x.item_id IS NULL OR x.quantity IS NULL OR x.quantity < 1 OR x.quantity > v_max_line_qty
    ) THEN
      RAISE EXCEPTION 'Invalid item quantity in your order.';
    END IF;
  END IF;
  IF addon_deductions IS NOT NULL AND jsonb_typeof(addon_deductions) = 'array' THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_to_recordset(addon_deductions) AS y(addon_id text, quantity integer)
      WHERE y.addon_id IS NULL OR y.quantity IS NULL OR y.quantity < 1 OR y.quantity > v_max_line_qty * 10
    ) THEN
      RAISE EXCEPTION 'Invalid add-on quantity in your order.';
    END IF;
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

  IF jsonb_array_length(v_items_verified) = 0 OR v_subtotal <= 0 THEN
    RAISE EXCEPTION 'Your order is empty.';
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
    'PENDING', -- never trust a client-supplied status: every order starts PENDING
    LEFT(payload->>'payment_method', 30),
    LEFT(payload->>'customer_name', 80),
    LEFT(payload->>'customer_phone', 20),
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
  --    calls for that same referred user, closing the double-award race for
  --    a single referral. The referrer's own profile row is separately
  --    locked below, right before counting their past bonuses, closing the
  --    multi-referred-user race against the per-referrer cap.
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
        -- Lock the referrer's row before counting their past bonuses so two
        -- different referred users converting at the same instant can't
        -- both read "4 so far" and both push the referrer past the cap.
        PERFORM 1 FROM public.profiles WHERE id = v_user_referrer FOR UPDATE;

        SELECT COUNT(*) INTO v_referrer_bonus_count
        FROM public.referral_rewards_log
        WHERE referrer_id = v_user_referrer AND reward_type = 'referrer_bonus';

        IF v_referrer_bonus_count < v_referral_cap THEN
          UPDATE public.profiles
          SET points = COALESCE(points, 0) + 150
          WHERE id = v_user_referrer;

          INSERT INTO public.referral_rewards_log (
            referrer_id, referred_id, reward_type, points_awarded, order_id, logged_at
          ) VALUES (
            v_user_referrer, v_user_uuid, 'referrer_bonus', 150, order_id, NOW()
          );
        END IF;

        -- Marked regardless of whether the referrer's cap was already hit --
        -- this referred user's own conversion only ever needs evaluating once.
        UPDATE public.profiles
        SET referral_converted_at = NOW()
        WHERE id = v_user_uuid;
      END IF;
    END IF;
  END IF;

  RETURN order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.place_order(jsonb, jsonb, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(jsonb, jsonb, text, text, jsonb, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3 + 4. cancel_order: owner or admin only, and points are taken back
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. collect_order: same owner-or-admin rule (no more anonymous "NULL = NULL")
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.collect_order(p_order_id text)
RETURNS boolean AS $$
DECLARE
  v_owner uuid;
  v_status text;
BEGIN
  SELECT user_id, status INTO v_owner, v_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  IF NOT public.is_admin() AND (v_owner IS NULL OR v_owner IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to collect this order';
  END IF;

  IF v_status <> 'READY' THEN
    RAISE EXCEPTION 'Order % is not ready for collection (current status: %)', p_order_id, v_status;
  END IF;

  UPDATE public.orders SET status = 'COLLECTED' WHERE id = p_order_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.collect_order(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collect_order(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Server-only and login-only functions: no access for the public key.
--    The game/reward functions call award_engagement_points() as their owner,
--    so they keep working.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'award_engagement_points'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'claim_munchman_reward', 'claim_share_bonus', 'claim_speed_grab_reward',
        'claim_trex_runner_reward', 'start_munchman_session',
        'start_speed_grab_session', 'start_trex_runner_session',
        'check_can_play_munchman', 'get_user_rank', 'redeem_prize',
        'fulfill_redemption', 'log_grabfood_daily_entry',
        'undo_grabfood_daily_entry', 'record_closing_stock'
      ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Defence in depth. Row-level security already blocks these, but the public
-- (anon) key was also granted raw INSERT/UPDATE/DELETE/TRUNCATE on every
-- table. Nothing in the app writes with it (writes go through functions that
-- run as the owner), so take it away -- one less thing to get wrong in a
-- future policy. Signed-in customers keep their normal grants (RLS still
-- limits them); nobody needs TRUNCATE.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated;

-- A leftover policy named "_test_probe_policy" on orders (always false, so
-- harmless, but it should not be in production).
DROP POLICY IF EXISTS "_test_probe_policy" ON public.orders;
