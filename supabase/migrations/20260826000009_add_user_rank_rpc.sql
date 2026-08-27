-- Arcade.jsx's global-rank feature was computing rank via two direct
-- `profiles` count queries from the client. Because the `profiles` SELECT
-- RLS policy only allows a non-admin to see their own row, `.gt('points',
-- userPoints)` could only ever see the caller's own row, so `higherCount`
-- was always 0 and every non-admin user was shown as rank #1.
--
-- Fix: compute rank server-side in a SECURITY DEFINER function that returns
-- only the aggregate numbers (rank, total, percentile) — never raw profile
-- rows — so it's safe to expose without needing to loosen the profiles
-- SELECT policy itself.
CREATE OR REPLACE FUNCTION public.get_user_rank()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_user_points integer;
  v_higher_count integer;
  v_total_count integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('rank', null, 'total', null, 'percentile', null);
  END IF;

  SELECT points INTO v_user_points FROM public.profiles WHERE id = v_user_id;
  SELECT count(*) INTO v_higher_count FROM public.profiles WHERE points > COALESCE(v_user_points, 0);
  SELECT count(*) INTO v_total_count FROM public.profiles;

  RETURN jsonb_build_object(
    'rank', v_higher_count + 1,
    'total', v_total_count,
    'percentile', GREATEST(1, ROUND((v_higher_count + 1)::numeric / NULLIF(v_total_count, 0) * 100))
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_rank() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_rank() TO authenticated;
