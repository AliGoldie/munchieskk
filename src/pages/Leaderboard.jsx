import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
const ART = {
  all: '/images/hero_burger.webp',
  trex_runner: '/images/trex_runner_game.webp',
  speed_grab: '/images/fry_catch.webp',
  munch_man: '/images/munchman_game.webp'
};
const WHEN = { week: 'THIS WEEK', lastweek: 'LAST WEEK', month: 'THIS MONTH', all: 'ALL TIME' };
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

  const leader = rows[0];
  const rest = rows.slice(1);

  return (
    <div className="leaderboard-page">
      <h2>LEADERBOARD</h2>
      <p className="lb-sub">Top players by Burger XP. The best score in each game counts.</p>

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
        <div className="card lb-board"><p className="lb-empty">Could not load the leaderboard. Please try again.</p></div>
      ) : !data ? (
        <div className="card lb-board"><p className="lb-empty">Loading…</p></div>
      ) : !leader ? (
        <div className="card lb-board"><p className="lb-empty">No scores yet. Be the first on the board!</p></div>
      ) : (
        <>
          <div className={`card lb-leader ${leader.is_me ? 'me' : ''}`}>
            <span className="lb-badge">№1 · {WHEN[period]}</span>
            <div className="lb-leader-body">
              <h3>{leader.name}{leader.is_me ? ' (you)' : ''}</h3>
              <div className="lb-leader-score">{fmt(leader.score)}<small> XP</small></div>
            </div>
            <div className="lb-leader-art"><div style={{ backgroundImage: `url(${ART[game]})` }} /></div>
          </div>

          {rest.length > 0 && (
            <ol className="card lb-board lb-list" start={2}>
              {rest.map((r) => (
                <li key={r.rank} className={`lb-row ${r.is_me ? 'me' : ''}`}>
                  <span className="lb-rank">{r.rank}</span>
                  <span className="lb-name">{r.name}{r.is_me ? ' (you)' : ''}</span>
                  <span className="lb-score">{fmt(r.score)} XP</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      {user && me && !me.hidden && !inTop && (
        <div className="lb-you">Your place: <b>#{me.rank}</b> with {fmt(me.score)} XP.</div>
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
        <Link to="/arcade" className="btn btn-primary">PLAY NOW</Link>
      </div>
    </div>
  );
}
