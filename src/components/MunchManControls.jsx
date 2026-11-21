import { useRef, useState } from 'react';

// On-screen controls for Munch-Man.
//  - DPad: a Game Boy style cross, shown when the phone is upright. Press an arm, or slide across it.
//  - StickZone: a floating joystick, shown when the phone is sideways. It appears wherever the thumb
//    lands inside the zone (one zone on each lower side, so it suits left and right thumbs).
// Which one shows is decided in the CSS (orientation), so nothing here needs to know the orientation.

const DIRS = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

function dominant(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

export function DPad({ onDir }) {
  const ref = useRef(null);
  const activeId = useRef(null);
  const [arm, setArm] = useState(null);

  const last = useRef(null);

  // Send the direction straight away (not from inside a state update) so a quick tap always counts.
  const steer = (e) => {
    const r = ref.current.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * 0.1) return;
    const name = dominant(dx, dy);
    if (last.current !== name) {
      last.current = name;
      onDir(DIRS[name]);
      setArm(name);
    }
  };

  const release = () => { activeId.current = null; last.current = null; setArm(null); };

  return (
    <div className="mm-dpad">
      <div
        className="mm-dpad-cross"
        ref={ref}
        aria-label="Direction pad"
        onPointerDown={(e) => {
          activeId.current = e.pointerId;
          try { ref.current.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
          steer(e);
        }}
        onPointerMove={(e) => { if (activeId.current === e.pointerId) steer(e); }}
        onPointerUp={(e) => { if (activeId.current === e.pointerId) release(); }}
        onPointerCancel={release}
      >
        <span className={`mm-dpad-arm up ${arm === 'up' ? 'on' : ''}`}>▲</span>
        <span className={`mm-dpad-arm left ${arm === 'left' ? 'on' : ''}`}>◀</span>
        <span className="mm-dpad-hub" />
        <span className={`mm-dpad-arm right ${arm === 'right' ? 'on' : ''}`}>▶</span>
        <span className={`mm-dpad-arm down ${arm === 'down' ? 'on' : ''}`}>▼</span>
      </div>
    </div>
  );
}

const STICK_R = 44;
const DEAD_ZONE = 10;

export function StickZone({ onDir, side }) {
  const ref = useRef(null);
  const st = useRef(null);
  const [stick, setStick] = useState(null);

  const down = (e) => {
    const rect = ref.current.getBoundingClientRect();
    st.current = { id: e.pointerId, ox: e.clientX, oy: e.clientY, dir: null };
    try { ref.current.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    setStick({ bx: e.clientX - rect.left, by: e.clientY - rect.top, kx: 0, ky: 0 });
  };

  const move = (e) => {
    const s = st.current;
    if (!s || s.id !== e.pointerId) return;
    let dx = e.clientX - s.ox;
    let dy = e.clientY - s.oy;
    const dist = Math.hypot(dx, dy);
    if (dist > STICK_R * 1.5) {
      // the stick follows a far-away thumb, so quick turns never need a long drag back
      const pull = (dist - STICK_R * 1.5) / dist;
      s.ox += dx * pull;
      s.oy += dy * pull;
      dx = e.clientX - s.ox;
      dy = e.clientY - s.oy;
    }
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, STICK_R / d);
    const rect = ref.current.getBoundingClientRect();
    setStick({ bx: s.ox - rect.left, by: s.oy - rect.top, kx: dx * k, ky: dy * k });
    if (d < DEAD_ZONE) return;
    const name = dominant(dx, dy);
    if (s.dir !== name) {
      s.dir = name;
      onDir(DIRS[name]);
    }
  };

  const up = (e) => {
    if (st.current && st.current.id === e.pointerId) {
      st.current = null;
      setStick(null);
    }
  };

  return (
    <div
      className={`mm-stickzone ${side} ${stick ? 'active' : ''}`}
      ref={ref}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      aria-label="Joystick: touch and drag to steer"
    >
      {stick ? (
        <div className="munchman-stick" style={{ left: stick.bx, top: stick.by }}>
          <div className="munchman-stick-knob" style={{ transform: `translate(${stick.kx}px, ${stick.ky}px)` }} />
        </div>
      ) : (
        <div className="munchman-stick idle" style={{ left: '50%', top: '62%' }}>
          <div className="munchman-stick-knob" />
        </div>
      )}
    </div>
  );
}
