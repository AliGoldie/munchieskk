-- Baseline capture of everything that was created directly in the Supabase
-- dashboard/SQL editor over time and never checked into a migration file —
-- the gap flagged repeatedly throughout this session's audits. Reconstructed
-- from live introspection (pg_get_functiondef, information_schema, pg_policies,
-- pg_constraint) via `supabase db query`, since `db pull`/`db dump` both
-- require a local Docker shadow database that isn't available here.
--
-- Every statement here is written to be a no-op against the current database
-- (CREATE TABLE/EXTENSION IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP POLICY IF EXISTS + CREATE POLICY) — this migration documents reality,
-- it does not change it, with ONE exception called out below.
--
-- EXCEPTION (a real fix, found while writing this baseline): deduct_stock_for_loyverse
-- is meant to be called only server-to-server, from the loyverse-price-sync
-- Edge Function using the service_role key — confirmed zero references to it
-- anywhere in src/. Yet anon/authenticated/PUBLIC all had EXECUTE on it, so
-- any visitor could call it directly to zero out any menu item's stock with
-- no real transaction behind it — a pure sabotage vector. Revoked below.

CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================
-- store_settings
-- ============================================================
CREATE TABLE IF NOT EXISTS public.store_settings (
  id text PRIMARY KEY DEFAULT 'main_store',
  status text DEFAULT 'OPEN',
  opening_time text DEFAULT '17:00',
  closing_time text DEFAULT '23:00',
  notice_message text DEFAULT '',
  updated_at timestamptz DEFAULT now(),
  weekly_schedule jsonb DEFAULT '{"Mon":{"open":"17:00","close":"23:00","enabled":true},"Tue":{"open":"17:00","close":"23:00","enabled":true},"Wed":{"open":"17:00","close":"23:00","enabled":true},"Thu":{"open":"17:00","close":"23:00","enabled":true},"Fri":{"open":"17:00","close":"23:00","enabled":true},"Sat":{"open":"17:00","close":"23:00","enabled":true},"Sun":{"open":"17:00","close":"23:00","enabled":false}}'::jsonb,
  special_closures jsonb DEFAULT '[]'::jsonb,
  arcade_enabled boolean DEFAULT false
);

ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view store_settings" ON public.store_settings;
CREATE POLICY "Public can view store_settings" ON public.store_settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can insert store_settings" ON public.store_settings;
CREATE POLICY "Admins can insert store_settings" ON public.store_settings FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update store_settings" ON public.store_settings;
CREATE POLICY "Admins can update store_settings" ON public.store_settings FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete store_settings" ON public.store_settings;
CREATE POLICY "Admins can delete store_settings" ON public.store_settings FOR DELETE USING (public.is_admin());

-- ============================================================
-- promo_codes
-- ============================================================
CREATE TABLE IF NOT EXISTS public.promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  name text,
  type text DEFAULT 'percent_off' NOT NULL
    CHECK (type = ANY (ARRAY['percent_off', 'flat_off', 'bogo', 'spend_threshold_free_item'])),
  value integer NOT NULL DEFAULT 0,
  applies_to_item_id text,
  min_spend integer,
  free_item_id text,
  usage_count integer NOT NULL DEFAULT 0,
  max_total_uses integer,
  max_uses_per_user integer,
  active boolean DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  stackable_with_item_promos boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view active promo codes" ON public.promo_codes;
CREATE POLICY "Public can view active promo codes" ON public.promo_codes FOR SELECT USING (active = true);

DROP POLICY IF EXISTS "Admins have full access to promo codes" ON public.promo_codes;
CREATE POLICY "Admins have full access to promo codes" ON public.promo_codes FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- ============================================================
-- promo_redemptions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.promo_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id uuid NOT NULL REFERENCES public.promo_codes(id) ON DELETE CASCADE,
  order_id text NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  discount_amount integer NOT NULL DEFAULT 0,
  redeemed_at timestamptz DEFAULT now()
);

ALTER TABLE public.promo_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view redemptions" ON public.promo_redemptions;
CREATE POLICY "Admins can view redemptions" ON public.promo_redemptions FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
-- No INSERT policy: rows are only ever written by place_order() (SECURITY
-- DEFINER, bypasses RLS as the postgres-owned function).

-- ============================================================
-- game_plays
-- ============================================================
CREATE TABLE IF NOT EXISTS public.game_plays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_name text NOT NULL DEFAULT 'munch_man',
  played_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  reward_claimed boolean DEFAULT false
);

ALTER TABLE public.game_plays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own game plays" ON public.game_plays;
CREATE POLICY "Users can read own game plays" ON public.game_plays FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own game plays" ON public.game_plays;
CREATE POLICY "Users can insert own game plays" ON public.game_plays FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- waste_log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.waste_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text REFERENCES public.orders(id),
  item_id text REFERENCES public.menu_items(id),
  quantity integer NOT NULL,
  reason text,
  logged_by uuid,
  "timestamp" timestamptz DEFAULT now()
);

ALTER TABLE public.waste_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view and insert waste log" ON public.waste_log;
CREATE POLICY "Admins can view and insert waste log" ON public.waste_log FOR ALL USING (public.is_admin());

-- ============================================================
-- loyalty_prizes
-- ============================================================
CREATE TABLE IF NOT EXISTS public.loyalty_prizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  points_cost integer NOT NULL,
  image_url text,
  menu_item_id text REFERENCES public.menu_items(id),
  deduct_stock boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.loyalty_prizes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active prizes" ON public.loyalty_prizes;
