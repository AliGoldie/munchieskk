import { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../config/supabase';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const cleanAuthUrlParams = () => {
    if (typeof window !== 'undefined') {
      const hasHash = window.location.hash.includes('access_token');
      const hasError = window.location.search.includes('error') || window.location.search.includes('error_code');
      const hasCode = window.location.search.includes('code=');

      if (hasHash || hasError || hasCode) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
  };

  // Reads the localhost-only mock admin session from localStorage, if any.
  // Shared by initializeAuth and onAuthStateChange below so neither one can
  // clobber the other's view of a mock session — see the race explained there.
  const getMockAdmin = () => {
    if (typeof window === 'undefined') return null;
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') return null;
    const savedMock = localStorage.getItem('munchies_mock_admin');
    if (!savedMock) return null;
    try {
      return JSON.parse(savedMock);
    } catch (e) {
      return null;
    }
  };

  useEffect(() => {
    // Fetch initial session
    const initializeAuth = async () => {
      const mockAdmin = getMockAdmin();
      if (mockAdmin) {
        setUser(mockAdmin);
        cleanAuthUrlParams();
        setLoading(false);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) {
        setUser(null);
      }
      cleanAuthUrlParams();
      setLoading(false);
    };

    initializeAuth();

    // Listen for auth changes - single source of truth for user profile fetching
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        await fetchAndSetUser(session.user);
      } else if (!getMockAdmin()) {
        // This fires asynchronously on mount and can land after initializeAuth's
        // mock-session check above, so re-check here too — otherwise a real
        // (session-less) Supabase auth state can clobber an active mock admin
        // session back to null on a hard page reload.
        setUser(null);
      }
      cleanAuthUrlParams();
      setLoading(false);
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  const fetchAndSetUser = async (authUser) => {
    // 1. Fetch profile data
    const { data: profileData, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle();

    // Points are now calculated and written server-side by DB triggers on order
    // placement/collection, so profiles.points is authoritative — no client-side
    // recompute or self-heal write needed here.
    const effectivePoints = profileData?.points || 0;

    if (error || !profileData) {
      setUser({
        id: authUser.id,
        email: authUser.email,
        name: authUser.user_metadata?.name || 'User',
        phone: authUser.user_metadata?.phone || '',
        address: '',
        role: 'user',
        points: effectivePoints,
        short_code: authUser.user_metadata?.short_code || '',
        avatar_color: 'ember',
        created_at: authUser.created_at
      });
    } else {
      setUser({
        id: authUser.id,
        email: authUser.email,
        name: profileData.name || authUser.user_metadata?.name || '',
        phone: profileData.phone || authUser.user_metadata?.phone || '',
        address: profileData.address || '',
        role: profileData.role || 'user',
        points: effectivePoints,
        short_code: profileData.short_code || '',
        avatar_color: profileData.avatar_color || 'ember',
        created_at: profileData.created_at || authUser.created_at
      });
    }
  };

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    if (error) {
      throw error;
    }
    
    return data;
  };

  const signup = async (email, password, name, phone, referredBy = null) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name: name,
          phone: phone || '',
          referred_by: referredBy || null
        }
      }
    });
    
    if (error) {
      throw error;
    }
    
    if (data.user) {
      // Upsert user details into profiles table
      try {
        const profilePayload = {
          id: data.user.id,
          name: name,
          phone: phone || '',
          role: 'user'
        };

        await supabase.from('profiles').upsert(profilePayload);
      } catch (e) {
        console.error('Error inserting profile row:', e);
      }
    }
    
    return data;
  };

  const loginWithProvider = async (provider) => {
    const redirectUrl = typeof window !== 'undefined' ? window.location.origin : undefined;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: provider.toLowerCase(),
      options: {
        redirectTo: redirectUrl
      }
    });
    
    if (error) {
      throw error;
    }
    
    return data;
  };

  const loginAsMockAdmin = () => {
    const mockAdminUser = {
      id: '223492c5-f876-4212-87f5-0f12fca14e76',
      email: 'munchieskk.sabah@gmail.com',
      name: 'Munchies Admin (Local)',
      phone: '0103818100',
      address: 'Munchies KK Store',
      role: 'admin',
      points: 9999,
      created_at: new Date().toISOString()
    };
    setUser(mockAdminUser);
    try {
      localStorage.setItem('munchies_mock_admin', JSON.stringify(mockAdminUser));
    } catch (e) {}
    navigate('/admin');
  };

  const logout = async () => {
    try {
      localStorage.removeItem('munchies_mock_admin');
    } catch (e) {}
    await supabase.auth.signOut();
    setUser(null);
    navigate('/login');
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, loginWithProvider, signup, logout, loginAsMockAdmin }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
