-- =========================================================================
-- MIGRATION: SHORT REFERRAL CODES
-- =========================================================================

-- 1. Add short_code column
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS short_code text UNIQUE;

-- 2. Function to generate a random, human-friendly short code
-- Excludes confusing characters (0/O, 1/I/L) since these are meant to be
-- read aloud or typed manually.
CREATE OR REPLACE FUNCTION public.generate_unique_short_code()
RETURNS text AS $$
DECLARE
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text;
  i integer;
  code_exists boolean;
BEGIN
  LOOP
    result := '';
    FOR i IN 1..6 LOOP
      result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
    END LOOP;

    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE short_code = result) INTO code_exists;

    EXIT WHEN NOT code_exists;
  END LOOP;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 3. Backfill short codes for existing profiles that don't have one
UPDATE public.profiles
SET short_code = public.generate_unique_short_code()
WHERE short_code IS NULL;

-- 4. Update handle_new_user() to generate a short code for new users,
--    and match referrals by short_code instead of raw uuid.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_ref_raw text;
  v_referrer_id uuid := NULL;
  v_new_short_code text;
BEGIN
  v_new_short_code := public.generate_unique_short_code();

  -- 1. Insert base profile row, now with a generated short_code
  INSERT INTO public.profiles (
    id,
    name,
    phone,
    role,
    points,
    short_code
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', NEW.phone, ''),
    'user',
    0,
    v_new_short_code
  )
  ON CONFLICT (id) DO NOTHING;

  -- 2. Check for referred_by metadata (now expected to be a short_code, not a uuid)
  v_ref_raw := NEW.raw_user_meta_data->>'referred_by';

  IF v_ref_raw IS NOT NULL AND v_ref_raw <> '' THEN
    SELECT id INTO v_referrer_id
    FROM public.profiles
    WHERE short_code = UPPER(TRIM(v_ref_raw));

    IF v_referrer_id IS NOT NULL AND v_referrer_id <> NEW.id THEN
      UPDATE public.profiles
      SET
        referred_by = v_referrer_id,
        points = COALESCE(points, 0) + 30
      WHERE id = NEW.id;

      INSERT INTO public.referral_rewards_log (
        referrer_id,
        referred_id,
        reward_type,
        points_awarded,
        logged_at
      ) VALUES (
        v_referrer_id,
        NEW.id,
        'signup_bonus',
        30,
        NOW()
      );
    END IF;
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