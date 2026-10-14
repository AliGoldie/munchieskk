// A rough "about N more orders" for the next reward. Uses the customer's own
// last collected orders (points earned + the 6 collection bonus); a customer
// with no collected order yet gets a typical RM25 order (31 points).
const COLLECTION_BONUS = 6;
const TYPICAL_ORDER_POINTS = 31;

export function ordersToGo(pointsAway, orders) {
  if (!(pointsAway > 0)) return null;
  const recent = (orders || [])
    .filter((o) => o.status === 'COLLECTED' && Number(o.points_earned) > 0)
    .slice(0, 5);
  const perOrder = recent.length
    ? recent.reduce((sum, o) => sum + Number(o.points_earned) + COLLECTION_BONUS, 0) / recent.length
    : TYPICAL_ORDER_POINTS;
  return Math.max(1, Math.ceil(pointsAway / perOrder));
}

export function ordersToGoText(pointsAway, orders) {
  const n = ordersToGo(pointsAway, orders);
  if (n == null) return '';
  return n === 1 ? 'about 1 more order' : `about ${n} more orders`;
}
