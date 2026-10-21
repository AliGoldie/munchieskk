-- Regression test for 20261029000002_scheduled_reward_price.sql: a reward's
-- price can be scheduled only downwards and with 30 days' notice, and the
-- switch happens on the date and never raises a price.
--
-- Run via `npm run test:db`. Wrapped in one transaction that is rolled back.

BEGIN;

CREATE TABLE loyalty_prizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  points_cost integer,
  perk_rank_order integer,
  is_active boolean DEFAULT true
);
GRANT SELECT ON loyalty_prizes TO anon, authenticated;

INSERT INTO loyalty_prizes (id, name, points_cost) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Ice BB', 350),
  ('22222222-2222-2222-2222-222222222222', 'Free Mushy2', 800);
INSERT INTO loyalty_prizes (id, name, points_cost, perk_rank_order) VALUES
  ('33333333-3333-3333-3333-333333333333', 'Pro perk', 0, 3);

\i supabase/migrations/20261029000002_scheduled_reward_price.sql
-- run twice on purpose: the migration must be safe to repeat
\i supabase/migrations/20261029000002_scheduled_reward_price.sql

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

CREATE FUNCTION pg_temp.kk_today() RETURNS date LANGUAGE sql AS $$ SELECT (now() AT TIME ZONE 'Asia/Kuching')::date $$;

-- Refused: a higher or equal price, too little notice, half a schedule, a rank perk.
SELECT pg_temp.expect_error(format($q$UPDATE loyalty_prizes SET new_points_cost = 400, new_cost_from = %L WHERE name = 'Ice BB'$q$, pg_temp.kk_today() + 40),
  'The new price must be lower');
SELECT pg_temp.expect_error(format($q$UPDATE loyalty_prizes SET new_points_cost = 350, new_cost_from = %L WHERE name = 'Ice BB'$q$, pg_temp.kk_today() + 40),
  'The new price must be lower');
SELECT pg_temp.expect_error(format($q$UPDATE loyalty_prizes SET new_points_cost = 250, new_cost_from = %L WHERE name = 'Ice BB'$q$, pg_temp.kk_today() + 29),
  'Give customers at least 30 days notice');
SELECT pg_temp.expect_error($q$UPDATE loyalty_prizes SET new_points_cost = 250 WHERE name = 'Ice BB'$q$,
  'new row for relation "loyalty_prizes" violates check constraint');
SELECT pg_temp.expect_error(format($q$UPDATE loyalty_prizes SET new_points_cost = 1, new_cost_from = %L WHERE name = 'Pro perk'$q$, pg_temp.kk_today() + 40),
  'Rank perks are free');

-- Accepted: a price cut with exactly 30 days' notice.
UPDATE loyalty_prizes SET new_points_cost = 250, new_cost_from = pg_temp.kk_today() + 30 WHERE name = 'Ice BB';
SELECT pg_temp.expect((SELECT new_points_cost FROM loyalty_prizes WHERE name = 'Ice BB') = 250, 'schedule saved');

-- Editing something else on a scheduled reward is not re-checked.
UPDATE loyalty_prizes SET name = 'Ice BB' WHERE name = 'Ice BB';

-- Before the date nothing changes.
SELECT pg_temp.expect(public.apply_due_reward_prices() = 0, 'nothing due yet');
SELECT pg_temp.expect((SELECT points_cost FROM loyalty_prizes WHERE name = 'Ice BB') = 350, 'old price kept before the date');

-- On the date the new price takes over and the schedule clears. (The date is
-- moved into the past directly, as if 30 days had gone by.)
ALTER TABLE loyalty_prizes DISABLE TRIGGER trg_check_scheduled_reward_price;
UPDATE loyalty_prizes SET new_cost_from = pg_temp.kk_today() WHERE name = 'Ice BB';
-- Mushy2: scheduled to 500, then lowered by hand to 400 before the date.
UPDATE loyalty_prizes SET new_points_cost = 500, new_cost_from = pg_temp.kk_today() - 1, points_cost = 400 WHERE name = 'Free Mushy2';
ALTER TABLE loyalty_prizes ENABLE TRIGGER trg_check_scheduled_reward_price;

-- A guest can run the switch (the app does on load); it only applies what is due.
SET LOCAL ROLE anon;
SELECT pg_temp.expect(public.apply_due_reward_prices() = 2, 'two schedules due');
RESET ROLE;
SELECT pg_temp.expect((SELECT points_cost FROM loyalty_prizes WHERE name = 'Ice BB') = 250, 'new price applied on the date');
SELECT pg_temp.expect((SELECT new_points_cost IS NULL AND new_cost_from IS NULL FROM loyalty_prizes WHERE name = 'Ice BB'), 'schedule cleared');
SELECT pg_temp.expect((SELECT points_cost FROM loyalty_prizes WHERE name = 'Free Mushy2') = 400, 'never raises a price');
SELECT pg_temp.expect(public.apply_due_reward_prices() = 0, 'running it again changes nothing');

-- A schedule can be cancelled.
UPDATE loyalty_prizes SET new_points_cost = 200, new_cost_from = pg_temp.kk_today() + 31 WHERE name = 'Ice BB';
UPDATE loyalty_prizes SET new_points_cost = NULL, new_cost_from = NULL WHERE name = 'Ice BB';
SELECT pg_temp.expect((SELECT points_cost FROM loyalty_prizes WHERE name = 'Ice BB') = 250, 'cancel keeps the price');

-- Customers cannot call the trigger function directly.
SELECT pg_temp.expect(NOT has_function_privilege('anon', 'public.check_scheduled_reward_price()', 'EXECUTE'), 'trigger function not callable');

DO $$ BEGIN RAISE NOTICE 'PASS: scheduled reward price assertions passed'; END $$;

ROLLBACK;
