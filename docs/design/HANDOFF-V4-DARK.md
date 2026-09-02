# Munchies KK — v4 "Cinematic Dark" customer-side restyle (Claude Code brief)

> Paste this whole file as your first message. Visual references, both committed to the repo under `docs/design/`:
>
> - `Munchieskk Site v4 Screens.dc.html` — **all 10 customer-facing routes** in the target style, at 390px. Open it in a browser; it renders standalone.
> - `Munchieskk Website Mockup v4.dc.html` — the responsive marketing/landing page the language comes from.
>
> Suggested opening line: *"You have the Munchies KK repo. `docs/design/Munchieskk Site v4 Screens.dc.html` is the approved UI spec for the customer-facing routes. Work one route per commit in the order in §4. Show me the rendered route before moving on. Do not touch Supabase queries, contexts, routing, or point math — and do not touch `/admin` or `/admin/reports`, which are being designed separately."*

---

## 1. What this is

A **visual restyle only**. Every customer-facing route moves from the current light brutalist look (`#f4f1ea` canvas, 3px black borders, hard offset shadows, Kanit) to a dark cinematic look (near-black surfaces, hairline borders, 6px radii, Archivo, slow Ken-Burns photo plates).

### Hard constraints — do not violate

- **No routing changes.** `src/App.jsx` stays exactly as it is. `/` is still `Home`. Nothing moves to `/app`, nothing is added, nothing redirects.
- **No data-layer changes.** Supabase queries, `StoreContext`, `AuthContext`, `loyaltyConfig`, `pointsCalculator`, order payloads, `MunchManModal` game logic — untouched.
- **No new dependencies.** Fonts via the existing Google Fonts link pattern. No animation libraries; everything here is CSS.
- **Pickup only.** No delivery language anywhere.
- **Admin is out of scope.** `pages/Admin.jsx`, `Admin.css`, and `AdminReports.jsx` are being designed in a separate track — leave them completely alone, including their imports of `global.css` tokens. If a token rename would break Admin, keep the old variable as an alias rather than editing Admin.

---

## 2. Design tokens — replace the palette in `src/styles/global.css`

Keep the existing variable *names* where they exist so nothing breaks; change the values and add the new ones.

```css
/* Surfaces — the contrast ramp */
--ink:            #060606;  /* page behind everything, footers */
--surface:        #0A0A0A;  /* default page background */
--surface-raised: #131110;  /* cards, panels, list rows */
--surface-hover:  #181514;  /* card hover */
--plate:          #0F0D0C;  /* behind a Ken-Burns photo plate */

/* Hairlines — replace ALL 3px black borders */
--line:        rgba(255,255,255,.09);  /* dividers, section rules */
--line-strong: rgba(255,255,255,.13);  /* card + panel borders */
--line-control:rgba(255,255,255,.22);  /* buttons, inputs, steppers */

/* Type */
--text:      #F6F1E7;  /* primary */
--text-2:    #C6BEB4;  /* secondary body on photo scrims */
--text-muted:#8E867C;  /* labels, descriptions */
--text-dim:  #8A8378;  /* timestamps, placeholders — 4.6:1 on --surface-raised, do not darken */

/* Brand */
--ember: #F04E23;  /* primary action, active state */
--ember-deep: #C4210A;  /* the big CTA band */
--gold:  #FFC72C;  /* prices, points, accents, secondary CTA hover */
--go:    #5FD68C;  /* success / ready / collected */

/* Category accents (keep the CATEGORY_COLORS keys, change values for dark) */
BBQ #F0862A · PREMIUM #C77DFF · PLATTERS #FFC72C · SIDES #5FD68C · DRINKS #63A7F5

/* Geometry */
--r-card: 6px;    /* every card, panel, input, tile */
--r-pill: 999px;  /* every button */
--r-screen: 24px; /* only the mockup device frame — NOT in the real app */
```

**Delete on sight:** `border: 3px solid #1a1a1a`, `box-shadow: 3px 3px 0 0 #1a1a1a` (and the 2px/4px/6px variants), `background: #f4f1ea`, `#fff` card backgrounds, the `#1a1a1a` header bars. Every one of these has a replacement above.

