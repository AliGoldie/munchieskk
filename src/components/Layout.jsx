import { useEffect, useRef, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { User, Menu as MenuIcon, Home, Gift, Gamepad2, LogOut, Star } from 'lucide-react';
import { BiteBagIcon } from './icons';
import RouteSeo from './RouteSeo';
import './Layout.css';

import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import { useCountUp } from '../hooks/useCountUp';
import CookingPopup from './CookingPopup';
import ErrorBoundary from './ErrorBoundary';
import WhatsAppFloatButton from './WhatsAppFloatButton';

export default function Layout() {
  const location = useLocation();
  const { cartCount, points } = useStore();
  const displayedPoints = useCountUp(points, 800);
  const { user, logout } = useAuth();
  const isAdmin = location.pathname.startsWith('/admin');

  // Bumps the cart icon and shows a brief toast whenever an item is added
  // (cartCount goes up), never on removals -- gives "add to cart" a moment
  // of visible feedback instead of the badge number just silently changing.
  const [cartBump, setCartBump] = useState(false);
  const [cartToast, setCartToast] = useState(null); // null | 'entering' | 'leaving'
  const prevCartCount = useRef(cartCount);
  useEffect(() => {
    if (cartCount > prevCartCount.current) {
      setCartBump(true);
      setCartToast('entering');
      const bumpT = setTimeout(() => setCartBump(false), 450);
      const leaveT = setTimeout(() => setCartToast('leaving'), 1500);
      const removeT = setTimeout(() => setCartToast(null), 1780);
      prevCartCount.current = cartCount;
      return () => { clearTimeout(bumpT); clearTimeout(leaveT); clearTimeout(removeT); };
    }
    prevCartCount.current = cartCount;
  }, [cartCount]);

  if (isAdmin) {
    return (
      <div className="admin-layout">
        <header className="admin-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <img src="/images/logo.png" alt="MUNCHIESKK" width="240" height="240" style={{ height: '32px', width: 'auto' }} />
            <span style={{ fontWeight: 800, color: '#2b3674', fontSize: '1.2rem' }}>ADMIN</span>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <Link to="/" className="btn btn-secondary">Store View</Link>
            <button onClick={logout} className="admin-logout" aria-label="Log out">
              <span className="admin-logout-sign"><LogOut size={17} strokeWidth={2.4} aria-hidden="true" /></span>
              <span className="admin-logout-text">Logout</span>
            </button>
          </div>
        </header>
        <main className="admin-main">
          <RouteSeo />
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="app-layout">
      {/* Top Header */}
      <header className="top-header">
        <div className="container header-container">
          <Link to="/" className="logo">
            <img src="/images/logo.png" alt="MUNCHIESKK" width="240" height="240" style={{ height: '48px', width: 'auto' }} />
          </Link>
          <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
            {user?.role === 'admin' && (
              <Link to="/admin" style={{
                background: 'linear-gradient(135deg, #ef4444 0%, #f97316 100%)',
                color: '#ffffff',
                padding: '0.4rem 0.85rem',
                borderRadius: '20px',
                fontWeight: '900',
                fontSize: '0.8rem',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                boxShadow: '0 4px 12px rgba(239, 68, 68, 0.4)',
                letterSpacing: '0.5px'
              }}>
                ADMIN
              </Link>
            )}
            {user && (
              <Link to="/loyalty" className="points-chip">
                <Star size={13} fill="currentColor" strokeWidth={0} />
                {displayedPoints.toLocaleString()}
              </Link>
            )}
            <Link to="/cart" className={`cart-link${cartBump ? ' cart-bump' : ''}`} aria-label="Cart">
              <BiteBagIcon size={24} />
              {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
            </Link>
          </div>
        </div>
      </header>
      
      {/* Main Content Area */}
      <main className="main-content">
        <div className="container page-transition" key={location.pathname}>
          <RouteSeo />
          <Outlet />
        </div>
      </main>

      {/* Bottom Navigation */}
      <nav className="bottom-nav">
        <div className="container nav-container">
          <Link to="/" className={`nav-item ${location.pathname === '/' ? 'active' : ''}`}>
            <Home size={24} />
            <span>Home</span>
          </Link>
          <Link to="/menu" className={`nav-item ${location.pathname === '/menu' ? 'active' : ''}`}>
            <MenuIcon size={24} />
            <span>Menu</span>
          </Link>
          <Link to="/arcade" className={`nav-item ${location.pathname === '/arcade' ? 'active' : ''}`}>
            <Gamepad2 size={24} />
            <span>Arcade</span>
          </Link>
          <Link to="/loyalty" className={`nav-item ${location.pathname === '/loyalty' ? 'active' : ''}`}>
            <Gift size={24} />
            <span>Loyalty</span>
          </Link>
          <Link to={user ? "/profile" : "/login"} className={`nav-item ${location.pathname === '/profile' || location.pathname === '/login' ? 'active' : ''}`}>
            <User size={24} />
            <span>Profile</span>
          </Link>
        </div>
      </nav>
      {cartToast && (
        <div className={`cart-toast${cartToast === 'leaving' ? ' cart-toast-leaving' : ''}`}>
          <BiteBagIcon size={16} />
          Added to Bag!
        </div>
      )}
      {/* Cooking Order Popup */}
      <ErrorBoundary>
        <CookingPopup />
      </ErrorBoundary>
      <WhatsAppFloatButton />
    </div>
  );
}
