// The two reward currencies, in one place so the names are easy to change.
// Decided 19 Oct 2026 (content team + owner):
//   - COINS: the spendable currency (earned on orders, spent on free food).
//     Was called "points" / "Order Points".
//   - XP: the game tally (contest + weekly goal). NOT spendable.
//     Was called "Arcade Score".
// Only the customer-facing LABELS changed. Database columns and functions
// still use `points` / `arcade_score` internally; nothing about the maths moved.
export const COINS = 'Monsta Coins';   // plural, e.g. "250 Monsta Coins"
export const COIN = 'Monsta Coin';     // singular, e.g. "1 Monsta Coin per RM1"
export const COINS_SHORT = 'Coins';    // compact badge, replaces "PTS"/"POINTS"
export const XP = 'Burger XP';         // the game tally
