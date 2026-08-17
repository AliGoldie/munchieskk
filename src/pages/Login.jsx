import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Mail, Phone } from 'lucide-react';
import './Login.css';

export default function Login() {
  const { login, loginWithProvider, loginAsMockAdmin } = useAuth();
  const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (email && password) {
      setIsLoading(true);
      try {
        await login(email, password);
        navigate('/');
      } catch (err) {
        setError(err.message || 'Failed to sign in. Please check your credentials.');
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
          <img src="/images/logo.png" alt="MUNCHIESKK Logo" style={{ height: '80px', borderRadius: '50%' }} />
        </div>
        <h2 style={{ textAlign: 'center', marginBottom: '0.5rem' }}>Welcome Back</h2>
        <p className="text-muted mb-4" style={{ textAlign: 'center' }}>Please log in to continue.</p>
        
        {error && (
          <div className="error-alert" style={{color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.9rem'}}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label>Email Address</label>
            <input 
              type="email" 
              className="price-input" 
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required 
            />
          </div>
          
          <div className="form-group">
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
              <label>Password</label>
              <a href="#" onClick={async (e) => {
                e.preventDefault();
                if (!email) {
                  alert('Please enter your email address first to reset your password.');
                  return;
                }
                alert('If an account exists for that email, a password reset link has been sent!');
              }} style={{fontSize: '0.8rem', color: 'var(--munchies-primary)', textDecoration: 'none'}}>Forgot Password?</a>
            </div>
            <input 
              type="password" 
              className="price-input" 
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required 
            />
          </div>

          <button type="submit" className="btn btn-primary w-full" disabled={isLoading}>
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="login-divider">
          <span>OR</span>
        </div>

        <div className="social-login-group">
          <button className="btn btn-outline social-btn" onClick={() => loginWithProvider('Google')}>
            <Mail size={18} /> Continue with Google
          </button>
          <button className="btn btn-outline social-btn" onClick={() => loginWithProvider('Facebook')}>
            Continue with Facebook
          </button>
          <button className="btn btn-outline social-btn" onClick={() => loginWithProvider('Phone')}>
            <Phone size={18} /> Continue with Phone
          </button>
        </div>

        <p className="signup-prompt">
          Don't have an account? <Link to="/signup" className="text-primary">Sign up</Link>
        </p>

        {isLocalhost && (
          <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px dashed #cbd5e1' }}>
            <button
              type="button"
              onClick={loginAsMockAdmin}
              className="btn w-full"
              style={{
                background: '#1e293b',
                color: '#38bdf8',
                fontWeight: 700,
                fontSize: '0.85rem',
                padding: '10px',
                borderRadius: '8px',
                border: '1px solid #334155',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: 'pointer'
              }}
            >
              ? Quick Dev Admin Login (Localhost Only)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
