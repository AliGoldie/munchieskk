// Munch-Man mazes: every level must be a closed 17 x 15 grid where the hero and the three ghosts
// start on open cells, every open cell can be reached, and the four corner power-ups are open.
import { test, expect } from '@playwright/test';
import { LEVELS } from '../../src/components/munchManLevels.js';

const R = 15;
const C = 17;

test('there are four Munch-Man levels with the agreed names', () => {
  expect(LEVELS.map((l) => l.name)).toEqual(['PENAMPANG', 'GAYA STREET', 'KK WATERFRONT', 'MOUNT KINABALU']);
  // first and last keep the game's yellow; the middle two are tinted
  expect(LEVELS.map((l) => l.tint === null)).toEqual([true, false, false, true]);
});

for (const [i, level] of LEVELS.entries()) {
  test(`level ${i + 1} (${level.name}) is a valid maze`, () => {
    const g = level.rows;
    expect(g).toHaveLength(R);
    for (const row of g) expect(row).toHaveLength(C);
    // closed border
    for (let c = 0; c < C; c++) { expect(g[0][c]).toBe('#'); expect(g[R - 1][c]).toBe('#'); }
    for (let r = 0; r < R; r++) { expect(g[r][0]).toBe('#'); expect(g[r][C - 1]).toBe('#'); }
    const open = (r, c) => g[r][c] !== '#';
    // hero, ghosts and the four corner power-ups start on open cells
    for (const [r, c] of [[13, 8], [1, 5], [1, 11], level.fry, [1, 1], [1, 15], [13, 1], [13, 15]]) {
      expect(open(r, c), `cell ${r},${c} must be open`).toBe(true);
    }
    // every open cell is reachable from the hero's start
    const seen = new Set(['13,8']);
    const queue = [[13, 8]];
    while (queue.length) {
      const [r, c] = queue.shift();
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= R || nc < 0 || nc >= C || !open(nr, nc) || seen.has(`${nr},${nc}`)) continue;
        seen.add(`${nr},${nc}`);
        queue.push([nr, nc]);
      }
    }
    let openCells = 0;
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (open(r, c)) openCells++;
    expect(seen.size).toBe(openCells);
  });
}

test('level 1 is exactly today\'s maze (a wall on every even row and column)', () => {
  const g = LEVELS[0].rows;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const wall = r === 0 || r === R - 1 || c === 0 || c === C - 1 || (r % 2 === 0 && c % 2 === 0);
      expect(g[r][c] === '#').toBe(wall);
    }
  }
});
