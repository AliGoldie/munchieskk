# Munchies KK — App UI Redesign Handoff (for Google Antigravity / any coding agent)

> **Paste this whole file as your first message to Antigravity**, with `munchieskk-mockups.html` open (or committed to the repo) as the visual reference. Suggested opening line:
>
> *"You have the Munchies KK repo open. `docs/design/munchieskk-mockups.html` is the approved UI spec — 10 screens rendered at 380px. `docs/design/HANDOFF-PROMPT.md` is the full brief. Work route by route in the order listed, one route per commit. Open the mockup in the browser preview and match it screen by screen. Do not change Supabase queries, contexts, or point math. Stop after each route and show me a screenshot diff before continuing."*
>
> Then work through the checklist below with it. Antigravity does best with one route per turn — resist letting it do all ten at once.


## Context
Existing app: React 18 + Vite + react-router-dom + Supabase, repo `AliGoldie/munchieskk`, deployed at munchieskk.vercel.app. Homemade halal premium burgers, Penampang, Sabah. **Pickup only — no delivery anywhere in the UI.**

The design reference is `Munchieskk App Mockups.dc.html` in this project: 10 screens at 380px width, styled from the app's real brand tokens. Treat it as the visual spec, not as code to copy.

## Scope
Restyle/upgrade these routes in place. Do **not** change data models, Supabase queries, contexts, or business logic unless a task below says so.

| Route | File | Change |
|---|---|---|
| `/` | `src/pages/Home.jsx` + `.css` | Hero card, category lineup, loyalty progress strip, 2-up featured grid |
| `/menu` | `src/pages/Menu.jsx` + `.css` | Category tab pills, featured hero, **redesigned category headers**, item rows |
| `/cart` | `src/pages/Cart.jsx` + `.css` | Store selector, **flexible pickup time**, payment method, total |
| `/payment` | `src/pages/Payment.jsx` + `.css` | Fulfillment timing, method cards, promo, summary |
| `/order/:id` | `src/pages/OrderStatus.jsx` + `.css` | 4-step pickup progress tracker |
| `/loyalty` | `src/pages/Loyalty.jsx` + `.css` | Tier card, progress bar, prize vault, point history |
| `/arcade` | `src/pages/Arcade.jsx` + `.css` | Weekly prize banner, rank card, points card, game card |
| `/profile` | `src/pages/Profile.jsx` + `.css` | Personal info, rewards teaser, referral, order history |
| `/login` | `src/pages/Login.jsx` + `.css` | Centred brand card, form, social, signup prompt |
| `/signup` | `src/pages/Signup.jsx` | Match the Login card styling (no mockup — mirror it) |

## Design language (already in `src/styles/global.css` — reuse the tokens, don't invent)
- **Type:** Kanit 700/800/900 for headings, buttons, numbers (uppercase). Inter 400–800 for body.
- **Palette:** dark `#1a1a1a`, orange `#E8491D` / deep `#c73b0f`, yellow `#FFC72C`, blue `#93d9f8`, canvas `#f4f1ea`, white surfaces. Muted text `#64748b`.
- **Brutalist chrome:** 3px `#1a1a1a` borders, hard offset shadows (`3px 3px 0 0 #1a1a1a` / `4px 4px 0`), pill radii (`999px`) on all buttons, 16–22px card radii. No soft blurred shadows on brand elements.
- **Category colors** (keep the existing `CATEGORY_COLORS` map): BBQ `#E8650A`, PREMIUM `#9B30C9`, PLATTERS `#D4A017`, SIDES `#1DAA54`, DRINKS `#2E7DD6`.

## Specific tasks

### 1. Menu category headers — replace the dark bar
Current headers are a `#1c1c1e` block with a left border. Replace with a light tinted card per category:
- background = category tint (`BBQ #FFF0E6`, `PREMIUM #FBE9FF`, `PLATTERS #FFF5E0`, `SIDES #E6FFF0`, `DRINKS #E6F0FF`)
- 3px `#1a1a1a` border + `4px 4px 0 0 #1a1a1a` shadow, radius 16px
- 9px full-height bar in the category color on the left edge, with a 3px dark right border
- oversized ghosted category word top-right: Kanit 900, ~66px, category color at `opacity .14`, `pointer-events:none`, behind the title
- icon in a 42px white circle with a 3px dark border
- title in the category's deep shade (`BBQ #9C3D00`, `PREMIUM #6B1D87`, `PLATTERS #8B6914`, `SIDES #0E6930`, `DRINKS #1A4C8B`), display names **"BBQ Signature", "Premium", "Platters", "Sides", "Drinks"**
- item-count pill under the title: white text on the category color, 2px dark border, `999px` radius
- give each header `id={`cat-${categoryKey}`}` and `scroll-margin-top: 70px`

### 2. Home → Menu deep links
Each Menu Lineup tile links to `/menu#cat-<KEY>`; "See All" links to `/menu`. On `/menu` mount, if `location.hash` matches a category, select that tab **and** scroll its header into view (respect `prefers-reduced-motion`).

### 3. Flexible pickup time (Cart + Payment) — behavior change
Quick slot pills stay, but add a **custom time** control below them:
- stepper: `−` / time display / `+`, 15-minute increments
- **hard clamp to store opening hours** (currently 6:00 PM – 12:00 AM; read from `shopSettings.openingTime` / `closingTime`, never hardcode). Disable/no-op the steppers at the bounds.
- selecting custom deselects the quick pills and vice versa; the chosen time is what goes into the order payload
- show the opening-hours range as a label next to the "Pickup Time" heading, and a confirmation line ("Ready for collection at 8:15 PM") when custom is active
- On `/payment`, the "Schedule for Later" panel uses the same stepper instead of the `<select>` of fixed slots

### 4. Home "add" affordance
Replace the round `+` icon button on featured cards with a **pill** button: `ADD +`, yellow `#FFC72C`, 2px dark border, `2px 2px 0 0 #1a1a1a` shadow, Kanit 900 10px. Same action as before (open the item modal).

### 5. Arcade assets
The weekly-prize circle uses `/images/cz_chix_burger.png`; the game card uses `/images/munchman_game.jpg`. Both already exist in `public/images/` — make sure they render (they're currently missing from the built page in some states).

## Acceptance criteria
- Every route above renders with the brand chrome above; no leftover soft-shadow "generic card" styling on brand surfaces.
- No delivery language anywhere; pickup only.
- Custom pickup time can never be set outside `shopSettings` opening hours, including via keyboard.
- `/menu#cat-PREMIUM` (etc.) lands on the right tab and scrolls to the right header on first load.
- Bottom nav, all CTAs, and cross-screen links resolve to real routes — no dead buttons.
- Mobile-first at 380px; nothing horizontally overflows; touch targets ≥44px.
- Existing Supabase calls, order payloads, and loyalty point math unchanged except for the pickup-time field.
