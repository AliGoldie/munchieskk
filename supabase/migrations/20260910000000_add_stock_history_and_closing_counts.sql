-- Stock-quantity changes on menu_items had no history at all -- an admin
-- could see the CURRENT number but never what it was an hour or a day ago,
-- or when/how it changed. This adds two pieces:
--
-- 1. stock_adjustments: a plain audit trail, written automatically by a
--    trigger on every stock_quantity change regardless of source (manual
--    +/- clicks, typing a new number, a sale deduction, a cancelled-order
--    restore) -- so nothing can be missed by forgetting to log it from some
--    call site.
--
-- 2. daily_stock_snapshots + record_closing_stock(): a deliberate "closing
--    count" action for real end-of-day stock taking -- an admin walks
--    through the physical stock and enters what's actually on the shelf;
--    this both updates the live stock_quantity (reconciling system to
--    reality) and keeps a permanent per-day record of what the closing
--    count was, so "what was stock at the end of last Tuesday" is
--    answerable later. One row per item per day (re-recording the same day
--    overwrites, in case of a mistake).

-- ============================================================
-- stock_adjustments
-- ============================================================
CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id text NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  old_quantity integer,
  new_quantity integer NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_item_time
  ON public.stock_adjustments (item_id, changed_at DESC);

ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read stock adjustments" ON public.stock_adjustments;
CREATE POLICY "Admins can read stock adjustments" ON public.stock_adjustments
  FOR SELECT USING (public.is_admin());
-- No client INSERT/UPDATE/DELETE policy -- rows are only ever written by
-- the trigger below, which runs as the table owner and so bypasses RLS.

CREATE OR REPLACE FUNCTION public.log_stock_adjustment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity THEN
    INSERT INTO public.stock_adjustments (item_id, old_quantity, new_quantity)
    VALUES (NEW.id, OLD.stock_quantity, NEW.stock_quantity);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_stock_adjustment ON public.menu_items;
CREATE TRIGGER trg_log_stock_adjustment
AFTER UPDATE ON public.menu_items
FOR EACH ROW
EXECUTE FUNCTION public.log_stock_adjustment();

-- ============================================================
-- daily_stock_snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS public.daily_stock_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id text NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  counted_quantity integer NOT NULL,
  system_quantity_before integer,
  counted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_stock_snapshots_date
  ON public.daily_stock_snapshots (snapshot_date DESC);

ALTER TABLE public.daily_stock_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read stock snapshots" ON public.daily_stock_snapshots;
CREATE POLICY "Admins can read stock snapshots" ON public.daily_stock_snapshots
  FOR SELECT USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.record_closing_stock(p_item_id text, p_counted_quantity integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_system_qty integer;
  v_new_in_stock boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can record closing stock.';
  END IF;
  IF p_counted_quantity IS NULL OR p_counted_quantity < 0 THEN
    RAISE EXCEPTION 'Counted quantity must be zero or more.';
  END IF;

  SELECT stock_quantity INTO v_system_qty FROM public.menu_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Menu item not found.';
  END IF;

  v_new_in_stock := p_counted_quantity > 0;

  UPDATE public.menu_items
  SET stock_quantity = p_counted_quantity, in_stock = v_new_in_stock, manual_override = true
  WHERE id = p_item_id;

  INSERT INTO public.daily_stock_snapshots (item_id, snapshot_date, counted_quantity, system_quantity_before, counted_by)
  VALUES (p_item_id, CURRENT_DATE, p_counted_quantity, v_system_qty, auth.uid())
  ON CONFLICT (item_id, snapshot_date) DO UPDATE
    SET counted_quantity = EXCLUDED.counted_quantity,
        system_quantity_before = EXCLUDED.system_quantity_before,
        counted_by = EXCLUDED.counted_by,
        created_at = now();

  RETURN jsonb_build_object(
    'item_id', p_item_id,
    'system_quantity_before', v_system_qty,
    'counted_quantity', p_counted_quantity,
    'variance', p_counted_quantity - COALESCE(v_system_qty, 0)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_closing_stock(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_closing_stock(text, integer) TO authenticated;
