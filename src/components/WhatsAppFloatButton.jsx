import { useEffect, useRef, useState } from 'react';
import { WhatsAppIcon } from './icons';
import { siteConfig } from '../config/siteConfig';

const STORAGE_KEY = 'munchies_whatsapp_btn_pos';
const BTN_SIZE = 44; // still meets the ~44px minimum comfortable tap target
const MARGIN = 12;
const DRAG_THRESHOLD = 6; // px of pointer movement before a tap counts as a drag

// Keeps the button clear of the fixed header and bottom nav (it would
// render behind both -- z-index 90 vs their 100 -- and become unreachable
// there) while otherwise allowing it anywhere on screen.
function clampPosition(x, y) {
  const header = document.querySelector('.app-layout .top-header');
  const nav = document.querySelector('.app-layout .bottom-nav');
  const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
  const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;
  const minX = MARGIN;
  const maxX = Math.max(minX, window.innerWidth - BTN_SIZE - MARGIN);
  const minY = headerBottom + MARGIN;
  const maxY = Math.max(minY, navTop - BTN_SIZE - MARGIN);
  return {
    x: Math.min(Math.max(x, minX), maxX),
    y: Math.min(Math.max(y, minY), maxY),
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

// Draggable and remembered per device (localStorage) -- if it ever covers
// something on a customer's particular screen, they can drag it out of the
// way themselves rather than us having to guess one safe spot for every
// device and page.
export default function WhatsAppFloatButton() {
  const href = `https://wa.me/${siteConfig.whatsappNumber}?text=${encodeURIComponent(siteConfig.whatsappGreeting)}`;
  const btnRef = useRef(null);
  const dragRef = useRef({ dragging: false, moved: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0 });
  const justDraggedRef = useRef(false);
  const [pos, setPos] = useState(null);

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
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handlePointerDown = (e) => {
    if (!pos) return;
    dragRef.current = {
      dragging: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      startPosX: pos.x,
      startPosY: pos.y,
    };
    btnRef.current?.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e) => {
    const d = dragRef.current;
    if (!d.dragging) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) d.moved = true;
    if (d.moved) setPos(clampPosition(d.startPosX + dx, d.startPosY + dy));
  };

  const handlePointerUp = (e) => {
    const d = dragRef.current;
    if (!d.dragging) return;
    d.dragging = false;
    if (d.moved) {
      // A click event still fires right after this on most browsers even
      // though it was a drag -- this flag lets handleClick ignore that one.
      justDraggedRef.current = true;
      setPos(curr => {
        if (curr) {
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(curr)); } catch {}
        }
        return curr;
      });
    }
    btnRef.current?.releasePointerCapture?.(e.pointerId);
  };

  const handleClick = () => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  if (!pos) return null;

  return (
    <button
      ref={btnRef}
      type="button"
      className="whatsapp-float-btn"
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={handleClick}
      aria-label="Chat with us on WhatsApp. Drag to move this button."
      title="Chat with us on WhatsApp — drag to move"
    >
      <WhatsAppIcon size={20} color="#fff" />
    </button>
  );
}
