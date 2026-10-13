import { useEffect, useState } from 'react';
import { Trophy, Target } from 'lucide-react';
import { supabase } from '../config/supabase';
import './ArcadeContestCard.css';

const PLACES = ['1st', '2nd', '3rd'];
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

// Arcade contest + weekly goal. The score here is never spent: it only
// decides the contest podium and the weekly goal bonus. Safe for guests.
export default function ArcadeContestCard({ refreshKey }) {
  const [data, setData] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    Promise.resolve(supabase.rpc('arcade_contest_status'))
      .then(({ data: d, error }) => { if (active && !error && d) setData(d); })
      .catch((err) => console.error('Error fetching arcade contest:', err));
    return () => { active = false; };
  }, [refreshKey]);

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
          <p>Show this code at the counter to collect it.</p>
          <div className="arcade-win-code">{w.claim_code}</div>
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
                    : <>Play T-Rex Runner or Speed Grab to join. Reach {current.min_score.toLocaleString()} to qualify.</>}
              </p>
            ) : (
              <p className="acc-me">Log in and play to join the contest.</p>
            )}
            <p className="acc-fine">Ends {fmtDay(current.ends_at)}. First names only are shown. One account per phone number.</p>
          </>
        ) : next ? (
          <>
            <h3>{next.title}</h3>
            <p className="acc-sub">Starts {fmtDay(next.starts_at)}. Top 3 win free food.</p>
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
            <p className="acc-sub">Play T-Rex Runner and Speed Grab. Top scores will win free food.</p>
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
