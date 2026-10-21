-- Housekeeping for the Supabase advisor warnings (audit 21 Oct 2026).
-- No rule changes. Safe to run twice; anything missing is skipped.

-- 1. Pin search_path on the helper functions that lacked it, so a caller
--    cannot change which tables or functions they resolve to.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.arcade_score_ceiling(text,numeric)',
    'public.arcade_week_start()',
    'public.arcade_game_cap()',
    'public.phone_is_usable(text)',
    'public.protect_game_plays_insert()'
  ] LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', f);
    END IF;
  END LOOP;
END $$;

-- 2. Trigger functions are not meant to be called from the website. Taking
--    away EXECUTE removes them from the public API; the triggers keep firing
--    (Postgres only checks EXECUTE when a trigger is created).
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.enforce_monthly_reward_cap()',
    'public.handle_order_refund_points()',
    'public.lock_in_ranks_before_change()',
    'public.raise_top_tier_on_collect()'
  ] LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    END IF;
  END LOOP;
END $$;

-- 3. Indexes for foreign keys that had none.
DO $$
BEGIN
  IF to_regclass('public.arcade_contest_winners') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_arcade_contest_winners_user_id ON public.arcade_contest_winners (user_id);
  END IF;
  IF to_regclass('public.monthly_prizes') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_monthly_prizes_winner_user_id ON public.monthly_prizes (winner_user_id);
  END IF;
  IF to_regclass('public.share_proofs') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_share_proofs_user_id ON public.share_proofs (user_id);
    CREATE INDEX IF NOT EXISTS idx_share_proofs_reviewed_by ON public.share_proofs (reviewed_by);
  END IF;
END $$;

-- 4. Work out auth.uid() once per query, not once per row.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'share_proofs'
             AND policyname = 'Owners and admins read share proofs') THEN
    ALTER POLICY "Owners and admins read share proofs" ON public.share_proofs
      USING (((SELECT auth.uid()) = user_id) OR public.is_admin());
  END IF;
END $$;
