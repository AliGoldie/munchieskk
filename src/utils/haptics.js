// A small buzz on buttons, for phones that allow it (Android Chrome and similar).
// iPhones do not let websites vibrate, so there it quietly does nothing.
// One on/off setting, remembered on the phone and shown in Profile.
// Kept apart from the game vibration (gameFx.js), which follows the sound setting.
const KEY = 'munchies_haptics';

const PATTERNS = {
  tap: 8,                      // nav tabs, picking a reward
  press: 15,                   // add to cart, place order
  success: [20, 40, 20],       // the order went through
  celebrate: [30, 50, 30, 50, 60], // rank-up
};

export function hapticsSupported() {
  try { return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'; } catch { return false; }
}

export function isHapticsEnabled() {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}

export function setHapticsEnabled(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode: fine */ }
}

export function haptic(kind = 'tap') {
  if (!hapticsSupported() || !isHapticsEnabled()) return;
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    navigator.vibrate(PATTERNS[kind] ?? PATTERNS.tap);
  } catch { /* ignore */ }
}
