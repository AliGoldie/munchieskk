-- Leaderboards for the arcade: top players per game and overall, for this week,
-- this month and all time. Players may set a nickname (checked on the server) or
-- hide themselves; otherwise their first name is shown. Staff accounts never appear.
-- Safe to re-run. Run after 20261019000000_arcade_score_cap.sql.

-- 1. Where nicknames live: its own table, readable only through the functions below,
--    so the browser can never write a nickname directly.
CREATE TABLE IF NOT EXISTS public.leaderboard_names (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  nickname text,
  hidden boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_names_nickname_key ON public.leaderboard_names (lower(nickname));
ALTER TABLE public.leaderboard_names ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.leaderboard_names FROM PUBLIC, anon, authenticated;

-- 2. Words a nickname may not contain (the owner can add more with plain SQL:
--    INSERT INTO public.blocked_nickname_words (word) VALUES ('example');).
CREATE TABLE IF NOT EXISTS public.blocked_nickname_words (word text PRIMARY KEY CHECK (word = lower(word) AND word ~ '^[a-z]+$'));
ALTER TABLE public.blocked_nickname_words ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.blocked_nickname_words FROM PUBLIC, anon, authenticated;
INSERT INTO public.blocked_nickname_words (word) VALUES
  ('fuck'), ('shit'), ('bitch'), ('cunt'), ('whore'), ('slut'), ('nigg'), ('fagg'), ('porn'),
  ('nazi'), ('hitler'), ('pukimak'), ('puki'), ('lancau'), ('bangsat'), ('keparat'), ('anjing'), ('sial'),
  ('admin'), ('staff'), ('owner'), ('moderator'), ('official'), ('munchies'), ('support')
ON CONFLICT (word) DO NOTHING;

-- Lower-case, turn common look-alike symbols into letters, drop everything else.
CREATE OR REPLACE FUNCTION public.nickname_normalize(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(translate(lower(COALESCE(p_text, '')), '0134578@$!', 'oieastbasi'), '[^a-z]', '', 'g');
$$;

-- 3. Set my nickname (empty clears it) and whether I appear. Null leaves a value as it is.
CREATE OR REPLACE FUNCTION public.set_my_nickname(p_nickname text DEFAULT NULL, p_hidden boolean DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_nick text;
  v_norm text;
  v_row public.leaderboard_names;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please log in first.';
  END IF;

  IF p_nickname IS NOT NULL THEN
    v_nick := regexp_replace(trim(p_nickname), '\s+', ' ', 'g');
    IF v_nick = '' THEN
      v_nick := NULL;
    ELSE
      IF v_nick !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{1,12}[A-Za-z0-9]$' THEN
        RAISE EXCEPTION 'Use 3 to 14 letters, numbers, spaces, dots, dashes or underscores.';
      END IF;
      v_norm := public.nickname_normalize(v_nick);
      IF EXISTS (SELECT 1 FROM public.blocked_nickname_words b WHERE v_norm LIKE '%' || b.word || '%') THEN
        RAISE EXCEPTION 'Please choose a different nickname.';
      END IF;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.leaderboard_names (user_id, nickname, hidden)
    VALUES (v_uid, CASE WHEN p_nickname IS NULL THEN NULL ELSE v_nick END, COALESCE(p_hidden, false))
    ON CONFLICT (user_id) DO UPDATE
    SET nickname = CASE WHEN p_nickname IS NULL THEN public.leaderboard_names.nickname ELSE v_nick END,
        hidden = COALESCE(p_hidden, public.leaderboard_names.hidden),
        updated_at = now()
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'That nickname is already taken.';
  END;

  RETURN jsonb_build_object('nickname', v_row.nickname, 'hidden', v_row.hidden);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_my_nickname(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_nickname(text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_leaderboard_name()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object('nickname', n.nickname, 'hidden', COALESCE(n.hidden, false))
  FROM (SELECT auth.uid() AS uid) u
  LEFT JOIN public.leaderboard_names n ON n.user_id = u.uid;
$$;
REVOKE EXECUTE ON FUNCTION public.my_leaderboard_name() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_leaderboard_name() TO authenticated;

-- 4. The leaderboard. p_period: 'week' (Monday to Sunday, Malaysia time), 'month' (calendar
--    month, Malaysia time) or 'all'. p_game: 'all' (best score in each game added up, each
--    game capped like the contest) or one game. Returns the top 20 plus the caller's own place.
CREATE OR REPLACE FUNCTION public.arcade_leaderboard(p_period text DEFAULT 'week', p_game text DEFAULT 'all')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_from timestamptz;
  v_rows jsonb;
  v_me jsonb;
BEGIN
  IF p_period NOT IN ('week', 'month', 'all') THEN
    RAISE EXCEPTION 'Unknown period.';
  END IF;
  IF p_game NOT IN ('all', 'trex_runner', 'speed_grab', 'munch_man') THEN
    RAISE EXCEPTION 'Unknown game.';
  END IF;

  v_from := CASE p_period
    WHEN 'week' THEN public.arcade_week_start()
    WHEN 'month' THEN date_trunc('month', now() AT TIME ZONE 'Asia/Kuching') AT TIME ZONE 'Asia/Kuching'
    ELSE '-infinity'::timestamptz
  END;

  WITH best AS (
    SELECT DISTINCT ON (s.user_id, s.game) s.user_id, s.game,
           LEAST(s.score, public.arcade_game_cap()) AS score, s.scored_at
    FROM public.arcade_scores s
    WHERE s.scored_at >= v_from AND (p_game = 'all' OR s.game = p_game)
    ORDER BY s.user_id, s.game, LEAST(s.score, public.arcade_game_cap()) DESC, s.scored_at ASC
  ),
  tot AS (
    SELECT b.user_id, SUM(b.score)::integer AS score, MAX(b.scored_at) AS reached_at
    FROM best b GROUP BY b.user_id
  ),
  named AS (
    SELECT t.user_id, t.score, t.reached_at,
           COALESCE(NULLIF(n.nickname, ''), NULLIF(split_part(trim(p.name), ' ', 1), ''), 'Player') AS display_name,
           COALESCE(n.hidden, false) AS hidden,
           COALESCE(p.role, 'user') AS role
    FROM tot t
    JOIN public.profiles p ON p.id = t.user_id
    LEFT JOIN public.leaderboard_names n ON n.user_id = t.user_id
  ),
  ranked AS (
    SELECT x.*, ROW_NUMBER() OVER (ORDER BY x.score DESC, x.reached_at ASC, x.user_id) AS rnk
    FROM named x
    WHERE NOT x.hidden AND x.role = 'user' AND x.score > 0
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object('rank', r.rnk, 'name', r.display_name, 'score', r.score, 'is_me', r.user_id = v_uid) ORDER BY r.rnk)
              FROM ranked r WHERE r.rnk <= 20), '[]'::jsonb),
    (SELECT jsonb_build_object('rank', r.rnk, 'name', r.display_name, 'score', r.score, 'hidden', false)
     FROM ranked r WHERE v_uid IS NOT NULL AND r.user_id = v_uid)
  INTO v_rows, v_me;

  -- someone who hid themselves still sees that they are hidden
  IF v_me IS NULL AND v_uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.leaderboard_names n WHERE n.user_id = v_uid AND n.hidden) THEN
    v_me := jsonb_build_object('rank', NULL, 'name', NULL, 'score', NULL, 'hidden', true);
  END IF;

  RETURN jsonb_build_object('period', p_period, 'game', p_game, 'rows', v_rows, 'me', v_me);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.arcade_leaderboard(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.arcade_leaderboard(text, text) TO anon, authenticated;

-- 5. Admin: see every nickname and reset one.
CREATE OR REPLACE FUNCTION public.admin_list_leaderboard_names()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('user_id', n.user_id, 'real_name', p.name, 'nickname', n.nickname, 'hidden', n.hidden, 'updated_at', n.updated_at) ORDER BY n.updated_at DESC)
    FROM (SELECT * FROM public.leaderboard_names ORDER BY updated_at DESC LIMIT 200) n
    JOIN public.profiles p ON p.id = n.user_id
  ), '[]'::jsonb);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_list_leaderboard_names() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_leaderboard_names() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reset_nickname(p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;
  UPDATE public.leaderboard_names SET nickname = NULL, updated_at = now() WHERE user_id = p_user;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_reset_nickname(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_nickname(uuid) TO authenticated;
