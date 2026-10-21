// Scheduled reward price drops: customers see a notice before the date and
// the new price once the date has come; staff schedule a drop from the
// Prizes CRM, and a price rise is refused.
import { test, expect } from '@playwright/test';
import { mockSupabase, loginAsDevAdmin } from './helpers.js';

const myDate = (days) => new Date(Date.now() + 8 * 3600e3 + days * 86400e3).toISOString().slice(0, 10);

const PRIZES = [
  { id: 'p1', name: 'Ice BB', points_cost: 350, new_points_cost: 250, new_cost_from: myDate(40), is_active: true, menu_item_id: null, addon_id: null },
  { id: 'p2', name: 'FREE FRIES', points_cost: 100, new_points_cost: 80, new_cost_from: myDate(-1), is_active: true, menu_item_id: null, addon_id: null },
  { id: 'p3', name: 'Free Cheese', points_cost: 50, new_points_cost: null, new_cost_from: null, is_active: true, menu_item_id: null, addon_id: null },
];

test('Loyalty shows the coming price drop, and the new price once its date has come', async ({ page }) => {
  // Database functions answer "nothing" (null), as for a guest.
  await mockSupabase(page, { '/rest/v1/loyalty_prizes': PRIZES, '/rest/v1/rpc/': null });
  await page.goto('/loyalty', { waitUntil: 'networkidle' });

  await expect(page.locator('.expiry-banner', { hasText: 'Lower prices coming' })).toContainText('Ice BB: 250 Monsta Coins from');
  await expect(page.locator('.expiry-banner', { hasText: 'Lower prices coming' })).toContainText('(now 350)');
  // Fries' date has passed: it shows 80, and is not in the notice.
  await expect(page.locator('.prize-card', { hasText: 'FREE FRIES' }).locator('.pts-req')).toContainText('80 Coins');
  await expect(page.locator('.expiry-banner', { hasText: 'Lower prices coming' })).not.toContainText('FREE FRIES');
});

test('Prizes CRM schedules a price drop and refuses a rise', async ({ page }) => {
  const writes = [];
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && req.url().includes('/rest/v1/loyalty_prizes')) writes.push(JSON.parse(req.postData() || '{}'));
  });
  await mockSupabase(page, { '/rest/v1/loyalty_prizes': PRIZES });
  await loginAsDevAdmin(page);
  await page.click('button:has-text("Prizes CRM")');

  const row = page.locator('tr', { hasText: 'Free Cheese' });
  await row.locator('button:has-text("Schedule price drop")').click();

  // A higher price is refused before anything is saved.
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await row.locator('input[placeholder="New price"]').fill('60');
  await row.locator('button:has-text("Save")').click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain('must be lower than 50');
  expect(writes).toHaveLength(0);

  await row.locator('input[placeholder="New price"]').fill('40');
  await row.locator('button:has-text("Save")').click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ new_points_cost: 40, new_cost_from: myDate(30) });
  await expect(row).toContainText('Drops to 40 on');
});
