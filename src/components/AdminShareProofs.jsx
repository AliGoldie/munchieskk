import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../config/supabase';
import './AdminShareProofs.css';

const formatStoreDateTime = (d) => new Date(d).toLocaleString('en-MY', { timeZone: 'Asia/Kuching' });

const STATUS_COLORS = { PENDING: '#b45309', APPROVED: '#166534', REJECTED: '#6b7280' };

// Review queue for customers' "I shared it" screenshots. Approving tops the
// order's share bonus up to 40 points (see review_share_proof in Supabase).
export default function AdminShareProofs() {
  const [rows, setRows] = useState([]);
  const [urls, setUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('share_proofs')
      .select('id, order_id, image_path, status, points_awarded, reject_reason, created_at, reviewed_at, profiles:user_id(name, phone)')
      .order('created_at', { ascending: false })
      .limit(60);
    if (err) { setError('Could not load screenshots.'); setLoading(false); return; }
    const list = data || [];
    // Pending first (oldest waiting longest on top), then recent decisions.
    list.sort((a, b) => {
      if ((a.status === 'PENDING') !== (b.status === 'PENDING')) return a.status === 'PENDING' ? -1 : 1;
      return a.status === 'PENDING'
        ? new Date(a.created_at) - new Date(b.created_at)
        : new Date(b.created_at) - new Date(a.created_at);
    });
    setRows(list);
    setError('');
    setLoading(false);
    if (list.length) {
      const { data: signed } = await supabase.storage.from('share-proofs')
        .createSignedUrls(list.map(r => r.image_path), 3600);
      const map = {};
      (signed || []).forEach(s => { if (s.path && s.signedUrl) map[s.path] = s.signedUrl; });
      setUrls(map);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const review = async (row, approve) => {
    let reason = null;
    if (approve) {
      if (!window.confirm(`Approve ${row.profiles?.name || 'this customer'}'s screenshot? Monsta Coins are added straight away.`)) return;
    } else {
      reason = window.prompt('Why is it rejected? (shown to the customer, optional)', 'Post is not public or does not tag @munchieskk');
      if (reason === null) return;
    }
    setBusyId(row.id);
    const { data, error: err } = await supabase.rpc('review_share_proof', {
      p_proof_id: row.id, p_approve: approve, p_reason: reason
    });
    setBusyId(null);
    if (err) { alert(err.message || 'Could not save.'); } else if (approve) { alert(`Approved: ${data} Monsta Coins added.`); }
    load();
  };

  const pending = rows.filter(r => r.status === 'PENDING').length;

  return (
    <div className="admin-card">
      <h3>Share screenshots{pending > 0 ? ` (${pending} waiting)` : ''}</h3>
      <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
        Customers who shared their food on social media can upload a screenshot of the post. Check that it is a real,
        public post that tags @munchieskk, then approve to top their share bonus up to 40 Monsta Coins in total.
      </p>
      {error && <p style={{ color: '#ef4444' }}>{error}</p>}
      {loading ? <p className="text-muted">Loading…</p> : rows.length === 0 ? (
        <p className="text-center text-muted" style={{ padding: '2rem' }}>No screenshots yet. They appear here when customers upload them.</p>
      ) : (
        <div className="proof-grid">
          {rows.map(r => (
            <div key={r.id} className="proof-card" style={{ opacity: r.status === 'PENDING' ? 1 : 0.7 }}>
              {urls[r.image_path]
                ? <button type="button" className="proof-thumb" onClick={() => setZoom(urls[r.image_path])} aria-label="View screenshot full size"><img src={urls[r.image_path]} alt="Customer screenshot" loading="lazy" /></button>
                : <div className="proof-thumb proof-thumb-empty">No preview</div>}
              <div className="proof-body">
                <strong>{r.profiles?.name || 'Unknown'}</strong>
                <span className="proof-sub">{r.profiles?.phone || ''}</span>
                <span className="proof-sub">Order {r.order_id} · {formatStoreDateTime(r.created_at)}</span>
                <span className="proof-badge" style={{ background: STATUS_COLORS[r.status] }}>{r.status}{r.status === 'APPROVED' ? ` +${r.points_awarded}` : ''}</span>
                {r.status === 'REJECTED' && r.reject_reason && <span className="proof-sub">Reason: {r.reject_reason}</span>}
                {r.status === 'PENDING' && (
                  <div className="proof-actions">
                    <button className="btn btn-sm btn-primary" disabled={busyId === r.id} onClick={() => review(r, true)}>Approve</button>
                    <button className="btn btn-sm btn-secondary" disabled={busyId === r.id} onClick={() => review(r, false)}>Reject</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {zoom && (
        <div className="proof-zoom" role="dialog" aria-modal="true" onClick={() => setZoom(null)}>
          <img src={zoom} alt="Customer screenshot, full size" />
        </div>
      )}
    </div>
  );
}
