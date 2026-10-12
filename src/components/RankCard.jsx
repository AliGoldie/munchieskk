import { useEffect, useState } from 'react';
import { Award } from 'lucide-react';
import { supabase } from '../config/supabase';

// Burger Rank card for the Loyalty page. The rank comes from lifetime spend on
// collected orders (never from points), so games and bonuses can't raise it.
// If the rank data can't be loaded (older database, offline) the card falls
// back to the plain points header instead of breaking the page.
const rm = (cents) => `RM${(Number(cents || 0) / 100).toLocaleString('en-MY', { maximumFractionDigits: 0 })}`;

export default function RankCard({ points, displayedPoints }) {
  const [rank, setRank] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.resolve(supabase.rpc('my_tier'))
      .then(({ data, error }) => { if (active && !error && data) setRank(data); })
      .catch(() => {});
    return () => { active = false; };
  }, [points]);

  const next = rank && rank.next_tier;
  const span = next ? Math.max(1, rank.next_min_spend_cents - rank.min_spend_cents) : 1;
  const progress = !rank ? 0 : next ? Math.min(100, Math.max(0, ((rank.spend_cents - rank.min_spend_cents) / span) * 100)) : 100;

  return (
    <>
      <div className="card rank-header-card">
        <div className="medal-circle"><Award size={32} color="#fff" /></div>
        <h1>{rank ? rank.tier.toUpperCase() : 'LOYALTY REWARDS'}</h1>
        <p className="rank-level">{rank ? 'BURGER RANK' : 'YOUR POINTS'}</p>
        <div className="points-flex">
          <span>{displayedPoints.toLocaleString()} POINTS</span>
          {rank && <span>{next ? `${rm(rank.next_min_spend_cents - rank.spend_cents)} TO ${next.toUpperCase()}` : 'TOP RANK'}</span>}
        </div>
        {rank && (
          <div className="progress-bar-lg">
            <div className="progress-fill-lg" style={{ transform: `scaleX(${progress / 100})` }}></div>
          </div>
        )}
        {rank && (
          <p className="rank-perks">
            {rank.claims_used} of {rank.claims_per_month} reward{rank.claims_per_month === 1 ? '' : 's'} used this month
            {rank.bonus_percent > 0 ? ` · +${rank.bonus_percent}% bonus points on orders` : ''}
          </p>
        )}
      </div>

      {rank && Array.isArray(rank.tiers) && rank.tiers.length > 0 && (
        <div className="rank-ladder" aria-label="Burger ranks">
          {rank.tiers.map(t => (
            <div key={t.name} className={`rank-step${t.name === rank.tier ? ' current' : ''}`}>
              <strong>{t.name}</strong>
              <span>{t.min_spend_cents > 0 ? `${rm(t.min_spend_cents)} spent` : 'Start here'}</span>
              <span>{t.claims_per_month} reward{t.claims_per_month === 1 ? '' : 's'}/mo{t.bonus_percent > 0 ? `, +${t.bonus_percent}%` : ''}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
