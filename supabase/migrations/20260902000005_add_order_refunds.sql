-- Admin CRM brief §4 (Order History): refunds & voids.
-- A full-amount refund is treated as a void (order.status -> CANCELLED);
-- a half refund leaves the order COLLECTED with the refund fields set.
-- Existing "Admins can update orders" (is_admin()) UPDATE policy already
-- covers this -- no new RPC needed, same reasoning as the §2 tags/note
-- migration (only points/role are trigger-protected).

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_amount integer;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_reason text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
