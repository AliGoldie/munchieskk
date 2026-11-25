// Burger Rank card: hero with progress, the ladder (reached / next / locked) and the coupon book.
import { test, expect } from '@playwright/test';
import { mockSupabase, loginAsDevAdmin, goClientSide } from './helpers.js';

const TIERS = [
  { name: 'Rookie', min_spend_cents: 0, claims_per_month: 1, bonus_percent: 0 },
  { name: 'Regular', min_spend_cents: 10000, claims_per_month: 2, bonus_percent: 0 },
  { name: 'Pro', min_spend_cents: 30000, claims_per_month: 3, bonus_percent: 5 },
  { name: 'Master', min_spend_cents: 60000, claims_per_month: 4, bonus_percent: 8 },
  { name: 'Ultimate', min_spend_cents: 120000, claims_per_month: 5, bonus_percent: 12 },
];
const RANK = {
  tier: 'Regular', spend_cents: 14200, min_spend_cents: 10000, next_tier: 'Pro', next_min_spend_cents: 30000,
  rm_to_next_cents: 15800, claims_per_month: 2, claims_used: 1, bonus_percent: 0, tiers: TIERS,
};
const PERK = (id, name, rank, period, min, extra = {}) => ({
  id, name, rank, period, min_order_cents: min, unlocked: false, used: false, needs_birthday: false, birthday_month_now: true, ...extra,
});
const PERKS = [
  PERK('k1', 'Regular perk: free Cheese', 'Regular', 'once', 2000, { unlocked: true }),
  PERK('k2', 'Pro perk: birthday Ice BB', 'Pro', 'birthday', 2000),
  PERK('k3', 'Master perk: free Egg', 'Master', 'month', 2000),
  PERK('k4', 'Ultimate perk: yearly free platter', 'Ultimate', 'year', 3000),
];

test('Rank card shows progress, a ladder from Ultimate down, and the coupon book', async ({ page }) => {
  await mockSupabase(page, {
    '/rest/v1/rpc/my_tier': RANK,
    '/rest/v1/rpc/my_perks': PERKS,
    '/rest/v1/rpc/': null,
  });
  await loginAsDevAdmin(page);
  await goClientSide(page, '/loyalty');

  const hero = page.locator('.rk-hero');
  await expect(hero.locator('.rk-title')).toHaveText('Regular');
  await expect(hero).toContainText('You have spent RM142. Spend RM158 more to reach Pro.');
  await expect(hero).toContainText('REGULAR RM100');
  await expect(hero).toContainText('PRO RM300');
  await expect(hero.locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '21');
  await expect(hero).toContainText('1 of 2 rewards used this month');

  // Ladder: Ultimate on top, Rookie at the bottom; Rookie done, Regular current, Pro next, others locked.
  const rungs = page.locator('.rk-rung');
  await expect(rungs).toHaveCount(5);
  await expect(rungs.first()).toContainText('Ultimate');
  await expect(rungs.last()).toContainText('Rookie');
  await expect(page.locator('.rk-rung.rk-done')).toContainText('Done');
  await expect(page.locator('.rk-rung.rk-cur')).toContainText('You are here');
  await expect(page.locator('.rk-rung.rk-next')).toContainText('Next level · RM158 to go');
  await expect(page.locator('.rk-rung.rk-lock')).toHaveCount(2);
  await expect(page.locator('.rk-rung.rk-lock').first()).toContainText('Locked · RM1,058 to go');

  // Coupon book: one ready, three locked, each says when it unlocks.
  await expect(page.locator('.rk-coupon')).toHaveCount(4);
  await expect(page.locator('.rk-coupon-ready')).toContainText('Ready at checkout');
  await expect(page.locator('.rk-coupon-locked')).toHaveCount(3);
  await expect(page.locator('.rk-coupon-locked').first()).toContainText('Unlocks at Pro');
  await expect(page.locator('.rk-coupon-top')).toContainText('Once a year. With an order of RM30+.');

  // One h1 on the page (the rank name is a sub-heading).
  await expect(page.locator('h1')).toHaveCount(1);
});

test('Rank card at the top rank has no "next" line and a full bar', async ({ page }) => {
  const top = { ...RANK, tier: 'Ultimate', spend_cents: 130000, min_spend_cents: 120000, next_tier: null, next_min_spend_cents: null, rm_to_next_cents: null, claims_per_month: 5, bonus_percent: 12 };
  await mockSupabase(page, { '/rest/v1/rpc/my_tier': top, '/rest/v1/rpc/my_perks': [], '/rest/v1/rpc/': null });
  await loginAsDevAdmin(page);
  await goClientSide(page, '/loyalty');
  await expect(page.locator('.rk-hero')).toContainText('You are at the top rank.');
  await expect(page.locator('.rk-hero [role="progressbar"]')).toHaveAttribute('aria-valuenow', '100');
  await expect(page.locator('.rk-rung.rk-next')).toHaveCount(0);
  await expect(page.locator('.rk-coupon')).toHaveCount(0);
});

test('Rank card falls back to the plain header when rank data cannot load', async ({ page }) => {
  await mockSupabase(page, { '/rest/v1/rpc/': null });
  await loginAsDevAdmin(page);
  await goClientSide(page, '/loyalty');
  await expect(page.locator('.rk-hero .rk-title')).toHaveText('Loyalty rewards');
  await expect(page.locator('.rk-rung')).toHaveCount(0);
});
