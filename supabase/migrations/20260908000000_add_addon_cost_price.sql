-- Mirrors menu_items.cost_price: lets admins record what an add-on
-- actually costs to buy, so Analytics can stop treating every add-on
-- sale as pure profit. Nullable/optional, same as the menu item version --
-- add-ons without it set just don't contribute to the real-cost side of
-- the margin calc yet (falls back to the existing flat-estimate behavior
-- wherever that fallback already applies).
ALTER TABLE public.addons ADD COLUMN IF NOT EXISTS cost_price integer;

COMMENT ON COLUMN public.addons.cost_price IS
  'Cost to buy/make one unit, in cents. NULL = not set yet.';
