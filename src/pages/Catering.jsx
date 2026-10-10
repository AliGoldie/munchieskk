import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle } from 'lucide-react';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useStore } from '../contexts/StoreContext';
import { siteConfig } from '../config/siteConfig';
import { SLIDER_PACKAGES } from '../config/cateringConfig';
import { getMalaysiaNow, addMalaysiaDays } from '../utils/timeUtils';
import './Catering.css';

const LEAD_DAYS = 5;

// Order the price board the way a crowd usually orders: mains first.
const BOARD_CATEGORIES = ['BBQ', 'PREMIUM', 'PLATTERS', 'SIDES', 'DRINKS'];

const money = (cents) => (cents / 100).toFixed(2);

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
  const { menu = [], addons = [], isPromoActive } = useStore();

  // Live prices from the menu (not hardcoded), so the board can never
  // drift from what the kitchen actually charges.
  const priceOf = (item) => (isPromoActive && isPromoActive(item) ? item.promo_price : item.price);
  const boardCategories = BOARD_CATEGORIES
    .map(cat => ({
      cat,
      items: menu
        .filter(m => (m.category || '').toUpperCase() === cat)
        .sort((a, b) => priceOf(a) - priceOf(b))
    }))
    .filter(g => g.items.length > 0);
  const setAddon = addons.find(a => /combo.*fries|fries.*combo/i.test(a.name || '')) || addons.find(a => /combo/i.test(a.name || ''));
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
        <div className="cat-ticket-wrap"><div className="cat-ticket cat-done">
          <div className="cat-stamp">{result.saved ? 'RECEIVED' : 'NOT SAVED'}</div>
          <CheckCircle size={44} className="cat-done-icon" />
          <h2>{result.saved ? 'Request received!' : 'Almost there'}</h2>
          <p>
            {result.saved
              ? 'Tap below to send it to us on WhatsApp so we can confirm the menu and price with you.'
              : "We couldn't save your request just now. Send it to us on WhatsApp instead -- all your details are filled in."}
          </p>
          <a href={result.waUrl} target="_blank" rel="noopener noreferrer" className="cat-submit cat-submit--wa">
            SEND ON WHATSAPP
          </a>
          <Link to="/" className="cat-back">Back to home</Link>
        </div></div>
      </div>
    );
  }

  return (
    <div className="catering-page">
      <header className="cat-hero">
        <p className="cat-eyebrow">CATERING &amp; PRE-ORDERS</p>
        <h1>FEEDING THE <span>WHOLE KAWAN?</span></h1>
        <p className="cat-hero-sub">Office lunch, birthday, kenduri -- tell us what you need and we'll prep it fresh.</p>
        <ul className="cat-chips">
          <li>{LEAD_DAYS} days notice</li>
          <li>Pickup or delivery</li>
          <li>Confirmed on WhatsApp</li>
        </ul>
      </header>

      {(boardCategories.length > 0 || SLIDER_PACKAGES.length > 0) && (
        <section className="cat-board" aria-labelledby="cat-board-title">
          <div className="cat-board-head">
            <h2 id="cat-board-title">THE MENU BOARD</h2>
            <span>Prices per item</span>
          </div>
          {SLIDER_PACKAGES.length > 0 && (
            <div className="cat-board-sliders">
              <h3>SLIDERS <span>our catering favourite</span></h3>
              <ul>
                {SLIDER_PACKAGES.map(pkg => (
                  <li key={pkg.name}>
                    <span className="cat-board-name">
                      {pkg.name}
                      {pkg.detail && <small>{pkg.detail}</small>}
                    </span>
                    <span className="cat-board-dots" aria-hidden="true" />
                    <span className="cat-board-price">
                      {money(pkg.price)}{pkg.unit && <small> {pkg.unit}</small>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="cat-board-grid">
            {boardCategories.map(({ cat, items }) => (
              <div key={cat} className="cat-board-col">
                <h3>{cat}</h3>
                <ul>
                  {items.map(item => (
                    <li key={item.id} className={item.inStock === false ? 'is-out' : ''}>
                      <span className="cat-board-name">{item.name}</span>
                      <span className="cat-board-dots" aria-hidden="true" />
                      <span className="cat-board-price">{money(priceOf(item))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {setAddon && (
            <p className="cat-board-set">
              <strong>+ RM {money(setAddon.price)}</strong> turns any burger into a set with fries + a can drink
            </p>
          )}
          <p className="cat-board-note">Ordering for a big group? Bulk pricing is confirmed with you on WhatsApp.</p>
        </section>
      )}

      <div className="cat-ticket-wrap">
      <form onSubmit={handleSubmit} className="cat-ticket">
        <div className="cat-ticket-head">
          <span>ORDER TICKET</span>
          <span>MUNCHIESKK</span>
        </div>

        {error && <div className="cat-error" role="alert">{error}</div>}

        <fieldset className="cat-step">
          <legend><span className="cat-step-num">1</span>Who&apos;s ordering</legend>
          <div className="cat-field">
            <label htmlFor="cat-name">Your name</label>
            <input id="cat-name" value={form.name} onChange={set('name')} required minLength={2} maxLength={80} autoComplete="name" />
          </div>
          <div className="cat-field">
            <label htmlFor="cat-phone">WhatsApp number</label>
            <input id="cat-phone" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} required placeholder="012-345 6789" autoComplete="tel" />
          </div>
        </fieldset>

        <fieldset className="cat-step">
          <legend><span className="cat-step-num">2</span>When &amp; how</legend>
          <div className="cat-row">
            <div className="cat-field">
              <label htmlFor="cat-date">Event date</label>
              <input id="cat-date" type="date" value={form.eventDate} onChange={set('eventDate')} min={minDate} required />
            </div>
            <div className="cat-field">
              <label htmlFor="cat-time">Time (optional)</label>
              <input id="cat-time" type="time" value={form.eventTime} onChange={set('eventTime')} />
            </div>
          </div>
          <p className="cat-hint">Earliest available: <strong>{formatDateLabel(minDate)}</strong></p>
          <div className="cat-field">
            <label htmlFor="cat-pax">How many people?</label>
            <input id="cat-pax" type="number" inputMode="numeric" min={1} max={2000} value={form.headcount} onChange={set('headcount')} required placeholder="e.g. 30" />
          </div>
          <div className="cat-field">
            <span className="cat-label">Pickup or delivery?</span>
            <div className="cat-toggle" role="group" aria-label="Pickup or delivery">
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
            <div className="cat-field">
              <label htmlFor="cat-address">Delivery address</label>
              <textarea id="cat-address" rows={2} value={form.address} onChange={set('address')} required maxLength={300} />
            </div>
          )}
        </fieldset>

        <fieldset className="cat-step">
          <legend><span className="cat-step-num">3</span>The order</legend>
          <div className="cat-field">
            <label htmlFor="cat-details">What would you like?</label>
            <textarea
              id="cat-details" rows={4} value={form.details} onChange={set('details')} required maxLength={1500}
              placeholder="e.g. 20 BBQ beef burgers, 10 chicken, 30 sets with fries + drink"
            />
          </div>
          <div className="cat-field">
            <label htmlFor="cat-dietary">Dietary notes (optional)</label>
            <input id="cat-dietary" value={form.dietary} onChange={set('dietary')} maxLength={500} placeholder="Allergies, no spicy, etc." />
          </div>
        </fieldset>

        <button type="submit" className="cat-submit" disabled={submitting}>
          {submitting ? 'SENDING...' : 'SEND ORDER REQUEST'}
        </button>
        <p className="cat-foot">We reply on WhatsApp with the menu and price. Nothing is charged until you confirm.</p>
      </form>
      </div>
    </div>
  );
}
