-- claim_share_bonus had NO rate limit at all: it only checked
-- auth.uid() = user_id_param, then unconditionally added 30 points. Any
-- authenticated user could call it directly (e.g. from devtools, bypassing
-- the UI entirely) an unlimited number of times for unlimited points --
-- verified this is exactly what the old signature allowed. Tie it instead
-- to a specific COLLECTED order the caller owns, claimable exactly once,
-- via an atomic UPDATE ... WHERE ... IS NULL so concurrent/duplicate calls
-- for the same order can't both succeed.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS share_bonus_claimed_at timestamptz;

DROP FUNCTION IF EXISTS public.claim_share_bonus(integer, uuid);

CREATE OR REPLACE FUNCTION public.claim_share_bonus(p_order_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be logged in to claim a share bonus.';
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
  SET points = COALESCE(points, 0) + 30
  WHERE id = v_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_share_bonus(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_share_bonus(text) TO authenticated;
