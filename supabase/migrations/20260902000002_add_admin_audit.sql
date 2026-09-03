-- §0 shared machinery (docs/design/HANDOFF-ADMIN-CRM.md): audit log table.
-- Insert + select only for admins -- deliberately no update or delete
-- policy, per MERGE-SAFETY.md trap #4 ("an audit log isn't an audit log"
-- otherwise). Written from Admin.jsx directly (not through StoreContext --
-- the brief scopes this build to src/pages/Admin.jsx + Admin.css + migrations).

CREATE TABLE IF NOT EXISTS public.admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  actor_role text,
  action text NOT NULL,
  detail jsonb
);

ALTER TABLE public.admin_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can insert audit rows" ON public.admin_audit;
CREATE POLICY "Admins can insert audit rows" ON public.admin_audit
  FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can view audit rows" ON public.admin_audit;
CREATE POLICY "Admins can view audit rows" ON public.admin_audit
  FOR SELECT USING (public.is_admin());
