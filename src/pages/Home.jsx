import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Gamepad2, Award, ChevronRight, Flame, Clock, Sparkles, Plus } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';
import { useNavigate } from 'react-router-dom';
import AddonModal from '../components/AddonModal';
import { siteConfig } from '../config/siteConfig';
import './Home.css';

export default function Home() {
  const { menu, isPromoActive, addToCart, itemAddons } = useStore();
  const navigate = useNavigate();
  const [addonModalItem, setAddonModalItem] = useState(null);

  // Just grab some items for the grid
  const featuredItems = menu.slice(0, 4);

  // Hero Spotlight Logic
  const [currentHeroIdx, setCurrentHeroIdx] = useState(0);
  const heroItems = menu.filter(m => m.inStock).slice(0, 3); // Get top 3 items

  useEffect(() => {
    if (heroItems.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentHeroIdx((prev) => (prev + 1) % heroItems.length);
    }, 5000); // 5-second rotation
    return () => clearInterval(interval);
  }, [heroItems.length]);

  const activeHero = heroItems[currentHeroIdx];

  return (
    <div className="home-page">
      {/* Greeting Section */}
      <div className="greeting-section">
        <div className="greeting-text">
          <p className="welcome-back">WELCOME BACK</p>
          <h1>HEY,<br/>GOURMET!</h1>
        </div>
        <div style={{display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'flex-end'}}>
          <div className="points-badge">
            <Award size={16} />
            <div className="points-info">
              <span className="points-val">1,250</span>
              <span className="points-lbl">Pts</span>
            </div>
          </div>
          <a 
            href={`https://wa.me/${siteConfig.whatsappNumber}?text=${encodeURIComponent(siteConfig.whatsappGreeting)}`}
            target="_blank" rel="noopener noreferrer"
            className="btn"
            style={{backgroundColor: '#25d366', color: 'white', padding: '4px 12px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', borderRadius: '20px', fontWeight: 'bold'}}
          >
            💬 WhatsApp
          </a>
        </div>
      </div>

      {/* Rotating Hero Spotlight */}
      {activeHero && (
        <div className="hero-spotlight">
          <div className="hero-spotlight-bg-shape"></div>
          
          <div className="hero-spotlight-image-container" onClick={() => navigate('/menu')}>
            <div className="hero-spotlight-image" style={{ backgroundImage: `url('${activeHero.image}')` }}></div>
            
            {/* Dynamic Badges based on index or promo */}
            <div className="hero-badges">
              {isPromoActive(activeHero) ? (
                <div className="hero-badge badge-promo"><Sparkles size={14} /> ON SALE</div>
              ) : currentHeroIdx === 0 ? (
                <div className="hero-badge badge-bestseller"><Flame size={14} /> BEST SELLER</div>
              ) : (
                <div className="hero-badge badge-fresh"><Clock size={14} /> FRESH DAILY</div>
              )}
            </div>
          </div>

          <div className="hero-spotlight-content">
            <h2>{activeHero.name}</h2>
            <p>{activeHero.description}</p>
            <span className="price-large">
              RM {( (isPromoActive(activeHero) ? activeHero.promo_price : activeHero.price) / 100).toFixed(2)}
            </span>

            {/* Dot Navigation */}
            {heroItems.length > 1 && (
              <div className="hero-dots">
                {heroItems.map((_, idx) => (
                  <button 
                    key={idx} 
                    className={`hero-dot ${idx === currentHeroIdx ? 'active' : ''}`}
                    onClick={() => setCurrentHeroIdx(idx)}
                    aria-label={`Go to slide ${idx + 1}`}
                  />
                ))}
              </div>
            )}

            <button className="btn btn-primary btn-sleek hero-cta-btn" onClick={() => navigate('/menu')}>
              ORDER NOW <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Clean Section Header */}
      <div className="section-header-clean mt-8">
        <h3>Menu Lineup</h3>
        <Link to="/menu" className="see-all-sleek">See All Menu <ChevronRight size={16} /></Link>
      </div>

      <div className="categories-grid-clean">
        <Link to="/menu#BBQ" className="cat-card-clean">
          <span className="cat-icon-clean">🍖</span>
          <span className="cat-title-clean">BBQ</span>
        </Link>
        <Link to="/menu#PREMIUM" className="cat-card-clean">
          <span className="cat-icon-clean">👑</span>
          <span className="cat-title-clean">Premium</span>
        </Link>
        <Link to="/menu#PLATTERS" className="cat-card-clean">
          <span className="cat-icon-clean">🍽️</span>
          <span className="cat-title-clean">Platters</span>
        </Link>
        <Link to="/menu#SIDES" className="cat-card-clean">
          <span className="cat-icon-clean">🥗</span>
          <span className="cat-title-clean">Sides</span>
        </Link>
        <Link to="/menu#DRINKS" className="cat-card-clean">
          <span className="cat-icon-clean">🥤</span>
          <span className="cat-title-clean">Drinks</span>
        </Link>
      </div>

      {/* Banners */}
      <div className="card banner-dark">
        <div className="banner-content">
          <h3>BITE & WIN</h3>
          <p>Play 'Munch-Man' while you wait and win free fries!</p>
          <Link to="/arcade" className="btn btn-yellow mt-2">PLAY NOW</Link>
        </div>
        <Gamepad2 className="banner-icon" size={64} opacity={0.2} />
      </div>

      <div className="card banner-orange">
        <div className="banner-content">
          <Award size={24} />
          <h3 className="mt-2">LOYALTY PERKS</h3>
          <p>You're 250 pts away from a FREE SHAKE.</p>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: '70%' }}></div>
          </div>
        </div>
      </div>

      {/* Product Grid */}
      <div className="product-grid">
        {featuredItems.map(item => (
          <div key={item.id} className="card product-card">
            <div className="product-img" style={{ backgroundImage: `url('${item.image}')` }}></div>
            <div className="product-info">
              <h4>{item.name}</h4>
              <div className="product-bottom">
                <span className="price">RM {(item.price / 100).toFixed(2)}</span>
                <button 
                  className="add-btn" 
                  onClick={() => {
                    if (itemAddons[item.id] && itemAddons[item.id].length > 0) {
                      setAddonModalItem(item);
                    } else {
                      addToCart(item);
                    }
                  }}
                >
                  <Plus size={20} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {addonModalItem && (
        <AddonModal 
          item={addonModalItem} 
          onClose={() => setAddonModalItem(null)} 
        />
      )}
    </div>
  );
}
