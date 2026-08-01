import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Gamepad2, Award, Plus } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';
import { useNavigate } from 'react-router-dom';
import AddonModal from '../components/AddonModal';
import { siteConfig } from '../config/siteConfig';
import './Home.css';

export default function Home() {
  const { menu, addToCart, itemAddons } = useStore();
  const navigate = useNavigate();
  const [addonModalItem, setAddonModalItem] = useState(null);

  // Just grab some items for the grid
  const featuredItems = menu.slice(0, 4);

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

      {/* Hero Card */}
      <div className="card hero-card">
        <div className="hero-content">
          <span className="badge-red">LIMITED DROP</span>
          <h2>SUMANDAK<br/>BURGER</h2>
          <p>Special local style burger packed with flavor.</p>
          <button className="btn btn-primary mt-3">GRAB IT NOW</button>
        </div>
        <div className="hero-image">
          <div className="hero-image-inner" style={{ backgroundImage: "url('/images/sumandak burger.jpg')" }}></div>
          <div className="starburst">NEW DROP!</div>
        </div>
      </div>

      {/* Categories */}
      <div className="section-header">
        <h3>THE LINEUP</h3>
        <Link to="/menu" className="see-all">SEE ALL</Link>
      </div>
      <div className="categories-row">
        <Link to="/menu#BBQ" className="category-item">
          <div className="category-icon">🍖</div>
          <span>BBQ</span>
        </Link>
        <Link to="/menu#PREMIUM" className="category-item">
          <div className="category-icon">🍔</div>
          <span>Premium</span>
        </Link>
        <Link to="/menu#PLATTERS" className="category-item">
          <div className="category-icon">🍗</div>
          <span>Platters</span>
        </Link>
        <Link to="/menu#SIDES" className="category-item">
          <div className="category-icon">🍟</div>
          <span>Sides</span>
        </Link>
        <Link to="/menu#DRINKS" className="category-item">
          <div className="category-icon">🥤</div>
          <span>Drinks</span>
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
    </div>
  );
}
