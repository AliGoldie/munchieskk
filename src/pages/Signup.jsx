import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import { Mail } from 'lucide-react';
import './Login.css';

export default function Signup() {
  const { signup, loginWithProvider } = useAuth();
  const [searchParams] = useSearchParams();
  const initialRef = searchParams.get('ref') || '';
  const [formData, setFormData] = useState({ 
    name: '', 
    email: '', 
    phone: '', 
    password: '',
    referralCode: initialRef
  });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [infoMessage, setInfoMessage] = useState('');
  const navigate = useNavigate();

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (isResetting) return;
    setError('');
    setInfoMessage('');
    if (!formData.email) {
      setError('Please enter your email address above to reset your password.');
      return;
    }
    setIsResetting(true);
    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(formData.email, {
        redirectTo: `${window.location.origin}/reset-password`
      });
      if (resetErr) throw resetErr;
      setInfoMessage('Password reset link sent! Check your email inbox.');
    } catch (err) {
      setError(err.message || 'Failed to send reset email. Please try again.');
    } finally {
      setIsResetting(false);
    }
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleInitialSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (formData.name && formData.email && formData.password) {
      setIsLoading(true);
      try {
        const referredByValue = formData.referralCode ? formData.referralCode.trim().toUpperCase() : null;
        await signup(formData.email, formData.password, formData.name, formData.phone, referredByValue);
        navigate('/');
      } catch (err) {
        setError(err.message || 'Failed to create an account.');
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
        <h2 style={{ textAlign: 'center', marginBottom: '0.5rem' }}>Create an Account</h2>
        <p className="text-muted mb-4" style={{ textAlign: 'center' }}>Join for rewards and fast checkout.</p>
        
        {error && (
          <div className="error-alert" style={{color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.9rem'}}>
            {error}
          </div>
        )}

        {infoMessage && (
          <div style={{color: '#16a34a', backgroundColor: 'rgba(22,163,74,0.1)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.9rem', textAlign: 'center'}}>
            {infoMessage}
          </div>
        )}

        <form onSubmit={handleInitialSubmit} className="login-form">
          <div className="form-group">
            <label>Full Name</label>
            <input type="text" name="name" className="price-input" value={formData.name} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label>Email Address</label>
            <input type="email" name="email" className="price-input" value={formData.email} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label>Phone Number (Optional)</label>
            <input type="tel" name="phone" className="price-input" value={formData.phone} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Referral Code (optional)</label>
            <input 
              type="text" 
              name="referralCode" 
              className="price-input" 
              placeholder="e.g. AB12CD"
              value={formData.referralCode} 
              onChange={handleChange} 
            />
          </div>
          <div className="form-group">
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
              <label>Password</label>
              <a
                href="#"
                onClick={handleForgotPassword}
                style={{fontSize: '0.8rem', color: 'var(--gold)', fontWeight: 600, textDecoration: 'none', cursor: isResetting ? 'wait' : 'pointer', opacity: isResetting ? 0.6 : 1}}
              >
                {isResetting ? 'Sending link...' : 'Forgot Password?'}
              </a>
            </div>
            <input type="password" name="password" className="price-input" value={formData.password} onChange={handleChange} required />
          </div>

          <button type="submit" className="btn btn-primary w-full" disabled={isLoading}>
            {isLoading ? 'Creating account...' : 'Sign Up'}
          </button>
        </form>

        <div className="login-divider">
          <span>OR</span>
        </div>

        <div className="social-login-group">
          <button className="btn btn-outline social-btn" onClick={() => loginWithProvider('Google')}>
            <Mail size={18} /> Sign up with Google
          </button>
        </div>

        <p className="signup-prompt">
          Already have an account? <Link to="/login" className="text-primary">Log in</Link>
        </p>
      </div>
    </div>
  );
}
