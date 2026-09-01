-- Lets admins reorder menu items (within their category) and add-ons
-- (as a flat list) instead of always displaying in creation-date order.
-- Backfills sort_order from existing created_at order so nothing visibly
-- reshuffles the first time this runs.

ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS sort_order integer;
ALTER TABLE public.addons ADD COLUMN IF NOT EXISTS sort_order integer;

UPDATE public.menu_items m
SET sort_order = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY category ORDER BY created_at ASC) AS rn
  FROM public.menu_items
) sub
WHERE m.id = sub.id AND m.sort_order IS NULL;

UPDATE public.addons a
SET sort_order = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
  FROM public.addons
) sub
WHERE a.id = sub.id AND a.sort_order IS NULL;
