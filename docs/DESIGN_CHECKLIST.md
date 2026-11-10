# Design checklist for customer-facing changes

Short and MunchiesKK-specific. A checklist to run through when a screen is changed, **not** a rulebook: it never overrides the brand, the wording rules in `AGENTS.md`, or what Ali asks for. Nothing here triggers by itself. Do not restyle a page that was not asked about.

Ideas borrowed (not copied) from a public design-skills repo, reviewed 10 Nov 2026. Its own rules (no hyphens, fixed fonts and colours, mandatory landing-page sections) clash with our brand and wording, so they were left out.

## Before saying a screen change is done
- [ ] **Phone first.** Checked at 375px wide: no sideways scroll, buttons keep their text inside, the main action is on the first screen. (`tests/e2e/page-health.spec.js` covers the customer pages.)
- [ ] **Keyboard focus is visible** on every button and link you touched (use `:focus-visible`).
- [ ] **Loading, empty and error states** exist for any list or fetch you touched: a placeholder shaped like the content while loading, a helpful message when empty, an error that says what to do next.
- [ ] **Movement respects `prefers-reduced-motion`.** New animation gets a calm fallback (most of the site already has one).
- [ ] **No browser pop-ups for customers.** Prefer an in-page message over `alert()`. (Customer pages still use some; fix a pop-up when you touch that screen, do not hunt them all down.)
- [ ] **Contrast is readable**: body text clearly legible on its background, especially yellow on white or grey.
- [ ] **Touch targets** are big enough for a thumb (about 44px).
- [ ] **Every image has alt text** if it carries meaning.

## Content rules that always apply
- Never invent prices, stats, reviews or counts. Prices come from the database; use a clear placeholder when a fact is missing.
- Wording rules live in `AGENTS.md` ("sliders/packs", never "smash burger", never describe what is inside a patty).
- Hyphens in names are fine (Munch-Man, T-Rex, Big-G).

## Known gaps (not blockers)
- About 116 `alert()` calls remain, mostly in Admin and the cart/payment flow. Customer-facing ones (`Payment`, `OrderStatus`, `Profile`) are the ones worth replacing, ideally together with the real-payment work.
