-- Regression test for validate_and_apply_promo() min-spend enforcement
-- (see supabase/migrations/20260903000000_enforce_promo_min_spend.sql).
--
-- Run via `npm run test:db` (supabase/tests/run-db-tests.sh), which always
-- points this at a disposable, freshly-created database -- never a real
-- project database. Everything here is also wrapped in one transaction
-- that's rolled back at the end, so even a stray direct `psql -f` run
-- against a real database leaves no trace.

BEGIN;

CREATE TABLE promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text,
  type text DEFAULT 'percent_off' NOT NULL,
  value integer NOT NULL DEFAULT 0,
  applies_to_item_id text,
  min_spend integer,
  free_item_id text,
  usage_count integer NOT NULL DEFAULT 0,
  max_total_uses integer,
  max_uses_per_user integer,
  active boolean DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  stackable_with_item_promos boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE promo_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id uuid,
  order_id text,
  user_id uuid,
  discount_amount integer,
  redeemed_at timestamptz DEFAULT now()
);

CREATE TABLE menu_items (id text PRIMARY KEY, name text);

-- Loads the real, shipped function -- this test exercises actual
-- production code, not a copy that can drift from it.
\i supabase/migrations/20260903000000_enforce_promo_min_spend.sql

INSERT INTO promo_codes (code, type, value, min_spend, active) VALUES
  ('TEST_SUMMER20', 'percent_off', 20, 5000, true),   -- 20% off, min spend RM50
  ('TEST_FLAT5', 'flat_off', 500, 3000, true),        -- RM5 off, min spend RM30
  ('TEST_NOFLOOR', 'percent_off', 10, NULL, true),    -- 10% off, no min spend
  ('TEST_FREEDRINK', 'spend_threshold_free_item', 0, 5000, true);

INSERT INTO menu_items (id, name) VALUES ('drink1', 'Iced Tea');
UPDATE promo_codes SET free_item_id = 'drink1' WHERE code = 'TEST_FREEDRINK';

DO $$
DECLARE
  result jsonb;
BEGIN
  result := validate_and_apply_promo('TEST_SUMMER20', 500, NULL, '[]'::jsonb);
  IF (result->>'valid')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL: SUMMER20 on RM5 order should be rejected (below RM50 min), got: %', result;
  END IF;

  result := validate_and_apply_promo('TEST_SUMMER20', 6000, NULL, '[]'::jsonb);
  IF (result->>'valid')::boolean IS DISTINCT FROM true OR (result->>'discount_cents')::integer IS DISTINCT FROM 1200 THEN
    RAISE EXCEPTION 'FAIL: SUMMER20 on RM60 order should discount RM12, got: %', result;
  END IF;

  result := validate_and_apply_promo('TEST_FLAT5', 1000, NULL, '[]'::jsonb);
  IF (result->>'valid')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL: FLAT5 on RM10 order should be rejected (below RM30 min), got: %', result;
  END IF;

  result := validate_and_apply_promo('TEST_FLAT5', 3500, NULL, '[]'::jsonb);
  IF (result->>'valid')::boolean IS DISTINCT FROM true OR (result->>'discount_cents')::integer IS DISTINCT FROM 500 THEN
    RAISE EXCEPTION 'FAIL: FLAT5 on RM35 order should discount RM5, got: %', result;
  END IF;

  result := validate_and_apply_promo('TEST_NOFLOOR', 100, NULL, '[]'::jsonb);
  IF (result->>'valid')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: NOFLOOR (no min_spend set) on RM1 order should still be accepted, got: %', result;
  END IF;

  result := validate_and_apply_promo('TEST_FREEDRINK', 1000, NULL, '[]'::jsonb);
  IF (result->>'valid')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL: FREEDRINK on RM10 order should be rejected (below RM50 min), got: %', result;
  END IF;

  result := validate_and_apply_promo('TEST_FREEDRINK', 6000, NULL, '[]'::jsonb);
  IF (result->>'valid')::boolean IS DISTINCT FROM true OR (result->>'free_item_id') IS DISTINCT FROM 'drink1' THEN
    RAISE EXCEPTION 'FAIL: FREEDRINK on RM60 order should grant the free item, got: %', result;
  END IF;

  RAISE NOTICE 'PASS: all promo min-spend assertions passed';
END $$;

ROLLBACK;
