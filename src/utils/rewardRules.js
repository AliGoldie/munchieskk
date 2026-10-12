// Client-side mirror of the checks in the apply_order_reward database
// function, used only to grey out rewards that would be refused. The server
// stays the authority.
export function rewardBlockReason(p, { points, menu, addons, itemAddons, cart, orderTotal }) {
  const n = (v) => Number(v || 0).toLocaleString();
  if ((points || 0) < p.points_cost) return `${n(p.points_cost - (points || 0))} more pts`;
  const min = Math.max(p.min_order_cents ?? 0, 1);
  if (orderTotal < min) return `Spend RM ${(min / 100).toFixed(2)}+`;
  if (p.menu_item_id) {
    const m = (menu || []).find(x => String(x.id) === String(p.menu_item_id));
    if (!m || m.inStock === false || (m.stock_quantity ?? 1) < 1) return 'Out of stock';
  } else {
    const a = (addons || []).find(x => String(x.id) === String(p.addon_id));
    if (!a || a.in_stock === false || (a.stock_quantity ?? 1) < 1) return 'Out of stock';
    const fits = (cart || []).some(ci => (itemAddons?.[ci.id] || []).map(String).includes(String(p.addon_id)));
    if (!fits) return 'Needs a matching burger';
  }
  return null;
}
