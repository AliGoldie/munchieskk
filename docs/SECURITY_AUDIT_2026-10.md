# Security audit: 11 Oct 2026

Scope: Supabase database (tables, row-level security, functions, storage, auth
advisors), the website code, HTTP headers, dependencies. Method: read the
live function code and policies, then **reproduced each suspected hole on a
local Postgres loaded with a byte-identical copy of the production functions**
(fingerprints matched) before calling it a bug. Nothing was changed on the live
database during the audit.

## Fixed in this branch (needs the SQL run, see "To apply")

| # | Severity | Problem | How it was proven |
|---|----------|---------|-------------------|
| 1 | **Critical** | **Free food.** `place_order` trusted item quantities from the browser. A negative quantity on a cheap item subtracted from the total: a RM69.90 platter cost **RM0.00** (and that item's stock went *up*). | Reproduced: total 0, Pepsi stock 100 -> 200. |
| 2 | **Critical** | **Infinite points.** Points are awarded when an order is placed, but cancelling never took them back, and cancelling returns the stock. Place + cancel in a loop printed points. Points buy free prizes. | Reproduced: 4 -> 703 points in one loop. |
| 3 | **High** | **Skip the kitchen.** The order status came from the browser, so an order could be created already `COLLECTED` (and then used to farm the share bonus). | Reproduced. |
| 4 | **High** | **Anonymous abuse.** Anyone with the public key could place orders without logging in (drain stock), and cancel or collect other people's guest orders: order ids are sequential and "no owner" matched "no login". | Read from code; the app itself already forces login. |
| 5 | **High** | `award_engagement_points` could be called by anyone for any user. The earlier `REVOKE ... FROM PUBLIC` never applied because Supabase grants `EXECUTE` to `anon`/`authenticated` directly. | Advisor + privilege check. |
| 6 | Medium | The public (`anon`) key had raw INSERT/UPDATE/DELETE/TRUNCATE on every table. Row-level security blocked it, but it was one policy mistake from a breach. | Privilege query. |
| 7 | Medium | No browser security headers (no clickjacking guard, no content policy). | Header check of `vercel.json`. |
| 8 | Low | A leftover `_test_probe_policy` on `orders`. | Policy list. |
| 9 | Low | Dependency vulnerability (dompurify, via jsPDF). | `npm audit` -> 0 after fix. |

Fixed earlier in this session: the `menu-images` storage bucket let anyone
(logged in or not) upload, overwrite and delete photos. Now admin-only.

New rules after the fix: ordering needs a login (the app already required it),
at most 50 of one item per order, at most 5 open (PENDING) orders per customer,
status always starts `PENDING`, empty orders are refused.

## Checked and fine

- Row-level security is on for all 25 tables; customers can only read their own
  orders, redemptions and profile.
- A trigger on `profiles` resets `role`, `points`, `is_admin`, `tier` and other
  sensitive columns for non-admins, so a customer cannot make themselves admin
  or give themselves points.
- `place_order` prices everything server-side from the live menu; stock
  checks use row locks; identity comes from the login token, not the request.
- Admin-only functions (`fulfill_redemption`, `log_grabfood_daily_entry`,
  `undo_grabfood_daily_entry`, `record_closing_stock`) check `is_admin()`.
- `claim_share_bonus` is one claim per order; game rewards are capped at
  20 points/day per game and 150/week overall.
- No secrets in the repo (only the public anon key is used); no `eval`,
  `innerHTML` or `dangerouslySetInnerHTML`; the "mock admin" login only works on
  localhost. Loyverse tokens are locked to the service role.

## Open items (your call or a dashboard setting)

1. **Leaked-password protection is off** (Supabase > Authentication > Passwords).
   Needs a paid Supabase plan. Most customers use Google sign-in, so low impact.
2. **Referral abuse.** A new account using a referral code gets +30 points, and
   the referrer gets +150 when the new user *places* (not collects) a first
   order, capped at 5 referrals per referrer. Throwaway accounts could farm
   this. Safer: pay the referrer when the order is COLLECTED.
3. **Game scores are reported by the browser**, so a determined player can claim
   a high score. The daily/weekly caps limit the damage to a few points a day.
4. `citext` extension sits in the `public` schema (Supabase lint, cosmetic).
5. Cancelling an order takes back the points it earned, but not a referral
   bonus it triggered (see 2).

## To apply

1. Run `supabase/migrations/20261011000000_order_integrity_hardening.sql` in the
   Supabase SQL editor. It is safe to re-run.
2. Merge the branch (headers + code).
3. Regression test: `supabase/tests/order_integrity.test.sql` (part of
   `npm run test:db`). It fails on the old code and passes on the new.

## Rollback

- Headers: revert the `headers` block in `vercel.json`.
- Database: the previous function bodies are in migrations
  `20260929000000` (cancel_order, place_order) and `20260929000004` (place_order).
