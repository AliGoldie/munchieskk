import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../config/supabase';

const DAYS = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' }, { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 0, label: 'Sun' },
];

// Admin > Prizes CRM: the weekday points boost (double points Tue-Thu by
// default). Applies to orders placed on those days, Malaysia time.
export default function AdminPointsBoost() {
  const [info, setInfo] = useState(null);
  const [enabled, setEnabled] = useState(true);
  const [multiplier, setMultiplier] = useState(2);
  const [days, setDays] = useState([2, 3, 4]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('points_boost_info');
    if (error || !data) { setMsg('Could not load. Run the points-at-collection SQL first.'); return; }
    setInfo(data);
    setEnabled(!!data.enabled);
    setMultiplier(Number(data.multiplier) || 2);
    setDays(Array.isArray(data.days) ? data.days : []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleDay = (n) => setDays((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n]));

  const save = async () => {
    setSaving(true);
    setMsg('');
    const { error } = await supabase.rpc('admin_set_points_boost', { p_enabled: enabled, p_multiplier: multiplier, p_days: days });
    setSaving(false);
    if (error) { setMsg(error.message); return; }
    setMsg('Saved.');
    load();
  };

  return (
    <div style={{ marginBottom: '1.5rem', paddingBottom: '1.25rem', borderBottom: '1px solid var(--line, rgba(0,0,0,.12))' }}>
      <h3 style={{ marginTop: 0 }}>Weekday Monsta Coins boost</h3>
      <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
        Orders placed on the chosen days (Malaysia time) earn extra order Monsta Coins. They are added when the order is collected.
        {info?.active_now ? ' The boost is on right now.' : ''}
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontWeight: 600 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Boost is on
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {DAYS.map((d) => (
          <button key={d.n} type="button" className={`btn btn-sm ${days.includes(d.n) ? 'btn-primary' : 'btn-outline'}`} onClick={() => toggleDay(d.n)}>
            {d.label}
          </button>
        ))}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontWeight: 600 }}>
        Points multiplier
        <select className="price-input" style={{ width: 90 }} value={multiplier} onChange={(e) => setMultiplier(parseInt(e.target.value, 10))}>
          {[1, 2, 3].map((m) => <option key={m} value={m}>{m}x</option>)}
        </select>
      </label>
      <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      {msg && <span style={{ marginLeft: 10, fontSize: '.85rem' }}>{msg}</span>}
    </div>
  );
}
