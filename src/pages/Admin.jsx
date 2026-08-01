import { useState, useEffect, useRef } from 'react';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { startNewOrderAlert, stopNewOrderAlert } from '../utils/soundAlert';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  ComposedChart, Area, Line, Legend, PieChart, Pie, Cell
} from 'recharts';
import { LayoutDashboard, BarChart2, ShoppingBag, Users, Layers, PlusSquare, TrendingUp, CheckCircle, AlertTriangle, Calendar, Archive } from 'lucide-react';
import './Admin.css';

export default function Admin() {
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
  const [analyticsPeriod, setAnalyticsPeriod] = useState('daily'); // 'daily', 'weekly', 'monthly'
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
  const activeOrders = orders.filter(o => o.status !== 'COLLECTED');
  
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Metrics calculation for Overview
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaysOrders = orders.filter(o => new Date(o.created_at || now) >= todayStart && o.status !== 'PENDING');
  const todaysRevenue = todaysOrders.reduce((sum, o) => sum + o.total, 0);
  const totalCompleted = orders.filter(o => o.status === 'COLLECTED').length;
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
    if (analyticsPeriod === 'daily') cutoff.setDate(cutoff.getDate() - 7);
    else if (analyticsPeriod === 'weekly') cutoff.setDate(cutoff.getDate() - 28);
    else if (analyticsPeriod === 'monthly') cutoff.setMonth(cutoff.getMonth() - 6);
    
    // Set to start of day for cutoff
    cutoff.setHours(0, 0, 0, 0);

    const periodOrders = validOrders.filter(o => new Date(o.created_at || now) >= cutoff);
    
    // Top 10 Sales
    const itemCounts = {};
    periodOrders.forEach(order => {
      (order.items || []).forEach(item => {
        if (!itemCounts[item.name]) itemCounts[item.name] = 0;
        itemCounts[item.name] += item.quantity;
      });
    });
    
    const topItemsData = Object.keys(itemCounts)
      .map(name => ({ name, sales: itemCounts[name] }))
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
          revenue: 0,
          ordersCount: 0
        });
      }
    } else if (analyticsPeriod === 'weekly') {
      for (let i = 3; i >= 0; i--) {
        const d = new Date(nowD);
        d.setDate(d.getDate() - (i * 7));
        const endD = new Date(d);
        endD.setDate(endD.getDate() + 6);
        trendData.push({
          dateStr: d.toISOString().split('T')[0], 
          displayDate: `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
          revenue: 0,
          ordersCount: 0,
          bucketStart: new Date(d).setHours(0,0,0,0),
          bucketEnd: new Date(endD).setHours(23,59,59,999)
        });
      }
    } else if (analyticsPeriod === 'monthly') {
      for (let i = 5; i >= 0; i--) {
        const d = new Date(nowD);
        d.setMonth(d.getMonth() - i);
        trendData.push({
          dateStr: `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}`,
          displayDate: d.toLocaleDateString('en-US', { month: 'short' }),
          revenue: 0,
          ordersCount: 0
        });
      }
    }
    
    periodOrders.forEach(order => {
      const orderD = new Date(order.created_at || now);
      let matchedBucket = null;

      if (analyticsPeriod === 'daily') {
        const dateStr = orderD.toISOString().split('T')[0];
        matchedBucket = trendData.find(d => d.dateStr === dateStr);
      } else if (analyticsPeriod === 'weekly') {
        matchedBucket = trendData.find(d => orderD.getTime() >= d.bucketStart && orderD.getTime() <= d.bucketEnd);
      } else if (analyticsPeriod === 'monthly') {
        const monthStr = `${orderD.getFullYear()}-${(orderD.getMonth()+1).toString().padStart(2, '0')}`;
        matchedBucket = trendData.find(d => d.dateStr === monthStr);
      }

      if (matchedBucket) {
        matchedBucket.revenue += (order.total / 100);
        matchedBucket.ordersCount += 1;
      }
    });

    return { topItemsData, trendData };
  };

  const { topItemsData, trendData } = processAnalyticsData();

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
    const startMs = new Date(startedAt).getTime();
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
              <div className="dashboard-metrics">
                <div className="sedap-metric-card">
                  <div className="sedap-metric-icon green"><ShoppingBag size={28} /></div>
                  <div className="sedap-metric-content">
                    <span className="sedap-metric-value">{orders.length}</span>
                    <span className="sedap-metric-title">Total Orders</span>
                  </div>
                </div>
                <div className="sedap-metric-card">
                  <div className="sedap-metric-icon blue"><CheckCircle size={28} /></div>
                  <div className="sedap-metric-content">
                    <span className="sedap-metric-value">{totalCompleted}</span>
                    <span className="sedap-metric-title">Total Delivered</span>
                  </div>
                </div>
                <div className="sedap-metric-card">
                  <div className="sedap-metric-icon red"><AlertTriangle size={28} /></div>
                  <div className="sedap-metric-content">
                    <span className="sedap-metric-value">{pendingOrders.length + lowStockCount}</span>
                    <span className="sedap-metric-title">Pending / Alerts</span>
                  </div>
                </div>
                <div className="sedap-metric-card">
                  <div className="sedap-metric-icon green"><TrendingUp size={28} /></div>
                  <div className="sedap-metric-content">
                    <span className="sedap-metric-value">RM {(todaysRevenue / 100).toFixed(2)}</span>
                    <span className="sedap-metric-title">Today's Revenue</span>
                  </div>
                </div>
              </div>

              <div className="dashboard-bottom">
                <div className="dashboard-charts">
                  <div className="admin-dashboard-grid">
                    <div className="chart-card">
                      <div className="chart-header">
                        <h3>Sales by Category</h3>
                      </div>
                      <div style={{ height: '220px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={salesByCategoryData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                              {salesByCategoryData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <RechartsTooltip 
                              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}
                              formatter={(value) => `RM ${value.toFixed(2)}`}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                        {salesByCategoryData.map((entry, index) => (
                          <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: '#a3aed1', fontWeight: 600 }}>
                            <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: entry.color }}></div>
                            {entry.name}
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div className="chart-card">
                      <div className="chart-header">
                        <h3>Chart Order</h3>
                      </div>
                      <div style={{ height: '260px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={trendData.slice(0, 7)} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                            <defs>
                              <linearGradient id="colorOrdersBlue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#2d99ff" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#2d99ff" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <XAxis dataKey="displayDate" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#a3aed1' }} dy={10} />
                            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#a3aed1' }} dx={-10} />
                            <RechartsTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }} />
                            <Area type="monotone" dataKey="ordersCount" stroke="#2d99ff" strokeWidth={3} fill="url(#colorOrdersBlue)" activeDot={{ r: 6 }} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="chart-card">
                  <div className="chart-header">
                    <h3>Most Selling Items</h3>
                  </div>
                  <div className="top-selling-list">
                    {topItemsData.slice(0, 5).map((item, idx) => {
                      const menuItem = menu.find(m => m.name === item.name);
                      return (
                        <div key={idx} className="top-selling-item">
                          <div className="top-selling-img" style={{ backgroundImage: `url(${menuItem?.image || '/images/hero_burger.png'})` }}></div>
                          <div className="top-selling-info">
                            <div className="top-selling-name">{item.name}</div>
                            <div className="top-selling-sales">{item.sales} Servings</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'analytics' && (
            <div className="admin-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>Analytics Dashboard</h3>
                
                {/* Period Toggle */}
                <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderRadius: '8px', padding: '4px' }}>
                  {['daily', 'weekly', 'monthly'].map(period => (
                    <button 
                      key={period}
                      onClick={() => setAnalyticsPeriod(period)}
                      style={{
                        padding: '6px 16px',
                        borderRadius: '6px',
                        border: 'none',
                        background: analyticsPeriod === period ? '#fff' : 'transparent',
                        color: analyticsPeriod === period ? '#0f172a' : '#64748b',
                        fontWeight: analyticsPeriod === period ? '600' : '500',
                        fontSize: '0.875rem',
                        cursor: 'pointer',
                        boxShadow: analyticsPeriod === period ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                        transition: 'all 0.2s',
                        textTransform: 'capitalize'
                      }}
                    >
                      {period}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="admin-charts-grid">
                <div className="admin-card" style={{ boxShadow: 'none', border: '1px solid #e2e8f0', margin: 0, padding: '1.5rem' }}>
                  <h4 style={{ marginBottom: '1.5rem', color: '#475569', fontSize: '1rem', fontWeight: 600 }}>Sales & Orders Trend</h4>
                  <div style={{ height: '350px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={trendData} margin={{ top: 5, right: 0, left: -20, bottom: 5 }}>
                        <defs>
                          <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2}/>
                            <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="displayDate" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
                        
                        {/* Primary Y Axis for Revenue */}
                        <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dx={-10} />
                        {/* Secondary Y Axis for Orders Count */}
                        <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dx={10} />
                        
                        <RechartsTooltip 
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                          formatter={(value, name) => {
                            if (name === 'Revenue') return [`RM ${value.toFixed(2)}`, name];
                            return [value, name];
                          }}
                        />
                        <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#64748b' }}/>
                        
                        <Area yAxisId="left" type="monotone" dataKey="revenue" name="Revenue" stroke="#2563eb" strokeWidth={3} fillOpacity={1} fill="url(#colorRevenue)" activeDot={{ r: 6 }} />
                        <Line yAxisId="right" type="monotone" dataKey="ordersCount" name="Orders" stroke="#10b981" strokeWidth={3} dot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="admin-card" style={{ boxShadow: 'none', border: '1px solid #e2e8f0', margin: 0, padding: '1.5rem' }}>
                  <h4 style={{ marginBottom: '1.5rem', color: '#475569', fontSize: '1rem', fontWeight: 600 }}>Top Sellers</h4>
                  <div style={{ height: '350px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topItemsData} layout="vertical" margin={{ top: 5, right: 20, left: 40, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                        <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#1e293b' }} />
                        <RechartsTooltip 
                          cursor={{ fill: '#f8fafc' }}
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                          formatter={(value) => [value, 'Units Sold']}
                        />
                        <Bar dataKey="sales" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={20} />
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
                        {getCookTimeLeft(order) || '—'}
                      </td>
                      <td>
                      <div className="flex flex-col text-sm">
                        {order.items.map((item, i) => (
                          <div key={i} className="mb-1">
                            <span className="font-bold">{item.quantity}x</span> {item.name}
                            {item.selectedAddons && item.selectedAddons.length > 0 && (
                              <div className="text-muted text-xs ml-4">
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
                            className="qty-btn qty-btn-minus"
                            onClick={() => updateStock(item.id, -1)}
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
                            className="qty-btn qty-btn-plus"
                            onClick={() => updateStock(item.id, +1)}
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
                                <div className="flex flex-col text-sm">
                                  {order.items.map((item, i) => (
                                    <div key={i} className="mb-1">
                                      <span className="font-bold">{item.quantity}x</span> {item.name}
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
