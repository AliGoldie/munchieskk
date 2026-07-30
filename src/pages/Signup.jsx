import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Mail, Phone, CheckCircle2 } from 'lucide-react';
import './Login.css'; // Reusing Login.css styles

export default function Signup() {
  const { signup, loginWithProvider } = useAuth();
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleInitialSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (formData.name && formData.email && formData.password) {
      setIsLoading(true);
      try {
        await signup(formData.email, formData.password, formData.name);
        // Supabase typically logs you in automatically on signup if email confirmation isn't required
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
        <h2>Create an Account</h2>
        <p className="text-muted mb-4">Join MUNCHIESKK for rewards and fast checkout.</p>
        
        {error && (
          <div className="error-alert" style={{color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.9rem'}}>
            {error}
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
            <label>Password</label>
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
          <button className="btn btn-outline social-btn" onClick={() => loginWithProvider('Gmail')}>
            <Mail size={18} /> Sign up with Gmail
          </button>
          <button className="btn btn-outline social-btn" onClick={() => loginWithProvider('Phone')}>
            <Phone size={18} /> Sign up with Phone
          </button>
        </div>

        <p className="signup-prompt">
          Already have an account? <Link to="/login" className="text-primary">Log in</Link>
        </p>
      </div>
    </div>
  );
}
