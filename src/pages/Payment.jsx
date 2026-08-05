import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import { formatTime12Hour, generateOperatingTimeSlots } from '../utils/timeUtils';
import { CreditCard, QrCode, Building2, CheckCircle2, Loader2, Clock, AlertTriangle, Zap } from 'lucide-react';
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
      return alert('The shop is currently PAUSED by the store admin. Orders cannot be placed at this time.');
    }

    if (shopSettings?.status === 'CLOSED') {
      return alert('The shop is currently CLOSED. Orders cannot be placed at this time.');
    }

    if (!isOpen && orderMode === 'NOW') {
      return alert('The shop is currently closed or paused for instant orders. Please select "Schedule for Later"!');
    }

    const selectedSlot = timeSlots.find(s => s.value === scheduledTime) || timeSlots[0];
    const scheduledDisplayTime = selectedSlot ? selectedSlot.label : formatTime12Hour(scheduledTime);

    setIsProcessing(true);

    setTimeout(async () => {
      if (shopSettings?.status === 'PAUSED' || shopSettings?.status === 'CLOSED') {
        setIsProcessing(false);
        return alert('The shop status changed to PAUSED/CLOSED. Order could not be placed.');
      }

      let paymentDetail = method === 'FPX' ? `FPX (${bank})` : method;
      if (orderMode === 'SCHEDULED') {
        paymentDetail += ` [Scheduled for ${scheduledDisplayTime}]`;
      }

      const orderId = await placeOrder(paymentDetail, orderMode === 'SCHEDULED' ? scheduledTime : null);

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
          background: '#451a03',
          border: '2px solid #f59e0b',
          color: '#fef3c7',
          padding: '1rem',
          borderRadius: '12px',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <AlertTriangle size={28} color="#f59e0b" style={{ flexShrink: 0 }} />
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
      <div className="card mb-6" style={{
        background: '#1e293b',
        color: '#fff',
        padding: '1.25rem',
        borderRadius: '16px',
        border: '2px solid rgba(255, 199, 44, 0.4)',
        marginBottom: '1.5rem',
        boxShadow: '0 8px 20px rgba(0,0,0,0.3)'
      }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '1.1rem', color: '#FFC72C', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Clock size={20} /> FULFILLMENT TIMING
        </h3>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {/* Main Primary Option: ORDER NOW */}
          <button
            type="button"
            onClick={() => setOrderMode('NOW')}
            style={{
              flex: 1.2, minWidth: '160px', padding: '14px 18px', borderRadius: '10px',
              border: orderMode === 'NOW' ? '3px solid #FFC72C' : '1px solid #475569',
              background: orderMode === 'NOW' ? '#E8491D' : '#0f172a',
              color: '#fff', fontWeight: '800', cursor: 'pointer', fontSize: '1rem',
              boxShadow: orderMode === 'NOW' ? '0 4px 15px rgba(232, 73, 29, 0.45)' : 'none',
              transition: 'all 0.2s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
            }}
          >
            <Zap size={18} fill="#ffffff" /> ORDER NOW (ASAP)
          </button>

          {/* Secondary Option: Schedule for Later */}
          <button
            type="button"
            onClick={() => setOrderMode('SCHEDULED')}
            style={{
              flex: 1, minWidth: '140px', padding: '14px 18px', borderRadius: '10px',
              border: orderMode === 'SCHEDULED' ? '3px solid #FFC72C' : '1px solid #475569',
              background: orderMode === 'SCHEDULED' ? '#0284c7' : '#0f172a',
              color: '#fff', fontWeight: '800', cursor: 'pointer', fontSize: '0.95rem',
              boxShadow: orderMode === 'SCHEDULED' ? '0 4px 15px rgba(2, 132, 199, 0.45)' : 'none',
              transition: 'all 0.2s ease'
            }}
          >
            📅 Schedule for Later
          </button>
        </div>

        {orderMode === 'SCHEDULED' && (
          <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>
              Select Pre-Order Pickup/Delivery Time Slot (Operating Hours: {openingFormatted} - {closingFormatted}):
            </label>
            <select
              value={scheduledTime}
              onChange={e => setScheduledTime(e.target.value)}
              style={{
                width: '100%', padding: '12px', borderRadius: '8px', border: '1.5px solid #38bdf8',
                background: '#0f172a', color: '#fff', fontWeight: 'bold', fontSize: '0.95rem'
              }}
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
                <p>Scan this code to pay RM {(cartTotal / 100).toFixed(2)}</p>
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
                    <span className="text-muted text-sm" style={{ alignSelf: 'flex-start', marginLeft: '20px' }}>
                      + {item.selectedAddons.map(a => a.name).join(', ')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="summary-total">
            <span>Total to Pay</span>
            <span className="text-primary">RM {(cartTotal / 100).toFixed(2)}</span>
          </div>

          <button
            className="btn btn-primary w-full pay-btn"
            disabled={isProcessing}
            onClick={handlePayment}
          >
            {isProcessing ? (
              <><Loader2 className="spinner" size={20} /> Processing...</>
            ) : orderMode === 'SCHEDULED' ? (
              `Confirm Scheduled Pre-Order (RM ${(cartTotal / 100).toFixed(2)})`
            ) : (
              `Pay RM ${(cartTotal / 100).toFixed(2)}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
