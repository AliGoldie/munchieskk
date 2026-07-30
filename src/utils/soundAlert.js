/**
 * Plays a 3-note "ding ding ding" chime using the Web Audio API.
 * No audio files required — synthesized in-browser.
 */
export function playReadySound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99, 880.00, 1046.50]; // C5, E5, G5, A5, C6

    notes.forEach((freq, i) => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.22);

      gainNode.gain.setValueAtTime(0, ctx.currentTime + i * 0.22);
      gainNode.gain.linearRampToValueAtTime(0.5, ctx.currentTime + i * 0.22 + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.22 + 0.5);

      oscillator.start(ctx.currentTime + i * 0.22);
      oscillator.stop(ctx.currentTime + i * 0.22 + 0.5);
    });
  } catch (e) {
    console.warn('Sound playback not supported:', e);
  }
}

// ── New Order Alert (loops until stopped) ──────────────────────────
let _alertInterval = null;
let _alertCtx = null;

function _playAlertBeep() {
  try {
    if (!_alertCtx || _alertCtx.state === 'closed') {
      _alertCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Two-tone urgent beep: high then low
    [[880, 0], [660, 0.18]].forEach(([freq, delay]) => {
      const osc = _alertCtx.createOscillator();
      const gain = _alertCtx.createGain();
      osc.connect(gain);
      gain.connect(_alertCtx.destination);
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, _alertCtx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(0.35, _alertCtx.currentTime + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, _alertCtx.currentTime + delay + 0.22);
      osc.start(_alertCtx.currentTime + delay);
      osc.stop(_alertCtx.currentTime + delay + 0.25);
    });
  } catch (e) {
    console.warn('Alert sound error:', e);
  }
}

export function startNewOrderAlert() {
  if (_alertInterval) return; // already running
  _playAlertBeep();
  _alertInterval = setInterval(_playAlertBeep, 2500);
}

export function stopNewOrderAlert() {
  if (_alertInterval) {
    clearInterval(_alertInterval);
    _alertInterval = null;
  }
}
