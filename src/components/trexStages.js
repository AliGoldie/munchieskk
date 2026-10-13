// Stages for T-Rex Runner: one endless run that passes through Kota Kinabalu
// landmarks and gets harder as the score climbs. The scenery below is
// procedural placeholder art (silhouettes) so the structure can be played and
// tuned now; real illustrated landmark art replaces drawScenery later.

export const STAGES = [
  { name: 'Penampang', from: 0, sky: ['#33405c', '#c9854f'] },
  { name: 'Gaya Street', from: 400, sky: ['#3a4a5e', '#b89a6a'] },
  { name: 'KK City Mosque', from: 900, sky: ['#35506b', '#d6a45f'] },
  { name: 'Tanjung Aru', from: 1500, sky: ['#4a2f5a', '#e0663a'] },
  { name: 'Mount Kinabalu', from: 2300, sky: ['#0b1026', '#2a2f55'], final: true }
];

export function stageIndexForScore(score) {
  let idx = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (score >= STAGES[i].from) idx = i;
  }
  return idx;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const SILHOUETTE = 'rgba(12, 10, 8, 0.5)';
const WINDOW = 'rgba(255, 214, 120, 0.35)';

// Calls draw(x) for each repeat of a pattern of the given width that is
// visible, scrolling with `offset`.
function tile(W, period, offset, draw) {
  const start = -(offset % period) - period;
  for (let x = start; x < W + period; x += period) draw(x);
}

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function sceneryPenampang(ctx, W, g, d) {
  // far hills
  ctx.fillStyle = 'rgba(12, 10, 8, 0.28)';
  ctx.beginPath();
  ctx.moveTo(0, g);
  for (let x = 0; x <= W; x += 8) {
    ctx.lineTo(x, g - 30 - Math.sin((x + d * 0.12) / 55) * 12 - Math.sin((x + d * 0.12) / 23) * 4);
  }
  ctx.lineTo(W, g);
  ctx.fill();
  // government-style block + a roundabout monument (placeholder shapes)
  tile(W, 420, d * 0.3, (x) => {
    rect(ctx, x + 20, g - 62, 130, 62, SILHOUETTE);
    rect(ctx, x + 14, g - 68, 142, 8, SILHOUETTE);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) rect(ctx, x + 30 + c * 20, g - 52 + r * 24, 10, 12, WINDOW);
    rect(ctx, x + 262, g - 74, 8, 74, SILHOUETTE);
    ctx.fillStyle = SILHOUETTE;
    ctx.beginPath();
    ctx.ellipse(x + 266, g - 76, 16, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x + 244, g - 6, 44, 6);
  });
}

function sceneryGaya(ctx, W, g, d) {
  tile(W, 330, d * 0.3, (x) => {
    [58, 72, 64].forEach((h, i) => {
      const bx = x + i * 108;
      rect(ctx, bx, g - h, 104, h, SILHOUETTE);
      ctx.fillStyle = SILHOUETTE;
      ctx.beginPath();
      ctx.moveTo(bx - 3, g - h);
      ctx.lineTo(bx + 52, g - h - 16);
      ctx.lineTo(bx + 107, g - h);
      ctx.fill();
      for (let c = 0; c < 3; c++) {
        rect(ctx, bx + 12 + c * 30, g - h + 14, 14, 18, WINDOW);
        rect(ctx, bx + 12 + c * 30, g - 22, 14, 22, 'rgba(0,0,0,0.25)');
      }
    });
  });
}

function sceneryMosque(ctx, W, g, d) {
  // Yayasan Sabah-style tower, far away
  tile(W, 700, d * 0.15, (x) => {
    ctx.fillStyle = 'rgba(12, 10, 8, 0.32)';
    ctx.beginPath();
    ctx.moveTo(x + 430, g);
    ctx.lineTo(x + 436, g - 138);
    ctx.lineTo(x + 456, g - 138);
    ctx.lineTo(x + 462, g);
    ctx.fill();
    for (let r = 0; r < 9; r++) rect(ctx, x + 439, g - 130 + r * 14, 14, 2, 'rgba(255,214,120,0.25)');
  });
  tile(W, 520, d * 0.3, (x) => {
    rect(ctx, x + 40, g - 40, 130, 40, SILHOUETTE);
    ctx.fillStyle = SILHOUETTE;
    ctx.beginPath();
    ctx.arc(x + 105, g - 40, 36, Math.PI, 0);
    ctx.fill();
    rect(ctx, x + 103, g - 86, 4, 10, SILHOUETTE);
    rect(ctx, x + 186, g - 84, 10, 84, SILHOUETTE);
    ctx.beginPath();
    ctx.arc(x + 191, g - 84, 8, Math.PI, 0);
    ctx.fill();
    // lagoon
    rect(ctx, x, g - 5, 330, 5, 'rgba(60, 100, 140, 0.25)');
  });
}

