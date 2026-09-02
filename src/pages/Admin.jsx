import { useState, useEffect, useRef, useMemo, Fragment } from 'react';
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
import { LayoutDashboard, BarChart2, ShoppingBag, Users, Layers, PlusSquare, TrendingUp, CheckCircle, AlertTriangle, Calendar, Archive, ArrowDown, Bookmark, Gift, Ticket, Clock, ChevronDown, ClipboardList } from 'lucide-react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import './Admin.css';

// §1 Live Orders: cancel-reason chips (docs/design/HANDOFF-ADMIN-CRM.md §1).
const CANCEL_REASONS = ['Customer no-show', 'Item out of stock', 'Duplicate order', 'Payment failed', 'Kitchen error', 'Other'];

// §4 Order History: refund/void reason codes.
const REFUND_REASONS = ['Item made wrong', 'Missing item', 'Late collection', 'Quality complaint', 'Duplicate charge', 'Goodwill'];

// Same channel classification Analytics already uses (order.channel, three
// copies inline there) -- pulled out here since §4's filter needs the exact
// same logic; the existing Analytics copies are left as-is, out of scope.
function getOrderChannelKey(order) {
  const rawChannel = (order.channel || 'web').toLowerCase();
  if (rawChannel === 'loyverse' || rawChannel === 'pos' || rawChannel === 'walkin' || rawChannel === 'walk-in') return 'loyverse';
  if (rawChannel === 'grab' || rawChannel === 'grabfood') return 'grabfood';
  return 'web';
}

// §2 Customers CRM: same avatar palette as Profile.jsx's picker (per the
// brief: reuse it for the CRM detail view rather than a new colour ramp).
const CUSTOMER_AVATAR_COLORS = {
  ember: '#F04E23', gold: '#FFC72C', green: '#5FD68C', purple: '#C77DFF', blue: '#63A7F5'
};
const CUSTOMER_SEGMENTS = ['First-timer', 'At risk', 'VIP', 'Regular', 'Occasional'];

// Evaluated in this order per the brief -- e.g. a 6th-order customer who
// hasn't been back in 30 days reads as "At risk", not "Regular".
function getCustomerSegment(orderCount, lifetimeCents, lastSeenDays) {
  if (orderCount === 0) return 'Occasional'; // never ordered -- no churn to be "at risk" of yet
  if (orderCount === 1) return 'First-timer';
  if (lastSeenDays != null && lastSeenDays > 21) return 'At risk';
  if (lifetimeCents >= 60000) return 'VIP';
  if (orderCount >= 5) return 'Regular';
  return 'Occasional';
}

// §3 Analytics: date-range presets (docs/design/HANDOFF-ADMIN-CRM.md §3).
// Each preset just computes a {start, end} pair for the existing
// selectedDateRange state -- the trend chart already buckets daily whenever
// selectedDateRange is set (see processAnalyticsData), so these presets need
// no changes to the aggregation/bucketing logic at all.
const DATE_RANGE_PRESETS = ['Today', '7d', '30d', 'This month'];
function computePresetDateRange(preset) {
  const end = new Date();
  const toStr = (d) => d.toISOString().split('T')[0];
  const endStr = toStr(end);
  if (preset === 'Today') return { start: endStr, end: endStr };
  if (preset === '7d') {
    const s = new Date(end); s.setDate(s.getDate() - 6);
    return { start: toStr(s), end: endStr };
  }
  if (preset === '30d') {
    const s = new Date(end); s.setDate(s.getDate() - 29);
    return { start: toStr(s), end: endStr };
  }
  if (preset === 'This month') {
    const s = new Date(end.getFullYear(), end.getMonth(), 1);
    return { start: toStr(s), end: endStr };
  }
  return null;
}

// §8 Menu & Add-ons: the one cost/margin line format, shared verbatim by the
// Menu CRM row, the Add-item form's cost field, and the Edit Details modal
// so all three always agree. Both prices are in cents.
function getCostMarginDisplay(costPriceCents, priceCents) {
  if (costPriceCents == null || costPriceCents === '') {
    return { text: 'Not set · est. 40%', estimated: true };
  }
  const cost = costPriceCents / 100;
  const price = (priceCents || 0) / 100;
  const marginPct = price > 0 ? ((price - cost) / price) * 100 : 0;
  return { text: `RM ${cost.toFixed(2)} · ${marginPct.toFixed(0)}%`, estimated: false };
}

function CostMarginLine({ costPriceCents, priceCents, dark, style }) {
  const { text, estimated } = getCostMarginDisplay(costPriceCents, priceCents);
  const normalColor = dark ? 'rgba(255,255,255,0.55)' : 'var(--text-muted)';
  const estimatedColor = dark ? '#fbbf24' : '#b45309';
  return (
    <div style={{ fontSize: '0.75rem', fontWeight: estimated ? 700 : 400, color: estimated ? estimatedColor : normalColor, marginTop: '2px', ...style }}>
      {text}
    </div>
  );
}

// Unified toast queue (§0 shared machinery). One store, four kinds, replacing
// the old one-off SyncToastItem -- Loyverse sync warnings now render through
// this same stack as 'warn' kind toasts instead of a bespoke component.
const TOAST_KIND_STYLE = {
  info:   { bg: '#17150F', fg: '#FFC72C', border: '#17150F' },
  new:    { bg: '#0F7A4F', fg: '#BDE5D1', border: '#0F7A4F' },
  danger: { bg: '#8E1F1B', fg: '#F5B7B1', border: '#8E1F1B' },
  warn:   { bg: '#8A6100', fg: '#FFE9A8', border: '#8A6100' }
};

