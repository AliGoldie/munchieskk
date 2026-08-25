CREATE OR REPLACE FUNCTION public.calculate_order_points(items_param jsonb)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  total_pts integer := 0;
  item jsonb;
  cat text;
  qty integer;
  pts_per_item integer;
BEGIN
  IF items_param IS NULL THEN
    RETURN 0;
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(items_param)
  LOOP
    cat := upper(COALESCE(item->>'category', ''));
    qty := COALESCE((item->>'quantity')::integer, 1);
    pts_per_item := CASE cat
      WHEN 'BBQ' THEN 15
      WHEN 'PREMIUM' THEN 20
      WHEN 'PLATTERS' THEN 30
      WHEN 'SIDES' THEN 5
      WHEN 'DRINKS' THEN 10
      ELSE 10
    END;
    total_pts := total_pts + (pts_per_item * qty);
  END LOOP;

  RETURN total_pts;
END;
$$;

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
    earned_pts := public.calculate_order_points(NEW.items);
    IF earned_pts > 0 THEN
      UPDATE public.profiles
      SET points = COALESCE(points, 0) + earned_pts
      WHERE id = NEW.user_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_placed_award_points ON public.orders;
CREATE TRIGGER trg_order_placed_award_points
AFTER INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.handle_order_placed();
