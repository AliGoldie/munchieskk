-- Regression test for 20261029000001_db_hygiene.sql: helper functions get a
-- fixed search_path, trigger functions leave the public API but their
-- triggers still fire for signed-in users, the new indexes exist, and the
-- share_proofs read rule still lets owners and admins in (and nobody else).
--
-- Run via `npm run test:db`. Wrapped in one transaction that is rolled back.

BEGIN;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;

CREATE TABLE profiles (id uuid PRIMARY KEY, role text DEFAULT 'customer', points integer DEFAULT 0);
CREATE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$$;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;

-- The helper functions, as they are live.
CREATE FUNCTION public.arcade_game_cap() RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 5000 $$;
CREATE FUNCTION public.arcade_week_start() RETURNS timestamptz LANGUAGE sql STABLE AS
  $$ SELECT date_trunc('week', now() AT TIME ZONE 'Asia/Kuching') AT TIME ZONE 'Asia/Kuching' $$;
CREATE FUNCTION public.phone_is_usable(p_phone text) RETURNS boolean LANGUAGE sql IMMUTABLE AS
  $$ SELECT length(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g')) BETWEEN 9 AND 15 $$;

-- A SECURITY DEFINER trigger function standing in for the live ones: it
-- must keep firing for a signed-in user after EXECUTE is revoked.
CREATE TABLE orders (id text PRIMARY KEY, user_id uuid, status text, touched boolean DEFAULT false);
CREATE FUNCTION public.raise_top_tier_on_collect() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.touched := true; RETURN NEW; END $$;
CREATE TRIGGER trg_touch BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION public.raise_top_tier_on_collect();
GRANT SELECT, UPDATE ON orders TO authenticated;

CREATE TABLE share_proofs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, reviewed_by uuid);
ALTER TABLE share_proofs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners and admins read share proofs" ON share_proofs FOR SELECT
  USING ((auth.uid() = user_id) OR is_admin());
GRANT SELECT ON share_proofs TO authenticated;

INSERT INTO profiles (id, role) VALUES ('a0000000-0000-0000-0000-000000000001', 'admin'),
  ('c0000000-0000-0000-0000-000000000002', 'customer'), ('c0000000-0000-0000-0000-000000000003', 'customer');
INSERT INTO orders (id, user_id, status) VALUES ('O1', 'c0000000-0000-0000-0000-000000000002', 'READY');
INSERT INTO share_proofs (user_id) VALUES ('c0000000-0000-0000-0000-000000000002');

CREATE FUNCTION pg_temp.expect(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.expect(boolean, text) TO anon, authenticated;

\i supabase/migrations/20261029000001_db_hygiene.sql
-- run twice on purpose: the migration must be safe to repeat
\i supabase/migrations/20261029000001_db_hygiene.sql

SELECT pg_temp.expect((SELECT proconfig FROM pg_proc WHERE proname = 'phone_is_usable') = ARRAY['search_path=public'], 'phone_is_usable search_path pinned');
SELECT pg_temp.expect((SELECT proconfig FROM pg_proc WHERE proname = 'arcade_game_cap') = ARRAY['search_path=public'], 'arcade_game_cap search_path pinned');
SELECT pg_temp.expect(public.phone_is_usable('+60 12-345 6789') AND NOT public.phone_is_usable('123'), 'phone_is_usable still works');
SELECT pg_temp.expect(public.arcade_game_cap() = 5000, 'arcade_game_cap still works');

SELECT pg_temp.expect(NOT has_function_privilege('anon', 'public.raise_top_tier_on_collect()', 'EXECUTE'), 'anon cannot call trigger function');
SELECT pg_temp.expect(NOT has_function_privilege('authenticated', 'public.raise_top_tier_on_collect()', 'EXECUTE'), 'authenticated cannot call trigger function');

SELECT pg_temp.expect(to_regclass('public.idx_share_proofs_user_id') IS NOT NULL, 'share_proofs user_id index');
SELECT pg_temp.expect(to_regclass('public.idx_share_proofs_reviewed_by') IS NOT NULL, 'share_proofs reviewed_by index');

-- The trigger still fires when a signed-in user's update runs it.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000002', true);
UPDATE orders SET status = 'COLLECTED' WHERE id = 'O1';
SELECT pg_temp.expect((SELECT touched FROM orders WHERE id = 'O1'), 'trigger still fires after the revoke');

-- share_proofs: owner sees theirs, another customer sees nothing, admin sees all.
SELECT pg_temp.expect((SELECT count(*) FROM share_proofs) = 1, 'owner sees own proof');
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000003', true);
SELECT pg_temp.expect((SELECT count(*) FROM share_proofs) = 0, 'other customer sees none');
SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
SELECT pg_temp.expect((SELECT count(*) FROM share_proofs) = 1, 'admin sees all proofs');
RESET ROLE;

SELECT pg_temp.expect((SELECT qual FROM pg_policies WHERE policyname = 'Owners and admins read share proofs') LIKE '%SELECT auth.uid()%', 'policy uses (select auth.uid())');

DO $$ BEGIN RAISE NOTICE 'PASS: db hygiene assertions passed'; END $$;

ROLLBACK;
