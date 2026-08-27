-- Close a direct-insert abuse path.
--
-- The only order-creation path in the app is `supabase.rpc('place_order', ...)`
-- (src/contexts/StoreContext.jsx), which is SECURITY DEFINER (confirmed BYPASSRLS
-- via `SELECT rolbypassrls FROM pg_roles WHERE rolname='postgres'`), handles guest
-- checkout natively via a nullable p_user_id, and does its own INSERT INTO orders
-- internally. There is no `.from('orders').insert(...)` call anywhere in src/.
--
-- Live production actually had TWO overlapping INSERT policies, neither matching
-- what supabase/migrations said (confirmed by querying pg_policies directly, since
-- this project was never linked/pushed via the CLI before now and had drifted from
-- dashboard-only edits):
--   "Users can insert orders"          (role public)        WITH CHECK (auth.uid() = user_id OR user_id IS NULL)
--   "Users can insert their own orders" (role authenticated) WITH CHECK (auth.uid() = user_id)
-- Because permissive policies are OR'd, either one being satisfied allows the insert.
-- In practice this still lets any logged-in user insert a fake order directly with
-- their own user_id (trivially satisfies both), bypassing place_order's stock
-- deduction and promo validation, and collecting real points from
-- trg_order_placed_award_points on the fake order.
DROP POLICY IF EXISTS "Users can insert orders" ON public.orders;
DROP POLICY IF EXISTS "Users can insert their own orders" ON public.orders;
CREATE POLICY "Deny direct client inserts on orders" ON public.orders
  FOR INSERT
  WITH CHECK (false);

-- Defense in depth: place_order runs as the (bypassrls) function owner, not the
-- calling role, so it doesn't need table-level INSERT grants to keep working.
REVOKE INSERT ON public.orders FROM anon, authenticated;
