import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import './ChampionsAnnouncement.css';

const SEEN_KEY = 'mk_champions_seen';
const MIN_CHAMPION_SCORE = 300;

// The Monday of the current week in Malaysia time (UTC+8), as YYYY-MM-DD.
// One announcement per device per week, so it never nags.
function weekId() {
  const d = new Date(Date.now() + 8 * 3600e3);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86400e3).toISOString().slice(0, 10);
}

function readSeen() { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } }
function writeSeen(v) { try { localStorage.setItem(SEEN_KEY, v); } catch { /* ignore */ } }

function CountUp({ to }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setN(to); return undefined; }
    let raf;
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0 - 1100) / 1400);
      setN(Math.round(to * (k < 0 ? 0 : 1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{n.toLocaleString()}</>;
}

// Once a week, when last week's winners exist, a big celebration for the champion.
export default function ChampionsAnnouncement() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const week = weekId();

  useEffect(() => {
    if (readSeen() === week) return undefined;
    let active = true;
    Promise.resolve(supabase.rpc('arcade_leaderboard', { p_period: 'lastweek', p_game: 'all' }))
      .then(({ data, error }) => {
        if (!active || error || !data?.rows?.length) return;
        if (Number(data.rows[0].score) < MIN_CHAMPION_SCORE) return;
        setRows(data.rows.slice(0, 3));
        setTimeout(() => { if (active) setOpen(true); }, 900);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [week, user?.id]);

  const confetti = useMemo(() => Array.from({ length: 36 }, (_, i) => ({
    left: (i * 29) % 100,
    delay: ((i * 7) % 20) / 10,
    dur: 2.4 + ((i * 3) % 14) / 10,
    hue: [48, 8, 140, 200, 300][i % 5],
    rot: (i * 47) % 360
  })), []);

  if (!open || !rows) return null;

  const close = () => { writeSeen(week); setOpen(false); };
  const champ = rows[0];

  return (
    <div className="champ-overlay" role="dialog" aria-modal="true" aria-label="Last week's champion" onClick={close}>
      <div className="champ-rays" aria-hidden="true" />
      <div className="champ-confetti" aria-hidden="true">
        {confetti.map((c, i) => (
          <i key={i} style={{ left: `${c.left}%`, animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s`, background: `hsl(${c.hue} 95% 58%)`, transform: `rotate(${c.rot}deg)` }} />
        ))}
      </div>
      <div className="champ-card" onClick={(e) => e.stopPropagation()}>
        <div className="champ-crown" aria-hidden="true">👑</div>
        <div className="champ-kicker">LAST WEEK'S</div>
        <h2 className="champ-title">CHAMPION</h2>
        <div className="champ-name">{champ.name}{champ.is_me ? ' (you!)' : ''}</div>
        <div className="champ-score"><CountUp to={Number(champ.score)} /> <span>XP</span></div>
        {champ.is_me && <div className="champ-me">THAT'S YOU! 🔥</div>}
        {rows.length > 1 && (
          <ol className="champ-others">
            {rows.slice(1).map((r, i) => (
              <li key={r.rank} style={{ animationDelay: `${2.2 + i * 0.25}s` }}>
                <span>{i === 0 ? '🥈' : '🥉'}</span> {r.name}{r.is_me ? ' (you)' : ''} <b>{Number(r.score).toLocaleString()}</b>
              </li>
            ))}
          </ol>
        )}
        <p className="champ-cta">A new week, a new race. Can you take the crown?</p>
        <div className="champ-buttons">
          <Link to="/leaderboard" className="btn btn-primary" onClick={close}>SEE LEADERBOARD</Link>
          <button type="button" className="champ-close" onClick={close}>Let me play</button>
        </div>
      </div>
    </div>
  );
}
