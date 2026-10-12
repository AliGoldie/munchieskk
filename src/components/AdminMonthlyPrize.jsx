import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../config/supabase';
import { useStore } from '../contexts/StoreContext';
import './AdminMonthlyPrize.css';

// Admin > Promotions > Monthly Prize. The owner picks the prize for this month
// (or next); the app ranks customers by spend on collected orders, picks the
// winner automatically when the month ends, and shows the banner on the
// Arcade page. Staff confirm the claim code here.
const rm = (cents) => `RM${(Number(cents || 0) / 100).toFixed(2)}`;
const monthLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
const firstOfMonth = (offset) => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuching' }));
  const m = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-01`;
};

const STATUS_STYLE = {
  OPEN: { label: 'Running', bg: '#1d4ed8' },
  AWARDED: { label: 'Waiting to be claimed', bg: '#b45309' },
  CLAIMED: { label: 'Claimed', bg: '#166534' },
  NO_WINNER: { label: 'No winner', bg: '#6b7280' },
};

export default function AdminMonthlyPrize() {
  const { menu } = useStore();
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [month, setMonth] = useState(firstOfMonth(0));
  const [form, setForm] = useState({ menu_item_id: '', prize_name: '', headline: '', min_spend_rm: '100' });

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('admin_monthly_overview');
    if (err) { setError(err.message || 'Could not load the monthly prize.'); return; }
    setError('');
    setOverview(data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const current = useMemo(() => (overview?.prizes || []).find(p => p.month === month) || null, [overview, month]);

  // Fill the form from the saved prize for the chosen month.
  useEffect(() => {
    if (!overview) return;
    setForm(current
      ? { menu_item_id: current.menu_item_id || '', prize_name: current.prize_name, headline: current.headline || '', min_spend_rm: String((current.min_spend_cents || 0) / 100) }
      : { menu_item_id: '', prize_name: '', headline: '', min_spend_rm: '100' });
  }, [current, overview, month]);

  const pickItem = (id) => {
    const item = (menu || []).find(m => String(m.id) === String(id));
    setForm(f => ({ ...f, menu_item_id: id, prize_name: item && !f.prize_name ? item.name : f.prize_name }));
  };

  const locked = current && current.status !== 'OPEN';

  const save = async (e) => {
    e.preventDefault();
    if (locked) return;
    const item = (menu || []).find(m => String(m.id) === String(form.menu_item_id));
    const min = Math.round(parseFloat(form.min_spend_rm || '0') * 100);
    if (!form.prize_name.trim()) { alert('Give the prize a name.'); return; }
    if (!Number.isFinite(min) || min < 0) { alert('Enter a valid minimum spend.'); return; }
    setSaving(true);
    const { error: err } = await supabase.from('monthly_prizes').upsert({
      month,
      prize_name: form.prize_name.trim(),
      headline: form.headline.trim() || null,
      menu_item_id: form.menu_item_id || null,
      image_url: item?.image || current?.image_url || null,
      min_spend_cents: min,
    }, { onConflict: 'month' });
    setSaving(false);
    if (err) { alert('Could not save: ' + err.message); return; }
    load();
  };

  const markClaimed = async (m) => {
    if (!window.confirm('Mark this prize as handed over?')) return;
    const { error: err } = await supabase.rpc('admin_mark_prize_claimed', { p_month: m });
    if (err) { alert(err.message); return; }
    load();
  };

  return (
    <div>
      <h4 style={{ margin: '0 0 .5rem' }}>Monthly Prize</h4>
      <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
        Pick one prize per month. The customer who spends the most on collected orders that month (at or above the minimum)
        wins it automatically when the month ends. The banner on the Arcade page follows what you set here.
      </p>
      {error && <p style={{ color: '#ef4444' }}>{error} (If this says a function is missing, the Burger Ranks SQL has not been run yet.)</p>}

      <form onSubmit={save} className="mp-form">
        <div className="mp-row">
          <label>Month
            <select className="price-input" value={month} onChange={e => setMonth(e.target.value)}>
              <option value={firstOfMonth(0)}>{monthLabel(firstOfMonth(0))} (this month)</option>
              <option value={firstOfMonth(1)}>{monthLabel(firstOfMonth(1))} (next month)</option>
            </select>
          </label>
          <label>Menu item (photo comes from it)
            <select className="price-input" value={form.menu_item_id} onChange={e => pickItem(e.target.value)} disabled={locked}>
              <option value="">-- Choose --</option>
              {(menu || []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        </div>
        <div className="mp-row">
          <label>Prize name (shown on the banner)
            <input className="price-input" value={form.prize_name} onChange={e => setForm(f => ({ ...f, prize_name: e.target.value }))} placeholder="e.g. Solero Split" disabled={locked} />
          </label>
          <label>Minimum spend to qualify (RM)
            <input className="price-input" type="number" min="0" step="1" value={form.min_spend_rm} onChange={e => setForm(f => ({ ...f, min_spend_rm: e.target.value }))} disabled={locked} />
          </label>
        </div>
        <label>Headline (optional)
          <input className="price-input" value={form.headline} onChange={e => setForm(f => ({ ...f, headline: e.target.value }))} placeholder="e.g. The top spender wins a Solero Split" maxLength={120} disabled={locked} />
        </label>
        {locked
          ? <p className="text-muted" style={{ fontSize: '.8rem' }}>This month's prize is already awarded and can't be changed.</p>
          : <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : current ? 'Update prize' : 'Set prize'}</button>}
      </form>

      <h4 style={{ margin: '1.5rem 0 .5rem' }}>This month's top spenders</h4>
      {!overview ? <p className="text-muted">Loading…</p> : overview.leaders.length === 0 ? (
        <p className="text-muted">No collected orders yet this month.</p>
      ) : (
        <div className="mp-list">
          {overview.leaders.map(l => (
            <div key={l.rank} className="mp-line">
              <strong>#{l.rank}</strong>
              <span>{l.name || 'Unknown'}{l.phone ? ` · ${l.phone}` : ''}</span>
              <span className="mp-amount">{rm(l.spend_cents)}</span>
            </div>
          ))}
        </div>
      )}

      <h4 style={{ margin: '1.5rem 0 .5rem' }}>Recent months</h4>
      {!overview || overview.prizes.length === 0 ? <p className="text-muted">No prizes set yet.</p> : (
        <div className="mp-list">
          {overview.prizes.map(p => {
            const st = STATUS_STYLE[p.status] || STATUS_STYLE.OPEN;
            return (
              <div key={p.month} className="mp-card">
                <div className="mp-card-head">
                  <strong>{monthLabel(p.month)}</strong>
                  <span className="mp-badge" style={{ background: st.bg }}>{st.label}</span>
                </div>
                <div>{p.prize_name} · min {rm(p.min_spend_cents)}</div>
                {p.winner_name && (
                  <div className="text-muted" style={{ fontSize: '.85rem' }}>
                    Winner: <strong>{p.winner_name}</strong>{p.winner_phone ? ` · ${p.winner_phone}` : ''} · spent {rm(p.winner_spend_cents)}
                  </div>
                )}
                {p.status === 'AWARDED' && (
                  <div className="mp-claim">
                    <span>Claim code <strong className="mp-code">{p.claim_code}</strong></span>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => markClaimed(p.month)}>Mark claimed</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
