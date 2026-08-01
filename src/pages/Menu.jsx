import { useState, useEffect, useMemo } from 'react';
import { Plus, Flame, Award } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';
import ItemModal from '../components/ItemModal';
import './Menu.css';

// Category color config — each category gets a unique color identity
const CATEGORY_COLORS = {
  BBQ:      { bg: '#FFF0E6', tint: '#FFDDC1', text: '#9C3D00', accent: '#E8650A', icon: '🔥' },
  PREMIUM:  { bg: '#FBE9FF', tint: '#F0CCFA', text: '#6B1D87', accent: '#9B30C9', icon: '👑' },
  PLATTERS: { bg: '#FFF5E0', tint: '#FFE6B0', text: '#8B6914', accent: '#D4A017', icon: '🍽️' },
  SIDES:    { bg: '#E6FFF0', tint: '#B8F0D0', text: '#0E6930', accent: '#1DAA54', icon: '🥗' },
  DRINKS:   { bg: '#E6F0FF', tint: '#BDD8FF', text: '#1A4C8B', accent: '#2E7DD6', icon: '🥤' },
};

const DEFAULT_COLOR = { bg: '#F5F5F5', tint: '#E0E0E0', text: '#333', accent: '#666', icon: '📦' };

export default function Menu() {
  const { menu, addToCart, isPromoActive } = useStore();

  const PromoCountdown = ({ promoEnd }) => {
    const [timeLeft, setTimeLeft] = useState('');

    useEffect(() => {
      if (!promoEnd) return;
      const update = () => {
        const diff = new Date(promoEnd) - new Date();
        if (diff <= 0) {
          setTimeLeft('Sale ended');
          return;
        }
        const d = Math.floor(diff / (1000 * 60 * 60 * 24));
        const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const m = Math.floor((diff / 1000 / 60) % 60);
        
        if (d > 0) setTimeLeft(`Ends in ${d}d ${h}h`);
        else if (h > 0) setTimeLeft(`Ends in ${h}h ${m}m`);
        else setTimeLeft(`Ends in ${m} mins!`);
      };
      update();
      const interval = setInterval(update, 60000);
      return () => clearInterval(interval);
    }, [promoEnd]);

    if (!timeLeft || timeLeft === 'Sale ended') return null;
    
    return (
      <div style={{ fontSize: '0.75rem', color: '#ff2a2a', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '4px', marginTop: '6px', backgroundColor: '#ffe5e5', padding: '2px 8px', borderRadius: '12px', width: 'fit-content' }}>
        <Flame size={12} /> {timeLeft}
      </div>
    );
  };
  const [selectedItem, setSelectedItem] = useState(null);
  const [activeCategory, setActiveCategory] = useState('');

  // Fixed category order
  const CATEGORY_ORDER = ['BBQ', 'PREMIUM', 'PLATTERS', 'SIDES', 'DRINKS'];
  const existingCategories = new Set(menu.map(item => item.category));
  const categories = CATEGORY_ORDER.filter(cat => existingCategories.has(cat));

  const activeColors = CATEGORY_COLORS[activeCategory] || DEFAULT_COLOR;

  // Set initial active category
  useEffect(() => {
    if (categories.length > 0 && !activeCategory) {
      setActiveCategory(categories[0]);
    }
  }, [categories, activeCategory]);

  // Set up Intersection Observer for scroll tracking
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            setActiveCategory(entry.target.id.replace('category-', ''));
          }
        });
      },
      {
        rootMargin: '-120px 0px -65% 0px',
        threshold: 0
      }
    );

    categories.forEach(cat => {
      const el = document.getElementById(`category-${cat}`);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [categories]);

  const scrollToCategory = (cat) => {
    setActiveCategory(cat);
    const el = document.getElementById(`category-${cat}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const heroItem = menu.find(item => item.name === 'Sumandak Burger') || menu[0];

  return (
    <div className="menu-page">
      {/* Sticky Categories Navigation — color changes with active category */}
      <div 
        className="filters-row" 
        style={{ 
          backgroundColor: activeColors.bg,
          transition: 'background-color 230ms ease'
        }}
      >
        {categories.map(cat => {
          const colors = CATEGORY_COLORS[cat] || DEFAULT_COLOR;
          const isActive = activeCategory === cat;
          return (
            <button 
              key={cat} 
              className={`filter-btn ${isActive ? 'active' : ''}`}
              onClick={() => scrollToCategory(cat)}
              style={isActive ? {
                backgroundColor: colors.accent,
                color: '#fff',
                borderColor: colors.text,
                boxShadow: `2px 2px 0px 0px ${colors.text}`,
                transition: 'all 230ms ease'
              } : {
                transition: 'all 230ms ease'
              }}
            >
              {colors.icon} {cat}
            </button>
          );
        })}
      </div>

      {/* Hero Menu Item */}
      {heroItem && (
        <div className={`card menu-hero-card ${!heroItem.inStock ? 'card-oos' : ''}`} onClick={() => { if (heroItem.inStock) setSelectedItem(heroItem); }}>
          <span className="badge-red hero-badge">MUST TRY!</span>
          <div className="hero-img-bg" style={{ position: 'relative' }}>
            <div className="hero-img" style={{ backgroundImage: `url('${heroItem.image}')` }}></div>
            {!heroItem.inStock && (
              <div className="oos-overlay">
                <span className="oos-label">OUT OF STOCK</span>
              </div>
            )}
          </div>
          <div className="menu-hero-info">
            <h2>{heroItem.name}</h2>
            <p className="menu-desc">{heroItem.description}</p>
            {isPromoActive(heroItem) ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="price-row mt-2" style={{ alignItems: 'baseline', gap: '8px' }}>
                  <span className="pts-badge">+250 PTS</span>
                  <span className="price-large text-danger font-black">RM {(heroItem.promo_price / 100).toFixed(2)}</span>
                  <span className="text-muted" style={{ textDecoration: 'line-through', fontSize: '1.2rem', fontWeight: 600 }}>RM {(heroItem.price / 100).toFixed(2)}</span>
                </div>
                <PromoCountdown promoEnd={heroItem.promo_end} />
              </div>
            ) : (
              <div className="price-row mt-2">
                <span className="pts-badge">+250 PTS</span>
                <span className="price-large">RM {(heroItem.price / 100).toFixed(2)}</span>
              </div>
            )}
            <button 
              className={`btn w-full mt-3 ${!heroItem.inStock ? 'btn-secondary' : 'btn-primary'}`}
              disabled={!heroItem.inStock}
              style={!heroItem.inStock ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
              onClick={(e) => {
                e.stopPropagation();
                if (!heroItem.inStock) return;
                setSelectedItem(heroItem);
              }}
            >
              {heroItem.inStock ? 'ADD TO BAG' : 'SOLD OUT'}
            </button>
          </div>
        </div>
      )}

      {/* Menu Categories (Continuous Scroll) */}
      <div className="menu-sections">
        {categories.map(cat => {
          const categoryItems = menu.filter(item => item.category === cat);
          const colors = CATEGORY_COLORS[cat] || DEFAULT_COLOR;
          
          return (
            <div key={cat} id={`category-${cat}`} className="category-section" style={{ marginTop: '3rem' }}>
              <div 
                className="category-header-band"
                style={{ 
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1.25rem',
                  marginBottom: '2rem',
                  padding: '1.25rem 2rem',
                  backgroundColor: '#1c1c1e',
                  borderRadius: '20px',
                  boxShadow: `0 12px 30px ${colors.tint}50`,
                  borderLeft: `8px solid ${colors.accent}`
                }}
              >
                <span className="category-header-icon" style={{ fontSize: '3rem', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.4))' }}>{colors.icon}</span>
                <h2 style={{ color: '#ffffff', fontSize: '2.5rem', fontWeight: 900, margin: 0, letterSpacing: '1px', textTransform: 'uppercase', lineHeight: '1.1' }}>
                  {cat}
                  <span style={{ display: 'block', fontSize: '0.9rem', color: colors.accent, fontWeight: 700, letterSpacing: '3px', marginTop: '4px' }}>
                    SIGNATURE {cat}
                  </span>
                </h2>
              </div>
              
              <div className="hot-list-grid">
                {categoryItems.map(item => (
                  <div key={item.id} className={`card hot-list-card ${!item.inStock ? 'card-oos' : ''}`} onClick={() => { if (item.inStock) setSelectedItem(item); }}>
                    <div className="hot-list-img-wrap">
                      <div className="hot-list-img" style={{ backgroundImage: `url('${item.image}')` }}></div>
                      {!item.inStock && (
                        <div className="oos-overlay">
                          <span className="oos-label">OUT OF STOCK</span>
                        </div>
                      )}
                    </div>
                    <div className="hot-list-info">
                      <div className="flex-between">
                        <h3>{item.name}</h3>
                        <span 
                          className="tag-category"
                          style={{ 
                            backgroundColor: `${colors.accent}18`,
                            color: colors.accent,
                            borderColor: colors.accent
                          }}
                        >
                          {cat}
                        </span>
                      </div>
                      <p className="menu-desc mt-2">{item.description}</p>
                      {isPromoActive(item) && <PromoCountdown promoEnd={item.promo_end} />}
                      <div className="flex-between mt-3">
                        {isPromoActive(item) ? (
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span className="price-large text-danger font-black">RM {(item.promo_price / 100).toFixed(2)}</span>
                            <span className="text-muted" style={{ textDecoration: 'line-through', fontSize: '0.9rem', fontWeight: 600, marginTop: '-4px' }}>RM {(item.price / 100).toFixed(2)}</span>
                          </div>
                        ) : (
                          <span className="price-large">RM {(item.price / 100).toFixed(2)}</span>
                        )}
                        <div className="flex items-center gap-2">
                          <span className="pts-badge-dark">+300 PTS</span>
                          <button 
                            className={`add-btn ${!item.inStock ? 'add-btn-disabled' : ''}`}
                            disabled={!item.inStock}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!item.inStock) return;
                              setSelectedItem(item);
                            }}
                          >
                            <Plus size={20} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Promos / Ads at the bottom */}
      <div className="card loyalty-banner mt-6">
        <Award size={24} color="var(--munchies-white)" />
        <h3 className="mt-2 text-white">LOYALTY PAYS OFF</h3>
        <p className="text-white-dim">Every 5th burger is on the house. Scan at the arcade!</p>
      </div>

      <div className="card spicy-banner mt-4">
        <h3 className="text-white">SPICY CHALLENGE</h3>
        <p className="text-white-dim">Finish the Inferno Crunch in 5 mins & win a limited tee!</p>
        <button className="btn btn-outline-white mt-2">Details</button>
      </div>

      <div className="card ad-banner mt-4 mb-4">
        <div className="ad-content">
          <h2>WANT IT FREE?</h2>
          <p>Play the Munchies Run arcade game & unlock rewards!</p>
          <button className="btn btn-dark w-full mt-3">GO TO ARCADE</button>
        </div>
      </div>

      {/* Modals */}
      {selectedItem && (
        <ItemModal 
          item={selectedItem} 
          onClose={() => setSelectedItem(null)} 
        />
      )}

    </div>
  );
}
