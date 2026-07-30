import { useState } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';
import './AddonModal.css';

export default function AddonModal({ item, onClose }) {
  const { addons, itemAddons, addToCart } = useStore();
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

  const totalPriceCents = item.price + addonTotalCents;

  return (
    <div className="addon-modal-overlay" onClick={onClose}>
      <div className="addon-modal-content" onClick={e => e.stopPropagation()}>
        <button className="addon-modal-close" onClick={onClose}><X size={24} /></button>
        
        <div className="addon-modal-header">
          <h2>Customize {item.name}</h2>
          <p className="text-muted text-sm mt-1">Make it exactly how you want it.</p>
        </div>

        <div className="addon-options-list">
          {availableAddons.length === 0 ? (
            <p className="text-muted p-4 text-center">No customizations available.</p>
          ) : (
            availableAddons.map(addon => (
              <label key={addon.id} className="addon-option">
                <div className="addon-option-info">
                  <span className="addon-name">{addon.name}</span>
                  <span className="addon-price">
                    {addon.price === null ? 'TBD' : `+ RM ${(addon.price / 100).toFixed(2)}`}
                  </span>
                </div>
                <input 
                  type="checkbox" 
                  checked={selectedAddonIds.includes(addon.id)}
                  onChange={() => toggleAddon(addon.id)}
                  className="addon-checkbox"
                />
              </label>
            ))
          )}
        </div>

        <div className="addon-modal-footer">
          <button className="btn btn-primary w-full" onClick={handleConfirm}>
            Add to Bag (RM {(totalPriceCents / 100).toFixed(2)})
          </button>
        </div>
      </div>
    </div>
  );
}
