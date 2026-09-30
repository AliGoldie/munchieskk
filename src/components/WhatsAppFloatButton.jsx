import { useEffect, useRef, useState } from 'react';
import { WhatsAppIcon } from './icons';
import { siteConfig } from '../config/siteConfig';

const STORAGE_KEY = 'munchies_whatsapp_btn_pos';
const SESSION_DISMISS_KEY = 'munchies_whatsapp_btn_dismissed';
const BTN_SIZE = 44; // still meets the ~44px minimum comfortable tap target
const MARGIN = 12;
const DRAG_THRESHOLD = 6; // px of pointer movement before a tap counts as a drag
const FLICK_MIN_SPEED = 0.15; // px/ms -- below this a release just drops it, no bounce
const RESTITUTION = 0.62; // fraction of speed kept after each edge bounce
const FRICTION_PER_SEC = 0.55; // fraction of speed lost per second in flight
const STOP_SPEED = 0.02; // px/ms -- below this the fling is considered settled
const HOLD_SHAKE_MS = 550; // held still (no drag) this long before it starts to shake
const HOLD_CLOSE_MS = 550; // then held still this much longer before it dismisses
const CLOSE_ANIM_MS = 220; // fade/scale-out duration before it actually unmounts

// Keeps the button clear of the fixed header and bottom nav (it would
// render behind both -- z-index 90 vs their 100 -- and become unreachable
// there) while otherwise allowing it, and its bounces, anywhere on screen.
function getBounds() {
  const header = document.querySelector('.app-layout .top-header');
  const nav = document.querySelector('.app-layout .bottom-nav');
  const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
  const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;
  const minX = MARGIN;
  const maxX = Math.max(minX, window.innerWidth - BTN_SIZE - MARGIN);
  const minY = headerBottom + MARGIN;
  const maxY = Math.max(minY, navTop - BTN_SIZE - MARGIN);
  return { minX, maxX, minY, maxY };
}

function clampPosition(x, y) {
  const b = getBounds();
  return {
    x: Math.min(Math.max(x, b.minX), b.maxX),
    y: Math.min(Math.max(y, b.minY), b.maxY),
  };
}

// Starting spot for a first-time visitor: bottom-left, above the nav.
// Deliberately NOT bottom-right -- CookingPopup.jsx (the live "your order
// is cooking" card) already owns that corner whenever a customer has an
// active order.
function defaultPosition() {
  const nav = document.querySelector('.app-layout .bottom-nav');
  const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight - 78;
  return clampPosition(MARGIN, navTop - BTN_SIZE - 16);
}

