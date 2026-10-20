import { useEffect, useState } from 'react';
import { Award } from 'lucide-react';
import { supabase } from '../config/supabase';
import { COINS } from '../config/rewardNames';

// Burger Rank card for the Loyalty page. The rank comes from lifetime spend on
// collected orders (never from points), so games and bonuses can't raise it.
// If the rank data can't be loaded (older database, offline) the card falls
// back to the plain points header instead of breaking the page.
const PERIOD_TEXT = { once: 'one time', month: 'every month', year: 'once a year', birthday: 'in your birthday month, once a year' };
// A friendly icon per perk (matched on the perk name).
const perkIcon = (name = '') => {
  const n = name.toLowerCase();
  if (n.includes('cheese')) return '🧀';
  if (n.includes('birthday')) return '🎂';
  if (n.includes('egg')) return '🥚';
  if (n.includes('platter')) return '🍔';
  return '🎁';
};
// "Regular perk: free Cheese" -> "Free Cheese"
const perkTitle = (name = '') => { const t = name.replace(/^[^:]+: /, ''); return t.charAt(0).toUpperCase() + t.slice(1); };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const rm = (cents) => `RM${(Number(cents || 0) / 100).toLocaleString('en-MY', { maximumFractionDigits: 0 })}`;

export default function RankCard({ points, displayedPoints }) {
  const [rank, setRank] = useState(null);
  const [perks, setPerks] = useState([]);
  const [rankUp, setRankUp] = useState('');
  const [reload, setReload] = useState(0);
  const [bMonth, setBMonth] = useState('');
  const [bDay, setBDay] = useState('');
  const [bErr, setBErr] = useState('');

  useEffect(() => {
    let active = true;
    Promise.resolve(supabase.rpc('my_tier'))
      .then(({ data, error }) => { if (active && !error && data) setRank(data); })
      .catch(() => {});
    return () => { active = false; };
  }, [points, reload]);

  useEffect(() => {
    let active = true;
    Promise.resolve(supabase.rpc('my_perks'))
      .then(({ data, error }) => { if (active && !error && Array.isArray(data)) setPerks(data); })
      .catch(() => {});
    return () => { active = false; };
  }, [points, reload]);

  // Rank-up message: shown once, the next time the customer opens the page after reaching a higher rank.
  useEffect(() => {
    if (!rank || !Array.isArray(rank.tiers)) return;
    try {
      const idx = rank.tiers.findIndex(t => t.name === rank.tier);
      const stored = localStorage.getItem('munchies_rank_seen');
      if (stored !== null && idx > Number(stored)) setRankUp(rank.tier);
      localStorage.setItem('munchies_rank_seen', String(idx));
    } catch { /* private mode: no message, no problem */ }
  }, [rank]);

  const saveBirthday = async (e) => {
    e.preventDefault();
    setBErr('');
    const { error } = await supabase.rpc('save_my_birthday', { p_month: Number(bMonth), p_day: Number(bDay) });
    if (error) setBErr(error.message || 'Could not save. Please try again.');
    else setReload(n => n + 1);
  };

  const needsBirthday = perks.some(p => p.unlocked && p.needs_birthday);
  const toGo = rank && rank.next_tier ? (rank.rm_to_next_cents ?? (rank.next_min_spend_cents - rank.spend_cents)) : 0;

  const next = rank && rank.next_tier;
  const span = next ? Math.max(1, rank.next_min_spend_cents - rank.min_spend_cents) : 1;
  const progress = !rank ? 0 : next ? Math.min(100, Math.max(0, ((rank.spend_cents - rank.min_spend_cents) / span) * 100)) : 100;

  return (
    <>
      <div className="card rank-header-card">
        <div className="medal-circle"><Award size={32} color="#fff" /></div>
        <h1>{rank ? rank.tier.toUpperCase() : 'LOYALTY REWARDS'}</h1>
        <p className="rank-level">{rank ? 'BURGER RANK' : COINS.toUpperCase()}</p>
        <div className="points-flex">
          <span>{displayedPoints.toLocaleString()} {COINS.toUpperCase()}</span>
          {rank && <span>{next ? `${rm(toGo)} TO ${next.toUpperCase()}` : 'TOP RANK'}</span>}
        </div>
        {rank && (
          <div className="progress-bar-lg">
            <div className="progress-fill-lg" style={{ transform: `scaleX(${progress / 100})` }}></div>
          </div>
        )}
        {rank && (
          <p className="rank-perks">
            {rank.claims_used} of {rank.claims_per_month} reward{rank.claims_per_month === 1 ? '' : 's'} used this month
            {rank.bonus_percent > 0 ? ` · +${rank.bonus_percent}% bonus ${COINS} on orders` : ''}
          </p>
        )}
      </div>

      {rankUp && (
        <div className="rank-up-card" role="status">
          <span className="rank-up-emoji" aria-hidden="true">🎉</span>
          <div>
            <strong>You reached {rankUp}!</strong>
            <span>Check your perks below. Pick one at checkout with a paid order.</span>
          </div>
          <button type="button" className="rank-up-dismiss" onClick={() => setRankUp('')}>Got it</button>
        </div>
      )}

      {perks.length > 0 && (
        <section className="rank-perks-card" aria-label="Your rank perks">
          <header className="perk-head">
            <h3>Your rank perks</h3>
            <p>Free with a paid order. One reward per order, and perks never use up your monthly rewards.</p>
          </header>
          <div className="perk-grid">
            {perks.map(p => {
              const state = !p.unlocked ? 'locked' : p.used ? 'used' : (p.needs_birthday || !p.birthday_month_now) ? 'wait' : 'ready';
              const chip = state === 'locked' ? `Unlocks at ${p.rank}`
                : state === 'used' ? 'Used for now'
                : p.needs_birthday ? 'Add your birthday'
                : !p.birthday_month_now ? 'Birthday month only'
                : 'Ready at checkout';
              return (
                <article key={p.id} className={`perk-tile perk-${state}`}>
                  <span className="perk-icon" aria-hidden="true">{state === 'locked' ? '🔒' : perkIcon(p.name)}</span>
                  <div className="perk-body">
                    <strong>{perkTitle(p.name)}</strong>
                    <span className="perk-meta">{p.rank} rank · {PERIOD_TEXT[p.period] || ''}</span>
                    <span className="perk-min">With an order of RM{(p.min_order_cents / 100).toFixed(0)}+</span>
                  </div>
                  <span className={`perk-chip perk-chip-${state}`}>{chip}</span>
                </article>
              );
            })}
          </div>
          {needsBirthday && (
            <form className="rank-birthday" onSubmit={saveBirthday}>
              <label>Birthday (month and day only, saved once)</label>
              <div>
                <select value={bMonth} onChange={(e) => setBMonth(e.target.value)} required aria-label="Birthday month">
                  <option value="">Month</option>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <select value={bDay} onChange={(e) => setBDay(e.target.value)} required aria-label="Birthday day">
                  <option value="">Day</option>
                  {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                </select>
                <button type="submit" className="btn btn-sm btn-primary">Save</button>
              </div>
              {bErr && <p role="alert">{bErr}</p>}
            </form>
          )}
        </section>
      )}

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
