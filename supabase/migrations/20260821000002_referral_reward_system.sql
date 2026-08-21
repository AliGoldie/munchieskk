-- =========================================================================
-- MIGRATION: REFERRAL REWARD SYSTEM (SIGNUP BONUS & CONVERSION REWARD)
-- =========================================================================

-- 1. Create referral_rewards_log table
CREATE TABLE IF NOT EXISTS public.referral_rewards_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id uuid,
  referred_id uuid,
  reward_type text, -- 'signup_bonus' or 'referrer_bonus'
  points_awarded integer,
  order_id text,
  logged_at timestamptz DEFAULT now()
);

-- 2. Modify handle_new_user() trigger function to award 30 signup points on valid referral
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_ref_raw text;
  v_referrer_uuid uuid := NULL;
  v_referrer_exists boolean := false;
BEGIN
  -- 1. Insert base profile row
  INSERT INTO public.profiles (
    id,
    name,
    phone,
    role,
    points
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', NEW.phone, ''),
    'user',
    0
  )
  ON CONFLICT (id) DO NOTHING;

  -- 2. Check for referred_by metadata
  v_ref_raw := NEW.raw_user_meta_data->>'referred_by';
  
  IF v_ref_raw IS NOT NULL AND v_ref_raw <> '' THEN
    BEGIN
      v_referrer_uuid := v_ref_raw::uuid;
      
      -- Check if referrer profile exists
      SELECT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = v_referrer_uuid
      ) INTO v_referrer_exists;

      IF v_referrer_exists THEN
        -- Set referred_by and award 30 points to the new user
        UPDATE public.profiles
        SET 
          referred_by = v_referrer_uuid,
          points = COALESCE(points, 0) + 30
        WHERE id = NEW.id;

        -- Log the referral signup bonus
        INSERT INTO public.referral_rewards_log (
          referrer_id,
          referred_id,
          reward_type,
          points_awarded,
          logged_at
        ) VALUES (
          v_referrer_uuid,
          NEW.id,
          'signup_bonus',
          30,
          NOW()
        );
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        -- Skip silently on invalid UUID format or lookup errors
        NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-attach trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 3. Modify place_order function to handle referral conversion (150 pts to referrer on first order)
CREATE OR REPLACE FUNCTION public.place_order(
  deductions jsonb,
  payload jsonb,
  p_promo_code text DEFAULT NULL,
  p_user_id text DEFAULT NULL,
  addon_deductions jsonb DEFAULT '[]'::jsonb
) RETURNS text AS $$
DECLARE
  d record;
  ad record;
  current_stock integer;
  current_addon_stock integer;
  order_id text;
  v_original_total integer;
  v_final_discount integer := 0;
  v_promo_result jsonb;
  v_promo_code_id uuid := NULL;
  v_user_uuid uuid := NULL;
  v_user_referrer uuid := NULL;
  v_user_ref_converted timestamptz := NULL;
  v_prior_order_count integer := 0;
