-- Creates the award_points RPC function that the app calls to add loyalty points.
-- This function never existed in any prior migration, which is why calls to it
-- failed with "Could not find the function" and fell back to a direct client-side
-- UPDATE on profiles, which was being blocked by RLS (error 42501: permission
-- denied for table profiles).
--
-- SECURITY DEFINER makes this run with elevated privileges, bypassing the RLS
-- timing/session issue entirely. The auth.uid() = user_id_param check still
-- prevents one user from awarding points to a DIFFERENT user's account.
--
-- KNOWN LIMITATION: this does not validate that the points award corresponds to
-- a real, legitimate action. A user could call this RPC directly with an inflated
-- amount_param for their own account. Closing that gap requires validating each
-- specific business action server-side — a separate, larger task.

CREATE OR REPLACE FUNCTION public.award_points(user_id_param uuid, amount_param integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() <> user_id_param AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'permission denied: cannot award points to another user';
  END IF;

  UPDATE public.profiles
  SET points = COALESCE(points, 0) + amount_param
  WHERE id = user_id_param;
END;
$$;

GRANT EXECUTE ON FUNCTION public.award_points(uuid, integer) TO authenticated;
