-- Admin CRM brief §5 (Trading hours & diary): "Diary calendar ... Backed by
-- a table, not localStorage (the current munchies_admin_events_notes key
-- should be migrated once and dropped)." Unlike admin_audit, this is admin-
-- editable content (the diary supports edit/delete from the UI), so admins
-- get full CRUD rather than insert+select only.

CREATE TABLE IF NOT EXISTS public.store_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  title text NOT NULL,
  type text NOT NULL DEFAULT 'event',
  description text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.store_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view store events" ON public.store_events;
CREATE POLICY "Admins can view store events" ON public.store_events
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert store events" ON public.store_events;
CREATE POLICY "Admins can insert store events" ON public.store_events
  FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update store events" ON public.store_events;
CREATE POLICY "Admins can update store events" ON public.store_events
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete store events" ON public.store_events;
CREATE POLICY "Admins can delete store events" ON public.store_events
  FOR DELETE USING (public.is_admin());
