-- Meat swaps (Rewards plan v2 / menu update, 23 Oct 2026).
--
-- A customer can change the meat in a burger, and platters have one choice per
-- burger slot. One ladder everywhere (owner + finance decision, 23 Oct 2026):
--     beef 0, chicken +RM1, lamb +RM2
-- A swap costs the difference going UP the ladder from the burger's own meat;
-- going down or staying level is free. CZ Chix (fried chicken) and BBQ Eggy
-- have no rules, so they cannot be swapped.
--
-- The browser only says WHICH meat. place_order() checks every choice against
-- swap_slots and works out the charge itself (never trusting a client price).
-- The free Kawan reward customer still pays the swap: apply_reward_swaps().
--
-- Stock and cost follow the meat in a later step, when the recipes are in.
-- No recipe, weight or ingredient detail lives in this file.
--
-- Run AFTER 20261029000002_scheduled_reward_price.sql. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.meat_ladder (
  meat       text PRIMARY KEY CHECK (meat IN ('beef', 'chicken', 'lamb')),
  rank_cents integer NOT NULL CHECK (rank_cents >= 0)
);
INSERT INTO public.meat_ladder (meat, rank_cents) VALUES ('beef', 0), ('chicken', 100), ('lamb', 200)
ON CONFLICT (meat) DO NOTHING;

-- One row per burger slot. slot_no 1 is the burger itself for a single burger;
-- a platter has one row per burger. pick_category is set when the customer
-- also chooses WHICH burger goes in the slot (e.g. any PREMIUM burger).
CREATE TABLE IF NOT EXISTS public.swap_slots (
  menu_item_id  text    NOT NULL,
  slot_no       integer NOT NULL CHECK (slot_no >= 1),
  kind          text    NOT NULL CHECK (kind IN ('bbq', 'premium')),
  default_meat  text    NOT NULL REFERENCES public.meat_ladder (meat),
  pick_category text,
  PRIMARY KEY (menu_item_id, slot_no)
);

ALTER TABLE public.meat_ladder ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swap_slots  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read meat ladder" ON public.meat_ladder;
CREATE POLICY "Anyone can read meat ladder" ON public.meat_ladder FOR SELECT USING (true);
DROP POLICY IF EXISTS "Anyone can read swap slots" ON public.swap_slots;
CREATE POLICY "Anyone can read swap slots" ON public.swap_slots FOR SELECT USING (true);
REVOKE ALL ON public.meat_ladder, public.swap_slots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.meat_ladder, public.swap_slots TO anon, authenticated;

-- Today's rules, only for items that exist in this database.
INSERT INTO public.swap_slots (menu_item_id, slot_no, kind, default_meat, pick_category)
SELECT v.id, v.slot_no, v.kind, v.meat, v.pick
FROM (VALUES
  ('1',  1, 'bbq',     'beef',    NULL),        -- BBQ Beef
  ('5',  1, 'bbq',     'chicken', NULL),        -- BBQ Chicken
  ('4',  1, 'bbq',     'lamb',    NULL),        -- BBQ Lamb
  ('11', 1, 'premium', 'beef',    NULL),        -- Big-G
  ('7',  1, 'premium', 'beef',    NULL),        -- Mushy2
  ('8',  1, 'premium', 'beef',    NULL),        -- Jucy Bae
  ('12', 1, 'premium', 'beef',    NULL),        -- Sumandak
  ('17', 1, 'bbq',     'beef',    NULL),        -- Kawan MONSTA: 2 BBQ burgers
  ('17', 2, 'bbq',     'beef',    NULL),
  ('14', 1, 'premium', 'beef',    'PREMIUM'),   -- MONSTA Platter: 3 premium burgers
  ('14', 2, 'premium', 'beef',    'PREMIUM'),
  ('14', 3, 'premium', 'beef',    'PREMIUM')
) AS v(id, slot_no, kind, meat, pick)
WHERE EXISTS (SELECT 1 FROM public.menu_items m WHERE m.id = v.id)
ON CONFLICT (menu_item_id, slot_no) DO NOTHING;

