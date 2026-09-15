import { useEffect, useRef, useState } from 'react';

// Animates a displayed number toward `value` over `duration`ms using
// elapsed-time (not frame-count) progress, so the animation runs at the
// same speed regardless of display refresh rate. Picks up from wherever
// the last animation actually landed if `value` changes again mid-flight,
// instead of snapping or restarting from the old target.
export function useCountUp(value, duration = 700) {
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);

  useEffect(() => {
    const from = displayRef.current;
    const to = value;
    if (from === to) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      displayRef.current = to;
      setDisplay(to);
      return;
    }

    let rafId;
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(from + (to - from) * eased);
      displayRef.current = next;
      setDisplay(next);
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [value, duration]);

  return display;
}