BEGIN
  order_id := payload->>'id';

  -- Cast user ID to uuid if provided
  IF p_user_id IS NOT NULL AND p_user_id <> '' THEN
    v_user_uuid := p_user_id::uuid;
  END IF;

  -- 1. Deduct Base Menu Items Stock (Atomic with FOR UPDATE locks)
  IF deductions IS NOT NULL AND jsonb_array_length(deductions) > 0 THEN
    FOR d IN SELECT * FROM jsonb_to_recordset(deductions) AS x(item_id text, quantity integer)
    LOOP
      SELECT stock_quantity INTO current_stock 
      FROM public.menu_items 
      WHERE id = d.item_id 
      FOR UPDATE;

      IF current_stock IS NULL THEN
        RAISE EXCEPTION 'Item % not found', d.item_id;
      END IF;

      IF current_stock < d.quantity THEN
        RAISE EXCEPTION 'Insufficient stock for item %', d.item_id;
      END IF;

      UPDATE public.menu_items
      SET 
        stock_quantity = current_stock - d.quantity,
        in_stock = (current_stock - d.quantity > 0)
      WHERE id = d.item_id;
    END LOOP;
  END IF;

  -- 2. Deduct Add-ons Stock (Atomic with FOR UPDATE locks)
  IF addon_deductions IS NOT NULL AND jsonb_array_length(addon_deductions) > 0 THEN
    FOR ad IN SELECT * FROM jsonb_to_recordset(addon_deductions) AS y(addon_id text, quantity integer)
    LOOP
      SELECT stock_quantity INTO current_addon_stock 
      FROM public.addons 
      WHERE id = ad.addon_id 
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Add-on % not found', ad.addon_id;
      END IF;

      IF current_addon_stock IS NULL THEN
        RAISE EXCEPTION 'Add-on % has NULL stock_quantity', ad.addon_id;
      END IF;

      IF current_addon_stock < ad.quantity THEN
        RAISE EXCEPTION 'Insufficient stock for add-on %', ad.addon_id;
      END IF;

      UPDATE public.addons
      SET 
        stock_quantity = current_addon_stock - ad.quantity,
        in_stock = (current_addon_stock - ad.quantity > 0)
      WHERE id = ad.addon_id;

      INSERT INTO public.addon_deduction_log (
        order_id,
        addon_id,
        quantity,
        stock_before,
        stock_after,
        logged_at
      ) VALUES (
        order_id,
        ad.addon_id,
        ad.quantity,
        current_addon_stock,
        current_addon_stock - ad.quantity,
        NOW()
      );
    END LOOP;
  END IF;

  -- 3. Server-Side Promo Code Validation & Application
  v_original_total := (payload->>'total')::integer;

  IF p_promo_code IS NOT NULL AND p_promo_code <> '' THEN
    v_promo_result := validate_and_apply_promo(
      p_promo_code,
      v_original_total,
      v_user_uuid,
      payload->'items'
    );

    IF (v_promo_result->>'valid')::boolean = true THEN
      v_final_discount := (v_promo_result->>'discount_cents')::integer;
      v_promo_code_id := (v_promo_result->>'promo_code_id')::uuid;

      -- Update promo code usage count atomically
      UPDATE public.promo_codes 
      SET usage_count = COALESCE(usage_count, 0) + 1 
      WHERE id = v_promo_code_id;
    ELSE
      -- Reject and roll back entire transaction if promo validation fails
      RAISE EXCEPTION 'Promo validation failed: %', (v_promo_result->>'message');
    END IF;
  END IF;

  -- 4. Calculate Final Total and Insert Order
  INSERT INTO public.orders (
    id,
    items,
    total,
    status,
    payment_method,
    customer_name,
    customer_phone,
    user_id,
    promo_code_used,
    discount_amount,
    created_at
  ) VALUES (
    order_id,
    payload->'items',
    GREATEST(0, v_original_total - v_final_discount),
    payload->>'status',
    payload->>'payment_method',
    payload->>'customer_name',
    payload->>'customer_phone',
    v_user_uuid,
    p_promo_code,
    v_final_discount,
    NOW()
  );

  -- 5. Insert Promo Redemption Audit Record
  IF v_promo_code_id IS NOT NULL THEN
    INSERT INTO public.promo_redemptions (
      promo_code_id,
      order_id,
      user_id,
      discount_amount,
      redeemed_at
    ) VALUES (
      v_promo_code_id,
      order_id,
      v_user_uuid,
      v_final_discount,
      NOW()
    );
  END IF;

  -- 6. Referral Conversion Check & Award
  IF v_user_uuid IS NOT NULL THEN
    SELECT referred_by, referral_converted_at 
    INTO v_user_referrer, v_user_ref_converted 
    FROM public.profiles 
    WHERE id = v_user_uuid;

    IF v_user_referrer IS NOT NULL AND v_user_ref_converted IS NULL THEN
      -- Check if they have other non-PENDING orders prior to this order
      SELECT COUNT(*) INTO v_prior_order_count 
      FROM public.orders 
      WHERE user_id = v_user_uuid 
        AND id <> order_id 
        AND status <> 'PENDING';

      IF v_prior_order_count = 0 THEN
        -- Award 150 points to the REFERRER
        UPDATE public.profiles 
        SET points = COALESCE(points, 0) + 150 
        WHERE id = v_user_referrer;

        -- Mark referral as converted on the orderer's profile
        UPDATE public.profiles 
        SET referral_converted_at = NOW() 
        WHERE id = v_user_uuid;

        -- Log referral bonus in referral_rewards_log
        INSERT INTO public.referral_rewards_log (
          referrer_id,
          referred_id,
          reward_type,
          points_awarded,
          order_id,
          logged_at
        ) VALUES (
          v_user_referrer,
          v_user_uuid,
          'referrer_bonus',
          150,
          order_id,
          NOW()
        );
      END IF;
    END IF;
  END IF;

  RETURN order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
