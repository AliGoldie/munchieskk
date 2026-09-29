// Regression test for a bug found in a pre-launch audit: a failed
// menu_items fetch rendered the exact same infinite shimmering skeleton as
// "still loading", with no way for a customer to know anything had gone
// wrong or to recover without knowing to manually reload the page.
import { test, expect } from '@playwright/test';

test('a failed menu fetch shows a retry state instead of an infinite skeleton', async ({ page }) => {
  await page.route('**/rest/v1/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/rest/v1/menu_items')) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'simulated failure' }) });
    }
    if (url.includes('/rest/v1/store_settings')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'main_store', status: 'OPEN', weekly_schedule: {}, special_closures: [] }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/auth/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.goto('/menu', { waitUntil: 'networkidle' });

  await expect(page.locator('text=couldn\'t load the menu')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('button:has-text("Retry")')).toBeVisible();
});