CREATE POLICY "Public can read active prizes" ON public.loyalty_prizes FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "Admins manage prizes" ON public.loyalty_prizes;
CREATE POLICY "Admins manage prizes" ON public.loyalty_prizes FOR ALL USING (public.is_admin());

-- ============================================================
-- order_items — confirmed unused: zero rows, zero references anywhere in
-- src/ (the app stores order line items as JSONB directly on orders.items
-- instead). RLS is correctly configured despite being dead. Captured here
-- for an accurate baseline; flagged separately as a real cleanup candidate
-- to drop, since an empty, write-never table is exactly the kind of "slop"
-- worth removing rather than just documenting.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid,
  menu_item_id uuid,
  quantity integer DEFAULT 1,
  selected_addons jsonb DEFAULT '[]'::jsonb
);

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own order_items" ON public.order_items;
CREATE POLICY "Users can view their own order_items" ON public.order_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.orders WHERE orders.id = (order_items.order_id)::text AND (orders.user_id)::text = (auth.uid())::text) OR public.is_admin());

DROP POLICY IF EXISTS "Admins can insert order_items" ON public.order_items;
CREATE POLICY "Admins can insert order_items" ON public.order_items FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update order_items" ON public.order_items;
CREATE POLICY "Admins can update order_items" ON public.order_items FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete order_items" ON public.order_items;
CREATE POLICY "Admins can delete order_items" ON public.order_items FOR DELETE USING (public.is_admin());

-- ============================================================
-- validate_and_apply_promo — read live via pg_get_functiondef this session
-- (src/pages/Payment.jsx and place_order() both call it). Captured verbatim.
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_and_apply_promo(p_code text, p_order_total integer, p_user_id uuid, p_cart_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_promo record;
  v_user_uses integer;
  v_discount integer := 0;
  v_free_item_id text := null;
  v_free_item_name text := null;
  v_item jsonb;
  v_has_bogo_item boolean := false;
  v_bogo_item_price integer := 0;
BEGIN
  SELECT * INTO v_promo FROM promo_codes WHERE code = p_code;
  IF NOT FOUND THEN RETURN json_build_object('valid', false, 'message', 'Invalid promo code.'); END IF;
  IF v_promo.active = false THEN RETURN json_build_object('valid', false, 'message', 'This promo code is inactive.'); END IF;
  IF v_promo.starts_at IS NOT NULL AND now() < v_promo.starts_at THEN RETURN json_build_object('valid', false, 'message', 'This promo code is not active yet.'); END IF;
  IF v_promo.ends_at IS NOT NULL AND now() > v_promo.ends_at THEN RETURN json_build_object('valid', false, 'message', 'This promo code has expired.'); END IF;
  IF v_promo.max_total_uses IS NOT NULL AND v_promo.usage_count >= v_promo.max_total_uses THEN RETURN json_build_object('valid', false, 'message', 'This promo code has reached its maximum usage limit.'); END IF;

  IF v_promo.max_uses_per_user IS NOT NULL AND p_user_id IS NOT NULL THEN
    SELECT count(*) INTO v_user_uses FROM promo_redemptions WHERE promo_code_id = v_promo.id AND user_id = p_user_id;
    IF v_user_uses >= v_promo.max_uses_per_user THEN
      RETURN json_build_object('valid', false, 'message', 'You have reached the maximum usage limit for this code.');
    END IF;
  END IF;

  IF v_promo.type = 'percent_off' THEN v_discount := floor(p_order_total * (v_promo.value / 100.0));
  ELSIF v_promo.type = 'flat_off' THEN v_discount := v_promo.value;
  ELSIF v_promo.type = 'bogo' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart_items) LOOP
      IF (v_item->>'id') = v_promo.applies_to_item_id THEN
        v_has_bogo_item := true;
        v_bogo_item_price := (v_item->>'price')::integer;
      END IF;
    END LOOP;
    IF v_has_bogo_item THEN v_discount := v_bogo_item_price;
    ELSE RETURN json_build_object('valid', false, 'message', 'Your cart does not contain the required item for this BOGO offer.'); END IF;
  ELSIF v_promo.type = 'spend_threshold_free_item' THEN
    IF p_order_total >= v_promo.min_spend THEN
      v_free_item_id := v_promo.free_item_id;
      SELECT name INTO v_free_item_name FROM menu_items WHERE id = v_free_item_id;
    ELSE RETURN json_build_object('valid', false, 'message', 'You must spend RM ' || (v_promo.min_spend / 100.0) || ' to use this promo.'); END IF;
  END IF;

  IF v_discount > p_order_total THEN v_discount := p_order_total; END IF;

  RETURN json_build_object('valid', true, 'message', 'Promo applied successfully!', 'discount_cents', v_discount, 'free_item_id', v_free_item_id, 'free_item_name', v_free_item_name, 'promo_code_id', v_promo.id);
END;
$$;

-- ============================================================
-- deduct_stock_for_loyverse — captured verbatim, PLUS the real fix: lock
-- execution down to service_role only (see note at top of file).
-- ============================================================
CREATE OR REPLACE FUNCTION public.deduct_stock_for_loyverse(p_item_id text, p_qty integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE menu_items
  SET
    stock_quantity = stock_quantity - p_qty,
    in_stock       = (stock_quantity - p_qty) > 0
  WHERE id = p_item_id
    AND stock_quantity >= p_qty;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'deduct_stock_for_loyverse: stock deduction failed for item_id=% qty=%. '
      'Either the item does not exist or stock_quantity < qty.',
      p_item_id, p_qty;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deduct_stock_for_loyverse(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_stock_for_loyverse(text, integer) TO service_role;
