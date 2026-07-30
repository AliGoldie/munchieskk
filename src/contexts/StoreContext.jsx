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
      if (menuData) setMenu(menuData.map(item => ({...item, inStock: item.in_stock})));
      else console.error('Menu fetch error:', menuErr);

      // 2. Fetch Orders
      const { data: ordersData } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
      if (ordersData) setOrders(ordersData);

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
    };

    fetchInitialData();

    // Set up Realtime subscriptions (with duplicate prevention for optimistic updates)
    const channel = supabase.channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, payload => {
        if (payload.eventType === 'INSERT') {
          setMenu(prev => prev.some(i => i.id === payload.new.id) ? prev : [...prev, { ...payload.new, inStock: payload.new.in_stock }]);
        } else if (payload.eventType === 'UPDATE') {
          setMenu(prev => prev.map(item => item.id === payload.new.id ? { ...payload.new, inStock: payload.new.in_stock } : item));
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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

  const updateOrderState = async (orderId, newState) => {
    // Optimistic UI update
    setOrders(orders.map(o => o.id === orderId ? { ...o, status: newState } : o));
    
    // DB update
    await supabase.from('orders').update({ status: newState }).eq('id', orderId);
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

  const clearCart = () => setCart([]);


  const cartTotalCents = cart.reduce((total, item) => {
    const addonTotal = (item.selectedAddons || []).reduce((sum, a) => sum + (a.price || 0), 0);
    return total + ((item.price + addonTotal) * item.quantity);
  }, 0);
  const cartCount = cart.reduce((count, item) => count + item.quantity, 0);

  const placeOrder = async (paymentMethod = 'Cash') => {
    if (cart.length === 0) return null;

    const newOrder = {
      id: `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
      items: cart,
      total: cartTotalCents,
      status: 'PENDING',
      cooking_started_at: null,
      cook_time_seconds: null,
      payment_method: paymentMethod,
      customer_name: user ? user.name : 'Guest',
      customer_phone: user && user.phone ? user.phone : 'No Phone',
      user_id: user ? user.id : null
    };

    // Save order to Supabase
    const { error } = await supabase.from('orders').insert([newOrder]);
    if (error) {
      console.error('Failed to place order in DB:', error);
      alert('Failed to place order. Database error: ' + error.message);
      return null;
    }

    // Deduct stock for each ordered item (group by base item.id)
    const stockDeductions = {};
    cart.forEach(cartItem => {
      stockDeductions[cartItem.id] = (stockDeductions[cartItem.id] || 0) + cartItem.quantity;
    });

    for (const [itemId, qtyOrdered] of Object.entries(stockDeductions)) {
      const menuItem = menu.find(m => m.id === itemId);
      if (!menuItem || menuItem.stock_quantity === null || menuItem.stock_quantity === undefined) continue;

      const newQty = Math.max(0, menuItem.stock_quantity - qtyOrdered);
      const newInStock = newQty > 0;

      setMenu(prev => prev.map(i => i.id === itemId
        ? { ...i, stock_quantity: newQty, inStock: newInStock, in_stock: newInStock }
        : i
      ));

      await supabase.from('menu_items')
        .update({ stock_quantity: newQty, in_stock: newInStock })
        .eq('id', itemId);
    }

    clearCart();
    return newOrder.id;
  };

  // Admin accepts an incoming PENDING order → starts the timer
  const acceptOrder = async (orderId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    // Dynamic cook time: ≥ RM100 (10000 cents) → 20 min, else 15 min
    const cookSeconds = order.total >= 10000 ? 1200 : 900;
    const now = Date.now();

    // Optimistic update
    setOrders(prev => prev.map(o => o.id === orderId
      ? { ...o, status: 'COOKING', cooking_started_at: now, cook_time_seconds: cookSeconds }
      : o
    ));

    await supabase.from('orders')
      .update({ status: 'COOKING', cooking_started_at: now, cook_time_seconds: cookSeconds })
      .eq('id', orderId);
  };

  const addPoints = async (amount, description) => {
    if (!user) return; // Only logged in users get points
    
    const newTotal = (user.points || 0) + amount;
    
    // Update local user object optimistically or trigger a re-fetch (we can just update DB and let them refresh or optimistically update context if we had a setUser)
    // For now we'll just write to DB, and the onAuthStateChange or a page reload will fetch it
    await supabase.from('profiles').update({ points: newTotal }).eq('id', user.id);
    
    // Update user object locally so UI updates instantly
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
      menu, cart, cartTotal: cartTotalCents, cartCount,
      points, tier, pointHistory, orders, addons, itemAddons,
      toggleStock, updatePrice, addMenuItem, updateOrderState, updateStock, setStockQuantity,
      uploadImage, addAddon, deleteAddon, toggleItemAddon, updateAddonPrice,
      addToCart, removeFromCart, updateQuantity, clearCart,
      placeOrder, acceptOrder, addPoints
    }}>
      {children}
    </StoreContext.Provider>
  );
}

export const useStore = () => useContext(StoreContext);
