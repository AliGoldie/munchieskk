// Small "tightness" checks across customer pages: exactly one main heading
// (screen readers and search engines), sensible tab titles, and tap targets
// that are comfortable for a thumb.
import { test, expect } from '@playwright/test';
import { mockSupabase } from './helpers.js';

const MENU = [{ id: '1', name: 'BBQ Beef', category: 'BBQ', price: 1290, description: 'x', image: '/images/bbqbeefburger.jpg', in_stock: true, stock_quantity: 50, sort_order: 1 }];
const STORE = { id: 'main_store', status: 'OPEN', weekly_schedule: {}, special_closures: [], arcade_enabled: true };
test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

test('Every customer page has exactly one main heading', async ({ page }) => {
  await mockSupabase(page, { '/rest/v1/menu_items': MENU, '/rest/v1/store_settings': STORE, '/rest/v1/rpc/': null });
  for (const path of ['/', '/menu', '/loyalty', '/arcade', '/cart', '/login', '/signup', '/reset-password', '/catering', '/privacy']) {
    await page.goto(path, { waitUntil: 'networkidle' });
    expect(await page.locator('h1').count(), `${path} should have exactly one h1`).toBe(1);
  }
});

test('The leaderboard tab title is not "Page not found"', async ({ page }) => {
  await mockSupabase(page, { '/rest/v1/menu_items': MENU, '/rest/v1/store_settings': STORE, '/rest/v1/rpc/': null });
  await page.goto('/leaderboard', { waitUntil: 'networkidle' });
  await expect(page).toHaveTitle('MunchiesKK');
});

test('Stand-alone links and tabs are comfortable to tap', async ({ page }) => {
  await mockSupabase(page, { '/rest/v1/menu_items': MENU, '/rest/v1/store_settings': STORE, '/rest/v1/rpc/': null });
  const tall = async (sel, min) => {
    const boxes = await page.locator(sel).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(boxes.length, `${sel} found`).toBeGreaterThan(0);
    for (const h of boxes) expect(h, `${sel} height`).toBeGreaterThanOrEqual(min);
  };
  await page.goto('/leaderboard', { waitUntil: 'networkidle' });
  await tall('.lb-tab', 36);
  await tall('.site-footer-links a', 40);
  await page.goto('/loyalty', { waitUntil: 'networkidle' });
  await tall('.promo-link', 44);
});
