-- Catering on/off switch (Admin › Catering). When off, the /catering page
-- shows a "not taking orders" notice and the server refuses new requests,
-- so the switch can't be bypassed by calling the API directly.
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS catering_enabled boolean NOT NULL DEFAULT true;

-- Also lets admins delete catering requests (test orders, spam).
DROP POLICY IF EXISTS "Admins can delete catering requests" ON public.catering_requests;
CREATE POLICY "Admins can delete catering requests" ON public.catering_requests
  FOR DELETE USING (public.is_admin());

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
  IF NOT coalesce((SELECT catering_enabled FROM public.store_settings WHERE id = 'main_store'), true) THEN
    RAISE EXCEPTION 'Sorry, we are not taking catering orders right now. Please WhatsApp us and we will help.';
  END IF;
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
