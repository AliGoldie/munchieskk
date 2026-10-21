# Repo map: where everything lives

One page so anyone (Ali, a developer, an AI agent) can find things fast. Updated 21 Oct 2026.

## Top folder

| Path | What it is |
|---|---|
| `AGENTS.md` | Rules for any AI agent working here. Read first. (`GEMINI.md` just points to it.) |
| `README.md` | Short intro and how to run the site locally. |
| `src/` | The website's code (React). |
| `public/` | Files served as-is: web images, icons, `manifest.webmanifest`, `sw.js`. |
| `supabase/` | Database: migrations, tests, and Loyverse edge functions. |
| `docs/` | Rules, briefs and audits (see below). |
| `tests/e2e/` | Browser tests (Playwright), run in CI. |
| `scripts/` | Build helpers: SEO pre-render, image resizing. |
| `design-originals/` | Source artwork (mascot, game art, mock-ups). **Not used by the site.** |
| `vercel.json` | Hosting: redirects, security headers (CSP), caching. |
| `.github/workflows/ci.yml` | Checks run on every PR: lint, build, database tests, browser tests. |

## The website (`src/`)

| Path | What it is |
|---|---|
| `src/pages/` | One file per page: `Home`, `Menu`, `Cart`, `Payment`, `OrderStatus`, `Loyalty`, `Arcade`, `Profile`, `Catering`, `Login`, `Signup`, `ResetPassword`. |
| `src/pages/Admin.jsx` | The whole staff dashboard (very large; one section per sidebar tab). `AdminReports.jsx` is the PDF reports page. |
| `src/components/` | Shared pieces: `RankCard`, `CheckoutRewards`, game modals (`TrexRunnerModal`, `SpeedGrabModal`, `MunchManModal`), and admin panels (`Admin*.jsx`). |
| `src/contexts/StoreContext.jsx` | Loads the menu, add-ons, rewards, shop settings and orders from the database, and holds the cart. |
| `src/contexts/AuthContext.jsx` | Sign-in and the current user. |
| `src/utils/` | Small helpers (reward rules, time zone, points maths, images). |
| `src/config/` | Settings: Supabase client, SEO text, reward names ("Monsta Coins", "Burger XP"). |
| `src/hooks/` | `useInstallApp` (PWA install), `useCountUp`. |

## The database (`supabase/`)

| Path | What it is |
|---|---|
| `supabase/migrations/` | Every database change, applied in filename order. **Never edit or rename one**; add a new file with a later date. Ali runs them by hand in the Supabase SQL editor. |
| `supabase/tests/` | One test file per rule (`*.test.sql`). Run with `npm run test:db`. |
| `supabase/functions/` | Loyverse till integration (price sync, webhook, login). |

Where key business data lives:
- **Menu and add-ons:** `menu_items`, `addons` (public, the menu has to be readable).
- **Cost prices:** `item_costs`, **admin-only**. Never put a cost back on a public table.
- **Recipes and ingredients:** `ingredients`, `recipe_items`, admin-only.
- **Orders and points:** `orders` (points per order), `profiles` (balance), `engagement_points_log` (share, referral, game bonuses); rules in SECURITY DEFINER functions.
- **Rewards:** `loyalty_prizes` (Prize Vault items and rank perks).

## Docs (`docs/`)

| File | Read it for |
|---|---|
| `POINTS_SYSTEM.md` | The loyalty rules. Source of truth. |
| `CONTENT_TEAM_SYNC.md` | What is live / undecided, for the content and marketing teams. Their agents read it every session. |
| `ARCADE_CONTEST_FOR_CONTENT_TEAM.md` | The monthly arcade contest, in plain words. |
| `FINANCE_BRIEF.md` | Numbers for the finance decisions (reward prices, costs). |
| `SEO_PLAYBOOK.md` | Technical SEO done in code, plus the non-code checklist. |
| `SECURITY_AUDIT_2026-10.md`, `POINTS_AUDIT_2026-10.md` | Past audits. |
| `REPO_MAP.md` | This page. |
| `marketing/README.md` | Pointer to the `content-team` repo, where campaigns live. |
| `archive/` | Old material kept for history. **Not current.** Includes a pre-launch data-wipe script marked DO NOT RUN. |

## Branches

`main` is the live site. Every change is made on its own branch and merged by PR when Ali says "open and merge". Cloud Claude sessions get a random branch name such as `claude/blissful-ptolemy-jzt6g2`; the name means nothing, it is just that session's workspace.
