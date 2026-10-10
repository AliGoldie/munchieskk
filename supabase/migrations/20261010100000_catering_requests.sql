-- Catering / bulk pre-orders, submitted from the public /catering page.
--
-- Customers never write to this table directly: RLS allows no INSERT, and
-- submissions go through submit_catering_request(), which enforces the
-- 5-day lead time in Malaysia time (so it can't be bypassed by editing the
-- date picker), bounds every field, and caps submissions per phone number
-- per day so the anon-callable endpoint can't be used to flood the table.
-- Only admins can read or update requests.

CREATE TABLE IF NOT EXISTS public.catering_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  name text NOT NULL,
  phone text NOT NULL,
  event_date date NOT NULL,
  event_time text,
  headcount integer NOT NULL CHECK (headcount BETWEEN 1 AND 2000),
  fulfilment text NOT NULL CHECK (fulfilment IN ('pickup', 'delivery')),
  address text,
  details text NOT NULL,
  dietary text,
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONFIRMED', 'DECLINED', 'DONE')),
  admin_note text
);

CREATE INDEX IF NOT EXISTS catering_requests_event_date_idx ON public.catering_requests (event_date);
CREATE INDEX IF NOT EXISTS catering_requests_phone_created_idx ON public.catering_requests (phone, created_at);

ALTER TABLE public.catering_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read catering requests" ON public.catering_requests;
CREATE POLICY "Admins can read catering requests" ON public.catering_requests
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update catering requests" ON public.catering_requests;
CREATE POLICY "Admins can update catering requests" ON public.catering_requests
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.submit_catering_request(
  p_name text,
  p_phone text,
  p_event_date date,
  p_event_time text,
  p_headcount integer,
  p_fulfilment text,
  p_address text,
  p_details text,
  p_dietary text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  v_details text := btrim(coalesce(p_details, ''));
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
  v_min_date date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + 5;
  v_recent integer;
  v_id uuid;
BEGIN
  IF length(v_name) < 2 OR length(v_name) > 80 THEN
    RAISE EXCEPTION 'Please enter your name.';
  END IF;
  IF length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 9 OR length(v_phone) > 16 THEN
    RAISE EXCEPTION 'Please enter a valid phone number.';
  END IF;
  IF p_event_date IS NULL OR p_event_date < v_min_date THEN
    RAISE EXCEPTION 'Catering needs at least 5 days notice. The earliest date is %.', to_char(v_min_date, 'DD Mon YYYY');
  END IF;
  IF p_event_date > v_min_date + 365 THEN
    RAISE EXCEPTION 'Please pick a date within the next year.';
  END IF;
  IF p_headcount IS NULL OR p_headcount < 1 OR p_headcount > 2000 THEN
    RAISE EXCEPTION 'Please enter how many people you are feeding.';
  END IF;
  IF p_fulfilment NOT IN ('pickup', 'delivery') THEN
    RAISE EXCEPTION 'Please choose pickup or delivery.';
  END IF;
  IF p_fulfilment = 'delivery' AND (v_address IS NULL OR length(v_address) < 5) THEN
    RAISE EXCEPTION 'Please enter a delivery address.';
  END IF;
  IF length(v_details) < 3 OR length(v_details) > 1500 THEN
    RAISE EXCEPTION 'Please tell us what you would like to order.';
  END IF;
  IF length(coalesce(p_dietary, '')) > 500 OR length(coalesce(v_address, '')) > 300 OR length(coalesce(p_event_time, '')) > 20 THEN
    RAISE EXCEPTION 'Some details are too long.';
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.catering_requests
  WHERE phone = v_phone AND created_at > now() - interval '24 hours';
  IF v_recent >= 3 THEN
    RAISE EXCEPTION 'We already have your recent requests -- we will be in touch on WhatsApp.';
  END IF;

  INSERT INTO public.catering_requests (
    user_id, name, phone, event_date, event_time, headcount,
    fulfilment, address, details, dietary
  ) VALUES (
    auth.uid(), v_name, v_phone, p_event_date, nullif(btrim(coalesce(p_event_time, '')), ''), p_headcount,
    p_fulfilment, CASE WHEN p_fulfilment = 'delivery' THEN v_address END, v_details,
    nullif(btrim(coalesce(p_dietary, '')), '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_catering_request(text, text, date, text, integer, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_catering_request(text, text, date, text, integer, text, text, text, text) TO anon, authenticated;
