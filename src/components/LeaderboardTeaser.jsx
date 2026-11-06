import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { supabase } from '../config/supabase';
import '../pages/Leaderboard.css';

const MEDALS = ['🥇', '🥈', '🥉'];

// The top three players this week, with a link to the full leaderboard.
export default function LeaderboardTeaser() {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.resolve(supabase.rpc('arcade_leaderboard', { p_period: 'week', p_game: 'all' }))
      .then(({ data, error }) => { if (active && !error && data) setRows((data.rows || []).slice(0, 3)); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  if (rows === null) return null;

  return (
    <div className="lb-teaser">
      <div className="lb-teaser-head">
        <Trophy size={13} /> TOP PLAYERS THIS WEEK
        <Link to="/leaderboard">See all →</Link>
      </div>
      {rows.length === 0 ? (
        <p>No scores yet this week. Be the first on the board!</p>
      ) : (
        <ol>
          {rows.map((r, i) => (
            <li key={r.rank}>
              <span>{MEDALS[i]}</span>
              <span>{r.name}{r.is_me ? ' (you)' : ''}</span>
              <b>{Number(r.score).toLocaleString()} XP</b>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
