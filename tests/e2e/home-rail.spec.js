// Home page "What KK is ordering right now": five cards with the MONSTA Platter last,
// the Kawan says it feeds 2-3, and no fries weight is printed.
import { test, expect } from '@playwright/test';
import { mockSupabase } from './helpers.js';

const item = (id, name, category, price) => ({
  id, name, category, price, description: 'x', image: '/images/bbqbeefburger.jpg', in_stock: true, stock_quantity: 50, sort_order: Number(id),
});
const MENU = [
  item('1', 'Jucy Bae', 'PREMIUM', 1890),
  item('2', 'Monsta Fries', 'SIDES', 1450),
  item('17', 'Kawan MONSTA', 'PLATTERS', 3550),
  item('4', 'CZ Chix Burger', 'BBQ', 1690),
  item('14', 'MONSTA Platter', 'PLATTERS', 6690),
];

test.use({ viewport: { width: 375, height: 800 } });

test('The rail has five cards, the platter is last, the Kawan feeds 2-3 and no weight is shown', async ({ page }) => {
  await mockSupabase(page, { '/rest/v1/menu_items': MENU, '/rest/v1/rpc/': null });
  await page.goto('/', { waitUntil: 'networkidle' });

  const cards = page.locator('.c-craving-card');
  await expect(cards).toHaveCount(5);
  await expect(cards.last()).toContainText('MONSTA PLATTER');
  await expect(cards.last()).toContainText('RM 66.90');
  await expect(cards.last()).toContainText('SHARE THE LOT');
  await expect(page.locator('.c-craving-card', { hasText: 'KAWAN MONSTA' })).toContainText('FEEDS 2–3');

  await expect(page.locator('.c-deal-card--highlight')).toContainText('Feeds 2–3 · from RM 11.83/head');
  await expect(page.getByText('FEEDS 3–4')).toHaveCount(0);
  await expect(page.locator('.c-portion-badge')).toContainText('+RM 4.50');
  await expect(page.locator('body')).not.toContainText(/\b\d+\s?g\b(?!\w)/);
});
