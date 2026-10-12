-- Burger Ranks, part 3 of 3: the monthly top-spender prize.
--
-- The owner sets one prize per calendar month in Admin > Promotions > Monthly
-- Prize (a menu item, a headline, a minimum spend). The winner is the customer
-- with the highest spend on collected orders that month (minus refunds), at or
-- above the minimum; ties go to whoever reached the total first. The winner is
-- worked out automatically the first time anyone opens the app after the month
-- ends. Winners get a claim code that staff confirm in Admin.
--
-- Only first names are ever shown to customers. Run after
-- 20261014000001_burger_ranks_cancel.sql. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.monthly_prizes (
  month date PRIMARY KEY,                       -- first day of the month, Malaysia time
  prize_name text NOT NULL,
  headline text,
  menu_item_id text,
  image_url text,
  min_spend_cents integer NOT NULL DEFAULT 10000 CHECK (min_spend_cents >= 0),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'AWARDED', 'CLAIMED', 'NO_WINNER')),
  winner_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  winner_first_name text,
  winner_spend_cents integer,
  claim_code text,
  awarded_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.monthly_prizes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage monthly prizes" ON public.monthly_prizes;
CREATE POLICY "Admins manage monthly prizes" ON public.monthly_prizes
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
-- Customers never read this table directly (it holds claim codes): they use
-- monthly_prize_status() below.
REVOKE ALL ON public.monthly_prizes FROM anon;

-- Ranking for one month (internal).
CREATE OR REPLACE FUNCTION public.monthly_spend_ranking(p_month date)
RETURNS TABLE (user_id uuid, spend_cents integer, last_order_at timestamptz, rnk bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.user_id, s.spend::integer, s.last_at,
         ROW_NUMBER() OVER (ORDER BY s.spend DESC, s.last_at ASC, s.user_id)
  FROM (
    SELECT o.user_id,
           SUM(GREATEST(0, o.total - COALESCE(o.refund_amount, 0))) AS spend,
           MAX(o.created_at) AS last_at
    FROM public.orders o
    WHERE o.user_id IS NOT NULL
      AND o.status = 'COLLECTED'
      AND o.created_at >= (p_month::timestamp AT TIME ZONE 'Asia/Kuching')
      AND o.created_at <  ((p_month + interval '1 month')::timestamp AT TIME ZONE 'Asia/Kuching')
    GROUP BY o.user_id
    HAVING SUM(GREATEST(0, o.total - COALESCE(o.refund_amount, 0))) > 0
  ) s;
$$;

-- Picks winners for every finished month that is still open (internal).
CREATE OR REPLACE FUNCTION public.finalize_monthly_prizes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  w record;
  v_code text;
  v_cur date := date_trunc('month', now() AT TIME ZONE 'Asia/Kuching')::date;
BEGIN
  FOR r IN
    SELECT * FROM public.monthly_prizes
    WHERE status = 'OPEN' AND month < v_cur
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT rk.user_id, rk.spend_cents INTO w
    FROM public.monthly_spend_ranking(r.month) rk
    WHERE rk.spend_cents >= r.min_spend_cents
    ORDER BY rk.rnk
    LIMIT 1;

    IF NOT FOUND THEN
      UPDATE public.monthly_prizes SET status = 'NO_WINNER', awarded_at = now() WHERE month = r.month;
    ELSE
      LOOP
        v_code := public.generate_unique_redemption_code();
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.monthly_prizes WHERE claim_code = v_code);
      END LOOP;

      UPDATE public.monthly_prizes
      SET status = 'AWARDED',
          winner_user_id = w.user_id,
          winner_first_name = (SELECT NULLIF(split_part(trim(both from COALESCE(p.name, '')), ' ', 1), '')
                               FROM public.profiles p WHERE p.id = w.user_id),
          winner_spend_cents = w.spend_cents,
          claim_code = v_code,
          awarded_at = now()
      WHERE month = r.month;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.monthly_spend_ranking(date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_monthly_prizes() FROM PUBLIC, anon, authenticated;

-- What the banner shows. Safe for guests: names are first names only and the
-- claim code only ever goes back to its own winner.
CREATE OR REPLACE FUNCTION public.monthly_prize_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cur date := date_trunc('month', now() AT TIME ZONE 'Asia/Kuching')::date;
  p record;
  lp record;
  mw record;
  me record;
  v_first_spend integer;
  v_top jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.finalize_monthly_prizes();

  -- Records start as all-NULL so the response below is safe for guests too.
  SELECT NULL::bigint AS rnk, NULL::integer AS spend_cents INTO me;
  SELECT NULL::date AS month, NULL::text AS prize_name, NULL::text AS claim_code, NULL::timestamptz AS awarded_at INTO mw;

  SELECT * INTO p FROM public.monthly_prizes WHERE month = v_cur;
  SELECT * INTO lp FROM public.monthly_prizes WHERE month = (v_cur - interval '1 month')::date;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('rank', x.rnk, 'first_name', x.first_name) ORDER BY x.rnk), '[]'::jsonb)
  INTO v_top
  FROM (
    SELECT rk.rnk,
           COALESCE(NULLIF(split_part(trim(both from COALESCE(pr.name, '')), ' ', 1), ''), 'Customer') AS first_name
    FROM public.monthly_spend_ranking(v_cur) rk
    JOIN public.profiles pr ON pr.id = rk.user_id
    ORDER BY rk.rnk
    LIMIT 3
  ) x;

  SELECT rk.spend_cents INTO v_first_spend FROM public.monthly_spend_ranking(v_cur) rk WHERE rk.rnk = 1;

  IF v_uid IS NOT NULL THEN
    SELECT rk.rnk, rk.spend_cents INTO me FROM public.monthly_spend_ranking(v_cur) rk WHERE rk.user_id = v_uid;
    SELECT m.month, m.prize_name, m.claim_code, m.awarded_at INTO mw
    FROM public.monthly_prizes m
    WHERE m.winner_user_id = v_uid AND m.status = 'AWARDED' AND m.awarded_at > now() - interval '14 days'
    ORDER BY m.month DESC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'month', v_cur,
    'ends_at', ((v_cur + interval '1 month')::timestamp AT TIME ZONE 'Asia/Kuching'),
    'prize', CASE WHEN p.month IS NULL THEN NULL ELSE jsonb_build_object(
      'name', p.prize_name, 'headline', p.headline, 'image_url', p.image_url,
      'min_spend_cents', p.min_spend_cents) END,
    'top', v_top,
    'my', CASE WHEN v_uid IS NULL THEN NULL ELSE jsonb_build_object(
      'rank', me.rnk,
      'spend_cents', COALESCE(me.spend_cents, 0),
      'gap_to_first_cents', CASE WHEN me.rnk = 1 OR v_first_spend IS NULL THEN 0
                                 ELSE v_first_spend - COALESCE(me.spend_cents, 0) END,
      'qualifies', COALESCE(me.spend_cents, 0) >= COALESCE(p.min_spend_cents, 0)) END,
    'last_month', CASE WHEN lp.month IS NULL THEN NULL ELSE jsonb_build_object(
      'prize_name', lp.prize_name, 'status', lp.status, 'winner_first_name', lp.winner_first_name) END,
    'my_win', CASE WHEN mw.month IS NULL THEN NULL ELSE jsonb_build_object(
      'month', mw.month, 'prize_name', mw.prize_name, 'claim_code', mw.claim_code) END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.monthly_prize_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.monthly_prize_status() TO anon, authenticated;

