import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../config/supabase';
import { whatsAppLink } from '../utils/whatsapp';

const fmtDate = (d) => new Date(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuching' });

// Points fade after 12 months of no activity (25% a month). This lists the
// customers who are in their 11th month ("soon") or already fading, with a
// ready-written WhatsApp message for the ones who left a phone number.
function reminderText(row) {
  const first = (row.name || 'there').trim().split(/\s+/)[0];
  if (row.state === 'fading') {
    return `Hi ${first}, this is MunchiesKK 🍔 Your points have started to fade (${row.points} left). Order any time to stop it and keep the rest!`;
  }
  return `Hi ${first}, this is MunchiesKK 🍔 You have ${row.points} points. They start to fade on ${fmtDate(row.fade_starts_at)} if there is no order. Order any time before then and you keep them all!`;
}

export default function AdminFadingPoints() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('admin_fading_points');
    if (err) { setError('Could not load the list. Run the points expiry SQL in Supabase first.'); setRows([]); return; }
    setError('');
    setRows(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="admin-card">
      <h3 style={{ marginTop: 0 }}>Fading points</h3>
      <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
        Points fade after 12 months with no order, game points or reward (25% a month, gone in 4 months). Message these customers once before it starts. Tap WhatsApp, check the message, and send.
      </p>
      {error && <p style={{ color: '#ef4444' }}>{error}</p>}
      {rows === null ? <p>Loading...</p> : (
        <div className="table-responsive">
          <table className="admin-table">
            <thead>
              <tr><th>Customer</th><th>Points</th><th>Last active</th><th>Status</th><th>Action</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan="5" className="text-center text-muted" style={{ padding: '2rem' }}>Nobody is close to losing points.</td></tr>
              ) : rows.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium">
                    {row.name || 'Unnamed'}
                    <div className="text-xs text-muted mt-1 font-normal">{row.phone || 'No phone'}</div>
                  </td>
                  <td className="text-primary font-bold">{row.points}</td>
                  <td>{fmtDate(row.last_active)}</td>
                  <td>{row.state === 'fading' ? 'Fading now' : `Starts ${fmtDate(row.fade_starts_at)}`}</td>
                  <td>
                    {row.phone ? (
                      <a className="btn btn-sm btn-primary" href={whatsAppLink(row.phone, reminderText(row))} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                    ) : <span className="text-muted">No phone</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
