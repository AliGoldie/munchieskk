-- Scheduled reward price changes (Rewards Plan v2, task 8; owner decision
-- 21 Oct 2026: announcement + automatic switch).
--
-- In Admin > Prizes CRM the owner sets a new Monsta Coin price and the date it
-- starts. Customers see a notice until that date; on the date (Malaysia time)
-- the new price takes over by itself.
--
-- Guards (enforced here, not only in the browser):
--   * the new price must be LOWER than the current one (reward prices never go up);
--   * the date must give customers at least 30 days' notice;
--   * rank perks (free, no coins) cannot be scheduled.
--
-- The switch is applied by apply_due_reward_prices(). The app calls it when it
-- loads and again just before a reward is added at checkout, so nobody can be
-- charged the old price after the date. It only ever applies changes that are
-- due, so anyone may call it.
--
-- Safe to run twice.

ALTER TABLE public.loyalty_prizes ADD COLUMN IF NOT EXISTS new_points_cost integer;
ALTER TABLE public.loyalty_prizes ADD COLUMN IF NOT EXISTS new_cost_from date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_prizes_scheduled_price_pair') THEN
    ALTER TABLE public.loyalty_prizes ADD CONSTRAINT loyalty_prizes_scheduled_price_pair
      CHECK ((new_points_cost IS NULL) = (new_cost_from IS NULL));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.check_scheduled_reward_price()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_earliest date := (now() AT TIME ZONE 'Asia/Kuching')::date + 30;
BEGIN
  IF NEW.new_points_cost IS NULL THEN
    RETURN NEW;  -- nothing scheduled (or a schedule being cancelled)
  END IF;
  -- Only check when the schedule itself is being set or changed.
  IF TG_OP = 'UPDATE'
     AND NEW.new_points_cost IS NOT DISTINCT FROM OLD.new_points_cost
     AND NEW.new_cost_from IS NOT DISTINCT FROM OLD.new_cost_from THEN
    RETURN NEW;
  END IF;
  IF NEW.perk_rank_order IS NOT NULL THEN
    RAISE EXCEPTION 'Rank perks are free and have no coin price to change';
  END IF;
  IF NEW.new_points_cost < 1 OR NEW.new_points_cost >= NEW.points_cost THEN
    RAISE EXCEPTION 'The new price must be lower than the current % coins (reward prices never go up)', NEW.points_cost;
  END IF;
  IF NEW.new_cost_from < v_earliest THEN
    RAISE EXCEPTION 'Give customers at least 30 days notice: pick % or later', to_char(v_earliest, 'DD Mon YYYY');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_scheduled_reward_price ON public.loyalty_prizes;
CREATE TRIGGER trg_check_scheduled_reward_price
  BEFORE INSERT OR UPDATE ON public.loyalty_prizes
  FOR EACH ROW EXECUTE FUNCTION public.check_scheduled_reward_price();
REVOKE EXECUTE ON FUNCTION public.check_scheduled_reward_price() FROM PUBLIC, anon, authenticated;

-- Applies every schedule whose date has arrived (Malaysia time). A schedule
-- that is no longer a price cut (the price was lowered by hand in the
-- meantime) is simply cleared, so this can never raise a price.
CREATE OR REPLACE FUNCTION public.apply_due_reward_prices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuching')::date;
  v_count integer;
BEGIN
  UPDATE public.loyalty_prizes
     SET points_cost = CASE WHEN new_points_cost < points_cost THEN new_points_cost ELSE points_cost END,
         new_points_cost = NULL,
         new_cost_from = NULL
   WHERE new_cost_from IS NOT NULL AND new_cost_from <= v_today;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_due_reward_prices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_due_reward_prices() TO anon, authenticated;
