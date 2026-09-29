-- Regression test for the pre-launch fix in
-- supabase/migrations/20260929000003_switch_order_points_to_rm1_equals_1pt.sql:
-- order-placement points must be RM1 = 1 point off the order's actual
-- total, rounded, accumulating correctly across multiple orders, and
-- skipped entirely for guest orders (no user_id).
--
-- Run via `npm run test:db` (supabase/tests/run-db-tests.sh), against a
-- disposable, freshly-created database -- never a real project database.
-- Wrapped in one transaction rolled back at the end.

BEGIN;

CREATE TABLE profiles (
  id uuid PRIMARY KEY,
  points integer DEFAULT 0
);

CREATE TABLE orders (
  id text PRIMARY KEY,
  user_id uuid,
  total integer,
  created_at timestamptz DEFAULT now()
);

-- Loads the real, shipped function -- this test exercises actual
-- production code, not a copy that can drift from it.
\i supabase/migrations/20260929000003_switch_order_points_to_rm1_equals_1pt.sql

CREATE TRIGGER trg_order_placed_award_points
AFTER INSERT ON orders
FOR EACH ROW
EXECUTE FUNCTION public.handle_order_placed();

INSERT INTO profiles (id, points) VALUES ('11111111-1111-1111-1111-111111111111', 0);

DO $$
DECLARE
  v_points integer;
BEGIN
  -- RM15.90 order -> rounds to 16 points
  INSERT INTO orders (id, user_id, total) VALUES ('O1', '11111111-1111-1111-1111-111111111111', 1590);
  SELECT points INTO v_points FROM profiles WHERE id = '11111111-1111-1111-1111-111111111111';
  IF v_points <> 16 THEN
    RAISE EXCEPTION 'FAIL: RM15.90 order should earn 16 points (rounded), got %', v_points;
  END IF;

  -- A second order accumulates on top, doesn't overwrite
  INSERT INTO orders (id, user_id, total) VALUES ('O2', '11111111-1111-1111-1111-111111111111', 350);
  SELECT points INTO v_points FROM profiles WHERE id = '11111111-1111-1111-1111-111111111111';
  IF v_points <> 20 THEN
    RAISE EXCEPTION 'FAIL: expected 16 + round(RM3.50) = 20 points after a second order, got %', v_points;
  END IF;

  -- Guest orders (no account) must not error and must not credit anyone
  INSERT INTO orders (id, user_id, total) VALUES ('O3', NULL, 5000);
  SELECT points INTO v_points FROM profiles WHERE id = '11111111-1111-1111-1111-111111111111';
  IF v_points <> 20 THEN
    RAISE EXCEPTION 'FAIL: a guest order must not change any profile''s points, got %', v_points;
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'PASS: RM1=1pt order-placement points assertions passed'; END $$;

ROLLBACK;
