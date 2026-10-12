-- Points rework, release 1 (owner's decisions, October 2026).
--
--  1. Collection bonus is 6 points (was 10).
--  2. Referral reward (150 points to the person who invited) is paid when the
--     friend's first order of at least RM20 is COLLECTED -- not when it is
--     placed, which let a friend place an order, cancel it and keep the
--     reward. The cap of 5 rewards per referrer stays.
--  3. Arcade points are only paid while the player has a live order (cooking,
--     ready or collected within the last 24 hours), as the Home page says.
--     Playing is still free for everyone; only the points need an order.
--  4. Social share bonus is 20 points (was 30). A customer can upload a
--     screenshot of the post; once staff approve it the total is 40 points.
--  5. Redemptions nobody collects within 14 days expire and the points (and
--     any reserved stock) go back to the customer.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1 + 2. Collection bonus and referral payout when an order is collected
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_order_collected()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer uuid;
  v_converted timestamptz;
  v_bonus_count integer;
  c_collection_bonus constant integer := 6;
  c_referral_reward constant integer := 150;
  c_referral_cap constant integer := 5;
  c_referral_min_total constant integer := 2000; -- RM20.00 in cents
BEGIN
  IF NEW.status = 'COLLECTED' AND (OLD.status IS DISTINCT FROM 'COLLECTED') AND NEW.user_id IS NOT NULL THEN
    UPDATE public.profiles
    SET points = COALESCE(points, 0) + c_collection_bonus
    WHERE id = NEW.user_id;

    -- Referral: the first collected order worth at least RM20 converts it.
    SELECT referred_by, referral_converted_at
    INTO v_referrer, v_converted
    FROM public.profiles
    WHERE id = NEW.user_id
    FOR UPDATE;

    IF v_referrer IS NOT NULL AND v_converted IS NULL
       AND v_referrer <> NEW.user_id
       AND COALESCE(NEW.total, 0) >= c_referral_min_total THEN
      -- Lock the referrer's row so two friends converting at the same
      -- instant can't both slip under the cap.
      PERFORM 1 FROM public.profiles WHERE id = v_referrer FOR UPDATE;

      SELECT COUNT(*) INTO v_bonus_count
      FROM public.referral_rewards_log
      WHERE referrer_id = v_referrer AND reward_type = 'referrer_bonus';

      IF v_bonus_count < c_referral_cap THEN
        UPDATE public.profiles
        SET points = COALESCE(points, 0) + c_referral_reward
        WHERE id = v_referrer;

        INSERT INTO public.referral_rewards_log (
          referrer_id, referred_id, reward_type, points_awarded, order_id, logged_at
        ) VALUES (
          v_referrer, NEW.user_id, 'referrer_bonus', c_referral_reward, NEW.id, NOW()
        );
      END IF;

      UPDATE public.profiles
      SET referral_converted_at = NOW()
      WHERE id = NEW.user_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- place_order no longer pays the referral at placement (see above). Otherwise
-- identical to the version in 20261011000000_order_integrity_hardening.sql.
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

  -- (Referral conversion now happens when the friend's first order is
  -- COLLECTED -- see handle_order_collected -- not when it is placed.)

  RETURN order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.place_order(jsonb, jsonb, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(jsonb, jsonb, text, text, jsonb, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Arcade points need a live order
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.award_engagement_points(
  p_user_id uuid,
  p_source text,
  p_desired_points integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_weekly_cap constant integer := 150;
  v_used_this_week integer := 0;
  v_award integer := 0;
BEGIN
  IF p_desired_points <= 0 THEN
    RETURN 0;
  END IF;

  -- Free-play points are a thank-you for ordering: no live order, no points.
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE user_id = p_user_id
      AND status IN ('COOKING', 'READY', 'COLLECTED')
      AND created_at >= now() - interval '24 hours'
  ) THEN
    RETURN 0;
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;

  SELECT COALESCE(SUM(points), 0) INTO v_used_this_week
  FROM public.engagement_points_log
  WHERE user_id = p_user_id
    AND awarded_at >= now() - interval '7 days';

  v_award := GREATEST(0, LEAST(p_desired_points, v_weekly_cap - v_used_this_week));

  IF v_award > 0 THEN
    INSERT INTO public.engagement_points_log (user_id, source, points)
    VALUES (p_user_id, p_source, v_award);

    UPDATE public.profiles
    SET points = COALESCE(points, 0) + v_award
    WHERE id = p_user_id;
  END IF;

  RETURN v_award;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.award_engagement_points(uuid, text, integer) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Share bonus: 20 points, plus a screenshot proof queue (40 in total)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_share_bonus(p_order_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be logged in to claim a share bonus.';
  END IF;

  UPDATE public.orders
  SET share_bonus_claimed_at = NOW()
  WHERE id = p_order_id
    AND user_id = v_user_id
    AND status = 'COLLECTED'
    AND share_bonus_claimed_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Share bonus already claimed, or this order is not eligible.';
  END IF;

  -- Fixed server-side amount, matching src/config/loyaltyConfig.js REVIEW_BONUS_PTS.
  UPDATE public.profiles
  SET points = COALESCE(points, 0) + 20
  WHERE id = v_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_share_bonus(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_share_bonus(text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.share_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  image_path text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  points_awarded integer NOT NULL DEFAULT 0,
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_share_proofs_status ON public.share_proofs (status, created_at);

ALTER TABLE public.share_proofs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners and admins read share proofs" ON public.share_proofs;
CREATE POLICY "Owners and admins read share proofs" ON public.share_proofs
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

-- Every write goes through the two functions below.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.share_proofs FROM anon, authenticated;

-- Customer: attach a screenshot (already uploaded to the private
-- 'share-proofs' bucket under their own folder) to one of their collected
-- orders. A rejected proof can be replaced; an approved or pending one cannot.
CREATE OR REPLACE FUNCTION public.submit_share_proof(p_order_id text, p_image_path text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_existing record;
  v_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be logged in to submit a screenshot.';
  END IF;

  IF p_image_path IS NULL OR p_image_path !~ ('^' || v_user_id::text || '/[A-Za-z0-9._-]+$') THEN
    RAISE EXCEPTION 'Invalid screenshot path.';
  END IF;

  PERFORM 1 FROM public.orders
  WHERE id = p_order_id
    AND user_id = v_user_id
    AND status = 'COLLECTED'
    AND created_at >= now() - interval '14 days';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This order is not eligible for a share bonus screenshot.';
  END IF;

  SELECT id, status INTO v_existing FROM public.share_proofs WHERE order_id = p_order_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing.status <> 'REJECTED' THEN
      RAISE EXCEPTION 'A screenshot has already been submitted for this order.';
    END IF;
    UPDATE public.share_proofs
    SET image_path = p_image_path, status = 'PENDING', reject_reason = NULL,
        created_at = now(), reviewed_at = NULL, reviewed_by = NULL
    WHERE id = v_existing.id
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.share_proofs (order_id, user_id, image_path)
  VALUES (p_order_id, v_user_id, p_image_path)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_share_proof(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_share_proof(text, text) TO authenticated;

-- Admin: approve (tops the order's share bonus up to 40 points in total) or
-- reject a screenshot. Returns the points paid.
CREATE OR REPLACE FUNCTION public.review_share_proof(p_proof_id uuid, p_approve boolean, p_reason text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proof record;
  v_claimed timestamptz;
  v_award integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;

  SELECT * INTO v_proof FROM public.share_proofs WHERE id = p_proof_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Screenshot not found.';
  END IF;
  IF v_proof.status <> 'PENDING' THEN
    RAISE EXCEPTION 'This screenshot was already reviewed.';
  END IF;

  IF p_approve THEN
    SELECT share_bonus_claimed_at INTO v_claimed
    FROM public.orders WHERE id = v_proof.order_id FOR UPDATE;

    -- 20 already paid for sharing -> add 20; never shared -> pay the full 40.
    v_award := CASE WHEN v_claimed IS NULL THEN 40 ELSE 20 END;

    UPDATE public.orders
    SET share_bonus_claimed_at = COALESCE(share_bonus_claimed_at, NOW())
    WHERE id = v_proof.order_id;

    UPDATE public.profiles
    SET points = COALESCE(points, 0) + v_award
    WHERE id = v_proof.user_id;
  END IF;

  UPDATE public.share_proofs
  SET status = CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END,
      points_awarded = v_award,
      reject_reason = CASE WHEN p_approve THEN NULL ELSE LEFT(NULLIF(TRIM(p_reason), ''), 200) END,
      reviewed_at = NOW(),
      reviewed_by = auth.uid()
  WHERE id = p_proof_id;

  RETURN v_award;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.review_share_proof(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_share_proof(uuid, boolean, text) TO authenticated;

-- Private bucket for the screenshots: customers can add to and read their own
-- folder, admins can read everything. (Skipped where there is no storage
-- schema, e.g. the plain-Postgres test database.)
DO $storage$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('share-proofs', 'share-proofs', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
  ON CONFLICT (id) DO UPDATE
    SET public = false, file_size_limit = 5242880,
        allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

  DROP POLICY IF EXISTS "share_proofs_insert_own" ON storage.objects;
  CREATE POLICY "share_proofs_insert_own" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'share-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);

  DROP POLICY IF EXISTS "share_proofs_select_own_or_admin" ON storage.objects;
  CREATE POLICY "share_proofs_select_own_or_admin" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'share-proofs'
           AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));
END
$storage$;

-- ---------------------------------------------------------------------------
-- 5. Redemptions nobody collects expire after 14 days (points come back)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_stale_redemptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT rd.id, rd.user_id, rd.points_spent, lp.deduct_stock, lp.menu_item_id
    FROM public.redemptions rd
    LEFT JOIN public.loyalty_prizes lp ON lp.id = rd.prize_id
    WHERE rd.status = 'PENDING' AND rd.redeemed_at < now() - interval '14 days'
    FOR UPDATE OF rd SKIP LOCKED
  LOOP
    UPDATE public.redemptions SET status = 'EXPIRED' WHERE id = r.id;

    UPDATE public.profiles
    SET points = COALESCE(points, 0) + r.points_spent
    WHERE id = r.user_id;

    IF COALESCE(r.deduct_stock, false) AND r.menu_item_id IS NOT NULL THEN
      UPDATE public.menu_items
      SET stock_quantity = COALESCE(stock_quantity, 0) + 1,
          in_stock = true
      WHERE id = r.menu_item_id;
    END IF;

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_stale_redemptions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_stale_redemptions() TO authenticated;

-- An expired redemption can no longer be handed over (its points were refunded).
CREATE OR REPLACE FUNCTION public.fulfill_redemption(p_redemption_id uuid, p_admin_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;

  SELECT status INTO v_status
  FROM public.redemptions
  WHERE id = p_redemption_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Redemption not found.');
  END IF;

  IF v_status = 'FULFILLED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already fulfilled.');
  END IF;

  IF v_status = 'EXPIRED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Expired: the points were refunded to the customer.');
  END IF;

  UPDATE public.redemptions
  SET status = 'FULFILLED',
      fulfilled_at = NOW(),
      fulfilled_by = auth.uid()
  WHERE id = p_redemption_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fulfill_redemption(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fulfill_redemption(uuid, text) TO authenticated;
