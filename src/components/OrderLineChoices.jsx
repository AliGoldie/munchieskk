import { describeChoices } from '../utils/meatSwaps';

// One small line under an order or cart item showing the meat the customer
// chose, e.g. "Chicken" or "Burger 1: Chicken · Big-G (Lamb)". Shows nothing
// for items without a choice.
export default function OrderLineChoices({ item, className = 'text-sm text-muted', style }) {
  const parts = describeChoices(item?.choices);
  if (parts.length === 0) return null;
  const extra = Number(item?.swapCharge) || 0;
  return (
    <div className={className} style={style}>
      {parts.join(' · ')}{extra > 0 ? ` (+RM ${(extra / 100).toFixed(2)})` : ''}
    </div>
  );
}
