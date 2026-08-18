import { useState } from 'react';
import { useStore } from '../contexts/StoreContext';
import Modal from './Modal';
import './AddonModal.css';

export default function AddonModal({ item, onClose }) {
  const { addons, itemAddons, addToCart, isPromoActive } = useStore();
  const [selectedAddonIds, setSelectedAddonIds] = useState([]);

  // Find which addons are available for this item
  const availableAddonIds = itemAddons[item.id] || [];
  const availableAddons = addons.filter(a => availableAddonIds.includes(a.id));

  const toggleAddon = (addonId) => {
    setSelectedAddonIds(prev => 
      prev.includes(addonId) ? prev.filter(id => id !== addonId) : [...prev, addonId]
    );
  };

  const handleConfirm = () => {
    const selected = addons.filter(a => selectedAddonIds.includes(a.id));
    addToCart(item, selected);
    onClose();
  };

  const addonTotalCents = selectedAddonIds.reduce((total, id) => {
    const addon = addons.find(a => a.id === id);
    return total + (addon?.price || 0);
  }, 0);

  const basePrice = isPromoActive(item) ? item.promo_price : item.price;
  const totalPriceCents = basePrice + addonTotalCents;

  return (
    <Modal onClose={onClose} className="addon-modal-content" ariaLabel={`Customize ${item.name}`}>
      <div className="addon-modal-header">
        <h2>Customize {item.name}</h2>
        <p className="text-muted text-sm mt-1">Make it exactly how you want it.</p>
      </div>

      <div className="addon-options-list">
        {availableAddons.length === 0 ? (
          <p className="text-muted p-4 text-center">No customizations available.</p>
        ) : (
          availableAddons.map(addon => {
            const isOutOfStock = addon.stock_quantity !== undefined && addon.stock_quantity <= 0;
            return (
              <label key={addon.id} className="addon-option" style={isOutOfStock ? { opacity: 0.45, cursor: 'not-allowed' } : {}}>
                <div className="addon-option-info">
                  <span className="addon-name" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {addon.name}
                    {isOutOfStock && <span style={{ color: '#ef4444', fontSize: '0.75rem', fontWeight: 'bold' }}>(Sold Out)</span>}
                  </span>
                  <span className="addon-price">
                    {addon.price === null ? 'TBD' : `+ RM ${(addon.price / 100).toFixed(2)}`}
                  </span>
                </div>
                <input 
                  type="checkbox" 
                  disabled={isOutOfStock}
                  checked={!isOutOfStock && selectedAddonIds.includes(addon.id)}
                  onChange={() => !isOutOfStock && toggleAddon(addon.id)}
                  className="addon-checkbox"
                />
              </label>
            );
          })
        )}
      </div>

      <div className="addon-modal-footer">
        <button className="btn btn-primary w-full" onClick={handleConfirm}>
          Add to Bag (RM {(totalPriceCents / 100).toFixed(2)})
        </button>
      </div>
    </Modal>
  );
}
