# MunchiesKK: instructions for any AI coding agent

Burger business in Kota Kinabalu, Sabah. React 19 + Vite + Supabase, hosted on Vercel.
GitHub: AliGoldie/munchieskk. Live Supabase project id: zlxuxxlnczpqmlcpzawm. The owner (Ali) is not a developer; keep explanations plain.

## Rules that prevent clashes (read first)
1. `git fetch origin && git pull origin main` BEFORE you change anything. Other tools (Claude Code, earlier Antigravity sessions) have changed this repo. Never trust your memory of the files; read them.
2. Work on a new branch, never directly on `main`. Open or merge a PR only when Ali says "open and merge".
3. Never edit or rename an existing file in `supabase/migrations/`. Most are already applied to the live database. Add a new file with a later timestamp than the newest one (`ls supabase/migrations | tail`).
4. The live database is changed ONLY by Ali, who pastes SQL into the Supabase SQL editor by hand. Do not run write SQL through any tool. Give Ali the SQL in small pieces in chat, and make every migration safe to run twice (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DO $$` guards).
5. Do not rewrite or "clean up" working code you were not asked to touch. Do not change customer-facing pages unless asked.
6. Before saying something is done: `npm run lint`, `npm run build`, and `npm run test:db` (needs a local Postgres, see `supabase/tests/run-db-tests.sh`) must pass. If you add a rule in SQL, add a test in `supabase/tests/`.

## Current loyalty rules (source of truth is `docs/POINTS_SYSTEM.md`; read it before touching points)
- RM1 = 1 point, plus rank bonus 5/8/12% (Pro/Master/Ultimate, from lifetime spend on COLLECTED orders). Points are worked out when the order is placed (`orders.points_earned`) but PAID when the order is collected, together with a +6 bonus (`orders.points_credited_at`). No points for delivery.
- Double points Tue/Wed/Thu (Malaysia time), switch in Admin > Prizes CRM (`points_boost` table).
- Share +20 (+20 more with approved screenshot). Referral: referrer +150 and friend +30, both after the friend's first collected order of RM20 or more.
- Points expire gradually after 12 months of inactivity (25% per month fade). Free Fries costs 100 points.
- Games (T-Rex Runner, Speed Grab, Munch-Man) pay NO points per run. They add to Arcade Score; 1,000 weekly Arcade Score = +25 points once a week; a monthly contest gives prizes to the top 3.
- Sign-up has NO privacy/age checkbox (owner decision). No staff "give points by phone" button (owner decision). Catering stays Off. Wording is "sliders/packs", not "tray". Never say "smash burger".

## Where things live
- `src/pages/` customer pages and `Admin.jsx`; `src/components/` shared parts and admin panels; `src/hooks/`, `src/utils/`, `src/config/`.
- Games: `src/components/TrexRunnerModal.jsx` (+ `trexStages.js`, art in `public/images/trex/`), `SpeedGrabModal.jsx`, `MunchManModal.jsx`.
- Database: `supabase/migrations/` (applied in filename order), `supabase/tests/*.test.sql`. Business rules live in SECURITY DEFINER functions and triggers, not in the browser. Internal functions are REVOKEd from anon/authenticated.
- `vercel.json`: the catch-all rewrite must point to `/` (pointing to `/index.html` caused 404s on refresh). Keep the CSP header in mind when adding external scripts or images.
- PWA: `public/manifest.webmanifest`, `public/sw.js` (passthrough, no caching), `src/hooks/useInstallApp.js`.
- Docs: `docs/` (points system, security audit, SEO playbook, arcade contest brief).

## Known facts
- Preview deploys on Vercel probably talk to the LIVE database. Do not test destructive actions on a preview.
- The shop may be closed with stock at 0; do not "fix" that in code.
- Security: never expose the Supabase service-role key; the browser only uses the anon key from env vars.

## When you finish a change
Add a dated line to `docs/CONTENT_TEAM_SYNC.md` for any change that affects what the content team says (rules, names, prizes, dates). Their agents read it at the start of every session.
Update the relevant file in `docs/` and this file if a rule changed, and tell Ali exactly which SQL (if any) he must run and in what order.
