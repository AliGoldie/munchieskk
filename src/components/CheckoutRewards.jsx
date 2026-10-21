import { useEffect, useState } from 'react';
import { Gift, CheckCircle2 } from 'lucide-react';
import { supabase } from '../config/supabase';
import { rewardBlockReason } from '../utils/rewardRules';
import { rewardValueText } from '../utils/rewardValue';
import { upcomingPriceChange, fmtMYDate } from '../utils/rewardSchedule';
import './CheckoutRewards.css';

// "Use a reward" picker for the Payment page. Shows the rewards a customer
// can take straight into this order (a free menu item or a free add-on) and
// why any of them is unavailable. The server re-checks everything in
// apply_order_reward, so this is only guidance, never the authority.
const pts = (n) => Number(n || 0).toLocaleString();

export default function CheckoutRewards({ prizes, perks, points, menu, addons, itemAddons, cart, orderTotal, selectedId, onSelect }) {
  const [perkState, setPerkState] = useState(null);
  const hasPerks = (perks || []).length > 0;

  // What this customer can use right now (rank, once per period). Guests and an
  // older database simply see no perks.
  useEffect(() => {
    if (!hasPerks) return undefined;
    let active = true;
    Promise.resolve(supabase.rpc('my_perks'))
      .then(({ data, error }) => {
        if (!active || error || !Array.isArray(data)) return;
        setPerkState(Object.fromEntries(data.map(x => [x.id, x])));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [hasPerks]);

  const unlockedPerks = (perks || []).filter(p => perkState?.[p.id]?.unlocked);
  const options = [...(prizes || []), ...unlockedPerks].filter(p => p.menu_item_id || p.addon_id);
  if (options.length === 0) return null;

  const ctx = { points, menu, addons, itemAddons, cart, orderTotal, perkState };

  return (
    <div className="checkout-rewards">
      <div className="checkout-rewards-head"><Gift size={16} /> Use your Monsta Coins <span>{pts(points)} coins</span></div>
      <p className="checkout-rewards-sub">Add one free reward to this order. The Monsta Coins are taken when you pay and given back if you cancel.</p>
      <div className="checkout-rewards-list" role="radiogroup" aria-label="Rewards">
        {options.map(p => {
          const blocked = rewardBlockReason(p, ctx);
          const selected = selectedId === p.id;
          const drop = upcomingPriceChange(p);
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
              <span className="checkout-reward-name">{p.name}{rewardValueText(p, menu, addons) && <small> ({rewardValueText(p, menu, addons)})</small>}</span>
              <span className="checkout-reward-cost">{blocked ? blocked : p.perk_rank_order != null ? 'Rank perk' : `${pts(p.points_cost)} coins${drop ? ` · ${pts(drop.cost)} from ${fmtMYDate(drop.from)}` : ''}`}</span>
              {selected && <CheckCircle2 size={18} className="checkout-reward-tick" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
