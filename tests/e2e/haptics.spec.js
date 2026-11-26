// Button vibration: a short buzz on the bottom tabs, a Profile switch to turn it off,
// and no switch at all on phones that cannot vibrate (iPhone).
import { test, expect } from '@playwright/test';
import { mockSupabase, loginAsDevAdmin, goClientSide } from './helpers.js';

const stubVibrate = (page, supported = true) => page.addInitScript((on) => {
  window.__buzz = [];
  if (on) navigator.vibrate = (p) => { window.__buzz.push(p); return true; };
  else Object.defineProperty(Navigator.prototype, 'vibrate', { value: undefined, configurable: true });
}, supported);

test('Bottom tabs buzz, and the Profile switch turns the buzz off and stays off', async ({ page }) => {
  await stubVibrate(page, true);
  await mockSupabase(page, { '/rest/v1/rpc/': null });
  await loginAsDevAdmin(page);
  await goClientSide(page, '/loyalty');

  await page.evaluate(() => { window.__buzz = []; });
  await page.locator('.bottom-nav a[href="/menu"]').click();
  expect(await page.evaluate(() => window.__buzz)).toEqual([8]);

  await page.locator('.bottom-nav a[href="/profile"]').click();
  const toggle = page.getByLabel('Button vibration');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  expect(await page.evaluate(() => localStorage.getItem('munchies_haptics'))).toBe('0');

  await page.evaluate(() => { window.__buzz = []; });
  await page.locator('.bottom-nav a[href="/menu"]').click();
  expect(await page.evaluate(() => window.__buzz)).toEqual([]);
});

test('A phone that cannot vibrate sees no vibration switch', async ({ page }) => {
  await stubVibrate(page, false);
  await mockSupabase(page, { '/rest/v1/rpc/': null });
  await loginAsDevAdmin(page);
  await goClientSide(page, '/profile');
  await expect(page.getByRole('heading', { name: 'My Profile' }).first()).toBeVisible();
  await expect(page.getByLabel('Button vibration')).toHaveCount(0);
});
