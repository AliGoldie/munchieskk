import { useState, useCallback, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Minus, Plus } from 'lucide-react';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useStore } from '../contexts/StoreContext';
import CateringPausedModal from '../components/CateringPausedModal';
import { siteConfig } from '../config/siteConfig';
import {
  SLIDERS_PER_TRAY, SLIDER_TRAYS, FRIES_TRAY, MIN_SLIDER_TRAYS,
  BULK_DISCOUNT, DELIVERY_FROM, DEPOSIT_PERCENT
} from '../config/cateringConfig';
import { getMalaysiaNow, addMalaysiaDays } from '../utils/timeUtils';
import { pinLinks } from '../utils/mapLinks';
import './Catering.css';

// Leaflet (~150KB with its CSS) only downloads when a customer actually
// picks Delivery, not for every visit to /catering.
const DeliveryMap = lazy(() => import('../components/DeliveryMap'));

const LEAD_DAYS = 5;
const ALL_TRAYS = [...SLIDER_TRAYS, FRIES_TRAY];
const MAX_PER_TRAY = 50;

const UNIT = (t) => (t.id === FRIES_TRAY.id ? 'portions' : 'sliders');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Customers pick packs; the line also spells out how many sliders that is.
const countLabel = (t, packs) => `${plural(packs, 'pack')} (${packs * SLIDERS_PER_TRAY} ${UNIT(t)})`;

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
  return ALL_TRAYS.filter(t => qty[t.id] > 0).map(t => `${t.name} x ${countLabel(t, qty[t.id])} = ${rm(qty[t.id] * t.price)}`);
}

function buildDetails(qty, notes, pin) {
  const q = computeQuote(qty);
  const lines = [...orderLines(qty)];
  if (q.discount > 0) lines.push(`Bulk discount: -${rm(q.discount)}`);
  lines.push(`Estimate: ${rm(q.total)} + delivery if any`);
  if (notes.trim()) lines.push(`Notes: ${notes.trim()}`);
  if (pin) lines.push(`Pin: ${pinLinks(pin).google}`);
  return lines.join('\n');
}

function buildWhatsAppMessage(f, qty, pin) {
  const lines = [
    'Hi MunchiesKK! Slider catering pre-order:',
    '',
    `Name: ${f.name}`,
    `Phone: ${f.phone}`,
    `Date: ${formatDateLabel(f.eventDate)}${f.eventTime ? ` at ${f.eventTime}` : ''}`,
    `Guests: ${f.headcount}`,
    f.fulfilment === 'delivery' ? `Delivery to: ${f.address}` : 'Self pickup',
    ...(f.fulfilment === 'delivery' && pin
      ? [`Google Maps: ${pinLinks(pin).google}`, `Waze: ${pinLinks(pin).waze}`]
      : []),
    '',
    buildDetails(qty, f.notes)
  ];
  if (f.dietary) lines.push(`Dietary notes: ${f.dietary}`);
  return lines.join('\n');
}

