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
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' }
];
const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

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

  return (
    <div className="leaderboard-page">
      <div className="lb-head">
        <Trophy size={22} color="var(--gold, #ffc72c)" />
        <h1>LEADERBOARD</h1>
      </div>
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

      <div className="lb-card">
        {failed ? (
          <p className="lb-empty">Could not load the leaderboard. Please try again.</p>
        ) : !data ? (
          <p className="lb-empty">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="lb-empty">No scores yet. Be the first on the board!</p>
        ) : (
          <ol className="lb-list">
            {rows.map((r) => (
              <li key={r.rank} className={`lb-row ${r.is_me ? 'me' : ''} ${r.rank <= 3 ? 'top' : ''}`}>
                <span className="lb-rank">{MEDALS[r.rank] || r.rank}</span>
                <span className="lb-name">{r.name}{r.is_me ? ' (you)' : ''}</span>
                <span className="lb-score">{Number(r.score).toLocaleString()} XP</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {user && me && !me.hidden && !inTop && (
        <div className="lb-you">Your place: <b>#{me.rank}</b> with {Number(me.score).toLocaleString()} XP</div>
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
