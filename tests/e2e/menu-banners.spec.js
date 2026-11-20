// The two promo banners at the bottom of the Menu page: both use the shared
// look, link to the right pages, stay inside a phone screen, animate for most
// people and stand still for people who ask for reduced motion.
import { test, expect } from '@playwright/test';
import { mockSupabase } from './helpers.js';

const item = (id, name, category, price, image) => ({
  id, name, category, price, description: 'x', image, in_stock: true, stock_quantity: 50, sort_order: Number(id),
});
const MENU = [item('1', 'BBQ Beef', 'BBQ', 1290, '/images/bbqbeefburger.jpg')];

test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

async function openMenu(page) {
  await mockSupabase(page, { '/rest/v1/menu_items': MENU, '/rest/v1/rpc/': null });
  await page.goto('/menu', { waitUntil: 'networkidle' });
  await page.locator('.promo-banner').first().scrollIntoViewIfNeeded();
}

test('Both promo banners share one look, link correctly and fit a phone', async ({ page }, testInfo) => {
  await openMenu(page);
  const banners = page.locator('.promo-banner');
  await expect(banners).toHaveCount(2);
  await expect(banners.nth(0)).toContainText('LOYALTY PAYS OFF');
  await expect(banners.nth(0).locator('a.promo-cta')).toHaveAttribute('href', '/loyalty');
  await expect(banners.nth(1)).toContainText('WANT IT FREE?');
  await expect(banners.nth(1).locator('a.promo-cta')).toHaveAttribute('href', '/arcade');

  // Same radius and border on both, and nothing sticks out sideways.
  const styles = await banners.evaluateAll((els) => els.map((e) => {
    const s = getComputedStyle(e); const r = e.getBoundingClientRect();
    return { radius: s.borderRadius, border: s.borderTopColor, right: Math.round(r.right) };
  }));
  expect(styles[0].radius).toBe(styles[1].radius);
  expect(styles[0].border).toBe(styles[1].border);
  for (const s of styles) expect(s.right).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(376);

  // The call to action is a comfortable thumb target.
  const box = await banners.nth(0).locator('a.promo-cta').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);

  // The decoration never covers the text (it ignores taps and sits behind the body).
  const decor = await banners.nth(0).locator('.promo-decor').evaluate((e) => getComputedStyle(e).pointerEvents);
  expect(decor).toBe('none');

  await testInfo.attach('menu-banners.png', { body: await page.screenshot(), contentType: 'image/png' });
});

test('Banners animate normally and stand still for reduced motion', async ({ page }) => {
  await openMenu(page);
  const anim = (sel) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).animationName);
  expect(await anim('.promo-sheen')).toContain('promo-sweep');
  expect(await anim('.promo-coin')).toContain('promo-float');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await anim('.promo-coin')).toBe('none');
  expect(await anim('.promo-cta-arrow')).toBe('none');
});
