import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { QrCode, Gamepad2, Lock, History, Gift } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import { useCountUp } from '../hooks/useCountUp';
import RankCard from '../components/RankCard';
import { ordersToGoText } from '../utils/ordersToReward';
import { rewardValueText } from '../utils/rewardValue';
import { upcomingPriceChange, fmtMYDate } from '../utils/rewardSchedule';
import './Loyalty.css';

const fmtDate = (d) => new Date(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuching' });

export default function Loyalty() {
  const { setUser } = useAuth();
  const { points, orders, pointHistory, loyaltyPrizes, menu, addons } = useStore();
  const displayedPoints = useCountUp(points, 800);
  // The cheapest reward the customer cannot afford yet.
  const nextPrize = [...loyaltyPrizes].sort((a, b) => a.points_cost - b.points_cost).find(p => p.points_cost > (points || 0)) || null;

  // Rewards whose Monsta Coin price drops on a set date (notice shown until then).
  const priceDrops = loyaltyPrizes.map(p => ({ prize: p, change: upcomingPriceChange(p) })).filter(x => x.change);

  const [visibleHistoryCount, setVisibleHistoryCount] = useState(5);

  // Rewards not collected within 14 days expire and the points come back.
  // Points fade after 12 months with no orders, game points or rewards
  // (25% a month). This also applies any fade that is due, then tells us
  // whether to show the reminder banner.
  const [expiry, setExpiry] = useState(null);
  useEffect(() => {
    Promise.resolve(supabase.rpc('expire_stale_redemptions')).catch(() => {});
    Promise.resolve(supabase.rpc('my_points_expiry'))
      .then(({ data }) => {
        if (!data) return;
        setExpiry(data);
        if (data.removed > 0) setUser((u) => (u ? { ...u, points: data.points } : u));
      })
      .catch(() => {});
  }, [setUser]);

  return (
    <div className="loyalty-page">
      {expiry && (expiry.state === 'soon' || expiry.state === 'fading') && expiry.points > 0 && (
        <div className="expiry-banner" role="status">
          {expiry.state === 'soon' ? (
            <>
              <strong>Keep your {expiry.points} Monsta Coins.</strong> They start to fade on {fmtDate(expiry.fade_starts_at)} if there is no order. Order any time before then and you keep them all.
            </>
          ) : (
            <>
              <strong>Your Monsta Coins are fading ({expiry.points} left).</strong>{' '}
              {expiry.next_loss_at
                ? `${expiry.next_loss_points} more go on ${fmtDate(expiry.next_loss_at)}. `
                : ''}
              Any order stops it straight away.
            </>
          )}
        </div>
      )}
      {priceDrops.length > 0 && (
        <div className="expiry-banner" role="status">
          <strong>Lower prices coming.</strong>{' '}
          {priceDrops.map(({ prize, change }) => `${prize.name}: ${change.cost.toLocaleString()} Monsta Coins from ${fmtMYDate(change.from)} (now ${prize.points_cost.toLocaleString()})`).join(' · ')}
        </div>
      )}
      <RankCard points={points} displayedPoints={displayedPoints} />

      <div className="actions-row">
        <div className="card action-btn action-scan" style={{ cursor: 'pointer' }} onClick={() => window.location.href = '/cart'}>
          <QrCode size={32} /><span>Order Now</span>
        </div>
        <div className="card action-btn action-play" style={{ cursor: 'pointer' }} onClick={() => window.location.href = '/arcade'}>
          <Gamepad2 size={32} /><span>Play Arcade</span>
        </div>
      </div>

      <div className="section-header mt-4">
        <h2>PRIZE VAULT</h2>
        <Lock size={20} color="var(--text-dim)" />
      </div>

      {nextPrize && (
        <div className="card next-reward">
          <p className="next-reward-text">
            <strong>{(nextPrize.points_cost - (points || 0)).toLocaleString()} Coins</strong> to your next reward: {nextPrize.name} ({ordersToGoText(nextPrize.points_cost - (points || 0), orders)})
          </p>
          <div className="next-reward-bar"><div className="next-reward-fill" style={{ width: `${Math.min(100, Math.round(((points || 0) / nextPrize.points_cost) * 100))}%` }} /></div>
        </div>
      )}

      <div className="prize-list">
        {loyaltyPrizes.length === 0 ? (
          <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--surface-raised)', border: '1px solid var(--line-strong)', borderRadius: 'var(--r-card)' }}>
            <Gift size={32} style={{ marginBottom: '8px', opacity: 0.5 }} />
            <p>No prizes available right now. Check back soon!</p>
          </div>
        ) : (
          loyaltyPrizes.map(prize => {
            const canRedeem = points >= prize.points_cost;
            return (
              <div key={prize.id} className="card prize-card">
                <div className="prize-img" style={{ backgroundImage: `url('${prize.image_url || '/images/prize_placeholder.png'}')` }}></div>
                <div className="prize-info">
                  <h3>{prize.name}</h3>
                  {prize.description && <p style={{ fontSize: '0.75rem', color: 'var(--text-2)', margin: '2px 0 0 0' }}>{prize.description}</p>}
                  {upcomingPriceChange(prize) && <p style={{ fontSize: '0.75rem', color: 'var(--gold, #FFC72C)', margin: '2px 0 0 0' }}>From {fmtMYDate(upcomingPriceChange(prize).from)}: {upcomingPriceChange(prize).cost.toLocaleString()} Coins</p>}
                  <p className="pts-req">{prize.points_cost.toLocaleString()} Coins{rewardValueText(prize, menu, addons) && ` · ${rewardValueText(prize, menu, addons)}`}{!canRedeem && ` · ${(prize.points_cost - (points || 0)).toLocaleString()} to go`}</p>
                </div>
                {/* Rewards are claimed in the app at checkout (no counter codes). */}
                {canRedeem ? (
                  <Link to="/menu" className="btn btn-primary prize-btn" style={{ textAlign: 'center', textDecoration: 'none' }}>
                    USE AT CHECKOUT
                  </Link>
                ) : (
                  <button className="btn btn-dark prize-btn" disabled>LOCKED</button>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="card history-card">
        <div className="history-header"><History size={20} /><h3>MONSTA COIN HISTORY</h3></div>
        <div className="history-list">
          {pointHistory && pointHistory.length > 0 ? (
            <>
              {pointHistory.slice(0, visibleHistoryCount).map(item => (
                <div key={item.id} className="history-item">
                  <div className="history-info">
                    <p className="history-action">{item.description || item.type}</p>
                    <p className="history-date">{item.date}</p>
                  </div>
                  <div className="history-pts font-bold">+{item.amount || item.pts}</div>
                </div>
              ))}
              {pointHistory.length > visibleHistoryCount && (
                <button
                  type="button"
                  className="btn btn-secondary w-full"
                  style={{ marginTop: '1rem', fontSize: '0.9rem', padding: '10px' }}
                  onClick={() => setVisibleHistoryCount(prev => prev + 5)}
                >
                  Load More
                </button>
              )}
            </>
          ) : (
            <p className="text-muted text-sm p-3">No transactions recorded yet. Place an order and collect it to earn Monsta Coins!</p>
          )}
        </div>
      </div>
    </div>
  );
}
