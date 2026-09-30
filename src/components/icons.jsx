// Custom on-brand icons echoing the MUNCHIESKK logo's bite-mark motif
// (jagged teeth ring) and bold graphic style. Drop-in replacements for the
// lucide-react icons they're named after -- same size/color/props contract
// (stroke or fill uses currentColor, so they inherit color exactly like
// lucide icons did at their call sites).

export function BiteBagIcon({ size = 24, color = 'currentColor', strokeWidth = 2, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M9 7V5a3 3 0 0 1 6 0v2" />
      <path d="M4 9l2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2" />
      <path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" />
    </svg>
  );
}

export function EmberFlameIcon({ size = 24, color = 'currentColor', ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      stroke="none"
      {...props}
    >
      <path d="M12 2c1.1 2.7 3.7 4.6 3.9 8.2.2 3.3-1.9 5.8-4.9 5.8a4.5 4.5 0 0 1-4.5-4.7c.05-1.1.4-1.9.95-2.9.3.9 1 1.5 1.85 1.5a1.7 1.7 0 0 0 1.7-1.75c0-1.05-.6-1.85-1.3-2.95C8.9 4 9.9 2.9 12 2z" />
    </svg>
  );
}

export function BurgerIcon({ size = 24, color = 'currentColor', ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      stroke="none"
      {...props}
    >
      <path d="M4 9a8 8 0 0 1 16 0z" />
      <rect x="3" y="10.5" width="18" height="2.2" rx="1.1" />
      <rect x="3" y="14" width="18" height="2" rx="1" />
      <path d="M3 17.5h18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

// Standard WhatsApp glyph (phone handset in a speech bubble) -- the widely
// recognized mark WhatsApp's own brand guidelines expect on a third-party
// "chat with us" button, so it isn't swapped for something bespoke.
export function WhatsAppIcon({ size = 24, color = 'currentColor', ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 448 512"
      fill={color}
      stroke="none"
      {...props}
    >
      <path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z" />
    </svg>
  );
}

export function SpikyBadgeIcon({ size = 24, color = 'currentColor', ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.5}
      strokeLinejoin="round"
      {...props}
    >
      <polygon points="12,1 14,8.54 21.53,6.5 16,12 21.53,17.5 14,15.46 12,23 10,15.46 2.47,17.5 8,12 2.47,6.5 10,8.54" />
      <circle cx="12" cy="12" r="4.5" fill={color} stroke="none" />
    </svg>
  );
}
