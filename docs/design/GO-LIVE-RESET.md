# Go-live reset — zero the data, keep the shop

Run this **once, immediately before launch**, after the last round of testing.
It empties every transactional table and every test account, and leaves the menu,
prizes, categories, settings and your staff logins intact.

⚠️ **Irreversible.** Take a Supabase backup first (Dashboard → Database → Backups →
"Create backup"), and run it in the SQL Editor in one go so it's a single transaction.

---

## What gets wiped vs kept

| Wiped to zero | Kept as-is |
|---|---|
| `orders` (all history, all channels) | `menu_items` (names, prices, `cost_price`, photos, `sort_order`) |
| `order_items` (dead table — see cleanup below) | `addons` + `item_addons` (the per-item matrix) |
| `promo_redemptions`, `promo_codes.usage_count` | `promo_codes` themselves (deactivate the test ones by hand) |
| `redemptions` (prize claim codes) | `loyalty_prizes` (prize catalogue + `menu_item_id` links) |
| `game_plays` (arcade play history) | `categories` |
| `waste_log` | `store_settings` (hours, weekly schedule, closures, arcade flag) |
| `addon_deduction_log`, `referral_rewards_log` | `loyverse_oauth_tokens` (do **not** wipe — you'd have to re-auth) |
| `profiles.points` → 0, referral links cleared | Staff/admin `profiles` rows and their auth users |
| All non-staff `auth.users` (test customers) | Storage buckets / uploaded item photos |
| Daily order-number sequences → order #1 | |

---

## Step 1 — list the accounts to keep

```sql
select id, email, role from auth.users
  join public.profiles using (id)
 order by role, email;
```

Copy the UUIDs of every account that should survive (you + staff) into the
`keep_users` list in step 2. **Every other user is deleted.**

## Step 2 — the reset

```sql
begin;

-- Accounts that survive. Put every admin/staff UUID here.
create temp table keep_users (id uuid primary key);
insert into keep_users (id) values
  ('00000000-0000-0000-0000-000000000000'),  -- ← replace: owner
  ('00000000-0000-0000-0000-000000000000');  -- ← replace: staff

-- Sanity check — must list exactly the people you expect, and nobody else.
select u.email, p.role from auth.users u
  join public.profiles p on p.id = u.id
 where u.id in (select id from keep_users);

-- 1. Transactional data. Child tables first; most FKs cascade from orders
--    anyway, but explicit deletes keep the intent readable.
delete from public.promo_redemptions;
delete from public.redemptions;
delete from public.order_items;
delete from public.waste_log;
delete from public.game_plays;
delete from public.addon_deduction_log;
delete from public.referral_rewards_log;
delete from public.orders;

-- 2. Promo usage counters back to zero (the codes themselves stay).
update public.promo_codes set usage_count = 0;

-- 3. Order numbering starts again at 1.
delete from public.order_id_counters;
do $$
declare s record;
begin
  for s in select sequencename from pg_sequences
            where schemaname = 'public' and sequencename like 'order_seq_%'
  loop
    execute format('drop sequence if exists public.%I', s.sequencename);
  end loop;
end $$;

-- 4. Loyalty + referral state on the accounts that stay.
update public.profiles
   set points = 0,
       referred_by = null,
       referral_converted_at = null;

-- 5. Delete every test customer. profiles cascades from auth.users.
delete from auth.users where id not in (select id from keep_users);

-- 6. Confirm the survivors kept their admin role.
select id, email, role, points from public.profiles
  join auth.users using (id);

commit;
```

Read the output of step 6 before you `commit`. If the role column isn't `admin`
for your account, roll back — the auto-create-profile trigger may have re-inserted
a default row.

## Step 3 — reset the shop floor, by hand in the admin console

Deliberately not scripted, because these are judgement calls:

- **Stock quantities** — set real opening stock per item in Menu CRM. To bulk-clear
  instead: `update public.menu_items set stock_quantity = 0, in_stock = false;`
- **Test promo codes** — delete or deactivate them in Promotions → Codes.
- **Prizes** — check the catalogue is the real launch set and each prize's
  `menu_item_id` link is right (redemption cost reads through it).
- **Trading hours + closures** — confirm the weekly schedule and clear test closures.
- **Notice message** — clear `store_settings.notice_message` and set `status = 'OPEN'`.
- **Arcade** — `arcade_enabled` on or off for launch day.
- **Diary entries** — the two seeded demo events live in `localStorage`
  (`munchies_admin_events_notes`), not the database. Clear that key in each browser
  you've used, or they reappear.

## Step 4 — verify before you announce

1. Sign in as a fresh customer account → 0 points, empty order history, no referral.
2. Place one real order → it gets **#1** for the day.
3. It appears in Live Orders, advances to Collected, lands in Order History.
4. Points awarded on collection are correct.
5. Analytics and Monthly Reports show that one order and nothing else.
6. Then delete that test order and re-run step 3 of the SQL above (order numbering only).

---

## Optional cleanup while you're in there

`order_items` is empty and referenced nowhere in `src/` — the app stores line items
as JSONB on `orders.items`. Safe to drop as part of the go-live tidy:

```sql
drop table if exists public.order_items;
```

Do it as a proper migration file, not an ad-hoc SQL Editor statement, so the schema
stays reproducible.