function AdminToast({ toast, onDismiss }) {
  const style = TOAST_KIND_STYLE[toast.kind] || TOAST_KIND_STYLE.info;
  return (
    <div
      className="admin-toast-item"
      style={{
        backgroundColor: style.bg,
        color: style.fg,
        border: `1.5px solid ${style.border}`,
        borderRadius: '12px',
        padding: '0.875rem 1rem',
        boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
        width: '380px',
        maxWidth: 'calc(100vw - 32px)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        pointerEvents: 'auto'
      }}
    >
      {toast.kind === 'warn' && <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        {toast.title && (
          <div style={{ fontWeight: 800, fontSize: '0.85rem' }}>{toast.title}</div>
        )}
        <div style={{ fontSize: '0.8rem', marginTop: toast.title ? '2px' : 0, lineHeight: 1.35 }}>
          {toast.msg}
        </div>
        {toast.undo && (
          <button
            onClick={() => { toast.undo(); onDismiss(toast.id); }}
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              textDecoration: 'underline',
              fontWeight: 800,
              fontSize: '0.75rem',
              padding: 0,
              marginTop: '6px',
              cursor: 'pointer'
            }}
          >
            Undo
          </button>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        style={{
          background: 'none',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          fontWeight: 'bold',
          fontSize: '1rem',
          padding: '0 2px',
          lineHeight: 1,
          opacity: 0.8
        }}
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

export default function Admin() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { 
    menu, toggleStock, updatePrice, updateLowStockThreshold, addMenuItem, updateMenuItem, deleteMenuItem, moveMenuItem, updateStock, setStockQuantity,
    syncWarnings, removeSyncWarning,
    orders, updateOrderState, acceptOrder, customers, cancelOrder,
    addons, itemAddons, addAddon, deleteAddon, moveAddon, toggleItemAddon, uploadImage, updateAddonPrice, updateAddonStock, setAddonStockQuantity, updateAddonLowStockThreshold,
    loyaltyPrizes, redemptions, fetchAdminRedemptions, fulfillRedemption, addLoyaltyPrize, updateLoyaltyPrize, deleteLoyaltyPrize,
    isPromoActive, updatePromo,
    categoriesList, addCategory, updateCategory, deleteCategory,
    shopSettings, updateShopSettings, isShopOpenNow
  } = useStore();

  // ── §0 shared machinery: toast queue, audit log, roles ──────────────────
  const [toasts, setToasts] = useState([]);
  const toastTimersRef = useRef(new Map());
  const [viewingAsStaff, setViewingAsStaff] = useState(false);
  const [auditLog, setAuditLog] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // ── §1 Live Orders: new-order sound toggle + badge flash ────────────────
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem('munchies_admin_sound_enabled') !== 'false'; } catch (e) { return true; }
  });
  const [badgeFlashing, setBadgeFlashing] = useState(false);
  const prevPendingCountRef = useRef(0);

  const toggleSound = () => {
    setSoundEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem('munchies_admin_sound_enabled', String(next)); } catch (e) {}
      if (!next) stopNewOrderAlert();
      return next;
    });
  };

  const dismissToast = (id) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // kind: 'info' | 'new' | 'danger' | 'warn'. Max 4 visible, newest at the
  // bottom. Auto-dismisses after 6.5s (11s for 'warn' -- those carry more to
  // read). Every destructive action should pass an `undo` closure.
  const pushToast = ({ msg, kind = 'info', title = null, undo = null }) => {
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    setToasts(prev => {
      const next = [...prev, { id, msg, kind, title, undo }];
      return next.length > 4 ? next.slice(next.length - 4) : next;
    });
    const timer = setTimeout(() => dismissToast(id), kind === 'warn' ? 11000 : 6500);
    toastTimersRef.current.set(id, timer);
    return id;
  };

  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => { timers.forEach(t => clearTimeout(t)); };
  }, []);

  // Every mutation that matters writes one row here. admin_audit is
  // insert+select only for admins (see the migration) -- there is no update
  // or delete path, by design.
  const logAudit = async (action, detail = null) => {
    try {
      await supabase.from('admin_audit').insert([{
        actor_id: user?.id || null,
        actor_role: user?.role || null,
        action,
        detail
      }]);
    } catch (e) {
      console.error('Failed to write audit log row:', e);
    }
  };

  const fetchAuditLog = async () => {
    setAuditLoading(true);
    const { data, error } = await supabase
      .from('admin_audit')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (!error && data) setAuditLog(data);
    setAuditLoading(false);
  };

  // The mockup fakes owner/staff with a sidebar click; production would read
  // this from the session instead. Switching to staff view backs out of any
  // tab staff can't see, so it never lands on a blank pane.
  const toggleStaffView = () => {
    setViewingAsStaff(prev => {
      const next = !prev;
      if (next && (activeTab === 'analytics' || activeTab === 'audit')) {
        setActiveTab('overview');
      }
      return next;
    });
  };
  // ── end §0 shared machinery ──────────────────────────────────────────────

  const [editingPrice, setEditingPrice] = useState({});
  const [editingCostPrice, setEditingCostPrice] = useState({});
  const [uploadingImageIds, setUploadingImageIds] = useState(new Set());
  const [newItemPhotoStatus, setNewItemPhotoStatus] = useState('idle'); // 'idle' | 'uploading' | 'attached'
  const [newItemPhotoMeta, setNewItemPhotoMeta] = useState(null); // { name, size }
  const [editingAddonPrice, setEditingAddonPrice] = useState({});
  const [editingAddonStock, setEditingAddonStock] = useState({});
  const [editingAddonLowStock, setEditingAddonLowStock] = useState({});
  const [editingStock, setEditingStock] = useState({});
  const [editingLowStock, setEditingLowStock] = useState({});
  const [editingPromo, setEditingPromo] = useState({});
  const [expandedHistoryOrderIds, setExpandedHistoryOrderIds] = useState(new Set());
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(6);
  const [historyChannelFilter, setHistoryChannelFilter] = useState('All');
  const [refundingOrder, setRefundingOrder] = useState(null); // { id, total, amountMode: 'full'|'half', reason }

  const refundOrder = async (orderId, amountCents, reason, isFull) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return false;
    const patch = {
      refund_amount: amountCents,
      refund_reason: reason,
      refunded_at: new Date().toISOString()
    };
    if (isFull) patch.status = 'CANCELLED';
    const { error } = await supabase.from('orders').update(patch).eq('id', orderId);
    if (error) {
      console.error('Failed to refund order:', error);
      alert("We couldn't complete that right now. Please try again.");
      return false;
    }
    logAudit(isFull ? 'Order voided (full refund)' : 'Order refunded (partial)', { orderId, amountCents, reason });
    pushToast({
      kind: 'danger',
      title: isFull ? 'Order voided' : 'Refund recorded',
      msg: `#${formatOrderId(orderId)} — RM ${(amountCents / 100).toFixed(2)} (${reason})`,
      undo: async () => {
        const revertPatch = { refund_amount: null, refund_reason: null, refunded_at: null };
        if (isFull) revertPatch.status = order.status;
        await supabase.from('orders').update(revertPatch).eq('id', orderId);
        logAudit('Refund undone', { orderId });
      }
    });
    return true;
  };

  const toggleHistoryOrderExpand = (orderId) => {
    setExpandedHistoryOrderIds(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

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

  useEffect(() => {
    if (activeTab === 'audit') fetchAuditLog();
  }, [activeTab]);
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
    logAudit('Schedule updated', { day, ...patch });
    // Only toast the discrete open/closed toggle, not every open/close time
    // input change -- a dragged or typed time value fires onChange several
    // times per edit, and a toast per keystroke would be spammy. All changes
    // still land in the audit log above.
    if ('enabled' in patch) {
      pushToast({
        msg: `${day} is now ${patch.enabled ? 'open' : 'closed'} on the weekly schedule`,
        kind: 'info',
        title: 'Schedule saved'
      });
    }
  };

  const saveClosures = (newClosures) => {
    const previous = localClosures || [];
    setLocalClosures(newClosures);
    updateShopSettings({ specialClosures: newClosures });
    if (newClosures.length > previous.length) {
      const added = newClosures.find(c => !previous.some(p => p.date === c.date));
      logAudit('Special closure added', added || { closures: newClosures });
      pushToast({
        msg: added ? `${added.date} marked closed (${added.reason})` : 'Closure added',
        kind: 'warn',
        title: 'Schedule saved'
      });
    } else if (newClosures.length < previous.length) {
      const removed = previous.find(p => !newClosures.some(c => c.date === p.date));
      logAudit('Special closure removed', removed || { closures: newClosures });
      pushToast({
        msg: removed ? `${removed.date} closure removed` : 'Closure removed',
        kind: 'info',
        title: 'Schedule saved'
      });
    }
  };
  const [analyticsPeriod, setAnalyticsPeriod] = useState('daily'); // 'daily', 'monthly', 'yearly'
  // Defaults to the "7d" preset so the initial Analytics view and the chip
  // row agree on what's showing, instead of loading with no chip active.
  const [selectedDateRange, setSelectedDateRange] = useState(() => computePresetDateRange('7d'));
  const [menuSearchQuery, setMenuSearchQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);

  // ── §2 Customers CRM: segments, tags/note editing, blast composer ───────
  const [customerSegmentFilter, setCustomerSegmentFilter] = useState('All');
  const [blastComposer, setBlastComposer] = useState(null); // { channel, message } | null
  const [tagDraft, setTagDraft] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [savingCustomer, setSavingCustomer] = useState(false);

  const updateCustomerProfile = async (customerId, patch) => {
    const { error } = await supabase.from('profiles').update(patch).eq('id', customerId);
    if (error) {
      console.error('Failed to update customer profile:', error);
      alert("We couldn't save that right now. Please try again.");
      return false;
    }
    return true;
  };

  // Lifetime spend / order count / segment all read off completed orders
  // only -- CANCELLED orders still show in a customer's timeline (for a full
  // picture) but shouldn't count toward spend or push someone into VIP.
  const customersWithMeta = useMemo(() => {
    const now = Date.now();
    return customers.map(customer => {
      const timelineOrders = orders
        .filter(o => o.user_id === customer.id && o.status !== 'PENDING')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const completedOrders = timelineOrders.filter(o => o.status !== 'CANCELLED');
      const lifetimeCents = completedOrders.reduce((sum, o) => sum + o.total, 0);
      const orderCount = completedOrders.length;
      const avgCents = orderCount > 0 ? Math.round(lifetimeCents / orderCount) : 0;
      const lastOrderMs = completedOrders.reduce((latest, o) => {
        const t = new Date(o.created_at).getTime();
        return t > latest ? t : latest;
      }, 0);
      const lastSeenDays = lastOrderMs > 0 ? Math.floor((now - lastOrderMs) / 86400000) : null;
      const segment = getCustomerSegment(orderCount, lifetimeCents, lastSeenDays);
      return { ...customer, timelineOrders, lifetimeCents, orderCount, avgCents, lastSeenDays, segment };
    });
  }, [customers, orders]);

  const segmentCounts = useMemo(() => {
    const counts = { All: customersWithMeta.length };
    CUSTOMER_SEGMENTS.forEach(s => { counts[s] = 0; });
    customersWithMeta.forEach(c => { counts[c.segment] = (counts[c.segment] || 0) + 1; });
    return counts;
  }, [customersWithMeta]);

  const filteredCustomers = customerSegmentFilter === 'All'
    ? customersWithMeta
    : customersWithMeta.filter(c => c.segment === customerSegmentFilter);

  const openCustomerDetail = (customer) => {
    setSelectedCustomerId(customer.id);
    setTagDraft(customer.tags || []);
    setTagInput('');
    setNoteDraft(customer.note || '');
  };

  const saveCustomerTagsAndNote = async (customerId) => {
    setSavingCustomer(true);
    const ok = await updateCustomerProfile(customerId, { tags: tagDraft, note: noteDraft.trim() || null });
    setSavingCustomer(false);
    if (ok) {
      logAudit('Customer note/tags saved', { customerId, tags: tagDraft, note: noteDraft.trim() || null });
      pushToast({ kind: 'new', msg: 'Customer profile saved.' });
    }
  };

  // New Addon State
  const [newAddonName, setNewAddonName] = useState('');
  const [newAddonPrice, setNewAddonPrice] = useState('');
  const [newAddonImageFile, setNewAddonImageFile] = useState(null);

  // New Menu Item State
  const [newItem, setNewItem] = useState({
    name: '', category: 'BBQ', price: '', cost_price: '', image: '', description: '', inStock: true
  });
  const [newItemImageFile, setNewItemImageFile] = useState(null);
  
  const [isUploading, setIsUploading] = useState(false);

  const [now, setNow] = useState(Date.now());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(new Date());
  
  // Analytics State Additions
  const [grabFoodShiftPercent, setGrabFoodShiftPercent] = useState(0);
  const [topItemsChannelFilter, setTopItemsChannelFilter] = useState('all'); // 'all', 'web', 'loyverse'

  // Shift Handover / Cash-Up State (§6) — backed by public.shifts
  const [shifts, setShifts] = useState([]);
  const [openingFloatInput, setOpeningFloatInput] = useState('');
  const [openingFloatEditValue, setOpeningFloatEditValue] = useState('');
  const [countedInput, setCountedInput] = useState('');
  const [savingShift, setSavingShift] = useState(false);

  // §5b: Pause online ordering / customer notice
  const [noticeMessageInput, setNoticeMessageInput] = useState('');
  const [savingNotice, setSavingNotice] = useState(false);
  useEffect(() => {
    setNoticeMessageInput(shopSettings?.noticeMessage || '');
  }, [shopSettings?.noticeMessage]);

  // §5b: Waste log (writes the existing, previously-unused waste_log table)
  const WASTE_REASONS = ['Made wrong', 'Dropped', 'End of night', 'Expired'];
  const [wasteLog, setWasteLog] = useState([]);
  const [wasteItemId, setWasteItemId] = useState('');
  const [wasteQty, setWasteQty] = useState('');
  const [wasteReason, setWasteReason] = useState(WASTE_REASONS[0]);
  const [savingWaste, setSavingWaste] = useState(false);

  // Promos & Referrals State
  const [promoCodes, setPromoCodes] = useState([]);
  const [referralStats, setReferralStats] = useState([]);
  const [activePromoSubTab, setActivePromoSubTab] = useState('codes'); // 'codes', 'referrals', 'items'
  const [isPromoModalOpen, setIsPromoModalOpen] = useState(false);
  const [savingPromo, setSavingPromo] = useState(false);
  const EMPTY_PROMO_FORM = {
    id: null, code: '', name: '', type: 'percent_off', value: '',
    applies_to_item_id: '', min_spend: '', free_item_id: '',
    max_total_uses: '', max_uses_per_user: '', starts_at: '', ends_at: '',
    stackable_with_item_promos: false, active: true
  };
  const [promoFormData, setPromoFormData] = useState(EMPTY_PROMO_FORM);

  // Notes & Upcoming Events State — backed by public.store_events (see
  // 20260902000006_add_store_events.sql). Used to live in localStorage under
  // munchies_admin_events_notes; fetchStoreEvents() migrates any leftover
  // entries from that key into the table once, then drops the key.
  const [eventsNotes, setEventsNotes] = useState([]);

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

  // §5b: Prep board — tonight's projected demand is the average quantity sold
  // on this weekday over the last 8 weeks. Cancelled orders never actually
  // moved stock, so they're excluded from "sold".
  const prepBoardData = useMemo(() => {
    const todayIdx = new Date().getDay();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 56);
    const qtyByItem = {};
    orders.forEach(o => {
      if (o.status === 'CANCELLED') return;
      const created = new Date(o.created_at);
      if (created < cutoff || created.getDay() !== todayIdx) return;
      (o.items || []).forEach(oi => {
        if (oi.id == null) return;
        const key = String(oi.id);
        qtyByItem[key] = (qtyByItem[key] || 0) + (oi.quantity || 1);
      });
    });
    return menu
      .map(item => {
        const totalSold = qtyByItem[String(item.id)] || 0;
        const projected = Math.round(totalSold / 8);
        const stock = item.stock_quantity ?? 0;
        const covered = stock >= projected;
        const prepNeeded = Math.max(0, projected - stock);
        const fillPct = projected > 0 ? Math.min(100, Math.round((stock / projected) * 100)) : 100;
        return { id: item.id, name: item.name, projected, stock, covered, prepNeeded, fillPct };
      })
      .filter(r => r.projected > 0)
      .sort((a, b) => b.projected - a.projected)
      .slice(0, 6);
  }, [orders, menu]);

  // §5b: Food cost tonight — (COGS + waste) / gross sales for today's
  // orders, real cost_price per line falling back to the 40% estimate this
  // dashboard uses everywhere else. A wasted (unsold) item has no line
  // revenue to estimate 40% of, so its fallback is 40% of its normal
  // selling price instead -- same ratio, applied to the closest available
  // number.
  const foodCostTonight = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const uncostedItemIds = new Set();
    let grossRm = 0;
    let cogsRm = 0;

    orders.forEach(o => {
      if (o.status === 'CANCELLED') return;
      const created = new Date(o.created_at);
      if (created < startOfDay) return;
      grossRm += (o.total || 0) / 100;
      (o.items || []).forEach(oi => {
        const lineRevenueRm = ((oi.price || 0) * (oi.quantity || 1)) / 100;
        const menuItem = menu.find(m => String(m.id) === String(oi.id));
        if (menuItem && menuItem.cost_price != null) {
          cogsRm += (menuItem.cost_price * (oi.quantity || 1)) / 100;
        } else {
          cogsRm += lineRevenueRm * 0.40;
          if (oi.id != null) uncostedItemIds.add(String(oi.id));
        }
      });
    });

    let wasteRm = 0;
    wasteLog.forEach(w => {
      const menuItem = menu.find(m => String(m.id) === String(w.item_id));
      if (!menuItem) return;
      const perUnitRm = menuItem.cost_price != null ? menuItem.cost_price / 100 : (menuItem.price * 0.40) / 100;
      wasteRm += perUnitRm * (w.quantity || 0);
      if (menuItem.cost_price == null) uncostedItemIds.add(String(menuItem.id));
    });

    const pct = grossRm > 0 ? ((cogsRm + wasteRm) / grossRm) * 100 : 0;
    return { pct, grossRm, cogsRm, wasteRm, uncostedCount: uncostedItemIds.size };
  }, [orders, menu, wasteLog]);

  const pendingOrders = orders.filter(o => o.status === 'PENDING');
  const activeOrders = orders.filter(o => o.status !== 'COLLECTED' && o.status !== 'CANCELLED');

  // Cost of one redemption: real cost_price of the menu item the prize is
  // linked to, when the admin has set it. Null when the prize isn't linked
  // to a menu item, or the linked item has no cost_price set yet.
  const getRedemptionCost = (r) => {
    const prize = loyaltyPrizes.find(p => p.id === r.prize_id);
    if (!prize || !prize.menu_item_id) return null;
    const menuItem = menu.find(m => String(m.id) === String(prize.menu_item_id));
    return menuItem && menuItem.cost_price != null ? menuItem.cost_price / 100 : null;
  };
  // §8: three distinct states for the Redemptions Cost column -- "not
  // linked" (free-choice prize, no menu_item_id at all) and "no cost set"
  // (linked, but that item has no cost_price) used to collapse into the
  // same "Not set" label. Always resolved via prizes.menu_item_id, never by
  // matching prize name to a menu item.
  const getRedemptionCostState = (r) => {
    const prize = loyaltyPrizes.find(p => p.id === r.prize_id);
    if (!prize || !prize.menu_item_id) return { state: 'not_linked' };
    const menuItem = menu.find(m => String(m.id) === String(prize.menu_item_id));
    if (!menuItem || menuItem.cost_price == null) return { state: 'no_cost' };
    return { state: 'costed', amount: menuItem.cost_price / 100 };
  };
  const totalRedemptionValue = redemptions.reduce((sum, r) => sum + (getRedemptionCost(r) || 0), 0);
  const redemptionsMissingCost = redemptions.filter(r => getRedemptionCost(r) == null).length;

  useEffect(() => {
    if (activeTab === 'promotions') {
      fetchMarketingData();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'redemptions') {
      fetchAdminRedemptions();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'overview') {
      fetchShifts();
      fetchWasteLog();
      fetchStoreEvents();
    }
  }, [activeTab]);

  const fetchShifts = async () => {
    try {
      const { data, error } = await supabase.from('shifts').select('*').order('opened_at', { ascending: false }).limit(20);
      if (error) throw error;
      setShifts(data || []);
    } catch (e) {
      console.error('Failed to fetch shifts:', e);
    }
  };

  // Cents helpers — money in `shifts` and `orders.total` is stored as integer
  // cents; the inputs on this card are plain RM strings.
  const rmToCents = (rmString) => Math.round((parseFloat(rmString) || 0) * 100);
  const centsToRm = (cents) => ((cents || 0) / 100).toFixed(2);

  const isCashOrder = (order) => {
    const pm = (order.payment_method || order.paymentMethod || '').toString().toLowerCase();
    return pm === 'cash';
  };

  const currentShift = useMemo(() => shifts.find(s => !s.closed_at) || null, [shifts]);
  // Only the most recently opened shift can be reopened, and only once no
  // newer shift has been started -- shifts[0] (opened_at desc) being closed
  // while there's no currentShift is exactly that condition.
  const reopenableShift = (!currentShift && shifts[0] && shifts[0].closed_at) ? shifts[0] : null;

  // Reset the opening-float draft whenever the open shift changes (a new
  // shift opens, or the last one is reopened) so a stale typed value from a
  // previous shift never lingers in the input.
  useEffect(() => {
    setOpeningFloatEditValue('');
  }, [currentShift?.id]);

  // Live cash / card+e-wallet split for the open shift, computed straight
  // from `orders` rather than trusting anything cached -- cancelled orders
  // never had cash collected (or had it handed back), so they're excluded.
  // Refund/void amounts from §4 (orders.refund_*) aren't merged into main
  // yet, so a partial refund on a still-active order isn't reflected here --
  // whichever of §4 / §6 merges second should reconcile that.
  const shiftSalesSummary = useMemo(() => {
    if (!currentShift) return { cashCents: 0, cardEwalletCents: 0 };
    const openedAtMs = new Date(currentShift.opened_at).getTime();
    let cashCents = 0, cardEwalletCents = 0;
    orders.forEach(o => {
      if (o.status === 'CANCELLED') return;
      const createdMs = new Date(o.created_at).getTime();
      if (!(createdMs >= openedAtMs)) return;
      if (isCashOrder(o)) cashCents += (o.total || 0);
      else cardEwalletCents += (o.total || 0);
    });
    return { cashCents, cardEwalletCents };
  }, [orders, currentShift]);

  const expectedDrawerCents = currentShift ? (currentShift.opening_float || 0) + shiftSalesSummary.cashCents : 0;
  const countedCentsPreview = countedInput !== '' ? rmToCents(countedInput) : null;
  const varianceCentsPreview = countedCentsPreview !== null ? countedCentsPreview - expectedDrawerCents : null;

  const openShift = async () => {
    setSavingShift(true);
    try {
      const floatCents = rmToCents(openingFloatInput);
      const { error } = await supabase.from('shifts').insert([{ opening_float: floatCents }]);
      if (error) { alert(error.message); return; }
      logAudit('Shift opened', { opening_float: floatCents });
      pushToast({ msg: `Shift opened with RM ${centsToRm(floatCents)} float`, kind: 'new', title: 'Shift opened' });
      setOpeningFloatInput('');
      setCountedInput('');
      fetchShifts();
    } finally {
      setSavingShift(false);
    }
  };

  const saveOpeningFloat = async () => {
    if (!currentShift) return;
    const floatCents = rmToCents(openingFloatEditValue);
    const { error } = await supabase.from('shifts').update({ opening_float: floatCents }).eq('id', currentShift.id);
    if (error) { alert(error.message); return; }
    logAudit('Shift opening float adjusted', { shiftId: currentShift.id, opening_float: floatCents });
    pushToast({ msg: `Opening float updated to RM ${centsToRm(floatCents)}`, kind: 'info', title: 'Shift updated' });
    fetchShifts();
  };

  const reopenShift = async (shiftId) => {
    const { error } = await supabase.from('shifts').update({ closed_at: null, counted: null, expected: null, variance: null }).eq('id', shiftId);
    if (error) { alert(error.message); return; }
    logAudit('Shift reopened', { shiftId });
    fetchShifts();
  };

  const closeShift = async () => {
    if (!currentShift) return;
    if (countedInput === '') { alert('Enter the counted drawer amount before closing the shift.'); return; }
    const countedCents = rmToCents(countedInput);
    const expectedCents = expectedDrawerCents;
    const varianceCents = countedCents - expectedCents;
    const shiftId = currentShift.id;
    setSavingShift(true);
    try {
      const { error } = await supabase.from('shifts').update({
        closed_at: new Date().toISOString(),
        counted: countedCents,
        expected: expectedCents,
        variance: varianceCents,
        closed_by: user?.id || null
      }).eq('id', shiftId);
      if (error) { alert(error.message); return; }
      logAudit('Shift closed', { shiftId, counted: countedCents, expected: expectedCents, variance: varianceCents });
      const varianceOk = Math.abs(varianceCents) <= 500;
      pushToast({
        msg: `Counted RM ${centsToRm(countedCents)} vs expected RM ${centsToRm(expectedCents)} (variance ${varianceCents >= 0 ? '+' : '-'}RM ${centsToRm(Math.abs(varianceCents))}${varianceOk ? '' : ' — investigate'})`,
        kind: varianceOk ? 'info' : 'warn',
        title: 'Shift closed',
        undo: () => reopenShift(shiftId)
      });
      setCountedInput('');
      fetchShifts();
    } finally {
      setSavingShift(false);
    }
  };

  const fetchWasteLog = async () => {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('waste_log')
        .select('*')
        .gte('timestamp', startOfDay.toISOString())
        .order('timestamp', { ascending: false });
      if (error) throw error;
      setWasteLog(data || []);
    } catch (e) {
      console.error('Failed to fetch waste log:', e);
    }
  };

  const logWaste = async () => {
    if (!wasteItemId) { alert('Select an item to log waste for.'); return; }
    const qty = parseInt(wasteQty, 10);
    if (!qty || qty <= 0) { alert('Enter a quantity greater than zero.'); return; }
    setSavingWaste(true);
    try {
      const { error } = await supabase.from('waste_log').insert([{
        item_id: wasteItemId,
        quantity: qty,
        reason: wasteReason,
        logged_by: user?.id || null
      }]);
      if (error) { alert(error.message); return; }
      const item = menu.find(m => String(m.id) === String(wasteItemId));
      logAudit('Waste logged', { itemId: wasteItemId, itemName: item?.name || null, quantity: qty, reason: wasteReason });
      pushToast({ msg: `${qty}x ${item?.name || 'item'} logged as waste (${wasteReason})`, kind: 'warn', title: 'Waste logged' });
      setWasteItemId('');
      setWasteQty('');
      fetchWasteLog();
    } finally {
      setSavingWaste(false);
    }
  };

  const removeWasteEntry = async (id) => {
    const row = wasteLog.find(w => w.id === id);
    const { error } = await supabase.from('waste_log').delete().eq('id', id);
    if (error) { alert(error.message); return; }
    const item = menu.find(m => String(m.id) === String(row?.item_id));
    logAudit('Waste log entry removed', { id, itemName: item?.name || null, quantity: row?.quantity || null });
    pushToast({ msg: 'Waste entry removed', kind: 'info', title: 'Waste log updated' });
    fetchWasteLog();
  };

  // §5b: Pause online ordering + customer notice. setShopStatus() replaces
  // the bare `updateShopSettings({ status: s })` the Quick Override buttons
  // used to call directly -- those predate §0's toast/audit machinery and
  // this bullet explicitly wants the status write audited.
  const setShopStatus = (s) => {
    if (shopSettings?.status === s) return;
    updateShopSettings({ status: s });
    const labels = { OPEN: 'Store opened', PAUSED: 'Online ordering paused', CLOSED: 'Store closed', SCHEDULE: 'Following weekly schedule' };
    logAudit('Store status changed', { status: s });
    pushToast({ msg: labels[s] || `Status set to ${s}`, kind: (s === 'CLOSED' || s === 'PAUSED') ? 'warn' : 'info', title: 'Store status' });
  };

  const saveNoticeMessage = async () => {
    setSavingNotice(true);
    try {
      const trimmed = noticeMessageInput.trim();
      await updateShopSettings({ noticeMessage: trimmed });
      logAudit('Store notice updated', { noticeMessage: trimmed || null });
      pushToast({ msg: trimmed ? 'Customer notice saved' : 'Customer notice cleared', kind: 'info', title: 'Store notice' });
    } finally {
      setSavingNotice(false);
    }
  };

  const fetchStoreEvents = async () => {
    try {
      const { data, error } = await supabase.from('store_events').select('*').order('date', { ascending: true });
      if (error) throw error;
      let rows = data || [];

      // One-time migration from the old localStorage diary (see comment on
      // the eventsNotes state above). Only runs while the table is still
      // empty, to avoid re-inserting on every browser that had the old key.
      const legacy = localStorage.getItem('munchies_admin_events_notes');
      if (legacy) {
        if (rows.length === 0) {
          try {
            const legacyEvents = JSON.parse(legacy);
            if (Array.isArray(legacyEvents) && legacyEvents.length > 0) {
              const payload = legacyEvents.map(e => ({
                date: e.date,
                title: e.title,
                type: e.type || 'event',
                description: e.description || null,
                created_by: user?.id || null
              }));
              const { data: inserted, error: insertError } = await supabase.from('store_events').insert(payload).select('*');
              if (!insertError && inserted) {
                rows = inserted;
                logAudit('Diary migrated from local storage', { count: inserted.length });
              }
            }
          } catch (e) {
            console.error('Failed to migrate legacy diary events:', e);
          }
        }
        localStorage.removeItem('munchies_admin_events_notes');
      }

      setEventsNotes(rows);
    } catch (e) {
      console.error('Failed to fetch store events:', e);
    }
  };

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
      const { data: profiles } = await supabase.from('profiles').select('id, name, referred_by, referral_converted_at').limit(5000);
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

  const openCreatePromoModal = () => {
    setPromoFormData(EMPTY_PROMO_FORM);
    setIsPromoModalOpen(true);
  };

  const openEditPromoModal = (promo) => {
    setPromoFormData({
      id: promo.id,
      code: promo.code || '',
      name: promo.name || '',
      type: promo.type || 'percent_off',
      value: promo.value != null ? String(promo.value) : '',
      applies_to_item_id: promo.applies_to_item_id || '',
      min_spend: promo.min_spend != null ? String(promo.min_spend) : '',
      free_item_id: promo.free_item_id || '',
      max_total_uses: promo.max_total_uses != null ? String(promo.max_total_uses) : '',
      max_uses_per_user: promo.max_uses_per_user != null ? String(promo.max_uses_per_user) : '',
      starts_at: promo.starts_at ? promo.starts_at.slice(0, 16) : '',
      ends_at: promo.ends_at ? promo.ends_at.slice(0, 16) : '',
      stackable_with_item_promos: !!promo.stackable_with_item_promos,
      active: promo.active !== false
    });
    setIsPromoModalOpen(true);
  };

  // "Customer sees" live preview -- a plain-English render of exactly what
  // this promo currently does, so the admin can sanity-check it before
  // saving rather than reverse-engineering their own field choices later.
  const buildPromoPreview = (f) => {
    if (!f.code.trim()) return null;
    const codeStr = f.code.trim().toUpperCase();
    let benefit = null;
    let condition = '';
    if (f.type === 'percent_off') {
      benefit = f.value ? `${f.value}% off your order` : null;
      if (f.min_spend) condition = ` on orders over RM ${(parseInt(f.min_spend, 10) / 100).toFixed(2)}`;
    } else if (f.type === 'flat_off') {
      benefit = f.value ? `RM ${(parseInt(f.value, 10) / 100).toFixed(2)} off your order` : null;
      if (f.min_spend) condition = ` on orders over RM ${(parseInt(f.min_spend, 10) / 100).toFixed(2)}`;
    } else if (f.type === 'bogo') {
      const item = menu.find(m => String(m.id) === String(f.applies_to_item_id));
      benefit = item ? `a free ${item.name} when one is already in your cart` : null;
    } else if (f.type === 'spend_threshold_free_item') {
      const item = menu.find(m => String(m.id) === String(f.free_item_id));
      benefit = item ? `a free ${item.name}` : null;
      if (f.min_spend) condition = ` when you spend RM ${(parseInt(f.min_spend, 10) / 100).toFixed(2)} or more`;
    }
    if (!benefit) return null;
    return `Use code ${codeStr} for ${benefit}${condition}.`;
  };

  const handleSavePromoCode = async (e) => {
    e.preventDefault();
    setSavingPromo(true);
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
        stackable_with_item_promos: promoFormData.stackable_with_item_promos,
        active: promoFormData.active
      };

      if (promoFormData.id) {
        const previous = promoCodes.find(p => p.id === promoFormData.id);
        const { error } = await supabase.from('promo_codes').update(payload).eq('id', promoFormData.id);
        if (error) { alert(error.message); return; }
        logAudit('Promo code updated', { id: promoFormData.id, code: payload.code });
        pushToast({
          msg: `${payload.code} updated`,
          kind: 'info',
          title: 'Promo saved',
          undo: previous ? () => revertPromoCode(promoFormData.id, previous) : null
        });
      } else {
        const { data, error } = await supabase.from('promo_codes').insert([payload]).select('*').single();
        if (error) { alert(error.message); return; }
        logAudit('Promo code created', { id: data?.id, code: payload.code, type: payload.type });
        pushToast({
          msg: `${payload.code} is ready to use`,
          kind: 'new',
          title: 'Promo created',
          undo: data?.id ? () => deletePromoCode(data.id, { silent: true }) : null
        });
      }

      setIsPromoModalOpen(false);
      setPromoFormData(EMPTY_PROMO_FORM);
      fetchMarketingData();
    } catch (e) {
      alert('Error saving promo code');
    } finally {
      setSavingPromo(false);
    }
  };

  const revertPromoCode = async (id, previous) => {
    const { error } = await supabase.from('promo_codes').update({
      code: previous.code, name: previous.name, type: previous.type, value: previous.value,
      applies_to_item_id: previous.applies_to_item_id, min_spend: previous.min_spend,
      free_item_id: previous.free_item_id, max_total_uses: previous.max_total_uses,
      max_uses_per_user: previous.max_uses_per_user, starts_at: previous.starts_at,
      ends_at: previous.ends_at, stackable_with_item_promos: previous.stackable_with_item_promos,
      active: previous.active
    }).eq('id', id);
    if (error) { alert(error.message); return; }
    logAudit('Promo code update undone', { id, code: previous.code });
    fetchMarketingData();
  };

  const togglePromoCodeActive = async (id, currentStatus) => {
    const nextActive = !currentStatus;
    const { error } = await supabase.from('promo_codes').update({ active: nextActive }).eq('id', id);
    if (error) { alert(error.message); return; }
    const promo = promoCodes.find(p => p.id === id);
    logAudit(nextActive ? 'Promo code activated' : 'Promo code deactivated', { id, code: promo?.code || null });
    pushToast({
      msg: `${promo?.code || 'Promo'} is now ${nextActive ? 'active' : 'inactive'}`,
      kind: 'info',
      title: 'Promo updated',
      undo: () => togglePromoCodeActive(id, nextActive)
    });
    fetchMarketingData();
  };

  const deletePromoCode = async (id, opts = {}) => {
    if (!opts.silent && !window.confirm('Are you sure you want to delete this promo code? This cannot be undone.')) return;
    const promo = promoCodes.find(p => p.id === id);
    const { error } = await supabase.from('promo_codes').delete().eq('id', id);
    if (error) { alert(error.message); return; }
    logAudit('Promo code deleted', { id, code: promo?.code || null });
    if (!opts.silent) {
      pushToast({
        msg: `${promo?.code || 'Promo'} deleted`,
        kind: 'danger',
        title: 'Promo deleted',
        undo: promo ? () => restorePromoCode(promo) : null
      });
    }
    fetchMarketingData();
  };

  const restorePromoCode = async (promo) => {
    const { id, timesRedeemed, totalDiscountGiven, totalRevenue, ...payload } = promo;
    const { error } = await supabase.from('promo_codes').insert([payload]);
    if (error) { alert(error.message); return; }
    logAudit('Promo code deletion undone', { code: promo.code });
    fetchMarketingData();
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

  const handleSaveEvent = async (e) => {
    e.preventDefault();
    const title = eventFormData.title.trim();
    if (!title) return;

    if (eventFormData.id) {
      const { error } = await supabase.from('store_events').update({
        date: selectedEventDate,
        title,
        type: eventFormData.type,
        description: eventFormData.description.trim() || null
      }).eq('id', eventFormData.id);
      if (error) { alert(error.message); return; }
      logAudit('Diary entry updated', { id: eventFormData.id, title });
      pushToast({ msg: `"${title}" updated`, kind: 'info', title: 'Diary entry saved' });
    } else {
      const { data, error } = await supabase.from('store_events').insert([{
        date: selectedEventDate,
        title,
        type: eventFormData.type,
        description: eventFormData.description.trim() || null,
        created_by: user?.id || null
      }]).select('*').single();
      if (error) { alert(error.message); return; }
      logAudit('Diary entry added', { id: data?.id, title });
      pushToast({ msg: `"${title}" added to the diary`, kind: 'new', title: 'Diary entry saved' });
    }
    setIsEventModalOpen(false);
    fetchStoreEvents();
  };

  const handleDeleteEvent = async (id) => {
    const evt = eventsNotes.find(item => item.id === id);
    const { error } = await supabase.from('store_events').delete().eq('id', id);
    if (error) { alert(error.message); return; }
    logAudit('Diary entry deleted', { id, title: evt?.title || null });
    pushToast({ msg: `"${evt?.title || 'Entry'}" removed`, kind: 'warn', title: 'Diary entry deleted' });
    setIsEventModalOpen(false);
    fetchStoreEvents();
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
      cost_price: editingMenuItem.cost_price !== '' && editingMenuItem.cost_price != null
        ? Math.round(parseFloat(editingMenuItem.cost_price) * 100)
        : null,
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
  const lowStockItems = [
    ...menu.filter(item => !item.inStock || (item.stock_quantity ?? 99) <= (item.low_stock_threshold ?? 10)).map(i => ({ ...i, isAddon: false })),
    ...addons.filter(addon => addon.in_stock === false || (addon.stock_quantity ?? 99) <= (addon.low_stock_threshold ?? 10)).map(a => ({ ...a, name: `${a.name} (Add-on)`, isAddon: true }))
  ];
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
      web: { gross: 0, net: 0, name: 'Web App Direct', color: 'var(--munchies-orange-accent)' },
      loyverse: { gross: 0, net: 0, name: 'Loyverse / Walk-in', color: '#10b981' },
      grabfood: { gross: 0, net: 0, name: 'GrabFood', color: '#16a34a' }
    };

    // Cost of one line: real cost_price from the Menu CRM when the admin has set
    // it, otherwise fall back to the flat 40%-of-price estimate this dashboard
    // always used. Items without a cost_price set behave exactly as before.
    const lineCost = (orderItem, lineRevenue) => {
      const menuItem = menu.find(m => String(m.id) === String(orderItem.id));
      if (menuItem && menuItem.cost_price != null) {
        return (menuItem.cost_price * (orderItem.quantity || 1)) / 100;
      }
      return lineRevenue * 0.40;
    };

    // Top 10 Sales with Margin Calculation
    const itemStats = {};
    periodOrders.forEach(order => {
      const rawChannel = (order.channel || 'web').toLowerCase();
      const isLoyverse = rawChannel === 'loyverse' || rawChannel === 'pos' || rawChannel === 'walkin' || rawChannel === 'walk-in';
      const isGrab = rawChannel === 'grab' || rawChannel === 'grabfood';
      const channelKey = isLoyverse ? 'loyverse' : isGrab ? 'grabfood' : 'web';

      const orderGross = order.total / 100;
      const orderItems = order.items || [];

      // COGS: sum of each line's real or estimated cost, falling back to the
      // flat 40% of order total when an order has no item breakdown at all.
      const cogs = orderItems.length > 0
        ? orderItems.reduce((sum, oi) => sum + lineCost(oi, ((oi.price || 0) * (oi.quantity || 1)) / 100), 0)
        : orderGross * 0.40;
      const platformFee = orderGross * (CHANNEL_FEES[channelKey] || 0);
      const orderNet = orderGross - cogs - platformFee;

      channelStats[channelKey].gross += orderGross;
      channelStats[channelKey].net += orderNet;
      channelSales[channelKey] += orderGross;

      totalGrossSales += orderGross;
      totalNetProfit += orderNet;

      // Filter for top items by channel
      if (topItemsChannelFilter === 'all' || topItemsChannelFilter === channelKey) {
        orderItems.forEach(item => {
          if (!itemStats[item.name]) itemStats[item.name] = { quantity: 0, revenue: 0, netProfit: 0 };
          const itemQty = item.quantity || 1;
          const itemRev = ((item.price || 0) * itemQty) / 100;

          let itemNet = itemRev - lineCost(item, itemRev) - (itemRev * (CHANNEL_FEES[channelKey] || 0));

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

  // Start / stop looping alert sound based on pending orders, gated by the
  // per-device toggle in the Live Orders toolbar.
  useEffect(() => {
    if (pendingOrders.length > 0 && soundEnabled) {
      startNewOrderAlert();
    } else {
      stopNewOrderAlert();
    }
    return () => stopNewOrderAlert();
  }, [pendingOrders.length, soundEnabled]);

  // Flash the sidebar badge 3x when a new pending order actually arrives
  // (not on every render where one is merely still pending).
  useEffect(() => {
    if (pendingOrders.length > prevPendingCountRef.current) {
      setBadgeFlashing(true);
      const t = setTimeout(() => setBadgeFlashing(false), 1800); // 3 x 600ms cycle
      prevPendingCountRef.current = pendingOrders.length;
      return () => clearTimeout(t);
    }
    prevPendingCountRef.current = pendingOrders.length;
  }, [pendingOrders.length]);

  // This guard must come after every Hook call above (Rules of Hooks) so that
  // a mid-session admin->non-admin transition redirects cleanly instead of
  // changing the number of Hooks called between renders and crashing.
  if (!user || user.role !== 'admin') {
    return <Navigate to="/login" replace />;
  }

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

  const formatOrderId = (id) => {
    if (!id) return '';
    return id.includes('-') ? id.split('-')[0].toUpperCase() : id.toUpperCase().substring(0, 8);
  };

  const advanceOrderState = (id, currentStatus) => {
    const nextStatus = currentStatus === 'COOKING' ? 'READY' : currentStatus === 'READY' ? 'COLLECTED' : null;
    if (!nextStatus) return;
    updateOrderState(id, nextStatus);
    logAudit(`Order ${nextStatus.toLowerCase()}`, { orderId: id });
    pushToast({
      kind: 'new',
      msg: `#${formatOrderId(id)} marked ${nextStatus.toLowerCase()}.`,
      undo: () => { updateOrderState(id, currentStatus); logAudit('Order state change undone', { orderId: id, revertedTo: currentStatus }); }
    });
  };

  const handleAccept = (orderId) => {
    acceptOrder(orderId);
    logAudit('Order accepted', { orderId });
    pushToast({
      kind: 'new',
      msg: `#${formatOrderId(orderId)} accepted into the kitchen.`,
      undo: () => { updateOrderState(orderId, 'PENDING'); logAudit('Order accept undone', { orderId }); }
    });
  };

  const handlePriceChange = (id, value) => setEditingPrice({ ...editingPrice, [id]: value });
  const savePrice = (id) => {
    if (editingPrice[id] !== undefined && editingPrice[id] !== '') {
      updatePrice(id, parseFloat(editingPrice[id]));
      setEditingPrice({ ...editingPrice, [id]: undefined });
    }
  };

  // §8: inline cost-price editor on the Menu CRM row -- mirrors savePrice's
  // behavior exactly (including its lack of toast/audit; price editing next
  // to it has never had either, and giving only the new sibling cell
  // feedback would look like a bug rather than a feature. The whole
  // price/cost/stock inline-edit family still owes an audit trail per §0's
  // original "price change, stock adjust" list -- flagged as a pre-existing
  // gap outside this section's scope, not fixed here).
  const handleCostPriceChange = (id, value) => setEditingCostPrice({ ...editingCostPrice, [id]: value });
  const saveCostPrice = async (id) => {
    if (editingCostPrice[id] === undefined) return;
    const raw = editingCostPrice[id];
    const cents = raw === '' ? null : Math.round(parseFloat(raw) * 100);
    await updateMenuItem(id, { cost_price: cents });
    setEditingCostPrice({ ...editingCostPrice, [id]: undefined });
  };

  // §8: eager upload on file selection so the Add-item photo tile can show a
  // real idle -> uploading -> attached sequence, rather than only finding
  // out whether the upload succeeded when the whole form is submitted.
  const handleNewItemPhotoSelect = async (file) => {
    if (!file) return;
    setNewItemImageFile(file);
    setNewItemPhotoMeta({ name: file.name, size: file.size });
    setNewItemPhotoStatus('uploading');
    try {
      const url = await uploadImage(file);
      setNewItem(prev => ({ ...prev, image: url }));
      setNewItemPhotoStatus('attached');
    } catch (err) {
      alert('Photo upload failed: ' + (err.message || 'unknown error'));
      setNewItemPhotoStatus('idle');
      setNewItemImageFile(null);
      setNewItemPhotoMeta(null);
    }
  };

  // §8: Menu row's coloured/photo tile -- click to upload a replacement.
  const handleRowPhotoReplace = async (item, file) => {
    if (!file) return;
    setUploadingImageIds(prev => new Set(prev).add(item.id));
    try {
      const url = await uploadImage(file);
      await updateMenuItem(item.id, { image: url });
    } catch (err) {
      alert('Photo upload failed: ' + (err.message || 'unknown error'));
    } finally {
      setUploadingImageIds(prev => { const next = new Set(prev); next.delete(item.id); return next; });
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
  const handleAddonStockChange = (id, value) => setEditingAddonStock({ ...editingAddonStock, [id]: value });
  const saveAddonStock = (id) => {
    if (editingAddonStock[id] !== undefined && editingAddonStock[id] !== '') {
      setAddonStockQuantity(id, parseInt(editingAddonStock[id], 10));
      setEditingAddonStock({ ...editingAddonStock, [id]: undefined });
    }
  };
  const handleAddonLowStockChange = (id, value) => setEditingAddonLowStock({ ...editingAddonLowStock, [id]: value });
  const saveAddonLowStock = (id) => {
    if (editingAddonLowStock[id] !== undefined && editingAddonLowStock[id] !== '') {
      updateAddonLowStockThreshold(id, parseInt(editingAddonLowStock[id], 10));
      setEditingAddonLowStock({ ...editingAddonLowStock, [id]: undefined });
    }
  };
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
      if (newItemPhotoStatus === 'uploading') { alert('Please wait for the photo to finish uploading.'); return; }
      setIsUploading(true);
      try {
        // Photo (if any) was already uploaded eagerly on selection -- see
        // handleNewItemPhotoSelect -- so newItem.image is already the final URL.
        await addMenuItem({
          ...newItem,
          price: parseFloat(newItem.price),
          cost_price: newItem.cost_price !== '' ? parseFloat(newItem.cost_price) : null,
          image: newItem.image || '/images/hero_burger.png'
        });
        setNewItem({ name: '', category: 'BBQ', price: '', cost_price: '', image: '', description: '', inStock: true });
        setNewItemImageFile(null);
        setNewItemPhotoStatus('idle');
        setNewItemPhotoMeta(null);
      } catch (err) {
        console.error("Full upload error:", err);
        alert('Failed to add item: ' + (err.message || JSON.stringify(err)));
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
            {pendingOrders.length > 0 && <span className={`sidebar-badge${badgeFlashing ? ' badge-flashing' : ''}`}>{pendingOrders.length}</span>}
          </button>
          {!viewingAsStaff && (
            <button className={`sidebar-item ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTab('analytics')}>
              <BarChart2 size={20} /> Analytics
            </button>
          )}
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
        
          <button className={`sidebar-item ${activeTab === 'loyalty_crm' ? 'active' : ''}`} onClick={() => setActiveTab('loyalty_crm')}>
            <Gift size={20} /> Prizes CRM
          </button>
          <button className={`sidebar-item ${activeTab === 'redemptions' ? 'active' : ''}`} onClick={() => setActiveTab('redemptions')}>
            <Ticket size={20} /> Redemptions
          </button>
          {!viewingAsStaff && (
            <button className={`sidebar-item ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => setActiveTab('audit')}>
              <ClipboardList size={20} /> Audit log
            </button>
          )}

          <div style={{ flex: 1 }} />

          <button
            className="admin-role-switch"
            title={viewingAsStaff ? 'Switch to Owner view' : 'Switch to Staff view'}
            onClick={toggleStaffView}
          >
            <div className="admin-role-switch-avatar" style={{ background: viewingAsStaff ? '#8B8478' : '#17150F' }}>
              {(user?.name || 'A').charAt(0).toUpperCase()}
            </div>
            <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
              <div className="admin-role-switch-name">{user?.name || 'Admin'}</div>
              <div className="admin-role-switch-label">
                {viewingAsStaff ? 'Staff' : 'Owner'} · Switch to {viewingAsStaff ? 'Owner' : 'Staff'} view
              </div>
            </div>
          </button>
        </aside>

        {/* Main Content Area */}
        <main className="admin-content">
          {/* Unified toast stack -- admin action toasts + Loyverse sync warnings together */}
          {(toasts.length > 0 || syncWarnings.length > 0) && (
            <div className="admin-toast-stack" style={{
              position: 'fixed',
              bottom: '24px',
              right: '24px',
              zIndex: 9999,
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              pointerEvents: 'none'
            }}>
              {toasts.map(toast => (
                <AdminToast key={toast.id} toast={toast} onDismiss={dismissToast} />
              ))}
              {syncWarnings.map(warning => (
                <AdminToast
                  key={warning.id}
                  toast={{
                    id: warning.id,
                    kind: 'warn',
                    title: 'Loyverse POS Sync Warning',
                    msg: <>Price updated on website, but failed to sync <strong>{warning.itemName}</strong> to Loyverse POS ({warning.error}). Prices may be out of sync.</>
                  }}
                  onDismiss={removeSyncWarning}
                />
              ))}
            </div>
          )}

          {viewingAsStaff && (
            <div className="admin-staff-banner">
              Counter-staff view — analytics, monthly reports, audit log and margin figures are hidden.
            </div>
          )}

          <div className="admin-header-section mb-6" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1>Dashboard</h1>
              <p className="text-muted" style={{ marginTop: '0.25rem', fontSize: '0.9rem' }}>Hi Admin, Welcome back to MunchiesKK Admin!</p>
            </div>
          </div>

          {activeTab === 'overview' && (
            <div>
              {lowStockCount > 0 && (
                <div style={{
                  background: 'linear-gradient(135deg, rgba(239,68,68,0.16), rgba(245,158,11,0.12))',
                  border: '2px solid #ef4444',
                  borderRadius: '16px',
                  padding: '1.1rem 1.5rem',
                  marginBottom: '1.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '1rem',
                  animation: 'restockPulse 2s infinite ease-in-out',
                  boxShadow: '0 0 20px rgba(239,68,68,0.3)'
                }}>
                  <style>
                    {`
                      @keyframes restockPulse {
                        0%, 100% {
                          border-color: #ef4444;
                          box-shadow: 0 0 15px rgba(239, 68, 68, 0.35);
                          background: linear-gradient(135deg, rgba(239,68,68,0.18), rgba(245,158,11,0.12));
                        }
                        50% {
                          border-color: #f87171;
                          box-shadow: 0 0 30px rgba(239, 68, 68, 0.6);
                          background: linear-gradient(135deg, rgba(239,68,68,0.3), rgba(245,158,11,0.22));
                        }
                      }
                      @keyframes alertBounce {
                        0%, 100% { transform: scale(1); }
                        50% { transform: scale(1.15); }
                      }
                    `}
                  </style>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '50%',
                      background: '#ef4444',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 'bold',
                      fontSize: '1.35rem',
                      flexShrink: 0,
                      boxShadow: '0 4px 12px rgba(239,68,68,0.4)',
                      animation: 'alertBounce 1.5s infinite ease-in-out'
                    }}>
                      <AlertTriangle size={24} />
                    </div>
                    <div>
                      <h4 style={{ margin: 0, color: '#b91c1c', fontSize: '1.05rem', fontWeight: 800 }}>
                        {lowStockCount} Item{lowStockCount > 1 ? 's' : ''} Require Immediate Restock!
                      </h4>
                      <p style={{ margin: '3px 0 0', fontSize: '0.875rem', color: '#7f1d1d', fontWeight: 600 }}>
                        {lowStockItems.map(item => `${item.name} (${(item.stock_quantity ?? 0) <= 0 || item.inStock === false || item.in_stock === false ? 'Sold Out' : (item.stock_quantity ?? 0) + ' left'})`).join(' • ')}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn btn-sm" style={{ background: '#fff', border: '1.5px solid #ef4444', color: '#b91c1c', fontWeight: 700, padding: '0.5rem 1rem' }} onClick={() => setActiveTab('inventory')}>
                      Manage Menu Stock
                    </button>
                    <button className="btn btn-sm btn-primary" style={{ backgroundColor: '#ef4444', borderColor: '#ef4444', fontWeight: 700, padding: '0.5rem 1rem', boxShadow: '0 4px 12px rgba(239,68,68,0.3)' }} onClick={() => setActiveTab('addons')}>
                      Manage Add-ons Stock
                    </button>
                  </div>
                </div>
              )}
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
                        <h3 style={{ margin: 0, color: 'var(--munchies-yellow)', fontSize: '1.125rem', display: 'flex', alignItems: 'center', gap: '8px' }}>📅 Schedule Manager</h3>
                        <p style={{ margin: '3px 0 0', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Set weekly operating hours and block special closure dates</p>
                      </div>
                      <button onClick={() => setScheduleModalOpen(false)}
                        style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: 'var(--text-muted)', width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                    </div>

                    {/* Modal Body */}
                    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>

                      {/* Override Buttons inside Modal */}
                      <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>⚡ Quick Override</label>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {[['OPEN','🟢 Open Now','#22c55e'],['PAUSED','⏸️ Pause','#eab308'],['CLOSED','🔴 Close Now','#ef4444'],['SCHEDULE','📅 Use Schedule','#6366f1']].map(([s,label,col]) => (
                            <button key={s} type="button" onClick={() => setShopStatus(s)}
                              style={{ flex: 1, minWidth: '110px', padding: '9px 8px', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.8rem',
                                background: shopSettings?.status === s ? col : '#334155', color: '#fff', transition: 'background 0.2s' }}>{label}</button>
                          ))}
                        </div>
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '6px 0 0' }}>
                          {shopSettings?.status === 'SCHEDULE'
                            ? '✅ Following weekly schedule — auto open/close by day & time'
                            : `⚠️ Manual override active (${shopSettings?.status}). Click "Use Schedule" to follow the weekly timetable.`}
                        </p>
                      </div>

                      {/* Weekly Schedule Grid */}
                      <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🗓️ Weekly Schedule</label>
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
                                    background: sched.enabled ? '#22c55e' : 'var(--text-secondary)', position: 'relative', transition: 'background 0.2s' }}>
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
                                      style={{ padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold', fontSize: '0.85rem' }} />
                                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>to</span>
                                    <input type="time" value={sched.close}
                                      onChange={e => saveScheduleDay(day, { close: e.target.value })}
                                      style={{ padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold', fontSize: '0.85rem' }} />
                                    <span style={{ fontSize: '0.73rem', color: 'var(--text-secondary)' }}>({formatTime12Hour(sched.open)} – {formatTime12Hour(sched.close)})</span>
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
                        <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🚨 Special Closures & Holidays</label>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                          <input type="date" id="closure-date-input" min={new Date().toISOString().split('T')[0]}
                            style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold', fontSize: '0.875rem' }} />
                          <input type="text" id="closure-reason-input" placeholder="Reason (e.g. Public Holiday)"
                            style={{ flex: 1, minWidth: '160px', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontSize: '0.875rem' }} />
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
                          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>No special closures scheduled.</p>
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
                                      <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{closure.reason}</div>
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
                    <h3 style={{ margin: 0, color: 'var(--munchies-yellow)', fontSize: '1.125rem', display: 'flex', alignItems: 'center', gap: '8px' }}>🏪 Store Status</h3>
                    <p style={{ margin: '3px 0 0', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
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
                      {shopSettings?.status === 'OPEN' ? '🟢 OPEN' : shopSettings?.status === 'PAUSED' ? '⏸️ ORDERS PAUSED' : shopSettings?.status === 'SCHEDULE' ? '📅 SCHEDULE' : '🔴 CLOSED'}
                    </span>
                    <button onClick={() => openScheduleModal()}
                      style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid rgba(255,199,44,0.4)', background: 'rgba(255,199,44,0.08)', color: 'var(--munchies-yellow)', fontWeight: '700', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      ⚙️ Manage Schedule
                    </button>
                  </div>
                </div>
                <hr style={{ border: '0', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '0 0 1rem' }} />
                {/* Quick Override Buttons */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[['OPEN','🟢 Open','#22c55e'],['PAUSED','⏸️ Pause','#eab308'],['CLOSED','🔴 Close','#ef4444'],['SCHEDULE','📅 Schedule','#6366f1']].map(([s,label,col]) => (
                    <button key={s} type="button" onClick={() => setShopStatus(s)}
                      style={{ flex: 1, padding: '9px 4px', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.78rem',
                        background: shopSettings?.status === s ? col : '#334155', color: '#fff', transition: 'background 0.2s' }}>{label}</button>
                  ))}
                </div>

                {/* §5b: Customer notice — shown on the storefront's amber banner (that
                    display is a separate, deliberately out-of-scope follow-up; see PR
                    description). Editable regardless of status so an admin can draft it
                    before pausing. */}
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <label style={{ display: 'block', fontSize: '0.72rem', color: '#fbbf24', marginBottom: '6px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    📢 Customer Notice
                  </label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <input type="text" placeholder="e.g. Back at 6pm — online ordering paused for a bit"
                      value={noticeMessageInput}
                      onChange={e => setNoticeMessageInput(e.target.value)}
                      style={{ flex: 1, minWidth: '220px', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.08)', color: '#fff', fontSize: '0.85rem' }} />
                    <button type="button" disabled={savingNotice} onClick={() => saveNoticeMessage()}
                      style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#eab308', color: '#1e293b', fontWeight: 'bold', cursor: savingNotice ? 'default' : 'pointer', opacity: savingNotice ? 0.6 : 1, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      Save
                    </button>
                  </div>
                </div>
              </div>

              {/* Shift Handover / Cash-Up Card (§6) */}
              <div className="card" style={{
                background: '#1e293b', color: '#ffffff', padding: '1.25rem 1.5rem',
                borderRadius: '16px', border: '2px solid rgba(255, 199, 44, 0.4)',
                boxShadow: '0 10px 25px rgba(0,0,0,0.3)', marginBottom: '1.5rem'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    <h3 style={{ margin: 0, color: 'var(--munchies-yellow)', fontSize: '1.125rem', display: 'flex', alignItems: 'center', gap: '8px' }}>💰 Shift Handover / Cash-Up</h3>
                    <p style={{ margin: '3px 0 0', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {currentShift
                        ? `Open since ${new Date(currentShift.opened_at).toLocaleString('en-MY', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
                        : reopenableShift
                          ? `Last shift closed ${new Date(reopenableShift.closed_at).toLocaleString('en-MY', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
                          : 'No shift currently open'}
                    </p>
                  </div>
                  <span style={{
                    padding: '6px 16px', borderRadius: '20px', fontWeight: '800', fontSize: '0.85rem', textTransform: 'uppercase',
                    background: currentShift ? '#16a34a' : '#334155', color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
                  }}>
                    {currentShift ? '🟢 SHIFT OPEN' : '⚪ NO SHIFT'}
                  </span>
                </div>
                <hr style={{ border: '0', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '0 0 1rem' }} />

                {currentShift ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Opening float</label>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <input type="number" step="0.01" min="0"
                            value={openingFloatEditValue === '' ? centsToRm(currentShift.opening_float) : openingFloatEditValue}
                            onChange={e => setOpeningFloatEditValue(e.target.value)}
                            style={{ width: '90px', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold', fontSize: '0.85rem' }} />
                          <button type="button" onClick={() => saveOpeningFloat()}
                            style={{ padding: '6px 10px', borderRadius: '6px', border: 'none', background: '#334155', color: '#fff', fontSize: '0.72rem', fontWeight: 'bold', cursor: 'pointer' }}>Save</button>
                        </div>
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Cash sales</label>
                        <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>RM {centsToRm(shiftSalesSummary.cashCents)}</div>
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Card + e-wallet</label>
                        <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>RM {centsToRm(shiftSalesSummary.cardEwalletCents)}</div>
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Expected drawer</label>
                        <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--munchies-yellow)' }}>RM {centsToRm(expectedDrawerCents)}</div>
                      </div>
                    </div>

                    <hr style={{ border: '0', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '4px 0' }} />

                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '14px', flexWrap: 'wrap' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Counted</label>
                        <input type="number" step="0.01" min="0" placeholder="0.00"
                          value={countedInput}
                          onChange={e => setCountedInput(e.target.value)}
                          style={{ width: '110px', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold', fontSize: '0.9rem' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Variance</label>
                        {varianceCentsPreview === null ? (
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', padding: '8px 0' }}>—</div>
                        ) : (
                          <div style={{
                            fontSize: '0.95rem', fontWeight: 800, padding: '8px 10px', borderRadius: '8px',
                            background: Math.abs(varianceCentsPreview) <= 500 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                            color: Math.abs(varianceCentsPreview) <= 500 ? '#4ade80' : '#f87171'
                          }}>
                            {varianceCentsPreview >= 0 ? '+' : '-'}RM {centsToRm(Math.abs(varianceCentsPreview))}
                            {Math.abs(varianceCentsPreview) > 500 && ' — investigate'}
                          </div>
                        )}
                      </div>
                      <button type="button" disabled={savingShift} onClick={() => closeShift()}
                        style={{ padding: '10px 18px', borderRadius: '8px', border: 'none', background: '#dc2626', color: '#fff', fontWeight: 'bold', cursor: savingShift ? 'default' : 'pointer', opacity: savingShift ? 0.6 : 1, fontSize: '0.85rem' }}>
                        🔒 Close Shift
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {reopenableShift && (
                      <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          Last shift: opening RM {centsToRm(reopenableShift.opening_float)} · counted RM {centsToRm(reopenableShift.counted)} · variance{' '}
                          <span style={{ color: Math.abs(reopenableShift.variance || 0) <= 500 ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                            {(reopenableShift.variance || 0) >= 0 ? '+' : '-'}RM {centsToRm(Math.abs(reopenableShift.variance || 0))}
                          </span>
                        </div>
                        <button type="button"
                          onClick={async () => { await reopenShift(reopenableShift.id); pushToast({ msg: 'Shift reopened', kind: 'info', title: 'Shift reopened' }); }}
                          style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid rgba(255,199,44,0.4)', background: 'rgba(255,199,44,0.08)', color: 'var(--munchies-yellow)', fontWeight: '700', cursor: 'pointer', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                          ↩ Reopen last shift
                        </button>
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Opening float (RM)</label>
                        <input type="number" step="0.01" min="0" placeholder="0.00"
                          value={openingFloatInput}
                          onChange={e => setOpeningFloatInput(e.target.value)}
                          style={{ width: '110px', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold', fontSize: '0.9rem' }} />
                      </div>
                      <button type="button" disabled={savingShift} onClick={() => openShift()}
                        style={{ padding: '10px 18px', borderRadius: '8px', border: 'none', background: '#16a34a', color: '#fff', fontWeight: 'bold', cursor: savingShift ? 'default' : 'pointer', opacity: savingShift ? 0.6 : 1, fontSize: '0.85rem' }}>
                        🟢 Open Shift
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Top Metrics Row */}
              <div className="admin-grid-4" style={{ marginBottom: '1.5rem' }}>
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
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '4px' }}>Available Dish</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1e293b' }}>{menu.length}</div>
                  </div>
                </div>
                
                <div className="sedap-metric-card" style={{ display: 'flex', alignItems: 'center', padding: '1.5rem', backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 4px 15px rgba(0,0,0,0.02)' }}>
                  <div className="sedap-metric-icon" style={{ backgroundColor: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', padding: '1rem', borderRadius: '50%', marginRight: '1rem' }}><ShoppingBag size={28} /></div>
                  <div className="sedap-metric-content">
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '4px' }}>Total Order</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1e293b' }}>{orders.length}</div>
                  </div>
                </div>

                <div className="sedap-metric-card" style={{ display: 'flex', alignItems: 'center', padding: '1.5rem', backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 4px 15px rgba(0,0,0,0.02)' }}>
                  <div className="sedap-metric-icon" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '1rem', borderRadius: '50%', marginRight: '1rem' }}><Clock size={28} /></div>
                  <div className="sedap-metric-content">
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '4px' }}>Pending Orders</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1e293b' }}>
                       <span onClick={() => setActiveTab('orders')} style={{ cursor: 'pointer' }}>
                         {pendingOrders.length}
                       </span>
                    </div>
                  </div>
                </div>

                <div className="sedap-metric-card" style={{ display: 'flex', alignItems: 'center', padding: '1.5rem', backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 4px 15px rgba(0,0,0,0.02)' }} title={`All-time revenue generated from ${orders.length} total orders`}>
                  <div className="sedap-metric-icon" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', padding: '1rem', borderRadius: '50%', marginRight: '1rem' }}><TrendingUp size={28} /></div>
                  <div className="sedap-metric-content">
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '4px' }}>Total Sale</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1e293b' }}>{(orders.reduce((sum, o) => sum + o.total, 0) / 100).toFixed(2)}</div>
                  </div>
                </div>
              </div>

              {/* Grid Layout for Main Widgets */}
              <div className="admin-grid-12">
                
                {/* Total Revenue Bar Chart - 8 cols */}
                <div className="admin-card col-span-8" style={{ padding: '1.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: 0 }}>Total Revenue</h3>
                  </div>
                  <div style={{ height: '300px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trendData.slice(0, 12)} margin={{ top: 5, right: 0, left: -20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="displayDate" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} dx={-10} />
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
                <div className="col-span-4" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
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
                         <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>% Orders Completed</div>
                         <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{perfAnim.toFixed(1)}%</div>
                       </div>
                    </div>
                  </div>
                  
                  <div className="admin-card" style={{ padding: '1.5rem', flex: 1 }}>
                    <h3 style={{ margin: 0, marginBottom: '1rem' }}>More <span style={{fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 'normal'}}>→</span></h3>
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
                <div className="col-span-4" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div className="admin-card" style={{ padding: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <h3 style={{ margin: 0, fontSize: '1rem' }}>{selectedCalendarDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</h3>
                      <Calendar size={16} className="text-muted" />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
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
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{new Date().getFullYear()}</div>
                     </div>
                     <div style={{ flex: 1, border: '2px dashed #cbd5e1', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.2s' }} className="hover-bg-slate">
                        <div style={{ color: 'var(--text-secondary)', marginBottom: '8px' }}><PlusSquare size={32} /></div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Create New</div>
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
                <div className="col-span-4" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

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
                        <h3 style={{ margin: 0, color: 'var(--munchies-yellow)', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          📌 NOTES & UPCOMING EVENTS
                        </h3>
                        <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                          Store schedule & active promotions. Click calendar dates or button to edit.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenAddEventModal()}
                        style={{
                          padding: '6px 12px', borderRadius: '8px', background: 'var(--munchies-orange-accent)', color: '#fff',
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
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>{evt.date}</span>
                              <span style={{
                                background: evt.type === 'promo' ? '#ef4444' : evt.type === 'event' ? '#0284c7' : '#10b981',
                                color: '#fff', fontSize: '0.65rem', fontWeight: 800, padding: '2px 6px', borderRadius: '8px'
                              }}>
                                {(evt.type || 'event').toUpperCase()}
                              </span>
                            </div>
                          </div>
                          {evt.description && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>{evt.description}</div>
                          )}
                        </div>
                      ))}

                      {eventsNotes.length === 0 && activePromosFromMenu.length === 0 && (shopSettings?.specialClosures || []).length === 0 && (
                        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0.75rem 0' }}>
                          No notes or events listed. Click "+ Add Event" to add one!
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Customer Insights */}
                  <div className="admin-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                      <h3 style={{ margin: 0 }}><Users size={18} style={{ display: 'inline', marginRight: '8px', color: '#ef4444' }}/>Customer Insights</h3>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', backgroundColor: '#f1f5f9', padding: '2px 8px', borderRadius: '12px' }}>Pickup Only</div>
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
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Avg. Order Frequency</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>
                         {customerInsights.avgOrderFrequency > 0 
                            ? `Every ${customerInsights.avgOrderFrequency.toFixed(1)} days`
                            : 'Not enough data yet'
                         }
                      </div>
                    </div>
                    
                    {/* Top Customers by Spend */}
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                       <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Top Spenders</div>
                       <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                         {customerInsights.topSpenders.map((cust, idx) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '0.75rem', borderBottom: idx < customerInsights.topSpenders.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b' }}>{cust.name}</div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Faves: <span style={{color:'#0f172a'}}>{cust.favoriteItem}</span></div>
                              </div>
                              <div style={{ fontWeight: 700, color: '#10b981', fontSize: '0.9rem' }}>
                                RM {(cust.totalSpend / 100).toFixed(2)}
                              </div>
                            </div>
                         ))}
                         {customerInsights.topSpenders.length === 0 && (
                           <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem 0' }}>No customers yet -- customers will appear here once orders are placed.</div>
                         )}
                       </div>
                    </div>
                  </div>

                </div>

                {/* Top 10 Best-Selling Items - 4 cols */}
                <div className="admin-card col-span-4" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
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
                                 <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{item.sales} units sold</div>
                               </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e293b' }}>RM {item.revenue.toFixed(2)}</div>
                            </div>
                         </div>
                       ))}
                       {topItemsData.length === 0 && (
                         <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '2rem' }}>No sales data yet -- sales data will appear here once orders are placed.</div>
                       )}
                  </div>
                </div>

              </div>

              {/* §5b: Prep board / Waste log / Food cost tonight */}
              <div className="admin-grid-3" style={{ marginTop: '1.5rem' }}>

                {/* Prep Board */}
                <div className="admin-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
                  <h3 style={{ margin: '0 0 0.25rem' }}>🍳 Prep Board</h3>
                  <p style={{ margin: '0 0 1rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    Projected demand: average sold on this weekday, last 8 weeks
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {prepBoardData.map(row => (
                      <div key={row.id}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{row.name}</span>
                          <span style={{
                            fontSize: '0.7rem', fontWeight: 800, padding: '2px 8px', borderRadius: '10px',
                            background: row.covered ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                            color: row.covered ? '#16a34a' : '#dc2626'
                          }}>
                            {row.covered ? 'Covered' : `Prep ${row.prepNeeded}`}
                          </span>
                        </div>
                        <div style={{ height: '6px', borderRadius: '3px', background: '#e2e8f0', overflow: 'hidden' }}>
                          <div style={{ width: `${row.fillPct}%`, height: '100%', background: row.covered ? '#22c55e' : '#ef4444', transition: 'width 0.3s' }} />
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                          Stock {row.stock} / Projected {row.projected}
                        </div>
                      </div>
                    ))}
                    {prepBoardData.length === 0 && (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '1rem 0' }}>
                        Not enough order history yet for today's weekday.
                      </div>
                    )}
                  </div>
                </div>

                {/* Waste Log */}
                <div className="admin-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
                  <h3 style={{ margin: '0 0 0.25rem' }}>🗑️ Waste Log</h3>
                  <p style={{ margin: '0 0 1rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Today's entries</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                    <select value={wasteItemId} onChange={e => setWasteItemId(e.target.value)}
                      style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}>
                      <option value="">Select item…</option>
                      {menu.map(item => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input type="number" min="1" placeholder="Qty" value={wasteQty}
                        onChange={e => setWasteQty(e.target.value)}
                        style={{ width: '70px', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }} />
                      <button type="button" disabled={savingWaste} onClick={() => logWaste()}
                        style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', border: 'none', background: '#dc2626', color: '#fff', fontWeight: 'bold', cursor: savingWaste ? 'default' : 'pointer', opacity: savingWaste ? 0.6 : 1, fontSize: '0.8rem' }}>
                        Log Waste
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {WASTE_REASONS.map(r => (
                        <button key={r} type="button" onClick={() => setWasteReason(r)}
                          style={{
                            padding: '5px 10px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer',
                            border: wasteReason === r ? '1px solid #dc2626' : '1px solid #cbd5e1',
                            background: wasteReason === r ? 'rgba(239,68,68,0.1)' : '#fff',
                            color: wasteReason === r ? '#dc2626' : 'var(--text-secondary)'
                          }}>{r}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, overflowY: 'auto', maxHeight: '220px' }}>
                    {wasteLog.map(w => {
                      const item = menu.find(m => String(m.id) === String(w.item_id));
                      return (
                        <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderRadius: '8px', background: '#f8fafc', fontSize: '0.8rem' }}>
                          <span>{w.quantity}x {item?.name || 'Unknown item'} <span style={{ color: 'var(--text-muted)' }}>· {w.reason}</span></span>
                          <button type="button" onClick={() => removeWasteEntry(w.id)}
                            style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
                        </div>
                      );
                    })}
                    {wasteLog.length === 0 && (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '1rem 0' }}>No waste logged today.</div>
                    )}
                  </div>
                </div>

                {/* Food Cost Tonight */}
                <div className="admin-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
                  <h3 style={{ margin: '0 0 0.25rem' }}>💵 Food Cost Tonight</h3>
                  <p style={{ margin: '0 0 1rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>(COGS + waste) / gross sales, today</p>
                  <div style={{ fontSize: '2.25rem', fontWeight: 800, color: '#1e293b', marginBottom: '1rem' }}>
                    {foodCostTonight.grossRm > 0 ? `${foodCostTonight.pct.toFixed(1)}%` : '—'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Gross sales</span><span style={{ fontWeight: 600 }}>RM {foodCostTonight.grossRm.toFixed(2)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>COGS</span><span style={{ fontWeight: 600 }}>RM {foodCostTonight.cogsRm.toFixed(2)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Waste</span><span style={{ fontWeight: 600 }}>RM {foodCostTonight.wasteRm.toFixed(2)}</span></div>
                  </div>
                  {foodCostTonight.uncostedCount > 0 && (
                    <p style={{ marginTop: '1rem', fontSize: '0.72rem', color: '#d97706', background: 'rgba(245,158,11,0.1)', padding: '8px 10px', borderRadius: '8px' }}>
                      ⚠️ {foodCostTonight.uncostedCount} item{foodCostTonight.uncostedCount === 1 ? '' : 's'} tonight still estimated at 40% — set a real cost price in Menu CRM for a more accurate figure.
                    </p>
                  )}
                </div>

              </div>
            </div>
          )}

          {activeTab === 'analytics' && !viewingAsStaff && (
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
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>to</span>
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
                      style={{ padding: '4px 8px', borderRadius: '4px', border: 'none', background: '#e2e8f0', color: 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer' }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                {/* Date range presets -- editing a date field directly (below)
                    stops matching any preset's computed range, which is what
                    naturally flips this to "Custom" with no extra state. */}
                <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderRadius: '8px', padding: '4px' }}>
                  {(() => {
                    const activePreset = DATE_RANGE_PRESETS.find(p => {
                      const r = computePresetDateRange(p);
                      return r && r.start === selectedDateRange.start && r.end === selectedDateRange.end;
                    }) || 'Custom';
                    return [...DATE_RANGE_PRESETS, 'Custom'].map(preset => {
                      const isActive = activePreset === preset;
                      return (
                        <button
                          key={preset}
                          onClick={() => {
                            setAnalyticsPeriod('daily');
                            if (preset === 'Custom') {
                              setSelectedDateRange({ start: '', end: '' });
                            } else {
                              setSelectedDateRange(computePresetDateRange(preset));
                            }
                          }}
                          style={{
                            padding: '6px 14px', borderRadius: '6px', border: 'none',
                            background: isActive ? '#fff' : 'transparent',
                            color: isActive ? '#0f172a' : 'var(--text-secondary)',
                            fontWeight: isActive ? '600' : '500',
                            fontSize: '0.875rem', cursor: 'pointer',
                            boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                            transition: 'all 0.2s'
                          }}
                        >
                          {preset}
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>

            {/* Row 1: KPI Top Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.5rem' }}>
              <div className="admin-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 600 }}>Total Orders</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a' }}>{kpi.orderCount}</div>
                <div style={{ fontSize: '0.75rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}><TrendingUp size={12}/> +12% from yesterday</div>
              </div>
              <div className="admin-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 600 }}>Gross Sales</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a' }}>RM {kpi.totalGrossSales.toFixed(2)}</div>
              </div>
              <div className="admin-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 600 }}>Est. Net Profit</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#10b981' }}>RM {kpi.totalNetProfit.toFixed(2)}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Net Margin: <span style={{fontWeight: 700}}>{kpi.netMarginPercent.toFixed(1)}%</span></div>
              </div>
              <div className="admin-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 600 }}>Inventory Alert</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: lowStockCount > 0 ? '#ef4444' : '#0f172a' }}>{lowStockCount}</div>
                
                {lowStockCount > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                    {lowStockItems.slice(0, 3).map(item => (
                      <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', cursor: 'pointer' }} onClick={() => setActiveTab(item.isAddon ? 'addons' : 'inventory')}>
                        <span style={{ wordBreak: 'break-word', paddingRight: '8px' }}>{item.name}</span>
                        <span style={{ fontWeight: 600, color: '#ef4444' }}>
                          {(item.stock_quantity ?? 0) <= 0 || item.inStock === false || item.in_stock === false ? 'Sold Out' : (item.stock_quantity ?? 0) + ' left'}
                        </span>
                      </div>
                    ))}
                    {lowStockCount > 3 && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>+{lowStockCount - 3} more...</div>}
                  </div>
                )}
                
                <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', fontSize: '0.75rem' }}>
                  <span style={{ color: '#3b82f6', textDecoration: 'underline', cursor: 'pointer' }} onClick={() => setActiveTab('inventory')}>
                    Menu Stock
                  </span>
                  <span style={{ color: '#cbd5e1' }}>•</span>
                  <span style={{ color: '#3b82f6', textDecoration: 'underline', cursor: 'pointer' }} onClick={() => setActiveTab('addons')}>
                    Add-ons Stock
                  </span>
                </div>
              </div>
            </div>

            {/* Row 2: Main Chart & Performance Sidebar */}
            <div className="admin-grid-3">
              
              {/* Stacked Bar Chart */}
              <div className="admin-card col-span-2" style={{ padding: '1.5rem' }}>
                <h4 style={{ margin: 0, marginBottom: '1.5rem', color: '#0f172a', fontSize: '1.125rem' }}>Total Revenue by Channel</h4>
                <div style={{ height: '350px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trendData} margin={{ top: 5, right: 0, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="displayDate" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} dx={-10} />
                      <RechartsTooltip 
                        cursor={{ fill: '#f8fafc' }}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', color: 'var(--text-secondary)' }}/>
                      <Bar dataKey="web" name="Web App Direct" stackId="a" fill="var(--munchies-orange-accent)" radius={[0, 0, 0, 0]} barSize={40} />
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
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Order Completion Rate</span>
                    <span style={{ fontWeight: 800, fontSize: '1.125rem', color: '#10b981' }}>{totalCompleted > 0 ? ((totalCompleted / (orders.length || 1)) * 100).toFixed(1) : 0}%</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Avg Prep / Fulfillment</span>
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
                           <Cell fill="var(--munchies-orange-accent)" />
                           <Cell fill="#10b981" />
                         </Pie>
                         <RechartsTooltip />
                       </PieChart>
                     </ResponsiveContainer>
                   </div>
                   <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                     <div style={{display:'flex', alignItems:'center', gap:'4px'}}><div style={{width:'8px',height:'8px',backgroundColor:'var(--munchies-orange-accent)',borderRadius:'50%'}}></div> Web App</div>
                     <div style={{display:'flex', alignItems:'center', gap:'4px'}}><div style={{width:'8px',height:'8px',backgroundColor:'#10b981',borderRadius:'50%'}}></div> Loyverse POS</div>
                   </div>
                </div>
              </div>
            </div>


            {/* Row 3: Bottom Intelligence Row */}
            <div className="admin-grid-4" style={{ alignItems: 'start' }}>
              
              <div className="admin-card col-span-2" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                  <h4 style={{ margin: 0, color: '#0f172a', fontSize: '1.125rem' }}>Best-Selling Items Intelligence</h4>
                  <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderRadius: '6px', padding: '3px' }}>
                    {['all', 'web', 'loyverse', 'grabfood'].map(filter => (
                      <button
                        key={filter}
                        onClick={() => setTopItemsChannelFilter(filter)}
                        style={{
                          padding: '4px 12px', borderRadius: '4px', border: 'none',
                          background: topItemsChannelFilter === filter ? '#fff' : 'transparent',
                          color: topItemsChannelFilter === filter ? '#0f172a' : 'var(--text-secondary)',
                          fontWeight: topItemsChannelFilter === filter ? '600' : '500',
                          fontSize: '0.75rem', cursor: 'pointer',
                          boxShadow: topItemsChannelFilter === filter ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                        }}
                      >
                        {filter === 'grabfood' ? 'GrabFood' : filter === 'loyverse' ? 'Loyverse' : filter === 'web' ? 'Web' : 'All'}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '2px solid #f1f5f9', paddingBottom: '0.5rem', textTransform: 'uppercase' }}>
                    <div style={{ flex: 3 }}>Item Name</div>
                    <div style={{ flex: 1, textAlign: 'center' }}>Units Sold</div>
                    <div style={{ flex: 2, textAlign: 'right' }}>Gross Revenue</div>
                    <div style={{ flex: 1, textAlign: 'right', marginLeft: '10px' }}>Margin</div>
                  </div>
                  {topItemsData.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #f8fafc', paddingBottom: '0.75rem', paddingTop: '0.25rem' }}>
                       <div style={{ flex: 3, display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={{ width: '32px', height: '32px', borderRadius: '6px', backgroundImage: `url(${item.image})`, backgroundSize: 'cover' }}></div>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#0f172a' }}>{item.name}</div>
                       </div>
                       <div style={{ flex: 1, textAlign: 'center', fontWeight: 600, color: '#3b82f6' }}>{item.sales}</div>
                       <div style={{ flex: 2, textAlign: 'right', fontWeight: 600, color: '#0f172a', fontSize: '0.8rem' }}>RM {item.revenue.toFixed(2)}</div>
                       <div style={{ flex: 1, textAlign: 'right', fontWeight: 700, color: '#10b981', fontSize: '0.65rem', marginLeft: '10px' }}>{item.margin.toFixed(1)}%</div>
                    </div>
                  ))}
                  {topItemsData.length === 0 && <div style={{textAlign: 'center', color: 'var(--text-muted)', padding: '1rem'}}>No sales data yet -- sales data will appear here once orders are placed.</div>}
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
                          <span style={{fontSize:'0.7rem', fontWeight:400, marginLeft: '6px', color: 'var(--text-secondary)'}}>
                            ({feePercent}% Fee)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {Object.values(channelStats).every(stat => stat.gross === 0) && (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>No channel data yet -- channel data will appear here once orders are placed.</div>
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
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Projected Net Profit Change</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 800, color: profitDifference < 0 ? '#ef4444' : (profitDifference > 0 ? '#10b981' : '#0f172a') }}>
                          {profitDifference < 0 ? '-' : '+'}RM {Math.abs(profitDifference).toFixed(2)}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
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
                      <XAxis dataKey="displayHour" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} dx={-10} />
                      <RechartsTooltip 
                        cursor={{ fill: '#f8fafc' }}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', color: 'var(--text-secondary)' }}/>
                      <Bar dataKey="web" name="Web App Direct" stackId="a" fill="var(--munchies-orange-accent)" radius={[0, 0, 0, 0]} />
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {pendingOrders.length > 0 && (
                <span className="pending-badge-pill">{pendingOrders.length} NEW</span>
              )}
              <button
                className="btn btn-sm btn-secondary"
                onClick={toggleSound}
                title={soundEnabled ? 'Mute new-order alert sound on this device' : 'Unmute new-order alert sound on this device'}
              >
                {soundEnabled ? '🔔 Sound on' : '🔕 Sound off'}
              </button>
            </div>
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
                  {order.notes && (
                    <div className="text-sm mt-1" style={{ color: 'var(--gold)', fontWeight: 700 }}>
                      📝 {order.notes}
                    </div>
                  )}
                </div>
              </div>
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
                    onClick={() => setCancellingOrder({ id: order.id, reason: '', note: '', wasteAction: 'restore', previousStatus: order.status })}
                    style={{ width: '100%', padding: '0.5rem 1rem', background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                  >
                    ? Cancel
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
                              <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginLeft: '1rem', marginTop: '0.25rem' }}>
                                + {item.selectedAddons.map(a => a.name).join(', ')}
                              </div>
                            )}
                          </div>
                        ))}
                        {order.notes && (
                          <div style={{ color: 'var(--gold)', fontWeight: 700, fontSize: '0.8rem' }}>
                            📝 {order.notes}
                          </div>
                        )}
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
                          onClick={() => setCancellingOrder({ id: order.id, reason: '', note: '', wasteAction: 'restore', previousStatus: order.status })}
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
                  <label>Cost Price (RM) — optional</label>
                  <input type="number" step="0.10" className="price-input" placeholder="e.g. 2.20" value={newItem.cost_price} onChange={e => setNewItem({...newItem, cost_price: e.target.value})} />
                  <CostMarginLine
                    costPriceCents={newItem.cost_price !== '' ? Math.round(parseFloat(newItem.cost_price) * 100) : null}
                    priceCents={newItem.price ? Math.round(parseFloat(newItem.price) * 100) : 0}
                  />
                </div>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Photo</label>
                  <div
                    onClick={() => newItemPhotoStatus !== 'uploading' && document.getElementById('new-item-photo-input').click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleNewItemPhotoSelect(f); }}
                    style={{
                      border: newItemPhotoStatus === 'attached' ? '2px solid #22c55e' : '2px dashed #cbd5e1',
                      borderRadius: '10px', padding: '0.75rem 1rem', cursor: newItemPhotoStatus === 'uploading' ? 'default' : 'pointer',
                      position: 'relative', overflow: 'hidden',
                      background: newItemPhotoStatus === 'attached' ? 'rgba(34,197,94,0.06)' : '#f8fafc',
                      display: 'flex', alignItems: 'center', gap: '10px', minHeight: '48px'
                    }}
                  >
                    <input id="new-item-photo-input" type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={e => handleNewItemPhotoSelect(e.target.files?.[0])} />
                    {newItemPhotoStatus === 'idle' && (
                      <>
                        <span style={{ fontSize: '1.2rem' }}>📷</span>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Click or drag a photo here</span>
                      </>
                    )}
                    {newItemPhotoStatus === 'uploading' && (
                      <>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Uploading {newItemPhotoMeta?.name}…</span>
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '4px', background: '#fef3c7', overflow: 'hidden' }}>
                          <div className="upload-progress-sweep" style={{ height: '100%', background: '#f59e0b' }} />
                        </div>
                      </>
                    )}
                    {newItemPhotoStatus === 'attached' && (
                      <>
                        <span style={{ fontSize: '1.05rem', color: '#22c55e' }}>✅</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#166534' }}>{newItemPhotoMeta?.name}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{((newItemPhotoMeta?.size || 0) / 1024).toFixed(0)} KB</div>
                        </div>
                        <span style={{ fontSize: '0.78rem', color: '#3b82f6', fontWeight: 600 }}>Replace</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <button type="submit" className="btn btn-primary" style={{ width: '200px' }} disabled={isUploading || newItemPhotoStatus === 'uploading'}>
                    {isUploading ? 'Uploading...' : 'Add Item'}
                  </button>
                </div>
              </form>
            </div>
            <div style={{ width: '250px', borderLeft: '1px solid #e2e8f0', paddingLeft: '2rem' }}>
              <h3 style={{ color: '#ef4444' }}>Needs Restock</h3>
              {lowStockItems.length === 0 ? (
                <p className="text-muted" style={{ fontSize: '0.9rem' }}>All items & add-ons stocked!</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem', maxHeight: '200px', overflowY: 'auto' }}>
                  {lowStockItems.map(item => (
                    <li key={item.id} style={{ marginBottom: '0.5rem', cursor: 'pointer' }} onClick={() => setActiveTab(item.isAddon ? 'addons' : 'inventory')}>
                      {item.name}{' '}
                      {(item.stock_quantity ?? 0) > 0 && (item.inStock === false || item.in_stock === false) ? (
                        <span style={{ color: '#f59e0b', fontWeight: 'bold' }}>
                          (Manually marked sold out - {item.stock_quantity} in stock)
                        </span>
                      ) : ((item.stock_quantity ?? 0) <= 0 || item.inStock === false || item.in_stock === false) ? (
                        <span style={{ color: '#ef4444', fontWeight: 'bold' }}>(Sold Out)</span>
                      ) : (
                        <span style={{ color: '#f59e0b' }}>({item.stock_quantity} left)</span>
                      )}
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
                  <th>Order</th>
                  <th>Item</th>
                  <th>Category</th>
                  <th>Price (RM)</th>
                  <th>Cost / Margin</th>
                  <th>Stock / Alert</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...menu]
                  .filter(item => item.name.toLowerCase().includes(menuSearchQuery.toLowerCase()))
                  .sort((a, b) => a.category.localeCompare(b.category) || (a.sort_order ?? 0) - (b.sort_order ?? 0))
                  .map((item, idx, sortedList) => {
                    const isFirstInCategory = idx === 0 || sortedList[idx - 1].category !== item.category;
                    const isLastInCategory = idx === sortedList.length - 1 || sortedList[idx + 1].category !== item.category;
                  // Determine badge color based on category
                  const getCategoryColor = (cat) => {
                    const colors = {
                      BBQ: '#ef4444',     // Red
                      PREMIUM: '#8b5cf6', // Purple
                      PLATTERS: '#f59e0b',// Orange
                      SIDES: '#10b981',   // Green
                      DRINKS: '#3b82f6'   // Blue
                    };
                    return colors[cat] || 'var(--text-secondary)'; // Default slate
                  };

                  return (
                    <tr key={item.id} className={!item.inStock ? 'row-inactive' : ''}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            style={{ padding: '2px 8px' }}
                            onClick={() => moveMenuItem(item.id, 'up')}
                            disabled={isFirstInCategory}
                            title="Move up within category"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            style={{ padding: '2px 8px' }}
                            onClick={() => moveMenuItem(item.id, 'down')}
                            disabled={isLastInCategory}
                            title="Move down within category"
                          >
                            ▼
                          </button>
                        </div>
                      </td>
                      <td className="font-medium">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ position: 'relative', width: '36px', height: '36px', flexShrink: 0 }}>
                            <button
                              type="button"
                              onClick={() => document.getElementById(`row-photo-input-${item.id}`).click()}
                              title="Click to replace photo"
                              style={{
                                width: '36px', height: '36px', borderRadius: '8px', border: 'none', cursor: 'pointer', padding: 0, overflow: 'hidden',
                                background: item.image ? 'transparent' : getCategoryColor(item.category),
                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                              }}
                            >
                              {item.image ? (
                                <img src={item.image} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : (
                                <span style={{ color: '#fff', fontWeight: 800, fontSize: '0.95rem' }}>{item.name.charAt(0).toUpperCase()}</span>
                              )}
                            </button>
                            <input id={`row-photo-input-${item.id}`} type="file" accept="image/*" style={{ display: 'none' }}
                              onChange={e => handleRowPhotoReplace(item, e.target.files?.[0])} />
                            {uploadingImageIds.has(item.id) && (
                              <div className="upload-pulse-overlay" style={{ position: 'absolute', inset: 0, borderRadius: '8px', background: 'rgba(245,158,11,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span style={{ fontSize: '0.6rem', color: '#fff', fontWeight: 800 }}>...</span>
                              </div>
                            )}
                          </div>
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
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'normal', whiteSpace: 'normal' }}>{item.description.slice(0, 40)}{item.description.length > 40 ? '...' : ''}</div>
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
                      {editingCostPrice[item.id] !== undefined ? (
                        <div className="price-edit-group" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <input
                            type="number" step="0.10"
                            value={editingCostPrice[item.id]}
                            onChange={(e) => handleCostPriceChange(item.id, e.target.value)}
                            className="price-input"
                            style={{ width: '80px', padding: '4px' }}
                          />
                          <button className="btn btn-sm btn-primary" onClick={() => saveCostPrice(item.id)}>Save</button>
                          <button className="btn btn-sm btn-secondary" onClick={() => setEditingCostPrice({ ...editingCostPrice, [item.id]: undefined })}>Cancel</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <CostMarginLine costPriceCents={item.cost_price} priceCents={item.price} style={{ marginTop: 0 }} />
                          <button className="btn btn-sm btn-secondary" onClick={() => handleCostPriceChange(item.id, item.cost_price != null ? (item.cost_price / 100).toFixed(2) : '')}>Edit</button>
                        </div>
                      )}
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
                            value={editingStock[item.id] !== undefined ? editingStock[item.id] : ((menu.find(m => m.id === item.id) || item).stock_quantity ?? 99)}
                            onChange={e => setEditingStock({ ...editingStock, [item.id]: e.target.value })}
                            onBlur={e => {
                              if (editingStock[item.id] !== undefined) {
                                setStockQuantity(item.id, editingStock[item.id]);
                                setEditingStock({ ...editingStock, [item.id]: undefined });
                              }
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                setStockQuantity(item.id, editingStock[item.id] ?? (menu.find(m => m.id === item.id) || item).stock_quantity);
                                setEditingStock({ ...editingStock, [item.id]: undefined });
                                e.target.blur();
                              }
                            }}
                            style={{
                              color: (editingStock[item.id] !== undefined ? Number(editingStock[item.id]) : ((menu.find(m => m.id === item.id) || item).stock_quantity ?? 99)) === 0 ? '#ef4444' : '#1e293b'
                            }}
                          />
                          <button
                            type="button"
                            className="qty-btn qty-btn-plus"
                            onClick={(e) => { e.preventDefault(); updateStock(item.id, +1); }}
                          >+</button>
                        </div>
                        
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
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
                        {(item.stock_quantity ?? 0) > 0 && (item.inStock === false || item.in_stock === false) ? (
                          <span className="status-badge" style={{ backgroundColor: '#fef3c7', color: '#b45309', border: '1px solid #f59e0b', whiteSpace: 'nowrap' }}>
                            Manually marked sold out ({item.stock_quantity} in stock)
                          </span>
                        ) : (
                          <span className={`status-badge ${item.inStock ? 'in-stock' : 'out-stock'}`}>
                            {item.inStock ? 'In Stock' : 'Sold Out'}
                          </span>
                        )}
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
                          cost_price: item.cost_price != null ? (item.cost_price / 100).toFixed(2) : '',
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
                  <h3 style={{ margin: 0 }}>Customer Details</h3>
                  <button className="btn btn-sm btn-primary" onClick={() => setBlastComposer({ channel: 'WhatsApp', message: '' })}>
                    Message segment
                  </button>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '1.25rem' }}>
                  {['All', ...CUSTOMER_SEGMENTS].map(seg => (
                    <button
                      key={seg}
                      className="btn btn-sm"
                      onClick={() => setCustomerSegmentFilter(seg)}
                      style={{
                        borderRadius: '999px',
                        border: customerSegmentFilter === seg ? '1.5px solid #FFC72C' : '1px solid var(--text-secondary)',
                        background: customerSegmentFilter === seg ? '#FFC72C' : 'transparent',
                        color: customerSegmentFilter === seg ? '#17150F' : 'inherit',
                        fontWeight: 700
                      }}
                    >
                      {seg} ({segmentCounts[seg] || 0})
                    </button>
                  ))}
                </div>

                <div className="table-responsive">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Segment</th>
                        <th>Points</th>
                        <th>Total Orders</th>
                        <th>Lifetime Spend (RM)</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCustomers.length === 0 ? (
                        <tr><td colSpan="6" className="text-center text-muted" style={{ padding: '2rem' }}>No customers in this segment.</td></tr>
                      ) : filteredCustomers.map(customer => (
                        <tr key={customer.id}>
                          <td className="font-medium" style={{ cursor: 'pointer' }} onClick={() => openCustomerDetail(customer)}>
                            {customer.name || customer.email || 'Unnamed'}
                            <div className="text-xs text-muted mt-1 font-normal">{customer.phone || 'No Phone'}</div>
                          </td>
                          <td><span className="status-badge in-stock">{customer.segment}</span></td>
                          <td className="text-primary font-bold">{customer.points || 0} pts</td>
                          <td>{customer.orderCount}</td>
                          <td className="font-bold text-success">{(customer.lifetimeCents / 100).toFixed(2)}</td>
                          <td>
                            <button className="btn btn-sm btn-secondary" onClick={() => openCustomerDetail(customer)}>View</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (() => {
              const customer = customersWithMeta.find(c => c.id === selectedCustomerId);
              if (!customer) return <p>Customer not found</p>;
              const avatarHex = CUSTOMER_AVATAR_COLORS[customer.avatar_color] || CUSTOMER_AVATAR_COLORS.ember;
              const initial = (customer.name || customer.email || '?').charAt(0).toUpperCase();

              return (
                <div>
                  <button className="btn btn-sm btn-secondary" style={{ marginBottom: '1.5rem' }} onClick={() => setSelectedCustomerId(null)}>
                    ← Back to Customers
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '1.5rem' }}>
                    <div style={{ width: '52px', height: '52px', borderRadius: '999px', background: avatarHex, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '1.3rem', flexShrink: 0 }}>
                      {initial}
                    </div>
                    <div>
                      <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>{customer.name || customer.email || 'Unnamed'}</div>
                      <span className="status-badge in-stock">{customer.segment}</span>
                    </div>
                  </div>

                  <div className="admin-grid-auto-200" style={{ marginBottom: '2rem' }}>
                    <div className="admin-card" style={{ boxShadow: 'none', border: '1px solid #e2e8f0', margin: 0 }}>
                      <h4 style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Lifetime Spend</h4>
                      <p style={{ margin: '0.5rem 0 0', fontSize: '1.25rem', fontWeight: 700, color: '#10b981' }}>RM {(customer.lifetimeCents / 100).toFixed(2)}</p>
                    </div>
                    <div className="admin-card" style={{ boxShadow: 'none', border: '1px solid #e2e8f0', margin: 0 }}>
                      <h4 style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Orders</h4>
                      <p style={{ margin: '0.5rem 0 0', fontSize: '1.25rem', fontWeight: 700 }}>{customer.orderCount}</p>
                    </div>
                    <div className="admin-card" style={{ boxShadow: 'none', border: '1px solid #e2e8f0', margin: 0 }}>
                      <h4 style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Avg Order</h4>
                      <p style={{ margin: '0.5rem 0 0', fontSize: '1.25rem', fontWeight: 700 }}>RM {(customer.avgCents / 100).toFixed(2)}</p>
                    </div>
                    <div className="admin-card" style={{ boxShadow: 'none', border: '1px solid #e2e8f0', margin: 0 }}>
                      <h4 style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Points</h4>
                      <p style={{ margin: '0.5rem 0 0', fontSize: '1.25rem', fontWeight: 700, color: '#2563eb' }}>{customer.points || 0}</p>
                    </div>
                    <div className="admin-card" style={{ boxShadow: 'none', border: '1px solid #e2e8f0', margin: 0 }}>
                      <h4 style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Last Seen</h4>
                      <p style={{ margin: '0.5rem 0 0', fontSize: '1.25rem', fontWeight: 700 }}>{customer.lastSeenDays == null ? 'Never ordered' : `${customer.lastSeenDays}d ago`}</p>
                    </div>
                  </div>

                  <div className="admin-grid-auto-200" style={{ marginBottom: '2rem', alignItems: 'start' }}>
                    <div className="admin-card" style={{ boxShadow: 'none', border: '1px solid #e2e8f0', margin: 0 }}>
                      <h4 style={{ margin: '0 0 8px', color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Tags</h4>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                        {tagDraft.map((tag, i) => (
                          <span key={i} className="status-badge in-stock" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            {tag}
                            <button type="button" onClick={() => setTagDraft(tagDraft.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 800, padding: 0 }}>×</button>
                          </span>
                        ))}
                        {tagDraft.length === 0 && <span className="text-muted" style={{ fontSize: '0.8rem' }}>No tags yet.</span>}
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <input
                          type="text"
                          className="price-input"
                          placeholder="Add a tag…"
                          value={tagInput}
                          onChange={e => setTagInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && tagInput.trim()) {
                              e.preventDefault();
                              if (!tagDraft.includes(tagInput.trim())) setTagDraft([...tagDraft, tagInput.trim()]);
                              setTagInput('');
                            }
                          }}
                          style={{ flex: 1 }}
                        />
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => { if (tagInput.trim() && !tagDraft.includes(tagInput.trim())) { setTagDraft([...tagDraft, tagInput.trim()]); setTagInput(''); } }}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                    <div className="admin-card" style={{ boxShadow: 'none', border: '1px solid #e2e8f0', margin: 0 }}>
                      <h4 style={{ margin: '0 0 8px', color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Counter Note</h4>
                      <textarea
                        className="price-input"
                        style={{ width: '100%', minHeight: '72px', fontFamily: 'inherit', resize: 'vertical' }}
                        placeholder="Allergies, usual order, anything the counter should know…"
                        value={noteDraft}
                        onChange={e => setNoteDraft(e.target.value)}
                      />
                    </div>
                  </div>
                  <button
                    className="btn btn-sm btn-primary"
                    style={{ marginBottom: '2rem' }}
                    disabled={savingCustomer}
                    onClick={() => saveCustomerTagsAndNote(customer.id)}
                  >
                    {savingCustomer ? 'Saving…' : 'Save tags & note'}
                  </button>

                  <h4 style={{ marginBottom: '1rem' }}>Order Timeline</h4>
                  {customer.timelineOrders.length > 0 ? (
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
                          {customer.timelineOrders.map(order => (
                            <tr key={order.id} style={{ opacity: order.status === 'CANCELLED' ? 0.6 : 1 }}>
                              <td className="font-medium text-xs">{order.id}</td>
                              <td className="text-xs text-muted">{new Date(order.created_at).toLocaleDateString()}</td>
                              <td>
                                <div style={{ display: 'flex', flexDirection: 'column', fontSize: '0.875rem' }}>
                                  {order.items.map((item, i) => (
                                    <div key={i} style={{ marginBottom: '0.25rem' }}>
                                      <span style={{ fontWeight: 'bold' }}>{item.quantity}x</span> {item.name}
                                      {item.selectedAddons && item.selectedAddons.length > 0 && (
                                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginLeft: '1rem', marginTop: '0.25rem' }}>
                                          + {item.selectedAddons.map(a => a.name).join(', ')}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </td>
                              <td className="font-bold">{(order.total / 100).toFixed(2)}</td>
                              <td>
                                <span className="font-medium">#{formatOrderId(order.id)}</span>{' '}
                                <span className={`status-badge ${order.status === 'COLLECTED' ? 'in-stock' : order.status === 'CANCELLED' ? 'out-stock' : ''}`}>
                                  {order.status}
                                </span>
                                {order.refund_amount != null && (
                                  <div className="text-xs" style={{ color: '#dc2626', fontWeight: 700, marginTop: '2px' }}>
                                    {order.status === 'CANCELLED' ? 'Voided' : 'Refunded'} RM {(order.refund_amount / 100).toFixed(2)}
                                  </div>
                                )}
                                {order.status === 'CANCELLED' && order.cancel_reason && (
                                  <div className="text-xs text-muted mt-1">{order.cancel_reason}</div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-muted">No orders yet -- orders will appear here once this customer checks out.</p>
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
                          <span style={{ fontWeight: 'bold', color: assignedItemsCount > 0 ? '#10b981' : 'var(--text-muted)' }}>
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
                <h3 style={{ margin: 0, color: 'var(--munchies-yellow)', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  ✏️ Edit Category
                </h3>
                <button type="button" onClick={() => setEditingCat(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.3rem', cursor: 'pointer' }}>✕</button>
              </div>

              <form onSubmit={handleSaveCatEdit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>CATEGORY CODE</label>
                  <input
                    type="text"
                    required
                    value={editingCat.code}
                    onChange={(e) => setEditingCat({ ...editingCat, code: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>DISPLAY LABEL</label>
                  <input
                    type="text"
                    required
                    value={editingCat.label}
                    onChange={(e) => setEditingCat({ ...editingCat, label: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>EMOJI ICON</label>
                  <select
                    value={editingCat.icon || '🍔'}
                    onChange={(e) => setEditingCat({ ...editingCat, icon: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
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
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>BADGE COLOR</label>
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
                    style={{ padding: '12px 18px', borderRadius: '8px', border: 'none', background: 'var(--text-secondary)', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}
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
                  <th>Order</th>
                  <th>Addon</th>
                  <th>Price</th>
                  <th>Stock / Alert</th>
                  <th>Status</th>
                  <th>Assign to Items</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {[...addons]
                  .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                  .map((addon, idx, sortedList) => {
                  const currentStock = addon.stock_quantity ?? 99;
                  const lowStockThresh = addon.low_stock_threshold ?? 10;
                  const isOutOfStock = currentStock <= 0;
                  const isLowStock = currentStock <= lowStockThresh && currentStock > 0;
                  return (
                    <tr key={addon.id}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            style={{ padding: '2px 8px' }}
                            onClick={() => moveAddon(addon.id, 'up')}
                            disabled={idx === 0}
                            title="Move up"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            style={{ padding: '2px 8px' }}
                            onClick={() => moveAddon(addon.id, 'down')}
                            disabled={idx === sortedList.length - 1}
                            title="Move down"
                          >
                            ▼
                          </button>
                        </div>
                      </td>
                      <td className="font-medium">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {addon.image && <img src={addon.image} alt={addon.name} style={{ width: '32px', height: '32px', borderRadius: '4px', objectFit: 'cover' }} />}
                          <div>
                            <div>{addon.name}</div>
                            {isLowStock && <span style={{ color: '#f59e0b', fontSize: '0.75rem', fontWeight: 'bold' }}>Low Stock</span>}
                            {isOutOfStock && <span style={{ color: '#ef4444', fontSize: '0.75rem', fontWeight: 'bold' }}>Sold Out</span>}
                          </div>
                        </div>
                      </td>
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <div className="qty-control">
                            <button
                              type="button"
                              className="qty-btn qty-btn-minus"
                              onClick={(e) => { e.preventDefault(); updateAddonStock(addon.id, -1); }}
                              disabled={currentStock <= 0}
                            >-</button>
                            <input
                              type="number"
                              min="0"
                              className="qty-input"
                              value={editingAddonStock[addon.id] !== undefined ? editingAddonStock[addon.id] : currentStock}
                              onChange={e => handleAddonStockChange(addon.id, e.target.value)}
                              onBlur={() => saveAddonStock(addon.id)}
                              onKeyDown={e => e.key === 'Enter' && saveAddonStock(addon.id)}
                            />
                            <button
                              type="button"
                              className="qty-btn qty-btn-plus"
                              onClick={(e) => { e.preventDefault(); updateAddonStock(addon.id, 1); }}
                            >+</button>
                          </div>
                          <div className="low-stock-input-wrapper">
                            <span className="low-stock-label">Alert at:</span>
                            <input
                              type="number"
                              min="0"
                              className="low-stock-input"
                              value={editingAddonLowStock[addon.id] !== undefined ? editingAddonLowStock[addon.id] : lowStockThresh}
                              onChange={e => handleAddonLowStockChange(addon.id, e.target.value)}
                              onBlur={() => saveAddonLowStock(addon.id)}
                              onKeyDown={e => e.key === 'Enter' && saveAddonLowStock(addon.id)}
                            />
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`status-badge ${!isOutOfStock ? 'in-stock' : 'out-stock'}`}>
                          {!isOutOfStock ? 'In Stock' : 'Sold Out'}
                        </span>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {activeTab === 'history' && (
          <div className="admin-card">
            <h3 style={{ marginBottom: '1rem' }}>Completed & Cancelled Orders</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '1.5rem' }}>
              {['All', 'Web', 'Loyverse', 'Grab', 'Cancelled', 'Refunded'].map(f => (
                <button
                  key={f}
                  className="btn btn-sm"
                  onClick={() => { setHistoryChannelFilter(f); setVisibleHistoryCount(6); }}
                  style={{
                    borderRadius: '999px',
                    border: historyChannelFilter === f ? '1.5px solid #FFC72C' : '1px solid var(--text-secondary)',
                    background: historyChannelFilter === f ? '#FFC72C' : 'transparent',
                    color: historyChannelFilter === f ? '#17150F' : 'inherit',
                    fontWeight: 700
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
            {(() => {
              const allHistoryOrders = orders
                .filter(o => o.status === 'COLLECTED' || o.status === 'CANCELLED')
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

              const historyOrders = allHistoryOrders.filter(o => {
                if (historyChannelFilter === 'All') return true;
                if (historyChannelFilter === 'Cancelled') return o.status === 'CANCELLED';
                if (historyChannelFilter === 'Refunded') return o.refund_amount != null;
                return getOrderChannelKey(o) === historyChannelFilter.toLowerCase().replace('grab', 'grabfood');
              });

              return (
                <>
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
                        {historyOrders.slice(0, visibleHistoryCount).map(order => {
                          const isExpanded = expandedHistoryOrderIds.has(order.id);
                          const isRefunded = order.refund_amount != null;
                          return (
                            <Fragment key={order.id}>
                              <tr
                                onClick={() => toggleHistoryOrderExpand(order.id)}
                                style={{ cursor: 'pointer', transition: 'background-color 0.15s ease' }}
                              >
                                <td className="font-medium text-xs">
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <ChevronDown
                                      size={14}
                                      style={{
                                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                        transition: 'transform 0.2s ease',
                                        flexShrink: 0
                                      }}
                                    />
                                    <span>#{formatOrderId(order.id)}</span>
                                  </div>
                                </td>
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
                                  {isRefunded && (
                                    <span className="status-badge out-stock" style={{ marginLeft: '4px', background: '#7f1d1d', color: '#fff' }}>
                                      {order.status === 'CANCELLED' ? 'VOIDED' : 'REFUNDED'}
                                    </span>
                                  )}
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr style={{ backgroundColor: 'rgba(0, 0, 0, 0.02)' }}>
                                  <td colSpan="5" style={{ padding: '0.75rem 1.25rem' }}>
                                    <div style={{ fontWeight: 700, marginBottom: '0.35rem', fontSize: '0.85rem', color: 'var(--text-main)' }}>Order Items:</div>
                                    {order.items && order.items.length > 0 ? (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.85rem' }}>
                                        {order.items.map((item, i) => (
                                          <div key={i} style={{ color: 'var(--text-main)' }}>
                                            <span style={{ fontWeight: 800 }}>{item.quantity || 1}x</span> {item.name}
                                            {item.selectedAddons && item.selectedAddons.length > 0 && (
                                              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: '1rem', marginTop: '0.1rem' }}>
                                                + {item.selectedAddons.map(a => a.name).join(', ')}
                                              </div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="text-muted" style={{ fontSize: '0.8rem' }}>No item details recorded.</div>
                                    )}
                                    {(order.payment_method || order.paymentMethod) && (
                                      <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        Payment Method: <span style={{ fontWeight: 600 }}>{order.payment_method || order.paymentMethod}</span>
                                      </div>
                                    )}
                                    {order.notes && (
                                      <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--gold)', fontWeight: 700 }}>
                                        📝 {order.notes}
                                      </div>
                                    )}
                                    {isRefunded ? (
                                      <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#dc2626', fontWeight: 700 }}>
                                        Refunded RM {(order.refund_amount / 100).toFixed(2)} — {order.refund_reason} ({new Date(order.refunded_at).toLocaleDateString()})
                                      </div>
                                    ) : order.status === 'COLLECTED' && (
                                      <button
                                        className="btn btn-sm btn-secondary"
                                        style={{ marginTop: '0.75rem' }}
                                        onClick={(e) => { e.stopPropagation(); setRefundingOrder({ id: order.id, total: order.total, amountMode: 'full', reason: '' }); }}
                                      >
                                        Refund or void
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                        {historyOrders.length === 0 && (
                          <tr>
                            <td colSpan="5" className="text-center text-muted" style={{ padding: '2rem' }}>No past orders yet -- past orders will appear here once orders are placed.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {historyOrders.length > 0 && (
                    <div style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Showing {Math.min(visibleHistoryCount, historyOrders.length)} of {historyOrders.length}
                    </div>
                  )}
                  {historyOrders.length > visibleHistoryCount && (
                    <div style={{ marginTop: '0.75rem', textAlign: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '8px 20px', fontSize: '0.875rem' }}
                        onClick={() => setVisibleHistoryCount(prev => prev + 6)}
                      >
                        Load 6 more · {historyOrders.length - visibleHistoryCount} remaining
                      </button>
                    </div>
                  )}
                </>
              );
            })()}
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
                  <button className="btn btn-primary btn-sm" onClick={() => openCreatePromoModal()}>+ New Promo Code</button>
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
                            {promo.name && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{promo.name}</div>}
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
                                  color: promo.active ? '#ffffff' : 'var(--text-secondary)',
                                  border: promo.active ? 'none' : '1px solid #cbd5e1',
                                  boxShadow: promo.active ? '0 2px 4px rgba(16, 185, 129, 0.3)' : 'none',
                                  transition: 'all 0.2s ease'
                                }}
                              >
                                {promo.active ? 'ACTIVE' : 'INACTIVE'}
                              </button>
                              <button
                                onClick={() => openEditPromoModal(promo)}
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '4px', color: 'var(--text-secondary)' }}
                                title="Edit Promo Code"
                              >
                                ✏️
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
                        <tr><td colSpan="6" className="text-center text-muted" style={{ padding: '2rem' }}>No promo codes yet -- promo codes will appear here once you create one.</td></tr>
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
                        <tr><td colSpan="4" className="text-center text-muted" style={{ padding: '2rem' }}>No referrals yet -- referrals will appear here once a friend signs up using your code.</td></tr>
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
                  <td><strong>{prize.name}</strong>{prize.description && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{prize.description}</div>}</td>
                  <td className="text-orange font-bold">{prize.points_cost} PTS</td>
                  <td>{linked ? <span style={{ fontSize: '0.8rem', color: '#22c55e' }}>{linked.name} (Stock: {linked.stock_quantity})</span> : <span className="text-muted">-</span>}</td>
                  <td><span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', background: prize.is_active ? '#166534' : 'var(--text-secondary)', color: '#fff' }}>{prize.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td><div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-sm" style={{ background: prize.is_active ? '#f59e0b' : '#22c55e', color: '#fff' }} onClick={() => updateLoyaltyPrize(prize.id, { is_active: !prize.is_active })}>{prize.is_active ? 'Disable' : 'Enable'}</button>
                    <button className="btn btn-sm btn-outline text-red" onClick={() => { if(window.confirm("Delete this prize? This can't be undone.")) deleteLoyaltyPrize(prize.id); }}>Delete</button>
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
            {redemptions.length > 0 && (
              <p style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
                <strong>Total value given away: RM {totalRedemptionValue.toFixed(2)}</strong>
                {redemptionsMissingCost > 0 && (
                  <span className="text-muted"> ({redemptionsMissingCost} redemption{redemptionsMissingCost === 1 ? '' : 's'} not counted — set a cost price on the linked menu item in Menu CRM)</span>
                )}
              </p>
            )}
            <div className="table-responsive"><table className="admin-table">
              <thead><tr><th>Code</th><th>Customer</th><th>Prize</th><th>Cost</th><th>Time</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {redemptions.length === 0 ? (
                  <tr><td colSpan="7" className="text-center text-muted" style={{ padding: '2rem' }}>No redemptions yet -- prize redemptions will appear here once customers redeem prizes.</td></tr>
                ) : redemptions.map(r => {
                  const costState = getRedemptionCostState(r);
                  return (
                  <tr key={r.id} style={{ opacity: r.status === 'FULFILLED' ? 0.6 : 1 }}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 'bold', fontSize: '1.1rem', color: 'var(--munchies-yellow)' }}>{r.redemption_code}</td>
                    <td><strong>{r.profiles?.name || 'Unknown'}</strong><div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{r.profiles?.phone || ''}</div></td>
                    <td><strong>{r.prize_name}</strong><div style={{ fontSize: '0.8rem', color: '#f59e0b' }}>{r.points_spent} pts</div></td>
                    <td style={{ fontSize: '0.85rem', fontWeight: costState.state === 'costed' ? 400 : 700, color: costState.state === 'costed' ? 'var(--text)' : '#b45309' }}>
                      {costState.state === 'costed' ? `RM ${costState.amount.toFixed(2)}` : costState.state === 'no_cost' ? 'No cost set' : 'Not linked'}
                    </td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{new Date(r.redeemed_at).toLocaleString()}</td>
                    <td><span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', background: r.status === 'PENDING' ? '#b45309' : '#166534', color: '#fff' }}>{r.status}</span></td>
                    <td>{r.status === 'PENDING' && (<button className="btn btn-sm btn-primary" onClick={async () => { if(window.confirm('Mark fulfilled?')) await fulfillRedemption(r.id, user.id); }}>Fulfill</button>)}
                    {r.status === 'FULFILLED' && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Done</span>}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table></div>
          </div>
        )}

        {/* Audit log Tab -- owner only */}
        {activeTab === 'audit' && !viewingAsStaff && (
          <div className="admin-card">
            <h3>Audit log</h3>
            <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>Every price change, stock adjustment, order state change, refund, promo and settings change writes a row here. Newest first.</p>
            {auditLoading ? (
              <p className="text-muted">Loading…</p>
            ) : (
              <div className="table-responsive"><table className="admin-table">
                <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead>
                <tbody>
                  {auditLog.length === 0 ? (
                    <tr><td colSpan="4" className="text-center text-muted" style={{ padding: '2rem' }}>No audit entries yet -- actions taken in this console will appear here.</td></tr>
                  ) : auditLog.map(row => (
                    <tr key={row.id}>
                      <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{new Date(row.created_at).toLocaleString()}</td>
                      <td style={{ fontSize: '0.85rem' }}>{row.actor_role || 'unknown'}</td>
                      <td style={{ fontSize: '0.85rem', fontWeight: 700 }}>{row.action}</td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{row.detail ? JSON.stringify(row.detail) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
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
                {promoFormData.id ? '✏️ Edit Promo Code' : '🎟️ Create Promo Code'}
              </h3>
              <button type="button" onClick={() => { setIsPromoModalOpen(false); setPromoFormData(EMPTY_PROMO_FORM); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.3rem', cursor: 'pointer' }}>✕</button>
            </div>

            <form onSubmit={handleSavePromoCode} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>PROMO CODE *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. SUMMER20"
                    value={promoFormData.code}
                    onChange={(e) => setPromoFormData({ ...promoFormData, code: e.target.value.toUpperCase() })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold', textTransform: 'uppercase' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>DISPLAY NAME (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Summer Sale"
                    value={promoFormData.name}
                    onChange={(e) => setPromoFormData({ ...promoFormData, name: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 'bold' }}>PROMO TYPE</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {[
                    ['percent_off', 'Percent off'],
                    ['flat_off', 'RM off'],
                    ['bogo', 'BOGO'],
                    ['spend_threshold_free_item', 'Free item']
                  ].map(([val, label]) => (
                    <button key={val} type="button" onClick={() => setPromoFormData({ ...promoFormData, type: val })}
                      style={{
                        padding: '8px 14px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                        border: promoFormData.type === val ? '1px solid #2563eb' : '1px solid var(--text-secondary)',
                        background: promoFormData.type === val ? '#2563eb' : 'transparent',
                        color: promoFormData.type === val ? '#fff' : 'var(--text-secondary)'
                      }}>{label}</button>
                  ))}
                </div>
                {/* BOGO isn't in the brief's 3 named chips (Percent off / RM off / Free
                    item) but is a real, DB-validated promo type (validate_and_apply_promo
                    handles it) -- kept as a 4th chip rather than silently dropping a
                    working feature. */}
              </div>

              {(promoFormData.type === 'percent_off' || promoFormData.type === 'flat_off') && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>DISCOUNT VALUE *</label>
                  <input
                    type="number"
                    required
                    placeholder={promoFormData.type === 'percent_off' ? "e.g. 20 (for 20%)" : "e.g. 500 (for RM 5.00)"}
                    value={promoFormData.value}
                    onChange={(e) => setPromoFormData({ ...promoFormData, value: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  />
                  <small style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
                    {promoFormData.type === 'flat_off' ? 'Enter in cents (e.g. 500 = RM 5.00)' : 'Enter whole percentage (e.g. 15 = 15%)'}
                  </small>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', margin: '10px 0 4px', fontWeight: 'bold' }}>MINIMUM SPEND (Optional)</label>
                  <input
                    type="number"
                    placeholder="e.g. 5000 (for RM 50.00)"
                    value={promoFormData.min_spend}
                    onChange={(e) => setPromoFormData({ ...promoFormData, min_spend: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  />
                  <small style={{ color: '#fbbf24', fontSize: '0.72rem', marginTop: '4px', display: 'block' }}>
                    ⚠️ Saved and shown to you here, but not yet enforced at checkout for this promo type — flagged as a follow-up.
                  </small>
                </div>
              )}

              {promoFormData.type === 'bogo' && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>REQUIRED ITEM *</label>
                  <select
                    required
                    value={promoFormData.applies_to_item_id}
                    onChange={(e) => setPromoFormData({ ...promoFormData, applies_to_item_id: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  >
                    <option value="">Select an Item...</option>
                    {menu.map(item => (
                      <option key={item.id} value={item.id}>{item.name} - RM {(item.price/100).toFixed(2)}</option>
                    ))}
                  </select>
                  <small style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>User must have this item in cart to get the discount (value of 1 unit).</small>
                </div>
              )}

              {promoFormData.type === 'spend_threshold_free_item' && (
                <div style={{ display: 'flex', gap: '10px', flexDirection: 'column' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>MINIMUM SPEND *</label>
                    <input
                      type="number"
                      required
                      placeholder="e.g. 5000 (for RM 50.00)"
                      value={promoFormData.min_spend}
                      onChange={(e) => setPromoFormData({ ...promoFormData, min_spend: e.target.value })}
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                    />
                    <small style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>Enter in cents (e.g. 5000 = RM 50.00)</small>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>FREE ITEM *</label>
                    <select
                      required
                      value={promoFormData.free_item_id}
                      onChange={(e) => setPromoFormData({ ...promoFormData, free_item_id: e.target.value })}
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
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
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>MAX TOTAL USES</label>
                  <input
                    type="number"
                    placeholder="∞"
                    value={promoFormData.max_total_uses}
                    onChange={(e) => setPromoFormData({ ...promoFormData, max_total_uses: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>MAX PER USER</label>
                  <input
                    type="number"
                    placeholder="∞"
                    value={promoFormData.max_uses_per_user}
                    onChange={(e) => setPromoFormData({ ...promoFormData, max_uses_per_user: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>STARTS AT</label>
                  <input
                    type="datetime-local"
                    className="dark-datetime-input"
                    value={promoFormData.starts_at}
                    onChange={(e) => setPromoFormData({ ...promoFormData, starts_at: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>ENDS AT</label>
                  <input
                    type="datetime-local"
                    className="dark-datetime-input"
                    value={promoFormData.ends_at}
                    onChange={(e) => setPromoFormData({ ...promoFormData, ends_at: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
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

              <div onClick={() => setPromoFormData({ ...promoFormData, active: !promoFormData.active })}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '10px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0' }}>Active</span>
                <div style={{ width: '40px', height: '22px', borderRadius: '11px', flexShrink: 0,
                  background: promoFormData.active ? '#22c55e' : 'var(--text-secondary)', position: 'relative', transition: 'background 0.2s' }}>
                  <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: '#fff',
                    position: 'absolute', top: '3px', transition: 'left 0.2s', left: promoFormData.active ? '21px' : '3px' }} />
                </div>
              </div>

              {buildPromoPreview(promoFormData) && (
                <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'rgba(37,99,235,0.12)', border: '1px solid rgba(37,99,235,0.35)' }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>👁️ Customer sees</div>
                  <div style={{ fontSize: '0.85rem', color: '#e2e8f0' }}>{buildPromoPreview(promoFormData)}</div>
                </div>
              )}

              <button
                type="submit"
                disabled={savingPromo}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', background: '#2563eb', color: '#fff', fontWeight: 'bold', cursor: savingPromo ? 'default' : 'pointer', opacity: savingPromo ? 0.6 : 1, marginTop: '8px' }}
              >
                {savingPromo ? 'Saving…' : promoFormData.id ? 'Save Changes' : 'Create Promo Code'}
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
              <h3 style={{ margin: 0, color: 'var(--munchies-yellow)', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {eventFormData.id ? '✏️ Edit Event / Note' : '📌 Add Event / Note'}
              </h3>
              <button type="button" onClick={() => setIsEventModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.3rem', cursor: 'pointer' }}>✕</button>
            </div>

            <form onSubmit={handleSaveEvent} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>DATE</label>
                <input
                  type="date"
                  required
                  value={selectedEventDate}
                  onChange={(e) => setSelectedEventDate(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>CATEGORY / TYPE</label>
                <select
                  value={eventFormData.type}
                  onChange={(e) => setEventFormData({ ...eventFormData, type: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                >
                  <option value="event">🎉 Store Event</option>
                  <option value="promo">🔥 Promotion</option>
                  <option value="note">📝 Task / Restock Note</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>TITLE</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CZ CHIX Promo Launch"
                  value={eventFormData.title}
                  onChange={(e) => setEventFormData({ ...eventFormData, title: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>DETAILS / DESCRIPTION</label>
                <textarea
                  rows="3"
                  placeholder="Add event details, discount info, or restock notes..."
                  value={eventFormData.description}
                  onChange={(e) => setEventFormData({ ...eventFormData, description: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff' }}
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
                  style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: 'var(--text-secondary)', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}
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
              <h3 style={{ margin: 0, color: 'var(--munchies-yellow)', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                ✏️ Edit Item Details
              </h3>
              <button type="button" onClick={() => setEditingMenuItem(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.3rem', cursor: 'pointer' }}>✕</button>
            </div>

            <form onSubmit={handleSaveMenuItemDetails} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>ITEM NAME</label>
                <input
                  type="text"
                  required
                  value={editingMenuItem.name}
                  onChange={(e) => setEditingMenuItem({ ...editingMenuItem, name: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>CATEGORY</label>
                <select
                  value={editingMenuItem.category}
                  onChange={(e) => setEditingMenuItem({ ...editingMenuItem, category: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                >
                  {categoriesList.map(c => (
                    <option key={c.id} value={c.code}>{c.icon || '🏷️'} {c.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>PRICE (RM)</label>
                <input
                  type="number"
                  step="0.10"
                  required
                  value={editingMenuItem.price}
                  onChange={(e) => setEditingMenuItem({ ...editingMenuItem, price: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>COST PRICE (RM) — optional</label>
                <input
                  type="number"
                  step="0.10"
                  placeholder="e.g. 2.20"
                  value={editingMenuItem.cost_price}
                  onChange={(e) => setEditingMenuItem({ ...editingMenuItem, cost_price: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontWeight: 'bold' }}
                />
                <CostMarginLine
                  dark
                  costPriceCents={editingMenuItem.cost_price !== '' && editingMenuItem.cost_price != null ? Math.round(parseFloat(editingMenuItem.cost_price) * 100) : null}
                  priceCents={editingMenuItem.price ? Math.round(parseFloat(editingMenuItem.price) * 100) : 0}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>DESCRIPTION</label>
                <textarea
                  rows="3"
                  placeholder="Describe ingredients, options, or combo details..."
                  value={editingMenuItem.description}
                  onChange={(e) => setEditingMenuItem({ ...editingMenuItem, description: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>UPDATE ITEM IMAGE</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setEditingMenuItemImageFile(e.target.files[0])}
                  style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontSize: '0.85rem' }}
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
                  style={{ padding: '12px 18px', borderRadius: '8px', border: 'none', background: 'var(--text-secondary)', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}
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
            <h3 style={{ margin: '0 0 1rem 0', color: 'var(--munchies-yellow)', fontSize: '1.2rem' }}>Cancel Order</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <div><label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 'bold' }}>REASON</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {CANCEL_REASONS.map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setCancellingOrder({ ...cancellingOrder, reason: r })}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '999px',
                      border: `1px solid ${cancellingOrder.reason === r ? '#FFC72C' : 'var(--text-secondary)'}`,
                      background: cancellingOrder.reason === r ? '#FFC72C' : '#0f172a',
                      color: cancellingOrder.reason === r ? '#17150F' : '#fff',
                      fontWeight: 700,
                      fontSize: '0.75rem',
                      cursor: 'pointer'
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div></div>
              <div><label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>NOTE (OPTIONAL)</label>
              <textarea value={cancellingOrder.note} onChange={e => setCancellingOrder({...cancellingOrder, note: e.target.value})} placeholder="Any extra detail..." style={{ width: '100%', minHeight: '56px', padding: '10px', borderRadius: '8px', border: '1px solid var(--text-secondary)', background: '#0f172a', color: '#fff', fontFamily: 'inherit', resize: 'vertical' }} /></div>
              <div><label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 'bold' }}>STOCK ACTION</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', background: cancellingOrder.wasteAction === 'restore' ? '#1e3a8a' : '#0f172a', border: '1px solid var(--text-secondary)', borderRadius: '8px', cursor: 'pointer', marginBottom: '8px' }}>
                <input type="radio" checked={cancellingOrder.wasteAction === 'restore'} onChange={() => setCancellingOrder({...cancellingOrder, wasteAction: 'restore'})} />
                <div><div style={{ color: '#fff', fontWeight: 'bold' }}>Restore to stock</div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Item not prepared, still available.</div></div>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', background: cancellingOrder.wasteAction === 'waste' ? '#450a0a' : '#0f172a', border: '1px solid var(--text-secondary)', borderRadius: '8px', cursor: 'pointer' }}>
                <input type="radio" checked={cancellingOrder.wasteAction === 'waste'} onChange={() => setCancellingOrder({...cancellingOrder, wasteAction: 'waste'})} />
                <div><div style={{ color: '#fca5a5', fontWeight: 'bold' }}>Mark as waste</div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Item prepped, cannot be resold.</div></div>
              </label></div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => {
                    if (!cancellingOrder.reason) { alert("Please pick a reason."); return; }
                    const { id, reason, note, wasteAction, previousStatus } = cancellingOrder;
                    cancelOrder(id, reason, wasteAction, true, note.trim() || null);
                    logAudit('Order cancelled', { orderId: id, reason, note: note.trim() || null, wasteAction });
                    pushToast({
                      kind: 'danger',
                      title: 'Order cancelled',
                      msg: `#${formatOrderId(id)} — ${reason}`,
                      // Reverts the order's status only -- it does not reverse
                      // cancel_order()'s stock restore / waste_log side effect.
                      // A full reversal would need its own RPC (symmetrical to
                      // cancel_order) rather than a plain client-side status
                      // flip; out of scope for this PR.
                      undo: () => { updateOrderState(id, previousStatus); logAudit('Order cancellation undone (status only, stock/waste not reversed)', { orderId: id, revertedTo: previousStatus }); }
                    });
                    setCancellingOrder(null);
                  }}
                  style={{ flex: 1, padding: '12px', borderRadius: '8px', border: 'none', background: '#ef4444', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  Confirm Cancel
                </button>
                <button onClick={() => setCancellingOrder(null)} style={{ padding: '12px 18px', borderRadius: '8px', border: 'none', background: 'var(--text-secondary)', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>Abort</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* §4 Order History: refund/void modal */}
      {refundingOrder && (() => {
        const amountCents = refundingOrder.amountMode === 'full' ? refundingOrder.total : Math.round(refundingOrder.total / 2);
        return (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
            <div style={{ background: '#1e293b', padding: '2rem', borderRadius: '16px', width: '100%', maxWidth: '450px', border: '1px solid #334155' }}>
              <h3 style={{ margin: '0 0 1rem 0', color: 'var(--munchies-yellow)', fontSize: '1.2rem' }}>Refund or void</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '8px', fontWeight: 'bold' }}>AMOUNT</label>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    {[['full', 'Full (void)'], ['half', 'Half']].map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setRefundingOrder({ ...refundingOrder, amountMode: mode })}
                        style={{
                          flex: 1, padding: '10px', borderRadius: '8px',
                          border: `1px solid ${refundingOrder.amountMode === mode ? '#FFC72C' : '#334155'}`,
                          background: refundingOrder.amountMode === mode ? '#FFC72C' : '#0f172a',
                          color: refundingOrder.amountMode === mode ? '#17150F' : '#fff',
                          fontWeight: 700, cursor: 'pointer'
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>RM {(amountCents / 100).toFixed(2)} of RM {(refundingOrder.total / 100).toFixed(2)}</div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '8px', fontWeight: 'bold' }}>REASON</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {REFUND_REASONS.map(r => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRefundingOrder({ ...refundingOrder, reason: r })}
                        style={{
                          padding: '6px 12px', borderRadius: '999px',
                          border: `1px solid ${refundingOrder.reason === r ? '#FFC72C' : '#334155'}`,
                          background: refundingOrder.reason === r ? '#FFC72C' : '#0f172a',
                          color: refundingOrder.reason === r ? '#17150F' : '#fff',
                          fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer'
                        }}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    disabled={!refundingOrder.reason}
                    onClick={async () => {
                      if (!refundingOrder.reason) { alert('Please pick a reason.'); return; }
                      const ok = await refundOrder(refundingOrder.id, amountCents, refundingOrder.reason, refundingOrder.amountMode === 'full');
                      if (ok) setRefundingOrder(null);
                    }}
                    style={{ flex: 1, padding: '12px', borderRadius: '8px', border: 'none', background: !refundingOrder.reason ? '#475569' : '#ef4444', color: '#fff', fontWeight: 'bold', cursor: !refundingOrder.reason ? 'not-allowed' : 'pointer' }}
                  >
                    Confirm {refundingOrder.amountMode === 'full' ? 'Void' : 'Refund'}
                  </button>
                  <button onClick={() => setRefundingOrder(null)} style={{ padding: '12px 18px', borderRadius: '8px', border: 'none', background: 'var(--text-secondary)', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>Abort</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* §2 Customers CRM: "Message segment" blast composer. There's no
          WhatsApp/Push provider wired into this codebase (no API keys,
          no send function) -- "Send" logs the composed blast to the audit
          trail rather than claiming to deliver anything. Wiring a real
          provider is a separate, explicit integration task. */}
      {blastComposer && (() => {
        const recipients = customerSegmentFilter === 'All' ? customersWithMeta : customersWithMeta.filter(c => c.segment === customerSegmentFilter);
        const sampleName = recipients[0]?.name || 'Customer';
        const preview = blastComposer.message.trim()
          ? blastComposer.message.replaceAll('{name}', sampleName)
          : <span className="text-muted">Preview appears here as you type…</span>;
        return (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
            <div style={{ background: '#1e293b', padding: '2rem', borderRadius: '16px', width: '100%', maxWidth: '480px', border: '1px solid #334155' }}>
              <h3 style={{ margin: '0 0 1rem 0', color: 'var(--munchies-yellow)', fontSize: '1.2rem' }}>Message segment</h3>
              <p style={{ margin: '0 0 1.2rem', fontSize: '0.85rem', color: '#94a3b8' }}>
                Sending to <strong>{customerSegmentFilter}</strong> — {recipients.length} customer{recipients.length === 1 ? '' : 's'}.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '8px', fontWeight: 'bold' }}>CHANNEL</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {['WhatsApp', 'Push'].map(ch => (
                      <button
                        key={ch}
                        type="button"
                        onClick={() => setBlastComposer({ ...blastComposer, channel: ch })}
                        style={{
                          flex: 1, padding: '10px', borderRadius: '8px',
                          border: `1px solid ${blastComposer.channel === ch ? '#FFC72C' : '#334155'}`,
                          background: blastComposer.channel === ch ? '#FFC72C' : '#0f172a',
                          color: blastComposer.channel === ch ? '#17150F' : '#fff',
                          fontWeight: 700, cursor: 'pointer'
                        }}
                      >
                        {ch}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px', fontWeight: 'bold' }}>MESSAGE — use {'{name}'} for the customer's name</label>
                  <textarea
                    value={blastComposer.message}
                    onChange={e => setBlastComposer({ ...blastComposer, message: e.target.value })}
                    placeholder="Hey {name}, we miss you! Come back for..."
                    style={{ width: '100%', minHeight: '80px', padding: '10px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: '#fff', fontFamily: 'inherit', resize: 'vertical' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px', fontWeight: 'bold' }}>CUSTOMER SEES</label>
                  <div style={{ padding: '10px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid #334155', fontSize: '0.85rem', color: '#e2e8f0' }}>
                    {preview}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    disabled={!blastComposer.message.trim() || recipients.length === 0}
                    onClick={() => {
                      logAudit('Marketing blast sent', { segment: customerSegmentFilter, channel: blastComposer.channel, message: blastComposer.message.trim(), recipientCount: recipients.length });
                      pushToast({ kind: 'new', msg: `Blast logged for ${recipients.length} customer${recipients.length === 1 ? '' : 's'} (${blastComposer.channel}).` });
                      setBlastComposer(null);
                    }}
                    style={{ flex: 1, padding: '12px', borderRadius: '8px', border: 'none', background: !blastComposer.message.trim() || recipients.length === 0 ? '#475569' : '#FFC72C', color: '#17150F', fontWeight: 'bold', cursor: !blastComposer.message.trim() || recipients.length === 0 ? 'not-allowed' : 'pointer' }}
                  >
                    Send
                  </button>
                  <button onClick={() => setBlastComposer(null)} style={{ padding: '12px 18px', borderRadius: '8px', border: 'none', background: 'var(--text-secondary)', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>Cancel</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
    </div>
  );
}
