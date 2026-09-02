# Merge safety — how not to break the live shop

Read alongside `START-HERE.md`. These are the specific traps in **this** codebase,
found by reading the real files, not generic advice.

---

## The five real traps

### 1. `profiles.role` is `'admin'`, not `'owner'`/`'staff'`
`Admin.jsx` gates the entire page on `user.role !== 'admin'`, and the SQL helper
`public.is_admin()` — used by RLS policies on `store_settings`, `waste_log`,
`loyalty_prizes`, `promo_codes`, `order_items` and `redemptions` — checks the same value.

The admin brief's roles section describes `'owner' | 'staff'`. **Do not rename the
existing value.** Adding `'staff'` as a new role is fine; changing `'admin'` locks the
owner out of the admin page *and* silently breaks every RLS policy at once. If you need
an owner/staff split, keep `'admin'` as the owner value and treat `is_admin()` as
"can reach the console at all".

### 2. Hooks order in `Admin.jsx`
There is a load-bearing comment above the auth guard:

> *"This guard must come after every Hook call above (Rules of Hooks) so that a mid-session
> admin→non-admin transition redirects cleanly instead of changing the number of Hooks
> called between renders and crashing."*

Every `useState`/`useEffect`/`useMemo`/`useRef` you add must go **above**
`if (!user || user.role !== 'admin') return <Navigate to="/login" replace />;`.
Adding state below it crashes on sign-out. The file is ~226 KB — easy to get wrong.

### 3. `profiles` is write-protected — manual points needs an RPC
Migration `20260826000005_lock_down_profiles_and_bonus_rpcs` plus the column-protection
trigger mean the client **cannot** update `points` or `role` directly. Points are only
ever awarded by `SECURITY DEFINER` functions (`place_order`, `redeem_prize`, the
collection/placement triggers), and `award_points` has had EXECUTE revoked from
`public`/`anon`/`authenticated` on purpose.

So **manual points adjustment must be a new `SECURITY DEFINER` RPC** that checks
`is_admin()` internally and writes an audit row. A `supabase.from('profiles').update({points})`
call from the admin UI will fail silently or be rejected — don't "fix" that by loosening
the grants; the lockdown was a deliberate security fix.

### 4. New tables need RLS from birth
`admin_audit`, `shifts`, and the `orders.refund_*` columns are additive, but every
existing table in this schema has `ENABLE ROW LEVEL SECURITY` plus explicit policies.
A new table without RLS is readable by anyone with the anon key. Copy the `waste_log`
pattern:

```sql
alter table public.admin_audit enable row level security;
create policy "Admins manage audit" on public.admin_audit for all using (public.is_admin());
```

`admin_audit` should be **insert + select only** for admins — no update or delete policy,
or an audit log isn't an audit log.

### 5. Don't touch order-ID generation
`20260829000000_atomic_order_id_generation` and `20260829000001_fix_order_id_sequence_race`
exist because this had a race condition in production. The per-day `order_seq_*` sequences
and `order_id_counters` are load-bearing. The only legitimate change is the go-live reset
(`GO-LIVE-RESET.md`), and only when there are zero live orders.

---

## Pre-merge checklist (per PR)

- [ ] `git diff --stat` — does the file list match what the PR claims? `src/App.jsx` must
      not appear in any of the three briefs.
- [ ] No renamed `profiles.role` values, no changes to `is_admin()`.
- [ ] Every new hook in `Admin.jsx` sits above the auth guard.
- [ ] New tables/columns are in a **migration file**, not applied by hand in the SQL editor.
      (The baseline migration exists precisely because that rule was broken before.)
- [ ] New tables have RLS enabled and at least one policy.
- [ ] No new writes to `profiles.points` / `profiles.role` from client code.
- [ ] Existing Supabase queries, order payloads and loyalty point math unchanged unless the
      brief names them.
- [ ] `npm run build` passes.

## Smoke test before merging anything (5 min, in this order)

1. Sign in as admin → console loads, all tabs render, no console errors.
2. Sign **out** from the admin page → redirects cleanly, no React hook error.
3. Sign in as a normal customer → `/admin` redirects to login.
4. Place a real order end to end: `/menu` → cart → payment → order status.
5. In the console: accept → ready → collected. Order lands in Order History; points awarded.
6. Menu CRM: change a price, adjust stock, reorder with ▲▼, tick an add-on on one item.
7. Loyalty: redeem a prize → code appears in the Redemptions tab → fulfil it.
8. Analytics + Monthly Reports still render (they read `cost_price`; a null-cost item must
   fall back to the 40% estimate, not `NaN`).

Steps 6–8 exercise exactly the five already-shipped features listed in
`HANDOFF-ADMIN-CRM.md` §0 — if any of them misbehaves, something got regressed.

## Merge order and blast radius

| PR | Touches | Risk | Notes |
|---|---|---|---|
| `docs/design/` | docs only | none | Merge first, on its own |
| Admin §0 machinery | `Admin.jsx`, `Admin.css`, 1 migration | low | Toast queue, audit, roles. Nothing else works without it |
| Admin features | `Admin.jsx`, `Admin.css`, migrations | low–med | One section per PR, in brief order |
| v4 dark restyle | `global.css` + every customer route | **high** | Do alone, after admin. Restyles everything at once |
| Go-live reset | database only | irreversible | Not a PR. Backup first |

Branch per brief, one feature per commit, and stop for a screenshot diff after each.
If a PR needs `src/App.jsx` or `is_admin()` changed, that's a design question — stop and ask.

## Rollback

- App code: Vercel keeps every deployment — promote the previous one. Faster than a revert.
- Migrations: **write a down-migration before you merge the up.** Additive columns/tables
  are easy (`drop column if exists` / `drop table if exists`). Anything that touches
  `profiles`, RLS policies or `is_admin()` needs a rehearsed rollback, or don't merge it.
- Never roll back the go-live reset — restore the backup instead.
