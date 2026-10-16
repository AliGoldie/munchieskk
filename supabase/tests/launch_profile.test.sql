-- Regression test for 20261022000000_launch_profile_v2.sql:
-- the switch starts OFF, applying v2 sets only the planned values, applying
-- twice keeps the real original values, rollback restores them exactly, and
-- nobody but the SQL editor (postgres) can call the functions.
--
-- Run via `npm run test:db`. Wrapped in one transaction that is rolled back.

BEGIN;

CREATE TABLE arcade_settings (id boolean PRIMARY KEY DEFAULT true, goal_score integer NOT NULL DEFAULT 1000, goal_points integer NOT NULL DEFAULT 25);
INSERT INTO arcade_settings (id) VALUES (true);

CREATE TABLE loyalty_prizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  points_cost integer NOT NULL,
  min_order_cents integer NOT NULL DEFAULT 2000,
  is_active boolean NOT NULL DEFAULT true
);
INSERT INTO loyalty_prizes (name, points_cost, min_order_cents, is_active) VALUES
  ('Free Cheese', 50, 2000, true), ('Free Egg', 60, 2000, true), ('FREE FRIES', 100, 2000, true),
  ('Ice BB', 350, 2000, true), ('Free Mushy2', 800, 2000, true), ('Free Kawan MONSTA', 3000, 3000, true),
  ('MUSHY', 500, 2000, false);

CREATE TABLE loyalty_tiers (
  name text PRIMARY KEY, sort_order integer NOT NULL UNIQUE, min_spend_cents integer NOT NULL,
  claims_per_month integer NOT NULL, bonus_percent integer NOT NULL DEFAULT 0
);
INSERT INTO loyalty_tiers VALUES
  ('Rookie', 1, 0, 1, 0), ('Regular', 2, 20000, 2, 0), ('Pro', 3, 85000, 3, 5),
  ('Master', 4, 150000, 4, 8), ('Ultimate', 5, 300000, 5, 12);

\i supabase/migrations/20261022000000_launch_profile_v2.sql
-- run twice on purpose: the migration must be safe to repeat
\i supabase/migrations/20261022000000_launch_profile_v2.sql

CREATE FUNCTION pg_temp.expect(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; END $$;
CREATE FUNCTION pg_temp.expect_error(p_sql text, p_expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE p_expected || '%' THEN
      RAISE EXCEPTION 'FAIL: expected error "%" but got "%"', p_expected, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: expected error "%" but the call succeeded', p_expected;
END $$;
CREATE FUNCTION pg_temp.cost(p_name text) RETURNS integer LANGUAGE sql AS $$ SELECT points_cost FROM loyalty_prizes WHERE name = p_name $$;
CREATE FUNCTION pg_temp.spend(p_name text) RETURNS integer LANGUAGE sql AS $$ SELECT min_spend_cents FROM loyalty_tiers WHERE name = p_name $$;

-- 1. Installing the switch changes nothing
DO $$
BEGIN
  PERFORM pg_temp.expect((SELECT active_profile FROM launch_profile_state) = 'current', 'switch starts off');
  PERFORM pg_temp.expect((SELECT goal_points FROM arcade_settings) = 25, 'goal bonus untouched');
  PERFORM pg_temp.expect(pg_temp.cost('Ice BB') = 350 AND pg_temp.cost('Free Mushy2') = 800 AND pg_temp.cost('Free Kawan MONSTA') = 3000, 'prices untouched');
  PERFORM pg_temp.expect(pg_temp.spend('Regular') = 20000 AND pg_temp.spend('Ultimate') = 300000, 'ranks untouched');
  PERFORM pg_temp.expect_error($q$SELECT public.rollback_launch_profile()$q$, 'No launch profile is applied');
  PERFORM pg_temp.expect_error($q$SELECT public.apply_launch_profile('v9')$q$, 'Unknown launch profile');
END $$;

-- 2. Apply v2
DO $$
DECLARE r jsonb;
BEGIN
  r := public.apply_launch_profile('v2');
  PERFORM pg_temp.expect((SELECT active_profile FROM launch_profile_state) = 'v2', 'v2 is active');
  PERFORM pg_temp.expect((SELECT goal_points FROM arcade_settings) = 10, 'weekly goal is 10');
  PERFORM pg_temp.expect(pg_temp.cost('Free Cheese') = 50 AND pg_temp.cost('Free Egg') = 60 AND pg_temp.cost('FREE FRIES') = 100, 'cheese, egg, fries unchanged');
  PERFORM pg_temp.expect(pg_temp.cost('Ice BB') = 250 AND pg_temp.cost('Free Mushy2') = 500 AND pg_temp.cost('Free Kawan MONSTA') = 2000, 'new prices set');
  PERFORM pg_temp.expect(pg_temp.spend('Rookie') = 0 AND pg_temp.spend('Regular') = 10000 AND pg_temp.spend('Pro') = 30000 AND pg_temp.spend('Master') = 60000 AND pg_temp.spend('Ultimate') = 120000, 'rank thresholds set');
  PERFORM pg_temp.expect((SELECT bonus_percent FROM loyalty_tiers WHERE name = 'Ultimate') = 12 AND (SELECT claims_per_month FROM loyalty_tiers WHERE name = 'Pro') = 3, 'rank bonus and monthly claims unchanged');
  PERFORM pg_temp.expect((SELECT min_order_cents FROM loyalty_prizes WHERE name = 'Free Kawan MONSTA') = 3000 AND (SELECT min_order_cents FROM loyalty_prizes WHERE name = 'Ice BB') = 2000, 'order minimums unchanged');
  PERFORM pg_temp.expect(pg_temp.cost('MUSHY') = 500 AND NOT (SELECT is_active FROM loyalty_prizes WHERE name = 'MUSHY'), 'inactive prizes untouched');
  PERFORM pg_temp.expect((r->>'active_profile') = 'v2' AND (r->>'goal_points')::int = 10, 'the report shows the live values');
  PERFORM pg_temp.expect(NOT (r->'prizes' ? 'MUSHY'), 'the report lists active prizes only');
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM loyalty_prizes p JOIN launch_profile_state s ON true
                                     WHERE p.name IN ('Ice BB','Free Mushy2','Free Kawan MONSTA') AND p.points_cost > (s.snapshot->'prizes'->p.name->>'points_cost')::int),
                         'no reward got dearer');
