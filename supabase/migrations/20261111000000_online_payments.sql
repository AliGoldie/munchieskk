-- Online payments (core, gateway-neutral). Nothing changes for customers until
-- the owner switches store_settings.online_payments_enabled to true.
--
-- When it is ON, an app order (channel 'web') is created UNPAID with a 15
-- minute window. Only the payment system (the service role, from a gateway
-- webhook) can mark it PAID, and only for the exact order total. A UNPAID order
-- cannot be cooked, readied or collected. If the window passes, the order is
-- cancelled, the stock goes back, and any coins spent on a reward are refunded.
-- Grab, Loyverse and other channels are untouched (they stay PAID).
--
-- A payment that arrives after the order expired is NOT silently accepted: the
-- order stays cancelled and is flagged late_payment so staff can refund it.
--
-- Safe to run twice.

ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS online_payments_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'PAID';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_gateway text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_ref text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_expires_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS paid_cents integer;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS late_payment boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_payment_status_check') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check
      CHECK (payment_status IN ('UNPAID', 'PAID', 'EXPIRED', 'REFUNDED'));
  END IF;
END $$;

-- One gateway payment can settle one order only.
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_gateway_ref
  ON public.orders (payment_gateway, payment_ref) WHERE payment_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_unpaid_expiry
  ON public.orders (payment_expires_at) WHERE payment_status = 'UNPAID';

-- 1. New app orders start UNPAID when online payments are on.
CREATE OR REPLACE FUNCTION public.set_order_payment_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_on boolean;
BEGIN
  IF COALESCE(NEW.channel, 'web') = 'web' THEN
    SELECT COALESCE(online_payments_enabled, false) INTO v_on FROM public.store_settings WHERE id = 'main_store';
    IF COALESCE(v_on, false) THEN
      NEW.payment_status := 'UNPAID';
      NEW.payment_expires_at := now() + interval '15 minutes';
      NEW.payment_gateway := NULL;
      NEW.payment_ref := NULL;
      NEW.paid_at := NULL;
      NEW.paid_cents := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_set_order_payment_state ON public.orders;
CREATE TRIGGER trg_set_order_payment_state
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_order_payment_state();
REVOKE EXECUTE ON FUNCTION public.set_order_payment_state() FROM PUBLIC, anon, authenticated;

-- 2. Payment columns change only through the payment system, never from a
--    signed-in browser (staff included). Orders cannot move on while unpaid.
CREATE OR REPLACE FUNCTION public.protect_order_payment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.payment_status IS DISTINCT FROM OLD.payment_status
      OR NEW.payment_gateway IS DISTINCT FROM OLD.payment_gateway
      OR NEW.payment_ref IS DISTINCT FROM OLD.payment_ref
      OR NEW.payment_expires_at IS DISTINCT FROM OLD.payment_expires_at
      OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
      OR NEW.paid_cents IS DISTINCT FROM OLD.paid_cents
      OR NEW.late_payment IS DISTINCT FROM OLD.late_payment)
     AND current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    RAISE EXCEPTION 'Payment details can only be changed by the payment system';
  END IF;

  IF OLD.payment_status = 'UNPAID' AND NEW.payment_status = 'UNPAID'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status NOT IN ('PENDING', 'CANCELLED') THEN
    RAISE EXCEPTION 'This order has not been paid yet';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_order_payment ON public.orders;
CREATE TRIGGER trg_protect_order_payment
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.protect_order_payment();
REVOKE EXECUTE ON FUNCTION public.protect_order_payment() FROM PUBLIC, anon, authenticated;

-- 3. The payment system confirms a payment. Idempotent, exact-amount only.
--    Returns PAID | ALREADY_PAID | AMOUNT_MISMATCH | LATE | NOT_FOUND.
CREATE OR REPLACE FUNCTION public.confirm_order_payment(
  p_order_id text, p_gateway text, p_ref text, p_amount_cents integer
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
BEGIN
  SELECT id, total, status, payment_status INTO v_order
  FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF v_order.payment_status = 'PAID' THEN
    RETURN 'ALREADY_PAID';
  END IF;
  IF p_amount_cents IS DISTINCT FROM v_order.total THEN
    RETURN 'AMOUNT_MISMATCH';
  END IF;
  IF v_order.payment_status = 'EXPIRED' OR v_order.status = 'CANCELLED' THEN
    UPDATE public.orders
       SET late_payment = true, payment_gateway = p_gateway, payment_ref = p_ref,
           paid_at = now(), paid_cents = p_amount_cents
     WHERE id = p_order_id;
    RETURN 'LATE';
  END IF;
  UPDATE public.orders
     SET payment_status = 'PAID', payment_gateway = p_gateway, payment_ref = p_ref,
         paid_at = now(), paid_cents = p_amount_cents
   WHERE id = p_order_id;
  RETURN 'PAID';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.confirm_order_payment(text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_order_payment(text, text, text, integer) TO service_role;

-- 4. Expire unpaid orders whose window has passed: cancel, return stock, refund
--    reward coins. Safe for anyone to call (it only touches overdue orders),
--    like apply_due_reward_prices. Returns how many it expired.
CREATE OR REPLACE FUNCTION public.expire_unpaid_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_item record;
  v_addon record;
  v_reward record;
  v_count integer := 0;
BEGIN
  FOR v_order IN
    SELECT id, items FROM public.orders
     WHERE payment_status = 'UNPAID' AND payment_expires_at IS NOT NULL AND payment_expires_at < now()
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.orders
       SET status = 'CANCELLED', payment_status = 'EXPIRED',
           cancel_reason = 'Payment not completed in time'
     WHERE id = v_order.id;

    SELECT id, user_id, points_spent INTO v_reward
      FROM public.redemptions WHERE order_id = v_order.id AND status = 'FULFILLED' FOR UPDATE;
    IF FOUND THEN
      UPDATE public.redemptions SET status = 'CANCELLED' WHERE id = v_reward.id;
      UPDATE public.profiles SET points = COALESCE(points, 0) + v_reward.points_spent WHERE id = v_reward.user_id;
    END IF;

    FOR v_item IN
      SELECT (e->>'id') AS menu_item_id, COALESCE((e->>'quantity')::integer, 1) AS quantity, (e->'selectedAddons') AS addons
        FROM jsonb_array_elements(COALESCE(v_order.items, '[]'::jsonb)) e
    LOOP
      IF v_item.menu_item_id IS NOT NULL THEN
        UPDATE public.menu_items
           SET stock_quantity = COALESCE(stock_quantity, 0) + v_item.quantity, in_stock = true
         WHERE id = v_item.menu_item_id;
      END IF;
      IF v_item.addons IS NOT NULL AND jsonb_typeof(v_item.addons) = 'array' THEN
        FOR v_addon IN SELECT (a->>'id') AS addon_id FROM jsonb_array_elements(v_item.addons) a LOOP
          IF v_addon.addon_id IS NOT NULL THEN
            UPDATE public.addons
               SET stock_quantity = COALESCE(stock_quantity, 0) + v_item.quantity, in_stock = true
             WHERE id = v_addon.addon_id;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.expire_unpaid_orders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_unpaid_orders() TO anon, authenticated, service_role;
