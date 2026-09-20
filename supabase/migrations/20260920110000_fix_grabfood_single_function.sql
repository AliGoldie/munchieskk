-- log_grabfood_daily_entry() minted its order id from public.order_id_counters,
-- a table 20260829000001 already dropped in favour of per-day sequences, so every
-- GrabFood entry failed with 'relation "public.order_id_counters" does not exist'.
--
-- The live function is the 5-argument version (add-on stock + Grab order ref)
-- from the claude/grabfood-addon-stock branch, which was applied to the database
-- directly and carries the same bug. 20260919151217 (in main) had also just been
-- re-applied, recreating the older 3-argument overload next to it, which makes
-- calls with three named args ambiguous. Drop that overload and keep one function,
-- with the counter block replaced by the same sequence approach place_order() uses.
-- Everything else below is the live body, unchanged.

DROP FUNCTION IF EXISTS public.log_grabfood_daily_entry(date, jsonb, integer);

CREATE OR REPLACE FUNCTION public.log_grabfood_daily_entry(p_entry_date date, p_items jsonb, p_net_total_cents integer, p_addon_items jsonb DEFAULT '[]'::jsonb, p_grab_order_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_day_key text;
  v_seq_name text;
  v_seed integer;
  v_counter integer;
  v_order_id text;
  v_item jsonb;
  v_item_id text;
  v_item_name text;
  v_qty integer;
  v_current_stock integer;
  v_unmapped jsonb := '[]'::jsonb;
  v_deducted jsonb := '[]'::jsonb;
  v_addon_deducted jsonb := '[]'::jsonb;
  v_addon_unmapped jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;

  IF p_entry_date IS NULL THEN
    RAISE EXCEPTION 'Entry date is required.';
  END IF;

  IF p_net_total_cents IS NULL OR p_net_total_cents < 0 THEN
    RAISE EXCEPTION 'Invalid net total.';
  END IF;

  -- Mint the id from a non-transactional per-day sequence (distinct GRB-
  -- prefix from place_order()'s MP-DDMM-### ids), seeded from any existing
  -- GRB-DDMM-### rows for that day, exactly like place_order() does.
  v_day_key := to_char(p_entry_date, 'DDMM');
  v_seq_name := 'grb_order_seq_' || v_day_key;

  IF to_regclass('public.' || v_seq_name) IS NULL THEN
    SELECT COALESCE(MAX(substring(id from 10)::integer), 0)
    INTO v_seed
    FROM public.orders
    WHERE id ~ ('^GRB-' || v_day_key || '-[0-9]{3}$');

    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS public.%I START %s', v_seq_name, v_seed + 1);
  END IF;

  EXECUTE format('SELECT nextval(%L)', 'public.' || v_seq_name) INTO v_counter;
  v_order_id := 'GRB-' || v_day_key || '-' || lpad(v_counter::text, 3, '0');

  -- Malaysia midnight of the entry date, explicit +08:00 -- not a bare
  -- date cast, which Postgres would read as UTC midnight (the exact class
  -- of off-by-one-day bug this app's timezone fix addressed elsewhere).
  -- Store items + add-ons together for display/history (this table's
  -- "Items" column reads straight off orders.items) -- the deduction loops
  -- below still process p_items and p_addon_items separately, since they
  -- hit different tables (menu_items vs addons).
  INSERT INTO public.orders (
    id, channel, status, total, items, payment_method,
    customer_name, customer_phone, notes, created_at
  ) VALUES (
    v_order_id, 'Grab', 'COLLECTED', p_net_total_cents,
    COALESCE(p_items, '[]'::jsonb) || COALESCE(p_addon_items, '[]'::jsonb), 'GrabFood',
    'GrabFood (daily batch)', 'No Phone', NULLIF(TRIM(BOTH FROM p_grab_order_ref), ''),
    (p_entry_date::text || 'T00:00:00+08:00')::timestamptz
  );

  IF p_items IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_item_id := v_item->>'id';
      v_item_name := v_item->>'name';
      v_qty := COALESCE((v_item->>'quantity')::integer, 0);

      IF v_item_id IS NULL OR v_qty <= 0 THEN
        CONTINUE;
      END IF;

      SELECT stock_quantity INTO v_current_stock
      FROM public.menu_items
      WHERE id = v_item_id
      FOR UPDATE;

      IF NOT FOUND THEN
        v_unmapped := v_unmapped || jsonb_build_array(jsonb_build_object('id', v_item_id, 'name', v_item_name, 'quantity', v_qty));
        CONTINUE;
      END IF;

      UPDATE public.menu_items
      SET stock_quantity = GREATEST(0, COALESCE(v_current_stock, 0) - v_qty),
          in_stock = GREATEST(0, COALESCE(v_current_stock, 0) - v_qty) > 0
      WHERE id = v_item_id;

      v_deducted := v_deducted || jsonb_build_array(jsonb_build_object('id', v_item_id, 'name', v_item_name, 'quantity', v_qty));
    END LOOP;
  END IF;

  IF p_addon_items IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_addon_items)
    LOOP
      v_item_id := v_item->>'id';
      v_item_name := v_item->>'name';
      v_qty := COALESCE((v_item->>'quantity')::integer, 0);

      IF v_item_id IS NULL OR v_qty <= 0 THEN
        CONTINUE;
      END IF;

      SELECT stock_quantity INTO v_current_stock
      FROM public.addons
      WHERE id = v_item_id
      FOR UPDATE;

      IF NOT FOUND THEN
        v_addon_unmapped := v_addon_unmapped || jsonb_build_array(jsonb_build_object('id', v_item_id, 'name', v_item_name, 'quantity', v_qty));
        CONTINUE;
      END IF;

      UPDATE public.addons
      SET stock_quantity = GREATEST(0, COALESCE(v_current_stock, 0) - v_qty),
          in_stock = GREATEST(0, COALESCE(v_current_stock, 0) - v_qty) > 0
      WHERE id = v_item_id;

      INSERT INTO public.addon_deduction_log (
        order_id, addon_id, quantity, stock_before, stock_after, logged_at
      ) VALUES (
        v_order_id, v_item_id, v_qty, v_current_stock, GREATEST(0, COALESCE(v_current_stock, 0) - v_qty), NOW()
      );

      v_addon_deducted := v_addon_deducted || jsonb_build_array(jsonb_build_object('id', v_item_id, 'name', v_item_name, 'quantity', v_qty));
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'deducted_items', v_deducted,
    'unmapped_items', v_unmapped,
    'deducted_addons', v_addon_deducted,
    'unmapped_addons', v_addon_unmapped
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.log_grabfood_daily_entry(date, jsonb, integer, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_grabfood_daily_entry(date, jsonb, integer, jsonb, text) TO authenticated;
