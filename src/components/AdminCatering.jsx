import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../config/supabase';
import { getMalaysiaNow } from '../utils/timeUtils';

const STATUS_COLORS = {
  NEW: '#b45309',
  CONFIRMED: '#1d4ed8',
  DECLINED: '#6b7280',
  DONE: '#166534'
};

// Malaysian numbers are usually typed with a leading 0 (012-345 6789);
// wa.me needs the country code (60123456789).
function toWhatsAppNumber(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.startsWith('60')) return digits;
  if (digits.startsWith('0')) return `6${digits}`;
  return digits;
}

function formatDate(dateStr) {
  return new Date(`${dateStr}T00:00:00+08:00`).toLocaleDateString('en-MY', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kuala_Lumpur'
  });
}

export default function AdminCatering() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: fetchError } = await supabase
      .from('catering_requests')
      .select('*')
      .order('event_date', { ascending: true })
      .limit(300)
      .abortSignal(AbortSignal.timeout(10000));
    if (fetchError) setError(fetchError.message);
    else setRequests(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id, status) => {
    const previous = requests;
    setRequests(prev => prev.map(r => (r.id === id ? { ...r, status } : r)));
    const { error: updateError } = await supabase.from('catering_requests').update({ status }).eq('id', id);
    if (updateError) {
      setRequests(previous);
      alert('Could not update status: ' + updateError.message);
    }
  };

  const today = getMalaysiaNow().dateStr;
  const visible = requests.filter(r => (showPast ? r.event_date < today : r.event_date >= today));
  const newCount = requests.filter(r => r.status === 'NEW' && r.event_date >= today).length;

  return (
    <div className="admin-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h3 style={{ margin: 0 }}>Catering Requests {newCount > 0 && <span style={{ fontSize: '0.8rem', background: STATUS_COLORS.NEW, color: '#fff', padding: '2px 8px', borderRadius: 999, marginLeft: 6 }}>{newCount} new</span>}</h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-sm btn-secondary" onClick={() => setShowPast(p => !p)}>
            {showPast ? 'Show upcoming' : 'Show past'}
          </button>
          <button className="btn btn-sm btn-secondary" onClick={load} disabled={loading}>Refresh</button>
        </div>
      </div>
      <p className="text-muted" style={{ margin: '0.5rem 0 1rem', fontSize: '0.85rem' }}>
        Pre-orders from the /catering page (minimum 5 days notice). Customers are also asked to send the details on WhatsApp.
      </p>

      {error && <p style={{ color: '#b91c1c', fontSize: '0.9rem' }}>Could not load requests: {error}</p>}

      <div className="table-responsive"><table className="admin-table">
        <thead><tr><th>Event</th><th>Customer</th><th>Pax</th><th>Order</th><th>Pickup / Delivery</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {loading ? (
            <tr><td colSpan="7" className="text-center text-muted" style={{ padding: '2rem' }}>Loading...</td></tr>
          ) : visible.length === 0 ? (
            <tr><td colSpan="7" className="text-center text-muted" style={{ padding: '2rem' }}>
              {showPast ? 'No past catering requests.' : 'No upcoming catering requests yet.'}
            </td></tr>
          ) : visible.map(r => (
            <tr key={r.id} style={{ opacity: r.status === 'DECLINED' ? 0.55 : 1 }}>
              <td style={{ whiteSpace: 'nowrap' }}><strong>{formatDate(r.event_date)}</strong>{r.event_time && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{r.event_time}</div>}</td>
              <td><strong>{r.name}</strong><div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{r.phone}</div></td>
              <td><strong>{r.headcount}</strong></td>
              <td style={{ maxWidth: 320, whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>
                {r.details}
                {r.dietary && <div style={{ marginTop: 4, color: '#b45309', fontSize: '0.8rem' }}>Dietary: {r.dietary}</div>}
              </td>
              <td style={{ fontSize: '0.85rem' }}>{r.fulfilment === 'delivery' ? <>Delivery<div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{r.address}</div></> : 'Pickup'}</td>
              <td>
                <select
                  value={r.status}
                  onChange={e => updateStatus(r.id, e.target.value)}
                  aria-label={`Status for ${r.name}`}
                  style={{ background: STATUS_COLORS[r.status], color: '#fff', border: 'none', borderRadius: 4, padding: '4px 6px', fontWeight: 700, fontSize: '0.75rem' }}
                >
                  {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </td>
              <td>
                <a
                  className="btn btn-sm btn-primary"
                  href={`https://wa.me/${toWhatsAppNumber(r.phone)}?text=${encodeURIComponent(`Hi ${r.name}, this is MunchiesKK about your catering request for ${formatDate(r.event_date)} (${r.headcount} pax).`)}`}
                  target="_blank" rel="noopener noreferrer"
                >
                  WhatsApp
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}
