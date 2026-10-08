-- Performance cleanup from the Supabase advisor, run while preparing to
-- open: no behavior change anywhere here, just less work per query as the
-- real-order volume grows past the handful of rows it's at today.

-- ============================================================
-- 1. Missing covering indexes on foreign keys (12 findings).
-- ============================================================
create index if not exists idx_item_addons_addon_id on public.item_addons(addon_id);
create index if not exists idx_loyalty_prizes_menu_item_id on public.loyalty_prizes(menu_item_id);
create index if not exists idx_orders_user_id on public.orders(user_id);
create index if not exists idx_promo_redemptions_order_id on public.promo_redemptions(order_id);
create index if not exists idx_promo_redemptions_promo_code_id on public.promo_redemptions(promo_code_id);
create index if not exists idx_promo_redemptions_user_id on public.promo_redemptions(user_id);
create index if not exists idx_recipe_items_ingredient_id on public.recipe_items(ingredient_id);
create index if not exists idx_redemptions_fulfilled_by on public.redemptions(fulfilled_by);
create index if not exists idx_redemptions_prize_id on public.redemptions(prize_id);
create index if not exists idx_redemptions_user_id on public.redemptions(user_id);
create index if not exists idx_waste_log_item_id on public.waste_log(item_id);
create index if not exists idx_waste_log_order_id on public.waste_log(order_id);

-- ============================================================
-- 2. RLS policies re-evaluating auth.uid()/is_admin() per row instead of
--    once per query. Wrapping each call as (select ...) lets Postgres
--    cache it via InitPlan rather than re-running it on every row.
--    Same policies, same access -- only the evaluation cost changes.
-- ============================================================
drop policy if exists "Users can view their own orders" on public.orders;
create policy "Users can view their own orders" on public.orders
  for select using (((select auth.uid()) = user_id) or (select public.is_admin()));

drop policy if exists "Users can view and update own profile" on public.profiles;
create policy "Users can view and update own profile" on public.profiles
  for select using (((select auth.uid()) = id) or (select public.is_admin()));

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles
  for update
  using (((select auth.uid()) = id) or (select public.is_admin()))
  with check (((select auth.uid()) = id) or (select public.is_admin()));

drop policy if exists "Users can view their own order_items" on public.order_items;
create policy "Users can view their own order_items" on public.order_items
  for select using (
    (exists (
      select 1 from public.orders
      where orders.id = (order_items.order_id)::text
        and (orders.user_id)::text = ((select auth.uid()))::text
    )) or (select public.is_admin())
  );

drop policy if exists "Admins can view deduction log" on public.addon_deduction_log;
create policy "Admins can view deduction log" on public.addon_deduction_log
  for select using (exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid()) and profiles.role = 'admin'
  ));

drop policy if exists "Admins can view referral rewards log" on public.referral_rewards_log;
create policy "Admins can view referral rewards log" on public.referral_rewards_log
  for select using (exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid()) and profiles.role = 'admin'
  ));

drop policy if exists "Users can view their own redemptions" on public.redemptions;
create policy "Users can view their own redemptions" on public.redemptions
  for select using (((select auth.uid()) = user_id) or (select public.is_admin()));

drop policy if exists "Admins can view redemptions" on public.promo_redemptions;
create policy "Admins can view redemptions" on public.promo_redemptions
  for select using (exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid()) and profiles.role = 'admin'
  ));

drop policy if exists "Users can read own game plays" on public.game_plays;
create policy "Users can read own game plays" on public.game_plays
  for select using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own game plays" on public.game_plays;
create policy "Users can insert own game plays" on public.game_plays
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "Users can read own engagement points log" on public.engagement_points_log;
create policy "Users can read own engagement points log" on public.engagement_points_log
  for select using ((select auth.uid()) = user_id);

-- ============================================================
-- 3. Redundant overlapping SELECT policies. Each of these tables has both
--    an admin "FOR ALL" policy and a public "FOR SELECT" policy, so every
--    anon/authenticated read runs both. The admin policy is narrowed to
--    INSERT/UPDATE/DELETE only -- admins already get SELECT through the
--    public policy, same as before, just evaluated once instead of twice.
-- ============================================================
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
