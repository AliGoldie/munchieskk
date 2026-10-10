import { Flame, Crown, UtensilsCrossed, Salad, CupSoda, IceCreamCone, Popcorn, Hamburger, Sparkles, Tag } from 'lucide-react';

// Categories store their icon as an emoji key (older saved lists already use
// these), so the key stays the same and only how it is drawn changes: a
// consistent line icon in a dark tile instead of a platform-dependent emoji.
export const CATEGORY_ICONS = [
  { key: '🔥', label: 'BBQ / Grill', Icon: Flame },
  { key: '👑', label: 'Premium', Icon: Crown },
  { key: '🍽️', label: 'Platter', Icon: UtensilsCrossed },
  { key: '🥗', label: 'Sides', Icon: Salad },
  { key: '🍟', label: 'Fries / Snacks', Icon: Popcorn },
  { key: '🥤', label: 'Drinks', Icon: CupSoda },
  { key: '🍦', label: 'Dessert', Icon: IceCreamCone },
  { key: '🍔', label: 'Burger', Icon: Hamburger },
  { key: '✨', label: 'Special', Icon: Sparkles },
];

export function iconFor(key) {
  return CATEGORY_ICONS.find(i => i.key === key)?.Icon || Tag;
}

// variant "tile": dark rounded square with a gold icon (lists/cards).
// variant "inline": bare icon in the current text colour (inside badges).
export default function CategoryIcon({ icon, size = 18, variant = 'tile' }) {
  const Icon = iconFor(icon);
  if (variant === 'inline') return <Icon size={size} strokeWidth={2.25} aria-hidden="true" />;
  return (
    <span className="cat-icon-tile" aria-hidden="true">
      <Icon size={size} strokeWidth={1.9} />
    </span>
  );
}
