# Points system audit (owner notes), 12 Oct 2026

Checked against the live database functions and the website code.

## Confirmed working as designed
- Order points: 1 point per RM1 of the order total, awarded when the order is placed (`handle_order_placed`), taken back on cancel (`cancel_order`, owner-or-admin only).
- Collection bonus 6, referral 150 on first collected RM20+ order (cap 5 per referrer), friend +30 at signup, share 20, screenshot top-up to 40, 14-day redemption expiry with refund, arcade caps (20/day per game, 150/week across all free sources), 30-day grace for arcade points. All covered by `supabase/tests/*.test.sql`.
- Prize redemption deducts points and stock atomically; fulfilling needs an admin; expired redemptions cannot be fulfilled.

## Gaps and risks (not fixed unless noted)
1. **Order points are paid at placement, not collection.** A customer who places an order and never collects keeps the points until staff cancel it. Mitigation today: staff cancel no-shows (cancel takes the points back) and a customer can have at most 5 pending orders. Better: pay order points at collection, or auto-cancel stale PENDING orders.
2. **Tiers are not implemented.** `loyaltyConfig.TIERS` (Bronze/Silver/Gold, 1,000 / 5,000) is not used anywhere in the app or database. The Loyalty page's "5,000 TARGET" bar is a leftover. Do not promote tiers.
3. **No burger reward is live.** Two Mushy rewards are switched off. The Home page now names the cheapest live reward instead of promising a free burger.
4. **Friend signup bonus (+30) is paid at signup**, to anyone who signs up with any valid referral code. Fake accounts could farm it (30 pts each, about RM0.30 of food). Better: pay it on the friend's first collected order.
5. **Counter sales (Loyverse) earn no app points** (imported with "No Phone"). Options: leave, or add a "give points by phone number" button.
6. **Game days reset at 08:00 Malaysia time** (database date is UTC).
7. **Game scores are self-reported by the browser.** Caps (40 per run, 20/day/game, 150/week) limit the damage to about RM1.60 a week per player at about 1 sen a point.
8. **Share prompt appears only right after tapping Collect**; the screenshot upload is shown on any collected order for 14 days.
9. **Redemption does not check a purchase.** Staff must ring up the paid items in Loyverse first, then tap Fulfil.
10. Rewards cost about 1 to 1.2 sen of food cost per point (figure supplied by the owner's other planning chat, not verified here).

## Next build (release 2, not started)
Redeem rewards at checkout in the app (free line at RM0, points taken at order placement and refunded on cancel), with minimum paid-order rules for bigger rewards.
