-- The prize redemption feature was never actually built server-side: neither
-- the `redemptions` table nor the `redeem_prize`/`fulfill_redemption` RPCs
-- exist in the live database (confirmed via information_schema/pg_proc),
-- despite being fully wired up in src/pages/Loyalty.jsx and src/pages/Admin.jsx
-- (Redemptions tab) and referenced in StoreContext.jsx. Both client-side
-- features have been non-functional in production. This creates the whole
-- thing from scratch, reverse-engineered from exactly what the client code
-- reads/writes (StoreContext.jsx redeemPrize/fetchAdminRedemptions/
-- fulfillRedemption, Loyalty.jsx's redemptionResult display, Admin.jsx's
-- Redemptions tab table columns).
--
-- Design choices, consistent with every fix shipped earlier this session:
--   - auth.uid() is the source of truth for identity, never the client-
--     supplied p_user_id/p_admin_id params (kept only for call-signature
--     compatibility with the existing client code).
--   - Points cost and prize name/stock rules come from the live
--     loyalty_prizes row, never trusted from the client.
--   - Direct client writes to `redemptions` are denied entirely; both RPCs
--     are SECURITY DEFINER (owned by postgres, so they bypass RLS and the
--     profiles-column-protection trigger the same way place_order does).

CREATE TABLE IF NOT EXISTS public.redemptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  redemption_code text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  prize_id uuid REFERENCES public.loyalty_prizes(id),
  prize_name text NOT NULL,
  points_spent integer NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  redeemed_at timestamptz DEFAULT now(),
  fulfilled_at timestamptz,
  fulfilled_by uuid REFERENCES public.profiles(id)
);

ALTER TABLE public.redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own redemptions" ON public.redemptions;
CREATE POLICY "Users can view their own redemptions" ON public.redemptions
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

-- No INSERT/UPDATE/DELETE policies at all: every write goes through the two
-- SECURITY DEFINER functions below, which bypass RLS as the (postgres-owned,
-- bypassrls) function owner. Direct client writes are correctly denied by
-- default (no permissive policy exists for those commands).

CREATE OR REPLACE FUNCTION public.generate_unique_redemption_code()
RETURNS text AS $$
DECLARE
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text;
  i integer;
  code_exists boolean;
BEGIN
  LOOP
    result := '';
    FOR i IN 1..6 LOOP
      result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
    END LOOP;

    SELECT EXISTS (SELECT 1 FROM public.redemptions WHERE redemption_code = result) INTO code_exists;

    EXIT WHEN NOT code_exists;
  END LOOP;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.redeem_prize(p_user_id text, p_prize_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_prize record;
  v_current_points integer;
  v_current_stock integer;
  v_code text;
  v_redemption_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be logged in to redeem prizes.';
  END IF;
  IF p_user_id IS NOT NULL AND p_user_id <> '' AND p_user_id::uuid <> v_user_id THEN
    RAISE EXCEPTION 'permission denied: cannot redeem a prize for another user';
  END IF;

  SELECT * INTO v_prize
  FROM public.loyalty_prizes
  WHERE id = p_prize_id
  FOR UPDATE;

  IF NOT FOUND OR v_prize.is_active = false THEN
    RAISE EXCEPTION 'This prize is not available.';
  END IF;

  SELECT points INTO v_current_points
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF COALESCE(v_current_points, 0) < v_prize.points_cost THEN
    RAISE EXCEPTION 'Not enough points to redeem this prize.';
  END IF;

  IF v_prize.deduct_stock AND v_prize.menu_item_id IS NOT NULL THEN
    SELECT stock_quantity INTO v_current_stock
    FROM public.menu_items
    WHERE id = v_prize.menu_item_id
    FOR UPDATE;

    IF v_current_stock IS NULL OR v_current_stock < 1 THEN
      RAISE EXCEPTION 'This prize is out of stock right now.';
    END IF;

    UPDATE public.menu_items
    SET stock_quantity = v_current_stock - 1,
        in_stock = (v_current_stock - 1 > 0)
    WHERE id = v_prize.menu_item_id;
  END IF;

  UPDATE public.profiles
  SET points = points - v_prize.points_cost
  WHERE id = v_user_id;

  v_code := public.generate_unique_redemption_code();

  INSERT INTO public.redemptions (redemption_code, user_id, prize_id, prize_name, points_spent, status)
  VALUES (v_code, v_user_id, v_prize.id, v_prize.name, v_prize.points_cost, 'PENDING')
  RETURNING id INTO v_redemption_id;

  RETURN jsonb_build_object(
    'success', true,
    'redemption_id', v_redemption_id,
    'redemption_code', v_code,
    'points_spent', v_prize.points_cost
  );
END;
$$;

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

  UPDATE public.redemptions
  SET status = 'FULFILLED',
      fulfilled_at = NOW(),
      fulfilled_by = auth.uid()
  WHERE id = p_redemption_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
