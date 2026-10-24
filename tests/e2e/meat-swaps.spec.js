// Meat swaps: the choice appears on swappable burgers with the right price,
// platters need a burger picked for every slot, and the cart and totals carry
// the swap. (The server prices real orders itself; this checks the screens.)
import { test, expect } from '@playwright/test';
import { mockSupabase } from './helpers.js';

const item = (id, name, category, price, extra = {}) => ({
  id, name, category, price, description: 'x', image: '', in_stock: true, stock_quantity: 50, sort_order: Number(id), ...extra,
});
const MENU = [
  item('1', 'BBQ Beef', 'BBQ', 1290),
  item('4', 'BBQ Lamb', 'BBQ', 1490),
  item('7', 'Mushy2 Burger', 'PREMIUM', 1590),
  item('10', 'CZ Chix Burger', 'PREMIUM', 1690),
  item('14', 'MONSTA Platter', 'PLATTERS', 6690),
  item('16', 'BBQ EGGY', 'BBQ', 890),
];
const SLOTS = [
  { menu_item_id: '1', slot_no: 1, kind: 'bbq', default_meat: 'beef', pick_category: null },
  { menu_item_id: '4', slot_no: 1, kind: 'bbq', default_meat: 'lamb', pick_category: null },
  { menu_item_id: '7', slot_no: 1, kind: 'premium', default_meat: 'beef', pick_category: null },
  { menu_item_id: '14', slot_no: 1, kind: 'premium', default_meat: 'beef', pick_category: 'PREMIUM' },
  { menu_item_id: '14', slot_no: 2, kind: 'premium', default_meat: 'beef', pick_category: 'PREMIUM' },
  { menu_item_id: '14', slot_no: 3, kind: 'premium', default_meat: 'beef', pick_category: 'PREMIUM' },
];
const LADDER = [{ meat: 'beef', rank_cents: 0 }, { meat: 'chicken', rank_cents: 100 }, { meat: 'lamb', rank_cents: 200 }];

const setup = async (page) => {
  await mockSupabase(page, {
    '/rest/v1/menu_items': MENU, '/rest/v1/swap_slots': SLOTS, '/rest/v1/meat_ladder': LADDER,
  });
  await page.goto('/menu', { waitUntil: 'networkidle' });
};
const open = async (page, name) => { await page.locator('.card', { hasText: name }).first().click(); };

test('a BBQ burger shows its meat choice and charges going up the ladder', async ({ page }) => {
  await setup(page);
  await open(page, 'BBQ Beef');
  const add = page.locator('.modal-add-btn');
  await expect(add).toContainText('RM 12.90');
  await page.getByRole('radio', { name: /Chicken/ }).click();
  await expect(add).toContainText('RM 13.90');
  await page.getByRole('radio', { name: /Lamb/ }).click();
  await expect(add).toContainText('RM 14.90');
  await page.getByRole('radio', { name: /^Beef/ }).click();
  await expect(add).toContainText('RM 12.90');
});

test('swapping down from lamb is free', async ({ page }) => {
  await setup(page);
  await open(page, 'BBQ Lamb');
  const add = page.locator('.modal-add-btn');
  await expect(add).toContainText('RM 14.90');
  await page.getByRole('radio', { name: /^Beef/ }).click();
  await expect(add).toContainText('RM 14.90');
});

test('burgers that cannot be swapped show no meat choice', async ({ page }) => {
  await setup(page);
  await open(page, 'CZ Chix Burger');
  await expect(page.locator('.modal-add-btn')).toContainText('RM 16.90');
  await expect(page.getByRole('radio')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('the swap carries into the cart', async ({ page }) => {
  await setup(page);
  await open(page, 'Mushy2 Burger');
  await page.getByRole('radio', { name: /Lamb/ }).click();
  await page.locator('.modal-add-btn').click();
  await page.goto('/cart', { waitUntil: 'networkidle' });
  const line = page.locator('.cart-item', { hasText: 'Mushy2' });
  await expect(line).toContainText('Lamb');
  await expect(line).toContainText('RM 17.90');
});

test('a platter needs a burger chosen for every slot', async ({ page }) => {
  await setup(page);
  await open(page, 'MONSTA Platter');
  const add = page.locator('.modal-add-btn');
  await expect(add).toBeDisabled();
  await expect(add).toContainText('Choose your burgers');
  const picks = page.locator('select.meat-pick');
  await expect(picks).toHaveCount(3);
  await picks.nth(0).selectOption('7');
  await picks.nth(1).selectOption('10');
  await expect(add).toBeDisabled();
  await picks.nth(2).selectOption('7');
  await expect(add).toBeEnabled();
  await expect(add).toContainText('RM 66.90');
  // CZ Chix has fixed meat: no meat buttons for slot 2
  await expect(page.locator('.meat-slot').nth(1)).toContainText("can't be changed");
  // a lamb swap on a premium slot is +RM2
  await page.locator('.meat-slot').nth(0).getByRole('radio', { name: /Lamb/ }).click();
  await expect(add).toContainText('RM 68.90');
  // "All: Lamb" sets every swappable slot (the CZ Chix slot stays as it is)
  await page.getByRole('button', { name: 'Lamb', exact: true }).click();
  await expect(add).toContainText('RM 70.90');
});
