import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../config/supabase';
import { useAuth } from './AuthContext';
import { calculateOrderPoints } from '../utils/pointsCalculator';
import { parseTimeToMinutes } from '../utils/timeUtils';

const StoreContext = createContext();

export function StoreProvider({ children }) {
  const { user, setUser } = useAuth();

  const [menu, setMenu] = useState([]);
  const [addons, setAddons] = useState([]);
  const [itemAddons, setItemAddons] = useState({});
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loyaltyPrizes, setLoyaltyPrizes] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);

  // Local-only state for Cart & Point History
  const loadState = (key, defaultVal) => {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : defaultVal;
  };
  const [cart, setCart] = useState(() => loadState('munchies_cart', []));
  const [pointHistory, setPointHistory] = useState(() => loadState('munchies_pointHistory', []));

  // Default weekly schedule
  const defaultWeeklySchedule = {
    Mon: { enabled: true, open: '17:00', close: '23:00' },
    Tue: { enabled: true, open: '17:00', close: '23:00' },
    Wed: { enabled: true, open: '17:00', close: '23:00' },
    Thu: { enabled: true, open: '17:00', close: '23:00' },
    Fri: { enabled: true, open: '17:00', close: '23:00' },
    Sat: { enabled: true, open: '17:00', close: '23:00' },
    Sun: { enabled: false, open: '17:00', close: '23:00' },
  };

  // Shop Settings State (Status: 'OPEN', 'PAUSED', 'CLOSED')
  const [shopSettings, setShopSettings] = useState(() => loadState('munchies_shop_settings', {
    status: 'OPEN',
    openingTime: '17:00',
    closingTime: '23:00',
    noticeMessage: '',
    weeklySchedule: defaultWeeklySchedule,
    specialClosures: []
  }));

  // Ref always holds the CURRENT value of shopSettings synchronously.
  // This prevents stale closures: reading shopSettingsRef.current is always up-to-date
  // even before React re-renders, unlike reading shopSettings from a closure.
  const shopSettingsRef = useRef(null);
  useEffect(() => { shopSettingsRef.current = shopSettings; }, [shopSettings]);
  // Also seed it immediately so it's valid before first render cycle
  if (shopSettingsRef.current === null) shopSettingsRef.current = loadState('munchies_shop_settings', {
    status: 'OPEN', openingTime: '17:00', closingTime: '23:00',
    noticeMessage: '', weeklySchedule: defaultWeeklySchedule, specialClosures: []
  });

  useEffect(() => { localStorage.setItem('munchies_cart', JSON.stringify(cart)); }, [cart]);
  useEffect(() => { localStorage.setItem('munchies_pointHistory', JSON.stringify(pointHistory)); }, [pointHistory]);
  useEffect(() => { localStorage.setItem('munchies_shop_settings', JSON.stringify(shopSettings)); }, [shopSettings]);

  const updateShopSettings = async (newSettingsOrFn) => {
    // Read CURRENT state synchronously from ref (never stale, even if called rapidly)
    const current = shopSettingsRef.current;
    const newSettings = typeof newSettingsOrFn === 'function' ? newSettingsOrFn(current) : newSettingsOrFn;

    // Guard: if updater returned empty (e.g. duplicate-closure guard), skip
    if (!newSettings || Object.keys(newSettings).length === 0) return;

    // Compute fullUpdated synchronously BEFORE any async or setState call
    const fullUpdated = { ...current, ...newSettings };
    if (fullUpdated.weeklySchedule) {
      // Always ensure all 7 days present (fill missing from defaults)
      fullUpdated.weeklySchedule = { ...defaultWeeklySchedule, ...fullUpdated.weeklySchedule };
    }

    // Update ref immediately so rapid consecutive calls always see latest value
    shopSettingsRef.current = fullUpdated;

    // Update React state (triggers re-render)
    setShopSettings(fullUpdated);

    // Persist to localStorage synchronously
    try { localStorage.setItem('munchies_shop_settings', JSON.stringify(fullUpdated)); } catch (e) {}

    // Sync to Supabase (fullUpdated is always defined here — no async race)
    try {
      await supabase.from('store_settings').upsert({
        id: 'main_store',
        status: fullUpdated.status,
        opening_time: fullUpdated.openingTime,
        closing_time: fullUpdated.closingTime,
        notice_message: fullUpdated.noticeMessage,
        weekly_schedule: fullUpdated.weeklySchedule,
        special_closures: fullUpdated.specialClosures,
        updated_at: new Date().toISOString()
      });
    } catch (e) {
      console.warn('[StoreContext] Could not sync store_settings:', e);
    }
  };

  const isShopOpenNow = () => {
    // ALWAYS read from ref to avoid stale closures in components that consume this function
    const settings = shopSettingsRef.current || shopSettings;

    // 1. Manual override always wins
    if (settings?.status === 'OPEN') return true;
    if (settings?.status === 'CLOSED' || settings?.status === 'PAUSED') return false;
    // 'SCHEDULE' or any other value → fall through to schedule logic

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0]; // 'YYYY-MM-DD'

    // 2. Check special closures (holidays/emergency)
    const specialClosures = settings?.specialClosures || [];
    if (specialClosures.some(c => c.date === todayStr)) return false;

    // 3. Check weekly schedule for today's day
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const todayKey = dayNames[now.getDay()];
    const weeklySchedule = settings?.weeklySchedule || {};
    const todaySchedule = weeklySchedule[todayKey];

    if (todaySchedule) {
      if (!todaySchedule.enabled) return false;
      const currentMins = now.getHours() * 60 + now.getMinutes();
      const openMins = parseTimeToMinutes(todaySchedule.open, '17:00');
      const closeMins = parseTimeToMinutes(todaySchedule.close, '23:00');
      if (openMins <= closeMins) {
        return currentMins >= openMins && currentMins <= closeMins;
      } else {
        return currentMins >= openMins || currentMins <= closeMins;
      }
    }

    // 4. Fallback to global opening/closing time
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const openMins = parseTimeToMinutes(settings?.openingTime, '17:00');
    const closeMins = parseTimeToMinutes(settings?.closingTime, '23:00');
    if (openMins <= closeMins) {
      return currentMins >= openMins && currentMins <= closeMins;
    } else {
      return currentMins >= openMins || currentMins <= closeMins;
    }
  };

  const points = user?.points || 0;
  const tier = points >= 5000 ? 'Gold' : points >= 1000 ? 'Silver' : 'Bronze';

  // --- Supabase Real-time Sync ---
  useEffect(() => {
    const fetchInitialData = async () => {
      // 0a. Fetch Loyalty Prizes
      try {
        const { data: prizesData } = await supabase.from('loyalty_prizes').select('*').eq('is_active', true).order('points_cost', { ascending: true });
        if (prizesData) setLoyaltyPrizes(prizesData);
      } catch (e) { console.warn('loyalty_prizes fetch failed:', e); }

            // 0. Fetch Store Settings
      try {
        const { data: settingsData, error: settingsErr } = await supabase.from('store_settings').select('*').eq('id', 'main_store').maybeSingle();
        if (settingsErr) {
          console.warn('[StoreContext] Failed to fetch store_settings:', settingsErr.message);
        } else if (settingsData) {
          console.log('[StoreContext] Loaded store_settings from DB:', settingsData.status, 'closures:', settingsData.special_closures?.length || 0);
          const loaded = {
            status: settingsData.status || 'OPEN',
            openingTime: settingsData.opening_time || '17:00',
            closingTime: settingsData.closing_time || '23:00',
            noticeMessage: settingsData.notice_message || '',
            weeklySchedule: { ...defaultWeeklySchedule, ...(settingsData.weekly_schedule || {}) },
            specialClosures: settingsData.special_closures || []
          };
          shopSettingsRef.current = loaded;
          setShopSettings(loaded);
        } else {
          console.warn('[StoreContext] No store_settings row found for main_store');
        }
      } catch (e) {
        console.warn('[StoreContext] store_settings fetch exception:', e);
      }
      // 1. Fetch Menu
      const { data: menuData, error: menuErr } = await supabase.from('menu_items').select('*').order('created_at', { ascending: true });
      if (menuData) setMenu(menuData.map(item => ({...item, inStock: item.in_stock, low_stock_threshold: item.low_stock_threshold ?? 10})));
      else console.error('Menu fetch error:', menuErr?.message || 'Unknown error', menuErr);

      // 2. Fetch Orders
      const { data: ordersData } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
      if (ordersData) {
        setOrders(ordersData);
      }

      // 3. Fetch Addons
      const { data: addonsData } = await supabase.from('addons').select('*').order('created_at', { ascending: true });
      if (addonsData) setAddons(addonsData);

      // 4. Fetch Item-Addon assignments
      const { data: assignmentsData } = await supabase.from('item_addons').select('*');
      if (assignmentsData) {
        const mapping = {};
        assignmentsData.forEach(row => {
          if (!mapping[row.menu_item_id]) mapping[row.menu_item_id] = [];
          mapping[row.menu_item_id].push(row.addon_id);
        });
        setItemAddons(mapping);
      }

      // 5. Fetch Profiles (Customers)
      const { data: profilesData } = await supabase.from('profiles').select('*');
      if (profilesData) setCustomers(profilesData);
    };

    fetchInitialData();

    // Set up Realtime subscriptions (with duplicate prevention for optimistic updates)
    const channel = supabase.channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_settings' }, payload => {
        if (payload.new) {
          const updated = {
            status: payload.new.status || 'OPEN',
            openingTime: payload.new.opening_time || '17:00',
            closingTime: payload.new.closing_time || '23:00',
            noticeMessage: payload.new.notice_message || '',
            weeklySchedule: { ...defaultWeeklySchedule, ...(payload.new.weekly_schedule || {}) },
            specialClosures: payload.new.special_closures || []
          };
          try { localStorage.setItem('munchies_shop_settings', JSON.stringify(updated)); } catch (e) {}
          shopSettingsRef.current = updated;
          setShopSettings(updated);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, payload => {
        if (payload.eventType === 'INSERT') {
          setMenu(prev => prev.some(i => i.id === payload.new.id) ? prev : [...prev, { ...payload.new, inStock: payload.new.in_stock, low_stock_threshold: payload.new.low_stock_threshold ?? 10 }]);
        } else if (payload.eventType === 'UPDATE') {
          setMenu(prev => prev.map(item => item.id === payload.new.id ? { ...payload.new, inStock: payload.new.in_stock, low_stock_threshold: payload.new.low_stock_threshold ?? 10 } : item));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, payload => {
        if (payload.eventType === 'INSERT') {
          setOrders(prev => prev.some(o => o.id === payload.new.id) ? prev : [payload.new, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          console.log(`[REALTIME LAG TEST] Realtime Event Received for ${payload.new.id} with status ${payload.new.status}: ${Date.now()}`);
          setOrders(prev => prev.map(o => o.id === payload.new.id ? payload.new : o));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'addons' }, payload => {
        if (payload.eventType === 'INSERT') setAddons(prev => prev.some(a => a.id === payload.new.id) ? prev : [...prev, payload.new]);
        else if (payload.eventType === 'DELETE') setAddons(prev => prev.filter(a => a.id !== payload.old.id));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'item_addons' }, payload => {
        if (payload.eventType === 'INSERT') {
          setItemAddons(prev => {
            const list = prev[payload.new.menu_item_id] || [];
            if (list.includes(payload.new.addon_id)) return prev; // skip duplicate
            return { ...prev, [payload.new.menu_item_id]: [...list, payload.new.addon_id] };
          });
        } else if (payload.eventType === 'DELETE') {
          setItemAddons(prev => {
            const list = prev[payload.old.menu_item_id] || [];
            return { ...prev, [payload.old.menu_item_id]: list.filter(id => id !== payload.old.addon_id) };
          });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, payload => {
        if (payload.eventType === 'INSERT') setCustomers(prev => [...prev, payload.new]);
        else if (payload.eventType === 'UPDATE') setCustomers(prev => prev.map(c => c.id === payload.new.id ? payload.new : c));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsRealtimeConnected(true);
        } else {
          setIsRealtimeConnected(false);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Polling fallback in case Supabase Realtime is disabled on the orders table
  // Acts as a periodic reconciliation safety net (30s) when Realtime is connected, 
  // and a fast primary sync (5s) when Realtime is disconnected.
  useEffect(() => {
    const pollInterval = isRealtimeConnected ? 15000 : 3000;
    const pollOrders = setInterval(async () => {
      // 0. Poll Store Settings (guarantees PAUSED/CLOSED sync across devices within 3s)
      try {
        const { data: settingsData } = await supabase.from('store_settings').select('*').eq('id', 'main_store').maybeSingle();
        if (settingsData) {
          const merged = {
            ...shopSettingsRef.current,
            status: settingsData.status || 'OPEN',
            openingTime: settingsData.opening_time || '10:00',
            closingTime: settingsData.closing_time || '22:00',
            noticeMessage: settingsData.notice_message || '',
            weeklySchedule: { ...defaultWeeklySchedule, ...(settingsData.weekly_schedule || {}) },
            specialClosures: settingsData.special_closures || []
          };
          shopSettingsRef.current = merged;
          setShopSettings(merged);
        }
      } catch (e) {}

      const { data: latestOrdersRaw } = await supabase.from('orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (latestOrdersRaw) {
        const latestOrders = latestOrdersRaw;
        setOrders(prev => {
          let newOrders = [...prev];
          let changed = false;
          latestOrders.forEach(lo => {
            const index = newOrders.findIndex(po => po.id === lo.id);
            if (index === -1) {
              newOrders.push(lo);
              changed = true;
            } else if (newOrders[index].status !== lo.status) {
              const statusOrder = { 'PENDING': 0, 'COOKING': 1, 'READY': 2, 'COLLECTED': 3, 'CANCELLED': 4 };
              const oldRank = statusOrder[newOrders[index].status] ?? 0;
              const newRank = statusOrder[lo.status] ?? 0;
              
              if (newRank >= oldRank) {
                newOrders[index] = lo;
                changed = true;
              }
            }
          });
          if (changed) {
            return newOrders.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
          }
          return prev;
        });
      }
    }, pollInterval);

    return () => clearInterval(pollOrders);
  }, [isRealtimeConnected]);

  // --- CRM & Admin Actions ---
  const toggleStock = async (id) => {
    const item = menu.find(i => i.id === id);
    if (!item) return;
    const newStatus = !item.inStock;
    
    let newQty = item.stock_quantity;
    
    // Auto-replenish stock to 99 if toggling ON while stock is 0
    if (newStatus && (newQty === undefined || newQty <= 0)) {
      newQty = 99;
    }
    
    // Optimistic UI update
    setMenu(menu.map(i => i.id === id ? { ...i, inStock: newStatus, stock_quantity: newQty } : i));
    
    // DB update
    await supabase.from('menu_items').update({ in_stock: newStatus, stock_quantity: newQty }).eq('id', id);
  };

  const updatePrice = async (id, newPriceFloat) => {
    const cents = Math.round(newPriceFloat * 100);
    
    // Optimistic UI update
    setMenu(menu.map(item => item.id === id ? { ...item, price: cents } : item));
    
    // DB update
    await supabase.from('menu_items').update({ price: cents }).eq('id', id);
  };

  const updateLowStockThreshold = async (id, threshold) => {
    const val = Math.max(0, parseInt(threshold) || 0);
    
    // Optimistic UI update
    setMenu(menu.map(item => item.id === id ? { ...item, low_stock_threshold: val } : item));
    
    // DB update
    await supabase.from('menu_items').update({ low_stock_threshold: val }).eq('id', id);
  };

  const addMenuItem = async (item) => {
    const newItem = {
      id: crypto.randomUUID(),
      name: item.name,
      category: item.category,
      price: Math.round(item.price * 100),
      image: item.image || '/images/hero_burger.png',
      description: item.description || '',
      in_stock: true,
      stock_quantity: 99
    };
    
    // Optimistic UI update (makes UI instant instead of waiting for realtime)
    setMenu(prev => [...prev, { ...newItem, inStock: newItem.in_stock }]);
    
    await supabase.from('menu_items').insert([newItem]);
  };

  const updateMenuItem = async (id, fields) => {
    const dbPayload = { ...fields };
    if (fields.price !== undefined) {
      dbPayload.price = Math.round(Number(fields.price));
    }
    if (fields.inStock !== undefined) {
      dbPayload.in_stock = fields.inStock;
    }

    // Optimistic UI update
    setMenu(prev => prev.map(item => item.id === id ? { ...item, ...fields } : item));

    // DB update
    await supabase.from('menu_items').update(dbPayload).eq('id', id);
  };

  const updateStock = async (id, delta) => {
    const item = menu.find(i => i.id === id);
    if (!item) return;
    
    let currentQty = parseInt(item.stock_quantity, 10);
    if (isNaN(currentQty)) currentQty = 0;
    
    const newQty = Math.max(0, currentQty + delta);
    const newInStock = newQty > 0;

    // Optimistic UI update
    setMenu(prev => prev.map(i => i.id === id
      ? { ...i, stock_quantity: newQty, inStock: newInStock, in_stock: newInStock }
      : i
    ));

    // DB update
    await supabase.from('menu_items')
      .update({ stock_quantity: newQty, in_stock: newInStock, manual_override: true })
      .eq('id', id);
  };

  const setStockQuantity = async (id, qty) => {
    const newQty = Math.max(0, Math.floor(Number(qty) || 0));
    const newInStock = newQty > 0;

    // Optimistic UI update
    setMenu(prev => prev.map(i => i.id === id
      ? { ...i, stock_quantity: newQty, inStock: newInStock, in_stock: newInStock }
      : i
    ));

    // DB update
    await supabase.from('menu_items')
      .update({ stock_quantity: newQty, in_stock: newInStock, manual_override: true })
      .eq('id', id);
  };

  
  const deleteMenuItem = async (id) => {
    try {
      const { error } = await supabase.from('menu_items').delete().eq('id', id);
      if (error) {
        console.error('Failed to delete menu item:', error);
        alert('Error deleting item: ' + error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error('Exception deleting menu item:', err);
      return false;
    }
  };

const clearManualOverride = async (id) => {
    // Optimistic UI update
    setMenu(prev => prev.map(i => i.id === id ? { ...i, manual_override: false } : i));
    
    // DB update
    await supabase.from('menu_items')
      .update({ manual_override: false })
      .eq('id', id);
  };

  // Category CRM State
  const [categoriesList, setCategoriesList] = useState(() => {
    try {
      const saved = localStorage.getItem('munchies_categories_crm');
      return saved ? JSON.parse(saved) : [
        { id: 'cat-1', code: 'BBQ', label: 'BBQ Burgers', icon: '🔥', color: '#ef4444' },
        { id: 'cat-2', code: 'PREMIUM', label: 'Premium Combos', icon: '👑', color: '#8b5cf6' },
        { id: 'cat-3', code: 'PLATTERS', label: 'Platters', icon: '🍽️', color: '#f59e0b' },
        { id: 'cat-4', code: 'SIDES', label: 'Fries & Sides', icon: '🥗', color: '#10b981' },
        { id: 'cat-5', code: 'DRINKS', label: 'Drinks & Desserts', icon: '🥤', color: '#3b82f6' }
      ];
    } catch (e) {
      return [];
    }
  });

  const saveCategoriesList = (newList) => {
    setCategoriesList(newList);
    localStorage.setItem('munchies_categories_crm', JSON.stringify(newList));
  };

  const addCategory = (code, label, icon, color) => {
    const codeClean = (code || label).toUpperCase().replace(/\s+/g, '_');
    const newCat = {
      id: 'cat-' + Date.now(),
      code: codeClean,
      label: label || codeClean,
      icon: icon || '🍔',
      color: color || '#ef4444'
    };
    const newList = [...categoriesList, newCat];
    saveCategoriesList(newList);
    return newCat;
  };

  const updateCategory = (id, fields) => {
    const updated = categoriesList.map(c => c.id === id ? { ...c, ...fields } : c);
    saveCategoriesList(updated);
  };

  const deleteCategory = (id) => {
    const updated = categoriesList.filter(c => c.id !== id);
    saveCategoriesList(updated);
  };

  const isPromoActive = (item) => {
    if (!item.promo_price) return false;
    const now = new Date();
    const start = item.promo_start ? new Date(item.promo_start) : null;
    const end = item.promo_end ? new Date(item.promo_end) : null;
    if (start && now < start) return false;
    if (end && now > end) return false;
    return true;
  };

  const updatePromo = async (id, promoPriceCents, startDateIso, endDateIso) => {
    const promoData = {
      promo_price: promoPriceCents || null,
      promo_start: startDateIso || null,
      promo_end: endDateIso || null,
    };
    
    // Optimistic UI update
    setMenu(prev => prev.map(m => m.id === id ? { ...m, ...promoData } : m));
    
    // DB update
    await supabase.from('menu_items').update(promoData).eq('id', id);
  };

  const updateOrderState = async (orderId, newState) => {
    // Save original state for potential rollback
    const originalOrders = [...orders];

    // Optimistic UI update
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newState } : o));
    
    // DB update
    const { error } = await supabase.from('orders').update({ status: newState }).eq('id', orderId);
    if (error) {
      console.error("Failed to update order state:", error);
      alert("Failed to update order status: " + error.message);
      // Revert optimistic update
      setOrders(originalOrders);
    }
  };

  const cancelOrder = async (orderId, reason, wasteAction = 'restore') => {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status === 'COLLECTED' || order.status === 'CANCELLED') return;

    // Optimistic update
    setOrders(orders.map(o => o.id === orderId ? { ...o, status: 'CANCELLED', cancellation_reason: reason, cancel_reason: reason } : o));

    // 1. Try atomic RPC first
    const { error: rpcError } = await supabase.rpc('cancel_order', {
      p_order_id: orderId,
      p_reason: reason,
      p_waste_action: wasteAction // 'restore' or 'waste'
    });

    // 2. Fallback removed. We strictly rely on the atomic cancel_order RPC above.
    if (rpcError) {
      console.error('RPC cancel_order failed:', rpcError.message);
      alert('Failed to cancel order: ' + rpcError.message);
      // Revert optimistic update
      setOrders(orders.map(o => o.id === orderId ? order : o));
    }
  };

  // Admin accepts an incoming PENDING order → starts the timer
  const acceptOrder = async (orderId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    // Dynamic cook time: ≥ RM100 (10000 cents) → 20 min, else 15 min
    const cookSeconds = order.total >= 10000 ? 1200 : 900;
    const nowStr = new Date().toISOString();

    // Optimistic update (keeps local timer state intact)
    setOrders(prev => prev.map(o => o.id === orderId
      ? { ...o, status: 'COOKING', cooking_started_at: nowStr, cook_time_seconds: cookSeconds }
      : o
    ));

    let { error } = await supabase.from('orders')
      .update({ 
        status: 'COOKING',
        cooking_started_at: nowStr,
        cook_time_seconds: cookSeconds
      })
      .eq('id', orderId);

    // Fallback if the user's database has cooking_started_at as bigint (int8) instead of timestamptz
    if (error && error.message.includes("type bigint")) {
      const { error: retryError } = await supabase.from('orders')
        .update({ 
          status: 'COOKING',
          cooking_started_at: Date.now(),
          cook_time_seconds: cookSeconds
        })
        .eq('id', orderId);
      error = retryError;
    }

    if (error) {
       console.error("Failed to accept order:", error);
       alert("Failed to accept order: " + error.message + " (Did you run the SQL migration?)");
       // Revert optimistic update
       setOrders(prev => prev.map(o => o.id === orderId ? order : o));
       return;
    }
    
    console.log(`[REALTIME LAG TEST] DB Write Succeeded for ${orderId}: ${Date.now()}`);
  };

  const addPoints = async (amount, description) => {
    if (!user || !user.id || !amount) return; // Only logged in users get points
    
    const currentPoints = user.points || 0;
    const newTotal = currentPoints + amount;

    // 1. Update user state locally so UI updates instantly across header, profile, arcade
    setUser(prev => prev ? ({ ...prev, points: newTotal }) : prev);
    try {
      localStorage.setItem(`munchies_pts_${user.id}`, newTotal.toString());
    } catch (e) {}

    // 2. Call RPC first
    const { error: rpcErr } = await supabase.rpc('award_points', {
      user_id_param: user.id,
      amount_param: amount
    });
    
    // 3. Fallback direct update to profiles table if RPC fails or not installed
    if (rpcErr) {
      console.warn('RPC award_points warning, performing direct profiles update:', rpcErr.message);
      await supabase.from('profiles').update({ points: newTotal }).eq('id', user.id);
    }

    setPointHistory(prev => [{
      id: `TXN-${Math.floor(Math.random() * 10000)}`,
      date: new Date().toISOString().split('T')[0],
      type: 'Earned',
      amount, description
    }, ...prev]);
  };

  const redeemPrize = async (prizeId) => {
    if (!user || !user.id) {
      alert('You must be logged in to redeem prizes.');
      return null;
    }
    const { data, error } = await supabase.rpc('redeem_prize', {
      p_user_id: user.id,
      p_prize_id: prizeId
    });
    if (error) {
      alert('Redemption failed: ' + error.message);
      return null;
    }
    if (!data.success) {
      alert('Redemption failed: ' + data.error);
      return null;
    }
    // Deduct points locally
    const spent = data.points_spent;
    setUser(prev => prev ? ({ ...prev, points: (prev.points || 0) - spent }) : prev);
    try { localStorage.setItem('munchies_pts_' + user.id, ((user.points || 0) - spent).toString()); } catch(e) {}
    return data;
  };

  const fetchAdminRedemptions = async () => {
    const { data, error } = await supabase.from('redemptions').select('*, profiles:user_id(name, phone)').order('redeemed_at', { ascending: false }).limit(100);
    if (!error && data) setRedemptions(data);
  };

  const fulfillRedemption = async (redemptionId, adminId) => {
    const { data, error } = await supabase.rpc('fulfill_redemption', {
      p_redemption_id: redemptionId,
      p_admin_id: adminId
    });
    if (error || !data?.success) {
      alert('Failed to fulfill: ' + (error?.message || data?.error));
      return false;
    }
    setRedemptions(prev => prev.map(r => r.id === redemptionId ? { ...r, status: 'FULFILLED', fulfilled_at: new Date().toISOString() } : r));
    // Refresh menu stock locally
    const { data: freshMenu } = await supabase.from('menu_items').select('*');
    if (freshMenu) setMenu(freshMenu.map(item => ({ ...item, inStock: item.in_stock, price: item.price })));
    return true;
  };

  const addLoyaltyPrize = async (prizeData) => {
    const { data, error } = await supabase.from('loyalty_prizes').insert([prizeData]).select().single();
    if (error) { alert('Failed to create prize: ' + error.message); return null; }
    setLoyaltyPrizes(prev => [...prev, data]);
    return data;
  };

  const updateLoyaltyPrize = async (id, fields) => {
    const { error } = await supabase.from('loyalty_prizes').update(fields).eq('id', id);
    if (error) { alert('Failed to update prize: ' + error.message); return false; }
    setLoyaltyPrizes(prev => prev.map(p => p.id === id ? { ...p, ...fields } : p));
    return true;
  };

  const deleteLoyaltyPrize = async (id) => {
    const { error } = await supabase.from('loyalty_prizes').update({ is_active: false }).eq('id', id);
    if (error) { alert('Failed to delete prize: ' + error.message); return false; }
    setLoyaltyPrizes(prev => prev.filter(p => p.id !== id));
    return true;
  };

    const claimShareBonus = async (amount, description) => {
    if (!user || !user.id || !amount) return;

    // Call RPC to atomically check limit and award points
    const { error: rpcErr } = await supabase.rpc('claim_share_bonus', {
      user_id_param: user.id,
      amount_param: amount
    });

    if (rpcErr) {
      throw rpcErr; // Throw to be caught and alerted in the UI
    }

    // On success, update local state
    const currentPoints = user.points || 0;
    const newTotal = currentPoints + amount;

    setUser(prev => prev ? ({ ...prev, points: newTotal }) : prev);
    try {
      localStorage.setItem(`munchies_pts_${user.id}`, newTotal.toString());
    } catch (e) {}

    setPointHistory(prev => [{
      id: `TXN-${Math.floor(Math.random() * 10000)}`,
      date: new Date().toISOString().split('T')[0],
      type: 'Bonus',
      amount, description
    }, ...prev]);
  };

  return (
    <StoreContext.Provider value={{
      menu, cart, cartTotal, cartCount,
      points, tier, pointHistory, orders, addons, itemAddons, customers,
      toggleStock, updatePrice, updateLowStockThreshold, addMenuItem, updateMenuItem, deleteMenuItem, updateOrderState, acceptOrder, cancelOrder,
      updateStock, setStockQuantity, clearManualOverride,
      isPromoActive, updatePromo,
      addons, addAddon, deleteAddon, itemAddons, toggleItemAddon, uploadImage, updateAddonPrice,
      addToCart, removeFromCart, updateQuantity, clearCart, updateCartItemAddons,
      placeOrder, addPoints, claimShareBonus,
      loyaltyPrizes, redemptions, redeemPrize, fetchAdminRedemptions, fulfillRedemption,
      addLoyaltyPrize, updateLoyaltyPrize, deleteLoyaltyPrize,
      categoriesList, addCategory, updateCategory, deleteCategory,
      shopSettings, updateShopSettings, isShopOpenNow
    }}>
      {children}
    </StoreContext.Provider>
  );
}

export const useStore = () => useContext(StoreContext);
