// Regression test for the bug reported live: "Customer Insights are not
// available" -- caused by filtering on order.order_type and grouping by
// order.customer_id, neither of which is ever set anywhere in the
// codebase, so the filter always matched zero orders.
import { test, expect } from '@playwright/test';
import { mockSupabase, loginAsDevAdmin } from './helpers.js';

const now = new Date();
const daysAgo = (n) => new Date(now.getTime() - n * 86400000).toISOString();

// Alice: returning (2 orders, 10 days apart), total RM80
// Bob: guest, new (1 order), RM20
// Cara: has a cancelled RM999.99 order (must be excluded) + one real RM15 order (new)
const ORDERS = [
  { id: 'O1', user_id: 'u1', status: 'COLLECTED', total: 5000, items: [{ id: 'm1', name: 'Burger', quantity: 1 }], created_at: daysAgo(20), customer_name: 'Alice', customer_phone: 'No Phone' },
  { id: 'O2', user_id: 'u1', status: 'COLLECTED', total: 3000, items: [{ id: 'm1', name: 'Burger', quantity: 1 }], created_at: daysAgo(10), customer_name: 'Alice', customer_phone: 'No Phone' },
  { id: 'O3', user_id: null, status: 'COLLECTED', total: 2000, items: [{ id: 'm2', name: 'Fries', quantity: 1 }], created_at: daysAgo(5), customer_name: 'Bob', customer_phone: 'No Phone' },
  { id: 'O4', user_id: 'u3', status: 'CANCELLED', total: 99999, items: [], created_at: daysAgo(3), customer_name: 'Cara', customer_phone: 'No Phone' },
  { id: 'O5', user_id: 'u3', status: 'COLLECTED', total: 1500, items: [{ id: 'm2', name: 'Fries', quantity: 1 }], created_at: daysAgo(2), customer_name: 'Cara', customer_phone: 'No Phone' },
];
// Expected: new=2 (Bob, Cara), returning=1 (Alice). Top spender: Alice RM80.00

test('Customer Insights shows real segment/spend data instead of "No customers yet"', async ({ page }) => {
  await mockSupabase(page, { '/rest/v1/orders': ORDERS });
  await loginAsDevAdmin(page);

  const card = page.locator('text=Customer Insights').locator('xpath=ancestor::div[contains(@class,"admin-card")]').first();
  await expect(page.locator('text=No customers yet')).toHaveCount(0);
  await expect(page.locator('text=/New: 2 \\(66\\.7%\\)/')).toHaveCount(1);
  await expect(page.locator('text=/Returning: 1 \\(33\\.3%\\)/')).toHaveCount(1);
  await expect(page.locator('text=/RM 80\\.00/')).toHaveCount(1);
  await expect(card.locator('text=Alice')).toHaveCount(1);
});
