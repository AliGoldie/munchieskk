// Regression test for the bug reported live: admin_audit.detail stores
// money as raw integer cents, and the Audit Log used to dump it verbatim
// (e.g. "opening_float: 10000") instead of "RM 100.00". Only known
// money-cents keys should be reformatted -- everything else stays raw.
import { test, expect } from '@playwright/test';
import { mockSupabase, loginAsDevAdmin } from './helpers.js';

const now = new Date().toISOString();
const AUDIT_ROWS = [
  { id: 'a1', created_at: now, actor_role: 'admin', action: 'Shift opened', detail: { opening_float: 10000 } },
  { id: 'a2', created_at: now, actor_role: 'admin', action: 'Shift closed', detail: { shiftId: 's1', counted: 15230, expected: 15000, variance: 230 } },
  { id: 'a3', created_at: now, actor_role: 'admin', action: 'Order refunded (partial)', detail: { orderId: 'O99', amountCents: 500, reason: 'Item made wrong' } },
  { id: 'a4', created_at: now, actor_role: 'admin', action: 'Waste logged', detail: { itemId: 'm1', itemName: 'Burger', quantity: 3, reason: 'Dropped' } },
  { id: 'a5', created_at: now, actor_role: 'admin', action: 'Marketing blast sent', detail: { segment: 'VIP', recipientCount: 42 } },
];

test('Audit Log formats known money fields as RM, leaves everything else raw', async ({ page }) => {
  await mockSupabase(page, { '/rest/v1/admin_audit': AUDIT_ROWS });
  await loginAsDevAdmin(page);
  await page.click('text=Audit log');

  const table = page.locator('table.admin-table').first();
  await expect(table).toContainText('opening_float: RM 100.00');
  await expect(table).toContainText('counted: RM 152.30');
  await expect(table).toContainText('expected: RM 150.00');
  await expect(table).toContainText('variance: RM 2.30');
  await expect(table).toContainText('amountCents: RM 5.00');

  // Non-money numeric fields must NOT be reformatted as currency.
  await expect(table).toContainText('quantity: 3');
  await expect(table).toContainText('recipientCount: 42');

  const text = await table.textContent();
  expect(text).not.toContain('opening_float: 10000');
});