export default function Catering() {
  const { user } = useAuth();
  const { shopSettings } = useStore();
  // Admin › Catering can switch catering off; the server refuses requests
  // then too, this just tells the customer up front.
  const cateringPaused = shopSettings?.catering_enabled === false;
  const [pausedDismissed, setPausedDismissed] = useState(false);
  const closePaused = useCallback(() => setPausedDismissed(true), []);
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
  const [pin, setPin] = useState(null);
  const [addrSuggestion, setAddrSuggestion] = useState('');
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
    if (cateringPaused) {
      setPausedDismissed(false);
      return;
    }
    if (form.eventDate && form.eventDate < minDate) {
      setError(`Catering needs at least ${LEAD_DAYS} days notice. The earliest date is ${formatDateLabel(minDate)}.`);
      return;
    }
    if (quote.sliderTrays < MIN_SLIDER_TRAYS) {
      setError(`Please pick at least ${plural(MIN_SLIDER_TRAYS, 'slider pack')} for a catering order.`);
      document.getElementById('cat-trays')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSubmitting(true);
    const deliveryPin = form.fulfilment === 'delivery' ? pin : null;
    const waUrl = `https://wa.me/${siteConfig.whatsappNumber}?text=${encodeURIComponent(buildWhatsAppMessage(form, qty, deliveryPin))}`;
    const { error: rpcError } = await supabase.rpc('submit_catering_request', {
      p_name: form.name,
      p_phone: form.phone,
      p_event_date: form.eventDate,
      p_event_time: form.eventTime || null,
      p_headcount: parseInt(form.headcount, 10),
      p_fulfilment: form.fulfilment,
      p_address: form.fulfilment === 'delivery' ? form.address : null,
      p_details: buildDetails(qty, form.notes, deliveryPin),
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
      {cateringPaused && !pausedDismissed && <CateringPausedModal loggedIn={Boolean(user)} onClose={closePaused} />}
      {cateringPaused && (
        <p className="cat-paused-bar" role="status">Catering orders are paused right now. You can still browse the packs.</p>
      )}
      <header className="cat-hero">
        <p className="cat-eyebrow">SLIDER CATERING</p>
        <h1>ONE BITE IS <span>NEVER ENOUGH.</span></h1>
        <p className="cat-hero-sub">Slider catering packs, {SLIDERS_PER_TRAY} sliders each. Made fresh for your office lunch, birthday or kenduri.</p>
        <ul className="cat-chips">
          <li>{LEAD_DAYS} days notice</li>
          <li>{SLIDERS_PER_TRAY} sliders per pack</li>
          <li>{DEPOSIT_PERCENT}% deposit</li>
        </ul>
      </header>

      <section className="cat-trays" aria-labelledby="cat-trays-title">
        <h2 id="cat-trays-title" className="cat-section-title">SLIDER PACKS</h2>
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
          <li><span>Each slider pack, when you order {BULK_DISCOUNT.minTrays}+ packs</span><strong>{rm(BULK_DISCOUNT.perTray)} OFF</strong></li>
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
          <legend><span className="cat-step-num">1</span>Pick your packs</legend>
          <ul className="cat-qty-list">
            {ALL_TRAYS.map(t => (
              <li key={t.id} className={qty[t.id] > 0 ? 'has-qty' : ''}>
                <div className="cat-qty-label">
                  <strong>{t.name}</strong>
                  <span>{rm(t.price)} · {SLIDERS_PER_TRAY} {UNIT(t)}</span>
                </div>
                <div className="cat-stepper">
                  <button type="button" onClick={() => bump(t.id, -1)} disabled={qty[t.id] === 0} aria-label={`One fewer ${t.name}`}>
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
              <p className="cat-quote-empty">Pick a slider pack to see your estimate.</p>
            ) : (
              <>
                {quote.discount > 0 && (
                  <div className="cat-quote-row"><span>Bulk discount</span><span>-{rm(quote.discount)}</span></div>
                )}
                <div className="cat-quote-row cat-quote-total"><span>Estimate</span><span>{rm(quote.total)}</span></div>
                <p className="cat-quote-note">
                  {quote.sliderTrays < MIN_SLIDER_TRAYS
                    ? `Add ${plural(MIN_SLIDER_TRAYS - quote.sliderTrays, 'more slider pack')} to reach the minimum.`
                    : quote.sliderTrays < BULK_DISCOUNT.minTrays
                      ? `Add ${plural(BULK_DISCOUNT.minTrays - quote.sliderTrays, 'more slider pack')} to save ${rm(BULK_DISCOUNT.perTray)} on every pack.`
                      : `${plural(quote.sliderTrays, 'slider pack')}, ${quote.sliderTrays * SLIDERS_PER_TRAY} sliders. Delivery, if any, is quoted on WhatsApp.`}
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
            <>
              <div className="cat-field">
                <span className="cat-label">Pin your delivery spot</span>
                <Suspense fallback={<div className="cat-map-loading">Loading map...</div>}>
                  <DeliveryMap value={pin} onChange={setPin} onAddressSuggestion={setAddrSuggestion} />
                </Suspense>
              </div>
              <div className="cat-field">
                <label htmlFor="cat-address">Delivery address</label>
                <textarea
                  id="cat-address" rows={2} value={form.address} onChange={set('address')} required maxLength={300}
                  placeholder="Unit / floor, building, street"
                />
                {addrSuggestion && addrSuggestion !== form.address && (
                  <button
                    type="button"
                    className="cat-suggest"
                    onClick={() => setForm(prev => ({ ...prev, address: addrSuggestion.slice(0, 300) }))}
                  >
                    Use pinned address: <span>{addrSuggestion}</span>
                  </button>
                )}
              </div>
            </>
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
            <textarea id="cat-notes" rows={2} value={form.notes} onChange={set('notes')} maxLength={800} placeholder="e.g. swap the Mushy2 for more BBQ Chicken" />
          </div>
        </fieldset>

        <button type="submit" className="cat-submit" disabled={submitting}>
          {cateringPaused ? 'CATERING PAUSED' : submitting ? 'SENDING...' : 'SEND ORDER REQUEST'}
        </button>
        <p className="cat-foot">We confirm on WhatsApp. Your order is locked in once the {DEPOSIT_PERCENT}% deposit is paid.</p>
      </form>
      </div>
    </div>
  );
}
