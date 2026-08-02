import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import { siteConfig } from '../config/siteConfig';
import './Profile.css';

export default function Profile() {
  const { points, orders } = useStore();
  const [promoCode, setPromoCode] = useState('');
  const navigate = useNavigate();

  const handleLogout = () => {
    // Perform any logout logic here (e.g. clearing auth state)
    navigate('/login');
  };

  // Mocked user data for Phase 1 MVP
  const user = {
    name: 'Jane Doe',
    phone: '+60 12-345 6789',
    address: '123 Jalan Penampang, Sabah',
    memberSince: 'August 2025'
  };

  const applyPromo = () => {
    if (promoCode) {
      alert(`Promo code ${promoCode} applied! (Simulation)`);
      setPromoCode('');
    }
  };

  return (
    <div className="container profile-page">
      <h1>My Profile</h1>
      
      <div className="profile-grid">
        <div className="profile-card">
          <h3>Personal Info</h3>
          <div className="info-group">
            <span className="label">Name</span>
            <span>{user.name}</span>
          </div>
          <div className="info-group">
            <span className="label">Phone</span>
            <span>{user.phone}</span>
          </div>
          <div className="info-group">
            <span className="label">Address</span>
            <span>{user.address}</span>
          </div>
          
          <div className="loyalty-teaser">
            <h4>MunchiesKK Rewards</h4>
            <p className="points-display mb-2" style={{fontSize: '2rem'}}><span className="text-primary">{points}</span> pts</p>
            <a href="/loyalty" className="btn btn-primary w-full">View Prize Vault</a>
          </div>

          <div className="promo-section" style={{marginTop: '2rem'}}>
            <h3>Promo Codes</h3>
            <div className="referral-box" style={{marginTop: '0.5rem'}}>
              <input 
                type="text" 
                placeholder="Enter code" 
                className="price-input" 
                style={{flex: 1, padding: '0.5rem'}}
                value={promoCode}
                onChange={e => setPromoCode(e.target.value)}
              />
              <button className="btn btn-secondary" onClick={applyPromo}>Apply</button>
            </div>
          </div>
          
          <button 
            className="btn btn-dark w-full" 
            style={{ marginTop: '2rem', backgroundColor: 'var(--danger-color)', color: 'white' }}
            onClick={handleLogout}
          >
            LOGOUT
          </button>
          
          <a 
            href={`https://wa.me/${siteConfig.whatsappNumber}?text=${encodeURIComponent(siteConfig.whatsappGreeting)}`}
            target="_blank" rel="noopener noreferrer"
            className="btn w-full"
            style={{ backgroundColor: '#25d366', color: 'white', marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          >
            💬 Support via WhatsApp
          </a>
        </div>

        <div className="profile-card">
          <h3>Order History</h3>
          {orders.length > 0 ? (
            <div className="order-list">
              {orders.map(order => (
                <div key={order.id} className="order-item">
                  <div className="order-header">
                    <span className="order-id">{order.id}</span>
                    <span className="order-date">{new Date(order.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="order-total">
                    RM {(order.total / 100).toFixed(2)} - <span className="text-primary">{order.status}</span>
                    {order.paymentMethod && <div className="text-muted" style={{fontSize: '0.85rem', marginTop: '0.25rem'}}>Paid via: {order.paymentMethod}</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted">No past orders found.</p>
          )}
        </div>
      </div>
    </div>
  );
}
