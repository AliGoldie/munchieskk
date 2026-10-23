// Meat swaps on burgers and platters. The ladder (beef 0, chicken +RM1,
// lamb +RM2) and each burger's slots come from the database
// (meat_ladder, swap_slots). The server prices every order itself
// (price_meat_choices); this file only mirrors it so the customer sees the
// charge before paying. A swap costs the difference going UP the ladder from
// the burger's own meat; going down or staying level is free.
export const MEAT_LABEL = { beef: 'Beef', chicken: 'Chicken', lamb: 'Lamb' };
export const MEATS = ['beef', 'chicken', 'lamb'];
const FALLBACK_LADDER = { beef: 0, chicken: 100, lamb: 200 };

export function ladderMap(rows) {
  const map = { ...FALLBACK_LADDER };
  (rows || []).forEach((r) => { if (r && r.meat in map) map[r.meat] = Number(r.rank_cents) || 0; });
  return map;
}

export const slotsFor = (swapSlots, itemId) =>
  (swapSlots || []).filter((s) => String(s.menu_item_id) === String(itemId)).sort((a, b) => a.slot_no - b.slot_no);

// The meat a slot starts with. For a "choose a burger" slot it is the chosen
// burger's own meat; null means that burger's meat is fixed (CZ Chix).
export function baseMeat(slot, pickedItemId, swapSlots) {
  if (!slot.pick_category) return slot.default_meat;
  if (!pickedItemId) return null;
  const own = (swapSlots || []).find(
    (s) => String(s.menu_item_id) === String(pickedItemId) && s.slot_no === 1 && !s.pick_category
  );
  return own ? own.default_meat : null;
}

export function choiceCharge(slot, choice, swapSlots, ladder) {
  const base = baseMeat(slot, choice?.item_id, swapSlots);
  if (!base || !choice?.meat) return 0;
  return Math.max(0, (ladder[choice.meat] ?? 0) - (ladder[base] ?? 0));
}

export function totalSwapCharge(itemId, choices, swapSlots, ladder) {
  const slots = slotsFor(swapSlots, itemId);
  return (choices || []).reduce((sum, c) => {
    const slot = slots.find((s) => s.slot_no === c.slot);
    return slot ? sum + choiceCharge(slot, c, swapSlots, ladder) : sum;
  }, 0);
}

// Starting choices for an item's slots: every ordinary slot keeps its normal
// meat; "choose a burger" slots start empty.
export function defaultChoices(slots) {
  return slots.map((s) => (s.pick_category ? { slot: s.slot_no, item_id: '', meat: '' } : { slot: s.slot_no, meat: s.default_meat }));
}

export const choicesComplete = (slots, choices) =>
  slots.every((s) => !s.pick_category || (choices.find((c) => c.slot === s.slot_no)?.item_id));

// Only what the server needs: it works out names and charges itself.
export function toServerChoices(choices) {
  return (choices || []).map((c) => {
    const out = { slot: c.slot };
    if (c.item_id) out.item_id = c.item_id;
    if (c.meat) out.meat = c.meat;
    return out;
  });
}

// Part of a cart line's identity: the same burger with different meat is a
// different line.
export const choiceKey = (choices) =>
  (choices || []).length ? 'm' + (choices || []).map((c) => `${c.slot}${c.item_id || ''}${c.meat || ''}`).join('-') : '';

export function cartLineId(itemId, selectedAddons, choices) {
  const addonKey = (selectedAddons || []).map((a) => a.id).sort().join('_');
  const parts = [itemId];
  if (addonKey) parts.push(addonKey);
  const ck = choiceKey(choices);
  if (ck) parts.push(ck);
  return parts.join('_');
}

// Lines of text for a saved or in-cart choice list.
// Single burger: "Chicken". Platter: "Burger 1: Chicken", "Big-G (Lamb)".
export function describeChoices(choices) {
  const list = (choices || []).filter((c) => c);
  if (list.length === 0) return [];
  const picks = list.some((c) => c.name || c.item_id);
  if (list.length === 1 && !picks) return [MEAT_LABEL[list[0].meat] || ''];
  return list.map((c) => {
    const meat = MEAT_LABEL[c.meat] || '';
    if (c.name) return meat ? `${c.name} (${meat})` : c.name;
    return `Burger ${c.slot}: ${meat}`;
  });
}
