import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Minus, Plus } from 'lucide-react';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import { siteConfig } from '../config/siteConfig';
import {
  SLIDERS_PER_TRAY, SLIDER_TRAYS, FRIES_TRAY, MIN_SLIDER_TRAYS,
  BULK_DISCOUNT, DELIVERY_FROM, DEPOSIT_PERCENT
} from '../config/cateringConfig';
import { getMalaysiaNow, addMalaysiaDays } from '../utils/timeUtils';
import './Catering.css';

const LEAD_DAYS = 5;
const ALL_TRAYS = [...SLIDER_TRAYS, FRIES_TRAY];
const MAX_PER_TRAY = 50;

const rm = (sen) => {
  const v = sen / 100;
  return `RM${Number.isInteger(v) ? v : v.toFixed(2)}`;
};

function formatDateLabel(dateStr) {
  return new Date(`${dateStr}T00:00:00+08:00`).toLocaleDateString('en-MY', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur'
  });
}

function computeQuote(qty) {
  const sliderTrays = SLIDER_TRAYS.reduce((n, t) => n + (qty[t.id] || 0), 0);
  const subtotal = ALL_TRAYS.reduce((sum, t) => sum + (qty[t.id] || 0) * t.price, 0);
  const discount = sliderTrays >= BULK_DISCOUNT.minTrays ? sliderTrays * BULK_DISCOUNT.perTray : 0;
  return { sliderTrays, subtotal, discount, total: subtotal - discount };
}

function orderLines(qty) {
  return ALL_TRAYS.filter(t => qty[t.id] > 0).map(t => `${qty[t.id]} x ${t.name} (${rm(t.price)} each)`);
}

function buildDetails(qty, notes) {
  const q = computeQuote(qty);
  const lines = [...orderLines(qty)];
  if (q.discount > 0) lines.push(`Multi-tray discount: -${rm(q.discount)}`);
  lines.push(`Estimate: ${rm(q.total)} + delivery if any`);
  if (notes.trim()) lines.push(`Notes: ${notes.trim()}`);
  return lines.join('\n');
}

