// Stages for T-Rex Runner: one endless run that passes through Kota Kinabalu
// landmarks and gets harder as the score climbs. Each stage uses an
// illustrated panorama (public/images/trex/stageN.webp) that loops
// horizontally. If an image is missing or still loading, the procedural
// silhouettes below are drawn instead, so the game never shows an empty sky.

export const STAGES = [
  { name: 'Penampang', info: { title: 'Penampang', lines: ['The siga (sigah) is the traditional Kadazandusun headgear, made from a folded headcloth.', 'Datuk Peter Mojuntin, a Sabah state minister, died in the 1976 Double Six air crash. A statue of him stands in Donggongon.'], short: 'The siga is Kadazandusun headgear. A statue honours Datuk Peter Mojuntin in Donggongon.' }, from: 0, sky: ['#33405c', '#c9854f'], hazard: 'lava' },
  { name: 'Gaya Street', info: { title: 'Gaya Street', lines: ['Gaya Street began as a railway path to the Jesselton wharf and is possibly the oldest street in Kota Kinabalu.', 'The shophouses were rebuilt in concrete after World War II. The Sunday market is called the tamu, from temu, meaning to meet.'], short: 'Possibly KK\'s oldest street, home of the Sunday tamu market.' }, from: 400, sky: ['#3a4a5e', '#b89a6a'], hazard: 'lava' },
  { name: 'KK City Mosque', info: { title: 'KK City Mosque', lines: ['The KK City Mosque sits on Likas Bay. A man-made lagoon around it earned it the nickname the Floating Mosque.', 'It was officially opened on 18 February 2000. Further along the waterfront stands the Yayasan Sabah tower.'], short: 'The Floating Mosque on Likas Bay, opened in 2000.' }, from: 900, sky: ['#35506b', '#d6a45f'], hazard: 'water' },
  { name: 'Tanjung Aru', info: { title: 'Tanjung Aru', lines: ['Tanjung Aru Beach faces west, near Kota Kinabalu airport, and is famous for its sunsets.', 'Locals come for the glow over the South China Sea, usually around 6 to 6.30 pm.'], short: 'Famous for its sunsets over the South China Sea.' }, from: 1500, sky: ['#4a2f5a', '#e0663a'], hazard: 'water' },
  { name: 'Mount Kinabalu', info: { title: 'Mount Kinabalu', lines: ['At about 4,095 metres, Mount Kinabalu is the highest peak in Malaysia.', 'Kinabalu Park became Malaysia\'s first UNESCO World Heritage Site in December 2000.'], short: 'Malaysia\'s highest peak, about 4,095 m.' }, from: 2300, sky: ['#0b1026', '#2a2f55'], hazard: 'lava', final: true }
];

const IMAGES = STAGES.map((_, i) => {
  const img = new Image();
  img.src = `/images/trex/stage${i + 1}.webp`;
  return img;
});

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
  // government-style block + the Siga roundabout monument (placeholder shapes)
  tile(W, 420, d * 0.3, (x) => {
    rect(ctx, x + 20, g - 62, 130, 62, SILHOUETTE);
    rect(ctx, x + 14, g - 68, 142, 8, SILHOUETTE);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) rect(ctx, x + 30 + c * 20, g - 52 + r * 24, 10, 12, WINDOW);
    // Roundabout monument: a pedestal topped with a giant Siga (Kadazan
    // headdress) -- band, crown and two upturned points. Placeholder shape.
    const mx = x + 270;
    rect(ctx, mx - 22, g - 8, 44, 8, SILHOUETTE);
    rect(ctx, mx - 7, g - 34, 14, 28, SILHOUETTE);
    ctx.fillStyle = SILHOUETTE;
    ctx.beginPath();
    ctx.moveTo(mx - 30, g - 34);
    ctx.quadraticCurveTo(mx - 38, g - 62, mx - 24, g - 78);
    ctx.quadraticCurveTo(mx - 20, g - 66, mx - 12, g - 60);
    ctx.lineTo(mx, g - 56);
    ctx.lineTo(mx + 12, g - 60);
    ctx.quadraticCurveTo(mx + 20, g - 66, mx + 24, g - 78);
    ctx.quadraticCurveTo(mx + 38, g - 62, mx + 30, g - 34);
    ctx.closePath();
    ctx.fill();
    rect(ctx, mx - 30, g - 42, 60, 6, 'rgba(255, 199, 44, 0.45)');
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
  const img = IMAGES[stageIdx];
  if (img.complete && img.naturalWidth > 0) {
    // The panorama's base line is the bottom edge of the image, which sits
    // on the road, so scale it to the road height and scroll it slowly for depth.
    const dw = img.naturalWidth * (groundY / img.naturalHeight);
    const offset = -((distance * 0.3) % dw);
    for (let x = offset; x < W; x += dw) ctx.drawImage(img, x, 0, dw + 1, groundY);
    // A light veil keeps the runner, obstacles and pickups readable.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, W, groundY);
  } else {
    SCENES[stageIdx](ctx, W, groundY, distance, time);
  }
  ctx.restore();
}

// Pits are lava or water (per stage) so a gap in the road clearly reads as a
// drop to avoid. Drawn twice: a back pass behind the road, and a translucent
// front pass over the gaps only, so a falling runner sinks into it.
export function drawHazard(ctx, W, H, y, kind, distance, time, alpha, gaps) {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (gaps) {
    ctx.beginPath();
    gaps.forEach(([a, b]) => ctx.rect(a, y - 6, b - a, H - y + 6));
    ctx.clip();
  }
  const lava = kind === 'lava';
  const grad = ctx.createLinearGradient(0, y, 0, H);
  if (lava) {
    grad.addColorStop(0, '#ff8a1f');
    grad.addColorStop(0.35, '#e2380f');
    grad.addColorStop(1, '#4d0b04');
  } else {
    grad.addColorStop(0, '#3c8bb0');
    grad.addColorStop(0.4, '#1d5578');
    grad.addColorStop(1, '#0a2238');
  }
  const wave = (x) => y + Math.sin((x + distance * 0.6 + time * 40) / 9) * 2.2 + Math.sin((x - time * 25) / 4) * 0.8;
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 4) ctx.lineTo(x, wave(x));
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
  // bright surface line
  ctx.strokeStyle = lava ? 'rgba(255, 224, 120, 0.9)' : 'rgba(220, 245, 255, 0.7)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 4) (x === 0 ? ctx.moveTo(x, wave(x)) : ctx.lineTo(x, wave(x)));
  ctx.stroke();
  if (lava) {
    // glow above the surface and a few bubbles
    const glow = ctx.createLinearGradient(0, y - 14, 0, y);
    glow.addColorStop(0, 'rgba(255, 120, 30, 0)');
    glow.addColorStop(1, 'rgba(255, 120, 30, 0.35)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, y - 14, W, 14);
    for (let i = 0; i < 7; i++) {
      const bx = ((i * 61 - distance * 0.5) % W + W) % W;
      const by = y + 8 + ((time * 14 + i * 9) % 18);
      ctx.fillStyle = 'rgba(255, 230, 130, 0.65)';
      ctx.beginPath();
      ctx.arc(bx, by, 1.6 + (i % 3) * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    for (let i = 0; i < 6; i++) {
      const rx = ((i * 73 - distance * 0.4 + time * 10) % W + W) % W;
      ctx.fillStyle = 'rgba(220, 245, 255, 0.35)';
      ctx.fillRect(rx, y + 7 + (i % 3) * 6, 16, 1.5);
    }
  }
  ctx.restore();
}
