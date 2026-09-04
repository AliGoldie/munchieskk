/**
 * Plays a 3-note "ding ding ding" chime using the Web Audio API.
 * No audio files required — synthesized in-browser.
 */
export function playReadySound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    // A longer, triumphant "order ready" fanfare jingle
    const notes = [
      { f: 523.25, start: 0.00, dur: 0.15 }, // C5
      { f: 659.25, start: 0.15, dur: 0.15 }, // E5
      { f: 783.99, start: 0.30, dur: 0.15 }, // G5
      { f: 1046.50, start: 0.45, dur: 0.40 }, // C6
      { f: 783.99, start: 0.85, dur: 0.15 }, // G5
      { f: 1046.50, start: 1.00, dur: 0.60 }, // C6
      { f: 1318.51, start: 1.60, dur: 0.60 }, // E6
    ];

    notes.forEach((note) => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      // Use triangle for a slightly richer, more pleasant bell-like sound
      oscillator.type = 'triangle';
      
      const startTime = ctx.currentTime + note.start;
      oscillator.frequency.setValueAtTime(note.f, startTime);

      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.5, startTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + note.dur);

      oscillator.start(startTime);
      oscillator.stop(startTime + note.dur);
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
    if (_alertCtx.state === 'suspended') {
      _alertCtx.resume();
    }
    // Two-tone urgent beep: 880Hz then 1180Hz, 0.22s each (docs/design/HANDOFF-ADMIN-CRM.md §0)
    [[880, 0], [1180, 0.22]].forEach(([freq, delay]) => {
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
      osc.stop(_alertCtx.currentTime + delay + 0.22);
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
