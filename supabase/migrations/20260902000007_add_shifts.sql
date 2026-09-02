-- Admin CRM brief §6 (Shift handover / cash-up): "New table shifts:
-- opened_at, closed_at, opening_float, counted, expected, variance, closed_by."
-- Money columns are integer cents, matching orders.total elsewhere in this schema.
-- Admins get select/insert/update (closing then reopening a shift updates the
-- same row) but no delete -- shift history should stay auditable, same
-- reasoning as admin_audit (MERGE-SAFETY.md trap #4), just not insert-only
-- since close/reopen genuinely needs to mutate the row.

CREATE TABLE IF NOT EXISTS public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  opening_float integer NOT NULL DEFAULT 0,
  counted integer,
  expected integer,
  variance integer,
  closed_by uuid
);

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view shifts" ON public.shifts
  FOR SELECT USING (public.is_admin());

CREATE POLICY "Admins can insert shifts" ON public.shifts
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update shifts" ON public.shifts
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
