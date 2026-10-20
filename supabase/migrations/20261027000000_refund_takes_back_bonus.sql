-- Refunds after collection take back the +6 collection bonus too (Rewards Plan v2, task 6).
--
-- Before: a refund took back only a share of the ORDER coins. The +6 collection
-- bonus stayed with the customer even on a full refund.
-- Now:    a refund takes back the same share of (order coins + the +6 bonus).
--         A full refund returns everything; a half refund returns half; undoing
--         a refund gives back exactly what was taken.
--
-- If the customer has already spent the coins, the balance stops at 0 (owner
-- decision: the shop absorbs that loss; there is no negative balance). The coins
-- really taken are remembered on the order (orders.points_taken_back), so undoing
-- the refund returns only that amount, never more than was taken.
--
-- The +6 is counted only for orders that were COLLECTED (it is paid at collection).
-- Rank spend is unchanged: it already subtracts refunds, and ranks never go down.
--
-- Safe to run more than once. Changes no stored points.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS points_taken_back integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.handle_order_refund_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_collection_bonus constant integer := 6;
  v_delta integer;
  v_basis integer;
  v_share integer;
  v_balance integer;
  v_taken integer;
  v_give integer;
BEGIN
  IF NEW.user_id IS NULL OR COALESCE(NEW.total, 0) <= 0 OR NEW.status = 'CANCELLED'
     OR NEW.points_credited_at IS NULL THEN
    RETURN NEW;
  END IF;
  v_delta := LEAST(COALESCE(NEW.refund_amount, 0), NEW.total) - LEAST(COALESCE(OLD.refund_amount, 0), NEW.total);
  IF v_delta = 0 THEN
    RETURN NEW;
  END IF;

  -- Order coins, plus the +6 bonus if the order was collected.
  v_basis := COALESCE(NEW.points_earned, ROUND(NEW.total / 100.0)::integer)
             + CASE WHEN NEW.status = 'COLLECTED' THEN c_collection_bonus ELSE 0 END;
  v_share := ROUND(v_basis * ABS(v_delta) / NEW.total::numeric)::integer;

  IF v_delta > 0 THEN
    -- Take back, but never below 0. Remember what was really taken.
    SELECT COALESCE(points, 0) INTO v_balance FROM public.profiles WHERE id = NEW.user_id FOR UPDATE;
    v_taken := LEAST(v_share, GREATEST(v_balance, 0));
    UPDATE public.profiles SET points = v_balance - v_taken WHERE id = NEW.user_id;
    UPDATE public.orders SET points_taken_back = COALESCE(points_taken_back, 0) + v_taken WHERE id = NEW.id;
  ELSE
    -- Undo a refund: give back only what was really taken.
    v_give := LEAST(v_share, COALESCE(NEW.points_taken_back, 0));
    UPDATE public.profiles SET points = COALESCE(points, 0) + v_give WHERE id = NEW.user_id;
    UPDATE public.orders SET points_taken_back = COALESCE(points_taken_back, 0) - v_give WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
