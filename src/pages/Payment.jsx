import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import { formatTime12Hour, generateOperatingTimeSlots } from '../utils/timeUtils';
import { supabase } from '../config/supabase';
import { CreditCard, QrCode, Building2, CheckCircle2, Loader2, Clock, AlertTriangle, Zap, Tag } from 'lucide-react';
import './Payment.css';

export default function Payment() {
  const { cart, cartTotal, placeOrder, shopSettings, isShopOpenNow } = useStore();
  const { user } = useAuth();
  const navigate = useNavigate();

  const isOpen = isShopOpenNow();

  const [method, setMethod] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [bank, setBank] = useState('');

  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promoStatus, setPromoStatus] = useState({ state: 'idle', message: '' }); // idle | checking | valid | invalid
  const [appliedPromoCode, setAppliedPromoCode] = useState(null);
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [promoFreeItemName, setPromoFreeItemName] = useState(null);
  const [promoFreeItemId, setPromoFreeItemId] = useState(null);

  const finalTotal = Math.max(0, cartTotal - promoDiscount);

  // Dynamically generate pre-order time slots strictly within business hours
  const timeSlots = useMemo(() => {
    return generateOperatingTimeSlots(shopSettings?.openingTime || '10:00', shopSettings?.closingTime || '22:00');
  }, [shopSettings?.openingTime, shopSettings?.closingTime]);

  // Order Timing Selection: ORDER NOW is the primary default option
  const [orderMode, setOrderMode] = useState('NOW');
  const [scheduledTime, setScheduledTime] = useState(timeSlots[0]?.value || '12:00');

  if (!user) {
    navigate('/login');
    return null;
  }

  if (cart.length === 0 && !isSuccess) {
    navigate('/cart');
    return null;
  }

  const handlePayment = async () => {
    if (!method) return alert('Please select a payment method.');
    if (method === 'FPX' && !bank) return alert('Please select a bank.');

    if (shopSettings?.status === 'PAUSED') {
      return alert('MunchiesKK is closed right now. Schedule your order for later, or check back during our opening hours.');
    }

    if (shopSettings?.status === 'CLOSED') {
      return alert('MunchiesKK is closed right now. Schedule your order for later, or check back during our opening hours.');
    }

    if (!isOpen && orderMode === 'NOW') {
      return alert('MunchiesKK is closed right now. Schedule your order for later, or check back during our opening hours.');
    }

    const selectedSlot = timeSlots.find(s => s.value === scheduledTime) || timeSlots[0];
    const scheduledDisplayTime = selectedSlot ? selectedSlot.label : formatTime12Hour(scheduledTime);

    setIsProcessing(true);

    setTimeout(async () => {
      if (shopSettings?.status === 'PAUSED' || shopSettings?.status === 'CLOSED') {
        setIsProcessing(false);
        return alert('MunchiesKK is closed right now. Schedule your order for later, or check back during our opening hours.');
      }

      let paymentDetail = method === 'FPX' ? `FPX (${bank})` : method;
      if (orderMode === 'SCHEDULED') {
        paymentDetail += ` [Scheduled for ${scheduledDisplayTime}]`;
      }

      const orderId = await placeOrder(paymentDetail, orderMode === 'SCHEDULED' ? scheduledTime : null, appliedPromoCode, promoDiscount, promoFreeItemId, promoFreeItemName);

      if (!orderId) {
        setIsProcessing(false);
        return;
      }

      setIsSuccess(true);
      localStorage.setItem('munchies_active_order', orderId);

      setTimeout(() => {
        navigate(`/order/${orderId}`);
      }, 2000);
    }, 2000);
  };

  if (isSuccess) {
    return (
      <div className="container payment-page success-view">
        <CheckCircle2 size={64} className="text-success" />
        <h2>Payment Successful!</h2>
        <p className="text-muted">Routing you to the kitchen tracker...</p>
      </div>
    );
  }

  const openingFormatted = formatTime12Hour(shopSettings?.openingTime || '10:00');
  const closingFormatted = formatTime12Hour(shopSettings?.closingTime || '22:00');

  return (
    <div className="container payment-page">

      {/* Shop Status Banner when shop is Paused or Closed */}
      {!isOpen && (
        <div style={{
          background: 'rgba(255, 199, 44, .08)',
          border: '1px solid rgba(255, 199, 44, .35)',
          color: 'var(--text-2)',
          padding: '1rem',
          borderRadius: 'var(--r-card)',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <AlertTriangle size={28} color="var(--gold)" style={{ flexShrink: 0 }} />
          <div>
            <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800 }}>
              {shopSettings?.status === 'PAUSED' ? '⏸️ SHOP IS TEMPORARILY PAUSED' : '🔴 SHOP IS CURRENTLY CLOSED'}
            </h4>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
              Business Hours: <strong>{openingFormatted} - {closingFormatted}</strong>. Instant orders are paused, but you can choose <strong>Schedule for Later</strong>!
            </p>
          </div>
        </div>
      )}

      {/* Fulfillment Timing Card */}
      <div className="card mb-6 timing-card">
        <div className="timing-card__glow" />
        <h3 style={{ margin: '0 0 12px', fontSize: '0.7rem', letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 800, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
          <Clock size={16} /> Fulfillment Timing
        </h3>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', position: 'relative' }}>
          {/* Main Primary Option: ORDER NOW */}
          <button
            type="button"
            onClick={() => setOrderMode('NOW')}
            className={`timing-btn ${orderMode === 'NOW' ? 'timing-btn-active' : ''}`}
          >
            <Zap size={18} fill="currentColor" /> Now
          </button>

          {/* Secondary Option: Schedule for Later */}
          <button
            type="button"
            onClick={() => setOrderMode('SCHEDULED')}
            className={`timing-btn ${orderMode === 'SCHEDULED' ? 'timing-btn-active' : ''}`}
          >
            Schedule
          </button>
        </div>

        {orderMode === 'SCHEDULED' && (
          <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid rgba(255, 199, 44, .2)', position: 'relative' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-2)', marginBottom: '6px' }}>
              Select Pre-Order Pickup Time Slot (Operating Hours: {openingFormatted} - {closingFormatted}):
            </label>
            <select
              value={scheduledTime}
              onChange={e => setScheduledTime(e.target.value)}
              className="timing-select"
            >
              {timeSlots.map(slot => (
                <option key={slot.value} value={slot.value}>
                  {slot.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="payment-layout">
        <div className="payment-methods">
          <h2>Select Payment Method</h2>

          <div
            className={`method-card ${method === 'TNG' ? 'selected' : ''}`}
            onClick={() => setMethod('TNG')}
          >
            <CreditCard size={24} />
            <div className="method-info">
              <h3>Touch 'n Go eWallet</h3>
              <p>Pay instantly with your TNG app.</p>
            </div>
          </div>

          <div
            className={`method-card ${method === 'FPX' ? 'selected' : ''}`}
            onClick={() => setMethod('FPX')}
          >
            <Building2 size={24} />
            <div className="method-info">
              <h3>FPX Online Banking</h3>
              <p>Secure transfer from Malaysian banks.</p>
            </div>
          </div>

          {method === 'FPX' && (
            <div className="fpx-dropdown">
              <select className="price-input w-full" value={bank} onChange={e => setBank(e.target.value)}>
                <option value="">-- Select Bank --</option>
                <option value="Maybank2U">Maybank2U</option>
                <option value="CIMB Clicks">CIMB Clicks</option>
                <option value="Public Bank">Public Bank</option>
                <option value="RHB Now">RHB Now</option>
                <option value="AmBank">AmBank</option>
              </select>
            </div>
          )}

          <div
            className={`method-card ${method === 'QR' ? 'selected' : ''}`}
            onClick={() => setMethod('QR')}
          >
            <QrCode size={24} />
            <div className="method-info">
              <h3>DuitNow QR</h3>
              <p>Scan to pay with any supported app.</p>
            </div>
          </div>

          {method === 'QR' && (
            <div className="qr-display">
              <div className="qr-placeholder">
                <QrCode size={100} className="text-muted" />
                <p>Scan this code to pay RM {(finalTotal / 100).toFixed(2)}</p>
              </div>
            </div>
          )}
        </div>

        <div className="payment-summary">
          <h3>Order Summary</h3>
          <div className="summary-items">
            {cart.map(item => {
              const addonTotal = (item.selectedAddons || []).reduce((sum, a) => sum + (a.price || 0), 0);
              return (
                <div key={item.cartItemId} className="summary-item" style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <span>{item.quantity}x {item.name}</span>
                    <span>RM {(((item.price + addonTotal) * item.quantity) / 100).toFixed(2)}</span>
                  </div>
                  {item.selectedAddons && item.selectedAddons.length > 0 && (
                    <span className="text-muted text-sm" style={{ alignSelf: 'flex-start', marginLeft: '20px', color: 'var(--text-dim)' }}>
                      + {item.selectedAddons.map(a => a.name).join(', ')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: '1.5rem', marginBottom: '1.5rem', padding: '1rem', backgroundColor: 'var(--surface)', borderRadius: 'var(--r-card)', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <input
                type="text"
                placeholder="Promo Code"
                className="price-input"
                style={{ flex: 1, padding: '10px 12px' }}
                value={promoCodeInput}
                onChange={(e) => {
                  setPromoCodeInput(e.target.value.toUpperCase());
                  setPromoStatus({ state: 'idle', message: '' });
                }}
                disabled={promoStatus.state === 'checking'}
              />
              <button
                className="btn btn-secondary"
                style={{ padding: '0 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
                disabled={!promoCodeInput || promoStatus.state === 'checking' || promoStatus.state === 'valid'}
                onClick={async () => {
                  if (!promoCodeInput) return;
                  setPromoStatus({ state: 'checking', message: '' });
                  
                  const { data, error } = await supabase.rpc('validate_and_apply_promo', {
                    p_code: promoCodeInput,
                    p_order_total: cartTotal,
                    p_user_id: user?.id || null,
                    p_cart_items: cart
                  });
                  
                  if (error || !data) {
                    setPromoStatus({ state: 'invalid', message: error?.message || 'Error checking promo code.' });
                    setAppliedPromoCode(null);
                    setPromoDiscount(0);
                    setPromoFreeItemName(null);
                    setPromoFreeItemId(null);
                    return;
                  }

                  if (data.valid) {
                    setPromoStatus({ state: 'valid', message: data.message });
                    setAppliedPromoCode(promoCodeInput.trim().toUpperCase());
                    setPromoDiscount(data.discount_cents || 0);
                    setPromoFreeItemName(data.free_item_name || null);
                    setPromoFreeItemId(data.free_item_id || null);
                  } else {
                    setPromoStatus({ state: 'invalid', message: data.message });
                    setAppliedPromoCode(null);
                    setPromoDiscount(0);
                    setPromoFreeItemName(null);
                    setPromoFreeItemId(null);
                  }
                }}
              >
                {promoStatus.state === 'checking' ? <Loader2 size={16} className="spinner" /> : <Tag size={16} />}
                Apply
              </button>
            </div>
            {promoStatus.message && (
              <div style={{ fontSize: '0.85rem', marginTop: '4px', color: promoStatus.state === 'valid' ? 'var(--go)' : '#ff6b6b', fontWeight: 600 }}>
                {promoStatus.message}
              </div>
            )}

            {promoStatus.state === 'valid' && (
              <button
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.8rem', textDecoration: 'underline', cursor: 'pointer', marginTop: '4px', padding: 0 }}
                onClick={() => {
                  setPromoCodeInput('');
                  setAppliedPromoCode(null);
                  setPromoDiscount(0);
                  setPromoFreeItemName(null);
                  setPromoFreeItemId(null);
                  setPromoStatus({ state: 'idle', message: '' });
                }}
              >
                Remove Promo Code
              </button>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-2)', marginBottom: '8px' }}>
             <span>Subtotal</span>
             <span>RM {(cartTotal / 100).toFixed(2)}</span>
          </div>

          {promoDiscount > 0 && (
             <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--go)', fontWeight: 600, marginBottom: '8px' }}>
                <span>Discount ({appliedPromoCode})</span>
                <span>-RM {(promoDiscount / 100).toFixed(2)}</span>
             </div>
          )}

          {promoFreeItemName && (
             <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--go)', fontWeight: 600, marginBottom: '8px' }}>
                <span>Free Item ({appliedPromoCode})</span>
                <span>{promoFreeItemName}</span>
             </div>
          )}

          <div className="summary-total" style={{ borderTop: '1px solid var(--line)', paddingTop: '12px', marginTop: '4px' }}>
            <span>Total to Pay</span>
            <span className="text-primary">RM {(finalTotal / 100).toFixed(2)}</span>
          </div>

          <button
            className="btn btn-primary w-full pay-btn"
            disabled={isProcessing}
            onClick={handlePayment}
          >
            {isProcessing ? (
              <><Loader2 className="spinner" size={20} /> Processing...</>
            ) : orderMode === 'SCHEDULED' ? (
              `Confirm Scheduled Pre-Order (RM ${(finalTotal / 100).toFixed(2)})`
            ) : (
              `Pay RM ${(finalTotal / 100).toFixed(2)}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
