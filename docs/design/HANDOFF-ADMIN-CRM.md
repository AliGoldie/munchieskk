# Munchies KK — Admin Console CRM upgrade

Build brief for Claude Code. Source of truth for the design: `Munchieskk Admin Console.dc.html`
(open it, click through — every control below is live in the mockup).
Target file: `src/pages/Admin.jsx` (+ `Admin.css`), new Supabase tables where noted.

Nothing here changes routing. `src/App.jsx` stays byte-identical.

---

## 0. Do not regress what already shipped

`Admin.jsx` moved after this console was designed. Three live features are NOT in the
older screenshots of the mockup and MUST survive this work — the mockup has since been
updated to show all three, so build against the current file:

| Live in repo | Where | Keep |
|---|---|---|
| `menu_items.cost_price` (cents, nullable) | Add-item form, Edit Details modal, analytics COGS, redemption cost | Cost field on both forms, live margin readout, `lineCost()` fallback to the flat 40% estimate when cost is null |
| `sort_order` on `menu_items` + `addons` | `moveMenuItem` / `moveAddon` in `StoreContext` | The ▲▼ arrows on every Menu CRM and Add-ons CRM row. Menu swaps within the SAME category; add-ons swap in the flat list |
| `profiles.avatar_color` | `Profile.jsx` picker, `AuthContext` default `'ember'` | Palette `ember #F04E23 / gold #FFC72C / green #5FD68C / purple #C77DFF / blue #63A7F5`. Use it for the customer avatar in the CRM detail view rather than a new colour ramp |
| **Per-item add-on matrix** | `Admin.jsx` ~L3091 checkbox grid, `StoreContext.toggleItemAddon`, `item_addons` join | Already correct — the checkbox grid per menu item IS the model. Do **not** replace it with a free-text "attached to" field |
| **Prize → menu item link** | `Admin.jsx` ~L3479 `menu_item_id` select in the prize form, `getRedemptionCost` | Already correct — redemption cost reads `prizes.menu_item_id → menu_items.cost_price`. Keep the select; never match prizes to items by name |

Migrations already applied: `20260830000000_add_menu_item_cost_price`,
`20260901000000_add_sort_order`, `20260901000001_add_avatar_color`.
The new tables this brief asks for (`admin_audit`, `shifts`, refund columns) are additive on top.

---

## 0. Shared machinery (do this first — everything else depends on it)

### Toast queue with Undo
Replaces the existing `SyncToastItem` one-off. One store, four kinds.

```
kind: 'info' | 'new' | 'danger' | 'warn'
{ id, msg, kind, undo?: () => void }
```
- Bottom-right stack, max 4, newest at the bottom, `toastIn` 220ms cubic-bezier(.2,.8,.3,1).
- Auto-dismiss 6.5s (`warn` 11s). Undo button and × both dismiss.
- Colours: info `#17150F`/accent `#FFC72C`; new `#0F7A4F`/`#BDE5D1`; danger `#8E1F1B`/`#F5B7B1`; warn `#8A6100`/`#FFE9A8`.
- **Every destructive action returns an undo closure that restores the previous row object.**
  Cancel order, refund, promo create, order state advance, shift close all carry Undo today.

### Audit log
New table `admin_audit`: `id, created_at, actor_id, actor_role, action, detail`.
Write one row from every mutation (`logAudit(action, detail)`). The mockup logs:
price change, stock adjust, order accepted/ready/collected/cancelled, cancel undone,
refund/void, promo created, promo activated, hours changed, closure added, photo replaced,
customer note saved, blast sent, shift opened/closed.
Surface: new 13th sidebar tab **Audit log**, owner-only, newest first.

### Roles
`profiles.role: 'owner' | 'staff'`. Staff loses: Analytics tab, Monthly Reports tab, Audit log tab,
and the **Net profit** dashboard KPI. A blue banner states what is hidden.
The mockup fakes this with a click on the sidebar user card — in production it comes from the session.

### Per-tab skeletons
Tab switch sets `loading` for ~420ms and paints a shimmer skeleton over the content area
(4 KPI blocks + two panels). Do this on the real fetch boundary, not a timer.

### Empty & error states
Every list gets one: menu search, customer segment, order history filter, monthly reports,
kanban column, diary. Copy pattern: bold uppercase Archivo line + one grey Inter line telling the
user what to change.

---

## 1. Live Orders

- **Cancel with reason** — Cancel opens a modal: 6 reason chips
  (Customer no-show / Item out of stock / Duplicate order / Payment failed / Kitchen error / Other)
  + optional note. Confirm writes `orders.cancel_reason`, `cancel_note`, logs audit, toasts with Undo.
- **New-order sound + badge** — WebAudio two-tone chirp (880Hz then 1180Hz, 0.22s each) on any new
  PENDING row from the realtime subscription; sidebar badge runs `badgeFlash` 3×. Sound is a toggle
  in the orders toolbar, persisted per device.
- **Feed error state** — when the Loyverse poll fails, a red banner replaces the sync chip state:
  "Walk-in orders are not syncing. Web orders are unaffected." + Retry.
- Advancing a card (Accept → Ready → Collected) toasts with Undo and, on Collected, writes the row
  into Order History immediately.

## 2. Customers → a real CRM

Add to the customer projection: `last_seen_days`, `joined`, `tags text[]`, `note text`.

