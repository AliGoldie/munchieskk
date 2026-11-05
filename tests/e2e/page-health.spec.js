// Page health on a phone-sized screen. For each customer page it checks that
//   1. nothing makes the page scroll sideways (the classic mobile bug),
//   2. no image from this site is broken, and
//   3. the page throws no uncaught errors.
// It also saves a screenshot of every page, which shows up in the Playwright
// report CI uploads, so a person can glance at them. (Screenshots are for
// looking at, not compared pixel by pixel: that would fail on every small
// design change.)
import { test, expect } from '@playwright/test';
import { mockSupabase } from './helpers.js';

const PAGES = [
  ['home', '/'],
  ['menu', '/menu'],
  ['loyalty', '/loyalty'],
  ['cart', '/cart'],
  ['login', '/login'],
  ['signup', '/signup'],
  ['catering', '/catering'],
];

// Real images that ship with the site, so a missing file shows up as broken.
const item = (id, name, category, price, image) => ({
  id, name, category, price, description: 'x', image, in_stock: true, stock_quantity: 50, sort_order: Number(id),
});
const MENU = [
  item('1', 'BBQ Beef', 'BBQ', 1290, '/images/bbqbeefburger.jpg'),
  item('5', 'BBQ Chicken', 'BBQ', 1390, '/images/bbq_chicken.jpg'),
  item('11', 'Big-G Burger', 'PREMIUM', 1690, '/images/BigG.jpg'),
  item('3', 'Ice BB', 'DRINKS', 1190, '/images/iceBB.jpg'),
  item('6', 'Monsta Fries', 'SIDES', 1290, '/images/monsta_fries.jpg'),
];

test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

for (const [name, path] of PAGES) {
  test(`${name} page is healthy on a phone`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await mockSupabase(page, { '/rest/v1/menu_items': MENU, '/rest/v1/rpc/': null });
    await page.goto(path, { waitUntil: 'networkidle' });

    // Scroll to the bottom in steps so lazy-loaded images actually load.
    await page.evaluate(async () => {
      const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForLoadState('networkidle');

    // 1. Sideways scroll: report which elements stick out.
    const overflow = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const doc = document.documentElement.scrollWidth;
      if (doc <= width + 1) return null;
      // The elements that stick out furthest, widest first.
      const wide = [...document.querySelectorAll('body *')]
        .map((el) => ({ el, right: Math.round(el.getBoundingClientRect().right) }))
        .filter((x) => x.right > width + 1)
        .sort((a, b) => b.right - a.right)
        .slice(0, 5)
        .map(({ el, right }) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} (right edge ${right}px)`);
      return { width, doc, wide };
    });
    expect(overflow, `page scrolls sideways: ${JSON.stringify(overflow)}`).toBeNull();

    // 2. Broken images from this site (files the page asked for and could not show).
    const broken = await page.evaluate(() =>
      [...document.images]
        .filter((img) => img.currentSrc && new URL(img.currentSrc, location.href).origin === location.origin)
        .filter((img) => !(img.complete && img.naturalWidth > 0))
        .map((img) => img.getAttribute('src')));
    expect(broken, `broken images: ${broken.join(', ')}`).toEqual([]);

    // 3. Uncaught errors.
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);

    // A look for people: attached to the report, never compared.
    await testInfo.attach(`${name}-phone.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
}
