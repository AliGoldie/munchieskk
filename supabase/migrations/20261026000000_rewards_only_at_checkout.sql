-- Rewards are claimed in the app at checkout only (Rewards Plan v2, task 5).
--
-- Owner decision: no more "redeem for a counter code". A reward is added to a
-- real app order at checkout (apply_order_reward), where the server already
-- checks the order minimum (RM20, RM30 for the platter), adds the free item as
-- a RM0 line, takes the stock (add-ons too) and takes the Monsta Coins, and
-- the kitchen is notified like any order. That is easy to track and cannot be
-- claimed without a paid order.
--
-- redeem_prize (the old counter-code route) now refuses with a friendly message
-- and takes nothing. It is kept (not dropped) so an old browser tab gets a clear
-- message instead of an error. fulfill_redemption and expire_stale_redemptions
-- stay as they were, in case any old code exists (the live database has none).
--
-- Safe to run more than once. Changes no stored points or stock.

CREATE OR REPLACE FUNCTION public.redeem_prize(p_user_id text, p_prize_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User must be logged in to redeem prizes.';
  END IF;
  RAISE EXCEPTION 'Rewards are added to your order in the app. Choose your reward at checkout when you order.';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redeem_prize(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_prize(text, uuid) TO authenticated;
