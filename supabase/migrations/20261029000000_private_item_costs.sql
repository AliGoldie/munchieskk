-- Cost prices were public. menu_items and addons are readable by every
-- visitor (the menu has to be), and both carried a cost_price column, so
-- anyone with the site's public key could read what each item costs us.
-- Hiding the column with a GRANT is not enough: realtime menu updates send
-- the whole row to every open browser. So the cost moves to its own table
-- that only admins can read, and the public columns are dropped.
--
-- Safe to run twice. Run PART 1, check it, then PART 2.

-- ===================== PART 1: private table + copy =====================

CREATE TABLE IF NOT EXISTS public.item_costs (
  item_kind  text        NOT NULL CHECK (item_kind IN ('menu', 'addon')),
  item_id    text        NOT NULL,
  cost_price integer     CHECK (cost_price IS NULL OR cost_price >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_kind, item_id)
);

ALTER TABLE public.item_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.item_costs FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_costs TO authenticated;

DROP POLICY IF EXISTS "Admins manage item costs" ON public.item_costs;
CREATE POLICY "Admins manage item costs" ON public.item_costs
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Copy what is there today. DO NOTHING keeps any cost already saved in the
-- new table (a re-run never overwrites a newer value).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'menu_items' AND column_name = 'cost_price') THEN
    INSERT INTO public.item_costs (item_kind, item_id, cost_price)
    SELECT 'menu', id::text, cost_price FROM public.menu_items WHERE cost_price IS NOT NULL
    ON CONFLICT (item_kind, item_id) DO NOTHING;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'addons' AND column_name = 'cost_price') THEN
    INSERT INTO public.item_costs (item_kind, item_id, cost_price)
    SELECT 'addon', id::text, cost_price FROM public.addons WHERE cost_price IS NOT NULL
    ON CONFLICT (item_kind, item_id) DO NOTHING;
  END IF;
END $$;

-- ===================== PART 2: remove the public copies =====================
-- Only drops a column once every cost in it is safely in item_costs.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'menu_items' AND column_name = 'cost_price') THEN
    IF EXISTS (SELECT 1 FROM public.menu_items m
               WHERE m.cost_price IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM public.item_costs c
                                 WHERE c.item_kind = 'menu' AND c.item_id = m.id::text)) THEN
      RAISE EXCEPTION 'Not every menu cost is in item_costs yet: run PART 1 first';
    END IF;
    ALTER TABLE public.menu_items DROP COLUMN cost_price;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'addons' AND column_name = 'cost_price') THEN
    IF EXISTS (SELECT 1 FROM public.addons a
               WHERE a.cost_price IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM public.item_costs c
                                 WHERE c.item_kind = 'addon' AND c.item_id = a.id::text)) THEN
      RAISE EXCEPTION 'Not every add-on cost is in item_costs yet: run PART 1 first';
    END IF;
    ALTER TABLE public.addons DROP COLUMN cost_price;
  END IF;
END $$;
