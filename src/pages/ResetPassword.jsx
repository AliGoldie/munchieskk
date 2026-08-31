import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../config/supabase';
import './Login.css';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isValidSession, setIsValidSession] = useState(null); // null = checking, true = valid, false = expired/missing
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;

    // 1. Listen for Supabase recovery auth event
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (isMounted && (event === 'PASSWORD_RECOVERY' || session)) {
        setIsValidSession(true);
      }
    });

    // 2. Check existing session if already parsed from URL hash
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (isMounted) {
        if (session) {
          setIsValidSession(true);
        } else {
          // Functional updater prevents stale closure race condition
          setTimeout(() => {
            if (isMounted) {
              setIsValidSession(current => current === null ? false : current);
            }
          }, 1200);
        }
      }
    });

    return () => {
      isMounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  const handleReset = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password });
      if (updateErr) throw updateErr;
      setSuccess(true);
      setTimeout(() => {
        navigate('/login');
      }, 2500);
    } catch (err) {
      setError(err.message || 'Failed to update password. The link may be expired.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
          <img src="/images/logo.png" alt="MUNCHIESKK Logo" style={{ height: '80px', borderRadius: '50%' }} />
        </div>
        <h2 style={{ textAlign: 'center', marginBottom: '0.5rem' }}>Set New Password</h2>

        {isValidSession === false ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div className="error-alert" style={{ color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', padding: '1rem', borderRadius: '8px', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
              <strong>Invalid or Expired Reset Link</strong>
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.82rem' }}>
                This password reset link is either invalid or has expired. Please request a new one.
              </p>
            </div>
            <Link to="/login" className="btn btn-primary" style={{ display: 'inline-block', width: '100%', textDecoration: 'none' }}>
              Back to Login
            </Link>
          </div>
        ) : (
          <>
            <p className="text-muted mb-4" style={{ textAlign: 'center' }}>
              Enter your new password below.
            </p>

            {error && (
              <div className="error-alert" style={{ color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.9rem' }}>
                {error}
              </div>
            )}

            {success ? (
              <div style={{ color: '#16a34a', backgroundColor: 'rgba(22,163,74,0.1)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', textAlign: 'center' }}>
                <strong>Password updated successfully!</strong>
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>Redirecting to login...</p>
              </div>
            ) : (
              <form onSubmit={handleReset} className="login-form">
                <div className="form-group">
                  <label htmlFor="reset-password">New Password</label>
                  <input
                    id="reset-password"
                    type="password"
                    className="price-input"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="reset-password-confirm">Confirm New Password</label>
                  <input
                    id="reset-password-confirm"
                    type="password"
                    className="price-input"
                    placeholder="Re-enter new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary w-full" disabled={isLoading || isValidSession === null}>
                  {isLoading ? 'Updating password...' : 'Update Password'}
                </button>
              </form>
            )}

            <p className="signup-prompt">
              Back to <Link to="/login" className="text-primary">Sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
