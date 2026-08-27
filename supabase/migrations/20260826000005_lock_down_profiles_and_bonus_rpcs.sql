-- Three critical fixes found by direct live-database inspection, all
-- independently exploitable for unlimited/arbitrary loyalty points:
--
-- 1. `profiles` UPDATE policy (from 20260803_admin_roles.sql) has no
--    WITH CHECK, so any logged-in user can currently do
--    `supabase.from('profiles').update({points: 999999, role: 'admin'})`
--    directly from devtools — self-promote to admin AND set arbitrary points.
--    This has been the root cause undermining every other points-related fix
--    shipped this session; verified live via pg_policies.
--
-- 2. `claim_share_bonus(amount_param, user_id_param)` has NO auth check and
--    NO amount bound at all — verified live: calling it with an arbitrary
--    amount for any user_id awarded +999,999 points in one call.
--
-- 3. `claim_munchman_reward` correctly uses auth.uid() and hardcodes point
--    amounts, but has zero connection to the daily-play tracking in
--    start_munchman_session — verified live: called 3x in a row awarded the
--    win bonus 3x with no real gameplay in between.
--
-- Fix 1 uses `current_user = 'postgres'` (not is_admin()) to distinguish a
-- write coming from inside a SECURITY DEFINER function (all owned by
-- postgres — verified: award_points, claim_munchman_reward, claim_share_bonus,
-- handle_new_user, handle_order_collected, handle_order_placed, place_order,
-- start_munchman_session) from a raw client REST call (always anon/authenticated,
-- never postgres). Without this distinction, a naive "block non-admin writes"
-- trigger would also break every legitimate server-side points award.

-- --- Fix 1: profiles ---
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id OR public.is_admin())
  WITH CHECK (auth.uid() = id OR public.is_admin());

CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow: admin self-service via the dashboard/admin panel, and any write
  -- happening inside a trusted SECURITY DEFINER function (all owned by
  -- postgres in this project).
  IF current_user = 'postgres' OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- Everything else is a direct client write (PostgREST always runs as
  -- anon/authenticated). Allowlist name/phone/address (the only fields
  -- Profile.jsx's self-edit ever sets) — pin every other column back to its
  -- current value regardless of what the client sends.
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

DROP TRIGGER IF EXISTS trg_protect_profile_privileged_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_privileged_columns
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_privileged_columns();

-- --- Fix 2: claim_share_bonus ---
-- Keep the signature (amount_param, user_id_param) for client compatibility,
-- but ignore amount_param entirely and require auth.uid() = user_id_param.
CREATE OR REPLACE FUNCTION public.claim_share_bonus(amount_param integer, user_id_param uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> user_id_param THEN
    RAISE EXCEPTION 'permission denied: cannot claim share bonus for another user';
  END IF;

  -- Fixed server-side amount, matching src/config/loyaltyConfig.js
  -- REVIEW_BONUS_PTS — the client's amount_param is intentionally unused.
  UPDATE public.profiles
  SET points = COALESCE(points, 0) + 30
  WHERE id = user_id_param;
END;
$$;

-- --- Fix 3: claim_munchman_reward ---
-- Require an unclaimed game_plays row from today (only created by
-- start_munchman_session, which already enforces one play per day) before
-- any reward can be paid, and mark it claimed atomically so repeat calls
-- for the same session fail.
ALTER TABLE public.game_plays ADD COLUMN IF NOT EXISTS reward_claimed boolean DEFAULT false;

CREATE OR REPLACE FUNCTION public.claim_munchman_reward(p_won boolean, p_dots_eaten integer, p_total_dots integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID;
  v_points_awarded INT := 0;
  v_new_total INT := 0;
  v_msg TEXT := '';
  v_play_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be logged in to claim rewards.';
  END IF;

  SELECT id INTO v_play_id
  FROM public.game_plays
  WHERE user_id = v_user_id
    AND game_name = 'munch_man'
    AND (played_at AT TIME ZONE 'UTC')::DATE = CURRENT_DATE
    AND reward_claimed = false
  ORDER BY played_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_play_id IS NULL THEN
    RAISE EXCEPTION 'No unclaimed game session found for today.';
  END IF;

  UPDATE public.game_plays SET reward_claimed = true WHERE id = v_play_id;

  IF p_won THEN
    v_points_awarded := 50;
    v_msg := '+50 Loyalty Points Earned for Victory!';
  ELSIF p_total_dots > 0 AND (p_dots_eaten::FLOAT / p_total_dots::FLOAT) >= 0.5 THEN
    v_points_awarded := 20;
    v_msg := '+20 Loyalty Points Earned for Progress!';
  ELSE
    v_points_awarded := 0;
    v_msg := 'No reward points earned this round.';
  END IF;

  IF v_points_awarded > 0 THEN
    UPDATE public.profiles
    SET points = COALESCE(points, 0) + v_points_awarded
    WHERE id = v_user_id
    RETURNING points INTO v_new_total;
  ELSE
    SELECT COALESCE(points, 0) INTO v_new_total FROM public.profiles WHERE id = v_user_id;
  END IF;

  RETURN jsonb_build_object(
    'points_awarded', v_points_awarded,
    'total_points', v_new_total,
    'message', v_msg
  );
END;
$$;
