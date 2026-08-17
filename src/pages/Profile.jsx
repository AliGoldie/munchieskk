import { useState, useEffect } from 'react';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import { siteConfig } from '../config/siteConfig';
import './Profile.css';

export default function Profile() {
  const { points, orders } = useStore();
  const { user, setUser, logout } = useAuth();
  const [isSaving, setIsSaving] = useState(false);

  const [userProfile, setUserProfile] = useState({
    name: '',
    phone: '',
    address: '',
    email: '',
    memberSince: ''
  });
  
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (user) {
      setUserProfile({
        name: user.name || '',
        phone: user.phone || '',
        address: user.address || '',
        email: user.email || '',
        memberSince: user.created_at
          ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
          : 'Member'
      });
    }
  }, [user]);

  const handleProfileChange = (e) => {
    setUserProfile({ ...userProfile, [e.target.name]: e.target.value });
  };

  const handleSaveToggle = async () => {
    if (isEditing) {
      if (!user?.id) {
        setIsEditing(false);
        return;
      }
      setIsSaving(true);
      try {
        // 1. Update Auth user metadata as reliable fallback
        await supabase.auth.updateUser({
          data: {
            name: userProfile.name,
            phone: userProfile.phone,
            address: userProfile.address
          }
        });

        // 2. Try updating profiles table
        const updatePayload = { name: userProfile.name };
        if (userProfile.phone !== undefined) updatePayload.phone = userProfile.phone;
        if (userProfile.address !== undefined) updatePayload.address = userProfile.address;

        const { error } = await supabase
          .from('profiles')
          .update(updatePayload)
          .eq('id', user.id);

        if (error) {
          console.warn('Profiles table update warning (if columns missing):', error.message);
          // Try fallback without address if address column missing
          if (error.message.includes('address')) {
            delete updatePayload.address;
            await supabase.from('profiles').update(updatePayload).eq('id', user.id);
          }
        }

        setUser(prev => ({
          ...prev,
          name: userProfile.name,
          phone: userProfile.phone,
          address: userProfile.address
        }));

        alert('Profile updated successfully!');
      } catch (err) {
        console.error('Error updating profile:', err);
        alert("We couldn't complete that right now. Please try again, or contact us via WhatsApp.");
      } finally {
        setIsSaving(false);
        setIsEditing(false);
      }
    } else {
      setIsEditing(true);
    }
  };


  return (
    <div className="container profile-page">
      <h1>My Profile</h1>
      
      <div className="profile-grid">
        <div className="profile-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Personal Info</h3>
            <button 
              className={`btn ${isEditing ? 'btn-primary' : 'btn-outline'}`} 
              style={{ padding: '4px 12px', fontSize: '0.8rem' }}
              onClick={handleSaveToggle}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : isEditing ? 'Save' : 'Edit'}
            </button>
          </div>

          <div className="info-group" style={{ marginTop: '1rem' }}>
            <span className="label">Full Name</span>
            {isEditing ? (
              <input 
                type="text" 
                name="name" 
                className="price-input" 
                value={userProfile.name} 
                onChange={handleProfileChange} 
                style={{ flex: 1, marginLeft: '1rem', padding: '4px 8px' }} 
              />
            ) : (
              <span>{userProfile.name || 'Not set'}</span>
            )}
          </div>

          <div className="info-group">
            <span className="label">Email</span>
            <span>{userProfile.email || 'Not logged in'}</span>
          </div>

          <div className="info-group">
            <span className="label">Phone</span>
            {isEditing ? (
              <input 
                type="tel" 
                name="phone" 
                className="price-input" 
                value={userProfile.phone} 
                onChange={handleProfileChange} 
                style={{ flex: 1, marginLeft: '1rem', padding: '4px 8px' }} 
              />
            ) : (
              <span>{userProfile.phone || 'Not set'}</span>
            )}
          </div>

          <div className="info-group">
            <span className="label">Address</span>
            {isEditing ? (
              <input 
                type="text" 
                name="address" 
                className="price-input" 
                value={userProfile.address} 
                onChange={handleProfileChange} 
                style={{ flex: 1, marginLeft: '1rem', padding: '4px 8px' }} 
              />
            ) : (
              <span>{userProfile.address || 'Not set'}</span>
            )}
          </div>
          
          <div className="loyalty-teaser">
            <h4>MunchiesKK Rewards</h4>
            <p className="points-display mb-2" style={{fontSize: '2rem'}}><span className="text-primary">{points}</span> pts</p>
            <a href="/loyalty" className="btn btn-primary w-full">View Prize Vault</a>
          </div>

          <div className="promo-section" style={{marginTop: '2rem'}}>
            <h3>Share Referral Link</h3>
            <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '8px' }}>Invite friends and get rewarded when they order!</p>
            <div className="referral-box" style={{marginTop: '0.5rem', display: 'flex', gap: '8px'}}>
              <input 
                type="text" 
                readOnly
                className="price-input" 
                style={{flex: 1, padding: '0.5rem', backgroundColor: '#f8fafc', color: '#64748b'}}
                value={`${window.location.origin}/signup?ref=${user?.id || ''}`}
              />
              <button 
                className="btn btn-secondary" 
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/signup?ref=${user?.id || ''}`);
                  alert('Referral link copied to clipboard!');
                }}
              >
                Copy
              </button>
            </div>
          </div>
          
          <button 
            className="btn btn-dark w-full" 
            style={{ marginTop: '2rem', backgroundColor: 'var(--danger-color)', color: 'white' }}
            onClick={logout}
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
            <p className="text-muted">No past orders yet -- your past orders will appear here once you place an order.</p>
          )}
        </div>
      </div>
    </div>
  );
}
