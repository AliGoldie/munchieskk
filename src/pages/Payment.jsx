import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import { CreditCard, QrCode, Building2, CheckCircle2, Loader2 } from 'lucide-react';
import './Payment.css';

export default function Payment() {
  const { cart, cartTotal, placeOrder } = useStore();
  const navigate = useNavigate();
  const [method, setMethod] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [bank, setBank] = useState('');

  if (cart.length === 0 && !isSuccess) {
    navigate('/cart');
    return null;
  }

  const handlePayment = async () => {
    if (!method) return alert('Please select a payment method.');
    if (method === 'FPX' && !bank) return alert('Please select a bank.');

    setIsProcessing(true);
    
    // Simulate payment gateway delay
    setTimeout(async () => {
      setIsProcessing(false);
      setIsSuccess(true);
      
      const paymentDetail = method === 'FPX' ? `FPX (${bank})` : method;
      const orderId = await placeOrder(paymentDetail);
      
      // Save to localStorage so the global CookingPopup can pick it up
      if (orderId) localStorage.setItem('munchies_active_order', orderId);
      
      setTimeout(() => {
        navigate(`/order/${orderId}`);
      }, 2000);
    }, 2500);
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

  return (
    <div className="container payment-page">
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
                <div key={item.cartItemId} className="summary-item" style={{display: 'flex', flexDirection: 'column'}}>
                  <div style={{display: 'flex', justifyContent: 'space-between', width: '100%'}}>
                    <span>{item.quantity}x {item.name}</span>
                    <span>RM {(((item.price + addonTotal) * item.quantity) / 100).toFixed(2)}</span>
                  </div>
                  {item.selectedAddons && item.selectedAddons.length > 0 && (
                    <span className="text-muted text-sm" style={{alignSelf: 'flex-start', marginLeft: '20px'}}>
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
            disabled={!method || isProcessing}
            onClick={handlePayment}
          >
            {isProcessing ? (
              <><Loader2 className="spinner" size={20} /> Processing...</>
            ) : (
              `Pay RM ${(cartTotal / 100).toFixed(2)}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
