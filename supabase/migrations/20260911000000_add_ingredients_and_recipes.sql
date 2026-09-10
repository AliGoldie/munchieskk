-- Phase 1 (foundation) of ingredient-level inventory: menu items and add-ons
-- currently track their own stock_quantity independently, with no relationship
-- to the raw materials that make them (e.g. selling a Monsta Fries doesn't
-- touch Beef Strips stock, and there's no way to see how many burgers the
-- remaining buns can still make). This adds ingredients + recipes as a new,
-- optional layer -- an item with no recipe rows is completely unaffected and
-- keeps working exactly as today. Auto-deducting ingredient stock at checkout
-- is a deliberate follow-up, not part of this migration -- place_order and
-- cancel_order are untouched here.

-- ============================================================
-- ingredients
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'piece',
  stock_quantity integer NOT NULL DEFAULT 0,
  cost_per_unit integer,
  low_stock_threshold integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage ingredients" ON public.ingredients;
CREATE POLICY "Admins can manage ingredients" ON public.ingredients
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ============================================================
-- ingredient_adjustments -- same audit-trail pattern as stock_adjustments
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ingredient_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  old_quantity integer,
  new_quantity integer NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingredient_adjustments_item_time
  ON public.ingredient_adjustments (ingredient_id, changed_at DESC);

ALTER TABLE public.ingredient_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read ingredient adjustments" ON public.ingredient_adjustments;
CREATE POLICY "Admins can read ingredient adjustments" ON public.ingredient_adjustments
  FOR SELECT USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.log_ingredient_adjustment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity THEN
    INSERT INTO public.ingredient_adjustments (ingredient_id, old_quantity, new_quantity)
    VALUES (NEW.id, OLD.stock_quantity, NEW.stock_quantity);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_ingredient_adjustment ON public.ingredients;
CREATE TRIGGER trg_log_ingredient_adjustment
AFTER UPDATE ON public.ingredients
FOR EACH ROW
EXECUTE FUNCTION public.log_ingredient_adjustment();

-- ============================================================
-- recipe_items -- links one menu item OR one add-on to one ingredient +
-- quantity. parent_id is app-enforced (no cross-table FK possible since it
-- can point at either menu_items or addons), same soft-reference approach
-- loyalty_prizes.menu_item_id already uses.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.recipe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_type text NOT NULL CHECK (parent_type IN ('menu_item', 'addon')),
  parent_id text NOT NULL,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  quantity_per_unit numeric NOT NULL CHECK (quantity_per_unit > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_type, parent_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_items_parent
  ON public.recipe_items (parent_type, parent_id);

ALTER TABLE public.recipe_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage recipe items" ON public.recipe_items;
CREATE POLICY "Admins can manage recipe items" ON public.recipe_items
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
