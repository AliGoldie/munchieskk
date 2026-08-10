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
import { LayoutDashboard, BarChart2, ShoppingBag, Users, Layers, PlusSquare, TrendingUp, CheckCircle, AlertTriangle, Calendar, Archive, ArrowDown, Bookmark } from 'lucide-react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import './Admin.css';

export default function Admin() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { 
    menu, toggleStock, updatePrice, updateLowStockThreshold, addMenuItem, updateMenuItem, updateStock, setStockQuantity,
    orders, updateOrderState, acceptOrder, customers, cancelOrder,
    addons, itemAddons, addAddon, deleteAddon, toggleItemAddon, uploadImage, updateAddonPrice,
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
          <button className={`sidebar-item ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
            <LayoutDashboard size={20} /> Dashboard
          </button>
          <button className={`sidebar-item ${activeTab === 'orders' ? 'active' : ''}`} onClick={() => setActiveTab('orders')}>
            <ShoppingBag size={20} /> Live Orders
            {pendingOrders.length > 0 && <span className="sidebar-badge">{pendingOrders.length}</span>}
          </button>
          <button className={`sidebar-item ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTab('analytics')}>
            <BarChart2 size={20} /> Analytics
          </button>
          <button className={`sidebar-item ${activeTab === 'customers' ? 'active' : ''}`} onClick={() => { setActiveTab('customers'); setSelectedCustomerId(null); }}>
            <Users size={20} /> Customers
          </button>
          <button className={`sidebar-item ${activeTab === 'inventory' ? 'active' : ''}`} onClick={() => setActiveTab('inventory')}>
            <Layers size={20} /> Menu CRM
          </button>
          <button className={`sidebar-item ${activeTab === 'categories' ? 'active' : ''}`} onClick={() => setActiveTab('categories')}>
            <Bookmark size={20} /> Category CRM
          </button>
          <button className={`sidebar-item ${activeTab === 'addons' ? 'active' : ''}`} onClick={() => setActiveTab('addons')}>
            <PlusSquare size={20} /> Add-ons CRM
          </button>
          <button className={`sidebar-item ${activeTab === 'promotions' ? 'active' : ''}`} onClick={() => setActiveTab('promotions')}>
            <Calendar size={20} /> Promotions
          </button>
          <button className={`sidebar-item ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
            <Archive size={20} /> Order History
          </button>
        </aside>

        {/* Main Content Area */}
        <main className="admin-content">
          <div className="admin-header-section mb-6" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1>Dashboard</h1>
              <p className="text-muted" style={{ marginTop: '0.25rem', fontSize: '0.9rem' }}>Hi Admin, Welcome back to MunchiesKK Admin!</p>
            </div>
          </div>

          {activeTab === 'overview' && (
            <div>
              {/* Schedule Manager Modal */}
              {scheduleModalOpen && localSchedule && (
                <div style={{
                  position: 'fixed', inset: 0, zIndex: 1000,
                  background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                  overflowY: 'auto', padding: '2rem 1rem'
                }} onClick={e => { if (e.target === e.currentTarget) setScheduleModalOpen(false); }}>
                  <div style={{
                    background: '#1e293b', borderRadius: '20px', width: '100%', maxWidth: '680px',
                    border: '2px solid rgba(255,199,44,0.35)', boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
                    overflow: 'hidden', margin: 'auto'
                  }}>
                    {/* Modal Header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <div>
                        <h3 style={{ margin: 0, color: '#FFC72C', fontSize: '1.125rem', display: 'flex', alignItems: 'center', gap: '8px' }}>📅 Schedule Manager</h3>
                        <p style={{ margin: '3px 0 0', color: '#64748b', fontSize: '0.8rem' }}>Set weekly operating hours and block special closure dates</p>
                      </div>
                      <button onClick={() => setScheduleModalOpen(false)}
                        style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: '#94a3b8', width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                    </div>

                    {/* Modal Body */}
                    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>

                      {/* Override Buttons inside Modal */}
                      <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '8px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>⚡ Quick Override</label>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {[['OPEN','🟢 Open Now','#22c55e'],['PAUSED','⏸️ Pause','#eab308'],['CLOSED','🔴 Close Now','#ef4444'],['SCHEDULE','📅 Use Schedule','#6366f1']].map(([s,label,col]) => (
                            <button key={s} type="button" onClick={() => updateShopSettings({ status: s })}
                              style={{ flex: 1, minWidth: '110px', padding: '9px 8px', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.8rem',
                                background: shopSettings?.status === s ? col : '#334155', color: '#fff', transition: 'background 0.2s' }}>{label}</button>
                          ))}
                        </div>
                        <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '6px 0 0' }}>
                          {shopSettings?.status === 'SCHEDULE'
                            ? '✅ Following weekly schedule — auto open/close by day & time'
                            : `⚠️ Manual override active (${shopSettings?.status}). Click "Use Schedule" to follow the weekly timetable.`}
                        </p>
                      </div>

                      {/* Weekly Schedule Grid */}
                      <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🗓️ Weekly Schedule</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => {
                            const dayFull = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
                            // Use LOCAL draft state — fully isolated per day, no stale closures
                            const sched = localSchedule[day] || { enabled: true, open: '17:00', close: '23:00' };
                            const today = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date().getDay()];
                            const isToday = day === today;
                            return (
                              <div key={day} style={{
                                display: 'flex', alignItems: 'center', gap: '12px',
                                background: isToday ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.03)',
                                border: isToday ? '1px solid rgba(99,102,241,0.4)' : '1px solid rgba(255,255,255,0.07)',
                                borderRadius: '10px', padding: '10px 14px'
                              }}>
                                <div onClick={() => saveScheduleDay(day, { enabled: !sched.enabled })}
                                  style={{ width: '40px', height: '22px', borderRadius: '11px', cursor: 'pointer', flexShrink: 0,
                                    background: sched.enabled ? '#22c55e' : '#475569', position: 'relative', transition: 'background 0.2s' }}>
                                  <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: '#fff',
                                    position: 'absolute', top: '3px', transition: 'left 0.2s', left: sched.enabled ? '21px' : '3px' }} />
                                </div>
                                <span style={{ width: '82px', fontWeight: isToday ? '800' : '600', fontSize: '0.875rem', color: isToday ? '#a5b4fc' : '#e2e8f0', flexShrink: 0 }}>
                                  {dayFull[day]}
                                </span>
                                {sched.enabled ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, flexWrap: 'wrap' }}>
                                    <input type="time" value={sched.open}
                                      onChange={e => saveScheduleDay(day, { open: e.target.value })}
                                      style={{ padding: '5px 8px', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold', fontSize: '0.85rem' }} />
                                    <span style={{ color: '#64748b', fontSize: '0.8rem' }}>to</span>
                                    <input type="time" value={sched.close}
                                      onChange={e => saveScheduleDay(day, { close: e.target.value })}
                                      style={{ padding: '5px 8px', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold', fontSize: '0.85rem' }} />
                                    <span style={{ fontSize: '0.73rem', color: '#64748b' }}>({formatTime12Hour(sched.open)} – {formatTime12Hour(sched.close)})</span>
                                  </div>
                                ) : (
                                  <span style={{ background: '#ef444420', color: '#fca5a5', padding: '3px 10px', borderRadius: '12px', fontSize: '0.73rem', fontWeight: '700' }}>🚫 CLOSED</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Special Closures */}
                      <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🚨 Special Closures & Holidays</label>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                          <input type="date" id="closure-date-input" min={new Date().toISOString().split('T')[0]}
                            style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold', fontSize: '0.875rem' }} />
                          <input type="text" id="closure-reason-input" placeholder="Reason (e.g. Public Holiday)"
                            style={{ flex: 1, minWidth: '160px', padding: '8px 12px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontSize: '0.875rem' }} />
                          <button type="button"
                            onClick={() => {
                              const dateInput = document.getElementById('closure-date-input');
                              const reasonInput = document.getElementById('closure-reason-input');
                              const date = dateInput?.value; const reason = reasonInput?.value?.trim() || 'Closed';
                              if (!date) return;
                              const existing = localClosures || [];
                              if (existing.some(c => c.date === date)) return;
                              saveClosures([...existing, { date, reason }]);
                              if (dateInput) dateInput.value = ''; if (reasonInput) reasonInput.value = '';
                            }}
                            style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: '#6366f1', color: '#fff', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap' }}>+ Add</button>
                        </div>
                        {(localClosures || []).length === 0 ? (
                          <p style={{ fontSize: '0.8rem', color: '#475569', margin: 0 }}>No special closures scheduled.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {[...(localClosures || [])].sort((a,b) => a.date.localeCompare(b.date)).map((closure, idx) => {
                              const todayStr = new Date().toISOString().split('T')[0];
                              const isPast = closure.date < todayStr;
                              const isToday = closure.date === todayStr;
                              return (
                                <div key={closure.date} style={{
                                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
                                  background: isToday ? 'rgba(239,68,68,0.15)' : isPast ? 'rgba(255,255,255,0.03)' : 'rgba(99,102,241,0.08)',
                                  border: isToday ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(255,255,255,0.07)',
                                  borderRadius: '8px', padding: '8px 14px', opacity: isPast ? 0.5 : 1
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span>{isToday ? '🔴' : isPast ? '✅' : '📅'}</span>
                                    <div>
                                      <div style={{ fontWeight: '700', fontSize: '0.85rem', color: '#f1f5f9' }}>
                                        {new Date(closure.date + 'T12:00:00').toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
                                        {isToday && <span style={{ marginLeft: '8px', background: '#ef4444', color: '#fff', fontSize: '0.6rem', padding: '2px 8px', borderRadius: '10px', fontWeight: '800' }}>TODAY</span>}
                                      </div>
                                      <div style={{ fontSize: '0.73rem', color: '#94a3b8' }}>{closure.reason}</div>
                                    </div>
                                  </div>
                                  <button type="button"
                                    onClick={() => saveClosures((localClosures || []).filter(c => c.date !== closure.date))}
                                    style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 'bold' }}>✕</button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Shop Status Card — Compact Dashboard Version */}
              <div className="card shop-status-card" style={{
                background: '#1e293b', color: '#ffffff', padding: '1.25rem 1.5rem',
                borderRadius: '16px', border: '2px solid rgba(255, 199, 44, 0.4)',
                boxShadow: '0 10px 25px rgba(0,0,0,0.3)', marginBottom: '1.5rem'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    <h3 style={{ margin: 0, color: '#FFC72C', fontSize: '1.125rem', display: 'flex', alignItems: 'center', gap: '8px' }}>🏪 Store Status</h3>
                    <p style={{ margin: '3px 0 0', color: '#64748b', fontSize: '0.8rem' }}>
                      {(() => {
                        const today = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date().getDay()];
                        const sched = shopSettings?.weeklySchedule?.[today];
                        if (!sched || !sched.enabled) return 'Closed today per weekly schedule';
                        return `Today: ${formatTime12Hour(sched.open)} – ${formatTime12Hour(sched.close)}`;
                      })()}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{
                      padding: '6px 16px', borderRadius: '20px', fontWeight: '800', fontSize: '0.85rem', textTransform: 'uppercase',
                      background: shopSettings?.status === 'OPEN' ? '#16a34a' : shopSettings?.status === 'PAUSED' ? '#ca8a04' : shopSettings?.status === 'SCHEDULE' ? '#4f46e5' : '#dc2626',
                      color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
                    }}>
                      {shopSettings?.status === 'OPEN' ? '🟢 OPEN' : shopSettings?.status === 'PAUSED' ? '⏸️ PAUSED' : shopSettings?.status === 'SCHEDULE' ? '📅 SCHEDULE' : '🔴 CLOSED'}
                    </span>
                    <button onClick={() => openScheduleModal()}
                      style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid rgba(255,199,44,0.4)', background: 'rgba(255,199,44,0.08)', color: '#FFC72C', fontWeight: '700', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      ⚙️ Manage Schedule
                    </button>
                  </div>
                </div>
                <hr style={{ border: '0', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '0 0 1rem' }} />
                {/* Quick Override Buttons */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[['OPEN','🟢 Open','#22c55e'],['PAUSED','⏸️ Pause','#eab308'],['CLOSED','🔴 Close','#ef4444'],['SCHEDULE','📅 Schedule','#6366f1']].map(([s,label,col]) => (
                    <button key={s} type="button" onClick={() => updateShopSettings({ status: s })}
                      style={{ flex: 1, padding: '9px 4px', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.78rem',
                        background: shopSettings?.status === s ? col : '#334155', color: '#fff', transition: 'background 0.2s' }}>{label}</button>
                  ))}
                </div>
              </div>

              {/* Top Metrics Row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.5rem', marginBottom: '1.5rem' }}>
                <style>
                  {`
                    @keyframes flashText {
                      0%, 100% { opacity: 1; color: #ef4444; }
                      50% { opacity: 0.5; color: #fca5a5; }
                    }
                    .flash-alert {
                      animation: flashText 1.5s infinite;
                      font-weight: bold !important;
                    }
                  `}
                </style>
                <div className="sedap-metric-card" style={{ display: 'flex', alignItems: 'center', padding: '1.5rem', backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 4px 15px rgba(0,0,0,0.02)' }}>
                  <div className="sedap-metric-icon" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '1rem', borderRadius: '50%', marginRight: '1rem' }}><Layers size={28} /></div>
                  <div className="sedap-metric-content">
                    <div style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '4px' }}>Available Dish</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1e293b' }}>{menu.length}</div>
                  </div>
                </div>
                
                <div className="sedap-metric-card" style={{ display: 'flex', alignItems: 'center', padding: '1.5rem', backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 4px 15px rgba(0,0,0,0.02)' }}>
                  <div className="sedap-metric-icon" style={{ backgroundColor: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', padding: '1rem', borderRadius: '50%', marginRight: '1rem' }}><ShoppingBag size={28} /></div>
                  <div className="sedap-metric-content">
                    <div style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '4px' }}>Total Order</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1e293b' }}>{orders.length}</div>
                  </div>
                </div>

                <div className="sedap-metric-card" style={{ display: 'flex', alignItems: 'center', padding: '1.5rem', backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 4px 15px rgba(0,0,0,0.02)' }}>
                  <div className="sedap-metric-icon" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '1rem', borderRadius: '50%', marginRight: '1rem' }}><AlertTriangle size={28} /></div>
                  <div className="sedap-metric-content">
                    <div style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '4px' }}>Pending / Alerts</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1e293b', display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                       <span onClick={() => setActiveTab('orders')} style={{ cursor: 'pointer' }}>
                         {pendingOrders.length} <span style={{fontSize: '0.8rem', fontWeight: 'normal', color: '#64748b'}}>pending</span>
                       </span>
                       <span style={{color: '#cbd5e1'}}>|</span>
                       <span onClick={() => setActiveTab('inventory')} className={lowStockCount > 0 ? 'flash-alert' : ''} style={{ cursor: 'pointer' }}>
                         {lowStockCount} <span style={{fontSize: '0.8rem', fontWeight: 'normal', color: lowStockCount > 0 ? '#ef4444' : '#64748b'}}>low stock</span>
                       </span>
                    </div>
                  </div>
                </div>

                <div className="sedap-metric-card" style={{ display: 'flex', alignItems: 'center', padding: '1.5rem', backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 4px 15px rgba(0,0,0,0.02)' }} title={`All-time revenue generated from ${orders.length} total orders`}>
                  <div className="sedap-metric-icon" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', padding: '1rem', borderRadius: '50%', marginRight: '1rem' }}><TrendingUp size={28} /></div>
                  <div className="sedap-metric-content">
                    <div style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '4px' }}>Total Sale</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1e293b' }}>{(orders.reduce((sum, o) => sum + o.total, 0) / 100).toFixed(2)}</div>
                  </div>
                </div>
              </div>

              {/* Grid Layout for Main Widgets */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '1.5rem' }}>
                
                {/* Total Revenue Bar Chart - 8 cols */}
                <div className="admin-card" style={{ gridColumn: 'span 8', padding: '1.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: 0 }}>Total Revenue</h3>
                  </div>
                  <div style={{ height: '300px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trendData.slice(0, 12)} margin={{ top: 5, right: 0, left: -20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="displayDate" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dx={-10} />
                        <RechartsTooltip 
                          cursor={{ fill: '#f8fafc' }}
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                          formatter={(value) => [`RM ${value.toFixed(2)}`, 'Revenue']}
                        />
                        <Bar dataKey="revenue" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={24} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Performance & More - 4 cols */}
                <div style={{ gridColumn: 'span 4', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div className="admin-card hover-bg-slate" style={{ padding: '1.5rem', flex: 1, transition: 'transform 0.2s', cursor: 'help' }} title={`Total Orders: ${orders.length}\nCompleted: ${totalCompleted}\nPending: ${pendingOrders.length}\nCancelled: ${orders.filter(o => o.status === 'CANCELLED').length}`}>
                    <h3 style={{ margin: 0, marginBottom: '1.5rem' }}>Performance</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '150px' }}>
                       <div style={{ width: '120px', height: '60px', overflow: 'hidden', position: 'relative' }}>
                          <svg width="120" height="60" viewBox="0 0 120 60" style={{ position: 'absolute', bottom: 0 }}>
                            <path d="M 10 50 A 40 40 0 0 1 110 50" fill="none" stroke="#f1f5f9" strokeWidth="12" strokeLinecap="round" />
                            <path d="M 10 50 A 40 40 0 0 1 110 50" fill="none" stroke="#10b981" strokeWidth="12" strokeLinecap="round" 
                                  strokeDasharray="126" strokeDashoffset={126 - (126 * perfAnim / 100)} 
                                  style={{ transition: 'stroke-dashoffset 600ms ease-out' }} />
                          </svg>
                       </div>
                       <div style={{ marginTop: '0', textAlign: 'center' }}>
                         <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 500 }}>% Orders Completed</div>
                         <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{perfAnim.toFixed(1)}%</div>
                       </div>
                    </div>
                  </div>
                  
                  <div className="admin-card" style={{ padding: '1.5rem', flex: 1 }}>
                    <h3 style={{ margin: 0, marginBottom: '1rem' }}>More <span style={{fontSize: '0.8rem', color: '#64748b', fontWeight: 'normal'}}>→</span></h3>
                    <div style={{ display: 'flex', gap: '8px', height: '100px' }}>
                       <div 
                         onClick={() => setActiveTab('history')}
                         style={{ flex: 1, backgroundColor: '#ef4444', borderRadius: '8px', color: 'white', padding: '1rem', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', transition: 'transform 0.2s' }}
                         onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                         onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                       >
                          <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{todaysOrders.length}</div>
                          <div style={{ fontSize: '0.7rem', textAlign: 'center' }}>Today's Orders</div>
                       </div>
                       <div style={{ flex: 1, backgroundColor: '#ea580c', borderRadius: '8px', color: 'white', padding: '1rem', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                          <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{totalCompleted}</div>
                          <div style={{ fontSize: '0.7rem', textAlign: 'center' }}>Completed</div>
                       </div>
                       <div style={{ flex: 1, backgroundColor: '#f97316', borderRadius: '8px', color: 'white', padding: '1rem', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                          <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{pendingOrders.length}</div>
                          <div style={{ fontSize: '0.7rem', textAlign: 'center' }}>Pending</div>
                       </div>
                    </div>
                  </div>
                </div>

                {/* Bottom Row */}
                {/* Column 1: Calendar & Reports */}
                <div style={{ gridColumn: 'span 4', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div className="admin-card" style={{ padding: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <h3 style={{ margin: 0, fontSize: '1rem' }}>{selectedCalendarDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</h3>
                      <Calendar size={16} className="text-muted" />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', fontSize: '0.8rem', color: '#64748b', marginBottom: '8px' }}>
                      <div>Su</div><div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div><div>Sa</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                      {(() => {
                        const year = selectedCalendarDate.getFullYear();
                        const month = selectedCalendarDate.getMonth();
                        const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Sun, 1 = Mon, ...
                        const daysInMonth = new Date(year, month + 1, 0).getDate();

                        const emptyCells = Array.from({ length: firstDayIndex }).map((_, idx) => (
                          <div key={`empty-${idx}`} />
                        ));

                        const dayCells = Array.from({ length: daysInMonth }).map((_, i) => {
                          const dateNum = i + 1;
                          const isSelected = selectedCalendarDate.getDate() === dateNum;
                          const dayDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dateNum).padStart(2, '0')}`;
                          
                          // Check for orders
                          const hasOrders = orders.some(o => {
                            const oDate = new Date(o.created_at);
                            return oDate.getDate() === dateNum && 
                                   oDate.getMonth() === month && 
                                   oDate.getFullYear() === year;
                          });

                          // Check for events
                          const dayEvents = eventsNotes.filter(e => e.date === dayDateStr);
                          
                          // Check for special closures / holidays
                          const closure = (shopSettings?.specialClosures || []).find(c => c.date === dayDateStr);
                          const isClosed = !!closure;
                          const hasEvents = dayEvents.length > 0 || isClosed;

                          // Tooltip description
                          const tooltipParts = [];
                          if (isClosed) {
                            tooltipParts.push(`🚨 CLOSED: ${closure.reason}`);
                          }
                          if (dayEvents.length > 0) {
                            dayEvents.forEach(e => {
                              tooltipParts.push(`📌 ${e.title}${e.description ? `: ${e.description}` : ''}`);
                            });
                          }
                          if (hasOrders) {
                            tooltipParts.push(`🛒 Orders placed on this day`);
                          }
                          const tooltipText = tooltipParts.length > 0 
                            ? tooltipParts.join('\n') 
                            : `Click to add event/note for day ${dateNum}`;

                          // Background & text color styling
                          let bgColor = 'transparent';
                          let textColor = '#1e293b';
                          if (isSelected) {
                            bgColor = '#ef4444';
                            textColor = 'white';
                          } else if (isClosed) {
                            bgColor = 'rgba(239, 68, 68, 0.2)';
                            textColor = '#dc2626';
                          } else if (hasEvents) {
                            bgColor = 'rgba(255, 199, 44, 0.3)';
                            textColor = '#d97706';
                          } else if (hasOrders) {
                            bgColor = 'rgba(239, 68, 68, 0.1)';
                            textColor = '#ef4444';
                          }

                          return (
                            <div 
                              key={i} 
                              onClick={() => {
                                const d = new Date(selectedCalendarDate);
                                d.setDate(dateNum);
                                setSelectedCalendarDate(d);
                                handleOpenAddEventModal(dayDateStr);
                              }}
                              title={tooltipText}
                              style={{ 
                                aspectRatio: '1', 
                                display: 'flex', 
                                flexDirection: 'column',
                                alignItems: 'center', 
                                justifyContent: 'center', 
                                fontSize: '0.8rem', 
                                borderRadius: '50%',
                                cursor: 'pointer',
                                backgroundColor: bgColor,
                                color: textColor,
                                fontWeight: isSelected || hasOrders || hasEvents ? 'bold' : 'normal',
                                position: 'relative'
                              }}
                            >
                              {dateNum}
                              {hasEvents && !isSelected && (
                                <span style={{ 
                                  width: '4px', 
                                  height: '4px', 
                                  borderRadius: '50%', 
                                  background: isClosed ? '#ef4444' : '#d97706', 
                                  marginTop: '1px' 
                                }}></span>
                              )}
                            </div>
                          );
                        });

                        return [...emptyCells, ...dayCells];
                      })()}
                    </div>
                  </div>

                  <div className="admin-card" style={{ padding: '1.5rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: 0 }}>Last Reports</h3>
                    <span onClick={() => navigate('/admin/reports')} style={{ fontSize: '0.8rem', color: '#3b82f6', cursor: 'pointer', textDecoration: 'underline' }}>See all</span>
                  </div>
                  <div style={{ display: 'flex', gap: '1rem', flex: 1 }}>
                     <div style={{ flex: 1, border: '1px solid #fee2e2', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff5f5' }}>
                        <div style={{ color: '#ef4444', marginBottom: '8px' }}><Archive size={32} /></div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{new Date().toLocaleString('default', { month: 'short' })} Report</div>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{new Date().getFullYear()}</div>
                     </div>
                     <div style={{ flex: 1, border: '2px dashed #cbd5e1', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.2s' }} className="hover-bg-slate">
                        <div style={{ color: '#64748b', marginBottom: '8px' }}><PlusSquare size={32} /></div>
                        <div style={{ fontSize: '0.9rem', color: '#64748b' }}>Create New</div>
                     </div>
                  </div>
                  <button 
                    onClick={handleGeneratePDF}
                    style={{ marginTop: '1rem', width: '100%', padding: '12px', backgroundColor: '#e05943', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                  >
                    Download PDF <ArrowDown size={18} />
                  </button>
                </div>
                </div>

                {/* Column 2: NOTES & UPCOMING EVENTS + Customer Insights */}
                <div style={{ gridColumn: 'span 4', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                  {/* NOTES & UPCOMING EVENTS Box */}
                  <div className="admin-card" style={{
                    background: '#1e293b',
                    color: '#ffffff',
                    padding: '1.5rem',
                    borderRadius: '16px',
                    border: '2px solid rgba(255, 199, 44, 0.4)',
                    boxShadow: '0 8px 20px rgba(0,0,0,0.2)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <div>
                        <h3 style={{ margin: 0, color: '#FFC72C', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          📌 NOTES & UPCOMING EVENTS
                        </h3>
                        <p style={{ margin: '2px 0 0', color: '#94a3b8', fontSize: '0.78rem' }}>
                          Store schedule & active promotions. Click calendar dates or button to edit.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenAddEventModal()}
                        style={{
                          padding: '6px 12px', borderRadius: '8px', background: '#E8491D', color: '#fff',
                          border: 'none', fontWeight: 'bold', fontSize: '0.8rem', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0
                        }}
                      >
                        + Add Event
                      </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '220px', overflowY: 'auto' }}>
                      {/* Active Promos from Menu */}
                      {activePromosFromMenu.map(p => (
                        <div key={p.id} style={{
                          background: '#451a03', borderLeft: '4px solid #f59e0b', padding: '8px 12px', borderRadius: '8px'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 'bold', color: '#fef3c7', fontSize: '0.85rem' }}>{p.title}</span>
                            <span style={{ background: '#f59e0b', color: '#000', fontSize: '0.65rem', fontWeight: 800, padding: '2px 6px', borderRadius: '8px' }}>PROMO</span>
                          </div>
                          <div style={{ fontSize: '0.78rem', color: '#cbd5e1', marginTop: '2px' }}>{p.description}</div>
                        </div>
                      ))}

                      {/* Special Closures / Holidays */}
                      {(shopSettings?.specialClosures || []).map(closure => (
                        <div
                          key={`closure-${closure.date}`}
                          style={{
                            background: '#450a0a',
                            borderLeft: '4px solid #dc2626',
                            padding: '8px 12px',
                            borderRadius: '8px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 'bold', color: '#fca5a5', fontSize: '0.85rem' }}>🚨 CLOSED: {closure.reason}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '0.72rem', color: '#f87171', fontWeight: 600 }}>{closure.date}</span>
                              <span style={{
                                background: '#dc2626',
                                color: '#fff', fontSize: '0.65rem', fontWeight: 800, padding: '2px 6px', borderRadius: '8px'
                              }}>
                                HOLIDAY
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* Custom Events & Notes */}
                      {eventsNotes.map(evt => (
                        <div
                          key={evt.id}
                          onClick={() => handleOpenEditEventModal(evt)}
                          style={{
                            background: '#0f172a',
                            borderLeft: evt.type === 'promo' ? '4px solid #ef4444' : evt.type === 'event' ? '4px solid #3b82f6' : '4px solid #10b981',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            cursor: 'pointer'
                          }}
                          className="hover-bg-slate"
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 'bold', color: '#fff', fontSize: '0.85rem' }}>{evt.title}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>{evt.date}</span>
                              <span style={{
                                background: evt.type === 'promo' ? '#ef4444' : evt.type === 'event' ? '#0284c7' : '#10b981',
                                color: '#fff', fontSize: '0.65rem', fontWeight: 800, padding: '2px 6px', borderRadius: '8px'
                              }}>
                                {(evt.type || 'event').toUpperCase()}
                              </span>
                            </div>
                          </div>
                          {evt.description && (
                            <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '2px' }}>{evt.description}</div>
                          )}
                        </div>
                      ))}

                      {eventsNotes.length === 0 && activePromosFromMenu.length === 0 && (shopSettings?.specialClosures || []).length === 0 && (
                        <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem', padding: '0.75rem 0' }}>
                          No notes or events listed. Click "+ Add Event" to add one!
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Customer Insights */}
                  <div className="admin-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                      <h3 style={{ margin: 0 }}><Users size={18} style={{ display: 'inline', marginRight: '8px', color: '#ef4444' }}/>Customer Insights</h3>
                      <div style={{ fontSize: '0.75rem', color: '#64748b', backgroundColor: '#f1f5f9', padding: '2px 8px', borderRadius: '12px' }}>Pickup Only</div>
                    </div>
                    
                    {/* New vs Returning */}
                    <div style={{ marginBottom: '1.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
                        <span style={{ fontWeight: 600, color: '#1e293b' }}>New: {customerInsights.newCount} ({customerInsights.newPercent.toFixed(1)}%)</span>
                        <span style={{ fontWeight: 600, color: '#3b82f6' }}>Returning: {customerInsights.returningCount} ({customerInsights.returningPercent.toFixed(1)}%)</span>
                      </div>
                      <div style={{ height: '8px', borderRadius: '4px', backgroundColor: '#e2e8f0', display: 'flex', overflow: 'hidden' }}>
                        <div style={{ width: `${customerInsights.newPercent}%`, backgroundColor: '#ef4444', transition: 'width 1s ease-in-out' }}></div>
                        <div style={{ width: `${customerInsights.returningPercent}%`, backgroundColor: '#3b82f6', transition: 'width 1s ease-in-out' }}></div>
                      </div>
                    </div>
                    
                    {/* Order Frequency */}
                    <div style={{ backgroundColor: '#f8fafc', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', textAlign: 'center', border: '1px solid #f1f5f9' }}>
                      <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '4px' }}>Avg. Order Frequency</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>
                         {customerInsights.avgOrderFrequency > 0 
                            ? `Every ${customerInsights.avgOrderFrequency.toFixed(1)} days`
                            : 'Not enough data yet'
                         }
                      </div>
                    </div>
                    
                    {/* Top Customers by Spend */}
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                       <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#64748b', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Top Spenders</div>
                       <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                         {customerInsights.topSpenders.map((cust, idx) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '0.75rem', borderBottom: idx < customerInsights.topSpenders.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b' }}>{cust.name}</div>
                                <div style={{ color: '#64748b', fontSize: '0.75rem' }}>Faves: <span style={{color:'#0f172a'}}>{cust.favoriteItem}</span></div>
                              </div>
                              <div style={{ fontWeight: 700, color: '#10b981', fontSize: '0.9rem' }}>
                                RM {(cust.totalSpend / 100).toFixed(2)}
                              </div>
                            </div>
                         ))}
                         {customerInsights.topSpenders.length === 0 && (
                           <div style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', padding: '1rem 0' }}>No customers yet</div>
                         )}
                       </div>
                    </div>
                  </div>

                </div>

                {/* Top 10 Best-Selling Items - 4 cols */}
                <div className="admin-card" style={{ gridColumn: 'span 4', padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ margin: 0 }}>Top 10 Best-Selling</h3>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, overflowY: 'auto' }}>
                    {topItemsData.map((item, idx) => (
                         <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '1rem', borderBottom: idx < topItemsData.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                               <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundImage: `url(${item.image})`, backgroundSize: 'cover', backgroundPosition: 'center' }}></div>
                               <div>
                                 <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.name}</div>
                                 <div style={{ color: '#64748b', fontSize: '0.8rem' }}>{item.sales} units sold</div>
                               </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e293b' }}>RM {item.revenue.toFixed(2)}</div>
                            </div>
                         </div>
                       ))}
                       {topItemsData.length === 0 && (
                         <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: '2rem' }}>No sales data yet</div>
                       )}
                  </div>
                </div>

              </div>
            </div>
          )}

          {activeTab === 'analytics' && (
          <div className="admin-analytics-dashboard" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Header Area */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.5rem' }}>Analytics & Intelligence</h3>
              
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Custom Date Range Picker */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#f1f5f9', padding: '4px', borderRadius: '8px' }}>
                  <Calendar size={16} className="text-muted" style={{ marginLeft: '4px' }} />
                  <input 
                    type="date" 
                    className="price-input" 
                    value={selectedDateRange.start}
                    onChange={(e) => setSelectedDateRange(prev => ({ ...prev, start: e.target.value }))}
                    style={{ padding: '4px 8px', fontSize: '0.75rem', border: 'none', background: 'transparent' }}
                  />
                  <span style={{ color: '#64748b', fontSize: '0.75rem' }}>to</span>
                  <input 
                    type="date" 
                    className="price-input" 
                    value={selectedDateRange.end}
                    onChange={(e) => setSelectedDateRange(prev => ({ ...prev, end: e.target.value }))}
                    style={{ padding: '4px 8px', fontSize: '0.75rem', border: 'none', background: 'transparent' }}
                  />
                  {(selectedDateRange.start || selectedDateRange.end) && (
                    <button 
                      onClick={() => setSelectedDateRange({ start: '', end: '' })}
                      style={{ padding: '4px 8px', borderRadius: '4px', border: 'none', background: '#e2e8f0', color: '#64748b', fontSize: '0.75rem', cursor: 'pointer' }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                {/* Period Toggle */}
                <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderRadius: '8px', padding: '4px' }}>
                  {['daily', 'monthly', 'yearly'].map(period => (
                    <button 
                      key={period}
                      onClick={() => {
                        setAnalyticsPeriod(period);
                        setSelectedDateRange({ start: '', end: '' }); // Clear range when using quick toggles
                      }}
                      style={{
                        padding: '6px 16px', borderRadius: '6px', border: 'none',
                        background: analyticsPeriod === period && !selectedDateRange.start ? '#fff' : 'transparent',
                        color: analyticsPeriod === period && !selectedDateRange.start ? '#0f172a' : '#64748b',
                        fontWeight: analyticsPeriod === period && !selectedDateRange.start ? '600' : '500',
                        fontSize: '0.875rem', cursor: 'pointer',
                        boxShadow: analyticsPeriod === period && !selectedDateRange.start ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                        transition: 'all 0.2s', textTransform: 'capitalize'
                      }}
                    >
                      {period === 'daily' ? 'This Week' : period === 'monthly' ? 'This Month' : period === 'yearly' ? 'Yearly' : period}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Row 1: KPI Top Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.5rem' }}>
              <div className="admin-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ color: '#64748b', fontSize: '0.875rem', fontWeight: 600 }}>Total Orders</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a' }}>{kpi.orderCount}</div>
                <div style={{ fontSize: '0.75rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}><TrendingUp size={12}/> +12% from yesterday</div>
              </div>
              <div className="admin-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ color: '#64748b', fontSize: '0.875rem', fontWeight: 600 }}>Gross Sales</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a' }}>RM {kpi.totalGrossSales.toFixed(2)}</div>
              </div>
              <div className="admin-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ color: '#64748b', fontSize: '0.875rem', fontWeight: 600 }}>Est. Net Profit</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#10b981' }}>RM {kpi.totalNetProfit.toFixed(2)}</div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Net Margin: <span style={{fontWeight: 700}}>{kpi.netMarginPercent.toFixed(1)}%</span></div>
              </div>
              <div className="admin-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ color: '#64748b', fontSize: '0.875rem', fontWeight: 600 }}>Inventory Alert</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: lowStockCount > 0 ? '#ef4444' : '#0f172a' }}>{lowStockCount}</div>
                
                {lowStockCount > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                    {lowStockItems.slice(0, 3).map(item => (
                      <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748b' }}>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100px' }}>{item.name}</span>
                        <span style={{ fontWeight: 600, color: '#ef4444' }}>{item.stock_quantity} left</span>
                      </div>
                    ))}
                    {lowStockCount > 3 && <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>+{lowStockCount - 3} more...</div>}
                  </div>
                )}
                
                <div style={{ fontSize: '0.75rem', color: '#3b82f6', textDecoration: 'underline', marginTop: 'auto', cursor: 'pointer' }} onClick={() => setActiveTab('inventory')}>
                  Manage Inventory
                </div>
              </div>
            </div>

            {/* Row 2: Main Chart & Performance Sidebar */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
              
              {/* Stacked Bar Chart */}
              <div className="admin-card" style={{ gridColumn: 'span 2', padding: '1.5rem' }}>
                <h4 style={{ margin: 0, marginBottom: '1.5rem', color: '#0f172a', fontSize: '1.125rem' }}>Total Revenue by Channel</h4>
                <div style={{ height: '350px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trendData} margin={{ top: 5, right: 0, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="displayDate" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dx={-10} />
                      <RechartsTooltip 
                        cursor={{ fill: '#f8fafc' }}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#64748b' }}/>
                      <Bar dataKey="web" name="Web App Direct" stackId="a" fill="#E8491D" radius={[0, 0, 0, 0]} barSize={40} />
                      <Bar dataKey="loyverse" name="Loyverse POS (Walk-in)" stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Sidebar: Performance & Channels */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div className="admin-card" style={{ padding: '1.5rem', flex: 1 }}>
                  <h4 style={{ margin: 0, marginBottom: '1.5rem', color: '#0f172a', fontSize: '1.125rem' }}>Performance</h4>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '1rem' }}>
                    <span style={{ color: '#64748b', fontSize: '0.875rem' }}>Order Completion Rate</span>
                    <span style={{ fontWeight: 800, fontSize: '1.125rem', color: '#10b981' }}>{totalCompleted > 0 ? ((totalCompleted / (orders.length || 1)) * 100).toFixed(1) : 0}%</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#64748b', fontSize: '0.875rem' }}>Avg Prep / Fulfillment</span>
                    <span style={{ fontWeight: 800, fontSize: '1.125rem', color: '#f59e0b' }}>12 mins</span>
                  </div>
                </div>

                <div className="admin-card" style={{ padding: '1.5rem', flex: 2 }}>
                   <h4 style={{ margin: 0, marginBottom: '1rem', color: '#0f172a', fontSize: '1.125rem' }}>Channel Share</h4>
                   <div style={{ height: '200px' }}>
                     <ResponsiveContainer width="100%" height="100%">
                       <PieChart>
                         <Pie 
                           data={[
                             {name: 'Web App Direct', value: channelSales.web},
                             {name: 'Loyverse POS', value: channelSales.loyverse}
                           ]} 
                           cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value"
                         >
                           <Cell fill="#E8491D" />
                           <Cell fill="#10b981" />
                         </Pie>
                         <RechartsTooltip />
                       </PieChart>
                     </ResponsiveContainer>
                   </div>
                   <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', fontSize: '0.75rem', color: '#64748b' }}>
                     <div style={{display:'flex', alignItems:'center', gap:'4px'}}><div style={{width:'8px',height:'8px',backgroundColor:'#E8491D',borderRadius:'50%'}}></div> Web App</div>
                     <div style={{display:'flex', alignItems:'center', gap:'4px'}}><div style={{width:'8px',height:'8px',backgroundColor:'#10b981',borderRadius:'50%'}}></div> Loyverse POS</div>
                   </div>
                </div>
              </div>
            </div>


            {/* Row 3: Bottom Intelligence Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.5rem', alignItems: 'start' }}>
              
              <div className="admin-card" style={{ gridColumn: 'span 2', padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                  <h4 style={{ margin: 0, color: '#0f172a', fontSize: '1.125rem' }}>Best-Selling Items Intelligence</h4>
                  <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderRadius: '6px', padding: '3px' }}>
                    {['all', 'web', 'loyverse'].map(filter => (
                      <button 
                        key={filter}
                        onClick={() => setTopItemsChannelFilter(filter)}
                        style={{
                          padding: '4px 12px', borderRadius: '4px', border: 'none',
                          background: topItemsChannelFilter === filter ? '#fff' : 'transparent',
                          color: topItemsChannelFilter === filter ? '#0f172a' : '#64748b',
                          fontWeight: topItemsChannelFilter === filter ? '600' : '500',
                          fontSize: '0.75rem', cursor: 'pointer', textTransform: 'capitalize',
                          boxShadow: topItemsChannelFilter === filter ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                        }}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', fontWeight: 700, fontSize: '0.8rem', color: '#64748b', borderBottom: '2px solid #f1f5f9', paddingBottom: '0.5rem', textTransform: 'uppercase' }}>
                    <div style={{ flex: 3 }}>Item Name</div>
                    <div style={{ flex: 1, textAlign: 'center' }}>Units Sold</div>
                    <div style={{ flex: 2, textAlign: 'right' }}>Gross Revenue</div>
                    <div style={{ flex: 1, textAlign: 'right' }}>Margin</div>
                  </div>
                  {topItemsData.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #f8fafc', paddingBottom: '0.75rem', paddingTop: '0.25rem' }}>
                       <div style={{ flex: 3, display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={{ width: '32px', height: '32px', borderRadius: '6px', backgroundImage: `url(${item.image})`, backgroundSize: 'cover' }}></div>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#0f172a' }}>{item.name}</div>
                       </div>
                       <div style={{ flex: 1, textAlign: 'center', fontWeight: 600, color: '#3b82f6' }}>{item.sales}</div>
                       <div style={{ flex: 2, textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>RM {item.revenue.toFixed(2)}</div>
                       <div style={{ flex: 1, textAlign: 'right', fontWeight: 700, color: '#10b981' }}>{item.margin.toFixed(1)}%</div>
                    </div>
                  ))}
                  {topItemsData.length === 0 && <div style={{textAlign: 'center', color: '#94a3b8', padding: '1rem'}}>No sales data yet</div>}
                </div>
              </div>

              <div className="admin-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column' }}>
                <h4 style={{ margin: 0, marginBottom: '1rem', color: '#0f172a', fontSize: '1.125rem' }}>Channel Net Margin Breakdown</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1, justifyContent: 'center' }}>
                  {Object.entries(channelStats).map(([key, stat]) => {
                    if (stat.gross === 0) return null; // Don't show fabricated data for empty channels
                    const computedMargin = stat.gross > 0 ? ((stat.net / stat.gross) * 100).toFixed(1) : 0;
                    const feePercent = (CHANNEL_FEES[key] * 100).toFixed(0);
                    return (
                      <div key={key} style={{ padding: '0.75rem', backgroundColor: `${stat.color}10`, borderRadius: '8px', borderLeft: `4px solid ${stat.color}` }}>
                        <div style={{ fontSize: '0.85rem', color: stat.color, fontWeight: 600, marginBottom: '0.25rem' }}>{stat.name}</div>
                        <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                          {computedMargin}% 
                          <span style={{fontSize:'0.7rem', fontWeight:400, marginLeft: '6px', color: '#64748b'}}>
                            ({feePercent}% Fee)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {Object.values(channelStats).every(stat => stat.gross === 0) && (
                    <div style={{ textAlign: 'center', color: '#94a3b8', padding: '1rem' }}>No channel data yet</div>
                  )}
                </div>
              </div>

              {/* What-If GrabFood Projection */}
              <div className="admin-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', background: 'linear-gradient(to bottom right, #f0fdf4, #ffffff)', border: '1px solid #bbf7d0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                  <h4 style={{ margin: 0, color: '#166534', fontSize: '1.125rem' }}>GrabFood Projection 📊</h4>
                  <span style={{ fontSize: '0.65rem', backgroundColor: '#dcfce3', color: '#166534', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>ESTIMATE</span>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontSize: '0.8rem', color: '#166534', fontWeight: 600 }}>Shift {grabFoodShiftPercent}% Volume to Grab</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="100" 
                      step="1"
                      value={grabFoodShiftPercent}
                      onChange={(e) => setGrabFoodShiftPercent(Number(e.target.value))}
                      style={{ width: '100%', cursor: 'pointer', accentColor: '#16a34a' }}
                    />
                  </div>
                  
                  {(() => {
                    const shiftAmount = kpi.totalGrossSales * (grabFoodShiftPercent / 100);
                    const originalNet = shiftAmount - (shiftAmount * 0.40); // 40% COGS
                    const grabNet = shiftAmount - (shiftAmount * 0.40) - (shiftAmount * CHANNEL_FEES.grabfood);
                    const profitDifference = grabNet - originalNet;
                    
                    return (
                      <div style={{ padding: '0.75rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px dashed #bbf7d0' }}>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Projected Net Profit Change</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 800, color: profitDifference < 0 ? '#ef4444' : (profitDifference > 0 ? '#10b981' : '#0f172a') }}>
                          {profitDifference < 0 ? '-' : '+'}RM {Math.abs(profitDifference).toFixed(2)}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px' }}>
                          Assuming {grabFoodShiftPercent}% (RM {shiftAmount.toFixed(2)}) is shifted from Walk-in/Web to GrabFood ({(CHANNEL_FEES.grabfood * 100).toFixed(0)}% fee).
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

            </div>
            
            {/* Row 4: Peak Hours Breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1, 1fr)', gap: '1.5rem', marginTop: '1.5rem' }}>
              <div className="admin-card" style={{ padding: '1.5rem' }}>
                <h4 style={{ margin: 0, marginBottom: '1.5rem', color: '#0f172a', fontSize: '1.125rem' }}>Peak Hours Breakdown</h4>
                <div style={{ height: '300px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourlyTrendData} margin={{ top: 5, right: 0, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="displayHour" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dx={-10} />
                      <RechartsTooltip 
                        cursor={{ fill: '#f8fafc' }}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#64748b' }}/>
                      <Bar dataKey="web" name="Web App Direct" stackId="a" fill="#E8491D" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="grabfood" name="GrabFood" stackId="a" fill="#16a34a" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="loyverse" name="Loyverse / Walk-in" stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
          )}

        {activeTab === 'orders' && (
        <div className="admin-card">
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1.5rem'}}>
            <h3 style={{margin:0}}>Live Orders</h3>
            {pendingOrders.length > 0 && (
              <span className="pending-badge-pill">{pendingOrders.length} NEW</span>
            )}
          </div>

          {/* ── PENDING ORDER ALERT CARDS ── */}
          {pendingOrders.map(order => (
            <div key={order.id} className="pending-alert-card">
              <div className="pending-alert-top">
                <div className="pending-alert-icon">🔔</div>
                <div className="pending-alert-info">
                  <div className="pending-alert-title">NEW ORDER INCOMING!</div>
                  <div className="pending-alert-id">{order.id} · RM {(order.total / 100).toFixed(2)}</div>
                  <div className="text-sm mt-1 mb-2">
                    <span className="font-bold">{order.customer_name || 'Guest'}</span>
                    {order.customer_phone && order.customer_phone !== 'No Phone' && <span className="text-muted ml-2">📞 {order.customer_phone}</span>}
                  </div>
                  <div className="pending-alert-items">
                    {order.items.map((item, i) => (
                      <span key={i}>{item.quantity}× {item.name}{i < order.items.length - 1 ? ', ' : ''}</span>
                    ))}
                  </div>
                </div>
                <button
                  className="pending-accept-btn"
                  onClick={() => handleAccept(order.id)}
                >
                  ✓ Accept<br/>
                  <span style={{fontSize:'0.65rem', opacity:0.85}}>
                    {order.total >= 10000 ? '20 min' : '15 min'} timer
                  </span>
                </button>
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
                          onClick={() => {
                            const reason = window.prompt("Enter cancellation reason:");
                            if (reason && reason.trim()) {
                              cancelOrder(order.id, reason.trim());
                            } else {
                              alert("Cancellation reason is required.");
                            }
                          }}
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
                            <img src={item.image} alt={item.name} style={{ width: '36px', height: '36px', borderRadius: '8px', objectFit: 'cover' }} />
                          )}
                          <div>
                            <div>{item.name}</div>
                            {item.description && (
                              <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 'normal' }}>{item.description.slice(0, 40)}{item.description.length > 40 ? '...' : ''}</div>
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
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
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
                            <button 
                              className={`btn btn-sm ${promo.active ? 'btn-secondary' : 'btn-outline'}`} 
                              onClick={() => togglePromoCodeActive(promo.id, promo.active)}
                              style={{ width: '80px', padding: '4px', fontSize: '0.75rem' }}
                            >
                              {promo.active ? 'Active' : 'Inactive'}
                            </button>
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
                    value={promoFormData.starts_at}
                    onChange={(e) => setPromoFormData({ ...promoFormData, starts_at: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>ENDS AT</label>
                  <input
                    type="datetime-local"
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
    </div>
    </div>
  );
}
