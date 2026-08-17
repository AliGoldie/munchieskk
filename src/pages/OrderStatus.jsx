import { useState, useEffect } from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import { loyaltyConfig } from '../config/loyaltyConfig';
import { Flame, CheckCircle2, PartyPopper, Share2, ArrowRight } from 'lucide-react';
import './OrderStatus.css';

export default function OrderStatus() {
  const { id } = useParams();
  const { orders, updateOrderState, addPoints, claimShareBonus, cancelOrder } = useStore();
  const order = orders.find(o => o.id === id);

  const cookTime = order?.cook_time_seconds || loyaltyConfig.DEFAULT_COOK_TIME_SECONDS;
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [showReviewPrompt, setShowReviewPrompt] = useState(false);
  const [claimedReview, setClaimedReview] = useState(false);

  // Timer logic for COOKING state
  useEffect(() => {
    if (!order || order.status !== 'COOKING') return;
    
    console.log(`[REALTIME LAG TEST] OrderStatus.jsx received COOKING for ${order.id}: ${Date.now()}`);

    const ct = order.cook_time_seconds || loyaltyConfig.DEFAULT_COOK_TIME_SECONDS;
    const interval = setInterval(() => {
      let startedAt = order.cooking_started_at || order.created_at;
      if (typeof startedAt === 'string' && /^\d+$/.test(startedAt)) {
        startedAt = parseInt(startedAt, 10);
      }
      const startMs = new Date(startedAt).getTime();
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      setTimeElapsed(elapsedSeconds);
    }, 1000);

    return () => clearInterval(interval);
  }, [order]);

  if (!order) return <Navigate to="/" replace />;

  const handleCollect = () => {
    updateOrderState(id, 'COLLECTED');
    addPoints(loyaltyConfig.COLLECTION_BONUS_PTS, `Collected Order ${id}`);
    localStorage.removeItem('munchies_active_order');
    setShowReviewPrompt(true);
  };

  const handleSocialShare = async (platform) => {
    if (claimedReview) return;
    try {
      await claimShareBonus(loyaltyConfig.REVIEW_BONUS_PTS, `Social Share (${platform})`);
      setClaimedReview(true);
      alert(`Thank you for sharing on ${platform}! ${loyaltyConfig.REVIEW_BONUS_PTS} bonus points added.`);
    } catch (err) {
      alert("We couldn't complete that right now. Please try again, or contact us via WhatsApp.");
    }
  };

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const progressPercent = Math.min(100, (timeElapsed / cookTime) * 100);

  return (
    <div className="order-status-page">
      <div className="container" style={{maxWidth: '500px'}}>
        
        {/* PENDING STATE — waiting for admin to accept */}
        {order.status === 'PENDING' && (
          <div className="status-card cooking-card">
            <div className="kitchen-visual" style={{fontSize:'4rem', animation:'pulse 2s ease-in-out infinite'}}>⏳</div>
            <h2>ORDER RECEIVED!</h2>
            <p className="order-id">Order ID: #{order.id.split('-')[0].toUpperCase()}</p>
            <p className="text-muted mt-3" style={{lineHeight:'1.6'}}>
              Your order is with the kitchen.<br/>We'll start the timer once they confirm it!
            </p>
            <div style={{marginTop:'1.5rem', background:'rgba(255,202,8,0.15)', borderRadius:'12px', padding:'1rem'}}>
              <p className="font-black" style={{color:'var(--munchies-orange)', fontSize:'0.85rem', letterSpacing:'0.05em'}}>⚡ PREPARING YOUR ORDER</p>
            </div>
            <button 
              className="btn mt-4 w-100" 
              style={{ background: 'transparent', border: '2px solid #ff5b5b', color: '#ff5b5b', fontWeight: '800', borderRadius: '12px' }}
              onClick={() => {
                cancelOrder(order.id, "Cancelled by Customer");
                localStorage.removeItem('munchies_active_order');
                alert('Your order has been cancelled.');
              }}
            >
              CANCEL ORDER
            </button>
          </div>
        )}

        {/* CANCELLED STATE */}
        {order.status === 'CANCELLED' && (
          <div className="status-card" style={{borderTop: '6px solid #ff5b5b'}}>
            <div className="kitchen-visual" style={{fontSize:'4rem'}}>❌</div>
            <h2 style={{color: '#ff5b5b'}}>ORDER CANCELLED</h2>
            <p className="order-id">Order ID: #{order.id.split('-')[0].toUpperCase()}</p>
            <p className="text-muted mt-3">This order has been cancelled.</p>
            <Link to="/" className="btn btn-dark w-100 mt-4" onClick={() => localStorage.removeItem('munchies_active_order')}>RETURN TO MENU</Link>
          </div>
        )}

        {/* COOKING STATE */}
        {order.status === 'COOKING' && (
          <div className="status-card cooking-card">
            <div className="kitchen-visual">
              <Flame size={80} className="flame-icon pulse" />
            </div>
            
            <h2>ORDER IN KITCHEN</h2>
            <p className="order-id">Order ID: #{order.id.split('-')[0].toUpperCase()}</p>
            
            <div className="timer-container mt-4">
              <div className="timer-text font-black text-orange">
                {formatTime(timeElapsed)}
              </div>
              <p className="text-muted text-sm mt-1">
                Time Elapsed
              </p>
              
              <div className="progress-bar mt-3">
                <div 
                  className="progress-fill" 
                  style={{ width: `${progressPercent}%`, backgroundColor: progressPercent === 100 ? '#ef4444' : '#f59e0b' }}
                ></div>
              </div>
            </div>
            
            <div className="order-items-preview mt-4">
              <h4 className="text-left">Your Order:</h4>
              <ul className="text-left text-muted mt-2">
                {order.items.map((item, i) => (
                  <li key={i} className="mb-2">
                    {item.quantity}x {item.name}
                    {item.selectedAddons && item.selectedAddons.length > 0 && (
                      <div className="text-sm ml-4 opacity-75">
                        + {item.selectedAddons.map(a => a.name).join(', ')}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* READY STATE */}
        {order.status === 'READY' && (
          <div className="status-card ready-card scale-in">
            <div className="ready-visual">
              <CheckCircle2 size={100} className="text-success pulse" />
            </div>
            <h1 className="text-success mt-3 font-black">IT'S READY!</h1>
            <p className="order-id">Order ID: {order.id}</p>
            <p className="mt-3">Your delicious Munchies are waiting for you at the counter.</p>
            
            <div className="action-box mt-4">
              <button className="btn btn-primary w-full pulse-button" onClick={handleCollect}>
                TAP TO COLLECT FOOD
              </button>
              <p className="text-sm mt-2 font-medium">Earn +{loyaltyConfig.COLLECTION_BONUS_PTS} PTS for collecting!</p>
            </div>
          </div>
        )}

        {/* COLLECTED STATE */}
        {order.status === 'COLLECTED' && (
          <div className="status-card collected-card fade-in">
            <PartyPopper size={64} className="text-primary mb-3 mx-auto" />
            <h2>ENJOY YOUR MEAL!</h2>
            <p className="text-muted mt-2">Thanks for choosing MunchiesKK.</p>

            {showReviewPrompt && (
              <div className="social-prompt mt-4">
                <div className="prompt-header">
                  <Flame size={20} className="text-orange" />
                  <h4>EARN {loyaltyConfig.REVIEW_BONUS_PTS} BONUS POINTS</h4>
                </div>
                <p className="text-sm mt-2 mb-3">Snap a pic of your food and tag us on social media to claim your reward instantly!</p>
                
                <div className="flex gap-2 justify-center">
                  <button 
                    className="btn btn-outline flex-1 social-share-btn" 
                    onClick={() => handleSocialShare('Instagram')}
                    disabled={claimedReview}
                  >
                    <Share2 size={18} /> Instagram
                  </button>
                  <button 
                    className="btn btn-outline flex-1 social-share-btn" 
                    onClick={() => handleSocialShare('Facebook')}
                    disabled={claimedReview}
                  >
                    <Share2 size={18} /> Facebook
                  </button>
                </div>
                {claimedReview && <p className="text-success text-sm mt-3 font-bold">Bonus claimed!</p>}
              </div>
            )}
            
            <Link to="/" className="btn btn-dark w-full mt-4 flex items-center justify-center gap-2">
              Back to Home <ArrowRight size={18} />
            </Link>
          </div>
        )}

      </div>
    </div>
  );
}
