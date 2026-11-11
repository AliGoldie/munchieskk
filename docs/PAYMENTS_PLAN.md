# Online payments plan (status: core built, switched OFF)

Updated 11 Nov 2026. No keys or secrets ever go in this repo; gateway keys live in Supabase secrets only.

## Goal
Customers pay in the app (FPX online banking incl. Maybank, DuitNow QR, Touch 'n Go eWallet; Alipay later for tourists). The order only counts once the gateway confirms the exact amount.

## How it works
1. Customer checks out. The order is created **UNPAID** (stock held, 15 minute window).
2. The app asks the server to open a gateway payment for that order (the server reads the real total from the database, never from the browser).
3. Customer pays on the gateway page and comes back to the order page.
4. The gateway calls our **webhook**. After checking its signature, the server calls `confirm_order_payment(order, gateway, ref, amount)`. Only the exact total marks the order PAID.
5. Kitchen only sees PAID orders. An UNPAID order cannot be cooked, readied or collected.
6. If the 15 minutes pass, `expire_unpaid_orders()` cancels the order, returns the stock and refunds any coins spent on a reward.
7. A payment arriving after expiry is flagged `late_payment` for a manual refund; it never revives the order.

## Built (this PR)
- `supabase/migrations/20261111000000_online_payments.sql` and `supabase/tests/online_payments.test.sql`: payment columns on `orders`, the UNPAID start, the guards (browsers cannot mark an order paid; unpaid orders cannot move on), `confirm_order_payment`, `expire_unpaid_orders`.
- The master switch is `store_settings.online_payments_enabled` (default **false**). While it is false nothing changes: orders behave exactly as today. **Do not turn it on until the rest below is built and tested.**

## Still to build (needs gateway sandbox keys)
- Edge function `payments-create` (opens the gateway payment) and `payments-webhook` (verifies signature, calls `confirm_order_payment`). One small adapter per gateway so the gateway can be swapped.
- Checkout: redirect to the gateway, then a "confirming your payment" wait on the order page.
- Admin: show only PAID orders to the kitchen; list `late_payment` orders for refund; call `expire_unpaid_orders` regularly.
- `vercel.json` CSP: allow the gateway's host.
- Tests (including a fake gateway) and a real sandbox run.

## Gateway choice (to confirm with each provider before applying)
The first plan assumed Billplz or ToyyibPay. Wishlist (FPX, DuitNow QR, Touch 'n Go, Alipay later) fits a multi-method gateway better. Figures below come from the providers' own pages or comparison sites; verify.
- HitPay: FPX 1.8% + RM0.40, DuitNow QR 1.2%, Touch 'n Go 1.9%, cards 1.2% + RM1; no monthly fee; reported 2 to 3 business days to approve.
- Billplz Basic: FPX RM1.25 flat; reported ~14 working days to approve (too slow for a 20 Nov opening).
- Alipay: confirm availability with each gateway before applying.
Documents usually asked for: SSM registration, MyKad, Malaysian business bank account.
