-- ============================================================================
-- MANUAL RESET SCRIPT -- run by hand in the Supabase Dashboard -> SQL Editor
-- when you're ready to open for real. This is NOT a migration: it lives
-- outside supabase/migrations/ on purpose, so `supabase db push` (or any CI)
-- never applies it automatically. Nothing happens until you paste this in
-- and run it yourself.
--
-- WHAT THIS WIPES (all pre-launch test data):
--   - every order, and everything derived from an order: promo redemptions,
--     add-on deduction log, prize redemptions, referral reward log,
--     engagement/arcade points log, waste log, stock & ingredient
--     adjustment history, order-id day counters
--   - admin audit log, shift handover history, store diary/calendar events
--   - every customer account (auth + profile) EXCEPT the two admin emails
--     named below
--
-- WHAT THIS KEEPS, UNTOUCHED:
--   - the menu, add-ons, ingredients, recipes, and their prices
--   - promo code definitions and the loyalty prize catalog (just usage/
--     redemption history is cleared, not the prizes themselves)
--   - store_settings
--   - the two admin accounts: munchieskk.sabah@gmail.com and
--     aligoldie@gmail.com -- edit the two emails just below FIRST if that
--     ever changes
--
-- ALSO ZEROES current stock counts on menu_items / addons / ingredients (see
-- the block near the bottom) so nothing sells against leftover test-era
-- numbers -- comment that block out if you'd rather keep those figures and
-- punch in real counts over them yourself.
--
-- THIS IS IRREVERSIBLE ONCE COMMITTED. If you want a paper record of the
-- test data first: Supabase Dashboard -> Table Editor -> orders -> Export
-- to CSV, before running this.
--
-- aligoldie@gmail.com must have already signed up in the app once (so its
-- profiles row exists) or the admin-count check below will abort the whole
-- script rather than silently keeping the wrong set of accounts.
-- ============================================================================

begin;

create temporary table _keep_admins as
select id from auth.users
where email in ('munchieskk.sabah@gmail.com', 'aligoldie@gmail.com');

do $$
begin
  if (select count(*) from _keep_admins) <> 2 then
    raise exception
      'Expected exactly 2 admin accounts to preserve, found %. Aborting -- check the emails list at the top of this script and that both have signed up.',
      (select count(*) from _keep_admins);
  end if;
end $$;

-- Children of orders/profiles first, so nothing fails on a foreign key.
-- Each table is checked for existence before deleting from it: this list
-- was built from the repo's migration files, but at least one of them
-- (order_id_counters) turned out to have never actually been applied to
-- this live project, so the migration history and the real schema have
-- drifted -- don't assume the rest match perfectly either.
do $$
declare
  tbl text;
  tables text[] := array[
    'redemptions',           -- prize redemptions (references profiles, no cascade)
    'waste_log',             -- references orders, no cascade
    'promo_redemptions',     -- references orders (cascades anyway; explicit for clarity)
    'addon_deduction_log',
    'order_items',           -- confirmed unused/always-empty, kept for completeness
    'referral_rewards_log',
    'engagement_points_log',
    'game_plays',
    'stock_adjustments',
    'daily_stock_snapshots',
    'ingredient_adjustments',
    'admin_audit',
    'shifts',
    'store_events',
    'order_id_counters'      -- so today's first real order is NNN=001 again, if this exists here
  ];
begin
  foreach tbl in array tables loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = tbl
    ) then
      execute format('delete from public.%I', tbl);
    end if;
  end loop;
end $$;

-- Now the orders themselves.
delete from public.orders;

-- Zero out current stock so day one starts from real counts you punch in --
-- comment this block out to keep the existing (test-era) numbers instead.
update public.menu_items set stock_quantity = 0, in_stock = false;
update public.addons set stock_quantity = 0, in_stock = false;
update public.ingredients set stock_quantity = 0;

-- Customer accounts: profiles first (the redemptions that referenced them
-- are already gone above), then the underlying auth.users rows.
delete from public.profiles where id not in (select id from _keep_admins);
delete from auth.users where id not in (select id from _keep_admins);

drop table _keep_admins;

commit;

-- If the final "delete from auth.users" line errors with a permissions
-- message (some Supabase plans restrict direct writes to the auth schema
-- from the SQL Editor), run everything above it, COMMIT, then delete the
-- remaining non-admin users by hand instead: Dashboard -> Authentication ->
-- Users -> select everyone except the two admin emails -> Delete.
