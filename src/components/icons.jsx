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
