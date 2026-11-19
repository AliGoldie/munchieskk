// The Privacy Policy page, its footer link, and the install prompt: it shows
// after the browser offers installing (Android/desktop) or on iPhone with steps,
// stays quiet on checkout and login, goes away when closed, and can be forced
// with ?install=1 (for a poster QR code).
import { test, expect } from '@playwright/test';
import { mockSupabase } from './helpers.js';

test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

const offerInstall = (page) => page.evaluate(() => {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  e.prompt = () => {};
  e.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(e);
});

test('Privacy Policy page has the key sections and is linked from the footer', async ({ page }) => {
  await mockSupabase(page, { '/rest/v1/rpc/': null });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Privacy Policy' }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole('heading', { name: 'PRIVACY POLICY' })).toBeVisible();
  for (const h of ['What we collect', 'Why we use it', 'Who else sees it', 'Your choices', 'Contact us']) {
    await expect(page.getByRole('heading', { name: h })).toBeVisible();
  }
  await expect(page.locator('a[href="mailto:munchieskk.sabah@gmail.com"]')).toBeVisible();
  await expect(page).toHaveTitle(/Privacy Policy/);
});

test('Install prompt: appears when the browser offers install, installs, and goes away', async ({ page }) => {
  await mockSupabase(page, { '/rest/v1/rpc/': null });
  await page.goto('/menu?install=1', { waitUntil: 'networkidle' });
  await offerInstall(page);
  const prompt = page.getByRole('region', { name: 'Install the MunchiesKK app' });
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: 'Install' }).click();
  await expect(prompt).toHaveCount(0);
});

test('Install prompt: closing it keeps it away (snooze), and it is quiet on checkout and login', async ({ page }) => {
  await mockSupabase(page, { '/rest/v1/rpc/': null });
  await page.goto('/menu?install=1', { waitUntil: 'networkidle' });
  await offerInstall(page);
  const prompt = page.getByRole('region', { name: 'Install the MunchiesKK app' });
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: 'Not now' }).click();
  await expect(prompt).toHaveCount(0);
  await page.goto('/menu', { waitUntil: 'networkidle' });
  await offerInstall(page);
  await page.waitForTimeout(500);
  await expect(prompt).toHaveCount(0);

  // Quiet routes, even when forced.
  for (const path of ['/cart?install=1', '/login?install=1']) {
    await page.goto(path, { waitUntil: 'networkidle' });
    await offerInstall(page);
    await page.waitForTimeout(300);
    await expect(page.getByRole('region', { name: 'Install the MunchiesKK app' })).toHaveCount(0);
  }
});

test.describe('iPhone', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  test('shows the Share steps instead of a one-tap install', async ({ page }) => {
    await mockSupabase(page, { '/rest/v1/rpc/': null });
    await page.goto('/menu?install=1', { waitUntil: 'networkidle' });
    const prompt = page.getByRole('region', { name: 'Install the MunchiesKK app' });
    await expect(prompt).toBeVisible();
      await prompt.getByRole('button', { name: 'How to install' }).click();
    await expect(prompt).toContainText('Add to Home Screen');
  });
});

test('Install prompt animation stops for reduced motion', async ({ page }) => {
  await mockSupabase(page, { '/rest/v1/rpc/': null });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/menu?install=1', { waitUntil: 'networkidle' });
  await offerInstall(page);
  const prompt = page.getByRole('region', { name: 'Install the MunchiesKK app' });
  await expect(prompt).toBeVisible();
  expect(await prompt.evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
});
