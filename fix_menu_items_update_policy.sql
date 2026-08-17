-- Migration to add admin_update_menu_item_price and admin_update_menu_item RPCs
CREATE OR REPLACE FUNCTION public.admin_update_menu_item_price(
  p_id text,
  p_price integer
) RETURNS void AS $$
BEGIN
  UPDATE public.menu_items
  SET price = p_price
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.admin_update_menu_item(
  p_id text,
  p_name text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_price integer DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_image text DEFAULT NULL,
  p_in_stock boolean DEFAULT NULL
) RETURNS void AS $$
BEGIN
  UPDATE public.menu_items
  SET 
    name = COALESCE(p_name, name),
    category = COALESCE(p_category, category),
    price = COALESCE(p_price, price),
    description = COALESCE(p_description, description),
    image = COALESCE(p_image, image),
    in_stock = COALESCE(p_in_stock, in_stock)
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ensure RLS policy allows update if authenticated or public
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'menu_items' AND policyname = 'Allow public update menu_items'
  ) THEN
    CREATE POLICY "Allow public update menu_items" ON public.menu_items
      FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
END $$;
