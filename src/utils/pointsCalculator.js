/**
 * Points per item based on the actual category field value.
 *
 * BBQ      = 15 pts
 * PREMIUM  = 20 pts
 * PLATTERS = 30 pts
 * SIDES    = 5 pts
 * DRINKS   = 10 pts
 * fallback = 10 pts (unknown or missing category)
 */

const CATEGORY_POINTS = {
  'BBQ': 15,
  'PREMIUM': 20,
  'PLATTERS': 30,
  'SIDES': 5,
  'DRINKS': 10
};

export function getItemPoints(item) {
  if (!item) return 0;
  const category = (item.category || '').toUpperCase();
  return CATEGORY_POINTS[category] ?? 10;
}

export function calculateOrderPoints(items) {
  if (!items || !Array.isArray(items)) return 0;
  return items.reduce((total, item) => {
    const qty = item.quantity || 1;
    return total + (getItemPoints(item) * qty);
  }, 0);
}
