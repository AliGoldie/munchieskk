import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Flame, Award } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';
import ItemModal from '../components/ItemModal';
import { getItemPoints } from '../utils/pointsCalculator';
import './Menu.css';

// Category color config — each category gets a unique color identity
const CATEGORY_COLORS = {
  BBQ:      { accent: '#F0862A', icon: '🔥' },
  PREMIUM:  { accent: '#C77DFF', icon: '👑' },
  PLATTERS: { accent: '#FFC72C', icon: '🍽️' },
  SIDES:    { accent: '#5FD68C', icon: '🥗' },
  DRINKS:   { accent: '#63A7F5', icon: '🥤' },
};

const DEFAULT_COLOR = { accent: '#8E867C', icon: '📦' };

const CATEGORY_ORDER = ['BBQ', 'PREMIUM', 'PLATTERS', 'SIDES', 'DRINKS'];

export default function Menu() {
  const { menu, isPromoActive } = useStore();

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
      <div style={{ fontSize: '0.75rem', color: '#ff6b6b', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '4px', marginTop: '6px', backgroundColor: 'rgba(255,42,42,0.14)', padding: '2px 8px', borderRadius: '12px', width: 'fit-content' }}>
        <Flame size={12} /> {timeLeft}
      </div>
    );
  };
  const [selectedItem, setSelectedItem] = useState(null);
  const [activeCategory, setActiveCategory] = useState('');
  const isClickScrolling = useRef(false);
  const scrollUnlockTimeoutRef = useRef(null);

  // Native `scrollIntoView({behavior:'smooth'})` can get stuck on some mobile
  // browsers when a new scroll is requested before the previous one finishes —
  // the animations collide and neither completes, leaving the page frozen
  // while the category pill highlight keeps updating (confirmed via a user
  // screen recording: tapping through categories updated the active tab but
  // the page never actually scrolled). An instant, unanimated scroll can't
  // get stuck mid-flight the way a native smooth-scroll animation can, so it
  // trades a little visual polish for working reliably on every device.
  const jumpTo = (targetY) => {
    window.scrollTo(0, targetY);
  };

  useEffect(() => {
    return () => {
      if (scrollUnlockTimeoutRef.current) clearTimeout(scrollUnlockTimeoutRef.current);
    };
  }, []);

  // Memoized so the array reference only changes when the actual set of
  // categories does. Without this, every render (including the ones fired
  // by scrolling itself, via the IntersectionObserver below calling
  // setActiveCategory) produced a brand-new array, which re-triggered every
  // effect keyed on [categories] -- including the hash-jump effect further
  // down. Since the #CATEGORY hash from a Home page link is never cleared,
  // that effect kept firing on every scroll-driven re-render and snapping
  // the page back to the original hash target, making the page look stuck.
  const categories = useMemo(() => {
    const existingCategories = new Set(menu.map(item => item.category));
    return CATEGORY_ORDER.filter(cat => existingCategories.has(cat));
  }, [menu]);

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
        if (isClickScrolling.current) return;
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            setActiveCategory(entry.target.id.replace('category-', ''));
          }
        });
      },
      {
        rootMargin: '-135px 0px -75% 0px',
        threshold: 0
      }
    );

    categories.forEach(cat => {
      const el = document.getElementById(`category-${cat}`);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [categories]);

  // Category bar is sticky, so scrolling a target element flush to the top
  // would tuck it behind the bar — offset by the bar's actual current height
  // instead of a hardcoded pixel value, so it stays correct across devices.
  const getCategoryScrollTarget = (el) => {
    const bar = document.querySelector('.category-bar');
    const barOffset = bar ? bar.getBoundingClientRect().height : 0;
    return el.getBoundingClientRect().top + window.scrollY - barOffset - 10;
  };

  // Handle hash links from other pages (e.g., Home clicking on #BBQ).
  // Cleared from the URL once consumed -- otherwise it lingers and, on any
  // future re-render of this effect, would force the page back to that
  // section again (belt-and-suspenders alongside memoizing `categories`
  // above, which was the actual cause of those extra re-renders).
  useEffect(() => {
    if (categories.length > 0 && window.location.hash) {
      const hash = window.location.hash.substring(1);
      if (categories.includes(hash)) {
        setTimeout(() => {
          const el = document.getElementById(hash);
          if (el) jumpTo(getCategoryScrollTarget(el));
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }, 100); // small delay to ensure DOM is ready
      }
    }
  }, [categories]);

  const scrollToCategory = (cat) => {
    isClickScrolling.current = true;
    setActiveCategory(cat);
    if (scrollUnlockTimeoutRef.current) clearTimeout(scrollUnlockTimeoutRef.current);
    const el = document.getElementById(`category-${cat}`);
    if (el) {
      jumpTo(getCategoryScrollTarget(el));
    }
    // Let the jump land and any resulting intersection events settle before
    // handing control back to the scroll-tracking observer.
    scrollUnlockTimeoutRef.current = setTimeout(() => {
      isClickScrolling.current = false;
    }, 150);
  };

  const heroItem = menu.find(item => item.name === 'Sumandak Burger') || menu[0];

  return (
    <div className="menu-page">
      {/* Sticky Categories Navigation */}
      <div className="category-bar">
        {categories.map(cat => {
          const colors = CATEGORY_COLORS[cat] || DEFAULT_COLOR;
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              className={`category-btn${isActive ? ' active' : ''}`}
              onClick={() => scrollToCategory(cat)}
            >
              <span className="icon">{colors.icon}</span>
              {cat}
            </button>
          );
        })}
      </div>

      {/* Hero Menu Item */}
      {heroItem && (
        <div className={`card menu-hero-card ${!heroItem.inStock ? 'card-oos' : ''}`} onClick={() => { if (heroItem.inStock) setSelectedItem(heroItem); }}>
          <div className="hero-img-bg" style={{ position: 'relative' }}>
            <span className="badge-red hero-badge">MUST TRY!</span>
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
                  <span className="pts-badge">+{getItemPoints(heroItem)} PTS</span>
                  <span className="price-large text-danger font-black">RM {(heroItem.promo_price / 100).toFixed(2)}</span>
                  <span className="text-muted" style={{ textDecoration: 'line-through', fontSize: '1.2rem', fontWeight: 600 }}>RM {(heroItem.price / 100).toFixed(2)}</span>
                </div>
                <PromoCountdown promoEnd={heroItem.promo_end} />
              </div>
            ) : (
              <div className="price-row mt-2">
                <span className="pts-badge">+{getItemPoints(heroItem)} PTS</span>
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
              <div id={cat} className="category-header-band">
                <div className="category-header-bar" style={{ backgroundColor: colors.accent }} />
                <h2 className="category-header-title">{cat}</h2>
                <span className="category-header-count" style={{ color: colors.accent }}>
                  {categoryItems.length} item{categoryItems.length !== 1 ? 's' : ''}
                </span>
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
                        <button 
                          className={`add-btn ${!item.inStock ? 'add-btn-disabled' : ''}`}
                          disabled={!item.inStock}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!item.inStock) return;
                            setSelectedItem(item);
                          }}
                        >
                          {item.inStock ? 'POWER UP' : 'SOLD OUT'}
                        </button>
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

      <div className="card ad-banner mt-4 mb-4">
        <div className="ad-content">
          <h2>WANT IT FREE?</h2>
          <p>Play the Munchies Run arcade game & unlock rewards!</p>
          <Link to="/arcade" className="btn btn-dark w-full mt-3" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>GO TO ARCADE</Link>
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
