-- "Launch profile v2" switch (Rewards Plan v2, 16 Oct 2026) with rollback.
--
-- NOTHING CHANGES WHEN THIS FILE IS RUN. It only adds the switch, stored OFF.
-- The owner decides when to turn it on (apply_launch_profile('v2')) and can
-- always go back (rollback_launch_profile()).
--
-- What v2 sets (all PROPOSED, not approved):
--   weekly arcade goal bonus   25 -> 10 points
--   Ice BB                    350 -> 250 points
--   Free Mushy2               800 -> 500 points
--   Free Kawan MONSTA platter 3000 -> 2000 points
--   (Free Cheese 50, Free Egg 60, Free Fries 100 are already at the plan values)
--   Regular RM200 -> RM100, Pro RM850 -> RM300, Master RM1500 -> RM600, Ultimate RM3000 -> RM1200
--   (rank bonuses stay +0 / +5 / +8 / +12 %, monthly claims per rank stay as they are)
--
-- Not covered here (these are features, built in later tasks): rank perks
-- (free cheese, birthday Ice BB, monthly egg, yearly platter).
--
-- How rollback works: when v2 is applied, the exact live values it is about to
-- overwrite are saved. Rollback puts those saved values back, so it restores
-- what was really live, not a guess. Reward prices only go DOWN under v2, so no
-- existing reward gets dearer.
--
-- These functions are for the SQL editor only (not callable from the website).
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS public.launch_profiles (
  name text PRIMARY KEY,
  config jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public.launch_profile_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  active_profile text NOT NULL DEFAULT 'current',
  applied_at timestamptz,
  snapshot jsonb
);
INSERT INTO public.launch_profile_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.launch_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.launch_profile_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.launch_profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.launch_profile_state FROM PUBLIC, anon, authenticated;

INSERT INTO public.launch_profiles (name, config) VALUES (
  'v2',
  '{
    "goal_points": 10,
    "prizes": {
      "Free Cheese":       {"points_cost": 50},
      "Free Egg":          {"points_cost": 60},
      "FREE FRIES":        {"points_cost": 100},
      "Ice BB":            {"points_cost": 250},
      "Free Mushy2":       {"points_cost": 500},
      "Free Kawan MONSTA": {"points_cost": 2000}
    },
    "tiers": {
      "Regular":  {"min_spend_cents": 10000},
      "Pro":      {"min_spend_cents": 30000},
      "Master":   {"min_spend_cents": 60000},
      "Ultimate": {"min_spend_cents": 120000}
    }
  }'::jsonb
) ON CONFLICT (name) DO NOTHING;

-- Live values the owner and the content team can read at any time.
CREATE OR REPLACE FUNCTION public.launch_profile_report()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'active_profile', (SELECT active_profile FROM public.launch_profile_state WHERE id),
    'applied_at', (SELECT applied_at FROM public.launch_profile_state WHERE id),
    'goal_points', (SELECT goal_points FROM public.arcade_settings WHERE id),
    'prizes', COALESCE((SELECT jsonb_object_agg(name, jsonb_build_object('points_cost', points_cost, 'min_order_cents', min_order_cents, 'active', is_active))
                        FROM public.loyalty_prizes WHERE is_active), '{}'::jsonb),
    'tiers', COALESCE((SELECT jsonb_object_agg(name, jsonb_build_object('min_spend_cents', min_spend_cents, 'bonus_percent', bonus_percent, 'claims_per_month', claims_per_month))
                       FROM public.loyalty_tiers), '{}'::jsonb)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.launch_profile_report() FROM PUBLIC, anon, authenticated;

-- Turn a profile on. Saves the live values it overwrites (first time only).
CREATE OR REPLACE FUNCTION public.apply_launch_profile(p_profile text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg jsonb;
  v_snap jsonb;
  v_active text;
  k text;
  v jsonb;
BEGIN
  SELECT config INTO v_cfg FROM public.launch_profiles WHERE name = p_profile;
  IF v_cfg IS NULL THEN
    RAISE EXCEPTION 'Unknown launch profile "%".', p_profile;
  END IF;
  SELECT active_profile INTO v_active FROM public.launch_profile_state WHERE id FOR UPDATE;

  -- Save what is live right now, but only if we are not already on a profile
  -- (so a second apply never overwrites the real original values).
  IF v_active = 'current' THEN
    v_snap := jsonb_build_object(
      'goal_points', (SELECT goal_points FROM public.arcade_settings WHERE id),
      'prizes', COALESCE((SELECT jsonb_object_agg(name, jsonb_build_object('points_cost', points_cost))
                          FROM public.loyalty_prizes WHERE name IN (SELECT jsonb_object_keys(v_cfg->'prizes'))), '{}'::jsonb),
      'tiers', COALESCE((SELECT jsonb_object_agg(name, jsonb_build_object('min_spend_cents', min_spend_cents))
                         FROM public.loyalty_tiers WHERE name IN (SELECT jsonb_object_keys(v_cfg->'tiers'))), '{}'::jsonb));
    UPDATE public.launch_profile_state SET snapshot = v_snap WHERE id;
  END IF;

  IF v_cfg ? 'goal_points' THEN
    UPDATE public.arcade_settings SET goal_points = (v_cfg->>'goal_points')::integer WHERE id;
  END IF;
  FOR k, v IN SELECT * FROM jsonb_each(COALESCE(v_cfg->'prizes', '{}'::jsonb)) LOOP
    UPDATE public.loyalty_prizes SET points_cost = (v->>'points_cost')::integer WHERE name = k;
  END LOOP;
  FOR k, v IN SELECT * FROM jsonb_each(COALESCE(v_cfg->'tiers', '{}'::jsonb)) LOOP
    UPDATE public.loyalty_tiers SET min_spend_cents = (v->>'min_spend_cents')::integer WHERE name = k;
  END LOOP;

  UPDATE public.launch_profile_state SET active_profile = p_profile, applied_at = now() WHERE id;
  RETURN public.launch_profile_report();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_launch_profile(text) FROM PUBLIC, anon, authenticated;

-- Put back exactly what was live before the profile was applied.
CREATE OR REPLACE FUNCTION public.rollback_launch_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_snap jsonb;
  v_active text;
  k text;
  v jsonb;
BEGIN
  SELECT active_profile, snapshot INTO v_active, v_snap FROM public.launch_profile_state WHERE id FOR UPDATE;
  IF v_active = 'current' OR v_snap IS NULL THEN
    RAISE EXCEPTION 'No launch profile is applied, so there is nothing to roll back.';
  END IF;

  UPDATE public.arcade_settings SET goal_points = (v_snap->>'goal_points')::integer WHERE id;
  FOR k, v IN SELECT * FROM jsonb_each(COALESCE(v_snap->'prizes', '{}'::jsonb)) LOOP
    UPDATE public.loyalty_prizes SET points_cost = (v->>'points_cost')::integer WHERE name = k;
  END LOOP;
  FOR k, v IN SELECT * FROM jsonb_each(COALESCE(v_snap->'tiers', '{}'::jsonb)) LOOP
    UPDATE public.loyalty_tiers SET min_spend_cents = (v->>'min_spend_cents')::integer WHERE name = k;
  END LOOP;

  UPDATE public.launch_profile_state SET active_profile = 'current', applied_at = now(), snapshot = NULL WHERE id;
  RETURN public.launch_profile_report();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rollback_launch_profile() FROM PUBLIC, anon, authenticated;
