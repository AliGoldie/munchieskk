-- Let admins delete catering requests (e.g. test orders, spam).
DROP POLICY IF EXISTS "Admins can delete catering requests" ON public.catering_requests;
CREATE POLICY "Admins can delete catering requests" ON public.catering_requests
  FOR DELETE USING (public.is_admin());
