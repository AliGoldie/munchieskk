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
const fmt = (n) => Number(n).toLocaleString();
const MONTH_NAME = () => new Date().toLocaleString('en-GB', { month: 'long', timeZone: 'Asia/Kuching' }).toUpperCase();

// A player's card tier follows their place on the board (not their spending).
function tierOf(rank) {
  if (rank === 1) return { id: 'master', name: 'GRILL MASTER' };
  if (rank <= 3) return { id: 'boss', name: 'SAUCE BOSS' };
  if (rank <= 10) return { id: 'flipper', name: 'PATTY FLIPPER' };
  return { id: 'rookie', name: 'BUN ROOKIE' };
}

// One collectible card. Tilts and shows a foil shine under the pointer.
function TradingCard({ row, art, index }) {
  const tier = tierOf(row.rank);
  const move = (e) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    el.style.setProperty('--mx', x.toFixed(3));
    el.style.setProperty('--my', y.toFixed(3));
    el.style.setProperty('--rx', `${((0.5 - y) * 16).toFixed(1)}deg`);
    el.style.setProperty('--ry', `${((x - 0.5) * 18).toFixed(1)}deg`);
    el.classList.add('hot');
  };
  const leave = (e) => {
    const el = e.currentTarget;
    ['--mx', '--my', '--rx', '--ry'].forEach((k) => el.style.removeProperty(k));
    el.classList.remove('hot');
  };
  return (
    <li className={`tcard t-${tier.id} ${row.is_me ? 'me' : ''}`} style={{ '--i': index }}>
      <div className="tcard-in" onPointerMove={move} onPointerLeave={leave} onPointerCancel={leave}>
        <div className="tcard-face">
          <span className="tcard-rank">#{row.rank}</span>
          <div className="tcard-art" style={{ backgroundImage: `url(${art})` }} />
          <span className="tcard-tier">{tier.name}</span>
          <span className="tcard-name">{row.name}{row.is_me ? ' (you)' : ''}</span>
          <span className="tcard-score">{fmt(row.score)}<small> XP</small></span>
        </div>
        <span className="tcard-foil" aria-hidden="true" />
      </div>
    </li>
  );
}

export default function Leaderboard() {
  const { user } = useAuth();
  const [game, setGame] = useState('all');
  const [period, setPeriod] = useState('week');
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [champ, setChamp] = useState(undefined); // overall champion of the month

  useEffect(() => {
    let active = true;
    Promise.resolve(supabase.rpc('arcade_leaderboard', { p_period: 'month', p_game: 'all' }))
      .then(({ data: d, error }) => { if (active) setChamp(error ? null : (d?.rows?.[0] || null)); })
      .catch(() => { if (active) setChamp(null); });
    return () => { active = false; };
  }, [user?.id]);

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
      <h2>LEADERBOARD</h2>

      {champ !== undefined && (
        <section className="lb-champ" aria-label="Champion of the month">
          <div className="lb-champ-text">
            <span className="lb-champ-kicker">CHAMPION OF {MONTH_NAME()}</span>
            {champ ? (
              <>
                <h3>{champ.name}{champ.is_me ? ' (you)' : ''}</h3>
                <div className="lb-champ-score">{fmt(champ.score)}<small> XP</small></div>
                <span className="lb-champ-tier">GRILL MASTER · ALL THREE GAMES</span>
              </>
            ) : (
              <>
                <h3>Seat is empty</h3>
                <span className="lb-champ-tier">Play any game to take the crown this month.</span>
              </>
            )}
          </div>
          <div className="lb-champ-art" style={{ backgroundImage: `url(${ART.all})` }} aria-hidden="true" />
          <span className="tcard-foil lb-champ-foil" aria-hidden="true" />
        </section>
      )}

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
        <p className="lb-empty">Could not load the leaderboard. Please try again.</p>
      ) : !data ? (
        <p className="lb-empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="lb-empty">No scores yet. Be the first on the board!</p>
      ) : (
        <ol className="lb-deck" key={`${game}-${period}`} aria-label="Top players">
          {rows.map((r, i) => <TradingCard key={r.rank} row={r} art={ART[game]} index={i} />)}
        </ol>
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
        <p className="lb-note">Pick a nickname in your <Link to="/profile">Profile</Link>. Without one, your first name is shown. Card tiers follow your place on the board.</p>
      )}

      <div className="lb-actions">
        <Link to="/arcade" className="btn btn-primary">PLAY NOW</Link>
      </div>
    </div>
  );
}
