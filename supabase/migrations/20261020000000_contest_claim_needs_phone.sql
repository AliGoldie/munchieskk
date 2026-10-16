-- Phone number required to claim an arcade contest prize.
--
-- Decision (owner): sign-up keeps the phone optional, but a winner must have a
-- phone number on the account before the claim code is shown, and before staff
-- can mark the prize claimed. This lets us contact winners.
--
--   * phone_is_usable(text): 9 to 15 digits once spaces, dashes and + are removed.
--   * save_my_phone(text): the winner saves their number (validated, own profile only).
--   * arcade_contest_status(): a winner without a usable phone gets
--     needs_phone = true and NO claim_code (the code never reaches the browser).
--   * admin_mark_arcade_claimed(): refuses if the winner has no usable phone.
--
-- Safe to run more than once.

CREATE OR REPLACE FUNCTION public.phone_is_usable(p_phone text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT length(regexp_replace(COALESCE(p_phone, ''), 'D', '', 'g')) BETWEEN 9 AND 15;
$$;
REVOKE EXECUTE ON FUNCTION public.phone_is_usable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.phone_is_usable(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_my_phone(p_phone text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone text := trim(COALESCE(p_phone, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User must be logged in.';
  END IF;
  IF v_phone !~ '^[0-9+() -]+$' OR NOT public.phone_is_usable(v_phone) THEN
    RAISE EXCEPTION 'Please enter a valid phone number.';
  END IF;
  UPDATE public.profiles SET phone = v_phone WHERE id = auth.uid();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_my_phone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_phone(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.arcade_contest_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  cur record;
  nxt record;
  lst record;
  me record;
  v_prizes jsonb := '[]'::jsonb;
  v_next_prizes jsonb := '[]'::jsonb;
  v_last_winners jsonb := '[]'::jsonb;
  v_my_wins jsonb := '[]'::jsonb;
  v_has_phone boolean := false;
  v_third integer;
  v_first integer;
  v_goal integer;
  v_goal_points integer;
  v_week integer := 0;
  v_goal_done boolean := false;
  v_current jsonb;
  v_next jsonb;
  v_last jsonb;
  v_my jsonb;
BEGIN
  PERFORM public.finalize_arcade_contests();
  SELECT goal_score, goal_points INTO v_goal, v_goal_points FROM public.arcade_settings WHERE id;

  SELECT * INTO cur FROM public.arcade_contests
  WHERE active AND starts_at <= now() AND ends_at > now()
  ORDER BY ends_at LIMIT 1;
  SELECT * INTO nxt FROM public.arcade_contests
  WHERE active AND starts_at > now()
  ORDER BY starts_at LIMIT 1;
  SELECT * INTO lst FROM public.arcade_contests
  WHERE active AND finalized_at IS NOT NULL AND ends_at > now() - interval '30 days'
  ORDER BY ends_at DESC LIMIT 1;

  IF cur.id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('rank', z.rank, 'name', z.prize_name, 'image_url', z.image_url) ORDER BY z.rank), '[]'::jsonb)
    INTO v_prizes FROM public.arcade_contest_prizes z WHERE z.contest_id = cur.id;
    SELECT rk.total INTO v_first FROM public.arcade_contest_ranking(cur.id, true) rk WHERE rk.rnk = 1;
    SELECT rk.total INTO v_third FROM public.arcade_contest_ranking(cur.id, true) rk WHERE rk.rnk = 3;
    v_current := jsonb_build_object('id', cur.id, 'title', cur.title, 'starts_at', cur.starts_at,
                                    'ends_at', cur.ends_at, 'min_score', cur.min_score,
                                    'claim_min_order_cents', cur.claim_min_order_cents, 'prizes', v_prizes);
  END IF;

  IF nxt.id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('rank', z.rank, 'name', z.prize_name, 'image_url', z.image_url) ORDER BY z.rank), '[]'::jsonb)
    INTO v_next_prizes FROM public.arcade_contest_prizes z WHERE z.contest_id = nxt.id;
    v_next := jsonb_build_object('title', nxt.title, 'starts_at', nxt.starts_at, 'ends_at', nxt.ends_at,
                                 'claim_min_order_cents', nxt.claim_min_order_cents, 'prizes', v_next_prizes);
  END IF;

  IF lst.id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('rank', w.rank, 'first_name', COALESCE(w.first_name, 'Player'),
                                                 'prize', z.prize_name) ORDER BY w.rank), '[]'::jsonb)
    INTO v_last_winners
    FROM public.arcade_contest_winners w
    LEFT JOIN public.arcade_contest_prizes z ON z.contest_id = w.contest_id AND z.rank = w.rank
    WHERE w.contest_id = lst.id;
    v_last := jsonb_build_object('title', lst.title, 'ended_at', lst.ends_at, 'winners', v_last_winners);
  END IF;

  IF v_uid IS NOT NULL THEN
    v_week := public.arcade_week_score(v_uid);
    v_goal_done := EXISTS (
      SELECT 1 FROM public.arcade_goal_awards
      WHERE user_id = v_uid AND week_start = (public.arcade_week_start() AT TIME ZONE 'Asia/Kuching')::date
    );
    IF cur.id IS NOT NULL THEN
      SELECT rk.rnk, rk.total, rk.trex, rk.grab, rk.munch INTO me
      FROM public.arcade_contest_ranking(cur.id, true) rk WHERE rk.user_id = v_uid;
      v_my := jsonb_build_object(
        'rank', me.rnk,
        'total', COALESCE(me.total, 0),
        'trex', COALESCE(me.trex, 0),
        'grab', COALESCE(me.grab, 0),
        'munch', COALESCE(me.munch, 0),
        'gap_to_podium', CASE WHEN me.rnk IS NOT NULL AND me.rnk <= 3 THEN 0
                              WHEN v_third IS NULL THEN GREATEST(cur.min_score - COALESCE(me.total, 0), 0)
                              ELSE GREATEST(v_third - COALESCE(me.total, 0) + 1, 0) END,
        'qualifies', COALESCE(me.total, 0) >= cur.min_score);
    END IF;
    v_has_phone := public.phone_is_usable((SELECT phone FROM public.profiles WHERE id = v_uid));
    SELECT COALESCE(jsonb_agg(jsonb_build_object('contest', k.title, 'rank', w.rank,
                                                 'prize', z.prize_name,
                                                 'claim_code', CASE WHEN v_has_phone THEN w.claim_code END,
                                                 'needs_phone', NOT v_has_phone,
                                                 'claim_min_order_cents', k.claim_min_order_cents) ORDER BY w.awarded_at DESC), '[]'::jsonb)
    INTO v_my_wins
    FROM public.arcade_contest_winners w
    JOIN public.arcade_contests k ON k.id = w.contest_id
    LEFT JOIN public.arcade_contest_prizes z ON z.contest_id = w.contest_id AND z.rank = w.rank
    WHERE w.user_id = v_uid AND w.status = 'AWARDED'
      AND w.awarded_at > now() - make_interval(days => k.claim_days);
  END IF;

  RETURN jsonb_build_object(
    'current', v_current,
    'next', v_next,
    'last', v_last,
    'my', v_my,
    'my_wins', v_my_wins,
    'goal', jsonb_build_object('goal_score', v_goal, 'goal_points', v_goal_points,
                               'week_score', v_week, 'done', v_goal_done));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.arcade_contest_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.arcade_contest_status() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_mark_arcade_claimed(p_contest uuid, p_rank integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.arcade_contest_winners w
    LEFT JOIN public.profiles p ON p.id = w.user_id
    WHERE w.contest_id = p_contest AND w.rank = p_rank AND w.status = 'AWARDED'
      AND NOT public.phone_is_usable(p.phone)
  ) THEN
    RAISE EXCEPTION 'The winner has no phone number on the account yet. Ask them to add one first.';
  END IF;
  UPDATE public.arcade_contest_winners
  SET status = 'CLAIMED', claimed_at = now()
  WHERE contest_id = p_contest AND rank = p_rank AND status = 'AWARDED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That prize is not waiting to be claimed.';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_mark_arcade_claimed(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_arcade_claimed(uuid, integer) TO authenticated;