END $$;

-- 3. Applying again must not overwrite the saved original values
DO $$
BEGIN
  PERFORM public.apply_launch_profile('v2');
  PERFORM pg_temp.expect((SELECT snapshot->'prizes'->'Ice BB'->>'points_cost' FROM launch_profile_state) = '350', 'second apply keeps the true original');
END $$;

-- 4. Rollback restores exactly what was live before
DO $$
DECLARE r jsonb;
BEGIN
  r := public.rollback_launch_profile();
  PERFORM pg_temp.expect((SELECT active_profile FROM launch_profile_state) = 'current' AND (SELECT snapshot FROM launch_profile_state) IS NULL, 'back to current');
  PERFORM pg_temp.expect((SELECT goal_points FROM arcade_settings) = 25, 'goal back to 25');
  PERFORM pg_temp.expect(pg_temp.cost('Ice BB') = 350 AND pg_temp.cost('Free Mushy2') = 800 AND pg_temp.cost('Free Kawan MONSTA') = 3000, 'prices back');
  PERFORM pg_temp.expect(pg_temp.spend('Regular') = 20000 AND pg_temp.spend('Pro') = 85000 AND pg_temp.spend('Master') = 150000 AND pg_temp.spend('Ultimate') = 300000, 'ranks back');
  PERFORM pg_temp.expect((r->>'active_profile') = 'current', 'report says current');
  PERFORM pg_temp.expect_error($q$SELECT public.rollback_launch_profile()$q$, 'No launch profile is applied');
END $$;

-- 5. A value changed by the owner before applying is what rollback restores
DO $$
BEGIN
  UPDATE loyalty_prizes SET points_cost = 400 WHERE name = 'Ice BB';
  PERFORM public.apply_launch_profile('v2');
  PERFORM public.rollback_launch_profile();
  PERFORM pg_temp.expect(pg_temp.cost('Ice BB') = 400, 'rollback restores the real live value, not a default');
END $$;

-- 6. Privileges: SQL editor only
DO $$
BEGIN
  PERFORM pg_temp.expect(NOT has_function_privilege('anon', 'public.apply_launch_profile(text)', 'execute'), 'guests cannot apply');
  PERFORM pg_temp.expect(NOT has_function_privilege('authenticated', 'public.apply_launch_profile(text)', 'execute'), 'customers cannot apply');
  PERFORM pg_temp.expect(NOT has_function_privilege('authenticated', 'public.rollback_launch_profile()', 'execute'), 'customers cannot roll back');
  PERFORM pg_temp.expect(NOT has_function_privilege('authenticated', 'public.launch_profile_report()', 'execute'), 'customers cannot read the report');
  PERFORM pg_temp.expect(NOT has_table_privilege('authenticated', 'public.launch_profile_state', 'select'), 'customers cannot read the saved values');
END $$;

DO $$ BEGIN RAISE NOTICE 'PASS: launch profile assertions passed'; END $$;

ROLLBACK;
