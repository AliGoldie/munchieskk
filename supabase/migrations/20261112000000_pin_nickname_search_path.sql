-- Pins the search_path of nickname_normalize (the Supabase security advisor
-- flagged it as "mutable"). It only uses built-in functions, so behaviour does
-- not change. Safe to run twice; does nothing if the function does not exist.
DO $$
BEGIN
  IF to_regprocedure('public.nickname_normalize(text)') IS NOT NULL THEN
    ALTER FUNCTION public.nickname_normalize(text) SET search_path = public, pg_temp;
  END IF;
END $$;
