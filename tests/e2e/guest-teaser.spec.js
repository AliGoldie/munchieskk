// Guests get a taste of the Prize Vault (three highlighted rewards plus a locked
// card for the rest) and must log in to play the games; logged-in customers see
// everything. Hidden reward names must not appear for guests.
import { test, expect } from '@playwright/test';
import { mockSupabase, loginAsDevAdmin, goClientSide } from './helpers.js';

const prize = (n) => ({ id: `p${n}`, name: `Reward ${n}`, points_cost: n * 50, is_active: true, menu_item_id: null, addon_id: null, new_points_cost: null, new_cost_from: null });
const EIGHT = [1, 2, 3, 4, 5, 6, 7, 8].map(prize);
const STORE = { id: 'main_store', status: 'OPEN', weekly_schedule: {}, special_closures: [], arcade_enabled: true };

test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

test('A guest sees three highlighted rewards and a locked card, not the whole vault', async ({ page }) => {
  await mockSupabase(page, { '/rest/v1/loyalty_prizes': EIGHT, '/rest/v1/rpc/': null });
  await page.goto('/loyalty', { waitUntil: 'networkidle' });

  const cards = page.locator('.prize-teaser');
  await expect(cards).toHaveCount(3);
  // The cheapest, the middle one and the biggest.
  await expect(cards.nth(0)).toContainText('Reward 1');
  await expect(cards.nth(1)).toContainText('Reward 4');
  await expect(cards.nth(2)).toContainText('Reward 8');
  for (const hidden of [2, 3, 5, 6, 7]) await expect(page.getByText(`Reward ${hidden}`, { exact: true })).toHaveCount(0);

  await expect(page.locator('.prize-mystery')).toContainText('5 MORE REWARDS');
  await expect(page.locator('.promo-banner a.promo-cta')).toHaveAttribute('href', '/signup');
  await expect(page.locator('.prize-mystery a')).toHaveAttribute('href', '/login');
  await expect(page.getByText('LOCKED', { exact: true })).toHaveCount(0);
});

test('With three rewards or fewer a guest sees them all and no locked card', async ({ page }) => {
  await mockSupabase(page, { '/rest/v1/loyalty_prizes': EIGHT.slice(0, 3), '/rest/v1/rpc/': null });
  await page.goto('/loyalty', { waitUntil: 'networkidle' });
  await expect(page.locator('.prize-teaser')).toHaveCount(3);
  await expect(page.locator('.prize-mystery')).toHaveCount(0);
});

test('A logged-in customer sees the whole vault', async ({ page }) => {
  await mockSupabase(page, { '/rest/v1/loyalty_prizes': EIGHT, '/rest/v1/rpc/': null });
  await loginAsDevAdmin(page);
  await goClientSide(page, '/loyalty');
  await expect(page.locator('.prize-card')).toHaveCount(8);
  await expect(page.locator('.prize-mystery')).toHaveCount(0);
});

test('A guest cannot start a game: tapping one points them to the log-in banner', async ({ page }) => {
  await mockSupabase(page, { '/rest/v1/store_settings': STORE, '/rest/v1/rpc/': null });
  await page.goto('/arcade', { waitUntil: 'networkidle' });

  const banner = page.locator('.promo-banner').filter({ hasText: 'PRIZES AWAIT' });
  await expect(banner).toBeVisible();
  await expect(banner.locator('a.promo-cta')).toHaveAttribute('href', '/login');
  await expect(page.locator('.game-lock-chip')).toHaveCount(3);

  await page.locator('.game-card').first().click();
  await expect(banner).toHaveClass(/is-nudged/);
  expect(new URL(page.url()).pathname).toBe('/arcade');
  await expect(page.locator('canvas')).toHaveCount(0); // no game started
});

test('Reduced motion switches the padlock and ring animation off', async ({ page }) => {
  await mockSupabase(page, { '/rest/v1/loyalty_prizes': EIGHT, '/rest/v1/rpc/': null });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/loyalty', { waitUntil: 'networkidle' });
  const name = await page.locator('.promo-lock').evaluate((e) => getComputedStyle(e).animationName);
  expect(name).toBe('none');
});

test('The Home page invites a guest to join the Monsta Gang, and a logged-in customer does not see it', async ({ page }) => {
  await mockSupabase(page, { '/rest/v1/loyalty_prizes': EIGHT, '/rest/v1/rpc/': null });
  await page.goto('/', { waitUntil: 'networkidle' });

  const join = page.locator('.c-join .promo-banner');
  await expect(join).toContainText('JOIN THE MONSTA GANG');
  await expect(join.locator('a.promo-cta')).toHaveAttribute('href', '/signup');
  await expect(join.locator('a.promo-link')).toHaveAttribute('href', '/login');
  // The vault card for a guest is an invitation, not a "0 Coins" balance.
  await expect(page.locator('.c-vault-card--guest')).toContainText('Monsta Coins');
  await expect(page.locator('.c-vault-card--guest')).not.toContainText('0 Coins');

  await loginAsDevAdmin(page);
  await goClientSide(page, '/');
  await expect(page.locator('.c-join')).toHaveCount(0);
  await expect(page.locator('.c-vault-card--guest')).toHaveCount(0);
  await expect(page.locator('.c-vault-label')).toHaveText('YOUR VAULT');
});
