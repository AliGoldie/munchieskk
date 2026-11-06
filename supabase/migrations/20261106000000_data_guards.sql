-- Data guards: the database itself refuses impossible numbers, so a bug in
-- the app (or a typo in the SQL editor) can never leave a negative stock,
-- price, order total or coin balance behind.
--
-- Checked live on 6 Nov 2026 before writing this: no row breaks any of these
-- rules today. Every function that changes these numbers already clamps at 0
-- or refuses first, so normal use is unaffected; only a mistake is blocked.
--
-- Also indexes the one foreign key that had no index.
--
-- Safe to run twice.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('menu_items', 'menu_items_stock_not_negative', 'stock_quantity >= 0'),
      ('addons',     'addons_stock_not_negative',     'stock_quantity >= 0'),
      ('menu_items', 'menu_items_price_not_negative', 'price >= 0'),
      ('addons',     'addons_price_not_negative',     'price >= 0'),
      ('orders',     'orders_total_not_negative',     'total >= 0'),
      ('profiles',   'profiles_points_not_negative',  'points >= 0')
    ) AS t(tbl, cname, rule)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.cname) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s)', r.tbl, r.cname, r.rule);
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_swap_slots_default_meat ON public.swap_slots (default_meat);
