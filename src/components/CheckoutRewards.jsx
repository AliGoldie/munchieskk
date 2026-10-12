import { Gift, CheckCircle2 } from 'lucide-react';
import { rewardBlockReason } from '../utils/rewardRules';
import './CheckoutRewards.css';

// "Use a reward" picker for the Payment page. Shows the rewards a customer
// can take straight into this order (a free menu item or a free add-on) and
// why any of them is unavailable. The server re-checks everything in
// apply_order_reward, so this is only guidance, never the authority.
const pts = (n) => Number(n || 0).toLocaleString();

export default function CheckoutRewards({ prizes, points, menu, addons, itemAddons, cart, orderTotal, selectedId, onSelect }) {
  const options = (prizes || []).filter(p => p.menu_item_id || p.addon_id);
  if (options.length === 0) return null;

  const ctx = { points, menu, addons, itemAddons, cart, orderTotal };

  return (
    <div className="checkout-rewards">
      <div className="checkout-rewards-head"><Gift size={16} /> Use your points <span>{pts(points)} pts</span></div>
      <p className="checkout-rewards-sub">Add one free reward to this order. The points are taken when you pay and given back if you cancel.</p>
      <div className="checkout-rewards-list" role="radiogroup" aria-label="Rewards">
        {options.map(p => {
          const blocked = rewardBlockReason(p, ctx);
          const selected = selectedId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!!blocked}
              className={`checkout-reward${selected ? ' selected' : ''}`}
              onClick={() => onSelect(selected ? null : p.id)}
            >
              <span className="checkout-reward-name">{p.name}</span>
              <span className="checkout-reward-cost">{blocked ? blocked : `${pts(p.points_cost)} pts`}</span>
              {selected && <CheckCircle2 size={18} className="checkout-reward-tick" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
