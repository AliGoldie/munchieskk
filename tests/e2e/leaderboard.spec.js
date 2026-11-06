// Arcade leaderboard: the full page with game and period tabs, the top-3 teaser
// on the Arcade page, and the "hidden" and guest notes. Supabase is mocked.
import { test, expect } from '@playwright/test';

const BOARD = {
  rows: [
    { rank: 1, name: 'Fast Alice', score: 5500, is_me: false },
    { rank: 2, name: 'Cara', score: 1500, is_me: false },
    { rank: 3, name: 'Bob', score: 1200, is_me: false }
  ],
  me: null
};

const thisMonday = () => {
  const d = new Date(Date.now() + 8 * 3600e3);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400e3).toISOString().slice(0, 10);
};

async function mockBoard(page, calls, overrides = {}, { seen = true } = {}) {
  if (seen) await page.addInitScript((w) => localStorage.setItem('mk_champions_seen', w), thisMonday());
  await page.route('**/rest/v1/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/rest/v1/rpc/arcade_leaderboard')) {
      const body = JSON.parse(route.request().postData() || '{}');
      calls.push(body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...BOARD, ...overrides, period: body.p_period, game: body.p_game }) });
    }
    if (url.includes('/rest/v1/store_settings')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'main_store', arcade_enabled: true, status: 'OPEN', weekly_schedule: {}, special_closures: [] }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/auth/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
}

test('the leaderboard lists the players and the tabs ask for the right board', async ({ page }) => {
  const calls = [];
  await mockBoard(page, calls);
  await page.goto('/leaderboard', { waitUntil: 'networkidle' });

  await expect(page.locator('.lb-row').first()).toContainText('Fast Alice');
  await expect(page.locator('.lb-row').first()).toContainText('5,500 XP');
  expect(calls[0]).toEqual({ p_period: 'week', p_game: 'all' });

  await page.click('.lb-tab:has-text("T-Rex")');
  await page.click('.lb-tab:has-text("All time")');
  await expect.poll(() => calls.at(-1)).toEqual({ p_period: 'all', p_game: 'trex_runner' });
  await page.click('.lb-tab:has-text("Munch-Man")');
  await expect.poll(() => calls.at(-1)).toEqual({ p_period: 'all', p_game: 'munch_man' });
  // a guest is invited to sign up and gets no personal row
  await expect(page.locator('.lb-you')).toContainText('Sign up');
});

test('the Arcade page shows the top three and links to the full board', async ({ page }) => {
  await mockBoard(page, []);
  await page.goto('/arcade', { waitUntil: 'networkidle' });
  const teaser = page.locator('.lb-teaser');
  await expect(teaser).toContainText('TOP PLAYERS THIS WEEK');
  await expect(teaser.locator('li')).toHaveCount(3);
  await teaser.locator('a', { hasText: 'See all' }).click();
  await expect(page).toHaveURL(/\/leaderboard$/);
});

test('an empty board invites the first player', async ({ page }) => {
  await mockBoard(page, [], { rows: [] });
  await page.goto('/leaderboard', { waitUntil: 'networkidle' });
  await expect(page.locator('.lb-empty')).toContainText('Be the first');
});

test('last week\'s champion is announced once, then not again that week', async ({ page }) => {
  const calls = [];
  await mockBoard(page, calls, {}, { seen: false });
  await page.goto('/arcade', { waitUntil: 'networkidle' });
  const overlay = page.locator('.champ-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('CHAMPION');
  await expect(overlay).toContainText('Fast Alice');
  await expect(overlay.locator('.champ-score')).toContainText('5,500', { timeout: 5000 });
  expect(calls.some((c) => c.p_period === 'lastweek')).toBe(true);
  await overlay.locator('.champ-close').click();
  await expect(overlay).toHaveCount(0);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await expect(page.locator('.champ-overlay')).toHaveCount(0);
});

test('no announcement when last week had no real champion', async ({ page }) => {
  await mockBoard(page, [], { rows: [{ rank: 1, name: 'Tiny', score: 40, is_me: false }] }, { seen: false });
  await page.goto('/arcade', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await expect(page.locator('.champ-overlay')).toHaveCount(0);
});

test('the leaderboard has a Last week tab', async ({ page }) => {
  const calls = [];
  await mockBoard(page, calls);
  await page.goto('/leaderboard', { waitUntil: 'networkidle' });
  await page.click('.lb-tab:has-text("Last week")');
  await expect.poll(() => calls.some((c) => c.p_period === 'lastweek')).toBe(true);
});
