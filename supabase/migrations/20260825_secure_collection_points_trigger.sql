CREATE OR REPLACE FUNCTION public.handle_order_collected()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'COLLECTED' AND (OLD.status IS DISTINCT FROM 'COLLECTED') AND NEW.user_id IS NOT NULL THEN
    UPDATE public.profiles
    SET points = COALESCE(points, 0) + 10
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_collected_award_points ON public.orders;
CREATE TRIGGER trg_order_collected_award_points
AFTER UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.handle_order_collected();
