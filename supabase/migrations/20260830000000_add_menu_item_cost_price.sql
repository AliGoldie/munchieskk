-- Adds a real per-item cost price so redemption "loss" and Analytics
-- margins can use actual numbers instead of the flat 40% COGS guess
-- hardcoded in Admin.jsx's analytics calc. Nullable and additive only:
-- items with no cost_price set keep behaving exactly as before (the
-- client falls back to the 40% estimate per item until an admin fills
-- this in), so this ships with zero risk to existing behavior.
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS cost_price integer;

COMMENT ON COLUMN public.menu_items.cost_price IS
  'Cost to make one unit, in cents. NULL = not set yet, client falls back to a 40% of price estimate.';
