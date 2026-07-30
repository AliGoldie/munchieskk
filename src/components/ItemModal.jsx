import { useEffect, useState } from 'react';
import { X, Gift, Plus, Minus } from 'lucide-react';
import { getPointsForItem } from '../config/loyaltyConfig';
import { useStore } from '../contexts/StoreContext';
import './ItemModal.css';

export default function ItemModal({ item, onClose }) {
  const [isClosing, setIsClosing] = useState(false);
  const [selectedAddonIds, setSelectedAddonIds] = useState([]);
  const [quantity, setQuantity] = useState(1);
  const { addToCart, addons, itemAddons } = useStore();

  // Find which addons are available for this item
  const availableAddonIds = itemAddons[item?.id] || [];
  const availableAddons = addons.filter(a => availableAddonIds.includes(a.id));

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 250);
  };

  if (!item) return null;

  const pointsEarned = getPointsForItem(item.category);

  const toggleAddon = (addonId) => {
    setSelectedAddonIds(prev =>
      prev.includes(addonId) ? prev.filter(id => id !== addonId) : [...prev, addonId]
    );
  };

  const addonTotalCents = selectedAddonIds.reduce((total, id) => {
    const addon = addons.find(a => a.id === id);
    return total + (addon?.price || 0);
  }, 0);

  const unitPrice = item.price + addonTotalCents;
  const totalPrice = unitPrice * quantity;

  const handleAddToCart = () => {
    const selected = addons.filter(a => selectedAddonIds.includes(a.id));
    for (let i = 0; i < quantity; i++) {
      addToCart(item, selected);
    }
    handleClose();
  };

  const extendedDescription = `${item.description} This signature item is prepared fresh daily using only the highest quality ingredients to ensure maximum flavor in every bite.`;

  return (
    <div className={`modal-backdrop ${isClosing ? 'closing' : ''}`} onClick={handleClose}>
      <div 
        className={`modal-content ${isClosing ? 'closing' : ''}`} 
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close-btn" onClick={handleClose}>
          <X size={24} />
        </button>
        
        <div className="modal-image-container" style={{ backgroundImage: `url('${item.image}')` }}></div>
        
        <div className="modal-body">
          <div className="modal-header">
            <h2>{item.name}</h2>
            <span className="modal-price">RM {(item.price / 100).toFixed(2)}</span>
          </div>
          
          <p className="modal-description">{extendedDescription}</p>
          
          <div className="modal-points-banner">
            <Gift size={20} className="text-primary" />
            <span>Points you'll earn: <strong>{pointsEarned}</strong></span>
          </div>

          {/* Add-ons Section */}
          {availableAddons.length > 0 && (
            <div className="modal-addons-section">
              <h3 className="modal-addons-title">🔥 Customize Your Order</h3>
              <div className="modal-addons-list">
                {availableAddons.map(addon => (
                  <label key={addon.id} className={`modal-addon-item ${selectedAddonIds.includes(addon.id) ? 'selected' : ''}`}>
                    <div className="modal-addon-info">
                      {addon.image && (
                        <img src={addon.image} alt={addon.name} className="modal-addon-img" />
                      )}
                      <div>
                        <span className="modal-addon-name">{addon.name}</span>
                        <span className="modal-addon-price">
                          {addon.price === null ? 'TBD' : `+ RM ${(addon.price / 100).toFixed(2)}`}
                        </span>
                      </div>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={selectedAddonIds.includes(addon.id)}
                      onChange={() => toggleAddon(addon.id)}
                      className="modal-addon-checkbox"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Quantity Selector */}
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

          <button 
            className="btn btn-primary w-full modal-add-btn"
            disabled={!item.inStock}
            onClick={handleAddToCart}
          >
            {item.inStock ? `Add to Cart — RM ${(totalPrice / 100).toFixed(2)}` : 'Sold Out'}
          </button>
        </div>
      </div>
    </div>
  );
}
