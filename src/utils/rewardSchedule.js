import { getMalaysiaParts, addMalaysiaDays } from './timeUtils';

// A reward's Monsta Coin price can be lowered from a set date
// (loyalty_prizes.new_points_cost from new_cost_from, Malaysia time). The
// database makes the switch (apply_due_reward_prices); these keep the page
// right in the meantime and show the notice before the date.
const todayMY = () => getMalaysiaParts().dateStr;

// The price to show and check against today: the new one once its date has come.
export function withDuePrice(prize) {
  if (prize?.new_cost_from && prize.new_points_cost != null && prize.new_cost_from <= todayMY()) {
    return { ...prize, points_cost: Math.min(prize.points_cost, prize.new_points_cost), new_points_cost: null, new_cost_from: null };
  }
  return prize;
}

// { cost, from } when a lower price is coming, else null.
export function upcomingPriceChange(prize) {
  if (prize?.new_cost_from && prize.new_points_cost != null && prize.new_cost_from > todayMY()) {
    return { cost: prize.new_points_cost, from: prize.new_cost_from };
  }
  return null;
}

// The earliest start date the database accepts (30 days' notice).
export const earliestPriceChangeDate = () => addMalaysiaDays(todayMY(), 30);

export const fmtMYDate = (dateStr) =>
  new Date(`${dateStr}T00:00:00+08:00`).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuching' });
