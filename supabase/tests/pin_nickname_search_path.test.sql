-- Regression test for 20261112000000_pin_nickname_search_path.sql.
-- Run via `npm run test:db`. One transaction, rolled back.
BEGIN;

CREATE FUNCTION public.nickname_normalize(p_text text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(translate(lower(COALESCE(p_text, '')), '0134578@$!', 'oieastbasi'), '[^a-z]', '', 'g');
$$;

\i supabase/migrations/20261112000000_pin_nickname_search_path.sql
\i supabase/migrations/20261112000000_pin_nickname_search_path.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'nickname_normalize'
                 AND proconfig::text LIKE '%search_path=public, pg_temp%') THEN
    RAISE EXCEPTION 'FAIL: search_path not pinned';
  END IF;
  IF public.nickname_normalize('H3LL0 W0rld!') IS DISTINCT FROM 'helloworldi' THEN
    RAISE EXCEPTION 'FAIL: behaviour changed (got %)', public.nickname_normalize('H3LL0 W0rld!');
  END IF;
  RAISE NOTICE 'PASS: nickname search_path assertions passed';
END $$;

ROLLBACK;
