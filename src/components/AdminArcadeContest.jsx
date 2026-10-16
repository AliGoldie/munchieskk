import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../config/supabase';
import { useStore } from '../contexts/StoreContext';
import './AdminMonthlyPrize.css';

// Admin > Promotions > Arcade Contest. The owner sets contests (start, end,
// three prizes) and the weekly goal. Winners are picked automatically when a
// contest ends; this screen shows full names, phones, run speeds and claim
// codes so staff can check the top players before handing anything over.
const PLACES = ['1st', '2nd', '3rd'];
const DEFAULT_PRIZES = ['Free burger', 'Free fries', 'Free drink'];

// Inputs are Malaysia time. These convert to and from the database's timestamps.
const toInput = (ts) => new Date(ts).toLocaleString('sv-SE', { timeZone: 'Asia/Kuching' }).replace(' ', 'T').slice(0, 16);
const toIso = (v) => `${v}:00+08:00`;
const show = (ts) => new Date(ts).toLocaleString('en-MY', { timeZone: 'Asia/Kuching', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const pad = (n) => String(n).padStart(2, '0');

function wholeMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  const label = new Date(y, m - 1, 1).toLocaleString('en-MY', { month: 'long' });
  return { start: `${ym}-01T00:00`, end: `${next}-01T00:00`, title: `${label} arcade contest` };
}

const emptyForm = () => ({
  id: null, title: '', starts: '', ends: '', active: true, min_score: '300', claim_days: '90', claim_min_rm: '10',
  prizes: DEFAULT_PRIZES.map((name, i) => ({ rank: i + 1, prize_name: name, menu_item_id: '' })),
});

export default function AdminArcadeContest() {
  const { menu } = useStore();
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [goal, setGoal] = useState({ score: '1000', points: '25' });
  const [ym, setYm] = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kuching' }).slice(0, 7));

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('admin_arcade_overview');
    if (err) { setError(err.message || 'Could not load the arcade contests.'); return; }
    setError('');
    setOverview(data);
    if (data?.goal) setGoal({ score: String(data.goal.goal_score), points: String(data.goal.goal_points) });
  }, []);

  useEffect(() => { load(); }, [load]);

  const applyMonth = () => {
    const h = wholeMonth(ym);
    setForm((f) => ({ ...f, id: null, title: h.title, starts: h.start, ends: h.end }));
  };

  const edit = (c) => {
    const by = Object.fromEntries((c.prizes || []).map((p) => [p.rank, p]));
    setForm({
      id: c.id, title: c.title, starts: toInput(c.starts_at), ends: toInput(c.ends_at), active: c.active,
      min_score: String(c.min_score), claim_days: String(c.claim_days), claim_min_rm: String((c.claim_min_order_cents ?? 1000) / 100),
      prizes: [1, 2, 3].map((r) => ({ rank: r, prize_name: by[r]?.prize_name || '', menu_item_id: by[r]?.menu_item_id || '' })),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const setPrize = (rank, patch) => setForm((f) => ({ ...f, prizes: f.prizes.map((p) => (p.rank === rank ? { ...p, ...patch } : p)) }));
  const pickItem = (rank, id) => {
    const item = (menu || []).find((m) => String(m.id) === String(id));
    setPrize(rank, { menu_item_id: id, ...(item ? { prize_name: form.prizes[rank - 1].prize_name || item.name } : {}) });
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.starts || !form.ends) { alert('Give the contest a title, a start and an end.'); return; }
    setSaving(true);
    const prizes = form.prizes
      .filter((p) => p.prize_name.trim())
      .map((p) => {
        const item = (menu || []).find((m) => String(m.id) === String(p.menu_item_id));
        return { rank: p.rank, prize_name: p.prize_name.trim(), menu_item_id: p.menu_item_id || '', image_url: item?.image || '' };
      });
    const { error: err } = await supabase.rpc('admin_save_arcade_contest', {
      p_id: form.id, p_title: form.title, p_starts: toIso(form.starts), p_ends: toIso(form.ends),
      p_active: form.active, p_min_score: parseInt(form.min_score || '300', 10), p_claim_days: parseInt(form.claim_days || '90', 10),
      p_prizes: prizes, p_claim_min_order_cents: Math.round(parseFloat(form.claim_min_rm || '0') * 100),
    });
    setSaving(false);
    if (err) { alert(err.message); return; }
    setForm(emptyForm());
    load();
  };

  const remove = async (c) => {
    if (!window.confirm(`Delete "${c.title}"?`)) return;
    const { error: err } = await supabase.rpc('admin_delete_arcade_contest', { p_id: c.id });
    if (err) { alert(err.message); return; }
    load();
  };

  const markClaimed = async (c, rank) => {
    if (!window.confirm('Mark this prize as handed over?')) return;
    const { error: err } = await supabase.rpc('admin_mark_arcade_claimed', { p_contest: c.id, p_rank: rank });
    if (err) { alert(err.message); return; }
    load();
  };

  const saveGoal = async (e) => {
    e.preventDefault();
    const { error: err } = await supabase.rpc('admin_set_arcade_goal', {
      p_goal_score: parseInt(goal.score, 10), p_goal_points: parseInt(goal.points, 10),
    });
    if (err) { alert(err.message); return; }
    load();
  };

  return (
    <div>
      <h4 style={{ margin: '0 0 .5rem' }}>Arcade Contest</h4>
      <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
        Players' Arcade Score is the best score in each game (T-Rex Runner, Speed Grab and Munch-Man) added together during the contest.
        Top 3 win the prizes you set. Winners are picked automatically when the contest ends. Check the top players below
        (run speed and shared phones) before you hand anything over.
      </p>
      {error && <p style={{ color: '#ef4444' }}>{error} (If this says a function is missing, the arcade contest SQL has not been run yet.)</p>}

      <h4 style={{ margin: '1rem 0 .5rem' }}>Weekly goal</h4>
      <form onSubmit={saveGoal} className="mp-form">
        <div className="mp-row">
          <label>Arcade Score to reach in a week
            <input className="price-input" type="number" min="1" value={goal.score} onChange={(e) => setGoal((g) => ({ ...g, score: e.target.value }))} />
          </label>
          <label>Loyalty points paid (once a week)
            <input className="price-input" type="number" min="0" max="200" value={goal.points} onChange={(e) => setGoal((g) => ({ ...g, points: e.target.value }))} />
          </label>
        </div>
        <button type="submit" className="btn btn-sm btn-primary" style={{ alignSelf: 'flex-start' }}>Save goal</button>
      </form>

      <h4 style={{ margin: '1.5rem 0 .5rem' }}>{form.id ? 'Edit contest' : 'New contest'}</h4>
      <form onSubmit={save} className="mp-form">
        <div className="mp-row">
          <label>Quick fill: month
            <input className="price-input" type="month" value={ym} onChange={(e) => setYm(e.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button type="button" className="btn btn-sm btn-outline" onClick={applyMonth}>Whole month</button>
          </div>
        </div>
        <label>Title (shown to players)
          <input className="price-input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Pre-opening T-Rex challenge" maxLength={80} />
        </label>
        <div className="mp-row">
          <label>Starts (Malaysia time)
            <input className="price-input" type="datetime-local" value={form.starts} onChange={(e) => setForm((f) => ({ ...f, starts: e.target.value }))} />
          </label>
          <label>Ends (Malaysia time)
            <input className="price-input" type="datetime-local" value={form.ends} onChange={(e) => setForm((f) => ({ ...f, ends: e.target.value }))} />
          </label>
        </div>
        <div className="mp-row">
          <label>Minimum Arcade Score to qualify
            <input className="price-input" type="number" min="0" value={form.min_score} onChange={(e) => setForm((f) => ({ ...f, min_score: e.target.value }))} />
          </label>
          <label>Days to claim
            <input className="price-input" type="number" min="1" value={form.claim_days} onChange={(e) => setForm((f) => ({ ...f, claim_days: e.target.value }))} />
          </label>
        </div>
        <label>Minimum order to claim a prize (RM, 0 = no purchase needed)
          <input className="price-input" type="number" min="0" step="1" value={form.claim_min_rm} onChange={(e) => setForm((f) => ({ ...f, claim_min_rm: e.target.value }))} />
        </label>
        {form.prizes.map((p) => (
          <div className="mp-row" key={p.rank}>
            <label>{PLACES[p.rank - 1]} prize
              <input className="price-input" value={p.prize_name} onChange={(e) => setPrize(p.rank, { prize_name: e.target.value })} placeholder={DEFAULT_PRIZES[p.rank - 1]} />
            </label>
            <label>Menu item (for the photo, optional)
              <select className="price-input" value={p.menu_item_id} onChange={(e) => pickItem(p.rank, e.target.value)}>
                <option value="">-- None --</option>
                {(menu || []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          </div>
        ))}
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
          Active (untick to switch this contest off)
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : form.id ? 'Update contest' : 'Create contest'}</button>
          {form.id && <button type="button" className="btn btn-outline" onClick={() => setForm(emptyForm())}>Cancel edit</button>}
        </div>
      </form>

      <h4 style={{ margin: '1.5rem 0 .5rem' }}>Current top players</h4>
      {!overview ? <p className="text-muted">Loading…</p> : !overview.current_id ? (
        <p className="text-muted">No contest is running right now.</p>
      ) : overview.leaders.length === 0 ? (
        <p className="text-muted">Nobody has reached the minimum score yet.</p>
      ) : (
        <div className="mp-list">
          {overview.leaders.map((l) => (
            <div key={l.rank} className="mp-line" style={{ flexWrap: 'wrap' }}>
              <strong>#{l.rank}</strong>
              <span>{l.name || 'Unknown'}{l.phone ? ` · ${l.phone}` : ' · no phone'}</span>
              <span className="mp-amount">{l.total.toLocaleString()}</span>
              <span className="text-muted" style={{ fontSize: '.75rem', flexBasis: '100%' }}>
                T-Rex {l.trex.toLocaleString()} · Speed Grab {l.grab.toLocaleString()} · Munch-Man {(l.munch || 0).toLocaleString()} · fastest run {Number(l.max_rate).toFixed(0)} pts/sec
                {Number(l.max_rate) > 40 && <strong style={{ color: '#b45309' }}> · unusually fast, check in person</strong>}
                {l.same_phone_accounts > 1 && <strong style={{ color: '#b91c1c' }}> · {l.same_phone_accounts} accounts share this phone (only the best counts)</strong>}
              </span>
            </div>
          ))}
        </div>
      )}

      <h4 style={{ margin: '1.5rem 0 .5rem' }}>Contests</h4>
      {!overview || overview.contests.length === 0 ? <p className="text-muted">No contests yet.</p> : (
        <div className="mp-list">
          {overview.contests.map((c) => (
            <div key={c.id} className="mp-card">
              <div className="mp-card-head">
                <strong>{c.title}</strong>
                <span className="mp-badge" style={{ background: c.finalized_at ? '#166534' : c.active ? '#1d4ed8' : '#6b7280' }}>
                  {c.finalized_at ? 'Finished' : c.active ? 'Active' : 'Off'}
                </span>
              </div>
              <div className="text-muted" style={{ fontSize: '.85rem' }}>{show(c.starts_at)} to {show(c.ends_at)} · min score {c.min_score} · claim with RM{((c.claim_min_order_cents ?? 0) / 100).toFixed(0)}+ order</div>
              <div style={{ fontSize: '.85rem' }}>{c.prizes.map((p) => `${PLACES[p.rank - 1]}: ${p.prize_name}`).join(' · ') || 'No prizes set'}</div>
              {c.winners.map((w) => (
                <div key={w.rank} className="mp-claim">
                  <span>
                    <strong>{PLACES[w.rank - 1]}</strong> {w.name || w.first_name}{w.phone ? ` · ${w.phone}` : ' · no phone yet'} · {w.total_score.toLocaleString()} ·
                    code <strong className="mp-code">{w.claim_code}</strong>
                    {w.status === 'CLAIMED' && ' · claimed'}
                  </span>
                  {w.status === 'AWARDED' && <button type="button" className="btn btn-sm btn-primary" onClick={() => markClaimed(c, w.rank)}>Mark claimed</button>}
                </div>
              ))}
              {!c.finalized_at && (
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => edit(c)}>Edit</button>
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => remove(c)}>Delete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
