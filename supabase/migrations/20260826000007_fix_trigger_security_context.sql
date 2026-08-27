-- CRITICAL FIX to 20260826000005's own bug, caught by direct testing before
-- this ever shipped to a real user: protect_profile_privileged_columns() was
-- declared SECURITY DEFINER. A SECURITY DEFINER function's `current_user`
-- is ALWAYS the function's owner (postgres, since it was created via this
-- CLI) regardless of who actually triggered the UPDATE — so the check
-- `IF current_user = 'postgres' ... THEN RETURN NEW` was unconditionally
-- true, and the trigger protected nothing at all. Verified live: a non-admin
-- test user (id 6928a903-b850-4ee6-a07d-a8c88b4170f1) could still set
-- points=999999 and role='admin' on themselves after 20260826000005 shipped.
--
-- Fix: make this trigger function SECURITY INVOKER (the default — just omit
-- the clause) so current_user correctly reflects whichever role actually
-- executed the UPDATE: 'postgres' when called from inside another SECURITY
-- DEFINER function (place_order, award_points, etc.), or 'authenticated'/
-- 'anon' for a direct PostgREST call. is_admin() itself stays SECURITY
-- DEFINER (unrelated, legitimate use — it needs to bypass RLS to read the
-- caller's own role row).
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user = 'postgres' OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  NEW.id := OLD.id;
  NEW.points := OLD.points;
  NEW.role := OLD.role;
  NEW.is_admin := OLD.is_admin;
  NEW.tier := OLD.tier;
  NEW.last_bonus_claim_at := OLD.last_bonus_claim_at;
  NEW.benefits_used_this_month := OLD.benefits_used_this_month;
  NEW.created_at := OLD.created_at;
  NEW.game_streak := OLD.game_streak;
  NEW.last_game_date := OLD.last_game_date;
  NEW.referred_by := OLD.referred_by;
  NEW.referral_converted_at := OLD.referral_converted_at;
  NEW.short_code := OLD.short_code;

  RETURN NEW;
END;
$$;
