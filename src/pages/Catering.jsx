import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, CheckCircle } from 'lucide-react';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import { siteConfig } from '../config/siteConfig';
import { getMalaysiaNow, addMalaysiaDays } from '../utils/timeUtils';
import './Catering.css';

const LEAD_DAYS = 5;

function formatDateLabel(dateStr) {
  return new Date(`${dateStr}T00:00:00+08:00`).toLocaleDateString('en-MY', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur'
  });
}

function buildWhatsAppMessage(f) {
  const lines = [
    'Hi MunchiesKK! Catering pre-order request:',
    '',
    `Name: ${f.name}`,
    `Phone: ${f.phone}`,
    `Date: ${formatDateLabel(f.eventDate)}${f.eventTime ? ` at ${f.eventTime}` : ''}`,
    `Pax: ${f.headcount}`,
    `${f.fulfilment === 'delivery' ? `Delivery to: ${f.address}` : 'Self pickup'}`,
    '',
    `Order: ${f.details}`
  ];
  if (f.dietary) lines.push(`Dietary notes: ${f.dietary}`);
  return lines.join('\n');
}

export default function Catering() {
  const { user } = useAuth();
  const minDate = addMalaysiaDays(getMalaysiaNow().dateStr, LEAD_DAYS);

  const [form, setForm] = useState({
    name: user?.name || '',
    phone: user?.phone || '',
    eventDate: '',
    eventTime: '',
    headcount: '',
    fulfilment: 'pickup',
    address: '',
    details: '',
    dietary: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const set = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.eventDate && form.eventDate < minDate) {
      setError(`Catering needs at least ${LEAD_DAYS} days notice. The earliest date is ${formatDateLabel(minDate)}.`);
      return;
    }
    setSubmitting(true);
    const waUrl = `https://wa.me/${siteConfig.whatsappNumber}?text=${encodeURIComponent(buildWhatsAppMessage(form))}`;
    const { error: rpcError } = await supabase.rpc('submit_catering_request', {
      p_name: form.name,
      p_phone: form.phone,
      p_event_date: form.eventDate,
      p_event_time: form.eventTime || null,
      p_headcount: parseInt(form.headcount, 10),
      p_fulfilment: form.fulfilment,
      p_address: form.fulfilment === 'delivery' ? form.address : null,
      p_details: form.details,
      p_dietary: form.dietary || null
    });
    setSubmitting(false);

    if (rpcError) {
      // P0001 is a RAISE EXCEPTION from submit_catering_request's own
      // validation -- written for customers, safe to show as-is. Anything
      // else (network down, server error) falls back to WhatsApp-only so
      // the request still reaches the kitchen instead of dead-ending.
      if (rpcError.code === 'P0001') {
        setError(rpcError.message);
        return;
      }
      setResult({ saved: false, waUrl });
      return;
    }
    setResult({ saved: true, waUrl });
  };

  if (result) {
    return (
      <div className="catering-page">
        <div className="catering-card catering-done">
          <CheckCircle size={52} className="catering-done-icon" />
          <h2>{result.saved ? 'Request received!' : 'Almost there'}</h2>
          <p>
            {result.saved
              ? 'Tap below to send it to us on WhatsApp so we can confirm the menu and price with you.'
              : "We couldn't save your request just now. Send it to us on WhatsApp instead -- all your details are filled in."}
          </p>
          <a href={result.waUrl} target="_blank" rel="noopener noreferrer" className="btn catering-wa-btn">
            SEND ON WHATSAPP
          </a>
          <Link to="/" className="catering-back">Back to home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="catering-page">
      <div className="catering-card">
        <CalendarDays size={40} className="catering-icon" />
        <h2>Catering &amp; Pre-orders</h2>
        <p className="catering-sub">
          Feeding a crowd? Book at least {LEAD_DAYS} days ahead so we can prep fresh for you.
          We'll confirm the menu and price on WhatsApp.
        </p>

        {error && <div className="catering-error" role="alert">{error}</div>}

        <form onSubmit={handleSubmit} className="catering-form">
          <div className="form-group">
            <label htmlFor="cat-name">Your name</label>
            <input id="cat-name" value={form.name} onChange={set('name')} required minLength={2} maxLength={80} autoComplete="name" />
          </div>
          <div className="form-group">
            <label htmlFor="cat-phone">WhatsApp number</label>
            <input id="cat-phone" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} required placeholder="012-345 6789" autoComplete="tel" />
          </div>

          <div className="catering-row">
            <div className="form-group">
              <label htmlFor="cat-date">Event date</label>
              <input id="cat-date" type="date" value={form.eventDate} onChange={set('eventDate')} min={minDate} required />
            </div>
            <div className="form-group">
              <label htmlFor="cat-time">Time (optional)</label>
              <input id="cat-time" type="time" value={form.eventTime} onChange={set('eventTime')} />
            </div>
          </div>
          <p className="catering-hint">Earliest available: {formatDateLabel(minDate)}</p>

          <div className="form-group">
            <label htmlFor="cat-pax">How many people?</label>
            <input id="cat-pax" type="number" inputMode="numeric" min={1} max={2000} value={form.headcount} onChange={set('headcount')} required placeholder="e.g. 30" />
          </div>

          <div className="form-group">
            <label>Pickup or delivery?</label>
            <div className="catering-toggle">
              {['pickup', 'delivery'].map(opt => (
                <button
                  key={opt}
                  type="button"
                  className={form.fulfilment === opt ? 'active' : ''}
                  onClick={() => setForm(prev => ({ ...prev, fulfilment: opt }))}
                  aria-pressed={form.fulfilment === opt}
                >
                  {opt === 'pickup' ? 'Self pickup' : 'Delivery'}
                </button>
              ))}
            </div>
          </div>

          {form.fulfilment === 'delivery' && (
            <div className="form-group">
              <label htmlFor="cat-address">Delivery address</label>
              <textarea id="cat-address" rows={2} value={form.address} onChange={set('address')} required maxLength={300} />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="cat-details">What would you like?</label>
            <textarea
              id="cat-details" rows={3} value={form.details} onChange={set('details')} required maxLength={1500}
              placeholder="e.g. 20 BBQ beef burgers, 10 chicken, 30 sets with fries + drink"
            />
          </div>
          <div className="form-group">
            <label htmlFor="cat-dietary">Dietary notes (optional)</label>
            <input id="cat-dietary" value={form.dietary} onChange={set('dietary')} maxLength={500} placeholder="Allergies, no spicy, etc." />
          </div>

          <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
            {submitting ? 'Sending...' : 'Send request'}
          </button>
        </form>
      </div>
    </div>
  );
}
