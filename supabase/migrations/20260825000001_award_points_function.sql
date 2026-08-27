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
