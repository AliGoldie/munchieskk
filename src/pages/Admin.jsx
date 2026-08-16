import { useState, useEffect, useRef, useMemo } from 'react';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import { Navigate, useNavigate } from 'react-router-dom';
import { startNewOrderAlert, stopNewOrderAlert } from '../utils/soundAlert';
import { formatTime12Hour } from '../utils/timeUtils';
import { supabase } from '../config/supabase';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  ComposedChart, Area, Line, Legend, PieChart, Pie, Cell
} from 'recharts';
import { LayoutDashboard, BarChart2, ShoppingBag, Users, Layers, PlusSquare, TrendingUp, CheckCircle, AlertTriangle, Calendar, Archive, ArrowDown, Bookmark, Gift, Ticket } from 'lucide-react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import './Admin.css';

export default function Admin() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { 
    menu, toggleStock, updatePrice, updateLowStockThreshold, addMenuItem, updateMenuItem, deleteMenuItem, updateStock, setStockQuantity, clearManualOverride,
    orders, updateOrderState, acceptOrder, customers, cancelOrder,
    addons, itemAddons, addAddon, deleteAddon, toggleItemAddon, uploadImage, updateAddonPrice,
    loyaltyPrizes, redemptions, fetchAdminRedemptions, fulfillRedemption, addLoyaltyPrize, updateLoyaltyPrize, deleteLoyaltyPrize,
    isPromoActive, updatePromo,
    categoriesList, addCategory, updateCategory, deleteCategory,
    shopSettings, updateShopSettings, isShopOpenNow
  } = useStore();
  
  const [editingPrice, setEditingPrice] = useState({});
  const [editingAddonPrice, setEditingAddonPrice] = useState({});
  const [editingStock, setEditingStock] = useState({});
  const [editingLowStock, setEditingLowStock] = useState({});
  const [editingPromo, setEditingPromo] = useState({});

  // Menu Item Detail Editing State
  const [editingMenuItem, setEditingMenuItem] = useState(null);
  const [cancellingOrder, setCancellingOrder] = useState(null);
  const [editingMenuItemImageFile, setEditingMenuItemImageFile] = useState(null);

  // Category CRM State
  const [newCatCode, setNewCatCode] = useState('');
  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('🍔');
  const [newCatColor, setNewCatColor] = useState('#ef4444');
  const [editingCat, setEditingCat] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  // Local draft state for the schedule modal — avoids stale closure bugs
  const [localSchedule, setLocalSchedule] = useState(null);
  const [localClosures, setLocalClosures] = useState(null);

  // Ref for localSchedule so saveScheduleDay can read it synchronously
  // MUST be declared before openScheduleModal which references it
  const localScheduleRef = useRef(null);

  const openScheduleModal = () => {
    // Deep-copy current shopSettings into local draft when opening modal
    const defaultDays = { Mon: { enabled: true, open: '17:00', close: '23:00' }, Tue: { enabled: true, open: '17:00', close: '23:00' }, Wed: { enabled: true, open: '17:00', close: '23:00' }, Thu: { enabled: true, open: '17:00', close: '23:00' }, Fri: { enabled: true, open: '17:00', close: '23:00' }, Sat: { enabled: true, open: '17:00', close: '23:00' }, Sun: { enabled: true, open: '17:00', close: '23:00' } };
    const merged = { ...defaultDays };
    const ws = shopSettings?.weeklySchedule || {};
    Object.keys(ws).forEach(d => { merged[d] = { ...merged[d], ...ws[d] }; });
    setLocalSchedule(merged);
    localScheduleRef.current = merged;
    setLocalClosures([...(shopSettings?.specialClosures || [])]);
    setScheduleModalOpen(true);
  };


  const saveScheduleDay = (day, patch) => {
    // Compute new state from latest localScheduleRef (always current, never stale)
    const current = localScheduleRef.current || {};
    const dayUpdated = { ...current[day], ...patch };
    const updated = { ...current, [day]: dayUpdated };
    localScheduleRef.current = updated;
    // Update local display state (pure, no side effects inside updater)
    setLocalSchedule(updated);
    // Write ONLY this day's change to DB (updateShopSettings reads shopSettingsRef.current, always fresh)
    updateShopSettings(prev => ({
      weeklySchedule: { ...(prev.weeklySchedule || {}), [day]: dayUpdated }
    }));
  };

  const saveClosures = (newClosures) => {
    setLocalClosures(newClosures);
    updateShopSettings({ specialClosures: newClosures });
  };
  const [analyticsPeriod, setAnalyticsPeriod] = useState('daily'); // 'daily', 'monthly', 'yearly'
  const [selectedDateRange, setSelectedDateRange] = useState({ start: '', end: '' });
  const [menuSearchQuery, setMenuSearchQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  
  // New Addon State
  const [newAddonName, setNewAddonName] = useState('');
  const [newAddonPrice, setNewAddonPrice] = useState('');
  const [newAddonImageFile, setNewAddonImageFile] = useState(null);

  // New Menu Item State
  const [newItem, setNewItem] = useState({
    name: '', category: 'BBQ', price: '', image: '', description: '', inStock: true
  });
  const [newItemImageFile, setNewItemImageFile] = useState(null);
  
  const [isUploading, setIsUploading] = useState(false);

  const [now, setNow] = useState(Date.now());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(new Date());
  
  // Analytics State Additions
  const [grabFoodShiftPercent, setGrabFoodShiftPercent] = useState(0);
  const [topItemsChannelFilter, setTopItemsChannelFilter] = useState('all'); // 'all', 'web', 'loyverse'

  // Promos & Referrals State
  const [promoCodes, setPromoCodes] = useState([]);
  const [referralStats, setReferralStats] = useState([]);
  const [activePromoSubTab, setActivePromoSubTab] = useState('codes'); // 'codes', 'referrals', 'items'
  const [isPromoModalOpen, setIsPromoModalOpen] = useState(false);
  const [promoFormData, setPromoFormData] = useState({
    code: '', name: '', type: 'percent_off', value: '', 
    applies_to_item_id: '', min_spend: '', free_item_id: '', 
    max_total_uses: '', max_uses_per_user: '', starts_at: '', ends_at: '', stackable_with_item_promos: false
  });

  // Notes & Upcoming Events State
  const [eventsNotes, setEventsNotes] = useState(() => {
    try {
      const saved = localStorage.getItem('munchies_admin_events_notes');
      return saved ? JSON.parse(saved) : [
        {
          id: 'evt-1',
          date: new Date().toISOString().split('T')[0],
          title: '🔥 CZ CHIX Promotion Starts',
          type: 'promo',
          description: 'Special 5,000 PTS prize vault unlock & win bonus.'
        },
        {
          id: 'evt-2',
          date: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
          title: '📦 Weekly Ingredient Restock',
          type: 'event',
          description: 'Restock Mushy2 burger patties & Solero ice creams.'
        }
      ];
    } catch (e) {
      return [];
    }
  });

  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [selectedEventDate, setSelectedEventDate] = useState(new Date().toISOString().split('T')[0]);
  const [eventFormData, setEventFormData] = useState({
    id: null,
    title: '',
    type: 'event',
    description: ''
  });

  const activePromosFromMenu = useMemo(() => {
    return (menu || []).filter(i => isPromoActive(i)).map(i => ({
      id: `promo-menu-${i.id}`,
      title: `🔥 PROMO: ${i.name}`,
      description: `RM ${(i.price / 100).toFixed(2)} - Active Special Price!`,
      type: 'promo',
      isSystemPromo: true
    }));
  }, [menu]);

  if (!user || user.role !== 'admin') {
    return <Navigate to="/login" replace />;
  }

  const pendingOrders = orders.filter(o => o.status === 'PENDING');
  const activeOrders = orders.filter(o => o.status !== 'COLLECTED' && o.status !== 'CANCELLED');
  
  useEffect(() => {
    if (activeTab === 'promotions') {
      fetchMarketingData();
    }
  }, [activeTab]);

  const fetchMarketingData = async () => {
    try {
      // 1. Fetch promo codes
      const { data: promos } = await supabase.from('promo_codes').select('*').order('created_at', { ascending: false });
      const { data: redemptions } = await supabase.from('promo_redemptions').select('promo_code_id, discount_amount, orders(total)');
      
      if (promos) {
        const promosWithInsights = promos.map(promo => {
          const promoRedemptions = (redemptions || []).filter(r => r.promo_code_id === promo.id);
          const totalDiscountGiven = promoRedemptions.reduce((sum, r) => sum + (r.discount_amount || 0), 0);
          const totalRevenue = promoRedemptions.reduce((sum, r) => sum + (r.orders?.total || 0), 0);
          return {
            ...promo,
            timesRedeemed: promoRedemptions.length,
            totalDiscountGiven,
            totalRevenue
          };
        });
        setPromoCodes(promosWithInsights);
      }

      // 2. Fetch referral stats from profiles
      const { data: profiles } = await supabase.from('profiles').select('id, name, referred_by, referral_converted_at');
      if (profiles) {
        const statsMap = {}; // key: referrer id
        profiles.forEach(p => {
          if (p.referred_by) {
            if (!statsMap[p.referred_by]) {
              statsMap[p.referred_by] = { id: p.referred_by, totalInvited: 0, totalConverted: 0, name: 'Unknown' };
            }
            statsMap[p.referred_by].totalInvited += 1;
            if (p.referral_converted_at) {
              statsMap[p.referred_by].totalConverted += 1;
            }
          }
        });
        
        // Map names to referrers
        Object.keys(statsMap).forEach(referrerId => {
          const referrerProfile = profiles.find(p => p.id === referrerId);
          if (referrerProfile) {
            statsMap[referrerId].name = referrerProfile.name || 'User';
          }
        });
        
        setReferralStats(Object.values(statsMap).sort((a, b) => b.totalConverted - a.totalConverted));
      }
    } catch (e) {
      console.error('Failed to fetch marketing data', e);
    }
  };

  const handleSavePromoCode = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        code: promoFormData.code.trim().toUpperCase(),
        name: promoFormData.name.trim() || null,
        type: promoFormData.type,
        value: promoFormData.value ? parseInt(promoFormData.value, 10) : 0,
        applies_to_item_id: promoFormData.applies_to_item_id || null,
        min_spend: promoFormData.min_spend ? parseInt(promoFormData.min_spend, 10) : null,
        free_item_id: promoFormData.free_item_id || null,
        max_total_uses: promoFormData.max_total_uses ? parseInt(promoFormData.max_total_uses, 10) : null,
        max_uses_per_user: promoFormData.max_uses_per_user ? parseInt(promoFormData.max_uses_per_user, 10) : null,
        starts_at: promoFormData.starts_at || null,
        ends_at: promoFormData.ends_at || null,
        stackable_with_item_promos: promoFormData.stackable_with_item_promos
      };
      const { error } = await supabase.from('promo_codes').insert([payload]);
      if (error) {
        alert(error.message);
        return;
      }
      setIsPromoModalOpen(false);
      setPromoFormData({
        code: '', name: '', type: 'percent_off', value: '', 
        applies_to_item_id: '', min_spend: '', free_item_id: '', 
        max_total_uses: '', max_uses_per_user: '', starts_at: '', ends_at: '', stackable_with_item_promos: false
      });
      fetchMarketingData();
    } catch (e) {
      alert('Error creating promo code');
    }
  };

  const togglePromoCodeActive = async (id, currentStatus) => {
    await supabase.from('promo_codes').update({ active: !currentStatus }).eq('id', id);
    fetchMarketingData();
  };

  const deletePromoCode = async (id) => {
    if (!window.confirm('Are you sure you want to delete this promo code? This cannot be undone.')) return;
    await supabase.from('promo_codes').delete().eq('id', id);
    fetchMarketingData();
  };

  const saveEventsNotes = (newEvents) => {
    setEventsNotes(newEvents);
    localStorage.setItem('munchies_admin_events_notes', JSON.stringify(newEvents));
  };

  const handleOpenAddEventModal = (dateStr = null) => {
    const targetDate = dateStr || new Date().toISOString().split('T')[0];
    setSelectedEventDate(targetDate);
    setEventFormData({ id: null, title: '', type: 'event', description: '' });
    setIsEventModalOpen(true);
  };

  const handleOpenEditEventModal = (evt) => {
    if (evt.isSystemPromo) return;
    setSelectedEventDate(evt.date);
    setEventFormData({
      id: evt.id,
      title: evt.title,
      type: evt.type || 'event',
      description: evt.description || ''
    });
    setIsEventModalOpen(true);
  };

  const handleSaveEvent = (e) => {
    e.preventDefault();
    if (!eventFormData.title.trim()) return;

    if (eventFormData.id) {
      const updated = eventsNotes.map(item => item.id === eventFormData.id ? {
        ...item,
        date: selectedEventDate,
        title: eventFormData.title,
        type: eventFormData.type,
        description: eventFormData.description
      } : item);
      saveEventsNotes(updated);
    } else {
      const newEvt = {
        id: 'evt-' + Date.now(),
        date: selectedEventDate,
        title: eventFormData.title,
        type: eventFormData.type,
        description: eventFormData.description
      };
      saveEventsNotes([newEvt, ...eventsNotes]);
    }
    setIsEventModalOpen(false);
  };

  const handleDeleteEvent = (id) => {
    const filtered = eventsNotes.filter(item => item.id !== id);
    saveEventsNotes(filtered);
    setIsEventModalOpen(false);
  };

  const handleSaveMenuItemDetails = async (e) => {
    e.preventDefault();
    if (!editingMenuItem) return;

    setIsUploading(true);
    let imageUrl = editingMenuItem.image;

    if (editingMenuItemImageFile) {
      const uploaded = await uploadImage(editingMenuItemImageFile);
      if (uploaded) imageUrl = uploaded;
    }

    await updateMenuItem(editingMenuItem.id, {
      name: editingMenuItem.name,
      category: editingMenuItem.category,
      price: Math.round(parseFloat(editingMenuItem.price || 0) * 100),
      description: editingMenuItem.description || '',
      image: imageUrl
    });

    setIsUploading(false);
    setEditingMenuItem(null);
    setEditingMenuItemImageFile(null);
  };

  const handleCreateCategory = (e) => {
    e.preventDefault();
    if (!newCatLabel) return;
    addCategory(newCatCode || newCatLabel, newCatLabel, newCatIcon, newCatColor);
    setNewCatCode('');
    setNewCatLabel('');
    setNewCatIcon('🍔');
    setNewCatColor('#ef4444');
  };

  const handleSaveCatEdit = (e) => {
    e.preventDefault();
    if (!editingCat) return;
    updateCategory(editingCat.id, {
      code: editingCat.code.toUpperCase().replace(/\s+/g, '_'),
      label: editingCat.label,
      icon: editingCat.icon,
      color: editingCat.color
    });
    setEditingCat(null);
  };

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const totalCompleted = orders.filter(o => o.status === 'COLLECTED').length;
  const [perfAnim, setPerfAnim] = useState(0);
  useEffect(() => {
    const target = orders.length > 0 ? (totalCompleted / orders.length * 100) : 0;
    const t = setTimeout(() => setPerfAnim(target), 100);
    return () => clearTimeout(t);
  }, [totalCompleted, orders.length, activeTab]);

  // Metrics calculation for Overview
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaysOrders = orders.filter(o => new Date(o.created_at || now) >= todayStart && o.status !== 'PENDING');
  const todaysRevenue = todaysOrders.reduce((sum, o) => sum + o.total, 0);
  const lowStockItems = menu.filter(item => (item.stock_quantity ?? 99) <= (item.low_stock_threshold ?? 10));
  const lowStockCount = lowStockItems.length;

  const categorySales = {};
  orders.filter(o => o.status === 'COLLECTED').forEach(order => {
    (order.items || []).forEach(item => {
      const cat = (menu.find(m => m.id === item.id) || item).category || 'Other';
      if (!categorySales[cat]) categorySales[cat] = 0;
      const itemTotalCents = ((item.price || 0) + (item.selectedAddons || []).reduce((sum, a) => sum + (a.price || 0), 0)) * (item.quantity || 1);
      categorySales[cat] += itemTotalCents;
    });
  });

  const categoryColors = {
    BBQ: '#FF6B6B',
    PREMIUM: '#9B30C9',
    PLATTERS: '#D4A017',
    SIDES: '#1DAA54',
    DRINKS: '#2E7DD6',
    Other: '#a3aed1'
  };

  const salesByCategoryData = Object.keys(categorySales)
    .filter(cat => categorySales[cat] > 0)
    .map(cat => ({
      name: cat,
      value: parseFloat((categorySales[cat] / 100).toFixed(2)),
      color: categoryColors[cat] || categoryColors.Other
    }))
    .sort((a, b) => b.value - a.value);

  if (salesByCategoryData.length === 0) salesByCategoryData.push({ name: 'No Sales', value: 1, color: '#e2e8f0' });

    // Analytics Data Aggregation
  const processAnalyticsData = () => {
    const validOrders = orders.filter(o => o.status !== 'PENDING');
    
    const nowD = new Date(now);
    let cutoff = new Date(nowD);
    if (selectedDateRange.start && selectedDateRange.end) {
      cutoff = new Date(selectedDateRange.start);
    } else {
      if (analyticsPeriod === 'daily') cutoff.setDate(cutoff.getDate() - 7);
      else if (analyticsPeriod === 'monthly') cutoff.setMonth(cutoff.getMonth() - 6);
      else if (analyticsPeriod === 'yearly') cutoff.setFullYear(cutoff.getFullYear() - 3);
    }
    
    cutoff.setHours(0, 0, 0, 0);

    let periodOrders = validOrders.filter(o => new Date(o.created_at || now) >= cutoff);
    if (selectedDateRange.start && selectedDateRange.end) {
      const endOfDay = new Date(selectedDateRange.end);
      endOfDay.setHours(23, 59, 59, 999);
      periodOrders = periodOrders.filter(o => new Date(o.created_at || now) <= endOfDay);
    }
    
    // KPI Metrics
    let totalGrossSales = 0;
    let totalNetProfit = 0;
    let channelSales = { web: 0, loyverse: 0, grabfood: 0 };
    let orderCount = periodOrders.length;
    let previousPeriodOrderCount = 0; // Mock comparison

    // Channel Fees Config
    const CHANNEL_FEES = { web: 0, loyverse: 0, grabfood: 0.30 };
    let channelStats = {
      web: { gross: 0, net: 0, name: 'Web App Direct', color: '#E8491D' },
      loyverse: { gross: 0, net: 0, name: 'Loyverse / Walk-in', color: '#10b981' },
      grabfood: { gross: 0, net: 0, name: 'GrabFood', color: '#16a34a' }
    };

    // Top 10 Sales with Margin Calculation
    const itemStats = {};
    periodOrders.forEach(order => {
      const rawChannel = (order.channel || 'web').toLowerCase();
      const isLoyverse = rawChannel === 'loyverse' || rawChannel === 'pos' || rawChannel === 'walkin' || rawChannel === 'walk-in';
      const isGrab = rawChannel === 'grab' || rawChannel === 'grabfood';
      const channelKey = isLoyverse ? 'loyverse' : isGrab ? 'grabfood' : 'web';

      const orderGross = order.total / 100;
      
      // Assume 40% COGS flat + Platform Fee
      const cogs = orderGross * 0.40;
      const platformFee = orderGross * (CHANNEL_FEES[channelKey] || 0);
      const orderNet = orderGross - cogs - platformFee;

      channelStats[channelKey].gross += orderGross;
      channelStats[channelKey].net += orderNet;
      channelSales[channelKey] += orderGross;

      totalGrossSales += orderGross;
      totalNetProfit += orderNet;

      // Filter for top items by channel
      if (topItemsChannelFilter === 'all' || topItemsChannelFilter === channelKey) {
        (order.items || []).forEach(item => {
          if (!itemStats[item.name]) itemStats[item.name] = { quantity: 0, revenue: 0, netProfit: 0 };
          const itemQty = item.quantity || 1;
          const itemRev = ((item.price || 0) * itemQty) / 100;
          
          let itemNet = itemRev - (itemRev * 0.40) - (itemRev * (CHANNEL_FEES[channelKey] || 0));

          itemStats[item.name].quantity += itemQty;
          itemStats[item.name].revenue += itemRev;
          itemStats[item.name].netProfit += itemNet;
        });
      }
    });
    
    const topItemsData = Object.keys(itemStats)
      .map(name => {
        const menuItem = menu.find(m => m.name === name);
        const revenue = itemStats[name].revenue;
        const netProfit = itemStats[name].netProfit;
        const margin = revenue > 0 ? (netProfit / revenue) * 100 : 0;
        
        return { 
          name, 
          sales: itemStats[name].quantity, 
          revenue: revenue,
          margin: margin,
          image: menuItem?.image || '/images/hero_burger.png'
        };
      })
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 10);
      
    // Trend Data
    const trendData = [];
    if (selectedDateRange.start && selectedDateRange.end) {
      const start = new Date(selectedDateRange.start);
      const end = new Date(selectedDateRange.end);
      let curr = new Date(start);
      while (curr <= end) {
        trendData.push({
          dateStr: curr.toISOString().split('T')[0],
          displayDate: curr.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          revenue: 0, web: 0, loyverse: 0, ordersCount: 0
        });
        curr.setDate(curr.getDate() + 1);
      }
    } else if (analyticsPeriod === 'daily') {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(nowD);
        d.setDate(d.getDate() - i);
        trendData.push({
          dateStr: d.toISOString().split('T')[0],
          displayDate: d.toLocaleDateString('en-US', { weekday: 'short' }),
          revenue: 0, web: 0, loyverse: 0, ordersCount: 0
        });
      }
    } else if (analyticsPeriod === 'monthly') {
      for (let i = 5; i >= 0; i--) {
        const d = new Date(nowD);
        d.setMonth(d.getMonth() - i);
        trendData.push({
          dateStr: `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}`,
          displayDate: d.toLocaleDateString('en-US', { month: 'short' }),
          revenue: 0, web: 0, loyverse: 0, ordersCount: 0
        });
      }
    } else if (analyticsPeriod === 'yearly') {
      for (let i = 2; i >= 0; i--) {
        const d = new Date(nowD);
        d.setFullYear(d.getFullYear() - i);
        trendData.push({
          dateStr: `${d.getFullYear()}`,
          displayDate: `${d.getFullYear()}`,
          revenue: 0, web: 0, loyverse: 0, ordersCount: 0
        });
      }
    }
    
    const hourlyTrendData = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      displayHour: i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i - 12} PM`,
      ordersCount: 0,
      web: 0,
      loyverse: 0,
      grabfood: 0
    }));

    periodOrders.forEach(order => {
      const orderD = new Date(order.created_at || now);
      let matchedBucket = null;

      if ((selectedDateRange.start && selectedDateRange.end) || analyticsPeriod === 'daily') {
        const dateStr = orderD.toISOString().split('T')[0];
        matchedBucket = trendData.find(d => d.dateStr === dateStr);
        if ((selectedDateRange.start && selectedDateRange.end) && !matchedBucket) {
           matchedBucket = { dateStr, displayDate: dateStr, revenue: 0, web: 0, loyverse: 0, ordersCount: 0 };
           trendData.push(matchedBucket);
        }
      } else if (analyticsPeriod === 'monthly') {
        const monthStr = `${orderD.getFullYear()}-${(orderD.getMonth()+1).toString().padStart(2, '0')}`;
        matchedBucket = trendData.find(d => d.dateStr === monthStr);
      } else if (analyticsPeriod === 'yearly') {
        const yearStr = `${orderD.getFullYear()}`;
        matchedBucket = trendData.find(d => d.dateStr === yearStr);
      }

      if (matchedBucket) {
        const gross = order.total / 100;
        matchedBucket.revenue += gross;
        matchedBucket.ordersCount += 1;
        
        const rawChannel = (order.channel || 'web').toLowerCase();
        const isLoyverse = rawChannel === 'loyverse' || rawChannel === 'pos' || rawChannel === 'walkin' || rawChannel === 'walk-in';
        const isGrab = rawChannel === 'grab' || rawChannel === 'grabfood';
        
        if (isLoyverse) matchedBucket.loyverse += gross;
        else if (isGrab) matchedBucket.grabfood = (matchedBucket.grabfood || 0) + gross;
        else matchedBucket.web += gross;
      }

      // Populate hourly trend
      const hour = orderD.getHours();
      hourlyTrendData[hour].ordersCount += 1;
      const gross = order.total / 100;
      const rawChannel = (order.channel || 'web').toLowerCase();
      const isLoyverse = rawChannel === 'loyverse' || rawChannel === 'pos' || rawChannel === 'walkin' || rawChannel === 'walk-in';
      const isGrab = rawChannel === 'grab' || rawChannel === 'grabfood';
      
      if (isLoyverse) hourlyTrendData[hour].loyverse += gross;
      else if (isGrab) hourlyTrendData[hour].grabfood += gross;
      else hourlyTrendData[hour].web += gross;
    });

    const netMarginPercent = totalGrossSales > 0 ? (totalNetProfit / totalGrossSales) * 100 : 0;

    return { 
      topItemsData, 
      trendData, 
      hourlyTrendData, 
      kpi: { totalGrossSales, totalNetProfit, netMarginPercent, orderCount, previousPeriodOrderCount },
      channelSales,
      channelStats,
      CHANNEL_FEES
    };
  };

  const { topItemsData, trendData, hourlyTrendData, kpi, channelSales, channelStats, CHANNEL_FEES } = processAnalyticsData();

  const customerInsights = useMemo(() => {
    // Only consider pickup orders
    const pickupOrders = orders.filter(o => o.order_type === 'pickup');
    
    // Group by customer_name (fallback to customer_id if missing name)
    const customersMap = {};
    
    pickupOrders.forEach(o => {
      const customerKey = o.customer_name?.trim() || o.customer_id || 'Unknown Guest';
      if (!customersMap[customerKey]) {
        customersMap[customerKey] = {
          name: customerKey,
          orders: [],
          totalSpend: 0,
          itemsCount: {}
        };
      }
      customersMap[customerKey].orders.push(o);
      customersMap[customerKey].totalSpend += o.total;
      
      (o.items || []).forEach(item => {
        if (!customersMap[customerKey].itemsCount[item.name]) {
          customersMap[customerKey].itemsCount[item.name] = 0;
        }
        customersMap[customerKey].itemsCount[item.name] += (item.quantity || 1);
      });
    });

    const customersArray = Object.values(customersMap);
    const newCustomers = customersArray.filter(c => c.orders.length === 1);
    const returningCustomers = customersArray.filter(c => c.orders.length >= 2);
    
    // Order Frequency
    let totalDaysBetween = 0;
    let frequencyPairs = 0;
    
    returningCustomers.forEach(c => {
      const sortedDates = c.orders.map(o => new Date(o.created_at || Date.now()).getTime()).sort((a, b) => a - b);
      if (sortedDates.length >= 2) {
        const first = sortedDates[0];
        const last = sortedDates[sortedDates.length - 1];
        const daysDiff = (last - first) / (1000 * 60 * 60 * 24);
        totalDaysBetween += daysDiff;
        frequencyPairs += (sortedDates.length - 1);
      }
    });
    
    const avgOrderFrequency = frequencyPairs > 0 ? (totalDaysBetween / frequencyPairs) : 0;
    
    // Process top customers favorite items
    customersArray.forEach(c => {
      let favItem = 'None';
      let maxQty = 0;
      for (const [itemName, qty] of Object.entries(c.itemsCount)) {
        if (qty > maxQty) {
          maxQty = qty;
          favItem = itemName;
        }
      }
      c.favoriteItem = favItem;
    });
    
    const topSpenders = [...customersArray].sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 3);
    
    return {
      total: customersArray.length,
      newCount: newCustomers.length,
      returningCount: returningCustomers.length,
      newPercent: customersArray.length ? (newCustomers.length / customersArray.length * 100) : 0,
      returningPercent: customersArray.length ? (returningCustomers.length / customersArray.length * 100) : 0,
      avgOrderFrequency,
      topSpenders
    };
  }, [orders]);

  // Start / stop looping alert sound based on pending orders
  useEffect(() => {
    if (pendingOrders.length > 0) {
      startNewOrderAlert();
    } else {
      stopNewOrderAlert();
    }
    return () => stopNewOrderAlert();
  }, [pendingOrders.length]);

  const getElapsedTime = (startedAt) => {
    let parsedStartedAt = startedAt;
    if (typeof parsedStartedAt === 'string' && /^\d+$/.test(parsedStartedAt)) {
      parsedStartedAt = parseInt(parsedStartedAt, 10);
    }
    const startMs = new Date(parsedStartedAt).getTime();
    const diff = Math.floor((now - startMs) / 1000);
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getCookTimeLeft = (order) => {
    if (order.status !== 'COOKING') return null;
    if (!order.cooking_started_at || !order.cook_time_seconds) return '—';
    const started = new Date(order.cooking_started_at).getTime();
    const now = Date.now();
    const elapsedSeconds = Math.floor((now - started) / 1000);
    const cookTime = order.cook_time_seconds;
    
    if (elapsedSeconds >= cookTime) return 'OVERDUE';
    const left = cookTime - elapsedSeconds;
    const m = Math.floor(left / 60);
    const s = left % 60;
    return `${m}m ${s}s`;
  };

  const formatOrderId = (id) => {
    if (!id) return '';
    return id.includes('-') ? id.split('-')[0].toUpperCase() : id.toUpperCase().substring(0, 8);
  };

  const advanceOrderState = (id, currentStatus) => {
    if (currentStatus === 'COOKING') updateOrderState(id, 'READY');
    else if (currentStatus === 'READY') updateOrderState(id, 'COLLECTED');
  };

  const handleAccept = (orderId) => {
    acceptOrder(orderId);
  };

  const handlePriceChange = (id, value) => setEditingPrice({ ...editingPrice, [id]: value });
  const savePrice = (id) => {
    if (editingPrice[id] !== undefined && editingPrice[id] !== '') {
      updatePrice(id, parseFloat(editingPrice[id]));
      setEditingPrice({ ...editingPrice, [id]: undefined });
    }
  };

  const saveMenuItemDetails = async (id) => {
    if (!editingMenuItem || editingMenuItem.id !== id) return;
    try {
      await updateMenuItem(id, { name: editingMenuItem.name, description: editingMenuItem.description });
      setEditingMenuItem(null);
    } catch (e) {
      alert('Failed to update item details');
    }
  };

  const handlePromoEdit = (id, field, value) => {
    setEditingPromo({
      ...editingPromo,
      [id]: { ...(editingPromo[id] || {}), [field]: value }
    });
  };

  const savePromo = async (id) => {
    const promo = editingPromo[id];
    if (!promo) return;
    
    // convert price float to cents
    let promoCents = null;
    if (promo.promoPrice) {
      promoCents = Math.round(parseFloat(promo.promoPrice) * 100);
    }
    
    // convert datetime-local strings to ISO
    const startIso = promo.promoStart ? new Date(promo.promoStart).toISOString() : null;
    const endIso = promo.promoEnd ? new Date(promo.promoEnd).toISOString() : null;
    
    await updatePromo(id, promoCents, startIso, endIso);
    setEditingPromo({ ...editingPromo, [id]: undefined });
  };

  const handleAddonPriceChange = (id, value) => setEditingAddonPrice({ ...editingAddonPrice, [id]: value });
  const saveAddonPrice = (id) => {
    if (editingAddonPrice[id] !== undefined) {
      const val = editingAddonPrice[id];
      updateAddonPrice(id, val === '' ? '' : parseFloat(val));
      setEditingAddonPrice({ ...editingAddonPrice, [id]: undefined });
    }
  };

  const handleAddAddon = async (e) => {
    e.preventDefault();
    if (newAddonName) {
      setIsUploading(true);
      try {
        const imageUrl = newAddonImageFile ? await uploadImage(newAddonImageFile) : null;
        await addAddon(newAddonName, newAddonPrice, imageUrl);
        setNewAddonName('');
        setNewAddonPrice('');
        setNewAddonImageFile(null);
      } catch (err) {
        console.error("Full upload error:", err);
        alert('Upload failed: ' + (err.message || JSON.stringify(err)));
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleAddMenuItem = async (e) => {
    e.preventDefault();
    if (newItem.name && newItem.price) {
      setIsUploading(true);
      try {
        const imageUrl = newItemImageFile ? await uploadImage(newItemImageFile) : (newItem.image || '/images/hero_burger.png');
        await addMenuItem({
          ...newItem,
          price: parseFloat(newItem.price),
          image: imageUrl
        });
        setNewItem({ name: '', category: 'BBQ', price: '', image: '', description: '', inStock: true });
        setNewItemImageFile(null);
      } catch (err) {
        console.error("Full upload error:", err);
        alert('Upload failed: ' + (err.message || JSON.stringify(err)));
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleGeneratePDF = () => {
    const doc = new jsPDF();
    const currentMonth = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
    
    doc.setFontSize(20);
    doc.text(`Monthly Report: ${currentMonth}`, 14, 22);
    
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 30);
    
    const tableData = [
      ['Total Orders', orders.length.toString()],
      ['Total Revenue', `RM ${(orders.reduce((sum, o) => sum + o.total, 0) / 100).toFixed(2)}`],
      ['Total Completed', totalCompleted.toString()],
      ['Pending Orders', pendingOrders.length.toString()]
    ];

    doc.autoTable({
      startY: 40,
      head: [['Metric', 'Value']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [45, 153, 255] }
    });

    const recentOrdersHeader = [['Order ID', 'Status', 'Total', 'Date']];
    const recentOrdersBody = orders.slice(0, 10).map(o => [
      o.id.substring(0, 8),
      o.status,
      `RM ${(o.total / 100).toFixed(2)}`,
      new Date(o.created_at).toLocaleDateString()
    ]);

    doc.text('Recent Orders', 14, doc.lastAutoTable.finalY + 15);
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 20,
      head: recentOrdersHeader,
      body: recentOrdersBody,
      theme: 'striped',
    });

    doc.save(`MunchiesKK_Report_${currentMonth.replace(' ', '_')}.pdf`);
  };

  return (
    <div className="admin-page">
      <div className="admin-dashboard-layout">
        
        {/* Left Sidebar */}
        <aside className="admin-sidebar">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', justifyContent: 'center' }}>
                  <button
                    className="pending-accept-btn"
                    onClick={() => handleAccept(order.id)}
                    style={{ width: '100%', padding: '0.5rem 1rem' }}
                  >
                    ? Accept<br/>
                    <span style={{fontSize:'0.65rem', opacity:0.85}}>
                      {order.total >= 10000 ? '20 min' : '15 min'} timer
                    </span>
                  </button>
                  <button
                    onClick={() => setCancellingOrder({ id: order.id, reason: '', wasteAction: 'restore' })}
                    style={{ width: '100%', padding: '0.5rem 1rem', background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                  >
                    ? Cancel
                  </button>
                </div>
              </div>
            </div>
          ))}

          {activeOrders.filter(o => o.status !== 'PENDING').length === 0 && pendingOrders.length === 0 ? (
            <p className="text-muted">No active orders right now.</p>
          ) : activeOrders.filter(o => o.status !== 'PENDING').length > 0 && (
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Elapsed Time</th>
                    <th>Items</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {activeOrders.filter(o => o.status !== 'PENDING').map(order => (
                    <tr key={order.id}>
                      <td className="font-medium">
                        #{formatOrderId(order.id)}
                        <div className="text-xs text-muted mt-1 font-normal">
                          {order.customer_name || 'Guest'}
                          {order.customer_phone && order.customer_phone !== 'No Phone' && (
                            <div className="mt-1">📞 {order.customer_phone}</div>
                          )}
                        </div>
                      </td>
                      <td className="font-black text-orange">
                        {order.status === 'COOKING' ? getElapsedTime(order.cooking_started_at || order.created_at) : '—'}
                      </td>
                      <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
                        {order.items.map((item, i) => (
                          <div key={i} style={{ marginBottom: '0.25rem' }}>
                            <span style={{ fontWeight: 'bold' }}>{item.quantity}x</span> {item.name}
                            {item.selectedAddons && item.selectedAddons.length > 0 && (
                              <div style={{ color: '#64748b', fontSize: '0.75rem', marginLeft: '1rem', marginTop: '0.25rem' }}>
                                + {item.selectedAddons.map(a => a.name).join(', ')}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${order.status === 'READY' ? 'in-stock' : 'out-stock'}`}>
                          {order.status}
                        </span>
                      </td>
                      <td>
                        {order.status === 'COOKING' && (
                          <button className="btn btn-sm btn-primary" onClick={() => advanceOrderState(order.id, 'COOKING')}>
                            Mark Ready
                          </button>
                        )}
                        {order.status === 'READY' && (
                          <button className="btn btn-sm btn-dark" onClick={() => advanceOrderState(order.id, 'READY')}>
                            Mark Collected
                          </button>
                        )}
                        <button 
                          className="btn btn-sm btn-secondary" 
                          style={{marginLeft: '0.5rem'}}
                          onClick={() => setCancellingOrder({ id: order.id, reason: '', wasteAction: 'restore' })}
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}


        {activeTab === 'inventory' && (
        <div className="admin-card">
          <div style={{ display: 'flex', gap: '2rem' }}>
            <div style={{ flex: 1 }}>
              <h3>Add New Menu Item</h3>
              <form onSubmit={handleAddMenuItem} className="new-item-form">
                <div className="form-group">
                  <label>Name</label>
                  <input type="text" className="price-input" placeholder="e.g. Double Cheeseburger" required value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <select className="price-input" value={newItem.category} onChange={e => setNewItem({...newItem, category: e.target.value})}>
                    {categoriesList.map(c => (
                      <option key={c.id} value={c.code}>{c.icon || '🏷️'} {c.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Price (RM)</label>
                  <input type="number" step="0.10" className="price-input" placeholder="0.00" required value={newItem.price} onChange={e => setNewItem({...newItem, price: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Image Upload</label>
                  <input type="file" accept="image/*" className="price-input" onChange={e => setNewItemImageFile(e.target.files[0])} />
                </div>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <button type="submit" className="btn btn-primary" style={{ width: '200px' }} disabled={isUploading}>
                    {isUploading ? 'Uploading...' : 'Add Item'}
                  </button>
                </div>
              </form>
            </div>
            <div style={{ width: '250px', borderLeft: '1px solid #e2e8f0', paddingLeft: '2rem' }}>
              <h3 style={{ color: '#ef4444' }}>Needs Restock</h3>
              {menu.filter(item => !item.inStock || (item.stock_quantity ?? 99) <= (item.low_stock_threshold ?? 10)).length === 0 ? (
                <p className="text-muted" style={{ fontSize: '0.9rem' }}>All items stocked!</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: '1rem', color: '#64748b', fontSize: '0.9rem', maxHeight: '200px', overflowY: 'auto' }}>
                  {menu.filter(item => !item.inStock || (item.stock_quantity ?? 99) <= (item.low_stock_threshold ?? 10)).map(item => (
                    <li key={item.id} style={{ marginBottom: '0.5rem' }}>
                      {item.name} {(!item.inStock || (item.stock_quantity === 0)) ? <span style={{ color: '#ef4444', fontWeight: 'bold' }}>(Sold Out)</span> : <span style={{ color: '#f59e0b' }}>({item.stock_quantity} left)</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>


          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', marginTop: '2rem' }}>
            <h3 style={{ margin: 0 }}>Menu Inventory</h3>
            <input 
              type="text" 
              placeholder="Search items..." 
              value={menuSearchQuery} 
              onChange={e => setMenuSearchQuery(e.target.value)}
              className="price-input" 
              style={{ width: '250px' }}
            />
          </div>
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th>Price (RM)</th>
                  <th>Stock / Alert</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...menu]
                  .filter(item => item.name.toLowerCase().includes(menuSearchQuery.toLowerCase()))
                  .sort((a, b) => a.category.localeCompare(b.category))
                  .map(item => {
                  // Determine badge color based on category
                  const getCategoryColor = (cat) => {
                    const colors = {
                      BBQ: '#ef4444',     // Red
                      PREMIUM: '#8b5cf6', // Purple
                      PLATTERS: '#f59e0b',// Orange
                      SIDES: '#10b981',   // Green
                      DRINKS: '#3b82f6'   // Blue
                    };
                    return colors[cat] || '#64748b'; // Default slate
                  };

                  return (
                    <tr key={item.id} className={!item.inStock ? 'row-inactive' : ''}>
                      <td className="font-medium">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          {item.image && (
                            <img src={item.image} alt={item.name} style={{ width: '36px', height: '36px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }} />
                          )}
                          <div style={{ flex: 1, minWidth: '150px' }}>
                            {editingMenuItem && editingMenuItem.id === item.id ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '4px', paddingBottom: '4px' }}>
                                <input 
                                  type="text" 
                                  className="price-input" 
                                  value={editingMenuItem.name} 
                                  onChange={e => setEditingMenuItem({...editingMenuItem, name: e.target.value})}
                                  placeholder="Item Name"
                                  style={{ padding: '4px', fontSize: '0.85rem', width: '100%' }}
                                />
                                <textarea 
                                  className="price-input" 
                                  value={editingMenuItem.description} 
                                  onChange={e => setEditingMenuItem({...editingMenuItem, description: e.target.value})}
                                  placeholder="Description"
                                  style={{ padding: '4px', fontSize: '0.75rem', width: '100%', resize: 'vertical', minHeight: '40px' }}
                                />
                                <div style={{ display: 'flex', gap: '4px' }}>
                                  <button className="btn btn-sm btn-primary" style={{ flex: 1 }} onClick={() => saveMenuItemDetails(item.id)}>Save</button>
                                  <button className="btn btn-sm btn-secondary" style={{ flex: 1 }} onClick={() => setEditingMenuItem(null)}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                <div>
                                  <div style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{item.name}</div>
                                  {item.description && (
                                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 'normal', whiteSpace: 'normal' }}>{item.description.slice(0, 40)}{item.description.length > 40 ? '...' : ''}</div>
                                  )}
                                </div>
                                <button 
                                  className="btn btn-sm btn-outline" 
                                  style={{ padding: '2px 6px', fontSize: '0.65rem' }} 
                                  onClick={() => setEditingMenuItem({ id: item.id, name: item.name, description: item.description || '' })}
                                >
                                  Edit
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span style={{
                          backgroundColor: getCategoryColor(item.category),
                          color: '#fff',
                          padding: '4px 8px',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                          display: 'inline-block'
                        }}>
                          {item.category}
                        </span>
                      </td>
                    <td>
                      <div className="price-edit-group" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {editingPrice[item.id] !== undefined ? (
                          <>
                            <input 
                              type="number" step="0.10"
                              value={editingPrice[item.id]}
                              onChange={(e) => handlePriceChange(item.id, e.target.value)}
                              className="price-input"
                              style={{ width: '80px', padding: '4px' }}
                            />
                            <button className="btn btn-sm btn-primary" onClick={() => savePrice(item.id)}>Save</button>
                            <button className="btn btn-sm btn-secondary" onClick={() => setEditingPrice({ ...editingPrice, [item.id]: undefined })}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <span>RM {(item.price / 100).toFixed(2)}</span>
                            <button className="btn btn-sm btn-secondary" onClick={() => handlePriceChange(item.id, (item.price / 100).toFixed(2))}>Edit</button>
                          </>
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div className="qty-control">
                          <button
                            type="button"
                            className="qty-btn qty-btn-minus"
                            onClick={(e) => { e.preventDefault(); updateStock(item.id, -1); }}
                            disabled={!item.inStock && (item.stock_quantity ?? 0) === 0}
                          >−</button>
                          <input
                            type="number"
                            min="0"
                            className="qty-input"
                            value={editingStock[item.id] !== undefined ? editingStock[item.id] : (item.stock_quantity ?? 99)}
                            onChange={e => setEditingStock({ ...editingStock, [item.id]: e.target.value })}
                            onBlur={e => {
                              if (editingStock[item.id] !== undefined) {
                                setStockQuantity(item.id, editingStock[item.id]);
                                setEditingStock({ ...editingStock, [item.id]: undefined });
                              }
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                setStockQuantity(item.id, editingStock[item.id] ?? item.stock_quantity);
                                setEditingStock({ ...editingStock, [item.id]: undefined });
                                e.target.blur();
                              }
                            }}
                            style={{
                              color: (editingStock[item.id] !== undefined ? Number(editingStock[item.id]) : (item.stock_quantity ?? 99)) === 0 ? '#ef4444' : '#1e293b'
                            }}
                          />
                          <button
                            type="button"
                            className="qty-btn qty-btn-plus"
                            onClick={(e) => { e.preventDefault(); updateStock(item.id, +1); }}
                          >+</button>
                        </div>
                        {item.manual_override && (
                          <button 
                            className="btn btn-sm btn-secondary" 
                            style={{ fontSize: '0.7rem', padding: '2px 6px', color: '#6366f1', borderColor: '#6366f1' }}
                            onClick={() => clearManualOverride(item.id)}
                            title="Clear manual override to resume automated Loyverse sync"
                          >
                            Sync with Loyverse
                          </button>
                        )}
                        <div style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          Alert at: 
                          <input 
                            type="number"
                            min="0"
                            className="price-input"
                            style={{ width: '50px', padding: '2px 4px', fontSize: '0.75rem' }}
                            value={editingLowStock[item.id] !== undefined ? editingLowStock[item.id] : (item.low_stock_threshold ?? 10)}
                            onChange={e => setEditingLowStock({ ...editingLowStock, [item.id]: e.target.value })}
                            onBlur={e => {
                              if (editingLowStock[item.id] !== undefined) {
                                updateLowStockThreshold(item.id, editingLowStock[item.id]);
                                setEditingLowStock({ ...editingLowStock, [item.id]: undefined });
                              }
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                updateLowStockThreshold(item.id, editingLowStock[item.id]);
                                setEditingLowStock({ ...editingLowStock, [item.id]: undefined });
                                e.target.blur();
                              }
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className={`status-badge ${item.inStock ? 'in-stock' : 'out-stock'}`}>
                          {item.inStock ? 'In Stock' : 'Sold Out'}
                        </span>
                        <button className={`btn btn-sm ${item.inStock ? 'btn-danger' : 'btn-success'}`} onClick={() => toggleStock(item.id)}>
                          {item.inStock ? 'Mark Sold Out' : 'Restock'}
                        </button>
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => setEditingMenuItem({
                          id: item.id,
                          name: item.name,
                          category: item.category,
                          price: (item.price / 100).toFixed(2),
                          description: item.description || '',
                          image: item.image || ''
                        })}
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#3b82f6', color: '#fff', border: 'none', fontWeight: 'bold' }}
                      >
                        ✏️ Edit Details
                      </button>
                    </td>
                  </tr>
                );
              })}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {activeTab === 'customers' && (
          <div className="admin-card">
            {!selectedCustomerId ? (
              <>
                <h3 style={{ marginBottom: '1.5rem' }}>Customer Details</h3>
                <div className="table-responsive">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Points</th>
                        <th>Total Orders</th>
                        <th>Lifetime Spend (RM)</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.map(customer => {
                        const customerOrders = orders.filter(o => o.user_id === customer.id && o.status !== 'PENDING');
                        const totalSpendCents = customerOrders.reduce((sum, o) => sum + o.total, 0);
                        return (
                          <tr key={customer.id}>
                            <td className="font-medium">
                              {customer.name || customer.email || 'Unnamed'}
                              <div className="text-xs text-muted mt-1 font-normal">{customer.phone || 'No Phone'}</div>
                            </td>
                            <td className="text-primary font-bold">{customer.points || 0} pts</td>
                            <td>{customerOrders.length}</td>
                            <td className="font-bold text-success">{(totalSpendCents / 100).toFixed(2)}</td>
                            <td>
                              <button className="btn btn-sm btn-secondary" onClick={() => setSelectedCustomerId(customer.id)}>View</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (() => {
              const customer = customers.find(c => c.id === selectedCustomerId);
              if (!customer) return <p>Customer not found</p>;
              const customerOrders = orders.filter(o => o.user_id === customer.id && o.status !== 'PENDING');
              const totalSpendCents = customerOrders.reduce((sum, o) => sum + o.total, 0);

              return (
                <div>
                  <button className="btn btn-sm btn-secondary" style={{ marginBottom: '1.5rem' }} onClick={() => setSelectedCustomerId(null)}>
                    ← Back to Customers
                  </button>
                  <div className="admin-grid-auto-200" style={{ marginBottom: '2rem' }}>
                    <div className="admin-card" style={{ boxShadow: 'none', border: '1px solid #e2e8f0', margin: 0 }}>
                      <h4 style={{ margin: 0, color: '#64748b', fontSize: '0.85rem', textTransform: 'uppercase' }}>Customer Name</h4>
                      <p style={{ margin: '0.5rem 0 0', fontSize: '1.25rem', fontWeight: 700 }}>{customer.name || customer.email || 'Unnamed'}</p>
                    </div>
                    <div className="admin-card" style={{ boxShadow: 'none', border: '1px solid #e2e8f0', margin: 0 }}>
                      <h4 style={{ margin: 0, color: '#64748b', fontSize: '0.85rem', textTransform: 'uppercase' }}>Lifetime Spend</h4>
                      <p style={{ margin: '0.5rem 0 0', fontSize: '1.25rem', fontWeight: 700, color: '#10b981' }}>RM {(totalSpendCents / 100).toFixed(2)}</p>
                    </div>
                    <div className="admin-card" style={{ boxShadow: 'none', border: '1px solid #e2e8f0', margin: 0 }}>
                      <h4 style={{ margin: 0, color: '#64748b', fontSize: '0.85rem', textTransform: 'uppercase' }}>Points</h4>
                      <p style={{ margin: '0.5rem 0 0', fontSize: '1.25rem', fontWeight: 700, color: '#2563eb' }}>{customer.points || 0}</p>
                    </div>
                  </div>

                  <h4 style={{ marginBottom: '1rem' }}>Order History</h4>
                  {customerOrders.length > 0 ? (
                    <div className="table-responsive">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Order ID</th>
                            <th>Date</th>
                            <th>Items</th>
                            <th>Total (RM)</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {customerOrders.map(order => (
                            <tr key={order.id}>
                              <td className="font-medium text-xs">{order.id}</td>
                              <td className="text-xs text-muted">{new Date(order.created_at).toLocaleDateString()}</td>
                              <td>
                                <div style={{ display: 'flex', flexDirection: 'column', fontSize: '0.875rem' }}>
                                  {order.items.map((item, i) => (
                                    <div key={i} style={{ marginBottom: '0.25rem' }}>
                                      <span style={{ fontWeight: 'bold' }}>{item.quantity}x</span> {item.name}
                                      {item.selectedAddons && item.selectedAddons.length > 0 && (
                                        <div style={{ color: '#64748b', fontSize: '0.75rem', marginLeft: '1rem', marginTop: '0.25rem' }}>
                                          + {item.selectedAddons.map(a => a.name).join(', ')}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </td>
                              <td className="font-bold">{(order.total / 100).toFixed(2)}</td>
                              <td>
                                <span className="font-medium">#{formatOrderId(order.id)}</span>
                                <span className={`status-badge ${order.status === 'COLLECTED' ? 'in-stock' : 'out-stock'}`}>
                                  {order.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-muted">No completed orders found.</p>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Category CRM Tab */}
        {activeTab === 'categories' && (
          <div className="admin-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h3 style={{ margin: 0, color: '#1e293b' }}>🏷️ Category CRM</h3>
                <p className="text-muted" style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
                  Manage storefront menu categories, icons, badge colors, and display labels.
                </p>
              </div>
            </div>

            {/* Create Category Form */}
            <form onSubmit={handleCreateCategory} className="new-item-form" style={{ gridTemplateColumns: '1fr 1.5fr 100px 100px auto', alignItems: 'end', marginBottom: '2rem' }}>
              <div className="form-group">
                <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>CATEGORY CODE</label>
                <input
                  type="text"
                  placeholder="e.g. SNACKS"
                  value={newCatCode}
                  onChange={e => setNewCatCode(e.target.value)}
                  className="price-input"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>DISPLAY LABEL</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Quick Snacks & Bites"
                  value={newCatLabel}
                  onChange={e => setNewCatLabel(e.target.value)}
                  className="price-input"
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>ICON</label>
                <select
                  value={newCatIcon}
                  onChange={e => setNewCatIcon(e.target.value)}
                  className="price-input"
                  style={{ fontWeight: 'bold', textAlign: 'center' }}
                >
                  <option value="🔥">🔥 BBQ</option>
                  <option value="👑">👑 Premium</option>
                  <option value="🍽️">🍽️ Platter</option>
                  <option value="🥗">🥗 Sides</option>
                  <option value="🥤">🥤 Drinks</option>
                  <option value="🍦">🍦 Ice Cream</option>
                  <option value="🍟">🍟 Snacks</option>
                  <option value="🍔">🍔 Burger</option>
                  <option value="✨">✨ Special</option>
                </select>
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>COLOR</label>
                <input
                  type="color"
                  value={newCatColor}
                  onChange={e => setNewCatColor(e.target.value)}
                  style={{ width: '100%', height: '42px', borderRadius: '8px', border: '1px solid #cbd5e1', cursor: 'pointer', padding: '2px' }}
                />
              </div>

              <button type="submit" className="btn btn-primary" style={{ height: '42px', padding: '0 1.25rem' }}>
                + Add Category
              </button>
            </form>

            {/* Categories List Table */}
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Category Code</th>
                    <th>Color Badge</th>
                    <th>Assigned Items</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {categoriesList.map(cat => {
                    const assignedItemsCount = menu.filter(m => m.category === cat.code || m.category === cat.label).length;

                    return (
                      <tr key={cat.id}>
                        <td className="font-medium" style={{ fontSize: '1rem' }}>
                          <span style={{ fontSize: '1.2rem', marginRight: '8px' }}>{cat.icon || '🏷️'}</span>
                          <strong>{cat.label}</strong>
                        </td>
                        <td>
                          <code style={{ background: '#f1f5f9', padding: '4px 8px', borderRadius: '6px', fontSize: '0.85rem', color: '#0f172a', fontWeight: 'bold' }}>
                            {cat.code}
                          </code>
                        </td>
                        <td>
                          <span style={{
                            backgroundColor: cat.color || '#ef4444',
                            color: '#fff',
                            padding: '4px 12px',
                            borderRadius: '12px',
                            fontSize: '0.8rem',
                            fontWeight: 'bold',
                            display: 'inline-block'
                          }}>
                            {cat.icon} {cat.code}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 'bold', color: assignedItemsCount > 0 ? '#10b981' : '#94a3b8' }}>
                            {assignedItemsCount} items
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() => setEditingCat({ ...cat })}
                              style={{ background: '#3b82f6', color: '#fff', border: 'none', fontWeight: 'bold' }}
                            >
                              ✏️ Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={() => {
                                if (assignedItemsCount > 0) {
                                  if (!window.confirm(`Warning: ${assignedItemsCount} menu items are currently in category "${cat.label}". Are you sure you want to delete this category?`)) return;
                                }
                                deleteCategory(cat.id);
                              }}
                              style={{ background: '#ef4444', color: '#fff', border: 'none', fontWeight: 'bold' }}
                            >
                              🗑️ Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Edit Category Modal Overlay */}
        {editingCat && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, padding: '1rem', backdropFilter: 'blur(4px)'
          }}>
            <div style={{
              background: '#1e293b', color: '#fff', width: '100%', maxWidth: '460px',
              borderRadius: '16px', padding: '1.5rem', border: '2px solid rgba(255, 199, 44, 0.4)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h3 style={{ margin: 0, color: '#FFC72C', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  ✏️ Edit Category
                </h3>
                <button type="button" onClick={() => setEditingCat(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.3rem', cursor: 'pointer' }}>✕</button>
              </div>

              <form onSubmit={handleSaveCatEdit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>CATEGORY CODE</label>
                  <input
                    type="text"
                    required
                    value={editingCat.code}
                    onChange={(e) => setEditingCat({ ...editingCat, code: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>DISPLAY LABEL</label>
                  <input
                    type="text"
                    required
                    value={editingCat.label}
                    onChange={(e) => setEditingCat({ ...editingCat, label: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>EMOJI ICON</label>
                  <select
                    value={editingCat.icon || '🍔'}
                    onChange={(e) => setEditingCat({ ...editingCat, icon: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  >
                    <option value="🔥">🔥 BBQ</option>
                    <option value="👑">👑 Premium</option>
                    <option value="🍽️">🍽️ Platter</option>
                    <option value="🥗">🥗 Sides</option>
                    <option value="🥤">🥤 Drinks</option>
                    <option value="🍦">🍦 Ice Cream</option>
                    <option value="🍟">🍟 Snacks</option>
                    <option value="🍔">🍔 Burger</option>
                    <option value="✨">✨ Special</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>BADGE COLOR</label>
                  <input
                    type="color"
                    value={editingCat.color || '#ef4444'}
                    onChange={(e) => setEditingCat({ ...editingCat, color: e.target.value })}
                    style={{ width: '100%', height: '42px', borderRadius: '8px', border: '1px solid #cbd5e1', cursor: 'pointer', padding: '2px' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                  <button
                    type="submit"
                    style={{ flex: 1, padding: '12px', borderRadius: '8px', border: 'none', background: '#22c55e', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}
                  >
                    Save Category Changes
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingCat(null)}
                    style={{ padding: '12px 18px', borderRadius: '8px', border: 'none', background: '#475569', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'addons' && (
        <div className="admin-card">
          <h3>Add-ons CRM</h3>
          
          <form onSubmit={handleAddAddon} className="new-item-form" style={{ gridTemplateColumns: '1fr 1fr 1fr auto', alignItems: 'end' }}>
            <div className="form-group">
              <label>Addon Name</label>
              <input type="text" placeholder="e.g. Extra Cheese" required value={newAddonName} onChange={e => setNewAddonName(e.target.value)} className="price-input" />
            </div>
            <div className="form-group">
              <label>Price (RM)</label>
              <input type="number" step="0.10" placeholder="Leave blank for TBD" value={newAddonPrice} onChange={e => setNewAddonPrice(e.target.value)} className="price-input" />
            </div>
            <div className="form-group">
              <label>Image Upload</label>
              <input type="file" accept="image/*" className="price-input" onChange={e => setNewAddonImageFile(e.target.files[0])} />
            </div>
            <button type="submit" className="btn btn-primary" style={{ height: '40px' }} disabled={isUploading}>
              {isUploading ? 'Uploading...' : 'Add Add-on'}
            </button>
          </form>

          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Addon</th>
                  <th>Price</th>
                  <th>Assign to Items</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {addons.map(addon => (
                  <tr key={addon.id}>
                    <td className="font-medium">{addon.name}</td>
                    <td>
                      <div className="price-edit-group" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {editingAddonPrice[addon.id] !== undefined ? (
                          <>
                            <input 
                              type="number" step="0.10"
                              placeholder="TBD"
                              value={editingAddonPrice[addon.id]}
                              onChange={(e) => handleAddonPriceChange(addon.id, e.target.value)}
                              className="price-input"
                              style={{ width: '80px', padding: '4px' }}
                            />
                            <button className="btn btn-sm btn-primary" onClick={() => saveAddonPrice(addon.id)}>Save</button>
                            <button className="btn btn-sm btn-secondary" onClick={() => setEditingAddonPrice({ ...editingAddonPrice, [addon.id]: undefined })}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <span>{addon.price === null ? 'TBD' : `RM ${(addon.price / 100).toFixed(2)}`}</span>
                            <button className="btn btn-sm btn-secondary" onClick={() => handleAddonPriceChange(addon.id, addon.price === null ? '' : (addon.price / 100).toFixed(2))}>Edit</button>
                          </>
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{display: 'flex', gap: '0.5rem', flexWrap: 'wrap', maxWidth: '400px'}}>
                        {menu.map(m => (
                          <label key={m.id} style={{fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: '#f1f5f9', padding: '2px 6px', borderRadius: '4px'}}>
                            <input 
                              type="checkbox" 
                              checked={itemAddons[m.id]?.includes(addon.id) || false}
                              onChange={() => toggleItemAddon(m.id, addon.id)}
                            />
                            {m.name}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button className="btn btn-sm btn-danger" onClick={() => deleteAddon(addon.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {activeTab === 'history' && (
          <div className="admin-card">
            <h3 style={{ marginBottom: '1.5rem' }}>Completed & Cancelled Orders</h3>
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Total (RM)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.filter(o => o.status === 'COLLECTED' || o.status === 'CANCELLED').sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).map(order => (
                    <tr key={order.id}>
                      <td className="font-medium text-xs">#{formatOrderId(order.id)}</td>
                      <td className="text-xs text-muted">{new Date(order.created_at).toLocaleString()}</td>
                      <td>
                        <div className="font-bold text-sm">{order.customer_name || 'Guest'}</div>
                        {order.customer_phone && order.customer_phone !== 'No Phone' && <div className="text-xs text-muted">📞 {order.customer_phone}</div>}
                      </td>
                      <td className="font-bold">{(order.total / 100).toFixed(2)}</td>
                      <td>
                        <span className={`status-badge ${order.status === 'COLLECTED' ? 'in-stock' : 'out-stock'}`}>
                          {order.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {orders.filter(o => o.status === 'COLLECTED' || o.status === 'CANCELLED').length === 0 && (
                    <tr>
                      <td colSpan="5" className="text-center text-muted" style={{ padding: '2rem' }}>No past orders found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'promotions' && (
          <div className="admin-card">
            <h3 style={{ marginBottom: '1.5rem' }}>Marketing & Promotions</h3>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
              <button 
                className={`btn ${activePromoSubTab === 'codes' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setActivePromoSubTab('codes')}
              >
                🎟️ Promo Codes
              </button>
              <button 
                className={`btn ${activePromoSubTab === 'referrals' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setActivePromoSubTab('referrals')}
              >
                👥 Referral Leaderboard
              </button>
              <button 
                className={`btn ${activePromoSubTab === 'items' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setActivePromoSubTab('items')}
              >
                🍔 Item-Level Promos
              </button>
            </div>

            {activePromoSubTab === 'codes' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h4 style={{ margin: 0 }}>Active Cart Promo Codes</h4>
                  <button className="btn btn-primary btn-sm" onClick={() => setIsPromoModalOpen(true)}>+ New Promo Code</button>
                </div>
                <div className="table-responsive">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Type / Value</th>
                        <th>Usage</th>
                        <th>Insights</th>
                        <th>Status</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {promoCodes.map(promo => (
                        <tr key={promo.id}>
                          <td className="font-bold text-primary">
                            {promo.code}
                            {promo.name && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{promo.name}</div>}
                          </td>
                          <td>
                            {promo.type === 'percent_off' && `${promo.value}% OFF`}
                            {promo.type === 'flat_off' && `RM ${(promo.value / 100).toFixed(2)} OFF`}
                            {promo.type === 'bogo' && 'BOGO'}
                            {promo.type === 'spend_threshold_free_item' && `Free Item (Min RM ${(promo.min_spend / 100).toFixed(2)})`}
                          </td>
                          <td>
                            <div className="text-sm">
                              {promo.timesRedeemed || 0} / {promo.max_total_uses === null ? '∞' : promo.max_total_uses}
                            </div>
                          </td>
                          <td>
                            <div className="text-sm" style={{ color: '#10b981' }}>Rev: RM {((promo.totalRevenue || 0) / 100).toFixed(2)}</div>
                            <div className="text-sm" style={{ color: '#ef4444' }}>Saved: RM {((promo.totalDiscountGiven || 0) / 100).toFixed(2)}</div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <button 
                                className="btn btn-sm" 
                                onClick={() => togglePromoCodeActive(promo.id, promo.active)}
                                style={{ 
                                  width: '85px', 
                                  padding: '6px', 
                                  fontSize: '0.75rem',
                                  fontWeight: 'bold',
                                  backgroundColor: promo.active ? '#10b981' : '#f1f5f9',
                                  color: promo.active ? '#ffffff' : '#64748b',
                                  border: promo.active ? 'none' : '1px solid #cbd5e1',
                                  boxShadow: promo.active ? '0 2px 4px rgba(16, 185, 129, 0.3)' : 'none',
                                  transition: 'all 0.2s ease'
                                }}
                              >
                                {promo.active ? 'ACTIVE' : 'INACTIVE'}
                              </button>
                              <button 
                                onClick={() => deletePromoCode(promo.id)}
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: '4px', color: '#ef4444' }}
                                title="Delete Promo Code"
                              >
                                🗑️
                              </button>
                            </div>
                          </td>
                          <td className="text-muted text-xs">
                            {new Date(promo.created_at).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                      {promoCodes.length === 0 && (
                        <tr><td colSpan="6" className="text-center text-muted" style={{ padding: '2rem' }}>No promo codes created yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activePromoSubTab === 'referrals' && (
              <div>
                <h4 style={{ marginBottom: '1rem' }}>Top Advocates (Referrals)</h4>
                <div className="table-responsive">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Advocate (Referrer)</th>
                        <th>Friends Invited</th>
                        <th>Friends Converted (Paid Order)</th>
                        <th>Conversion Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {referralStats.map(stat => (
                        <tr key={stat.id}>
                          <td className="font-bold">{stat.name}</td>
                          <td>{stat.totalInvited}</td>
                          <td className="font-bold text-primary">{stat.totalConverted}</td>
                          <td>
                            <span className="status-badge in-stock" style={{ backgroundColor: 'rgba(0,176,116,0.1)' }}>
                              {stat.totalInvited > 0 ? Math.round((stat.totalConverted / stat.totalInvited) * 100) : 0}%
                            </span>
                          </td>
                        </tr>
                      ))}
                      {referralStats.length === 0 && (
                        <tr><td colSpan="4" className="text-center text-muted" style={{ padding: '2rem' }}>No referrals tracked yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activePromoSubTab === 'items' && (
              <div>
                <h4 style={{ marginBottom: '1rem' }}>Menu Item Promos</h4>
                <div className="table-responsive">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Standard Price</th>
                        <th>Promo Price</th>
                        <th>Start Date & Time</th>
                        <th>End Date & Time</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {menu.map(item => {
                    const isEditing = editingPromo[item.id] !== undefined;
                    const promoData = isEditing ? editingPromo[item.id] : {
                      promoPrice: item.promo_price ? (item.promo_price / 100).toFixed(2) : '',
                      promoStart: item.promo_start ? new Date(new Date(item.promo_start).getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0,16) : '',
                      promoEnd: item.promo_end ? new Date(new Date(item.promo_end).getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0,16) : ''
                    };
                    const isActive = isPromoActive(item);

                    return (
                      <tr key={item.id} style={{ backgroundColor: isActive ? 'rgba(0,176,116,0.05)' : 'transparent' }}>
                        <td className="font-medium">
                          {item.name}
                          {isActive && <span className="status-badge in-stock ml-2" style={{fontSize: '0.65rem'}}>ACTIVE</span>}
                        </td>
                        <td className="text-muted">RM {(item.price / 100).toFixed(2)}</td>
                        <td>
                          {isEditing ? (
                            <input 
                              type="number" step="0.10"
                              className="price-input"
                              placeholder="0.00"
                              style={{ padding: '8px 12px', fontSize: '0.85rem', borderRadius: '12px', border: '1px solid #cbd5e1', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)', backgroundColor: '#f8fafc', transition: 'all 0.2s', width: '80px', textAlign: 'center' }}
                              value={promoData.promoPrice}
                              onChange={e => handlePromoEdit(item.id, 'promoPrice', e.target.value)}
                            />
                          ) : (
                            <span className="font-bold text-danger">
                              {item.promo_price ? `RM ${(item.promo_price / 100).toFixed(2)}` : '—'}
                            </span>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <input 
                              type="datetime-local" 
                              className="price-input"
                              style={{ padding: '8px 12px', fontSize: '0.85rem', borderRadius: '12px', border: '1px solid #cbd5e1', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)', backgroundColor: '#f8fafc', transition: 'all 0.2s', width: '200px' }}
                              value={promoData.promoStart}
                              onChange={e => handlePromoEdit(item.id, 'promoStart', e.target.value)}
                            />
                          ) : (
                            <span className="text-sm">
                              {item.promo_start ? new Date(item.promo_start).toLocaleString() : '—'}
                            </span>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <input 
                              type="datetime-local" 
                              className="price-input"
                              style={{ padding: '8px 12px', fontSize: '0.85rem', borderRadius: '12px', border: '1px solid #cbd5e1', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)', backgroundColor: '#f8fafc', transition: 'all 0.2s', width: '200px' }}
                              value={promoData.promoEnd}
                              onChange={e => handlePromoEdit(item.id, 'promoEnd', e.target.value)}
                            />
                          ) : (
                            <span className="text-sm">
                              {item.promo_end ? new Date(item.promo_end).toLocaleString() : '—'}
                            </span>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <div className="flex gap-2">
                              <button className="btn btn-sm btn-primary" onClick={() => savePromo(item.id)}>Save</button>
                              <button className="btn btn-sm btn-secondary" onClick={() => setEditingPromo({ ...editingPromo, [item.id]: undefined })}>Cancel</button>
                            </div>
                          ) : (
                            <button className="btn btn-sm btn-secondary" onClick={() => setEditingPromo({ ...editingPromo, [item.id]: promoData })}>
                              Edit Promo
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      
{/* Loyalty CRM Tab */}
        {activeTab === 'loyalty_crm' && (
          <div className="admin-card">
            <h3>Loyalty Prizes CRM</h3>
            <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>Manage prizes that customers can redeem with their loyalty points.</p>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.target);
              await addLoyaltyPrize({
                name: fd.get('name'),
                description: fd.get('description') || null,
                points_cost: parseInt(fd.get('points_cost')),
                image_url: fd.get('image_url') || null,
                menu_item_id: fd.get('menu_item_id') || null,
                deduct_stock: fd.get('deduct_stock') === 'true'
              });
              e.target.reset();
            }} className="new-item-form" style={{ gridTemplateColumns: '1fr 1fr 1fr auto', alignItems: 'end', marginBottom: '2rem' }}>
              <div className="form-group"><label>Prize Name</label><input type="text" name="name" placeholder="e.g. Free Burger" required className="price-input" /></div>
              <div className="form-group"><label>Points Cost</label><input type="number" name="points_cost" placeholder="e.g. 500" required className="price-input" min="1" /></div>
              <div className="form-group"><label>Image URL</label><input type="text" name="image_url" placeholder="/images/prize.jpg" className="price-input" /></div>
              <div className="form-group"><label>Linked Menu Item</label>
                <select name="menu_item_id" className="price-input" style={{ width: '100%', height: '42px' }}>
                  <option value="">-- None --</option>
                  {menu.map(m => <option key={m.id} value={m.id}>{m.name} (Stock: {m.stock_quantity})</option>)}
                </select>
              </div>
              <div className="form-group" style={{ gridColumn: '1 / span 3' }}><label>Description</label><input type="text" name="description" placeholder="Short description..." className="price-input" /></div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '42px' }}>
                <input type="checkbox" name="deduct_stock" value="true" id="deduct_stock_check" />
                <label htmlFor="deduct_stock_check" style={{ margin: 0, cursor: 'pointer' }}>Deduct stock on fulfillment</label>
              </div>
              <button type="submit" className="btn btn-primary" style={{ height: '42px' }}>Add Prize</button>
            </form>
            <div className="table-responsive"><table className="admin-table">
              <thead><tr><th>Prize</th><th>Cost</th><th>Stock Link</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>{loyaltyPrizes.map(prize => {
                const linked = menu.find(m => String(m.id) === String(prize.menu_item_id));
                return (<tr key={prize.id}>
                  <td><strong>{prize.name}</strong>{prize.description && <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{prize.description}</div>}</td>
                  <td className="text-orange font-bold">{prize.points_cost} PTS</td>
                  <td>{linked ? <span style={{ fontSize: '0.8rem', color: '#22c55e' }}>{linked.name} (Stock: {linked.stock_quantity})</span> : <span className="text-muted">-</span>}</td>
                  <td><span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', background: prize.is_active ? '#166534' : '#475569', color: '#fff' }}>{prize.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td><div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-sm" style={{ background: prize.is_active ? '#f59e0b' : '#22c55e', color: '#fff' }} onClick={() => updateLoyaltyPrize(prize.id, { is_active: !prize.is_active })}>{prize.is_active ? 'Disable' : 'Enable'}</button>
                    <button className="btn btn-sm btn-outline text-red" onClick={() => { if(window.confirm('Delete?')) deleteLoyaltyPrize(prize.id); }}>Delete</button>
                  </div></td>
                </tr>);
              })}</tbody>
            </table></div>
          </div>
        )}

        {/* Redemptions Tab */}
        {activeTab === 'redemptions' && (
          <div className="admin-card">
            <h3>Pending & Fulfilled Redemptions</h3>
            <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>When customers redeem points, their requests appear here. Click "Fulfill" when you hand over the prize.</p>
            <div className="table-responsive"><table className="admin-table">
              <thead><tr><th>Code</th><th>Customer</th><th>Prize</th><th>Time</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {redemptions.length === 0 ? (
                  <tr><td colSpan="6" className="text-center text-muted" style={{ padding: '2rem' }}>No redemptions found.</td></tr>
                ) : redemptions.map(r => (
                  <tr key={r.id} style={{ opacity: r.status === 'FULFILLED' ? 0.6 : 1 }}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 'bold', fontSize: '1.1rem', color: '#FFC72C' }}>{r.redemption_code}</td>
                    <td><strong>{r.profiles?.name || 'Unknown'}</strong><div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{r.profiles?.phone || ''}</div></td>
                    <td><strong>{r.prize_name}</strong><div style={{ fontSize: '0.8rem', color: '#f59e0b' }}>{r.points_spent} pts</div></td>
                    <td style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{new Date(r.redeemed_at).toLocaleString()}</td>
                    <td><span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', background: r.status === 'PENDING' ? '#b45309' : '#166534', color: '#fff' }}>{r.status}</span></td>
                    <td>{r.status === 'PENDING' && (<button className="btn btn-sm btn-primary" onClick={async () => { if(window.confirm('Mark fulfilled?')) await fulfillRedemption(r.id, user.id); }}>Fulfill</button>)}
                    {r.status === 'FULFILLED' && <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Done</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}

      
</main>

      {/* Promo Code Modal Overlay */}
      {isPromoModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: '1rem', backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            background: '#1e293b', color: '#fff', width: '100%', maxWidth: '500px',
            borderRadius: '16px', padding: '1.5rem', border: '1px solid #334155',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            maxHeight: '90vh', overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                🎟️ Create Promo Code
              </h3>
              <button type="button" onClick={() => setIsPromoModalOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.3rem', cursor: 'pointer' }}>✕</button>
            </div>

            <form onSubmit={handleSavePromoCode} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>PROMO CODE *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. SUMMER20"
                    value={promoFormData.code}
                    onChange={(e) => setPromoFormData({ ...promoFormData, code: e.target.value.toUpperCase() })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold', textTransform: 'uppercase' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>DISPLAY NAME (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Summer Sale"
                    value={promoFormData.name}
                    onChange={(e) => setPromoFormData({ ...promoFormData, name: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>PROMO TYPE</label>
                <select
                  value={promoFormData.type}
                  onChange={(e) => setPromoFormData({ ...promoFormData, type: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                >
                  <option value="percent_off">Percent Off (%)</option>
                  <option value="flat_off">Flat Amount Off (RM)</option>
                  <option value="bogo">Buy One Get One (BOGO)</option>
                  <option value="spend_threshold_free_item">Free Item on Min Spend</option>
                </select>
              </div>

              {(promoFormData.type === 'percent_off' || promoFormData.type === 'flat_off') && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>DISCOUNT VALUE *</label>
                  <input
                    type="number"
                    required
                    placeholder={promoFormData.type === 'percent_off' ? "e.g. 20 (for 20%)" : "e.g. 500 (for RM 5.00)"}
                    value={promoFormData.value}
                    onChange={(e) => setPromoFormData({ ...promoFormData, value: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  />
                  <small style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
                    {promoFormData.type === 'flat_off' ? 'Enter in cents (e.g. 500 = RM 5.00)' : 'Enter whole percentage (e.g. 15 = 15%)'}
                  </small>
                </div>
              )}

              {promoFormData.type === 'bogo' && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>REQUIRED ITEM *</label>
                  <select
                    required
                    value={promoFormData.applies_to_item_id}
                    onChange={(e) => setPromoFormData({ ...promoFormData, applies_to_item_id: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  >
                    <option value="">Select an Item...</option>
                    {menu.map(item => (
                      <option key={item.id} value={item.id}>{item.name} - RM {(item.price/100).toFixed(2)}</option>
                    ))}
                  </select>
                  <small style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>User must have this item in cart to get the discount (value of 1 unit).</small>
                </div>
              )}

              {promoFormData.type === 'spend_threshold_free_item' && (
                <div style={{ display: 'flex', gap: '10px', flexDirection: 'column' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>MINIMUM SPEND *</label>
                    <input
                      type="number"
                      required
                      placeholder="e.g. 5000 (for RM 50.00)"
                      value={promoFormData.min_spend}
                      onChange={(e) => setPromoFormData({ ...promoFormData, min_spend: e.target.value })}
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                    />
                    <small style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>Enter in cents (e.g. 5000 = RM 50.00)</small>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>FREE ITEM *</label>
                    <select
                      required
                      value={promoFormData.free_item_id}
                      onChange={(e) => setPromoFormData({ ...promoFormData, free_item_id: e.target.value })}
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                    >
                      <option value="">Select an Item...</option>
                      {menu.map(item => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>MAX TOTAL USES</label>
                  <input
                    type="number"
                    placeholder="∞"
                    value={promoFormData.max_total_uses}
                    onChange={(e) => setPromoFormData({ ...promoFormData, max_total_uses: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>MAX PER USER</label>
                  <input
                    type="number"
                    placeholder="∞"
                    value={promoFormData.max_uses_per_user}
                    onChange={(e) => setPromoFormData({ ...promoFormData, max_uses_per_user: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>STARTS AT</label>
                  <input
                    type="datetime-local"
                    className="dark-datetime-input"
                    value={promoFormData.starts_at}
                    onChange={(e) => setPromoFormData({ ...promoFormData, starts_at: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>ENDS AT</label>
                  <input
                    type="datetime-local"
                    className="dark-datetime-input"
                    value={promoFormData.ends_at}
                    onChange={(e) => setPromoFormData({ ...promoFormData, ends_at: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  />
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#e2e8f0', fontSize: '0.85rem' }}>
                <input 
                  type="checkbox" 
                  checked={promoFormData.stackable_with_item_promos}
                  onChange={(e) => setPromoFormData({ ...promoFormData, stackable_with_item_promos: e.target.checked })}
                />
                Stackable with individual item promotions?
              </label>

              <button
                type="submit"
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', background: '#2563eb', color: '#fff', fontWeight: 'bold', cursor: 'pointer', marginTop: '8px' }}
              >
                Create Promo Code
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Event & Note Modal Overlay */}
      {isEventModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: '1rem', backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            background: '#1e293b', color: '#fff', width: '100%', maxWidth: '480px',
            borderRadius: '16px', padding: '1.5rem', border: '2px solid rgba(255, 199, 44, 0.4)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, color: '#FFC72C', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {eventFormData.id ? '✏️ Edit Event / Note' : '📌 Add Event / Note'}
              </h3>
              <button type="button" onClick={() => setIsEventModalOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.3rem', cursor: 'pointer' }}>✕</button>
            </div>

            <form onSubmit={handleSaveEvent} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>DATE</label>
                <input
                  type="date"
                  required
                  value={selectedEventDate}
                  onChange={(e) => setSelectedEventDate(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>CATEGORY / TYPE</label>
                <select
                  value={eventFormData.type}
                  onChange={(e) => setEventFormData({ ...eventFormData, type: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                >
                  <option value="event">🎉 Store Event</option>
                  <option value="promo">🔥 Promotion</option>
                  <option value="note">📝 Task / Restock Note</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>TITLE</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CZ CHIX Promo Launch"
                  value={eventFormData.title}
                  onChange={(e) => setEventFormData({ ...eventFormData, title: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>DETAILS / DESCRIPTION</label>
                <textarea
                  rows="3"
                  placeholder="Add event details, discount info, or restock notes..."
                  value={eventFormData.description}
                  onChange={(e) => setEventFormData({ ...eventFormData, description: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <button
                  type="submit"
                  style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', background: '#22c55e', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  Save Event / Note
                </button>
                {eventFormData.id && (
                  <button
                    type="button"
                    onClick={() => handleDeleteEvent(eventFormData.id)}
                    style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: '#ef4444', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsEventModalOpen(false)}
                  style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: '#475569', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Menu Item Details Modal */}
      {editingMenuItem && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: '1rem', backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            background: '#1e293b', color: '#fff', width: '100%', maxWidth: '520px',
            borderRadius: '16px', padding: '1.5rem', border: '2px solid rgba(255, 199, 44, 0.4)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, color: '#FFC72C', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                ✏️ Edit Item Details
              </h3>
              <button type="button" onClick={() => setEditingMenuItem(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.3rem', cursor: 'pointer' }}>✕</button>
            </div>

            <form onSubmit={handleSaveMenuItemDetails} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>ITEM NAME</label>
                <input
                  type="text"
                  required
                  value={editingMenuItem.name}
                  onChange={(e) => setEditingMenuItem({ ...editingMenuItem, name: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>CATEGORY</label>
                <select
                  value={editingMenuItem.category}
                  onChange={(e) => setEditingMenuItem({ ...editingMenuItem, category: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                >
                  {categoriesList.map(c => (
                    <option key={c.id} value={c.code}>{c.icon || '🏷️'} {c.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>PRICE (RM)</label>
                <input
                  type="number"
                  step="0.10"
                  required
                  value={editingMenuItem.price}
                  onChange={(e) => setEditingMenuItem({ ...editingMenuItem, price: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>DESCRIPTION</label>
                <textarea
                  rows="3"
                  placeholder="Describe ingredients, options, or combo details..."
                  value={editingMenuItem.description}
                  onChange={(e) => setEditingMenuItem({ ...editingMenuItem, description: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>UPDATE ITEM IMAGE</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setEditingMenuItemImageFile(e.target.files[0])}
                  style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontSize: '0.85rem' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <button
                  type="submit"
                  disabled={isUploading}
                  style={{ flex: 1, padding: '12px', borderRadius: '8px', border: 'none', background: '#22c55e', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  {isUploading ? 'Saving Image & Details...' : 'Save Item Changes'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingMenuItem(null)}
                  style={{ padding: '12px 18px', borderRadius: '8px', border: 'none', background: '#475569', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

        {/* Cancellation Modal */}
      {cancellingOrder && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: '#1e293b', padding: '2rem', borderRadius: '16px', width: '100%', maxWidth: '450px', border: '1px solid #334155' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#FFC72C', fontSize: '1.2rem' }}>Cancel Order</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <div><label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px', fontWeight: 'bold' }}>REASON</label>
              <input type="text" value={cancellingOrder.reason} onChange={e => setCancellingOrder({...cancellingOrder, reason: e.target.value})} placeholder="e.g. Customer no-show" style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff' }} /></div>
              <div><label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '8px', fontWeight: 'bold' }}>STOCK ACTION</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', background: cancellingOrder.wasteAction === 'restore' ? '#1e3a8a' : '#0f172a', border: '1px solid #475569', borderRadius: '8px', cursor: 'pointer', marginBottom: '8px' }}>
                <input type="radio" checked={cancellingOrder.wasteAction === 'restore'} onChange={() => setCancellingOrder({...cancellingOrder, wasteAction: 'restore'})} />
                <div><div style={{ color: '#fff', fontWeight: 'bold' }}>Restore to stock</div><div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Item not prepared, still available.</div></div>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', background: cancellingOrder.wasteAction === 'waste' ? '#450a0a' : '#0f172a', border: '1px solid #475569', borderRadius: '8px', cursor: 'pointer' }}>
                <input type="radio" checked={cancellingOrder.wasteAction === 'waste'} onChange={() => setCancellingOrder({...cancellingOrder, wasteAction: 'waste'})} />
                <div><div style={{ color: '#fca5a5', fontWeight: 'bold' }}>Mark as waste</div><div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Item prepped, cannot be resold.</div></div>
              </label></div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => { if (!cancellingOrder.reason.trim()) { alert("Reason required."); return; } cancelOrder(cancellingOrder.id, cancellingOrder.reason.trim(), cancellingOrder.wasteAction); setCancellingOrder(null); }} style={{ flex: 1, padding: '12px', borderRadius: '8px', border: 'none', background: '#ef4444', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>Confirm Cancel</button>
                <button onClick={() => setCancellingOrder(null)} style={{ padding: '12px 18px', borderRadius: '8px', border: 'none', background: '#475569', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>Abort</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
