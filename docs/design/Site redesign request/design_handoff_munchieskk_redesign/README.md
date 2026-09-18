# Handoff: MunchiesKK Front-End Redesign (Landing + Ordering Flow)

## Overview
A visual redesign of the MunchiesKK customer front-end (repo `AliGoldie/munchieskk`, Vite + React + Supabase),
plus a new marketing landing page that does not exist yet. No features, routes, data models or Supabase logic
change — this is a styling and page-architecture change whose job is to make the store feel more dynamic and
to kill two specific purchase objections the owner identified: **"price feels high"** and **"portion too small."**

**Direction chosen by the owner: 1b — CRAVING SCROLL. Implement 1b.** Direction 1a is documented below only
as context; do not build it.

- **1a — DEAL STACK**: modular grid. Every band answers "is this worth it?" (set add-on math, points on every
  price, portion stats, reviews, arcade reward band). Lower risk, works well on mobile, denser.
- **1b — CRAVING SCROLL**: full-bleed editorial. Giant type over food photography, horizontal swipe rails,
  sticky buy bar, typographic full menu. More striking, more image-dependent.

Both share the same content, tokens, type and components — only layout and rhythm differ.

## About the Design Files
The files in this bundle are **design references created in HTML** — a streaming prototype
(`Munchieskk Redesign.dc.html` + its `support.js` runtime) showing intended look, copy and behavior.
**They are not production code to copy.**

The task is to **recreate these designs inside the existing MunchiesKK codebase**, using its established
patterns:

- React 19 + Vite, React Router, plain CSS files per page/component (`src/pages/Home.css`, `src/pages/Menu.css`, …)
- Global tokens live in `src/styles/global.css` (`:root` custom properties) — extend that file, do not
  introduce Tailwind or a CSS-in-JS library
- Data comes from `src/contexts/StoreContext.jsx` (menu, addons, cart, promos, points) and
  `src/contexts/AuthContext.jsx`. **All prices, stock, add-ons and categories must keep coming from Supabase
  via those contexts** — the prices written into the mock are only there so the design reads truthfully.
- The prototype uses inline styles because of its streaming runtime. In the codebase, move those values into
  the existing per-page CSS files and token variables.

The landing page is new: add a public route (e.g. `/` marketing shell, moving the current authenticated Home
to `/app` or keeping `Home` as the ordering home and adding `Landing`) — the routing decision is the
developer's, in line with how `src/App.jsx` is organised today.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii, shadows, copy and hover states are final and exact.
Recreate pixel-accurately using the codebase's own CSS patterns. Desktop bands are authored at 1280px wide;
mobile screens at 360×720. Both must be fluid between those anchors (the prototype is fixed-width only
because it sits on a design canvas).

---

## Design Tokens

Existing tokens in `src/styles/global.css` are **kept**; the redesign changes how they are used and adds a few.

### Colors (unchanged from the current brand)
| Token | Hex | Use in redesign |
| --- | --- | --- |
| `--munchies-yellow` | `#FFC72C` | Dominant field: nav, hero, portion band, footer |
| `--munchies-dark` | `#1a1a1a` | Ink, dark bands (deals, arcade, typographic menu) |
| `--munchies-orange` | `#c73b0f` | Primary CTA, savings badges, sticky buy bar, cooking screen |
| `--munchies-canvas` | `#f4f1ea` | Light section ground, menu list ground |
| `--munchies-white` | `#ffffff` | Cards on canvas/yellow |
| `--munchies-blue` | `#93d9f8` | DRINKS category tag only |

### New colors to add
| Name | Hex | Use |
| --- | --- | --- |
| `--munchies-ink-2` | `#242320` | Card surface on dark bands |
| `--munchies-muted` | `#6b6558` | Body copy on light grounds |
| `--munchies-muted-dark` | `#a9a498` | Body copy on dark grounds |
| `--munchies-muted-2` | `#8a8577` | Struck-through / tertiary text |
| `--munchies-amber-ink` | `#8a5a14` | Eyebrow text on yellow (passes contrast) |
| `--munchies-green` | `#0f7a32` | "Points earned", best-value badge |
| `--munchies-green-light` | `#7fd39a` | Points text on dark grounds |
| `--munchies-whatsapp` | `#128C7E` | WhatsApp button (darker than `#25d366` for contrast) |

