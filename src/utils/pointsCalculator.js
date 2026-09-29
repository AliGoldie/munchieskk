/**
 * RM1 = 1 point, matching the server-side award in handle_order_placed()
 * (supabase/migrations/20260929000003_switch_order_points_to_rm1_equals_1pt.sql).
 * item.price is in cents.
 */

export function getItemPoints(item) {
  if (!item) return 0;
  return Math.round((item.price || 0) / 100);
}

export function calculateOrderPoints(items) {
  if (!items || !Array.isArray(items)) return 0;
  return items.reduce((total, item) => {
    const qty = item.quantity || 1;
    return total + (getItemPoints(item) * qty);
  }, 0);
}
