-- Admin CRM brief §2 (Customers -> a real CRM): editable tags + a counter
-- note per customer. The existing profiles UPDATE policy ("auth.uid() = id
-- OR is_admin()") already covers admin writes to these; the column-protection
-- trigger from 20260826000005_lock_down_profiles_and_bonus_rpcs.sql only
-- resets points/role on every update, so it doesn't need touching for these
-- two new columns to be writable by admin.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS note text;
