// Shared mocking for admin e2e tests. The app talks to Supabase directly
// from the browser (no backend of its own to stub), so every test mocks
// the REST/auth endpoints instead of hitting a real project.

export async function mockSupabase(page, restHandlers = {}) {
  await page.route('**/rest/v1/**', async (route) => {
    const url = route.request().url();
    for (const [match, body] of Object.entries(restHandlers)) {
      if (url.includes(match)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      }
    }
    if (url.includes('/rest/v1/store_settings')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'main_store', status: 'OPEN', weekly_schedule: {}, special_closures: [] }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/auth/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
}

export async function loginAsDevAdmin(page) {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Dev Admin")');
  await page.waitForTimeout(1000);
}
