import { useEffect, useState } from 'react';
import { Crown } from 'lucide-react';
import { supabase } from '../config/supabase';

// End-of-run line shared by the three games: the top score ever in this game and the player's own best.
// Reads the public leaderboard function (all time, one game). Shows nothing if it cannot be loaded.
export default function GameTopScore({ game, refreshKey }) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.resolve(supabase.rpc('arcade_leaderboard', { p_period: 'all', p_game: game }))
      .then(({ data, error }) => {
        if (!active || error || !data) return;
        setInfo({ top: (data.rows || [])[0] || null, me: data.me || null });
      })
      .catch(() => {});
    return () => { active = false; };
  }, [game, refreshKey]);

  if (!info || (!info.top && !info.me)) return null;
  const fmt = (n) => Number(n).toLocaleString();
  return (
    <div style={{ fontSize: 13, color: '#ddd', marginBottom: 10, lineHeight: 1.5 }}>
      {info.top && (
        <div>
          <Crown size={13} style={{ display: 'inline', marginRight: 5, verticalAlign: 'middle', color: 'var(--munchies-yellow)' }} />
          Top score: <b>{fmt(info.top.score)}</b> by {info.top.name}{info.top.is_me ? ' (you)' : ''}
        </div>
      )}
      {info.me && info.me.score != null && !(info.top && info.top.is_me) && (
        <div>Your best: <b>{fmt(info.me.score)}</b>{info.me.rank ? ` (rank #${info.me.rank})` : ''}</div>
      )}
    </div>
  );
}
