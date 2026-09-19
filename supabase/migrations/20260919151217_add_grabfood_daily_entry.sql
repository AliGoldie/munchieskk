-- GrabFood daily-batch entry: a dedicated, low-effort way to get GrabFood
-- sales and stock into the CRM without either (a) replacing the Grab
-- merchant tablet with a live accept/reject integration, or (b) manually
-- re-entering every individual GrabFood order like a Loyverse walk-in sale
-- (which was also silently polluting Loyverse's own walk-in revenue total).
--
-- Once a day, staff read two numbers off Grab's own merchant portal --
-- items sold (for stock) and net settled payout (for revenue, already
-- correct after commission/SST/promo funding, which is not something this
-- app tries to recompute -- see the app conversation this shipped from) --
-- and this RPC turns that into one `orders` row (channel='Grab', matching
-- the existing Order History filter) plus a stock deduction per item,
-- mirroring the exact deduction shape `deduct_stock_for_loyverse` already
-- uses for the Loyverse webhook.
--
-- Runs as a single SECURITY DEFINER transaction (order insert + every
-- stock deduction together) so a partial failure can't leave the order
-- recorded with only some of its stock deducted.

CREATE OR REPLACE FUNCTION public.log_grabfood_daily_entry(
  p_entry_date date,
  p_items jsonb,             -- [{"id": "...", "name": "...", "quantity": 3}, ...]
  p_net_total_cents integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day_key text;
  v_counter integer;
  v_order_id text;
  v_item jsonb;
  v_item_id text;
  v_item_name text;
  v_qty integer;
  v_current_stock integer;
  v_unmapped jsonb := '[]'::jsonb;
  v_deducted jsonb := '[]'::jsonb;
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

  -- Own day-keyed counter sequence (distinct prefix from place_order()'s
  -- 'MP-DDMM-###' web-order ids) via the same atomic
  -- INSERT ... ON CONFLICT DO UPDATE pattern, so concurrent admin submits
  -- can never collide on the same order id.
  v_day_key := 'GRB' || to_char(p_entry_date, 'DDMM');
  INSERT INTO public.order_id_counters (day_key, counter)
  VALUES (v_day_key, 1)
  ON CONFLICT (day_key) DO UPDATE SET counter = public.order_id_counters.counter + 1
  RETURNING counter INTO v_counter;
  v_order_id := 'GRB-' || to_char(p_entry_date, 'DDMM') || '-' || lpad(v_counter::text, 3, '0');

  -- Malaysia midnight of the entry date, explicit +08:00 -- not a bare
  -- date cast, which Postgres would read as UTC midnight (the exact class
  -- of off-by-one-day bug this app's timezone fix addressed elsewhere).
  INSERT INTO public.orders (
    id, channel, status, total, items, payment_method,
    customer_name, customer_phone, created_at
  ) VALUES (
    v_order_id, 'Grab', 'COLLECTED', p_net_total_cents, COALESCE(p_items, '[]'::jsonb), 'GrabFood',
    'GrabFood (daily batch)', 'No Phone', (p_entry_date::text || 'T00:00:00+08:00')::timestamptz
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

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'deducted_items', v_deducted,
    'unmapped_items', v_unmapped
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_grabfood_daily_entry(date, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_grabfood_daily_entry(date, jsonb, integer) TO authenticated;