function buildWhatsAppMessage(f, qty) {
  const lines = [
    'Hi MunchiesKK! Slider catering pre-order:',
    '',
    `Name: ${f.name}`,
    `Phone: ${f.phone}`,
    `Date: ${formatDateLabel(f.eventDate)}${f.eventTime ? ` at ${f.eventTime}` : ''}`,
    `Guests: ${f.headcount}`,
    f.fulfilment === 'delivery' ? `Delivery to: ${f.address}` : 'Self pickup',
    '',
    buildDetails(qty, f.notes)
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
    notes: '',
    dietary: ''
  });
  const [qty, setQty] = useState(() => Object.fromEntries(ALL_TRAYS.map(t => [t.id, 0])));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const set = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }));
  const bump = (id, delta) => {
    setError('');
    setQty(prev => ({ ...prev, [id]: Math.min(MAX_PER_TRAY, Math.max(0, (prev[id] || 0) + delta)) }));
  };
  const quote = computeQuote(qty);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.eventDate && form.eventDate < minDate) {
      setError(`Catering needs at least ${LEAD_DAYS} days notice. The earliest date is ${formatDateLabel(minDate)}.`);
      return;
    }
    if (quote.sliderTrays < MIN_SLIDER_TRAYS) {
      setError(`Please pick at least ${MIN_SLIDER_TRAYS} slider trays -- that's our minimum catering order.`);
      document.getElementById('cat-trays')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSubmitting(true);
    const waUrl = `https://wa.me/${siteConfig.whatsappNumber}?text=${encodeURIComponent(buildWhatsAppMessage(form, qty))}`;
    const { error: rpcError } = await supabase.rpc('submit_catering_request', {
      p_name: form.name,
      p_phone: form.phone,
      p_event_date: form.eventDate,
      p_event_time: form.eventTime || null,
      p_headcount: parseInt(form.headcount, 10),
      p_fulfilment: form.fulfilment,
      p_address: form.fulfilment === 'delivery' ? form.address : null,
      p_details: buildDetails(qty, form.notes),
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
              ? `Tap below to send it to us on WhatsApp. We'll confirm the order and take a ${DEPOSIT_PERCENT}% deposit to lock it in.`
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
        <p className="cat-eyebrow">SLIDER CATERING</p>
        <h1>ONE BITE IS <span>NEVER ENOUGH.</span></h1>
        <p className="cat-hero-sub">Foil trays of {SLIDERS_PER_TRAY} sliders each, made fresh for your office lunch, birthday or kenduri.</p>
        <ul className="cat-chips">
          <li>{LEAD_DAYS} days notice</li>
          <li>Min. {MIN_SLIDER_TRAYS} trays</li>
          <li>{DEPOSIT_PERCENT}% deposit</li>
        </ul>
      </header>

      <section className="cat-trays" aria-labelledby="cat-trays-title">
        <h2 id="cat-trays-title" className="cat-section-title">THE TRAYS</h2>
        {SLIDER_TRAYS.map(t => (
          <article key={t.id} className="cat-tray-card">
            <div className="cat-tray-info">
              <h3>{t.name}</h3>
              <p>{t.contents}</p>
            </div>
            <div className="cat-tray-price">
              <strong>{rm(t.price)}</strong>
              <span>{rm(Math.round(t.price / SLIDERS_PER_TRAY))} per slider</span>
            </div>
          </article>
        ))}
        <ul className="cat-extras">
          <li><span>{FRIES_TRAY.name}, {FRIES_TRAY.contents}</span><strong>{rm(FRIES_TRAY.price)}</strong></li>
          <li><span>Delivery, by distance</span><strong>FROM {rm(DELIVERY_FROM)}</strong></li>
          <li><span>Per slider tray, from {BULK_DISCOUNT.minTrays} trays</span><strong>{rm(BULK_DISCOUNT.perTray)} OFF</strong></li>
        </ul>
      </section>

      <div className="cat-ticket-wrap">
      <form onSubmit={handleSubmit} className="cat-ticket">
        <div className="cat-ticket-head">
          <span>ORDER TICKET</span>
          <span>MUNCHIESKK</span>
        </div>

        {error && <div className="cat-error" role="alert">{error}</div>}

        <fieldset className="cat-step" id="cat-trays">
          <legend><span className="cat-step-num">1</span>Pick your trays</legend>
          <ul className="cat-qty-list">
            {ALL_TRAYS.map(t => (
              <li key={t.id} className={qty[t.id] > 0 ? 'has-qty' : ''}>
                <div className="cat-qty-label">
                  <strong>{t.name}</strong>
                  <span>{rm(t.price)}</span>
                </div>
                <div className="cat-stepper">
                  <button type="button" onClick={() => bump(t.id, -1)} disabled={qty[t.id] === 0} aria-label={`One less ${t.name}`}>
                    <Minus size={18} />
                  </button>
                  <output aria-live="polite" aria-label={`${t.name} quantity`}>{qty[t.id]}</output>
                  <button type="button" onClick={() => bump(t.id, 1)} disabled={qty[t.id] >= MAX_PER_TRAY} aria-label={`One more ${t.name}`}>
                    <Plus size={18} />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="cat-quote" aria-live="polite">
            {quote.subtotal === 0 ? (
              <p className="cat-quote-empty">Pick at least {MIN_SLIDER_TRAYS} slider trays to see your estimate.</p>
            ) : (
              <>
                {quote.discount > 0 && (
                  <div className="cat-quote-row"><span>Multi-tray discount</span><span>-{rm(quote.discount)}</span></div>
                )}
                <div className="cat-quote-row cat-quote-total"><span>Estimate</span><span>{rm(quote.total)}</span></div>
                <p className="cat-quote-note">
                  {quote.sliderTrays < MIN_SLIDER_TRAYS
                    ? `Add ${MIN_SLIDER_TRAYS - quote.sliderTrays} more slider tray${MIN_SLIDER_TRAYS - quote.sliderTrays === 1 ? '' : 's'} to reach the minimum.`
                    : quote.sliderTrays < BULK_DISCOUNT.minTrays
                      ? `Add 1 more slider tray to save ${rm(BULK_DISCOUNT.perTray)} on every tray.`
                      : `${quote.sliderTrays * SLIDERS_PER_TRAY} sliders. Delivery, if any, is quoted on WhatsApp.`}
                </p>
              </>
            )}
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
            <label htmlFor="cat-pax">How many guests?</label>
            <input id="cat-pax" type="number" inputMode="numeric" min={1} max={2000} value={form.headcount} onChange={set('headcount')} required placeholder="e.g. 40" />
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
          <legend><span className="cat-step-num">3</span>About you</legend>
          <div className="cat-field">
            <label htmlFor="cat-name">Your name</label>
            <input id="cat-name" value={form.name} onChange={set('name')} required minLength={2} maxLength={80} autoComplete="name" />
          </div>
          <div className="cat-field">
            <label htmlFor="cat-phone">WhatsApp number</label>
            <input id="cat-phone" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} required placeholder="012-345 6789" autoComplete="tel" />
          </div>
          <div className="cat-field">
            <label htmlFor="cat-dietary">Dietary notes (optional)</label>
            <input id="cat-dietary" value={form.dietary} onChange={set('dietary')} maxLength={500} placeholder="Allergies, no spicy, etc." />
          </div>
          <div className="cat-field">
            <label htmlFor="cat-notes">Anything else? (optional)</label>
            <textarea id="cat-notes" rows={2} value={form.notes} onChange={set('notes')} maxLength={800} placeholder="e.g. mix the Party Tray with more chicken" />
          </div>
        </fieldset>

        <button type="submit" className="cat-submit" disabled={submitting}>
          {submitting ? 'SENDING...' : 'SEND ORDER REQUEST'}
        </button>
        <p className="cat-foot">We confirm on WhatsApp. Your order is locked in once the {DEPOSIT_PERCENT}% deposit is paid.</p>
      </form>
      </div>
    </div>
  );
}
