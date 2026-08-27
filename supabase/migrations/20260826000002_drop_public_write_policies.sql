-- Three fully-public policies were found live in production via `pg_policies`,
-- none present in any migration file — they were added directly via the dashboard
-- and never committed. Each is a genuine, unauthenticated hole; each has a
-- legitimate admin-only equivalent already in place, so dropping these has zero
-- functional impact on the app.
--
--   orders     SELECT "Anyone can view orders"        (qual: true) — any unauthenticated
--              request can read every order's customer_name, customer_phone, items,
--              and total. "Users can view their own orders" (auth.uid()=user_id OR
--              is_admin()) already exists and is the correct policy.
--
--   orders     UPDATE "Allow Update"                  (qual: true, with_check: true)
--              — anyone can modify any field on any order (status, total, etc.).
--              "Admins can update orders" (is_admin()) already covers the real
--              admin accept/status-change flow (StoreContext.jsx updateOrderState/
--              acceptOrder).
--
--   addons     UPDATE "Allow public update addons"    (qual: true, with_check: true)
--              — anyone can change add-on prices/stock. "Admins can manage addons"
--              (is_admin(), FOR ALL) already covers the admin CRM.
--
--   menu_items UPDATE "Allow public update menu_items" (qual: true, with_check: true)
--              — anyone can change menu prices/stock/availability. "Admins can
--              update menu_items" (is_admin()) already covers the admin CRM.
DROP POLICY IF EXISTS "Anyone can view orders" ON public.orders;
DROP POLICY IF EXISTS "Allow Update" ON public.orders;
DROP POLICY IF EXISTS "Allow public update addons" ON public.addons;
DROP POLICY IF EXISTS "Allow public update menu_items" ON public.menu_items;