function sceneryTanjungAru(ctx, W, g, d, t) {
  // setting sun with a soft glow, fixed in the sky
  const sx = W * 0.72;
  const sy = g - 64;
  const glow = ctx.createRadialGradient(sx, sy, 4, sx, sy, 60);
  glow.addColorStop(0, 'rgba(255, 220, 140, 0.55)');
  glow.addColorStop(1, 'rgba(255, 140, 60, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(sx - 60, sy - 60, 120, 120);
  ctx.fillStyle = 'rgba(255, 226, 150, 0.85)';
  ctx.beginPath();
  ctx.arc(sx, sy, 20, 0, Math.PI * 2);
  ctx.fill();
  // sea band with a shimmer
  rect(ctx, 0, g - 30, W, 30, 'rgba(40, 24, 60, 0.45)');
  for (let i = 0; i < 6; i++) {
    const wx = ((i * 71 + t * 14) % W);
    rect(ctx, wx, g - 24 + (i % 3) * 7, 22, 1.5, 'rgba(255, 220, 160, 0.35)');
  }
  // far islands
  tile(W, 480, d * 0.1, (x) => {
    ctx.fillStyle = 'rgba(20, 12, 30, 0.4)';
    ctx.beginPath();
    ctx.ellipse(x + 130, g - 30, 70, 14, 0, Math.PI, 0);
    ctx.fill();
  });
  // palms
  tile(W, 300, d * 0.3, (x) => {
    ctx.strokeStyle = SILHOUETTE;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x + 40, g);
    ctx.quadraticCurveTo(x + 52, g - 40, x + 44, g - 74);
    ctx.stroke();
    ctx.lineWidth = 3;
    for (let a = -2; a <= 2; a++) {
      ctx.beginPath();
      ctx.moveTo(x + 44, g - 74);
      ctx.quadraticCurveTo(x + 44 + a * 14, g - 90 - Math.abs(a) * -4, x + 44 + a * 26, g - 66 + Math.abs(a) * 5);
      ctx.stroke();
    }
  });
}

const STARS = Array.from({ length: 46 }, (_, i) => ({
  x: (i * 97.3) % 408,
  y: (i * 41.7) % 110,
  s: 0.6 + ((i * 13) % 5) * 0.25,
  p: i * 0.7
}));

function sceneryKinabalu(ctx, W, g, d, t) {
  STARS.forEach((s) => {
    const a = 0.45 + 0.4 * Math.sin(t * 2 + s.p);
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
    ctx.fillRect(s.x, s.y, s.s, s.s);
  });
  // far ridge
  tile(W, 520, d * 0.1, (x) => {
    ctx.fillStyle = 'rgba(14, 18, 40, 0.7)';
    ctx.beginPath();
    ctx.moveTo(x, g);
    [[0, 22], [60, 44], [130, 30], [210, 58], [290, 36], [380, 52], [450, 28], [520, 22]]
      .forEach(([px, h]) => ctx.lineTo(x + px, g - h));
    ctx.lineTo(x + 520, g);
    ctx.fill();
  });
  // the massif: broad base rising to a jagged granite summit
  const peaks = [[0, 0], [70, 16], [140, 38], [205, 66], [248, 104], [264, 92], [282, 124], [300, 102], [320, 140], [342, 108], [362, 128], [386, 96], [430, 74], [500, 46], [580, 24], [660, 10], [720, 0]];
  tile(W, 720, d * 0.2, (x) => {
    ctx.fillStyle = 'rgba(8, 10, 24, 0.85)';
    ctx.beginPath();
    ctx.moveTo(x, g);
    peaks.forEach(([px, h]) => ctx.lineTo(x + px, g - h));
    ctx.lineTo(x + 720, g);
    ctx.fill();
    // moonlit edge on the summit pinnacles
    ctx.strokeStyle = 'rgba(200, 215, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    [[282, 124], [300, 102], [320, 140], [342, 108], [362, 128]].forEach(([px, h], i) => {
      if (i === 0) ctx.moveTo(x + px, g - h); else ctx.lineTo(x + px, g - h);
    });
    ctx.stroke();
  });
}

const SCENES = [sceneryPenampang, sceneryGaya, sceneryMosque, sceneryTanjungAru, sceneryKinabalu];

// Sky for a blend between two stages (t = 0..1 toward `to`).
export function drawSky(ctx, W, H, from, to, t) {
  const a = STAGES[from].sky;
  const b = STAGES[to].sky;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, lerpColor(a[0], b[0], t));
  grad.addColorStop(1, lerpColor(a[1], b[1], t));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

export function drawScenery(ctx, W, groundY, stageIdx, distance, alpha, time) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  SCENES[stageIdx](ctx, W, groundY, distance, time);
  ctx.restore();
}
