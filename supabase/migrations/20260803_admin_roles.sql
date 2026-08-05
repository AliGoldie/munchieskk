-- 1. Add role column to profiles table if it doesn't exist
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text DEFAULT 'user';

-- 2. Create a helper function to check if the current user is an admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Enable RLS on tables
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 4. Set up policies for menu_items
DROP POLICY IF EXISTS "Public can view menu_items" ON public.menu_items;
CREATE POLICY "Public can view menu_items" ON public.menu_items
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can insert menu_items" ON public.menu_items;
CREATE POLICY "Admins can insert menu_items" ON public.menu_items
  FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update menu_items" ON public.menu_items;
CREATE POLICY "Admins can update menu_items" ON public.menu_items
  FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete menu_items" ON public.menu_items;
CREATE POLICY "Admins can delete menu_items" ON public.menu_items
  FOR DELETE USING (public.is_admin());

-- 5. Set up policies for addons
DROP POLICY IF EXISTS "Public can view addons" ON public.addons;
CREATE POLICY "Public can view addons" ON public.addons
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage addons" ON public.addons;
CREATE POLICY "Admins can manage addons" ON public.addons
  USING (public.is_admin());

-- 6. Set up policies for item_addons
DROP POLICY IF EXISTS "Public can view item_addons" ON public.item_addons;
CREATE POLICY "Public can view item_addons" ON public.item_addons
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage item_addons" ON public.item_addons;
CREATE POLICY "Admins can manage item_addons" ON public.item_addons
  USING (public.is_admin());

-- 7. Set up policies for orders
DROP POLICY IF EXISTS "Users can insert orders" ON public.orders;
CREATE POLICY "Users can insert orders" ON public.orders
  FOR INSERT WITH CHECK (true); -- Usually you'd check auth.uid() == user_id, but guest checkout might exist

DROP POLICY IF EXISTS "Users can view their own orders" ON public.orders;
CREATE POLICY "Users can view their own orders" ON public.orders
  FOR SELECT USING (
    (auth.uid() = user_id) OR public.is_admin()
  );

DROP POLICY IF EXISTS "Admins can update orders" ON public.orders;
CREATE POLICY "Admins can update orders" ON public.orders
  FOR UPDATE USING (public.is_admin());

-- 8. Set up policies for profiles
DROP POLICY IF EXISTS "Users can view and update own profile" ON public.profiles;
CREATE POLICY "Users can view and update own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id OR public.is_admin());

-- Notice: By default, new profiles get the 'user' role.
-- To make someone an admin, update their profile manually in the Supabase Dashboard:
-- UPDATE public.profiles SET role = 'admin' WHERE email = 'admin@example.com';
