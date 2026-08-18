import { Outlet, Link, useLocation } from 'react-router-dom';
import { ShoppingBag, User, Menu as MenuIcon, Home, Gift, Gamepad2, LogOut } from 'lucide-react';
import './Layout.css';

import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import CookingPopup from './CookingPopup';

export default function Layout() {
  const location = useLocation();
  const { cartCount } = useStore();
  const { user, logout } = useAuth();
  const isAdmin = location.pathname.startsWith('/admin');

  if (isAdmin) {
    return (
      <div className="admin-layout">
        <header className="admin-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <img src="/images/logo.png" alt="MUNCHIESKK" style={{ height: '32px' }} />
            <span style={{ fontWeight: 800, color: '#2b3674', fontSize: '1.2rem' }}>ADMIN</span>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <Link to="/" className="btn btn-secondary">Store View</Link>
            <button onClick={logout} className="btn btn-secondary"><LogOut size={16} style={{marginRight: '0.5rem'}}/>Logout</button>
          </div>
        </header>
        <main className="admin-main">
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
            <img src="/images/logo.png" alt="MUNCHIESKK" style={{ height: '48px' }} />
          </Link>
          <div style={{display: 'flex', alignItems: 'center', gap: '1rem'}}>
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
            <Link to="/cart" className="cart-link">
              <ShoppingBag size={24} color="var(--munchies-white)" />
              {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
            </Link>
          </div>
        </div>
      </header>
      
      {/* Main Content Area */}
      <main className="main-content">
        <div className="container">
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
      {/* Cooking Order Popup */}
      <CookingPopup />
    </div>
  );
}