### Type

```
Archivo   900 — all headings, prices, points, numbers, button labels
          letter-spacing: -.02em; word-spacing: .08em; line-height: 1
Inter 400–800 — body copy, labels, descriptions
```

Replace the Kanit `<link>` with:
`https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800;900&family=Inter:wght@400;500;600;700;800&display=swap`

Headings are **uppercase** and set tight. Labels above fields/sections are 10–11px, `font-weight: 800`, `letter-spacing: .14em`, uppercase, `--text-muted`.

---

## 3. The four patterns that carry the whole design

Learn these and the 11 screens are mostly mechanical.

### 3a. The Ken-Burns photo plate ("video background")

Used for: Home hero, Menu featured hero, Item detail header, Order-status header, Loyalty header, Arcade prize header, Auth background, marketing sections.

```css
.plate            { position: relative; overflow: hidden; background: var(--plate); }
.plate__img       { position: absolute; inset: -8%;
                    background: var(--plate) url(...) 50% 46%/cover no-repeat;
                    animation: v4-kb 26s ease-in-out infinite;
                    will-change: transform; }
.plate__scrim     { position: absolute; inset: 0;
                    background: linear-gradient(180deg,
                      rgba(10,10,10,.62) 0%, rgba(10,10,10,.2) 34%, rgba(10,10,10,.96) 100%); }
.plate__ember     { position: absolute; inset: 0; mix-blend-mode: screen;
                    background: radial-gradient(90% 60% at 14% 82%,
                      rgba(240,78,35,.44) 0%, rgba(240,78,35,0) 62%);
                    animation: v4-ember 5.5s ease-in-out infinite; }
.plate__grain     { position: absolute; inset: 0; opacity: .14; pointer-events: none;
                    background-image: repeating-linear-gradient(0deg,
                      rgba(255,255,255,.11) 0 1px, transparent 1px 3px); }
.plate__content   { position: relative; z-index: 2; }

@keyframes v4-kb  { 0%,100%{transform:scale(1.14) translate3d(-1.5%,1%,0)}
                    50%    {transform:scale(1.3)  translate3d(1.5%,-1.5%,0)} }
@keyframes v4-kb2 { 0%,100%{transform:scale(1.26) translate3d(2%,-1%,0)}
                    50%    {transform:scale(1.1)  translate3d(-2%,1.5%,0)} }
@keyframes v4-ember{ 0%,100%{opacity:.32} 50%{opacity:.72} }
```

Rules: alternate `v4-kb` / `v4-kb2` on adjacent plates so they don't move in lockstep. Durations 26–38s — slower than feels right. `inset: -8%` is required (the scale would otherwise reveal edges). The scrim is **not optional** — text over a bare photo fails contrast.

**These are stand-ins for real video.** When clips exist, swap `.plate__img` for `<video autoplay muted loop playsinline poster="...">` with the same `inset: -8%` and drop the animation. Everything else stays. Ship the photo version now.

### 3b. Food cards — full-bleed photo, text over a scrim

This replaces every white card with a photo thumbnail. Photo fills the card; copy sits on a bottom gradient.

```css
.food-card         { position: relative; display: flex; flex-direction: column;
                     justify-content: flex-end; min-height: 158px; overflow: hidden;
                     border: 1px solid var(--line-strong); border-radius: var(--r-card);
                     background: var(--surface-raised);
                     transition: border-color .2s, transform .2s cubic-bezier(.16,1,.3,1); }
.food-card__img    { position: absolute; inset: 0; background: center/cover no-repeat; }
.food-card__scrim  { position: absolute; inset: 0;
                     background: linear-gradient(180deg, rgba(0,0,0,.1) 25%, rgba(6,6,6,.93) 100%); }
.food-card__body   { position: relative; padding: 14px; }
.food-card:hover   { border-color: rgba(240,78,35,.6); transform: translateY(-3px); }
```

Inside `__body`, in order: category label (8.5px/800/`.14em`, category accent) → name (Archivo 900, 17px, `#fff`) → description (11.5px, `--text-2`) → row with price (Archivo 900, 16px, `--gold`) and an Add pill.

No photo? Skip `__img` — `--surface-raised` shows through and the card still reads.

