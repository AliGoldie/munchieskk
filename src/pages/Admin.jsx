import { useState, useEffect, useRef, useMemo } from 'react';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import { Navigate, useNavigate } from 'react-router-dom';
import { startNewOrderAlert, stopNewOrderAlert } from '../utils/soundAlert';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  ComposedChart, Area, Line, Legend, PieChart, Pie, Cell
} from 'recharts';
import { LayoutDashboard, BarChart2, ShoppingBag, Users, Layers, PlusSquare, TrendingUp, CheckCircle, AlertTriangle, Calendar, Archive, ArrowDown } from 'lucide-react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import './Admin.css';

export default function Admin() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { 
    menu, toggleStock, updatePrice, updateLowStockThreshold, addMenuItem, updateStock, setStockQuantity,
    orders, updateOrderState, acceptOrder, customers, cancelOrder,
    addons, itemAddons, addAddon, deleteAddon, toggleItemAddon, uploadImage, updateAddonPrice,
    isPromoActive, updatePromo
  } = useStore();
  
  const [editingPrice, setEditingPrice] = useState({});
  const [editingAddonPrice, setEditingAddonPrice] = useState({});
  const [editingStock, setEditingStock] = useState({});
  const [editingLowStock, setEditingLowStock] = useState({});
  const [editingPromo, setEditingPromo] = useState({});
  const [activeTab, setActiveTab] = useState('overview');
  const [analyticsPeriod, setAnalyticsPeriod] = useState('daily'); // 'daily', 'monthly', 'yearly'
  const [selectedDate, setSelectedDate] = useState(''); // YYYY-MM-DD
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

  if (!user || user.role !== 'admin') {
    return <Navigate to="/login" replace />;
  }

  const pendingOrders = orders.filter(o => o.status === 'PENDING');
  const activeOrders = orders.filter(o => o.status !== 'COLLECTED' && o.status !== 'CANCELLED');
  
  const [now, setNow] = useState(Date.now());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(new Date());

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
  const lowStockCount = menu.filter(item => (item.stock_quantity ?? 99) <= (item.low_stock_threshold ?? 5)).length;

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
    if (selectedDate) {
      cutoff = new Date(selectedDate);
    } else {
      if (analyticsPeriod === 'daily') cutoff.setDate(cutoff.getDate() - 7);
      else if (analyticsPeriod === 'monthly') cutoff.setMonth(cutoff.getMonth() - 6);
      else if (analyticsPeriod === 'yearly') cutoff.setFullYear(cutoff.getFullYear() - 3);
    }
    
    cutoff.setHours(0, 0, 0, 0);

    let periodOrders = validOrders.filter(o => new Date(o.created_at || now) >= cutoff);
    if (selectedDate) {
      const endOfDay = new Date(cutoff);
      endOfDay.setHours(23, 59, 59, 999);
      periodOrders = periodOrders.filter(o => new Date(o.created_at || now) <= endOfDay);
    }
    
    // KPI Metrics
    let totalGrossSales = 0;
    let totalNetProfit = 0;
    let channelSales = { walkIn: 0, whatsApp: 0, grabFood: 0 };
    let orderCount = periodOrders.length;
    let previousPeriodOrderCount = 0; // Mock comparison

    // Top 10 Sales with Margin Calculation
    const itemStats = {};
    periodOrders.forEach(order => {
      // Channel mocking based on char code
      const charCode = (order.id && order.id.charCodeAt(0)) || 0;
      let channel = 'Walk-in';
      if (charCode % 3 === 1) channel = 'WhatsApp';
      if (charCode % 3 === 2) channel = 'GrabFood';

      const orderGross = order.total / 100;
      let orderNet = orderGross;
      
      // Assume 40% COGS flat
      const cogs = orderGross * 0.40;
      orderNet -= cogs;
      // Grab commission 30%
      if (channel === 'GrabFood') {
        orderNet -= (orderGross * 0.30);
        channelSales.grabFood += orderGross;
      } else if (channel === 'WhatsApp') {
        channelSales.whatsApp += orderGross;
      } else {
        channelSales.walkIn += orderGross;
      }

      totalGrossSales += orderGross;
      totalNetProfit += orderNet;

      (order.items || []).forEach(item => {
        if (!itemStats[item.name]) itemStats[item.name] = { quantity: 0, revenue: 0, netProfit: 0 };
        const itemQty = item.quantity || 1;
        const itemRev = ((item.price || 0) * itemQty) / 100;
        
        let itemNet = itemRev - (itemRev * 0.40); // 40% COGS
        if (channel === 'GrabFood') itemNet -= (itemRev * 0.30);

        itemStats[item.name].quantity += itemQty;
        itemStats[item.name].revenue += itemRev;
        itemStats[item.name].netProfit += itemNet;
      });
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
    if (analyticsPeriod === 'daily') {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(nowD);
        d.setDate(d.getDate() - i);
        trendData.push({
          dateStr: d.toISOString().split('T')[0],
          displayDate: d.toLocaleDateString('en-US', { weekday: 'short' }),
          revenue: 0, walkIn: 0, whatsApp: 0, grabFood: 0, ordersCount: 0
        });
      }
    } else if (analyticsPeriod === 'monthly') {
      for (let i = 5; i >= 0; i--) {
        const d = new Date(nowD);
        d.setMonth(d.getMonth() - i);
        trendData.push({
          dateStr: `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}`,
          displayDate: d.toLocaleDateString('en-US', { month: 'short' }),
          revenue: 0, walkIn: 0, whatsApp: 0, grabFood: 0, ordersCount: 0
        });
      }
    } else if (analyticsPeriod === 'yearly') {
      for (let i = 2; i >= 0; i--) {
        const d = new Date(nowD);
        d.setFullYear(d.getFullYear() - i);
        trendData.push({
          dateStr: `${d.getFullYear()}`,
          displayDate: `${d.getFullYear()}`,
          revenue: 0, walkIn: 0, whatsApp: 0, grabFood: 0, ordersCount: 0
        });
      }
    }
    
    periodOrders.forEach(order => {
      const orderD = new Date(order.created_at || now);
      let matchedBucket = null;

      if (analyticsPeriod === 'daily' || selectedDate) {
        const dateStr = orderD.toISOString().split('T')[0];
        matchedBucket = trendData.find(d => d.dateStr === dateStr);
        if (selectedDate && !matchedBucket) {
           matchedBucket = { dateStr, displayDate: dateStr, revenue: 0, walkIn: 0, whatsApp: 0, grabFood: 0, ordersCount: 0 };
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
        
        const charCode = (order.id && order.id.charCodeAt(0)) || 0;
        if (charCode % 3 === 1) matchedBucket.whatsApp += gross;
        else if (charCode % 3 === 2) matchedBucket.grabFood += gross;
        else matchedBucket.walkIn += gross;
      }
    });

    const netMarginPercent = totalGrossSales > 0 ? (totalNetProfit / totalGrossSales) * 100 : 0;

    return { 
      topItemsData, 
      trendData, 
      kpi: { totalGrossSales, totalNetProfit, netMarginPercent, orderCount, previousPeriodOrderCount },
      channelSales
    };
  };

  const { topItemsData, trendData, kpi, channelSales } = processAnalyticsData();

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
                {/* Calendar & Reports */}
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
                      {Array.from({ length: 30 }).map((_, i) => {
                        const dateNum = i + 1;
                        const isSelected = selectedCalendarDate.getDate() === dateNum;
                        const hasOrders = orders.some(o => new Date(o.created_at).getDate() === dateNum && new Date(o.created_at).getMonth() === selectedCalendarDate.getMonth());
                        return (
                          <div 
                            key={i} 
                            onClick={() => {
                              const d = new Date(selectedCalendarDate);
                              d.setDate(dateNum);
                              setSelectedCalendarDate(d);
                            }}
                            style={{ 
                              aspectRatio: '1', 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'center', 
                              fontSize: '0.8rem', 
                              borderRadius: '50%',
                              cursor: 'pointer',
                              backgroundColor: isSelected ? '#ef4444' : hasOrders ? 'rgba(239, 68, 68, 0.1)' : 'transparent',
                              color: isSelected ? 'white' : hasOrders ? '#ef4444' : '#1e293b',
                              fontWeight: isSelected || hasOrders ? 'bold' : 'normal'
                            }}
                          >
                            {dateNum}
                          </div>
                        )
                      })}
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

                {/* Customer Insights - 4 cols */}
                <div className="admin-card" style={{ gridColumn: 'span 4', padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
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
                              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e293b' }}>RM {(item.revenue / 100).toFixed(2)}</div>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Calendar size={16} className="text-muted" />
                  <input 
                    type="date" 
                    className="price-input" 
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    style={{ padding: '4px 8px', fontSize: '0.875rem' }}
                  />
                  {selectedDate && (
                    <button className="btn btn-sm btn-secondary" onClick={() => setSelectedDate('')}>Clear</button>
                  )}
                </div>
                {/* Period Toggle */}
                <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderRadius: '8px', padding: '4px' }}>
                  {['daily', 'monthly', 'yearly'].map(period => (
                    <button 
                      key={period}
                      onClick={() => setAnalyticsPeriod(period)}
                      style={{
                        padding: '6px 16px', borderRadius: '6px', border: 'none',
                        background: analyticsPeriod === period ? '#fff' : 'transparent',
                        color: analyticsPeriod === period ? '#0f172a' : '#64748b',
                        fontWeight: analyticsPeriod === period ? '600' : '500',
                        fontSize: '0.875rem', cursor: 'pointer',
                        boxShadow: analyticsPeriod === period ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
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
              <div className="admin-card hover-bg-slate" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', cursor: 'pointer' }} onClick={() => setActiveTab('inventory')}>
                <div style={{ color: '#64748b', fontSize: '0.875rem', fontWeight: 600 }}>Inventory Alert</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: lowStockCount > 0 ? '#ef4444' : '#0f172a' }}>{lowStockCount}</div>
                <div style={{ fontSize: '0.75rem', color: '#3b82f6', textDecoration: 'underline' }}>View Menu CRM</div>
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
                      <Bar dataKey="walkIn" name="Loyverse / Walk-in" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} barSize={40} />
                      <Bar dataKey="whatsApp" name="WhatsApp Direct" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="grabFood" name="GrabFood" stackId="a" fill="#16a34a" radius={[4, 4, 0, 0]} />
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
                             {name: 'Walk-in', value: channelSales.walkIn},
                             {name: 'WhatsApp', value: channelSales.whatsApp},
                             {name: 'GrabFood', value: channelSales.grabFood}
                           ]} 
                           cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value"
                         >
                           <Cell fill="#10b981" />
                           <Cell fill="#3b82f6" />
                           <Cell fill="#16a34a" />
                         </Pie>
                         <RechartsTooltip />
                       </PieChart>
                     </ResponsiveContainer>
                   </div>
                   <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', fontSize: '0.75rem', color: '#64748b' }}>
                     <div style={{display:'flex', alignItems:'center', gap:'4px'}}><div style={{width:'8px',height:'8px',backgroundColor:'#10b981',borderRadius:'50%'}}></div> Walk-in</div>
                     <div style={{display:'flex', alignItems:'center', gap:'4px'}}><div style={{width:'8px',height:'8px',backgroundColor:'#3b82f6',borderRadius:'50%'}}></div> WhatsApp</div>
                     <div style={{display:'flex', alignItems:'center', gap:'4px'}}><div style={{width:'8px',height:'8px',backgroundColor:'#16a34a',borderRadius:'50%'}}></div> GrabFood</div>
                   </div>
                </div>
              </div>
            </div>

            {/* Row 3: Bottom Intelligence Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
              
              <div className="admin-card" style={{ gridColumn: 'span 2', padding: '1.5rem' }}>
                <h4 style={{ margin: 0, marginBottom: '1.5rem', color: '#0f172a', fontSize: '1.125rem' }}>Best-Selling Items Intelligence</h4>
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

              <div className="admin-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
                <h4 style={{ margin: 0, marginBottom: '1.5rem', color: '#0f172a', fontSize: '1.125rem' }}>Channel Net Margin Breakdown</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, justifyContent: 'center' }}>
                  <div style={{ padding: '1rem', backgroundColor: '#f0fdf4', borderRadius: '8px', borderLeft: '4px solid #10b981' }}>
                    <div style={{ fontSize: '0.85rem', color: '#166534', fontWeight: 600, marginBottom: '0.25rem' }}>Loyverse / Walk-in</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#14532d' }}>60.0% <span style={{fontSize:'0.75rem', fontWeight:400}}>(No Platform Fee)</span></div>
                  </div>
                  <div style={{ padding: '1rem', backgroundColor: '#eff6ff', borderRadius: '8px', borderLeft: '4px solid #3b82f6' }}>
                    <div style={{ fontSize: '0.85rem', color: '#1e40af', fontWeight: 600, marginBottom: '0.25rem' }}>WhatsApp Direct</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1e3a8a' }}>60.0% <span style={{fontSize:'0.75rem', fontWeight:400}}>(No Platform Fee)</span></div>
                  </div>
                  <div style={{ padding: '1rem', backgroundColor: '#f8fafc', borderRadius: '8px', borderLeft: '4px solid #16a34a' }}>
                    <div style={{ fontSize: '0.85rem', color: '#334155', fontWeight: 600, marginBottom: '0.25rem' }}>GrabFood</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>30.0% <span style={{fontSize:'0.75rem', fontWeight:400}}>(30% Grab Commission)</span></div>
                  </div>
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
                    <option value="BBQ">BBQ</option>
                    <option value="PREMIUM">PREMIUM</option>
                    <option value="PLATTERS">PLATTERS</option>
                    <option value="SIDES">SIDES</option>
                    <option value="DRINKS">DRINKS</option>
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
              {menu.filter(item => !item.inStock || (item.stock_quantity ?? 99) <= (item.low_stock_threshold ?? 5)).length === 0 ? (
                <p className="text-muted" style={{ fontSize: '0.9rem' }}>All items stocked!</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: '1rem', color: '#64748b', fontSize: '0.9rem', maxHeight: '200px', overflowY: 'auto' }}>
                  {menu.filter(item => !item.inStock || (item.stock_quantity ?? 99) <= (item.low_stock_threshold ?? 5)).map(item => (
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
                      <td className="font-medium">{item.name}</td>
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
                            value={editingLowStock[item.id] !== undefined ? editingLowStock[item.id] : (item.low_stock_threshold ?? 5)}
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
            <h3 style={{ marginBottom: '1.5rem' }}>Promotions Calendar</h3>
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
      </main>
    </div>
    </div>
  );
}
