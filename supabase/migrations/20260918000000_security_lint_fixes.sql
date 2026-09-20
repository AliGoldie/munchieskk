-- Fixes for Supabase security linter warnings (function_search_path_mutable,
-- public_bucket_allows_listing) plus a realtime publication gap found while
-- investigating a recurring Egress overage: StoreContext.jsx subscribes to
-- postgres_changes on store_settings and profiles, but neither table was
-- ever added to the supabase_realtime publication, so those subscriptions
-- silently receive no events and the app's polling fallback never turns off.

-- 1. Pin search_path on functions the linter flagged as mutable, so they
-- can't be tricked by a role-level search_path change into resolving an
-- unqualified name against an unexpected schema.
ALTER FUNCTION public.cancel_order(text, text, text, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.validate_and_apply_promo(text, integer, uuid, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.is_admin() SET search_path = public, pg_temp;
ALTER FUNCTION public.calculate_order_points(jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.generate_unique_redemption_code() SET search_path = public, pg_temp;
ALTER FUNCTION public.place_order(jsonb, jsonb, text, text, jsonb, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.deduct_stock_for_loyverse(text, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.generate_unique_short_code() SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_temp;

-- 2. Drop the two duplicate, unrestricted SELECT policies on menu-images.
-- The bucket is already marked public in storage.buckets, so direct object
-- GET by URL works regardless of RLS -- these policies only ever served to
-- let anyone enumerate every filename in the bucket via the list API.
DROP POLICY IF EXISTS "Allow public viewing" ON storage.objects;
DROP POLICY IF EXISTS "Public Read Access" ON storage.objects;

-- 3. Add the two tables StoreContext.jsx subscribes to but that were never
-- published, so realtime updates actually arrive instead of the client
-- falling back to fast polling indefinitely.
ALTER PUBLICATION supabase_realtime ADD TABLE public.store_settings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
