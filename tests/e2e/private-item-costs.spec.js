// Cost prices moved off the public menu rows into the admin-only item_costs
// table. The Menu CRM must still show them, and saving one must write to
// item_costs, never back onto the public menu_items row.
import { test, expect } from '@playwright/test';
import { mockSupabase, loginAsDevAdmin } from './helpers.js';

const MENU = [{ id: 'm1', name: 'Test Fries', category: 'SIDES', price: 700, in_stock: true, stock_quantity: 10, sort_order: 1 }];
const COSTS = [{ item_kind: 'menu', item_id: 'm1', cost_price: 210 }];

test('Menu CRM reads and saves cost prices through item_costs', async ({ page }) => {
  const writes = [];
  page.on('request', (req) => {
    if (req.method() !== 'GET' && req.url().includes('/rest/v1/')) writes.push({ url: req.url(), body: req.postData() || '' });
  });
  await mockSupabase(page, { '/rest/v1/menu_items': MENU, '/rest/v1/item_costs': COSTS });
  await loginAsDevAdmin(page);
  await page.click('button:has-text("Menu CRM")');

  // RM7.00 price, RM2.10 cost -> 70% margin, read from item_costs.
  await expect(page.locator('text=RM 2.10 · 70%')).toHaveCount(1);

  const row = page.locator('tr', { hasText: 'Test Fries' });
  await row.locator('button[title="Edit cost price"]').click();
  await row.locator('input.price-input[step="0.10"]').fill('2.50');
  await row.locator('button:has-text("Save")').click();
  await expect(page.locator('text=RM 2.50 · 64%')).toHaveCount(1);

  const costWrite = writes.find(w => w.url.includes('/rest/v1/item_costs'));
  expect(costWrite, 'cost saved to item_costs').toBeTruthy();
  expect(JSON.parse(costWrite.body)).toMatchObject({ item_kind: 'menu', item_id: 'm1', cost_price: 250 });
  expect(writes.some(w => w.url.includes('/rest/v1/menu_items') && w.body.includes('cost_price')), 'no cost on menu_items').toBe(false);
});