-- Checks a customer's meat choices for one item and prices them. Returns
-- {"charge": cents, "choices": [...]}. Raises on anything not allowed.
CREATE OR REPLACE FUNCTION public.price_meat_choices(p_item_id text, p_choices jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_choices jsonb := COALESCE(p_choices, '[]'::jsonb);
  v_slot_count integer;
  v_el jsonb;
  v_slot_no integer;
  v_slot record;
  v_meat text;
  v_pick text;
  v_pick_name text;
  v_pick_cat text;
  v_base text;
  v_new_rank integer;
  v_base_rank integer;
  v_charge integer;
  v_total integer := 0;
  v_out jsonb := '[]'::jsonb;
  v_seen integer[] := '{}';
BEGIN
  IF jsonb_typeof(v_choices) <> 'array' THEN
    RAISE EXCEPTION 'Invalid meat choice.';
  END IF;

  SELECT count(*) INTO v_slot_count FROM public.swap_slots WHERE menu_item_id = p_item_id;
  IF v_slot_count = 0 THEN
    IF jsonb_array_length(v_choices) > 0 THEN
      RAISE EXCEPTION 'The meat cannot be changed on this item.';
    END IF;
    RETURN jsonb_build_object('charge', 0, 'choices', '[]'::jsonb);
  END IF;
  IF jsonb_array_length(v_choices) > v_slot_count THEN
    RAISE EXCEPTION 'Too many meat choices for this item.';
  END IF;

  FOR v_el IN SELECT * FROM jsonb_array_elements(v_choices)
  LOOP
    IF jsonb_typeof(v_el) <> 'object' THEN
      RAISE EXCEPTION 'Invalid meat choice.';
    END IF;
    BEGIN
      v_slot_no := (v_el->>'slot')::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid meat choice.';
    END;
    IF v_slot_no = ANY (v_seen) THEN
      RAISE EXCEPTION 'The same burger was chosen twice.';
    END IF;
    v_seen := v_seen || v_slot_no;

    SELECT * INTO v_slot FROM public.swap_slots WHERE menu_item_id = p_item_id AND slot_no = v_slot_no;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That burger slot does not exist.';
    END IF;

    v_meat := lower(NULLIF(v_el->>'meat', ''));
    v_pick := NULLIF(v_el->>'item_id', '');
    v_base := v_slot.default_meat;
    v_pick_name := NULL;

    IF v_slot.pick_category IS NOT NULL THEN
      IF v_pick IS NULL THEN
        RAISE EXCEPTION 'Please choose a burger for every slot.';
      END IF;
      SELECT name, category INTO v_pick_name, v_pick_cat FROM public.menu_items WHERE id = v_pick;
      IF NOT FOUND OR v_pick_cat IS DISTINCT FROM v_slot.pick_category THEN
        RAISE EXCEPTION 'That burger cannot be chosen here.';
      END IF;
      -- The chosen burger's own rule gives its normal meat. A burger with no
      -- rule (fixed meat, like CZ Chix) cannot be swapped.
      SELECT default_meat INTO v_base FROM public.swap_slots
      WHERE menu_item_id = v_pick AND slot_no = 1 AND pick_category IS NULL;
      IF NOT FOUND THEN
        IF v_meat IS NOT NULL THEN
          RAISE EXCEPTION 'The meat cannot be changed on that burger.';
        END IF;
        v_out := v_out || jsonb_build_object(
          'slot', v_slot_no, 'item_id', v_pick, 'name', v_pick_name, 'meat', NULL, 'charge', 0);
        CONTINUE;
      END IF;
    ELSIF v_pick IS NOT NULL THEN
      RAISE EXCEPTION 'You cannot choose a different burger here.';
    END IF;

    v_meat := COALESCE(v_meat, v_base);
    SELECT rank_cents INTO v_new_rank FROM public.meat_ladder WHERE meat = v_meat;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That meat is not available.';
    END IF;
    SELECT rank_cents INTO v_base_rank FROM public.meat_ladder WHERE meat = v_base;
    v_charge := GREATEST(0, v_new_rank - v_base_rank);
    v_total := v_total + v_charge;

    v_out := v_out || jsonb_strip_nulls(jsonb_build_object(
      'slot', v_slot_no, 'item_id', v_pick, 'name', v_pick_name, 'meat', v_meat, 'charge', v_charge));
  END LOOP;

  -- Every "choose a burger" slot must be filled.
  IF EXISTS (
    SELECT 1 FROM public.swap_slots s
    WHERE s.menu_item_id = p_item_id AND s.pick_category IS NOT NULL AND NOT (s.slot_no = ANY (v_seen))
  ) THEN
    RAISE EXCEPTION 'Please choose a burger for every slot.';
  END IF;

  -- Slots the customer left alone keep their normal meat (so the kitchen
  -- ticket and, later, the stock count see every slot).
  FOR v_slot IN SELECT * FROM public.swap_slots
                WHERE menu_item_id = p_item_id AND pick_category IS NULL AND NOT (slot_no = ANY (v_seen))
                ORDER BY slot_no
  LOOP
    v_out := v_out || jsonb_build_object('slot', v_slot.slot_no, 'meat', v_slot.default_meat, 'charge', 0);
  END LOOP;

  RETURN jsonb_build_object(
    'charge', v_total,
    'choices', COALESCE((SELECT jsonb_agg(e ORDER BY (e->>'slot')::integer) FROM jsonb_array_elements(v_out) e), '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.price_meat_choices(text, jsonb) FROM PUBLIC, anon, authenticated;

-- place_order, identical to 20261012000001 except for the meat-choice pricing.
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
  v_choice_result jsonb;
  v_swap_charge integer;
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

      -- Meat choices (swaps) on a burger or platter: the server validates every
      -- choice against swap_slots and works out the charge itself. The browser
      -- only says WHICH meat; it never says what it costs.
      v_choice_result := public.price_meat_choices(v_item_id, v_item->'choices');
      v_swap_charge := COALESCE((v_choice_result->>'charge')::integer, 0);
      v_unit_price := v_unit_price + v_swap_charge;

      v_subtotal := v_subtotal + (v_unit_price * v_verified_qty);

      v_items_verified := v_items_verified || (jsonb_build_object(
        'id', v_item_id,
        'name', COALESCE(v_item->>'name', v_menu_name),
        'category', v_menu_category,
        'price', v_base_unit_price,
        'quantity', v_verified_qty,
        'selectedAddons', v_addons_json
      ) || CASE
        WHEN jsonb_array_length(COALESCE(v_choice_result->'choices', '[]'::jsonb)) > 0
        THEN jsonb_build_object('choices', v_choice_result->'choices', 'swapCharge', v_swap_charge)
        ELSE '{}'::jsonb
      END);
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

  -- (Referral conversion now happens when the friend's first order is
  -- COLLECTED -- see handle_order_collected -- not when it is placed.)

  RETURN order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.place_order(jsonb, jsonb, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(jsonb, jsonb, text, text, jsonb, text) TO authenticated;

-- The free Kawan reward still pays for swaps. Called right after
-- apply_order_reward: prices the customer's meat choices for the reward line,
-- records them on it and adds the charge to the order total. Does nothing
-- once choices are set (cannot be charged twice) or on a line with no slots.
CREATE OR REPLACE FUNCTION public.apply_reward_swaps(p_order_id text, p_choices jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order record;
  v_el jsonb;
  v_new jsonb := '[]'::jsonb;
  v_done boolean := false;
  v_res jsonb;
  v_charge integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please log in to continue.';
  END IF;

  SELECT id, user_id, status, items, total, created_at INTO v_order
  FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;
  IF v_order.status <> 'PENDING' OR v_order.created_at < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'Meat choices can only be added while your order is waiting for the kitchen.';
  END IF;

  FOR v_el IN SELECT * FROM jsonb_array_elements(COALESCE(v_order.items, '[]'::jsonb))
  LOOP
    IF NOT v_done
       AND COALESCE((v_el->>'reward')::boolean, false)
       AND NOT (v_el ? 'choices')
       AND EXISTS (SELECT 1 FROM public.swap_slots WHERE menu_item_id = v_el->>'id') THEN
      v_res := public.price_meat_choices(v_el->>'id', p_choices);
      v_charge := COALESCE((v_res->>'charge')::integer, 0);
      v_new := v_new || (v_el || jsonb_build_object('choices', v_res->'choices', 'swapCharge', v_charge));
      v_done := true;
    ELSE
      v_new := v_new || v_el;
    END IF;
  END LOOP;

  IF NOT v_done THEN
    RETURN jsonb_build_object('charge', 0, 'applied', false);
  END IF;

  UPDATE public.orders SET items = v_new, total = COALESCE(total, 0) + v_charge WHERE id = p_order_id;
  RETURN jsonb_build_object('charge', v_charge, 'applied', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_reward_swaps(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_reward_swaps(text, jsonb) TO authenticated;
