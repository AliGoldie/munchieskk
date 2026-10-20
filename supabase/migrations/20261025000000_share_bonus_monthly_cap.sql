-- Share bonus: at most 4 instant "share your meal" bonuses (+20 Monsta Coins each)
-- per account per calendar month (Malaysia time). Rewards Plan v2, task 4.
--
-- Why: the instant bonus cannot check that the customer really posted (the app
-- only sees that a share window was opened and closed). The cap limits what
-- tapping Share can ever pay. The screenshot bonus is unchanged: it is checked
-- by staff before it pays, so it is not capped here.
--
--   * share_settings.share_max_per_month (default 4) is the limit. Change it with:
--       UPDATE public.share_settings SET share_max_per_month = 6;
--   * The limit counts orders whose instant share bonus was claimed this month.
--   * Two quick taps cannot both pass (a per-user lock is held while counting).
--   * A capped tap pays nothing and leaves the order unclaimed.
--
-- Safe to run more than once. Changes no stored points.

CREATE TABLE IF NOT EXISTS public.share_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  share_max_per_month integer NOT NULL DEFAULT 4 CHECK (share_max_per_month >= 1)
);
INSERT INTO public.share_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.share_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.share_settings FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_share_bonus(p_order_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_cap integer;
  v_month_start timestamptz;
  v_used integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be logged in to claim a share bonus.';
  END IF;

  -- One claim at a time per customer, so the count below cannot be raced.
  PERFORM pg_advisory_xact_lock(hashtext('share_cap:' || v_user_id::text));

  SELECT share_max_per_month INTO v_cap FROM public.share_settings WHERE id;
  v_cap := COALESCE(v_cap, 4);
  v_month_start := date_trunc('month', now() AT TIME ZONE 'Asia/Kuching') AT TIME ZONE 'Asia/Kuching';

  SELECT count(*) INTO v_used
  FROM public.orders
  WHERE user_id = v_user_id AND share_bonus_claimed_at >= v_month_start;

  IF v_used >= v_cap THEN
    RAISE EXCEPTION 'You have used your % share bonuses for this month. Share again next month, or send us a screenshot of your post for the extra bonus.', v_cap;
  END IF;

  UPDATE public.orders
  SET share_bonus_claimed_at = NOW()
  WHERE id = p_order_id
    AND user_id = v_user_id
    AND status = 'COLLECTED'
    AND share_bonus_claimed_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Share bonus already claimed, or this order is not eligible.';
  END IF;

  -- Fixed server-side amount, matching src/config/loyaltyConfig.js REVIEW_BONUS_PTS.
  UPDATE public.profiles
  SET points = COALESCE(points, 0) + 20
  WHERE id = v_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_share_bonus(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_share_bonus(text) TO authenticated;
