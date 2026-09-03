// Regression test for the bug reported live: timestamps were rendered
// with the *viewing device's* system timezone (bare toLocaleString()),
// not the store's. A shift opened at 11:33am Malaysia time showed as
// 3:33am on a device set to UTC. Fix pins display to Asia/Kuala_Lumpur
// regardless of the browser's own timezone.
import { test, expect } from '@playwright/test';
import { mockSupabase, loginAsDevAdmin } from './helpers.js';

// 2026-09-03T03:33:22Z == 2026-09-03, 11:33:22 AM in Malaysia (UTC+8).
const UTC_ISO = '2026-09-03T03:33:22.000Z';

test.use({ timezoneId: 'UTC' }); // simulate a viewing device NOT set to Malaysia time

test('timestamps show store-local (Malaysia) time regardless of the viewer\'s device timezone', async ({ page }) => {
  await mockSupabase(page, {
    '/rest/v1/admin_audit': [
      { id: 'a1', created_at: UTC_ISO, actor_role: 'admin', action: 'Shift opened', detail: { opening_float: 10000 } },
    ],
  });
  await loginAsDevAdmin(page);
  await page.click('text=Audit log');

  const table = page.locator('table.admin-table').first();
  await expect(table).toContainText('11:33');

  const text = await table.textContent();
  expect(text).not.toContain('3:33:22 am');
});
