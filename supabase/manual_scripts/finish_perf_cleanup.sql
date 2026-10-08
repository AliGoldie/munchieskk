-- Run this in the Supabase Dashboard -> SQL Editor (default/postgres role,
-- no RLS toggle needed). Everything else in the DB performance cleanup
-- (missing FK indexes, the auth.uid()/is_admin() re-evaluation fix on 11
-- other policies) was already applied directly. These last pieces all
-- need DROP POLICY, which the automated tool path in this session couldn't
-- run (it hangs waiting on a confirmation step that never arrives there) --
-- so they're left here for you to run by hand, same as the earlier scripts.

-- 1. Remove a throwaway test policy left on `orders` while diagnosing the
--    DROP issue above. Harmless (it never matched anything -- `using
--    (false)`), but it was adding noise to the "multiple permissive
--    policies" advisor count, so worth tidying up.
drop policy if exists "_test_probe_policy" on public.orders;

-- 2. Merge the last redundant-policy pair the performance advisor flagged:
--    promo_codes has both an admin "FOR ALL" policy and a public "FOR
--    SELECT" policy, so every read evaluates both. Narrowing the admin
--    policy to INSERT/UPDATE/DELETE removes the overlap -- admins still
--    get SELECT through the public policy, same access as before.
drop policy if exists "Admins have full access to promo codes" on public.promo_codes;
create policy "Admins can insert promo codes" on public.promo_codes
  for insert with check (exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid()) and profiles.role = 'admin'
  ));
create policy "Admins can update promo codes" on public.promo_codes
  for update
  using (exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid()) and profiles.role = 'admin'
  ))
  with check (exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid()) and profiles.role = 'admin'
  ));
create policy "Admins can delete promo codes" on public.promo_codes
  for delete using (exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid()) and profiles.role = 'admin'
  ));

-- 3. Same redundant-policy pattern on addons, item_addons, and
--    loyalty_prizes.
drop policy if exists "Admins can manage addons" on public.addons;
create policy "Admins can insert addons" on public.addons
  for insert with check ((select public.is_admin()));
create policy "Admins can update addons" on public.addons
  for update using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins can delete addons" on public.addons
  for delete using ((select public.is_admin()));

drop policy if exists "Admins can manage item_addons" on public.item_addons;
create policy "Admins can insert item_addons" on public.item_addons
  for insert with check ((select public.is_admin()));
create policy "Admins can update item_addons" on public.item_addons
  for update using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins can delete item_addons" on public.item_addons
  for delete using ((select public.is_admin()));

drop policy if exists "Admins manage prizes" on public.loyalty_prizes;
create policy "Admins can insert prizes" on public.loyalty_prizes
  for insert with check ((select public.is_admin()));
create policy "Admins can update prizes" on public.loyalty_prizes
  for update using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins can delete prizes" on public.loyalty_prizes
  for delete using ((select public.is_admin()));