-- Admin: this month's top spenders (full names and phones) and recent months.
CREATE OR REPLACE FUNCTION public.admin_monthly_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cur date := date_trunc('month', now() AT TIME ZONE 'Asia/Kuching')::date;
  v_leaders jsonb;
  v_prizes jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;

  PERFORM public.finalize_monthly_prizes();

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'rank', x.rnk, 'name', x.name, 'phone', x.phone, 'spend_cents', x.spend_cents
         ) ORDER BY x.rnk), '[]'::jsonb)
  INTO v_leaders
  FROM (
    SELECT rk.rnk, pr.name, pr.phone, rk.spend_cents
    FROM public.monthly_spend_ranking(v_cur) rk
    JOIN public.profiles pr ON pr.id = rk.user_id
    ORDER BY rk.rnk
    LIMIT 10
  ) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'month', m.month, 'prize_name', m.prize_name, 'headline', m.headline,
           'menu_item_id', m.menu_item_id, 'image_url', m.image_url,
           'min_spend_cents', m.min_spend_cents, 'status', m.status,
           'winner_name', pr.name, 'winner_phone', pr.phone,
           'winner_spend_cents', m.winner_spend_cents, 'claim_code', m.claim_code,
           'awarded_at', m.awarded_at, 'claimed_at', m.claimed_at
         ) ORDER BY m.month DESC), '[]'::jsonb)
  INTO v_prizes
  FROM (SELECT * FROM public.monthly_prizes ORDER BY month DESC LIMIT 12) m
  LEFT JOIN public.profiles pr ON pr.id = m.winner_user_id;

  RETURN jsonb_build_object('month', v_cur, 'leaders', v_leaders, 'prizes', v_prizes);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_monthly_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_monthly_overview() TO authenticated;

-- Admin: mark a winner's prize as handed over.
CREATE OR REPLACE FUNCTION public.admin_mark_prize_claimed(p_month date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;
  UPDATE public.monthly_prizes
  SET status = 'CLAIMED', claimed_at = now()
  WHERE month = p_month AND status = 'AWARDED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That prize is not waiting to be claimed.';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_mark_prize_claimed(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_prize_claimed(date) TO authenticated;
