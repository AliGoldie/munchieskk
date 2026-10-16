import { useEffect, useState } from 'react';
import { Trophy, Target } from 'lucide-react';
import { supabase } from '../config/supabase';
import { siteConfig } from '../config/siteConfig';
import { contestWinMessage } from '../utils/whatsapp';
import './ArcadeContestCard.css';

const PLACES = ['1st', '2nd', '3rd'];
const claimLine = (cents) => (cents > 0 ? `Claim with any order of RM${(cents / 100).toLocaleString('en-MY', { maximumFractionDigits: 2 })} or more.` : 'No purchase needed to claim.');
const fmtDay = (d) => new Date(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', timeZone: 'Asia/Kuching' });

function timeLeft(endsAt, now) {
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 0) return 'ending now';
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

// A winner without a phone number must add one before the claim code shows.
function PhoneGate({ onSaved }) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const { error } = await supabase.rpc('save_my_phone', { p_phone: phone });
    setBusy(false);
    if (error) setErr(error.message || 'Could not save the number. Please try again.');
    else onSaved();
  };
  return (
    <form onSubmit={save}>
      <p>Add your phone number so we can WhatsApp you your pickup details. Your claim code will show right after.</p>
      <input className="price-input" type="tel" inputMode="tel" autoComplete="tel" placeholder="e.g. 012-345 6789"
        value={phone} onChange={(e) => setPhone(e.target.value)} required />
      {err && <p className="acc-fine" role="alert">{err}</p>}
      <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Save and show my code'}</button>
    </form>
  );
}

// Arcade contest + weekly goal. The score here is never spent: it only
// decides the contest podium and the weekly goal bonus. Safe for guests.
export default function ArcadeContestCard({ refreshKey }) {
  const [data, setData] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.resolve(supabase.rpc('arcade_contest_status'))
      .then(({ data: d, error }) => { if (active && !error && d) setData(d); })
      .catch((err) => console.error('Error fetching arcade contest:', err));
    return () => { active = false; };
  }, [refreshKey, reload]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  if (!data) return null;
  const { current, next, last, my, my_wins: wins = [], goal } = data;
  const goalPct = goal ? Math.min(100, Math.round((goal.week_score / goal.goal_score) * 100)) : 0;

  return (
    <>
      {wins.map((w) => (
        <div className="card arcade-win-card" key={`${w.contest}-${w.rank}`}>
          <h3>You came {PLACES[w.rank - 1] || `#${w.rank}`} in {w.contest}: {w.prize}!</h3>
          {w.needs_phone ? (
            <PhoneGate onSaved={() => setReload((n) => n + 1)} />
          ) : (
            <>
              <p>Show this code at the counter to collect it. {claimLine(w.claim_min_order_cents ?? 1000)}</p>
              <div className="arcade-win-code">{w.claim_code}</div>
              <a className="btn btn-sm btn-primary" target="_blank" rel="noopener noreferrer"
                href={`https://wa.me/${siteConfig.whatsappNumber}?text=${encodeURIComponent(contestWinMessage(PLACES[w.rank - 1] || `#${w.rank}`, w.contest, w.claim_code))}`}>
                Confirm on WhatsApp
              </a>
            </>
          )}
        </div>
      ))}

      <div className="card arcade-contest-card">
        <div className="acc-head">
          <Trophy size={18} />
          <span>ARCADE CONTEST</span>
          {current && <span className="acc-left">{timeLeft(current.ends_at, now)}</span>}
        </div>

        {current ? (
          <>
            <h3>{current.title}</h3>
            <p className="acc-sub">Your best score in each game, added together. Top 3 win free food.</p>
            <div className="acc-prizes">
              {current.prizes.map((z) => (
                <div key={z.rank} className={`acc-prize acc-prize-${z.rank}`}>
                  <b>{PLACES[z.rank - 1]}</b>
                  <span>{z.name}</span>
                </div>
              ))}
            </div>
            {my ? (
              <p className="acc-me">
                {my.rank
                  ? <>You are <b>#{my.rank}</b> with <b>{my.total.toLocaleString()}</b>.{my.gap_to_podium > 0 ? ` ${my.gap_to_podium.toLocaleString()} more to reach the podium.` : ' You are on the podium!'}</>
                  : my.total > 0
                    ? <>You have <b>{my.total.toLocaleString()}</b>. Reach {current.min_score.toLocaleString()} to join the ranking.</>
                    : <>Play any arcade game to join. Reach {current.min_score.toLocaleString()} to qualify.</>}
              </p>
            ) : (
              <p className="acc-me">Log in and play to join the contest.</p>
            )}
            <p className="acc-fine">Ends {fmtDay(current.ends_at)}. {claimLine(current.claim_min_order_cents ?? 1000)} First names only. One prize per person.</p>
          </>
        ) : next ? (
          <>
            <h3>{next.title}</h3>
            <p className="acc-sub">Starts {fmtDay(next.starts_at)}. Top 3 win free food. {claimLine(next.claim_min_order_cents ?? 1000)}</p>
            <div className="acc-prizes">
              {next.prizes.map((z) => (
                <div key={z.rank} className={`acc-prize acc-prize-${z.rank}`}>
                  <b>{PLACES[z.rank - 1]}</b>
                  <span>{z.name}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <h3>Next contest coming soon</h3>
            <p className="acc-sub">Play the three arcade games. Top scores will win free food.</p>
          </>
        )}

        {last && last.winners.length > 0 && (
          <p className="acc-last">
            Last contest: {last.winners.map((w) => `${w.first_name}${w.prize ? ` (${w.prize})` : ''}`).join(', ')}
          </p>
        )}

        {goal && (
          <div className="acc-goal">
            <div className="acc-goal-row">
              <Target size={14} />
              <span>Weekly goal</span>
              <b>{Math.min(goal.week_score, goal.goal_score).toLocaleString()} / {goal.goal_score.toLocaleString()}</b>
            </div>
            <div className="acc-bar"><div className="acc-bar-fill" style={{ width: `${goalPct}%` }} /></div>
            <p className="acc-fine">
              {goal.done ? `Goal reached this week. +${goal.goal_points} points paid.` : `Reach it this week for +${goal.goal_points} loyalty points.`}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
