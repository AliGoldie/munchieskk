-- Make the Grab order number (GF-555, GF-2484) a required, unique title for every
-- GrabFood entry, so a cashier can always find an entry by the number she typed.
--
--   * required, trimmed and upper-cased ('gf-555 ' == 'GF-555')
--   * an active entry with the same number blocks a second one (which would
--     deduct the stock twice); a voided/undone entry does NOT, so a mistake can
--     be undone and re-entered under the same number
--   * a partial unique index enforces that at the database level too
--
-- DEPLOY ORDER: this makes p_grab_order_ref mandatory. The GrabFood form on
-- main (no Grab # field) would start failing as soon as this is applied, so
-- apply it only once the branch's form (which requires the number) is live.

CREATE UNIQUE INDEX IF NOT EXISTS orders_grab_ref_active_uniq
  ON public.orders (upper(notes))
  WHERE channel = 'Grab' AND status <> 'CANCELLED' AND notes IS NOT NULL;

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
  v_ref text;
  v_existing text;
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

  -- The Grab order number (GF-555, GF-2484) is the entry's title and how staff
  -- find it later, so it is required. Normalised (spaces stripped, upper-case)
  -- so 'gf-555 ' and 'GF-555' are the same number.
  v_ref := upper(regexp_replace(btrim(COALESCE(p_grab_order_ref, '')), '\s+', '', 'g'));
  IF v_ref = '' THEN
    RAISE EXCEPTION 'Grab order number is required (e.g. GF-554).';
  END IF;
  IF length(v_ref) > 40 THEN
    RAISE EXCEPTION 'Grab order number is too long.';
  END IF;

  -- Each Grab order is unique: logging one twice would deduct its stock twice.
  -- Voided (undone) entries don't count, so a mistake can be undone and
  -- re-entered under the same number.
  SELECT id INTO v_existing
  FROM public.orders
  WHERE channel = 'Grab' AND status <> 'CANCELLED' AND upper(notes) = v_ref
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Grab order % is already logged (as %). If that entry was a mistake, undo it first.', v_ref, v_existing;
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
  BEGIN
    INSERT INTO public.orders (
      id, channel, status, total, items, payment_method,
      customer_name, customer_phone, notes, created_at
    ) VALUES (
      v_order_id, 'Grab', 'COLLECTED', p_net_total_cents,
      COALESCE(p_items, '[]'::jsonb) || COALESCE(p_addon_items, '[]'::jsonb), 'GrabFood',
      'GrabFood (daily batch)', 'No Phone', v_ref,
      (p_entry_date::text || 'T00:00:00+08:00')::timestamptz
    );
  EXCEPTION WHEN unique_violation THEN
    -- Backstop for two submissions of the same number landing at once, which
    -- both pass the check above: the unique index below rejects the second.
    RAISE EXCEPTION 'Grab order % is already logged.', v_ref;
  END;

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
    'grab_order_ref', v_ref,
    'deducted_items', v_deducted,
    'unmapped_items', v_unmapped,
    'deducted_addons', v_addon_deducted,
    'unmapped_addons', v_addon_unmapped
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_grabfood_daily_entry(date, jsonb, integer, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_grabfood_daily_entry(date, jsonb, integer, jsonb, text) TO authenticated;
