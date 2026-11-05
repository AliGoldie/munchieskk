// Shared "game feel" kit for the three arcade games: one remembered mute
// setting, richer synthesized sounds (no audio files), phone vibration, puff
// and sparkle particles for the canvas games, and a screen shake.

const MUTE_KEY = 'munchies_sound_muted';

export function isSoundMuted() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

export function setSoundMuted(muted) {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* private mode: fine */ }
}

// Short buzz on phones that support it; the caller passes the sound state so
// muting also quiets the vibration.
export function vibrate(on, pattern) {
  if (!on) return;
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* ignore */ }
}

// One oscillator note that can glide from freq to endFreq.
function blip(ctx, { freq, endFreq, dur = 0.1, type = 'square', vol = 0.12, delay = 0 }) {
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 20), t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// A burst of filtered noise: dust, thuds, crashes.
function noise(ctx, { dur = 0.15, vol = 0.15, delay = 0, cutoff = 600, endCutoff }) {
  const t0 = ctx.currentTime + delay;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cutoff, t0);
  if (endCutoff) filter.frequency.exponentialRampToValueAtTime(endCutoff, t0 + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

const arp = (ctx, freqs, step, opts) => freqs.forEach((f, i) => blip(ctx, { ...opts, freq: f, delay: (opts.delay || 0) + i * step }));

// Sound recipes. `n` is an optional intensity (for example a combo level).
const RECIPES = {
  jump: (ctx) => blip(ctx, { freq: 300, endFreq: 640, dur: 0.13, type: 'square', vol: 0.09 }),
  land: (ctx) => { noise(ctx, { dur: 0.14, vol: 0.14, cutoff: 900, endCutoff: 200 }); blip(ctx, { freq: 130, endFreq: 55, dur: 0.12, type: 'sine', vol: 0.16 }); },
  crash: (ctx) => { noise(ctx, { dur: 0.35, vol: 0.2, cutoff: 1800, endCutoff: 150 }); blip(ctx, { freq: 220, endFreq: 50, dur: 0.32, type: 'sawtooth', vol: 0.16 }); },
  collect: (ctx) => arp(ctx, [880, 1320], 0.055, { dur: 0.09, type: 'triangle', vol: 0.11 }),
  gold: (ctx) => arp(ctx, [880, 1175, 1568, 2093], 0.06, { dur: 0.14, type: 'triangle', vol: 0.13 }),
  frenzy: (ctx) => { blip(ctx, { freq: 260, endFreq: 1300, dur: 0.4, type: 'sawtooth', vol: 0.1 }); arp(ctx, [1046, 1318, 1568], 0.07, { dur: 0.16, type: 'square', vol: 0.08, delay: 0.3 }); },
  decoy: (ctx) => { blip(ctx, { freq: 120, endFreq: 70, dur: 0.28, type: 'sawtooth', vol: 0.2 }); blip(ctx, { freq: 90, dur: 0.28, type: 'square', vol: 0.1 }); },
  chomp: (ctx, n = 0) => blip(ctx, { freq: n % 2 ? 420 : 560, endFreq: n % 2 ? 640 : 330, dur: 0.07, type: 'triangle', vol: 0.12 }),
  ghost: (ctx) => { blip(ctx, { freq: 300, endFreq: 1200, dur: 0.18, type: 'sawtooth', vol: 0.14 }); arp(ctx, [1568, 2093], 0.07, { dur: 0.1, type: 'square', vol: 0.08, delay: 0.14 }); },
  bonus: (ctx) => arp(ctx, [659, 784, 988, 1318, 1568], 0.07, { dur: 0.12, type: 'triangle', vol: 0.13 }),
  // Speed Grab tap: pitch climbs with the combo.
  tap: (ctx, n = 0) => blip(ctx, { freq: 600 + Math.min(n, 20) * 28, dur: 0.07, type: 'square', vol: 0.1 })
};

export function playSfx(ctx, on, name, n) {
  if (!on || !ctx) return;
  try { (RECIPES[name] || (() => {}))(ctx, n); } catch { /* audio is never worth breaking a game */ }
}

// Small particle system for canvas games (smoke puffs, sparkles).
export function createParticles(maxCount = 120) {
  const list = [];
  return {
    emit(x, y, { n = 8, color = '255,255,255', speed = 60, life = 0.5, size = 3, gravity = 0, angle = -Math.PI / 2, spread = Math.PI * 2, shrink = true } = {}) {
      for (let i = 0; i < n && list.length < maxCount; i++) {
        const a = angle + (Math.random() - 0.5) * spread;
        const s = speed * (0.4 + Math.random() * 0.8);
        list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, ttl: life * (0.7 + Math.random() * 0.5), size: size * (0.7 + Math.random() * 0.6), gravity, color, shrink });
      }
    },
    // scrollPx moves everything left with a scrolling world.
    update(dt, scrollPx = 0) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.ttl -= dt;
        if (p.ttl <= 0) { list.splice(i, 1); continue; }
        p.vy += p.gravity * dt;
        p.x += p.vx * dt - scrollPx;
        p.y += p.vy * dt;
      }
    },
    draw(ctx) {
      for (const p of list) {
        const k = Math.max(0, p.ttl / p.life);
        ctx.fillStyle = `rgba(${p.color},${Math.min(1, k * 1.4)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.shrink ? p.size * (0.4 + k * 0.6) : p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    clear() { list.length = 0; }
  };
}

// Screen shake: kick() on a hit, step() every frame, then translate by x/y.
export function createShake() {
  let mag = 0;
  let ttl = 0;
  return {
    kick(m = 6, dur = 0.25) { mag = m; ttl = dur; },
    step(dt) {
      if (ttl <= 0) { mag = 0; return { x: 0, y: 0 }; }
      ttl -= dt;
      const k = Math.max(0, ttl / 0.25);
      const m = mag * Math.min(1, k + 0.2);
      return { x: (Math.random() - 0.5) * 2 * m, y: (Math.random() - 0.5) * 2 * m };
    }
  };
}
