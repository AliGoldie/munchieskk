import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import { loyaltyConfig } from '../config/loyaltyConfig';
import { playReadySound } from '../utils/soundAlert';
import './CookingPopup.css';

export default function CookingPopup() {
  const { orders } = useStore();
  const navigate = useNavigate();
  const [orderId, setOrderId] = useState(() => localStorage.getItem('munchies_active_order'));
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const prevStatus = useRef(null);
  const originalTitle = useRef(document.title);
  const titleFlashRef = useRef(null);

  // Listen for active order ID changes (set by Payment page)
  useEffect(() => {
    const onStorage = () => setOrderId(localStorage.getItem('munchies_active_order'));
    window.addEventListener('storage', onStorage);
    // Also poll localStorage for same-tab changes
    const poll = setInterval(() => {
      const id = localStorage.getItem('munchies_active_order');
      setOrderId(id);
    }, 500);
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(poll);
    };
  }, []);

  const order = orders.find(o => o.id === orderId);

  // Reset dismissed when a new order comes in
  useEffect(() => {
    if (orderId) setDismissed(false);
  }, [orderId]);

  // Countdown timer while COOKING
  useEffect(() => {
    if (!order || order.status !== 'COOKING') return;
    const interval = setInterval(() => {
      const startedAt = order.cooking_started_at || order.created_at;
      const startMs = new Date(startedAt).getTime();
      const elapsed = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      setTimeElapsed(elapsed);
    }, 1000);
    return () => clearInterval(interval);
  }, [order]);

  // Detect status change → READY, play sound + flash title
  useEffect(() => {
    if (!order) return;
    if (prevStatus.current === 'COOKING' && order.status === 'READY') {
      setDismissed(false); // Un-dismiss the popup so they see the READY notification
      playReadySound();
      // Flash tab title
      let flash = true;
      titleFlashRef.current = setInterval(() => {
        document.title = flash ? '🔔 Order Ready!' : originalTitle.current;
        flash = !flash;
      }, 800);
      // Stop flashing after 10 seconds
      setTimeout(() => {
        clearInterval(titleFlashRef.current);
        document.title = originalTitle.current;
      }, 10000);
    }
    if (order.status === 'COLLECTED') {
      localStorage.removeItem('munchies_active_order');
      setOrderId(null);
      clearInterval(titleFlashRef.current);
      document.title = originalTitle.current;
    }
    prevStatus.current = order.status;
  }, [order?.status]);

  // Cleanup title on unmount
  useEffect(() => () => {
    clearInterval(titleFlashRef.current);
    document.title = originalTitle.current;
  }, []);

  if (!order || dismissed || order.status === 'COLLECTED') return null;

  const cookTime = order.cook_time_seconds || loyaltyConfig.DEFAULT_COOK_TIME_SECONDS;
  const progressPercent = Math.min(100, (timeElapsed / cookTime) * 100);
  const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  const isPending = order.status === 'PENDING';
  const isReady = order.status === 'READY';

  return (
    <div className={`cooking-popup ${isReady ? 'cooking-popup-ready' : ''}`} onClick={() => navigate(`/order/${orderId}`)}>
      <button
        className="cooking-popup-close"
        onClick={e => { e.stopPropagation(); setDismissed(true); }}
        aria-label="Dismiss"
      >×</button>

      {isReady ? (
        <div className="popup-ready-content">
          <div className="popup-ready-icon">🍔</div>
          <div>
            <div className="popup-ready-title">Your order is READY!</div>
            <div className="popup-ready-sub">Tap to collect · #{orderId.split('-')[0].toUpperCase()}</div>
          </div>
        </div>
      ) : isPending ? (
        <div className="popup-cooking-content">
          <div className="popup-flame">⏳</div>
          <div className="popup-text">
            <div className="popup-label">Waiting for kitchen…</div>
            <div style={{fontSize:'0.85rem', color:'rgba(255,255,255,0.7)', marginTop:'2px'}}>Timer starts when accepted</div>
          </div>
        </div>
      ) : (
        <div className="popup-cooking-content">
          <div className="popup-flame">🔥</div>
          <div className="popup-text">
            <div className="popup-label">Time Elapsed…</div>
            <div className="popup-timer">{formatTime(timeElapsed)}</div>
          </div>
        </div>
      )}

      {!isReady && (
        <div className="popup-progress-bar">
          <div className="popup-progress-fill" style={{ width: `${progressPercent}%`, backgroundColor: progressPercent === 100 ? '#ef4444' : '#f59e0b' }} />
        </div>
      )}
    </div>
  );
}
