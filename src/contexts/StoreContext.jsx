import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../config/supabase';
import { useAuth } from './AuthContext';

const StoreContext = createContext();

export function StoreProvider({ children }) {
  const { user } = useAuth();

  const [menu, setMenu] = useState([]);
  const [addons, setAddons] = useState([]);
  const [itemAddons, setItemAddons] = useState({});
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);

  // Local-only state for Cart & Point History
  const loadState = (key, defaultVal) => {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : defaultVal;
  };
  const [cart, setCart] = useState(() => loadState('munchies_cart', []));
  const [pointHistory, setPointHistory] = useState(() => loadState('munchies_pointHistory', []));

  useEffect(() => { localStorage.setItem('munchies_cart', JSON.stringify(cart)); }, [cart]);
  useEffect(() => { localStorage.setItem('munchies_pointHistory', JSON.stringify(pointHistory)); }, [pointHistory]);

  const points = user?.points || 0;
  const tier = points >= 5000 ? 'Gold' : points >= 1000 ? 'Silver' : 'Bronze';

  // --- Supabase Real-time Sync ---
  useEffect(() => {
    const fetchInitialData = async () => {
      // 1. Fetch Menu
      const { data: menuData, error: menuErr } = await supabase.from('menu_items').select('*').order('created_at', { ascending: true });
      if (menuData) setMenu(menuData.map(item => ({...item, inStock: item.in_stock, low_stock_threshold: item.low_stock_threshold ?? 5})));
      else console.error('Menu fetch error:', menuErr);

      // 2. Fetch Orders (Filtering out all orders created before this moment to provide a clean slate)
      const { data: ordersData } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
      if (ordersData) {
        setOrders(ordersData.filter(o => new Date(o.created_at || 0) > new Date('2026-07-31T11:20:00Z')));
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, payload => {
        if (payload.eventType === 'INSERT') {
          setMenu(prev => prev.some(i => i.id === payload.new.id) ? prev : [...prev, { ...payload.new, inStock: payload.new.in_stock, low_stock_threshold: payload.new.low_stock_threshold ?? 5 }]);
        } else if (payload.eventType === 'UPDATE') {
          setMenu(prev => prev.map(item => item.id === payload.new.id ? { ...payload.new, inStock: payload.new.in_stock, low_stock_threshold: payload.new.low_stock_threshold ?? 5 } : item));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, payload => {
        if (payload.eventType === 'INSERT') {
          setOrders(prev => prev.some(o => o.id === payload.new.id) ? prev : [payload.new, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Polling fallback in case Supabase Realtime is disabled on the orders table
  useEffect(() => {
    const pollOrders = setInterval(async () => {
      const { data: latestOrdersRaw } = await supabase.from('orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (latestOrdersRaw) {
        const latestOrders = latestOrdersRaw.filter(o => new Date(o.created_at || 0) > new Date('2026-07-31T11:20:00Z'));
        setOrders(prev => {
          let newOrders = [...prev];
          let changed = false;
          latestOrders.forEach(lo => {
            const index = newOrders.findIndex(po => po.id === lo.id);
            if (index === -1) {
              newOrders.push(lo);
              changed = true;
            } else if (newOrders[index].status !== lo.status) {
              newOrders[index] = lo;
              changed = true;
            }
          });
          if (changed) {
            return newOrders.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
          }
          return prev;
        });
      }
    }, 5000); // 5 second polling

    return () => clearInterval(pollOrders);
  }, []);

  // --- CRM & Admin Actions ---
  const toggleStock = async (id) => {
    const item = menu.find(i => i.id === id);
    if (!item) return;
    const newStatus = !item.inStock;
    
    // Optimistic UI update
    setMenu(menu.map(i => i.id === id ? { ...i, inStock: newStatus } : i));
    
    // DB update
    await supabase.from('menu_items').update({ in_stock: newStatus }).eq('id', id);
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
      id: Date.now().toString(),
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

  const updateStock = async (id, delta) => {
    const item = menu.find(i => i.id === id);
    if (!item) return;
    const newQty = Math.max(0, (item.stock_quantity ?? 99) + delta);
    const newInStock = newQty > 0;

    // Optimistic UI update
    setMenu(prev => prev.map(i => i.id === id
      ? { ...i, stock_quantity: newQty, inStock: newInStock, in_stock: newInStock }
      : i
    ));

    // DB update
    await supabase.from('menu_items')
      .update({ stock_quantity: newQty, in_stock: newInStock })
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
      .update({ stock_quantity: newQty, in_stock: newInStock })
      .eq('id', id);
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
    // Optimistic UI update
    setOrders(orders.map(o => o.id === orderId ? { ...o, status: newState } : o));
    
    // DB update
    await supabase.from('orders').update({ status: newState }).eq('id', orderId);
  };

  const cancelOrder = async (orderId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status === 'COLLECTED' || order.status === 'CANCELLED') return;

    // Optimistic update
    setOrders(orders.map(o => o.id === orderId ? { ...o, status: 'CANCELLED' } : o));
    
    // DB update
    await supabase.from('orders').update({ status: 'CANCELLED' }).eq('id', orderId);

    // Revert stock logically
    const stockAdditions = {};
    (order.items || []).forEach(item => {
      stockAdditions[item.id] = (stockAdditions[item.id] || 0) + (item.quantity || 1);
    });

    for (const [itemId, qtyToRestore] of Object.entries(stockAdditions)) {
      const menuItem = menu.find(m => m.id === itemId);
      if (!menuItem || menuItem.stock_quantity == null) continue;
      const newQty = menuItem.stock_quantity + qtyToRestore;
      const newInStock = newQty > 0;
      setMenu(prev => prev.map(i => i.id === itemId ? { ...i, stock_quantity: newQty, inStock: newInStock, in_stock: newInStock } : i));
      await supabase.from('menu_items').update({ stock_quantity: newQty, in_stock: newInStock }).eq('id', itemId);
    }
  };

  const uploadImage = async (file) => {
    if (!file) return null;
    
    // Generate a unique filename
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
    
    const { data, error } = await supabase.storage
      .from('menu-images')
      .upload(fileName, file);
      
    if (error) {
      console.error('Error uploading image:', error);
      throw error;
    }
    
    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('menu-images')
      .getPublicUrl(fileName);
      
    return publicUrlData.publicUrl;
  };
  
  const addAddon = async (name, priceFloat, image = null) => {
    const cents = priceFloat === '' ? null : Math.round(parseFloat(priceFloat) * 100);
    const newAddon = {
      id: `a${Date.now()}`,
      name,
      price: cents,
      image
    };
    
    // Insert into DB FIRST, only update UI if successful
    const { error } = await supabase.from('addons').insert([newAddon]);
    if (error) {
      console.error('Failed to add addon:', error);
      alert('Failed to add addon: ' + error.message);
      throw error;
    }
    
    // Only add to UI after DB confirms success
    setAddons(prev => [...prev, newAddon]);
  };
  
  const deleteAddon = async (id) => {
    // Optimistic UI update
    setAddons(prev => prev.filter(a => a.id !== id));
    await supabase.from('addons').delete().eq('id', id);
  };
  
  const updateAddonPrice = async (id, newPriceFloat) => {
    const cents = newPriceFloat === '' || isNaN(newPriceFloat) ? null : Math.round(newPriceFloat * 100);
    
    // Optimistic UI update
    setAddons(addons.map(a => a.id === id ? { ...a, price: cents } : a));
    
    // DB update
    await supabase.from('addons').update({ price: cents }).eq('id', id);
  };
  
  const toggleItemAddon = async (itemId, addonId) => {
    const currentList = itemAddons[itemId] || [];
    const isLinked = currentList.includes(addonId);
    
    if (isLinked) {
      // Optimistic: remove from UI immediately
      setItemAddons(prev => ({
        ...prev,
        [itemId]: (prev[itemId] || []).filter(id => id !== addonId)
      }));
      // Unlink in DB
      const { error } = await supabase.from('item_addons').delete().match({ menu_item_id: itemId, addon_id: addonId });
      if (error) {
        console.error('Failed to unlink addon:', error);
        alert('Failed to unlink addon: ' + error.message);
        // Revert on failure
        setItemAddons(prev => ({
          ...prev,
          [itemId]: [...(prev[itemId] || []), addonId]
        }));
      }
    } else {
      // Optimistic: add to UI immediately
      setItemAddons(prev => ({
        ...prev,
        [itemId]: [...(prev[itemId] || []), addonId]
      }));
      // Link in DB
      const { error } = await supabase.from('item_addons').insert([{ menu_item_id: itemId, addon_id: addonId }]);
      if (error) {
        console.error('Failed to link addon:', error);
        alert('Failed to link addon: ' + error.message);
        // Revert on failure
        setItemAddons(prev => ({
          ...prev,
          [itemId]: (prev[itemId] || []).filter(id => id !== addonId)
        }));
      } else {
        console.log('Successfully linked addon', addonId, 'to item', itemId);
      }
    }
  };

  // --- Customer Actions ---
  const addToCart = (item, selectedAddons = []) => {
    const addonKey = selectedAddons.map(a => a.id).sort().join('_');
    const cartItemId = addonKey ? `${item.id}_${addonKey}` : item.id;

    // ✅ Check stock OUTSIDE setCart using current cart state
    const totalInCart = cart
      .filter(i => i.id === item.id)
      .reduce((sum, i) => sum + i.quantity, 0);

    const stock = item.stock_quantity ?? null;
    if (stock !== null && totalInCart >= stock) {
      alert(`Sorry! Only ${stock} left in stock for ${item.name}.`);
      return; // abort — do NOT call setCart
    }

    setCart(prev => {
      const existing = prev.find(i => i.cartItemId === cartItemId);
      if (existing) {
        return prev.map(i => i.cartItemId === cartItemId ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { ...item, cartItemId, selectedAddons, quantity: 1 }];
    });
  };

  const removeFromCart = (cartItemId) => setCart(prev => prev.filter(i => i.cartItemId !== cartItemId));

  const updateQuantity = (cartItemId, quantity) => {
    if (quantity <= 0) return removeFromCart(cartItemId);

    // ✅ Check stock OUTSIDE setCart using current cart state
    const targetItem = cart.find(i => i.cartItemId === cartItemId);
    if (!targetItem) return;

    const otherQty = cart
      .filter(i => i.id === targetItem.id && i.cartItemId !== cartItemId)
      .reduce((sum, i) => sum + i.quantity, 0);

    const stock = targetItem.stock_quantity ?? null;
    if (stock !== null && (otherQty + quantity) > stock) {
      alert(`Sorry! Only ${stock} left in stock for ${targetItem.name}.`);
      return; // abort — do NOT call setCart
    }

    setCart(prev => prev.map(i => i.cartItemId === cartItemId ? { ...i, quantity } : i));
  };

  const updateCartItemAddons = (oldCartItemId, newSelectedAddons) => {
    setCart(prev => {
      const oldItem = prev.find(i => i.cartItemId === oldCartItemId);
      if (!oldItem) return prev;

      const addonKey = newSelectedAddons.map(a => a.id).sort().join('_');
      const newCartItemId = addonKey ? `${oldItem.id}_${addonKey}` : oldItem.id;

      if (newCartItemId === oldCartItemId) return prev; // no change

      const existingItem = prev.find(i => i.cartItemId === newCartItemId);
      if (existingItem) {
        // Merge quantities if the new addon combo already exists
        return prev
          .map(i => i.cartItemId === newCartItemId ? { ...i, quantity: i.quantity + oldItem.quantity } : i)
          .filter(i => i.cartItemId !== oldCartItemId);
      } else {
        // Just update the item in place
        return prev.map(i => i.cartItemId === oldCartItemId ? { ...i, cartItemId: newCartItemId, selectedAddons: newSelectedAddons } : i);
      }
    });
  };

  const clearCart = () => setCart([]);


  const cartTotal = cart.reduce((total, cartItem) => {
    const menuItem = menu.find(m => m.id === cartItem.id);
    if (!menuItem) return total;
    const priceToUse = isPromoActive(menuItem) ? menuItem.promo_price : menuItem.price;
    const addonsTotal = (cartItem.selectedAddons || []).reduce((sum, a) => sum + (a.price || 0), 0);
    return total + ((priceToUse + addonsTotal) * cartItem.quantity);
  }, 0);


  const cartCount = cart.reduce((count, item) => count + item.quantity, 0);

  const placeOrder = async (paymentMethod = 'Cash') => {
    if (cart.length === 0) return null;

    // Calculate deductions
    const stockDeductions = {};
    cart.forEach(cartItem => {
      stockDeductions[cartItem.id] = (stockDeductions[cartItem.id] || 0) + cartItem.quantity;
    });

    // Fallback: Client-side insert to completely bypass Supabase RPC schema cache issues
    const newOrder = {
      id: crypto.randomUUID(),
      items: cart,
      total: cartTotal,
      status: 'PENDING',
      payment_method: paymentMethod,
      customer_name: user ? user.name : 'Guest',
      customer_phone: user && user.phone ? user.phone : 'No Phone',
      user_id: user ? user.id : null
    };

    const { data, error } = await supabase.from('orders').insert([newOrder]).select('id').single();

    if (error) {
      console.error('Failed to place order in DB:', error);
      alert('Failed to place order. Database error: ' + error.message);
      return null;
    }

    const newOrderId = data.id;

    // Deduct stock in DB
    for (const [itemId, qtyOrdered] of Object.entries(stockDeductions)) {
      const menuItem = menu.find(m => m.id === itemId);
      if (!menuItem || menuItem.stock_quantity === null || menuItem.stock_quantity === undefined) continue;

      const newQty = Math.max(0, menuItem.stock_quantity - qtyOrdered);
      const newInStock = newQty > 0;

      // Optimistically update stock in the UI
      setMenu(prev => prev.map(i => i.id === itemId
        ? { ...i, stock_quantity: newQty, inStock: newInStock, in_stock: newInStock }
        : i
      ));
      
      // Update DB
      await supabase.from('menu_items').update({
        stock_quantity: newQty,
        in_stock: newInStock
      }).eq('id', itemId);
    }

    // Optimistically add to local orders so it appears instantly for the Admin
    const completeNewOrder = { ...newOrder, id: newOrderId, created_at: new Date().toISOString() };
    setOrders(prev => [completeNewOrder, ...prev]);

    clearCart();
    return newOrderId;
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

    const { error } = await supabase.from('orders')
      .update({ status: 'COOKING' })
      .eq('id', orderId);

    if (error) {
       console.error("Failed to accept order:", error);
    }
  };

  const addPoints = async (amount, description) => {
    if (!user) return; // Only logged in users get points
    
    // Call RPC to award points atomically
    const { error } = await supabase.rpc('award_points', {
      user_id_param: user.id,
      amount_param: amount
    });
    
    if (error) {
      console.error('Failed to award points via RPC:', error);
      return;
    }
    
    // Update user object locally so UI updates instantly
    const newTotal = (user.points || 0) + amount;
    user.points = newTotal;

    setPointHistory(prev => [{
      id: `TXN-${Math.floor(Math.random() * 10000)}`,
      date: new Date().toISOString().split('T')[0],
      type: 'Earned',
      amount, description
    }, ...prev]);
  };

  return (
    <StoreContext.Provider value={{
      menu, cart, cartTotal, cartCount,
      points, tier, pointHistory, orders, addons, itemAddons, customers,
      toggleStock, updatePrice, updateLowStockThreshold, addMenuItem, updateOrderState, acceptOrder, cancelOrder,
      isPromoActive, updatePromo,
      addons, addAddon, deleteAddon, itemAddons, toggleItemAddon, uploadImage, updateAddonPrice,
      addToCart, removeFromCart, updateQuantity, clearCart, updateCartItemAddons,
      placeOrder, addPoints
    }}>
      {children}
    </StoreContext.Provider>
  );
}

export const useStore = () => useContext(StoreContext);
