-- Extend log_grabfood_daily_entry() to also deduct add-on stock and record
-- Grab's own order number, and add a dedicated undo path.
--
-- Staff read GrabFood order details off their own paper log written at
-- order time (the chef doesn't read the Grab tablet directly) and can
-- cross-check the same item/add-on detail, plus the RM payout, per order
-- in the Grab Merchant (GM) app itself -- Grab's emailed Finance report is
-- order-number + RM only, no item breakdown, and isn't needed here. This
-- mirrors the exact addon deduction shape place_order() already uses for
-- web/walk-in orders: lock addons.stock_quantity, deduct, log to
-- addon_deduction_log -- which doubles as the source of truth for undo.

DROP FUNCTION IF EXISTS public.log_grabfood_daily_entry(date, jsonb, integer);
DROP FUNCTION IF EXISTS public.log_grabfood_daily_entry(date, jsonb, integer, jsonb);

CREATE OR REPLACE FUNCTION public.log_grabfood_daily_entry(
  p_entry_date date,
  p_items jsonb,             -- [{"id": "...", "name": "...", "quantity": 3}, ...]
  p_net_total_cents integer,
  p_addon_items jsonb DEFAULT '[]'::jsonb,  -- [{"id": "...", "name": "...", "quantity": 2}, ...]
  p_grab_order_ref text DEFAULT NULL        -- Grab's own order number, e.g. "GF-554"
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  -- GRB-DDMM-### rows for that day, exactly like place_order() does. (The
  -- order_id_counters table this used to read was dropped by
  -- 20260829000001, so the old version failed on every call.)
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
$$;

REVOKE EXECUTE ON FUNCTION public.log_grabfood_daily_entry(date, jsonb, integer, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_grabfood_daily_entry(date, jsonb, integer, jsonb, text) TO authenticated;

-- Undo a mistaken GrabFood daily entry: restores item stock (read straight
-- back off the order's own `items` record) and add-on stock (summed from
-- addon_deduction_log, which is exactly why that log exists), then voids
-- the order the same way cancel_order() voids a live order -- except
-- cancel_order() itself can't be reused here, since it explicitly refuses
-- any order already `status = 'COLLECTED'`, which every GrabFood entry is
-- inserted as (it represents an already-fulfilled sale, not a live one).
CREATE OR REPLACE FUNCTION public.undo_grabfood_daily_entry(
  p_order_id text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel text;
  v_status text;
  v_items jsonb;
  v_item jsonb;
  v_item_id text;
  v_qty integer;
  v_addon_row record;
  v_restored_items jsonb := '[]'::jsonb;
  v_restored_addons jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;

  SELECT channel, status, items INTO v_channel, v_status, v_items
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;

  IF v_channel IS DISTINCT FROM 'Grab' THEN
    RAISE EXCEPTION 'Not a GrabFood entry.';
  END IF;

  IF v_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'This entry has already been undone.';
  END IF;

  IF v_items IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_item_id := v_item->>'id';
      v_qty := COALESCE((v_item->>'quantity')::integer, 0);
      IF v_item_id IS NULL OR v_qty <= 0 THEN
        CONTINUE;
      END IF;

      UPDATE public.menu_items
      SET stock_quantity = COALESCE(stock_quantity, 0) + v_qty,
          in_stock = true
      WHERE id = v_item_id;

      IF FOUND THEN
        v_restored_items := v_restored_items || jsonb_build_array(jsonb_build_object('id', v_item_id, 'quantity', v_qty));
      END IF;
    END LOOP;
  END IF;

  FOR v_addon_row IN
    SELECT addon_id, SUM(quantity) AS total_qty
    FROM public.addon_deduction_log
    WHERE order_id = p_order_id
    GROUP BY addon_id
  LOOP
    UPDATE public.addons
    SET stock_quantity = COALESCE(stock_quantity, 0) + v_addon_row.total_qty,
        in_stock = true
    WHERE id = v_addon_row.addon_id;

    IF FOUND THEN
      v_restored_addons := v_restored_addons || jsonb_build_array(jsonb_build_object('id', v_addon_row.addon_id, 'quantity', v_addon_row.total_qty));
    END IF;
  END LOOP;

  UPDATE public.orders
  SET status = 'CANCELLED',
      cancel_reason = 'GrabFood entry corrected',
      cancel_note = NULLIF(TRIM(BOTH FROM p_note), '')
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'restored_items', v_restored_items,
    'restored_addons', v_restored_addons
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.undo_grabfood_daily_entry(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_grabfood_daily_entry(text, text) TO authenticated;