**Two menu photos have text baked in.** `sumandak burger.jpg` and `solero_split.jpg` are promo posters. Crop the lettering out with background position/size, exactly as the mockup does:
- `sumandak burger.jpg` → `50% 42%/cover`
- `solero_split.jpg` → `50% 66%/cover`
- `ice_bb.jpg` → `50% 44%/cover` (white studio background; this crop fills the frame with the drink)

### 3c. Buttons

```css
/* Primary */
background: var(--ember); color: #fff; border: none; border-radius: var(--r-pill);
padding: 16px; min-height: 48px; font: 800 12.5px Inter; letter-spacing: .09em;
text-transform: uppercase; box-shadow: 0 12px 30px rgba(240,78,35,.42);
:hover { background: var(--gold); color: #0A0A0A; transform: translateY(-2px); }

/* Secondary / ghost */
background: transparent; color: #fff; border: 1px solid var(--line-control);
:hover { background: rgba(255,255,255,.1); }

/* Small pill (Add, chips, table actions) */
padding: 9px 17px; min-height: 36px; font-size: 10px; letter-spacing: .1em;
background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.22);
:hover { background: var(--ember); border-color: var(--ember); }
```

Every tappable target is **≥44px** on app routes (the small pill's 36px is only for in-card secondary actions that sit inside a larger tap area).

### 3d. Selected state — one pattern everywhere

Time slots, payment methods, store picker, add-ons, category filters all use the same thing:

```
unselected: border 1px rgba(255,255,255,.12) · background var(--surface-raised)
selected:   border 1px rgba(240,78,35,.6)   · background rgba(240,78,35,.09)
```

Filter chips are the exception — selected fills solid `--ember` with white text.

---

## 4. Route-by-route work order

One route per commit, in this order. Each references the matching screen in the mockup.

| # | Route | Files | Mockup screen |
|---|---|---|---|
| 1 | shell | `components/Layout.jsx` + `.css`, `styles/global.css` | header + bottom nav on Landing |
| 2 | `/` | `pages/Home.jsx` + `.css` | **Landing + Home** |
| 3 | `/menu` | `pages/Menu.jsx` + `.css` | **Menu** |
| 4 | item modal | `components/ItemModal.jsx` + `.css` | **Item detail** |
| 5 | `/cart` | `pages/Cart.jsx` + `.css` | **Cart** |
| 6 | `/payment` | `pages/Payment.jsx` + `.css` | **Payment** |
| 7 | `/order/:id` | `pages/OrderStatus.jsx` + `.css` | **Order tracking** |
| 8 | `/loyalty` | `pages/Loyalty.jsx` + `.css` | **Loyalty** |
| 9 | `/arcade` | `pages/Arcade.jsx` + `.css` | **Arcade** |
| 10 | `/profile` | `pages/Profile.jsx` + `.css` | **Profile** |
| 11 | auth | `pages/Login.jsx`, `Signup.jsx`, `ResetPassword.jsx` + `Login.css` | **Auth** |
| 12 | modals | `Modal.css`, `AddonModal.css`, `CookingPopup.css`, `MunchManRulesModal.css` | — (see §5) |

### Per-route notes

**1 · Shell.** Header: `rgba(10,10,10,.9)`, `backdrop-filter: blur(14px)`, 1px bottom hairline, logo circle 32px + `MUNCHIES` white / `KK` ember wordmark. Bottom nav: 5 items, `rgba(6,6,6,.96)`, 1px top hairline; active item gets `background: rgba(240,78,35,.16)` + ember label + full-opacity icon, inactive is `--text-muted` at `opacity:.55`. Points chip in the header: gold text on `rgba(255,199,44,.13)` with a `rgba(255,199,44,.4)` border.

**2 · Home.** This route absorbs the landing hero — it becomes the top of Home, above the existing signed-in content. Order: header → Ken-Burns hero plate ("FLAME MEETS SAMBAL." at 46px, badge, two CTAs) → the orange scrolling marquee → "HEY, GOURMET." → loyalty progress panel → Menu Lineup category row → 2-up featured food cards → a pickup-info plate. Keep the existing `useAuth`/`StoreContext` data driving all of it. Marquee: duplicate the strip, `width:200%`, `animation: v4-marquee 24s linear infinite`, `translate3d(0)→(-50%)`.

Home's Menu Lineup tiles keep their existing `/menu#cat-<KEY>` deep links, and `/menu` keeps its hash-scroll behavior — **that already works, don't rebuild it.** Category anchors keep `id="cat-${key}"` and `scroll-margin-top: 70px`.

**3 · Menu.** Category filter chips replace the dark pill bar; horizontal scroll, 38px tall. Featured hero is a Ken-Burns plate with the "MUST TRY" ember badge, +20 PTS gold chip, price, and a full-width Add to bag. **Category headers change completely**: the tinted brutalist card with the ghosted word is gone — now a 3px-wide accent bar, the title in Archivo 900 19px white, the item count in the accent colour on the right, all sitting on a 1px bottom hairline. Item rows become the §3b food cards, stacked with 11px gaps.

**4 · Item detail.** 280px Ken-Burns header plate with a top-left circular back button (`rgba(6,6,6,.6)` + blur), category label and name over the scrim. Body: description left / price right, a gold points strip, add-on rows using the §3d selected pattern with a 22px checkbox, quantity stepper with 38px circular buttons, then the primary CTA showing the live total.

**5 · Cart.** Cart rows as raised panels with a pill quantity control. Store picker, quick time slots, and the custom-time stepper keep **all existing behavior** — including the clamp to `shopSettings.openingTime`/`closingTime`. Opening hours shown in gold next to the "Pickup time" label. Confirmation line goes green (`--go`) when custom is active. Total panel: uppercase muted label, Archivo 900 22px gold amount.

**6 · Payment.** Fulfillment timing panel gets a gold hairline border and an ember radial glow in the top-right corner. Now/Schedule become two equal buttons — active is solid ember. The schedule stepper uses gold hairlines instead of the old blue. Payment method rows use §3d with a `●`/`○` radio in ember/`#4A453F`. Promo row: dim placeholder input + ghost APPLY.

**7 · Order status.** The stage header is a Ken-Burns plate at `opacity:.5` with an ember radial pulse: emoji 46px, stage title 27px in the stage colour, order number as a muted tracking label, and an ETA line in gold. Stage colours: pending `--gold`, cooking `--ember`, ready `--go`, collected `#fff`. The 4-step tracker uses 36px circles — done is `rgba(95,214,140,.16)` + green hairline, current is `rgba(240,78,35,.2)` + solid ember border, future is `rgba(255,255,255,.05)` + faint hairline. Add a "Collect from" panel with the Penampang address. Keep the real polling/subscription logic.

**8 · Loyalty.** Header plate at `opacity:.42` over `BigG.jpg`: tier badge, "BURGER MASTER", then the point total as Archivo 900 **52px gold** — this is the screen's hero number. Progress bar is a `linear-gradient(90deg,#FFC72C,#F04E23)` fill in a `rgba(255,255,255,.12)` track. Prize vault rows: gift circle, name, gold cost, and a Redeem/Locked button — redeemable gets solid ember, locked gets a ghost border and `--text-dim`. Point history as a raised panel with hairline-separated rows and gold `+N` amounts.

**9 · Arcade.** Weekly prize is a 260px Ken-Burns plate over `cz_chix_burger.png` with an ember radial pulse and a gold "WEEKLY PRIZE" badge. Rank/points stat cards side by side — rank number ember, points number gold, both Archivo 900 40px. Game card: 170px Ken-Burns thumb over `munchman_game.jpg`, a blurred "HARD" chip top-right, then title, description, rating/duration, and a Play now pill. **Do not restyle the game canvas inside `MunchManModal`** — only its chrome.

**10 · Profile.** Identity row with a 52px ember initials avatar. Personal info as label/value pairs in a raised panel (labels 10px/800/`.1em` uppercase dim). Rewards panel matches the Payment timing panel treatment (gold hairline + ember radial). Order history cards: order number Archivo white, date dim, total gold, status in green tracking caps. Log out is a ghost button with an ember border and ember text — not a red fill.

**11 · Auth.** All three auth pages share one layout: full-bleed Ken-Burns plate over `premium_platter.jpg`, heavy scrim, ember radial glow from the bottom, and a centred card at `rgba(19,17,16,.86)` with `backdrop-filter: blur(14px)` and an 8px radius. 60px logo, uppercase Archivo heading, muted subline, hairline inputs on `--surface`, ember primary, ghost social buttons, gold inline link. Signup and ResetPassword reuse this shell with their own heading/fields — no separate styling.

**12 · Modals.** Backdrop `rgba(6,6,6,.82)` + `backdrop-filter: blur(8px)`. Panel `--surface-raised`, 1px `--line-strong`, 8px radius, no hard shadow — use `0 24px 60px rgba(0,0,0,.7)`. `CookingPopup` keeps its ember/gold energy: use the plate ember pulse rather than a solid orange fill.

---

## 5. Global find-and-replace checklist

Search the repo for each and fix every hit — **excluding `pages/Admin.jsx`, `pages/Admin.css`, and `pages/AdminReports.jsx`**:

- `#f4f1ea` / `#fff` page or card backgrounds → `--surface` / `--surface-raised`
- `3px solid #1a1a1a` (and 2px/3.5px) → `1px solid var(--line-strong)`
- `0 0 #1a1a1a` (all hard offset shadows) → delete; add `0 22px 50px rgba(0,0,0,.7)` only on hover-lifted cards
- `Kanit` → `Archivo`
- `#1a1a1a` as a *text* colour → `--text`; as a *background* → `--surface`/`--ink`
- `#64748b` / `#94a3b8` / `#cbd5e1` (slate greys) → `--text-muted` / `--text-dim`
- `#E8491D` / `#c73b0f` → `--ember` / `--ember-deep`
- `border-radius: 12px|14px|16px|20px|22px|28px` on cards → `var(--r-card)` (6px)
- Any `border-radius` on a `<button>` → `var(--r-pill)`

---

## 6. Motion

```css
@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
```

Non-negotiable — Ken-Burns plates plus ember pulses are a lot of continuous motion. Also: cap plates at **one per viewport-height** of scroll, and don't put a plate inside a scrolling list. Hover/press transitions are `.16s ease`; card lifts are `.2s cubic-bezier(.16,1,.3,1)`.

Battery note: each plate is a continuously animating composited layer. If a route needs more than three, convert the lower ones to static `background-position` crops.

---

## 7. Acceptance criteria

- `src/App.jsx` is byte-identical to before. No route added, removed, or redirected.
- Nothing in `contexts/`, `config/`, or `utils/` changed except colour constants in `CATEGORY_COLORS`.
- No `#f4f1ea` / `Kanit` sweep touched the Admin files (§5 applies to customer routes only).
- No `#f4f1ea`, no `3px solid #1a1a1a`, no `Npx Npx 0 0` shadow, and no `Kanit` reference survives anywhere in `src/`.
- Every route renders at 390px with no horizontal overflow; every tap target on app routes is ≥44px.
- All body text passes 4.5:1 against its actual backdrop — **check the text sitting on photo scrims specifically**, that's where it fails.
- Custom pickup time still cannot be set outside `shopSettings` hours, including by keyboard.
- `/menu#cat-PREMIUM` still selects the right tab and scrolls to the right header.
- `prefers-reduced-motion` kills every Ken-Burns and ember animation.
- No delivery language anywhere.
- `pages/Admin.jsx`, `Admin.css`, and `AdminReports.jsx` are untouched — no diff at all.
- `MunchManModal` game logic and canvas untouched; only its chrome restyled.

## 8. Known gaps to raise, not guess

- **No real video assets exist.** Ken-Burns is the shipping treatment. Ask before sourcing or generating clips.
- **`hero.png` in `src/assets/`** is the old light-theme hero; it does not suit dark. Use `public/images/best_seller_hero.jpg` for the Home plate.
- **Two menu photos are promo posters with baked-in text** (`sumandak burger.jpg`, `solero_split.jpg`) — use the crops in §3b. Getting clean shots would be a real improvement; flag it.
- If a route has UI not shown in the mockup (edge-case empty, loading, or error states), derive it from these patterns and show it before committing.