// Draggable, flickable, and remembered per device (localStorage) -- if it
// ever covers something on a customer's particular screen, they can drag
// (or throw) it out of the way themselves rather than us having to guess
// one safe spot for every device and page. Positioned via CSS transform
// rather than left/top: transform is compositor-only (no layout recalc per
// frame), which is what actually keeps both the drag and the bounce
// animation smooth at 60fps. Holding it still (no drag) shakes it as a
// warning, then dismisses it for the rest of this browser tab's session --
// sessionStorage, not localStorage, so an accidental hold never permanently
// strands a customer without a contact button on their next visit.
export default function WhatsAppFloatButton() {
  const href = `https://wa.me/${siteConfig.whatsappNumber}?text=${encodeURIComponent(siteConfig.whatsappGreeting)}`;
  const btnRef = useRef(null);
  const dragRef = useRef({ dragging: false, moved: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0 });
  const justDraggedRef = useRef(false); // suppresses the click a drag or shake-release still fires
  const historyRef = useRef([]); // recent {x, y, t} pointer samples, for release velocity
  const flingRef = useRef(null); // requestAnimationFrame id, while bouncing
  const shakeTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const shakeTriggeredRef = useRef(false); // this press has shaken, whether or not it went on to close
  const [pos, setPos] = useState(null);
  const [isFlinging, setIsFlinging] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isDismissed, setIsDismissed] = useState(() => {
    try { return sessionStorage.getItem(SESSION_DISMISS_KEY) === '1'; } catch { return false; }
  });

  const stopFling = () => {
    if (flingRef.current != null) {
      cancelAnimationFrame(flingRef.current);
      flingRef.current = null;
    }
    setIsFlinging(false);
  };

  const clearHoldTimers = () => {
    if (shakeTimerRef.current != null) { clearTimeout(shakeTimerRef.current); shakeTimerRef.current = null; }
    if (closeTimerRef.current != null) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
  };

  const dismiss = () => {
    clearHoldTimers();
    setIsShaking(false);
    setIsClosing(true);
    try { sessionStorage.setItem(SESSION_DISMISS_KEY, '1'); } catch {}
    setTimeout(() => setIsDismissed(true), CLOSE_ANIM_MS);
  };

  const persistPosition = (p) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch {}
  };

  useEffect(() => {
    let saved = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch {
      // ignore -- fall back to the default position below
    }
    const initial = saved && typeof saved.x === 'number' && typeof saved.y === 'number'
      ? clampPosition(saved.x, saved.y)
      : defaultPosition();
    setPos(initial);

    // Re-clamp on resize/orientation change so it can never end up
    // off-screen or stuck behind the header/nav after a layout change.
    const onResize = () => setPos(prev => (prev ? clampPosition(prev.x, prev.y) : defaultPosition()));
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      stopFling();
      clearHoldTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startFling = (vx, vy, from) => {
    let { minX, maxX, minY, maxY } = getBounds();
    let x = from.x;
    let y = from.y;
    let lastT = performance.now();
    setIsFlinging(true);

    const step = (now) => {
      ({ minX, maxX, minY, maxY } = getBounds()); // re-read in case of resize mid-flight
      const dt = Math.min(now - lastT, 48); // clamp long gaps (backgrounded tab, slow frame)
      lastT = now;

      x += vx * dt;
      y += vy * dt;

      if (x < minX) { x = minX; vx = -vx * RESTITUTION; }
      else if (x > maxX) { x = maxX; vx = -vx * RESTITUTION; }
      if (y < minY) { y = minY; vy = -vy * RESTITUTION; }
      else if (y > maxY) { y = maxY; vy = -vy * RESTITUTION; }

      const decay = Math.pow(1 - FRICTION_PER_SEC, dt / 1000);
      vx *= decay;
      vy *= decay;

      setPos({ x, y });

      if (Math.hypot(vx, vy) < STOP_SPEED) {
        flingRef.current = null;
        setIsFlinging(false);
        persistPosition({ x, y });
        return;
      }
      flingRef.current = requestAnimationFrame(step);
    };
    flingRef.current = requestAnimationFrame(step);
  };

  const handlePointerDown = (e) => {
    if (!pos) return;
    stopFling(); // grabbing it mid-bounce takes over control immediately
    dragRef.current = {
      dragging: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      startPosX: pos.x,
      startPosY: pos.y,
    };
    historyRef.current = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    btnRef.current?.setPointerCapture?.(e.pointerId);

    // Holding still (not dragging) shakes it as a warning, then dismisses it
    // if the hold continues -- each check bails if a real drag started or
    // the press already ended in the meantime.
    shakeTriggeredRef.current = false;
    shakeTimerRef.current = setTimeout(() => {
      shakeTimerRef.current = null;
      if (!dragRef.current.dragging || dragRef.current.moved) return;
      setIsShaking(true);
      shakeTriggeredRef.current = true;
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        if (!dragRef.current.dragging || dragRef.current.moved) return;
        dismiss();
      }, HOLD_CLOSE_MS);
    }, HOLD_SHAKE_MS);
  };

  const handlePointerMove = (e) => {
    const d = dragRef.current;
    if (!d.dragging) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      d.moved = true;
      clearHoldTimers(); // a real drag cancels any pending shake/close
      setIsShaking(false);
    }
    if (d.moved) {
      setPos(clampPosition(d.startPosX + dx, d.startPosY + dy));
      const hist = historyRef.current;
      hist.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      // Only the last ~100ms of movement decides the throw speed, so a
      // drag that pauses before release reads as a drop, not a flick.
      const cutoff = performance.now() - 100;
      while (hist.length > 2 && hist[0].t < cutoff) hist.shift();
    }
  };

  const handlePointerUp = (e) => {
    const d = dragRef.current;
    if (!d.dragging) return;
    d.dragging = false;
    btnRef.current?.releasePointerCapture?.(e.pointerId);
    clearHoldTimers();
    setIsShaking(false);

    if (shakeTriggeredRef.current) {
      // Released mid-shake (or right at close) -- not a real tap, so don't
      // let the click that still fires from this open WhatsApp.
      shakeTriggeredRef.current = false;
      justDraggedRef.current = true;
      return;
    }

    if (!d.moved || !pos) return; // a plain tap -- handleClick opens WhatsApp

    justDraggedRef.current = true;

    const hist = historyRef.current;
    let vx = 0, vy = 0;
    // If the pointer sat still for a moment before release, there's no
    // fresh move sample to reflect that -- the history would otherwise
    // still show whatever fast movement happened before the pause, wrongly
    // reading a deliberate "drag, hold, let go" as a flick. Anything held
    // for more than ~60ms without moving counts as released at rest.
    const stillTime = performance.now() - (hist.length ? hist[hist.length - 1].t : 0);
    if (hist.length >= 2 && stillTime < 60) {
      const first = hist[0];
      const last = hist[hist.length - 1];
      const dt = last.t - first.t;
      if (dt > 0) {
        vx = (last.x - first.x) / dt; // px/ms
        vy = (last.y - first.y) / dt;
      }
    }

    if (Math.hypot(vx, vy) >= FLICK_MIN_SPEED) {
      startFling(vx, vy, pos);
    } else {
      persistPosition(pos);
    }
  };

  const handleClick = () => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  if (!pos || isDismissed) return null;

  return (
    <div
      className="whatsapp-float-wrap"
      style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }}
    >
      <button
        ref={btnRef}
        type="button"
        className={`whatsapp-float-btn${isFlinging ? ' is-flinging' : ''}${isShaking ? ' is-shaking' : ''}${isClosing ? ' is-closing' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleClick}
        aria-label="Chat with us on WhatsApp. Drag or flick to move, hold to hide."
        title="Chat with us on WhatsApp — drag or flick to move, hold to hide"
      >
        <WhatsAppIcon size={20} color="#fff" />
      </button>
    </div>
  );
}
