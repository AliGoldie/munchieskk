import { useEffect, useState } from 'react';
import { Check, Lock } from 'lucide-react';
import { supabase } from '../config/supabase';
import { COINS } from '../config/rewardNames';
import { thumbSrc } from '../utils/imageVariants';
import './RankCard.css';

// Burger Rank card for the Loyalty page. The rank comes from lifetime spend on
// collected orders (never from points), so games and bonuses can't raise it.
// If the rank data can't be loaded (older database, offline) the card falls
// back to the plain points header instead of breaking the page.
const PERK_TAG = { once: 'one time', month: 'monthly', year: 'yearly', birthday: 'birthday month' };
const PERIOD_TEXT = { once: 'One time', month: 'Every month', year: 'Once a year', birthday: 'Once a year, in your birthday month' };
// A real menu photo per rank and per perk (matched on the name). Unknown names fall back to the fries photo.
const RANK_PHOTO = { Rookie: 'regular_fries.png', Regular: 'bbqbeefburger.jpg', Pro: 'BigG.jpg', Master: 'mushy_burger.jpg', Ultimate: 'kawan_monsta.jpg' };
const rankPhoto = (name) => thumbSrc(`/images/${RANK_PHOTO[name] || 'regular_fries.png'}`);
const perkPhoto = (name = '') => {
  const n = name.toLowerCase();
  const file = n.includes('cheese') ? 'bbqbeefburger.jpg'
    : n.includes('birthday') || n.includes('ice') ? 'iceBB.jpg'
    : n.includes('egg') ? 'mushy_burger.jpg'
    : n.includes('platter') || n.includes('kawan') ? 'kawan_monsta.jpg'
    : 'regular_fries.png';
  return thumbSrc(`/images/${file}`);
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

  const idx = rank && Array.isArray(rank.tiers) ? rank.tiers.findIndex(t => t.name === rank.tier) : -1;
  const nextThreshold = next && rank.next_min_spend_cents != null ? rank.next_min_spend_cents : null;

  return (
    <>
      <section className="rk-hero" aria-label="Your Burger Rank">
        <div className="rk-hero-top">
          <p className="rk-kicker">{rank ? 'Your burger rank' : COINS}</p>
          <h2 className="rk-title">{rank ? rank.tier : 'Loyalty rewards'}</h2>
        </div>
        <div className="rk-hero-low">
          {rank && (
            <p className="rk-line">
              {next ? <>You have spent <b>{rm(rank.spend_cents)}</b>. Spend <b>{rm(toGo)}</b> more to reach <b>{next}</b>.</> : <>You have spent <b>{rm(rank.spend_cents)}</b>. You are at the <b>top rank</b>.</>}
            </p>
          )}
          {rank && (
            <div className="rk-bar" role="progressbar" aria-label={next ? `Progress to ${next}` : 'Top rank reached'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
              <i style={{ transform: `scaleX(${progress / 100})` }}></i>
            </div>
          )}
          <div className="rk-meta">
            <span>{rank ? `${rank.tier.toUpperCase()} ${rm(rank.min_spend_cents)}` : ''}</span>
            <span>{nextThreshold != null ? `${next.toUpperCase()} ${rm(nextThreshold)}` : rank ? 'TOP RANK' : ''}</span>
          </div>
          <div className="rk-coins">
            <strong>{displayedPoints.toLocaleString()}</strong> {COINS}
            {rank && (
              <span>
                {rank.claims_used} of {rank.claims_per_month} reward{rank.claims_per_month === 1 ? '' : 's'} used this month
                {rank.bonus_percent > 0 ? ` · +${rank.bonus_percent}% bonus ${COINS} on orders` : ''}
              </span>
            )}
          </div>
        </div>
      </section>

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

      {((rank && Array.isArray(rank.tiers) && rank.tiers.length > 0) || perks.length > 0) && (
        <div className="rk-sheet">
          {rank && Array.isArray(rank.tiers) && rank.tiers.length > 0 && (
            <section aria-label="Burger ranks">
              <h3 className="rk-h">The ladder</h3>
              <p className="rk-sub">Every rank is a bigger order. Games, shares and friends never change your rank.</p>
              <ol className="rk-ladder">
                {rank.tiers.map((t, i) => ({ t, i })).reverse().map(({ t, i }) => {
                  const state = i < idx ? 'done' : i === idx ? 'cur' : i === idx + 1 ? 'next' : 'lock';
                  const reached = state === 'done' || state === 'cur';
                  const toReach = Math.max(0, (t.min_spend_cents || 0) - (rank.spend_cents || 0));
                  return (
                    <li key={t.name} className={`rk-rung rk-${state}${reached ? ' rk-reached' : ''}`} aria-current={state === 'cur' ? 'step' : undefined}>
                      <div className="rk-pic">
                        <img src={rankPhoto(t.name)} alt="" loading="lazy" width="78" height="78" />
                        {state === 'cur' && <span className="rk-you">YOU</span>}
                        <span className="rk-badge" aria-hidden="true">{reached ? <Check size={13} strokeWidth={3.4} /> : <Lock size={12} strokeWidth={2.8} />}</span>
                      </div>
                      <div className="rk-card">
                        <span className="rk-k">{t.min_spend_cents > 0 ? `${t.name} · ${rm(t.min_spend_cents)}` : `${t.name} · Start`}</span>
                        <h4>{t.name}</h4>
                        <p>{t.claims_per_month} reward{t.claims_per_month === 1 ? '' : 's'} a month{t.bonus_percent > 0 ? `, +${t.bonus_percent}% ${COINS}` : ''}</p>
                        <span className="rk-st">
                          {state === 'done' ? 'Done' : state === 'cur' ? 'You are here' : state === 'next' ? `Next level · ${rm(toReach)} to go` : `Locked · ${rm(toReach)} to go`}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {perks.length > 0 && (
            <section aria-label="Your rank perks">
              <h3 className="rk-h">Coupon book</h3>
              <p className="rk-sub">Free with a paid order. One reward per order, and perks never use up your monthly rewards.</p>
              <div className="rk-book">
                {perks.map(p => {
                  const state = !p.unlocked ? 'locked' : p.used ? 'used' : (p.needs_birthday || !p.birthday_month_now) ? 'wait' : 'ready';
                  const chip = state === 'locked' ? `Unlocks at ${p.rank}`
                    : state === 'used' ? 'Used for now'
                    : p.needs_birthday ? 'Add your birthday'
                    : !p.birthday_month_now ? 'Birthday month only'
                    : 'Ready at checkout';
                  const top = /platter|kawan/i.test(p.name || '');
                  return (
                    <article key={p.id} className={`rk-coupon rk-coupon-${state}${top ? ' rk-coupon-top' : ''}`}>
                      <img className="rk-coupon-img" src={perkPhoto(p.name)} alt="" loading="lazy" />
                      <div className="rk-coupon-body">
                        <span className="rk-k">{p.rank} perk · {PERK_TAG[p.period] || ''}</span>
                        <h4>{perkTitle(p.name)}</h4>
                        <p>{PERIOD_TEXT[p.period] ? `${PERIOD_TEXT[p.period]}. ` : ''}With an order of RM{(p.min_order_cents / 100).toFixed(0)}+.</p>
                        <span className={`rk-chip rk-chip-${state}`}>{chip}</span>
                      </div>
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
        </div>
      )}
    </>
  );
}
