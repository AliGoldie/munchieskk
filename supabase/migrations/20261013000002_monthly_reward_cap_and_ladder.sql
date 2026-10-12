-- Rewards: 3 claims per customer per calendar month (Malaysia time), and a
-- smaller starter ladder. Run in the Supabase SQL editor. Safe to re-run.
--
-- The cap is a trigger on redemptions, so it covers BOTH ways a reward is
-- claimed: at checkout (apply_order_reward) and at the counter (redeem_prize).
-- Cancelled claims do not count, so a cancelled order gives its slot back.

CREATE OR REPLACE FUNCTION public.enforce_monthly_reward_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_monthly_cap constant integer := 3;
  v_month_start timestamptz;
  v_used integer;
BEGIN
  -- Serialise claims per customer so two claims at once can't both pass.
  PERFORM pg_advisory_xact_lock(hashtext('reward_cap:' || NEW.user_id::text));

  v_month_start := date_trunc('month', now() AT TIME ZONE 'Asia/Kuching') AT TIME ZONE 'Asia/Kuching';

  SELECT COUNT(*) INTO v_used
  FROM public.redemptions
  WHERE user_id = NEW.user_id
    AND status <> 'CANCELLED'
    AND redeemed_at >= v_month_start;

  IF v_used >= c_monthly_cap THEN
    RAISE EXCEPTION 'You have used your % rewards for this month. You can claim more next month.', c_monthly_cap;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_monthly_reward_cap ON public.redemptions;
CREATE TRIGGER trg_enforce_monthly_reward_cap
  BEFORE INSERT ON public.redemptions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_monthly_reward_cap();

-- Starter ladder: FREE FRIES 150, Ice BB 350, Free Cheese 50, Free Egg 60, Free Mushy2 800, Kawan MONSTA 3,000.
-- Minimum orders: fries, egg and Ice BB RM20; Kawan MONSTA RM30 (break-even on the
-- visit) for the launch period to 31 December 2026. Review then; any change applies
-- to new redemptions only.
UPDATE public.loyalty_prizes SET points_cost = 150, min_order_cents = 2000 WHERE name = 'FREE FRIES';
UPDATE public.loyalty_prizes SET points_cost = 350, min_order_cents = 2000 WHERE name = 'Ice BB';

UPDATE public.loyalty_prizes
SET is_active = false
WHERE name NOT IN ('FREE FRIES', 'Ice BB', 'Free Cheese', 'Free Egg', 'Free Mushy2', 'Free Kawan MONSTA')
  AND is_active = true;

INSERT INTO public.loyalty_prizes (name, description, points_cost, menu_item_id, addon_id, min_order_cents, deduct_stock, is_active)
SELECT 'Free Cheese', 'Extra cheese on any burger', 50, NULL, a.id, 2000, false, true
FROM public.addons a
WHERE a.name = 'Cheese'
  AND NOT EXISTS (SELECT 1 FROM public.loyalty_prizes WHERE name = 'Free Cheese');

INSERT INTO public.loyalty_prizes (name, description, points_cost, menu_item_id, addon_id, min_order_cents, deduct_stock, is_active)
SELECT 'Free Egg', 'An egg on any burger', 60, NULL, a.id, 2000, false, true
FROM public.addons a
WHERE a.name = 'Egg'
  AND NOT EXISTS (SELECT 1 FROM public.loyalty_prizes WHERE name = 'Free Egg');

INSERT INTO public.loyalty_prizes (name, description, points_cost, menu_item_id, addon_id, min_order_cents, deduct_stock, is_active)
SELECT 'Free Mushy2', 'A Mushy2 burger', 800, m.id, NULL, 2000, true, true
FROM public.menu_items m
WHERE m.name = 'Mushy2 Burger'
  AND NOT EXISTS (SELECT 1 FROM public.loyalty_prizes WHERE name = 'Free Mushy2');

INSERT INTO public.loyalty_prizes (name, description, points_cost, menu_item_id, addon_id, min_order_cents, deduct_stock, is_active)
SELECT 'Free Kawan MONSTA', 'The Kawan MONSTA platter', 3000, m.id, NULL, 3000, true, true
FROM public.menu_items m
WHERE m.name = 'Kawan MONSTA'
  AND NOT EXISTS (SELECT 1 FROM public.loyalty_prizes WHERE name = 'Free Kawan MONSTA');

-- Platter minimum for the launch period (RM30), if the row already exists.
UPDATE public.loyalty_prizes SET min_order_cents = 3000 WHERE name = 'Free Kawan MONSTA';
