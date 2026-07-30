import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import { Trash2, Plus, Sparkles, ChevronRight } from 'lucide-react';
import './Cart.css';

export default function Cart() {
  const { cart, cartTotal, removeFromCart, updateQuantity, addToCart, menu, itemAddons } = useStore();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [addedIds, setAddedIds] = useState({});

  // Smart suggestions: prioritise DRINKS then SIDES, exclude already-in-cart items
  const cartItemIds = cart.map(i => i.id);
  const suggestions = menu
    .filter(item => item.inStock && !cartItemIds.includes(item.id))
    .sort((a, b) => {
      const order = { DRINKS: 0, SIDES: 1 };
      return (order[a.category] ?? 9) - (order[b.category] ?? 9);
    })
    .slice(0, 4);

  const handleQuickAdd = (item) => {
    addToCart(item);
    setAddedIds(prev => ({ ...prev, [item.id]: true }));
    setTimeout(() => setAddedIds(prev => ({ ...prev, [item.id]: false })), 1200);
  };

  if (cart.length === 0) {
    return (
      <div className="container cart-empty">
        <div className="cart-empty-icon">🛍️</div>
        <h2>Your Cart is Empty</h2>
        <p className="text-muted">Looks like you haven't added anything yet.</p>
        <a href="/menu" className="btn btn-primary" style={{ marginTop: '1rem' }}>Browse Menu</a>
      </div>
    );
  }

  return (
    <div className="container cart-page">
      <h1>Your Order</h1>

      <div className="cart-content">
        <div className="cart-items-col">
          {/* Cart Items */}
          <div className="cart-items">
            {cart.map(item => (
              <div key={item.cartItemId} className="cart-item">
                <div className="cart-item-details">
                  <h3>{item.name}</h3>
                  {item.selectedAddons && item.selectedAddons.length > 0 && (
                    <p className="text-sm text-muted mt-1 mb-1">
                      + {item.selectedAddons.map(a => a.name).join(', ')}
                    </p>
                  )}
                  <span className="cart-item-price">
                    RM {((item.price + (item.selectedAddons || []).reduce((sum, a) => sum + (a.price || 0), 0)) / 100).toFixed(2)}
                  </span>
                </div>
                <div className="cart-item-actions">
                  <div className="quantity-controls">
                    <button className="btn-qty" onClick={() => updateQuantity(item.cartItemId, item.quantity - 1)}>-</button>
                    <span className="qty">{item.quantity}</span>
                    <button className="btn-qty" onClick={() => updateQuantity(item.cartItemId, item.quantity + 1)}>+</button>
                  </div>
                  <button className="btn-remove" onClick={() => removeFromCart(item.cartItemId)}>
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* ── SUGGESTED SECTION ── */}
          {suggestions.length > 0 && (
            <div className="suggestions-section">
              <div className="suggestions-header">
                <Sparkles size={18} className="suggestions-icon" />
                <span>Make It a Meal</span>
                <a href="/menu" className="suggestions-see-all">
                  See all <ChevronRight size={14} />
                </a>
              </div>
              <p className="suggestions-sub">Customers also added these 🔥</p>

              <div className="suggestions-grid">
                {suggestions.map(item => (
                  <div key={item.id} className="suggestion-card">
                    <div
                      className="suggestion-img"
                      style={{ backgroundImage: `url('${item.image}')` }}
                    >
                      <span className="suggestion-cat-badge">{item.category}</span>
                    </div>
                    <div className="suggestion-info">
                      <p className="suggestion-name">{item.name}</p>
                      <div className="suggestion-bottom">
                        <span className="suggestion-price">RM {(item.price / 100).toFixed(2)}</span>
                        <button
                          className={`suggestion-add-btn ${addedIds[item.id] ? 'suggestion-add-btn--added' : ''}`}
                          onClick={() => handleQuickAdd(item)}
                        >
                          {addedIds[item.id] ? '✓' : <Plus size={16} />}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Order Summary */}
        <div className="cart-summary">
          <h3>Order Summary</h3>
          <div className="summary-row">
            <span>Subtotal</span>
            <span>RM {(cartTotal / 100).toFixed(2)}</span>
          </div>
          <div className="summary-row text-muted">
            <span>SST (6%)</span>
            <span>RM {((cartTotal / 100) * 0.06).toFixed(2)}</span>
          </div>
          <div className="summary-row total-row font-black">
            <span>Total</span>
            <span className="text-primary">RM {((cartTotal / 100) * 1.06).toFixed(2)}</span>
          </div>

          <div className="checkout-instructions">
            <h4>Ready to checkout?</h4>
            <p>Proceed to payment to select your preferred method (TNG, FPX, or QR) and complete your order.</p>
          </div>

          <button 
            className="btn btn-primary w-full checkout-btn" 
            onClick={() => {
              if (!user) {
                navigate('/login');
              } else {
                navigate('/payment');
              }
            }}
          >
            {user ? 'Proceed to Payment' : 'Log in to Checkout'}
          </button>
        </div>
      </div>
    </div>
  );
}