### Typography
Headlines move **off Kanit** to **Archivo Black**; body becomes **Archivo**.

```
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@400;500;600;700;800&display=swap');
--font-heading: 'Archivo Black', system-ui, sans-serif;   /* single weight, no font-weight needed */
--font-sans:    'Archivo', system-ui, sans-serif;
```

Headings stay `text-transform: uppercase` (as today). Scale used:

| Role | Size / line-height / letter-spacing |
| --- | --- |
| Landing H1 (1a) | 78px / .92 / -2.5px |
| Landing H1 (1b) | 104px / .85 / -4px |
| Band H2 | 40–64px / .9–.95 / -1px to -2.4px |
| Section H3 | 26px / 1.1 |
| Card title | 19–26px |
| Price, large | 32–40px |
| Price, row | 22–24px |
| Body | 17–19px / 1.45–1.5 / weight 500 |
| Meta / row copy | 13–15px / weight 600–700 |
| Eyebrow, badge | 11–12px / weight 800 / letter-spacing .14em–.2em |
| Mobile H1 | 44px / .88 / -1.6px |
| Mobile body / rows | 11–15px |

Never below 11px; all tap targets ≥ 44px.

### Spacing, radii, shadows
- Section padding: `48–60px` vertical, `36–40px` horizontal (desktop); `16–20px` (mobile)
- Grid/flex `gap`: `10px` (mobile rows), `14–20px` (cards), `40–56px` (hero columns)
- Radii — **the brutalist 3px black borders and hard offset shadows are removed**:
  `12px` small, `16px` buttons-in-card, `20–22px` rows, `24–28px` cards/bands, `32px` page shell,
  `38px` phone frame, `999px` pills
- Shadows (soft, never offset-hard):
  - card hover `0 16px 34px rgba(26,26,26,.14)`
  - floating price card `0 16px 40px rgba(26,26,26,.22)`
  - hero image `0 26px 60px rgba(26,26,26,.3)`
  - CTA `0 12px 26px rgba(199,59,15,.34)`
- Keep `--border-thick` etc. in the file for the Admin console, which still uses the brutalist style.

---

## Real data the design encodes

All of it came from the owner's Menu CRM and Add-ons CRM screenshots (`reference-menu-crm.png`,
`reference-addons-crm.png`). **Read it from Supabase at runtime; these are the correct current values.**

### Menu (RM)
BBQ — BBQ Beef 12.90 · BBQ Chicken 13.90 · BBQ Lamb 14.90 · BBQ Eggy 7.90
PREMIUM — Mushy2 15.90 · Jucy Bae 18.90 · CZ Chix 15.90 · Big-G 16.50 · Sumandak 17.90
PLATTERS — MONSTA Platter 69.90 · Kawan MONSTA 44.90 (feeds 3–4, RM 11.20/head)
SIDES — Regular Fries 6.50 · Monsta Fries 12.90 · CZ Fries 9.90
DRINKS — Solero Split 8.90 · Ice BB 11.90 · Pepsi 3.50

### Add-ons (RM) and their scope
- **Burgers**: Combo Fries + Can 6.00 · Cheese 3.00 · Egg 2.00 · Beef Strips 4.50 · Beef Patty 7.00 · Chicken Patty 7.50
- **Fries**: Egg 2.00 · Beef Strips 4.50 · Cheese 3.00 · Beef Patty 7.00 · Chicken Patty 7.50
- **Drinks**: Regular Fries 6.50 · CZ Fries 9.90 · Monsta Fries 12.90 (sausages planned, not yet in CRM)

Add-on availability per item is already modelled as `itemAddons[item.id]` in `StoreContext` — respect it.

### Portions
100g of meat per patty · 150g of fries per portion. Surface both as facts, never as adjectives.

### The value argument (the spine of the whole redesign)
`Combo Fries + Can` costs **RM 6.00** but Regular Fries (6.50) + Canned Drink (3.50) bought separately are
**RM 10.00** → **saves RM 4.00 on any burger**. Print the arithmetic, don't imply it:

- BBQ Eggy + combo = **RM 13.90** (cheapest full meal)
- BBQ Beef + combo = **RM 18.90** (vs 22.90 separately)
- Sumandak + combo = RM 23.90 · Jucy Bae + combo = RM 24.90

