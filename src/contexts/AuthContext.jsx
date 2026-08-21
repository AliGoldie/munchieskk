import { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../config/supabase';
import { calculateOrderPoints } from '../utils/pointsCalculator';

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

  useEffect(() => {
    // Fetch initial session
    const initializeAuth = async () => {
      // Check for mock admin session on localhost
      if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        const savedMock = localStorage.getItem('munchies_mock_admin');
        if (savedMock) {
          try {
            const parsed = JSON.parse(savedMock);
            setUser(parsed);
            cleanAuthUrlParams();
            setLoading(false);
            return;
          } catch (e) {}
        }
      }
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        await fetchAndSetUser(session.user);
      } else {
        setUser(null);
      }
      cleanAuthUrlParams();
      setLoading(false);
    };

    initializeAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        await fetchAndSetUser(session.user);
      } else {
        setUser(null);
      }
      cleanAuthUrlParams();
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

    // 2. Calculate points from past non-cancelled orders based on item rules (Burger: 20, Drink: 15, Fries: 10)
    let orderPoints = 0;
    try {
      const { data: userOrders } = await supabase
        .from('orders')
        .select('total, items, status')
        .eq('user_id', authUser.id)
        .neq('status', 'CANCELLED');

      if (userOrders && userOrders.length > 0) {
        orderPoints = userOrders.reduce((sum, o) => {
          let itemsList = o.items;
          if (typeof itemsList === 'string') {
            try { itemsList = JSON.parse(itemsList); } catch (e) { itemsList = []; }
          }
          let pts = 0;
          if (Array.isArray(itemsList) && itemsList.length > 0) {
            pts = calculateOrderPoints(itemsList);
          } else {
            // Fallback estimate if items list not parsed: ~18 points per RM 10
            pts = Math.max(15, Math.floor(((o.total || 0) / 100) * 1.5));
          }
          return sum + pts;
        }, 0);
      }
    } catch (e) {
      console.warn('Could not calculate order points:', e);
    }

    // 3. Check local storage backup
    const savedBackup = localStorage.getItem(`munchies_pts_${authUser.id}`);
    const backupPts = savedBackup ? parseInt(savedBackup, 10) : 0;

    // 4. Effective points is the max of DB points, Order history points, and Local backup
    const dbPts = profileData?.points || 0;
    const effectivePoints = Math.max(dbPts, orderPoints, backupPts);

    // 5. Self-heal DB if DB had 0 or stale lower points
    if (effectivePoints > dbPts) {
      try {
        await supabase.from('profiles').update({ points: effectivePoints }).eq('id', authUser.id);
      } catch (e) {
        console.warn('Self-heal profile update failed:', e);
      }
    }

    // 6. Save backup locally
    localStorage.setItem(`munchies_pts_${authUser.id}`, effectivePoints.toString());

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
