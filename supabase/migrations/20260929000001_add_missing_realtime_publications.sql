-- Pre-launch audit found menu_items, orders, and item_addons were added to
-- the supabase_realtime publication only via a loose, untracked root-level
-- script (enable_realtime_publication.sql) that was apparently run by hand
-- against the live project -- a fresh database built from this migration
-- history alone would silently lack realtime for exactly the tables
-- StoreContext.jsx subscribes to for live menu/stock/order updates
-- (addons and store_settings/profiles were already captured correctly by
-- 20260821000000_addon_stock_and_deduction_logging.sql and
-- 20260918000000_security_lint_fixes.sql). This captures the missing three
-- for real, idempotently -- safe to run even if they're already members.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.menu_items;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.item_addons;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