- **Segments** (computed, not stored) — First-timer (1 order) → At risk (>21 days) → VIP (≥RM600
  lifetime) → Regular (≥5 orders) → Occasional, evaluated in that order. Chips with live counts
  filter the table; the segment also scopes the blast.
- **Detail drill-down** — clicking a name swaps the table for a profile: avatar, segment badge,
  5-stat strip (lifetime spend / orders / avg order / points / last seen), **order timeline** built
  from that customer's history rows (refunds flagged inline), editable **tags**, and a free-text
  **counter note** (allergies, usual order) that saves to the profile and logs audit.
- **Blast** — "Message segment" opens a composer: WhatsApp or Push, `{name}` token, live preview,
  recipient count from the current segment. Wire to whichever provider you use; log the send.

## 3. Analytics

- **Date range** — preset chips (Today / 7d / 30d / This month / Custom) plus two date inputs.
  Presets write the two dates; editing a date flips to Custom.
- **Top-items channel filter** — All / Web / Loyverse / GrabFood. Grab additionally subtracts the
  commission from displayed margin.

## 4. Order History

- **Paging** — 6 rows, "Load N more · X remaining", plus a "Showing n of N" line.
- **Filters** — All / Web / Loyverse / Grab / Cancelled / **Refunded**.
- **Refunds & voids** — expand a row → "Refund or void". Modal takes an amount (Full / Half
  shortcuts) and a reason code (Item made wrong / Missing item / Late collection / Quality complaint
  / Duplicate charge / Goodwill). Full amount = void. Row then shows a red badge; the refund also
  appears in the customer's timeline and reduces net in reports.
  New columns: `orders.refund_amount`, `orders.refund_reason`, `orders.refunded_at`.

## 5. Trading hours & diary (Dashboard + header)

- **Schedule modal** — 7 day rows: enabled toggle, open/close time inputs, live state label; today
  is highlighted. Below: special closures list (date + reason, removable) and an add row.
  The header pill reads from today's row. Saving toasts and logs audit.
- **Diary calendar** — month grid; gold dot = entry, red = closure. Click a day to add. Upcoming
  list below with edit and remove. Backed by a table, not localStorage (the current
  `munchies_admin_events_notes` key should be migrated once and dropped).

## 5b. Prep board, waste log and real food cost (Dashboard)

Three additions that use tables/columns the app already has but no screen touches.
Still genuinely missing from `Admin.jsx` as of 2026-09-02: the pause control, `waste_log`,
the prep board, the real food-cost figure, a `game_plays` view, manual points adjustment,
and Loyverse token-health warnings.

- **Pause online ordering** — header button writes `store_settings.status`; the amber banner's
  text field writes `store_settings.notice_message` and the storefront shows it. Distinct from
  trading hours: hours stay untouched, the shop pill reads "Orders paused". Logs audit.
- **Prep board** — per item: tonight's projected demand (average sold on this weekday over the
  last 8 weeks, from `orders`), current `stock_quantity`, and a `Prep n` / `Covered` badge with a
  fill bar. Six rows, highest projection first.
- **Waste log** — writes the **existing, entirely unused** `waste_log` table
  (`order_id, item_id, quantity, reason, logged_by`). Item select + qty + reason chip
  (Made wrong / Dropped / End of night / Expired), removable rows for the current shift.
- **Food cost tonight** — `(COGS + waste) / gross sales`, where COGS uses real `cost_price` per
  line and falls back to the 40% estimate for uncosted items. The card footer states how many
  items are still estimated, which is the nudge to fill cost prices in.

## 6. Shift handover / cash-up (Dashboard)

Opening float (editable) · cash sales · card+e-wallet · expected drawer · counted input · variance.
Variance ≤ RM5 green, otherwise red "investigate". Close shift logs audit and toasts with Undo;
reopen is possible until the next shift starts. New table `shifts`:
`opened_at, closed_at, opening_float, counted, expected, variance, closed_by`.

## 7. Promotions

**Promo modal** replaces the inline form. Type chips: Percent off / RM off / Free item.
Fields adapt: percent+min spend, RM+min spend, or item picker + min spend. Plus code, internal name,
validity window, active toggle, and a live "Customer sees" preview string. Save → toast with Undo.

## 8. Menu & Add-ons — photo upload, cost price, ordering

The Menu CRM row is now: **▲▼ · item · price · cost/margin · stock · low-at · availability · details**.
Cost is an inline field like price; the small line under it reads `RM x.xx · nn%` when a cost is set
and `Not set · est. 40%` (amber) when it isn't. Same margin line under the Add-item form's cost
field and in the Edit Details modal. Redemptions gains a **Cost** column reading `cost_price` of the
menu item the prize links to via `prizes.menu_item_id` — never by name matching. Three states:
`RM x.xx`, amber "No cost set" (linked but the item has no cost), amber "Not linked" (free-choice
prizes). The header shows the range total and how many prizes are uncosted.


Add New Item photo tile has three states: idle dropzone → uploading (yellow progress bar) →
attached (green, filename + size, Replace). Menu rows: the coloured initial tile is a button;
clicking it uploads a replacement and shows an inline progress fill. Wire to Supabase storage.

---

## Acceptance

- Every destructive action is undoable for at least 6 seconds, and appears in the audit log.
- Staff role cannot reach analytics, reports, audit or any margin figure.
- No tab ever renders an empty white box: skeleton while loading, empty state when genuinely empty.
- Cancels and refunds always carry a reason code — no free-text-only path.
- The header shop pill and the storefront both read from the same schedule record.
