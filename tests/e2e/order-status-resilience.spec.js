// Regression test for a bug found in a pre-launch audit: OrderStatus polled
// the order exactly once on mount, and a null result (a transient network
// blip, or the just-inserted row not yet visible to a read straight after
// paying) was indistinguishable from "this order doesn't exist" -- so it
// silently redirected the customer to Home right after they'd just paid,
// with zero explanation. The fix retries a few times before giving up.
import { test, expect } from '@playwright/test';

const ORDER_ID = 'MP-2909-001';
const ORDER = {
  id: ORDER_ID,
  status: 'COOKING',
  items: [{ id: 'burger', name: 'Burger', quantity: 1, selectedAddons: [] }],
  total: 1000,
  created_at: new Date().toISOString(),
  cooking_started_at: new Date().toISOString(),
  cook_time_seconds: 900,
};

test('a transient failed order lookup right after payment does not redirect the customer to Home', async ({ page }) => {
  let ordersRequestCount = 0;

  await page.route('**/rest/v1/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/rest/v1/orders')) {
      ordersRequestCount += 1;
      // First two lookups "fail" (empty result, same shape .maybeSingle()
      // returns for a genuinely missing row) -- the real order only shows up
      // from the third attempt on, simulating a slow read-after-write.
      if (ordersRequestCount <= 2) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ORDER) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/auth/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.goto(`/order/${ORDER_ID}`, { waitUntil: 'networkidle' });

  // Give the retry loop (up to 4 attempts, 1s apart) time to reach the
  // attempt that finally succeeds.
  await page.waitForTimeout(4000);

  // The bug redirected to "/" (Navigate replace) before the order ever had a
  // chance to load. The fix should land on the order tracker itself.
  await expect(page).toHaveURL(new RegExp(`/order/${ORDER_ID}$`));
  await expect(page.locator('text=ORDER IN KITCHEN')).toBeVisible();

  expect(ordersRequestCount).toBeGreaterThanOrEqual(3);
});
