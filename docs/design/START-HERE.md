# Munchies KK — design handoff pack (START HERE)

Everything a coding agent (Claude Code / Antigravity / new chat) needs to build from the
approved designs. Repo `AliGoldie/munchieskk`, branch `main`.

**Verified against repo tree `e1925935658a` on 2026-09-02.** If the repo has moved since,
diff before building — see "Before you start" below.

### ⚠ Branch warning — `design/v4-cinematic-dark`

This branch exists on the remote and **must not be merged.** Checked 2026-09-02:

- It is **26 commits behind `main`** — merging or rebasing onto it rewinds shipped work
  (`cost_price`, `sort_order`, `avatar_color` and their migrations).
- It contains **none of the v4 dark restyle.** `src/styles/global.css` on that branch is the
  light brutalist theme verbatim: `color-scheme: light`, `--bg-color: var(--munchies-yellow)`,
  `background-image: url('/images/trex_pattern.png')`. Zero dark tokens.

It is an empty placeholder branch, not work in progress. **v4 dark is NOT integrated
anywhere.** Build it fresh from `HANDOFF-V4-DARK.md` on a new branch cut from current
`main`, and delete `design/v4-cinematic-dark` to stop anyone reaching for it.

---

## What's in this folder

| File | What it is | Status |
|---|---|---|
| `Munchieskk Admin Console.dc.html` | Approved admin/CRM design — 12 tabs, desktop 1440 / tablet 1024 toggle. **Open it and click through; every control is live.** | Not built |
| `HANDOFF-ADMIN-CRM.md` | Build brief for the above. Read §0 first. | Not built |
| `Munchieskk Website Mockup v4.dc.html` | Cinematic dark landing page, 390→1440px | Not built |
| `Munchieskk Site v4 Screens.dc.html` | All 11 routes in the v4 dark language | Not built |
| `HANDOFF-V4-DARK.md` | Token replacement table + per-route work order for v4 dark | Not built |
| `munchieskk-mockups.html` | Original 10-screen mobile app spec at 380px | Partly built |
| `HANDOFF-PROMPT.md` | Brief for the above | Partly built |
| `support.js` | Runtime the `.dc.html` files need — keep it beside them | — |
| `GO-LIVE-RESET.md` | Pre-launch data wipe: SQL to zero all sales/points/test accounts, keeping menu, prizes, settings and staff logins | Run once, at launch |
| `MERGE-SAFETY.md` | **Read before merging any PR.** The five real traps in this codebase, a per-PR checklist, an 8-step smoke test, merge order and rollback | — |

The three briefs are independent. **Do not run two at once** — v4 dark restyles the same
customer routes the mobile spec covers, and admin work is separate from both.

Suggested order: **Admin CRM** (highest operational value, touches only `Admin.jsx`) →
**v4 dark** (visual, wide blast radius) → leftover items from the mobile spec.

---

## Before you start (5 minutes, do not skip)

1. `git log --oneline -20` — if `main` has moved past `e1925935658a`, the "already shipped"
   list in `HANDOFF-ADMIN-CRM.md` §0 may be incomplete. Re-check before deleting anything.
2. Read `HANDOFF-ADMIN-CRM.md` **§0 "Do not regress what already shipped"** in full. Five
   features are already live and the brief's older sections predate them:
   `menu_items.cost_price`, `sort_order` ▲▼ reordering, `profiles.avatar_color`, the
   **per-item add-on checkbox matrix**, and the **prize → menu item link**.
3. `supabase/migrations/` — `cost_price`, `sort_order`, `avatar_color` migrations are
   already applied. New tables the brief asks for (`admin_audit`, `shifts`, `orders.refund_*`)
   are additive on top.
4. `src/App.jsx` stays **byte-identical** in all three briefs. No routing changes.
5. Read `MERGE-SAFETY.md`. In particular: `profiles.role` is `'admin'` and must stay that
   way (`is_admin()` and every RLS policy depend on it), new hooks in `Admin.jsx` must go
   **above** the auth guard, and `profiles.points` cannot be written from the client.

---

## Ground rules for every brief

- One feature per commit; stop and show a diff/screenshot before moving on.
- Reuse tokens from `src/styles/global.css` — never invent colours.
- Don't touch Supabase queries, contexts, or loyalty point math unless a task says so.
- Pickup only. No delivery language anywhere in the UI.
- Every destructive admin action needs an undo and an audit row (see brief §0).

---

## Paste this into a new chat to start the admin build

> You have the `AliGoldie/munchieskk` repo. Open `docs/design/START-HERE.md` and
> `docs/design/HANDOFF-ADMIN-CRM.md`, then open `docs/design/Munchieskk Admin Console.dc.html`
> in the browser preview — it's the approved design and every control in it is live.
>
> Before writing any code: run `git log --oneline -20`, read §0 of the brief, and confirm
> which of the five "already shipped" features are present in `src/pages/Admin.jsx`. Report
> back what you found and your build order. Do not start until I confirm.
>
> Also read `docs/design/MERGE-SAFETY.md` — it lists five specific traps in this codebase.
> Confirm you understand the `profiles.role` and hooks-order constraints before coding.
>
> Work from `main` only. Ignore the `design/v4-cinematic-dark` branch entirely — it is 26
> commits behind and contains no v4 work; see the branch warning in START-HERE.md.
>
> Then build one section per commit, in brief order (§0 shared machinery first — toast
> queue, audit log, roles — everything else depends on it). Target `src/pages/Admin.jsx` +
> `Admin.css` and new Supabase migrations only. `src/App.jsx` stays byte-identical. Show me
> a screenshot diff after each section.

For the v4 dark restyle, swap in `HANDOFF-V4-DARK.md` and its two `.dc.html` files; for the
mobile app spec, `HANDOFF-PROMPT.md` + `munchieskk-mockups.html`.

---

## Still-open design work (not yet specced — ask before building)

`game_plays` admin oversight, manual points adjustment, Loyverse OAuth token-health
warnings, and the wider `promo_codes` features the current brief doesn't cover
(BOGO, per-user caps, stackability). `order_items` is dead in the schema — decide whether
to use or drop it (`GO-LIVE-RESET.md` recommends dropping it).

## At launch

`GO-LIVE-RESET.md` is the last step before going live — it empties every transactional
table, zeroes all loyalty points, deletes test customer accounts, and restarts order
numbering at #1, while keeping the menu, add-ons, prizes, categories, trading hours and
staff logins. Take a backup first; it is irreversible.
