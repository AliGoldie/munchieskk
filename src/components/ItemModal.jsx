import { useState } from 'react';
import { Gift, Plus, Minus } from 'lucide-react';
import { getItemPoints } from '../utils/pointsCalculator';
import { useStore } from '../contexts/StoreContext';
import Modal from './Modal';
import './ItemModal.css';

export default function ItemModal({ item, onClose, editMode = false, initialCartItem = null, onSave = null }) {
  const [selectedAddonIds, setSelectedAddonIds] = useState(initialCartItem ? (initialCartItem.selectedAddons || []).map(a => a.id) : []);
  const [quantity, setQuantity] = useState(1);
  const { addToCart, addons, itemAddons, isPromoActive } = useStore();

  if (!item) return null;

  // Find which addons are available for this item
  const availableAddonIds = itemAddons[item?.id] || [];
  const availableAddons = addons.filter(a => availableAddonIds.includes(a.id));

  const pointsEarned = getItemPoints(item);

  const toggleAddon = (addonId) => {
    setSelectedAddonIds(prev =>
      prev.includes(addonId) ? prev.filter(id => id !== addonId) : [...prev, addonId]
    );
  };

  const addonTotalCents = selectedAddonIds.reduce((total, id) => {
    const addon = addons.find(a => a.id === id);
    return total + (addon?.price || 0);
  }, 0);

  const basePrice = isPromoActive(item) ? item.promo_price : item.price;
  const unitPrice = basePrice + addonTotalCents;
  const totalPrice = unitPrice * quantity;

  const handleAddToCart = () => {
    if (editMode && onSave) {
      const selected = addons.filter(a => selectedAddonIds.includes(a.id));
      onSave(selected);
    } else {
      const selected = addons.filter(a => selectedAddonIds.includes(a.id));
      for (let i = 0; i < quantity; i++) {
        addToCart(item, selected);
      }
    }
    onClose();
  };

  const extendedDescription = `${item.description} This signature item is prepared fresh daily using only the highest quality ingredients to ensure maximum flavor in every bite.`;

  return (
    <Modal onClose={onClose} className="item-modal-content" ariaLabel={`Customize ${item.name}`}>
      <div className="modal-image-container" style={{ backgroundImage: `url('${item.image}')` }}></div>
      <div className="modal-body">
        {/* Base Price Row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 900, margin: 0, color: '#1e293b', lineHeight: '1.2' }}>
            {item.name}
          </h2>
          <div style={{ textAlign: 'right' }}>
            {isPromoActive(item) ? (
              <>
                <div className="text-muted" style={{ textDecoration: 'line-through', fontSize: '0.9rem', fontWeight: 600 }}>RM {(item.price / 100).toFixed(2)}</div>
                <div className="text-danger font-black" style={{ fontSize: '1.25rem' }}>RM {(item.promo_price / 100).toFixed(2)}</div>
              </>
            ) : (
              <div className="text-success font-black" style={{ fontSize: '1.25rem' }}>RM {(item.price / 100).toFixed(2)}</div>
            )}
          </div>
        </div>
        <p className="modal-description">{extendedDescription}</p>
        
        <div className="modal-points-banner">
          <Gift size={20} className="text-primary" />
          <span>Points you'll earn: <strong>{pointsEarned}</strong></span>
        </div>

        {/* Add-ons Section */}
        {availableAddons.length > 0 && (
          <div className="modal-addons-section">
            <h3 className="modal-addons-title">🎨 Customize Your Order</h3>
            <div className="modal-addons-list">
              {availableAddons.map(addon => {
                const isOutOfStock = addon.stock_quantity !== undefined && addon.stock_quantity <= 0;
                return (
                  <label 
                    key={addon.id} 
                    className={`modal-addon-item ${selectedAddonIds.includes(addon.id) ? 'selected' : ''} ${isOutOfStock ? 'disabled' : ''}`}
                    style={isOutOfStock ? { opacity: 0.45, cursor: 'not-allowed', background: '#f8fafc' } : {}}
                  >
                    <div className="modal-addon-info">
                      {addon.image && (
                        <img src={addon.image} alt={addon.name} className="modal-addon-img" style={isOutOfStock ? { filter: 'grayscale(1)' } : {}} />
                      )}
                      <div>
                        <span className="modal-addon-name" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {addon.name}
                          {isOutOfStock && <span style={{ color: '#ef4444', fontSize: '0.75rem', fontWeight: 'bold' }}>(Sold Out)</span>}
                        </span>
                        <span className="modal-addon-price">
                          {addon.price === null ? 'TBD' : `+ RM ${(addon.price / 100).toFixed(2)}`}
                        </span>
                      </div>
                    </div>
                    <input 
                      type="checkbox" 
                      disabled={isOutOfStock}
                      checked={!isOutOfStock && selectedAddonIds.includes(addon.id)}
                      onChange={() => !isOutOfStock && toggleAddon(addon.id)}
                      className="modal-addon-checkbox"
                    />
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Quantity Selector */}
        {!editMode && (
          <div className="modal-qty-row">
            <span className="modal-qty-label">Quantity</span>
            <div className="modal-qty-controls">
              <button 
                className="modal-qty-btn" 
                onClick={() => setQuantity(q => Math.max(1, q - 1))}
                disabled={quantity <= 1}
              >
                <Minus size={16} />
              </button>
              <span className="modal-qty-value">{quantity}</span>
              <button 
                className="modal-qty-btn" 
                onClick={() => setQuantity(q => q + 1)}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        )}

        <button 
          className="btn btn-primary w-full modal-add-btn"
          disabled={!item.inStock}
          onClick={handleAddToCart}
        >
          {editMode ? 'Save Changes' : (item.inStock ? `Add to Cart • RM ${(totalPrice / 100).toFixed(2)}` : 'Sold Out')}
        </button>
      </div>
    </Modal>
  );
}
