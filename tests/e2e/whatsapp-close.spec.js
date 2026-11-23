// The floating WhatsApp bubble: dragging it onto the close target at the bottom
// hides it (for 30 days on this device), a message says where the link went,
// the footer keeps a WhatsApp link, and a drag that ends elsewhere just moves it.
import { test, expect } from '@playwright/test';
import { mockSupabase } from './helpers.js';

test.use({ viewport: { width: 375, height: 667 } });

async function open(page) {
  await mockSupabase(page, { '/rest/v1/rpc/': null });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.whatsapp-float-btn')).toBeVisible();
}
const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

test('Dragging the bubble onto the close target hides it and remembers that', async ({ page }) => {
  await open(page);
  const btn = center(await page.locator('.whatsapp-float-btn').boundingBox());
  // The target sits bottom-centre, 20px above the bottom nav, and is placed when the drag starts.
  const nav = await page.locator('.bottom-nav').boundingBox();
  const zone = { x: 375 / 2, y: nav.y - 28 - 20 };

  await page.mouse.move(btn.x, btn.y);
  await page.mouse.down();
  // Part of the way: the target appears but is not "hot" yet.
  await page.mouse.move(btn.x + 30, btn.y - 40, { steps: 5 });
  await expect(page.locator('.whatsapp-close-zone.is-visible')).toHaveCount(1);
  await expect(page.locator('.whatsapp-close-zone.is-hot')).toHaveCount(0);
  // Onto the target: it lights up.
  await page.mouse.move(zone.x, zone.y, { steps: 12 });
  await expect(page.locator('.whatsapp-close-zone.is-hot')).toHaveCount(1);
  await page.mouse.up();

  await expect(page.locator('.whatsapp-float-btn')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Chat button hidden' })).toBeVisible();
  const until = await page.evaluate(() => Number(localStorage.getItem('munchies_whatsapp_btn_hidden_until')));
  expect(until).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);

  // Still gone after a reload, and the footer keeps a WhatsApp link.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.whatsapp-float-btn')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'WhatsApp us' })).toHaveAttribute('href', /wa\.me\/\d+/);
});

test('A drag that ends away from the target only moves the bubble', async ({ page }) => {
  await open(page);
  const btn = center(await page.locator('.whatsapp-float-btn').boundingBox());
  await page.mouse.move(btn.x, btn.y);
  await page.mouse.down();
  await page.mouse.move(btn.x + 120, btn.y - 200, { steps: 15 });
  await page.waitForTimeout(150); // pause so the release is a drop, not a throw
  await page.mouse.up();
  await expect(page.locator('.whatsapp-float-btn')).toBeVisible();
  await expect(page.locator('.whatsapp-close-zone.is-visible')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('munchies_whatsapp_btn_hidden_until'))).toBeNull();
});

test('A plain tap still opens WhatsApp', async ({ page }) => {
  await page.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
  await open(page);
  await page.locator('.whatsapp-float-btn').click();
  const opened = await page.evaluate(() => window.__opened);
  expect(opened).toHaveLength(1);
  expect(opened[0]).toContain('https://wa.me/');
});
