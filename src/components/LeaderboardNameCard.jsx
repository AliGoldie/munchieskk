import { useEffect, useState } from 'react';
import { supabase } from '../config/supabase';

// Profile card: choose the nickname shown on the leaderboard, or hide from it.
export default function LeaderboardNameCard() {
  const [nickname, setNickname] = useState('');
  const [hidden, setHidden] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.resolve(supabase.rpc('my_leaderboard_name'))
      .then(({ data, error }) => {
        if (!active) return;
        if (!error && data) { setNickname(data.nickname || ''); setHidden(!!data.hidden); setAvailable(true); }
        setLoaded(true);
      })
      .catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const { data, error } = await supabase.rpc('set_my_nickname', { p_nickname: nickname, p_hidden: hidden });
      if (error) throw error;
      setNickname(data?.nickname || '');
      setMsg({ ok: true, text: 'Saved.' });
    } catch (err) {
      setMsg({ ok: false, text: err.message || 'Could not save. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  // not shown until the leaderboard is set up in the database
  if (!loaded || !available) return null;

  return (
    <div className="promo-section" style={{ marginTop: '2rem' }}>
      <h3>Leaderboard name</h3>
      <p className="text-muted" style={{ fontSize: '0.85rem', margin: '0 0 8px' }}>
        Shown next to your Burger XP on the arcade leaderboard. Leave it empty to show your first name.
      </p>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          className="price-input"
          aria-label="Leaderboard nickname"
          placeholder="Nickname (3 to 14 characters)"
          maxLength={14}
          value={nickname}
          onChange={(e) => { setNickname(e.target.value); setMsg(null); }}
          style={{ flex: 1, minWidth: 0, padding: '0.5rem' }}
        />
        <button className="btn btn-secondary" onClick={save} disabled={saving}>{saving ? '...' : 'Save'}</button>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', fontSize: '0.88rem' }}>
        <input type="checkbox" checked={hidden} onChange={(e) => { setHidden(e.target.checked); setMsg(null); }} />
        Hide me from the leaderboard
      </label>
      {msg && (
        <p role="status" style={{ margin: '8px 0 0', fontSize: '0.85rem', color: msg.ok ? 'var(--success, #5fd68c)' : 'var(--ember, #f04e23)' }}>{msg.text}</p>
      )}
    </div>
  );
}
