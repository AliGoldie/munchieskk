import { useEffect, useState } from 'react';
import { supabase } from '../config/supabase';

// Admin: every nickname players chose, with a button to reset a bad one.
export default function AdminLeaderboardNames() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      const { data, error: err } = await supabase.rpc('admin_list_leaderboard_names');
      if (err) throw err;
      setRows(data || []);
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load nicknames.');
    }
  };

  useEffect(() => { load(); }, []);

  const reset = async (row) => {
    if (!window.confirm(`Reset the nickname "${row.nickname}"? The player will show with their first name.`)) return;
    const { error: err } = await supabase.rpc('admin_reset_nickname', { p_user: row.user_id });
    if (err) { setError(err.message); return; }
    load();
  };

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h4 style={{ margin: '0 0 6px' }}>Leaderboard nicknames</h4>
      <p className="text-muted" style={{ fontSize: '0.85rem', margin: '0 0 10px' }}>
        Players choose these in their Profile. Rude and look-alike words are blocked automatically; reset any that slip through.
      </p>
      {error && <p style={{ color: 'var(--ember, #f04e23)' }}>{error}</p>}
      {rows === null && !error && <p className="text-muted">Loading…</p>}
      {rows && rows.length === 0 && <p className="text-muted">No nicknames yet.</p>}
      {rows && rows.length > 0 && (
        <div style={{ display: 'grid', gap: '6px' }}>
          {rows.map((r) => (
            <div key={r.user_id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '8px', alignItems: 'center', padding: '6px 8px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', fontSize: '0.88rem' }}>
              <span><b>{r.nickname || '(none)'}</b>{r.hidden ? ' · hidden' : ''}</span>
              <span className="text-muted">{r.real_name || 'No name'}</span>
              {r.nickname ? <button className="btn btn-sm btn-outline" onClick={() => reset(r)}>Reset</button> : <span />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
