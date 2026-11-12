# Soft launch checklist (before opening to the public)

Goal: 20 to 30 friends and family use the real app with real money for 1 to 2 days. Find what breaks while it is cheap to fix. Target: ready before 20 Nov 2026.

Tick as you go. If a **STOP** item fails, do not open.

## A. Before anyone orders (Ali + Claude)
- [ ] **STOP** Real payment works end to end in the gateway test mode, then once with a real RM1 to RM5 order (see PAYMENTS_PLAN.md). Until then the shop stays CLOSED.
- [ ] Pending SQL is run: Kawan price RM35.50, Ice BB and Solero costs, Kawan wording, data guards. Ask Claude to "check".
- [ ] Big-G and CZ Chix set to RM16.90 in Admin, Menu CRM.
- [ ] Loyverse prices match the app (change by hand; SQL does not reach Loyverse).
- [ ] Two-factor login on GitHub, Vercel, Supabase, Loyverse and the company Gmail.
- [ ] Company staff login kept on one shop device (not shared in chats).
- [ ] Stock counted and entered for real (patties, buns, cheese, fries, drinks). Shop status set to OPEN only at the start of the test.
- [ ] Old test orders removed (Ali runs the cleanup SQL Claude gives).

## B. Test orders (friends and family, each one a real order)
Ask each tester to try one different thing, and tell you how it felt.
- [ ] Plain burger, pay by FPX.
- [ ] Pay by Touch 'n Go and by DuitNow QR.
- [ ] A meat swap (chicken +RM1, lamb +RM2): does the price shown match what they paid?
- [ ] The Kawan, with and without swaps.
- [ ] An add-on (extra patty, cheese, egg).
- [ ] A scheduled order for later.
- [ ] A reward order using Monsta Coins (free item, swaps still charged).
- [ ] A promo code, if any are live.
- [ ] Start paying and walk away: after 15 minutes the order disappears, stock comes back.
- [ ] Cancel an order. Stock comes back; payment refund handled by Ali by hand.
- [ ] Two phones order the last item at the same moment: only one succeeds.
- [ ] Customer on an old or small phone; customer on slow data.

## C. Staff drills (use the company login, on the shop device)
- [ ] New app order shows in **Orders** only after it is paid.
- [ ] Mark an order preparing, ready, collected. Points arrive when collected, not before.
- [ ] A walk-in sale in the **Loyverse till** lowers the app stock by itself. A sale of several items lowers each one.
- [ ] A GrabFood order keyed in the **GrabFood** tab. Try a duplicate Grab reference: it must be refused.
- [ ] A customer shows a reward code: staff press **Fulfill** in **Redemptions**.
- [ ] Closing stock count in **Inventory**: type the real counts, note any item that differs.
- [ ] Cash-up at closing: counted cash vs expected; investigate a difference over RM5.

## D. Money checks (Ali, next morning)
- [ ] Gateway dashboard total = sum of PAID app orders for the day.
- [ ] Fees match what the gateway quoted.
- [ ] Any `late_payment` flagged order is refunded by hand.
- [ ] Stock differences from the closing count explained (waste, free samples, mistakes).
- [ ] Cost and margin check on 3 popular items against the finance sheet.

## E. Go / no-go (decide together)
**Open to the public if all true:**
- [ ] No STOP item failed.
- [ ] Every order was paid, cooked and collected without staff improvising.
- [ ] Stock and cash differences are small and explained.
- [ ] Nobody got charged without an order, or an order without payment.
- [ ] Staff can do each drill from memory.

**Otherwise:** fix, then repeat only the failed tests. Do not widen the test group to hide a problem.

## F. Day one of public opening
- [ ] Ali or a manager is on the shop floor and reviews the "differed" stock items that night.
- [ ] Watch the first 10 orders in Orders and the gateway dashboard.
- [ ] Keep a notes list of every customer complaint and send it to Claude the next day.
