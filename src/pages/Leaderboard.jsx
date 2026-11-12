import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import './Leaderboard.css';

const GAMES = [
  { id: 'all', label: 'Overall' },
  { id: 'trex_runner', label: 'T-Rex' },
  { id: 'speed_grab', label: 'Speed Grab' },
  { id: 'munch_man', label: 'Munch-Man' }
];
const PERIODS = [
  { id: 'week', label: 'This week' },
  { id: 'lastweek', label: 'Last week' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' }
];
const THEMES = {
  all: { img: '/images/hero_burger.webp', title: 'HALL OF FAME', tag: 'The best of all three games', hue: 45 },
  trex_runner: { img: '/images/trex_runner_game.webp', title: 'T-REX RUNNER', tag: 'Who runs the farthest?', hue: 20 },
  speed_grab: { img: '/images/fry_catch.webp', title: 'SPEED GRAB', tag: 'Who grabs the fastest?', hue: 50 },
  munch_man: { img: '/images/munchman_game.webp', title: 'MUNCH-MAN', tag: 'Who munches the most?', hue: 280 }
};
const fmt = (n) => Number(n).toLocaleString();

export default function Leaderboard() {
  const { user } = useAuth();
  const [game, setGame] = useState('all');
  const [period, setPeriod] = useState('week');
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setData(null);
    setFailed(false);
    Promise.resolve(supabase.rpc('arcade_leaderboard', { p_period: period, p_game: game }))
      .then(({ data: d, error }) => {
        if (!active) return;
        if (error) setFailed(true); else setData(d);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [game, period, user?.id]);

  const rows = data?.rows || [];
  const me = data?.me;
  const inTop = rows.some((r) => r.is_me);

  const theme = THEMES[game];
  const top = rows.slice(0, 3);
  const rest = rows.slice(3);
  const best = rows[0] ? Number(rows[0].score) : 1;
  // podium order: 2nd, 1st, 3rd
  const podium = [top[1], top[0], top[2]].filter(Boolean);

  return (
    <div className="leaderboard-page" style={{ '--lb-hue': theme.hue }}>
      <div className="lb-sky" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></div>

      <header className="lb-hero" key={game}>
        <div className="lb-hero-img" style={{ backgroundImage: `url(${theme.img})` }} aria-hidden="true" />
        <div className="lb-hero-shine" aria-hidden="true" />
        <div className="lb-hero-text">
          <span className="lb-hero-kicker"><Trophy size={14} /> ARCADE</span>
          <h1>{theme.title}</h1>
          <p>{theme.tag}</p>
        </div>
      </header>

      <div className="lb-tabs" role="tablist" aria-label="Game">
        {GAMES.map((g) => (
          <button key={g.id} role="tab" aria-selected={game === g.id} className={`lb-tab ${game === g.id ? 'on' : ''}`} onClick={() => setGame(g.id)}>{g.label}</button>
        ))}
      </div>
      <div className="lb-tabs lb-periods" role="tablist" aria-label="Period">
        {PERIODS.map((p) => (
          <button key={p.id} role="tab" aria-selected={period === p.id} className={`lb-tab small ${period === p.id ? 'on' : ''}`} onClick={() => setPeriod(p.id)}>{p.label}</button>
        ))}
      </div>

      {failed ? (
        <div className="lb-card"><p className="lb-empty">Could not load the leaderboard. Please try again.</p></div>
      ) : !data ? (
        <div className="lb-card"><p className="lb-empty">Loading…</p></div>
      ) : rows.length === 0 ? (
        <div className="lb-card lb-blank">
          <img src="/images/ghost_burger.png" alt="" width="84" height="84" />
          <p className="lb-empty">Nobody here yet. <b>Be the first on the board!</b></p>
        </div>
      ) : (
        <div key={`${game}-${period}`}>
          <div className="lb-podium">
            {podium.map((r) => (
              <div key={r.rank} className={`lb-pod p${r.rank} ${r.is_me ? 'me' : ''}`}>
                {r.rank === 1 && <span className="lb-crown" aria-hidden="true">👑</span>}
                <span className="lb-medal" aria-hidden="true">{r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : '🥉'}</span>
                <span className="lb-pod-name">{r.name}{r.is_me ? ' (you)' : ''}</span>
                <span className="lb-pod-score">{fmt(r.score)}<small> XP</small></span>
                <span className="lb-pod-block"><b>{r.rank}</b></span>
              </div>
            ))}
          </div>

          {rest.length > 0 && (
            <ol className="lb-list" start={4}>
              {rest.map((r, i) => (
                <li key={r.rank} className={`lb-row ${r.is_me ? 'me' : ''}`} style={{ animationDelay: `${0.5 + i * 0.05}s` }}>
                  <span className="lb-rank">{r.rank}</span>
                  <span className="lb-main">
                    <span className="lb-name">{r.name}{r.is_me ? ' (you)' : ''}</span>
                    <span className="lb-bar"><i style={{ width: `${Math.max(6, Math.round((Number(r.score) / best) * 100))}%` }} /></span>
                  </span>
                  <span className="lb-score">{fmt(r.score)} XP</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {user && me && !me.hidden && !inTop && (
        <div className="lb-you">Your place: <b>#{me.rank}</b> with {fmt(me.score)} XP. Keep climbing! 🔥</div>
      )}
      {user && me?.hidden && (
        <div className="lb-you">You are hidden from the leaderboard. You can change that in your <Link to="/profile">Profile</Link>.</div>
      )}
      {!user && (
        <div className="lb-you">Want to be on the board? <Link to="/signup">Sign up</Link> or <Link to="/login">log in</Link>, then play.</div>
      )}
      {user && (
        <p className="lb-note">Pick a nickname in your <Link to="/profile">Profile</Link>. Without one, your first name is shown.</p>
      )}

      <div className="lb-actions">
        <Link to="/arcade" className="btn btn-primary lb-play">PLAY NOW</Link>
      </div>
    </div>
  );
}
