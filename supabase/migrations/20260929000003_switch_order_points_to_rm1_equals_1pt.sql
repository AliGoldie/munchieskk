-- Owner's call, made after reviewing real menu costing: switch the order-
-- placement loyalty points model from flat category points (BBQ 15,
-- Premium 20, Platters 30, Sides 5, Drinks 10 -- numbers that never tracked
-- real prices, so a RM3.50 canned Pepsi earned nearly 3x more points per
-- ringgit than a RM69.90 platter) to a plain, transparent RM1 = 1 point.
--
-- Uses orders.total directly -- the server-verified, post-discount amount
-- place_order() actually charged -- rather than re-deriving spend from
-- orders.items, so a promo discount correctly reduces the points earned
-- too, and this can never drift from what place_order() itself computed.

CREATE OR REPLACE FUNCTION public.handle_order_placed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  earned_pts integer;
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    earned_pts := ROUND(COALESCE(NEW.total, 0) / 100.0)::integer;
    IF earned_pts > 0 THEN
      UPDATE public.profiles
      SET points = COALESCE(points, 0) + earned_pts
      WHERE id = NEW.user_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- calculate_order_points(jsonb) -- the old category-based lookup -- is no
-- longer called by anything (confirmed via grep across the whole repo).
-- Dropping it rather than leaving dead SQL behind.
DROP FUNCTION IF EXISTS public.calculate_order_points(jsonb);
