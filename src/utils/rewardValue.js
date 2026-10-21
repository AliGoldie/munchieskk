// What a reward is worth at the menu price, in cents (null when we cannot tell,
// e.g. the item or add-on is not loaded). Display only; the server decides
// what an order is charged.
export function rewardValueCents(prize, menu, addons) {
  if (!prize) return null;
  const find = (list, id) => (list || []).find((x) => String(x.id) === String(id));
  const src = prize.menu_item_id ? find(menu, prize.menu_item_id) : prize.addon_id ? find(addons, prize.addon_id) : null;
  const price = Number(src?.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function rewardValueText(prize, menu, addons) {
  const cents = rewardValueCents(prize, menu, addons);
  return cents == null ? '' : `worth RM ${(cents / 100).toFixed(2)}`;
}
