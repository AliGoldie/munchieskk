-- Each game counts at most 5,000 toward a player's Arcade Score.
--
-- T-Rex Runner has no end, so without a cap a patient player could out-score
-- everyone. The cap applies to the weekly goal and to the monthly contest
-- ranking. Ties at the cap go to whoever reached the cap first.
-- Safe to re-run. Run after 20261018000000_points_at_collection.sql.

CREATE OR REPLACE FUNCTION public.arcade_game_cap()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 5000 $$;
REVOKE EXECUTE ON FUNCTION public.arcade_game_cap() FROM PUBLIC, anon, authenticated;

-- This week's score: the best verified score in each game (at most the cap), added together.
CREATE OR REPLACE FUNCTION public.arcade_week_score(p_uid uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(b.best), 0)::integer
  FROM (
    SELECT LEAST(MAX(s.score), public.arcade_game_cap()) AS best
    FROM public.arcade_scores s
    WHERE s.user_id = p_uid AND s.scored_at >= public.arcade_week_start()
    GROUP BY s.game
  ) b;
$$;
REVOKE EXECUTE ON FUNCTION public.arcade_week_score(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.arcade_contest_ranking(p_contest uuid, p_dedupe boolean DEFAULT true)
RETURNS TABLE (user_id uuid, total integer, trex integer, grab integer, munch integer, reached_at timestamptz, max_rate numeric, rnk bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH c AS (SELECT * FROM public.arcade_contests WHERE id = p_contest),
  sc AS (
    SELECT s.* FROM public.arcade_scores s, c
    WHERE s.scored_at >= c.starts_at AND s.scored_at < c.ends_at
  ),
  best AS (
    SELECT DISTINCT ON (s.user_id, s.game) s.user_id, s.game,
           LEAST(s.score, public.arcade_game_cap()) AS score, s.scored_at
    FROM sc s
    ORDER BY s.user_id, s.game, LEAST(s.score, public.arcade_game_cap()) DESC, s.scored_at ASC
  ),
  tot AS (
    SELECT b.user_id,
           SUM(b.score)::integer AS total,
           SUM(CASE WHEN b.game = 'trex_runner' THEN b.score ELSE 0 END)::integer AS trex,
           SUM(CASE WHEN b.game = 'speed_grab' THEN b.score ELSE 0 END)::integer AS grab,
           SUM(CASE WHEN b.game = 'munch_man' THEN b.score ELSE 0 END)::integer AS munch,
           MAX(b.scored_at) AS reached_at
    FROM best b
    GROUP BY b.user_id
  ),
  rate AS (
    SELECT s.user_id, MAX(s.score / GREATEST(s.run_seconds, 1)) AS max_rate
    FROM sc s GROUP BY s.user_id
  ),
  elig AS (
    SELECT t.*, r.max_rate,
           regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g') AS digits
    FROM tot t
    JOIN rate r ON r.user_id = t.user_id
    JOIN public.profiles p ON p.id = t.user_id
    WHERE t.total >= (SELECT min_score FROM c)
  ),
  dd AS (
    SELECT e.*,
           ROW_NUMBER() OVER (
             PARTITION BY CASE WHEN length(e.digits) >= 9 THEN right(e.digits, 9) ELSE e.user_id::text END
             ORDER BY e.total DESC, e.reached_at ASC, e.user_id
           ) AS pr
    FROM elig e
  )
  SELECT d.user_id, d.total, d.trex, d.grab, d.munch, d.reached_at, round(d.max_rate, 1),
         ROW_NUMBER() OVER (ORDER BY d.total DESC, d.reached_at ASC, d.user_id)
  FROM dd d
  WHERE (NOT p_dedupe) OR d.pr = 1;
$$;
REVOKE EXECUTE ON FUNCTION public.arcade_contest_ranking(uuid, boolean) FROM PUBLIC, anon, authenticated;