Loyalty: **10 pts per RM 1** (points config lives in `src/config/loyaltyConfig.js` — use it, don't hardcode).
Show `+N pts` on every price. Free burger threshold shown as 1,500 pts in the mock; read the real prize
ladder from `loyaltyPrizes`.

---

## Screens / Views

### 1. Landing page — direction 1a (DEAL STACK), 1280px
Order of bands, top to bottom:

1. **Nav** — yellow `#FFC72C`, `padding:18px 36px`, flex space-between. Left: 52px logo (radius 16px) +
   nav links (14px/800/.14em: MENU ARCADE LOYALTY PROFILE; active link has a `3px solid #c73b0f` bottom
   border, inactive `opacity:.62`). Right: points pill (`rgba(26,26,26,.08)`, radius 999px), WhatsApp pill
   (`#128C7E`, white), cart pill (`#1a1a1a`, white, shows live total).
2. **Hero** — `grid-template-columns:1.05fr .95fr; gap:40px; padding:20px 36px 56px`. The existing
   `trex_pattern.png` repeats behind at `background-size:170px; opacity:.13`.
   Left column (`gap:22px`): eyebrow row "KOTA KINABALU / 11AM — 11PM / ● OPEN NOW" (open dot `#0f7a32`,
   driven by the real store-hours util `src/utils/timeUtils.js`); H1 "BIG FLAVOUR. / BIGGER / PORTIONS."
   with PORTIONS in `#c73b0f`; 18px body; CTA row — primary `#c73b0f` pill, radius 999px, `padding:14px 26px`,
   hover `translateY(-3px)`, transition `.22s`; secondary `rgba(255,255,255,.75)` pill; trust row
   "4.8 ★ · 320+ reviews | Ready in ~12 min | 10 pts per RM 1".
   Right column: 430px circular hero image (`hero_burger.png`) on a `#c73b0f` @14% circle; badges top-right
   ("🔥 BEST SELLER" dark pill; "ONLY 6 LEFT TODAY" white pill with a pulsing 9px dot — **bind to the real
   `inStock`/stock count, hide when stock is unknown**); floating white price card bottom-left (item name
   12px/800/.14em, price 34px Archivo Black, "+179 pts on this order" in `#0f7a32`); `Trex.png` 120px
   bottom-right with a 5s float animation.
   This replaces the current rotating `hero-spotlight` — keep the 5s rotation logic from `Home.jsx` if
   desired, but the rotation must swap image + name + price + badge together.
3. **Deals band** — `#1a1a1a`, `padding:44px 36px`. H2 "ADD A SET FOR RM 6. GET RM 10." in `#FFC72C`,
   sub-line spelling out the arithmetic, and a countdown pill ("DEALS END IN hh:mm:ss") on the right.
   Then 3 cards (`repeat(3,1fr); gap:20px`, surface `#242320`, radius 26px, hover `translateY(-6px)`):
   "BBQ BEEF, SET UP" RM 18.90 vs struck RM 22.90 / SAVE RM 4.00 / +189 pts;
   "CHEAPEST FULL MEAL" RM 13.90 (BBQ Eggy + set) / SAVE RM 4.00 / +139 pts;
   "KAWAN MONSTA" RM 44.90 / RM 11.20 per person / BEST VALUE badge.
   Each card ends in a yellow full-width button ("ADD WITH SET" / "ADD PLATTER").
4. **Category rail + menu** — ground `#f4f1ea`, `padding:48px 36px`. 5 category pills
   (`repeat(5,1fr)`, radius 20px, 46px image thumb, active pill dark/yellow, others white with hover lift) —
   these link to the existing `/menu#CATEGORY` anchors. Then H2 "THE LINEUP" + "SEE ALL 17 ITEMS →", then a
   2-column grid of menu rows: white, radius 24px, `padding:14px`, 92px square image (radius 18px), name
   19px, 13px description, `+N pts` in `#0f7a32`, price 22px, dark "ADD +" pill. Hover: lift 4px + soft shadow.
   Clicking a row must open the existing `ItemModal`/`AddonModal` path, not a new one.
5. **Upsell grid** — white card, radius 28px. H3 "MAKE IT A MONSTA" + the add-on scoping line
   ("Burgers take patties, cheese, egg or beef strips · fries take the same · drinks pair with any fries").
   4 tiles (`repeat(4,1fr)`), 120px image, name, price, "ADD +", hover `scale(1.03)`.
6. **Portion proof** — 2-column, ground `#FFC72C`. Left: eyebrow "PORTION, RECEIPTED", H2 "NOBODY LEAVES /
   STILL HUNGRY." (52px), then dark stat cards (radius 22px): **100g** MEAT PER PATTY · **150g** FRIES PER
   PORTION · **FEEDS 4** KAWAN MONSTA PLATTER · **RM 11.20** PER HEAD, SHARING; then two review quotes on
   `rgba(255,255,255,.72)` cards. Right: full-bleed `premium_platter.jpg` (min-height 520px) with a dark
   caption card ("MONSTA PLATTER · RM 69.90 · choose 3 premium burgers").
7. **Arcade reward band** — `#1a1a1a`, `padding:48px 36px`. Eyebrow "AFTER YOU ORDER", H2 "PLAY WHILE IT
   COOKS. WIN YOUR SIDES." Three numbered step cards (ORDER / PLAY / COLLECT) with 150px game screenshots
   (`fry_catch.png`, `munchman_game.jpg`, `trex_runner_game.jpg`). Then the student-deal card (`#c73b0f`,
   radius 26px) — **placeholder offer, confirm before shipping**.
8. **Footer** — yellow, logo + wordmark + tagline left, link row right.

### 2. Landing page — direction 1b (CRAVING SCROLL), 1280px
1. **Hero** — 660px tall, full-bleed `hero_burger.png` under
   `linear-gradient(105deg, rgba(26,26,26,.94) 0%, rgba(26,26,26,.78) 42%, rgba(26,26,26,.15) 100%)`.
   Transparent nav over it (white links, yellow points pill, yellow ORDER pill). H1 "EAT LIKE / A MONSTA."
   at 104px/-4px with MONSTA in `#FFC72C`; 19px body; yellow CTA "START AN ORDER →"; live status line
   "KITCHEN OPEN · CLOSES 11PM · hh:mm:ss LEFT ON TONIGHT'S DEALS" with a pulsing green dot.
   `Trex.png` 150px floating top-right.
2. **Sticky buy bar** — `#c73b0f`, 16px/40px padding. Hero item thumb + "TONIGHT'S HERO / SUMANDAK BURGER ·
   RM 17.90", "+179 PTS", white "ADD TO CART" pill. In the app this should be `position: sticky; bottom: 0`
   on mobile and follow the scroll on desktop.
3. **Craving rail** — `#1a1a1a`. H2 "WHAT KK IS / ORDERING RIGHT NOW" + "SWIPE →". Horizontal
   scroll-snap row of 300×400 cards, radius 28px, image + bottom gradient
   (`rgba(26,26,26,0) 40% → rgba(26,26,26,.92)`), top-left status badge, name 24px, 13px descriptor, price
   24px in yellow, white "ADD +" pill, hover `translateY(-8px)`. The 4th card is intentionally part-clipped
   as a swipe affordance. Use `overflow-x:auto; scroll-snap-type:x mandatory` in the app.
4. **"RM 6 TURNS ANY BURGER INTO A MEAL."** — yellow band, 64px H2, trex pattern at 10%. Three dark
   columns: the add-on breakdown (Fries 6.50 + Pepsi 3.50 = struck 10.00 → **+6.00**, SAVE 4.00, "ADD TO ANY
   BURGER"); the meal ladder (BBQ Eggy + set 13.90 / BBQ Beef 18.90 / Sumandak 23.90 / Jucy Bae 24.90 →
   "FROM 13.90"); Kawan Monsta (feeds 3–4, 11.20/head, 44.90, BEST VALUE). Then the student-deal strip.
5. **Portion editorial** — 2-column on `#f4f1ea`. Left: `monsta_fries.jpg` full-bleed with a dark badge
   "**150g** OF FRIES PER PORTION · +RM 4.50 FOR BEEF STRIPS". Right: H2 "THE REVIEWS ALL SAY THE SAME
   THING", three review cards (two white, one dark), then "4.8 ★ from 320+ reviews".
6. **Arcade band** — `#c73b0f`, 2-column. H2 "ORDER. / PLAY. / EAT FREE." (60px), body, three dark game
   pills, and a vault progress card (`rgba(26,26,26,.28)`, 12px yellow progress bar) reading real
   `points` / `loyaltyPrizes`. Right: 2×2 staggered game/product images (alternate 28px top offset).
7. **Typographic menu** — `#1a1a1a`. H2 "THE WHOLE MENU" + "17 items · prices live from your CRM". Rows are
   `border-bottom:1px solid rgba(255,255,255,.1)`, `padding:18px 0`, 56px thumb, 26px name, category tag
   pill, `+N pts` green, 24px yellow price, white "ADD +". Hover animates `padding-left` 0 → 14px.
8. **Footer** — yellow, with "REFER A MATE · +200 PTS" (wire to the existing referral system) and
   "ORDER ON WHATSAPP" using `siteConfig.whatsappNumber`.

### 3. Ordering flow — mobile, 360×720 (both directions)
- **Menu** (1a): yellow header + horizontal category pills; white rows (66px thumb, name 15px, 11px
  description, `+N pts`, price, 34px square dark "+" button). One row is inverted dark to flag BBQ Eggy as
  "cheapest fill-up". Sticky bottom bar `#c73b0f`: "3 ITEMS · +333 PTS / RM 33.30" + yellow "VIEW CART".
- **Item + add-ons**: 280px image with "🔥 TOP 3 THIS WEEK" and stock badges; name 22px + price; a green
  points strip ("EARNS +159 PTS · 341 more to a free Regular Fries"); "STACK IT UP" add-on rows — the
  **Combo Fries + Can** row is the dark, promoted one (with "Worth RM 10.00 · save RM 4.00"), then Extra
  beef patty +7.00, Cheese +3.00. Yellow footer: quantity stepper + `ADD · RM 21.90`. This is a restyle of
  the existing `ItemModal` + `AddonModal`; add-on rows must come from `itemAddons`.
- **Cart → play** (1a): dark header; three item rows with their notes; a yellow "ADD THE SET AND SAVE"
  nudge ("FRIES + PEPSI · + RM 6.00", "SAVE 4.00"); totals card (Subtotal RM 33.30, Points earned +333 pts,
  TOTAL RM 33.30); `#c73b0f` footer with yellow "PAY RM 33.30" and the cooking/arcade line.
- **Home** (1b): 400px image hero with top and bottom gradients, 44px H1, horizontal 150×170 product cards,
  yellow set-offer card, `#c73b0f` cart bar.
- **Menu typographic** (1b): dark, 48px thumbs, hairline rows, yellow prices, yellow dessert bar at the bottom.
- **Cooking + arcade** (1b): `#c73b0f` screen — order number, "COOKING NOW", "Ready in about 9 minutes",
  yellow progress bar, dark "WIN YOUR SIDES" card with game shot and "PLAY MUNCH-MAN", two secondary game
  tiles, dark footer with "+333 PTS" and "PRIZE VAULT". This is a restyle of `OrderStatus.jsx` +
  `CookingPopup` + the arcade modals.

---

## Interactions & Behavior
- **Hover** (desktop only, `@media (hover: hover)`): cards lift `translateY(-4px→-8px)` with a soft shadow;
  upsell tiles `scale(1.03)`; CTAs lift 3px; typographic menu rows animate `padding-left` to 14px.
  All transitions `.22s–.3s ease`. The current brutalist `translate(4px,4px)` press is dropped — use a
  subtle `scale(.98)` on `:active` instead.
- **Pulsing dot** on stock/open-status badges: `opacity 1 → .35`, 1.4s ease-in-out, infinite.
- **Mascot float**: `translateY(0 → -14px)` with `rotate(-4deg → -1deg)`, 5–6s ease-in-out, infinite.
- **Countdown**: ticks 1s, formats `hh:mm:ss`. In production drive it from the real promo end time
  (`promotions` / `isPromoActive`), and hide the whole pill when no promo is live — never fake urgency.
- **Rails**: horizontal scroll with snap; the partially visible last card is deliberate.
- **Respect `prefers-reduced-motion: reduce`** — disable float, pulse and lift.
- **Responsive**: 1280px desktop bands collapse to single column below ~900px; hero H1 clamps
  (`clamp(44px, 8vw, 104px)` for 1b, `clamp(40px, 6vw, 78px)` for 1a); the 5-up category rail becomes a
  horizontally scrolling row; the 2-column menu grid becomes 1 column; the sticky buy bar stays pinned.

## State Management
No new global state. Everything binds to what already exists:
- `StoreContext`: `menu`, `itemAddons`, `cart`, `addToCart`, `isPromoActive`, `points`, `loyaltyPrizes`, stock
- `AuthContext`: `user` (drives the greeting, points pill, and the logged-out "Login to earn Pts" state)
- `loyaltyConfig` for points-per-ringgit; `timeUtils` for open/closed and store timezone
- Local component state only for: hero rotation index, countdown seconds, quantity stepper, selected
  category, modal open/closed.
- Logged-out landing page must render without any Supabase session; every "+N pts" becomes "Login to earn
  N pts" when `!user`.

## Assets
All from the existing repo — no new assets were created:
`public/images/` — `logo.png`, `hero_burger.png`, `Trex.png`, `trex_pattern.png`, `bbqbeefburger.jpg`,
`bbq_chicken.jpg`, `bbq_lamb.jpg`, `mushy_burger.jpg`, `cz_chix_burger.png`, `BigG.jpg`,
`premium_platter.jpg`, `Kawan MONSTA.png`, `monsta_fries.jpg`, `regular_fries.png`, `iceBB.jpg`,
`pepsi.jpg`, `fry_catch.png`, `munchman_game.jpg`, `trex_runner_game.jpg`.

Fonts: Archivo Black + Archivo (Google Fonts). Icons: keep `lucide-react`, already a dependency.

**Photography is the main gap.** 1b in particular depends on large, well-lit food shots; several current
images are low-resolution or inconsistent in background. Budget a shoot (or at minimum re-crop) for:
signature burger, loaded fries, the two platters, and one "portion in hand" shot for scale.

## Placeholders to replace before shipping
1. **Reviews** — the three quotes and "4.8 ★ · 320+ reviews" are written examples. Substitute real Google /
   Instagram reviews (ideally ones that mention portion size) and the real rating.
2. **Student Tuesdays 15% off** — an invented offer. Confirm, change or remove.
3. **Stock urgency copy** ("ONLY 6 LEFT TODAY", "4 LEFT TODAY") — must read real stock, or be removed.
4. **"Ready in ~12 min"** — confirm against real kitchen times.
5. **Sausages** add-on is mentioned by the owner but absent from the CRM.

## Files
- `screens/1b-landing-desktop.png` — full-length render of the chosen landing page (1b), 1280px wide.
- `screens/1b-mobile-flow.png` — the three 1b mobile screens (Home, typographic Menu, Cooking + Arcade) at 2x.
- `Munchieskk Redesign.dc.html` — the design prototype: both directions, desktop bands + mobile screens.
  Open it in a browser (keep `support.js` beside it). It is a design canvas: pan/zoom, options are labelled
  **1a** and **1b**.
- `support.js` — runtime for the prototype only. **Do not port this into the app.**
- `reference-menu-crm.png` — owner's Menu CRM screenshot (source of all item prices).
- `reference-addons-crm.png` — owner's Add-ons CRM screenshot (source of all add-on prices).
- Source repo screens this redesign maps onto: `src/pages/Home.jsx` + `Home.css`, `Menu.jsx` + `Menu.css`,
  `Cart.jsx` + `Cart.css`, `OrderStatus.jsx`, `Arcade.jsx`, `Loyalty.jsx`,
  `src/components/ItemModal.jsx`, `AddonModal.jsx`, `Layout.jsx`, `src/styles/global.css`.
  **The Admin console (`src/pages/Admin.jsx`) is out of scope and keeps its current styling.**

## Suggested implementation order
1. Add fonts + new tokens to `src/styles/global.css`; remove brutalist borders/shadows from the customer-facing
   components only.
2. Restyle `Layout.jsx` (nav, cart pill, points pill, footer).
3. Rebuild `Home.jsx` as the chosen direction's ordering home; add the new public landing route.
4. Restyle `Menu.jsx` rows and category rail.
5. Restyle `ItemModal`/`AddonModal` with the promoted Combo Fries + Can row.
6. Restyle `Cart.jsx` (set nudge + points line) and `OrderStatus.jsx` (cooking + arcade).
7. Wire the countdown/urgency to real promo and stock data, or hide it.
8. Replace the placeholders listed above.
