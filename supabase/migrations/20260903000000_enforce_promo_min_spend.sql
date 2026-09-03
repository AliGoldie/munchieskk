-- §7 Promotions follow-up: promo_codes.min_spend was already enforced for
-- 'spend_threshold_free_item' (see 20260826000010) but the admin CRM's
-- Percent-off/RM-off promo form also collects and displays a min_spend for
-- those two types without validate_and_apply_promo ever checking it --
-- flagged as a known gap when built (Admin.jsx §7), closing it now: a
-- customer could otherwise apply e.g. "10% off, min spend RM50" to a RM5
-- order. CREATE OR REPLACE is safe to re-run.

CREATE OR REPLACE FUNCTION public.validate_and_apply_promo(p_code text, p_order_total integer, p_user_id uuid, p_cart_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_promo record;
  v_user_uses integer;
  v_discount integer := 0;
  v_free_item_id text := null;
  v_free_item_name text := null;
  v_item jsonb;
  v_has_bogo_item boolean := false;
  v_bogo_item_price integer := 0;
BEGIN
  SELECT * INTO v_promo FROM promo_codes WHERE code = p_code;
  IF NOT FOUND THEN RETURN json_build_object('valid', false, 'message', 'Invalid promo code.'); END IF;
  IF v_promo.active = false THEN RETURN json_build_object('valid', false, 'message', 'This promo code is inactive.'); END IF;
  IF v_promo.starts_at IS NOT NULL AND now() < v_promo.starts_at THEN RETURN json_build_object('valid', false, 'message', 'This promo code is not active yet.'); END IF;
  IF v_promo.ends_at IS NOT NULL AND now() > v_promo.ends_at THEN RETURN json_build_object('valid', false, 'message', 'This promo code has expired.'); END IF;
  IF v_promo.max_total_uses IS NOT NULL AND v_promo.usage_count >= v_promo.max_total_uses THEN RETURN json_build_object('valid', false, 'message', 'This promo code has reached its maximum usage limit.'); END IF;

  IF v_promo.max_uses_per_user IS NOT NULL AND p_user_id IS NOT NULL THEN
    SELECT count(*) INTO v_user_uses FROM promo_redemptions WHERE promo_code_id = v_promo.id AND user_id = p_user_id;
    IF v_user_uses >= v_promo.max_uses_per_user THEN
      RETURN json_build_object('valid', false, 'message', 'You have reached the maximum usage limit for this code.');
    END IF;
  END IF;

  IF v_promo.type IN ('percent_off', 'flat_off') AND v_promo.min_spend IS NOT NULL AND p_order_total < v_promo.min_spend THEN
    RETURN json_build_object('valid', false, 'message', 'You must spend RM ' || (v_promo.min_spend / 100.0) || ' to use this promo.');
  END IF;

  IF v_promo.type = 'percent_off' THEN v_discount := floor(p_order_total * (v_promo.value / 100.0));
  ELSIF v_promo.type = 'flat_off' THEN v_discount := v_promo.value;
  ELSIF v_promo.type = 'bogo' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart_items) LOOP
      IF (v_item->>'id') = v_promo.applies_to_item_id THEN
        v_has_bogo_item := true;
        v_bogo_item_price := (v_item->>'price')::integer;
      END IF;
    END LOOP;
    IF v_has_bogo_item THEN v_discount := v_bogo_item_price;
    ELSE RETURN json_build_object('valid', false, 'message', 'Your cart does not contain the required item for this BOGO offer.'); END IF;
  ELSIF v_promo.type = 'spend_threshold_free_item' THEN
    IF p_order_total >= v_promo.min_spend THEN
      v_free_item_id := v_promo.free_item_id;
      SELECT name INTO v_free_item_name FROM menu_items WHERE id = v_free_item_id;
    ELSE RETURN json_build_object('valid', false, 'message', 'You must spend RM ' || (v_promo.min_spend / 100.0) || ' to use this promo.'); END IF;
  END IF;

  IF v_discount > p_order_total THEN v_discount := p_order_total; END IF;

  RETURN json_build_object('valid', true, 'message', 'Promo applied successfully!', 'discount_cents', v_discount, 'free_item_id', v_free_item_id, 'free_item_name', v_free_item_name, 'promo_code_id', v_promo.id);
END;
$$;
