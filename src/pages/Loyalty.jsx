import { useState } from 'react';
import { Award, QrCode, Gamepad2, Lock, History, CheckCircle, Gift } from 'lucide-react';
import Modal from '../components/Modal';
import { useStore } from '../contexts/StoreContext';
import './Loyalty.css';

export default function Loyalty() {
  const { points, pointHistory, loyaltyPrizes, redeemPrize } = useStore();
  const nextRank = 5000;
  const progress = Math.min(100, (points / nextRank) * 100);

  const [redeemedThisSession, setRedeemedThisSession] = useState({});
  const [redemptionResult, setRedemptionResult] = useState(null);
  const [loading, setLoading] = useState(null);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(5);

  const handleRedeem = async (prize) => {
    if (loading) return;
    if (redeemedThisSession[prize.id]) return;
    setLoading(prize.id);
    const result = await redeemPrize(prize.id);
    setLoading(null);
    if (result) {
      setRedeemedThisSession(prev => ({ ...prev, [prize.id]: true }));
      setRedemptionResult({ code: result.redemption_code, prizeName: prize.name, pointsSpent: result.points_spent });
    }
  };

  return (
    <div className="loyalty-page">
      <div className="card rank-header-card">
        <div className="medal-circle"><Award size={32} color="#fff" /></div>
        <h1>BURGER MASTER</h1>
        <p className="rank-level">LOYALTY REWARDS</p>
        <div className="points-flex">
          <span>{points.toLocaleString()} POINTS</span>
          <span>{nextRank.toLocaleString()} TARGET</span>
        </div>
        <div className="progress-bar-lg">
          <div className="progress-fill-lg" style={{ width: `${progress}%` }}></div>
        </div>
      </div>

      <div className="actions-row">
        <div className="card action-btn action-scan" style={{ cursor: 'pointer' }} onClick={() => window.location.href = '/cart'}>
          <QrCode size={32} /><span>Order Now</span>
        </div>
        <div className="card action-btn action-play" style={{ cursor: 'pointer' }} onClick={() => window.location.href = '/arcade'}>
          <Gamepad2 size={32} /><span>Play to Earn</span>
        </div>
      </div>

      <div className="section-header mt-4">
        <h2>PRIZE VAULT</h2>
        <Lock size={20} color="var(--text-dim)" />
      </div>

      <div className="prize-list">
        {loyaltyPrizes.length === 0 ? (
          <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--surface-raised)', border: '1px solid var(--line-strong)', borderRadius: 'var(--r-card)' }}>
            <Gift size={32} style={{ marginBottom: '8px', opacity: 0.5 }} />
            <p>No prizes available right now. Check back soon!</p>
          </div>
        ) : (
          loyaltyPrizes.map(prize => {
            const canRedeem = points >= prize.points_cost;
            const alreadyRedeemed = redeemedThisSession[prize.id];
            const isLoading = loading === prize.id;
            return (
              <div key={prize.id} className="card prize-card">
                {prize.image_url ? (
                  <div className="prize-img" style={{ backgroundImage: `url('${prize.image_url}')` }}></div>
                ) : (
                  <div className="prize-img" style={{ background: 'var(--plate)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Gift size={36} color="var(--text-dim)" />
                  </div>
                )}
                <div className="prize-info">
                  <h3>{prize.name}</h3>
                  {prize.description && <p style={{ fontSize: '0.75rem', color: 'var(--text-2)', margin: '2px 0 0 0' }}>{prize.description}</p>}
                  <p className="pts-req">{prize.points_cost.toLocaleString()} PTS</p>
                </div>
                <button
                  className={`btn ${alreadyRedeemed ? 'btn-dark' : canRedeem ? 'btn-primary' : 'btn-dark'} prize-btn`}
                  disabled={!canRedeem || alreadyRedeemed || isLoading}
                  onClick={() => handleRedeem(prize)}
                  style={alreadyRedeemed ? { background: 'rgba(95, 214, 140, .16)', color: 'var(--go)', border: '1px solid rgba(95, 214, 140, .4)', cursor: 'default' } : {}}
                >
                  {isLoading ? '...' : alreadyRedeemed ? 'REDEEMED' : canRedeem ? 'REDEEM' : 'LOCKED'}
                </button>
              </div>
            );
          })
        )}
      </div>

      <div className="card history-card">
        <div className="history-header"><History size={20} /><h3>POINT HISTORY</h3></div>
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
            <p className="text-muted text-sm p-3">No transactions recorded yet. Place orders or play Munch-Man to earn points!</p>
          )}
        </div>
      </div>

      {redemptionResult && (
        <Modal
          onClose={() => setRedemptionResult(null)}
          closeOnBackdropClick={false}
          closeOnEscape={false}
          showCloseButton={false}
          contentStyle={{ background: 'var(--surface-raised)', borderRadius: 'var(--r-card)', padding: '2rem', width: '100%', maxWidth: '360px', textAlign: 'center', border: '1px solid rgba(255, 199, 44, .4)', boxShadow: '0 0 40px rgba(255,199,44,0.15)' }}
          ariaLabel="Prize Redemption Code"
        >
          <CheckCircle size={48} color="var(--go)" style={{ marginBottom: '12px' }} />
          <h2 style={{ color: 'var(--gold)', margin: '0 0 4px 0', fontSize: '1.3rem', fontFamily: "'Archivo', sans-serif" }}>Redeemed!</h2>
          <p style={{ color: 'var(--text-2)', margin: '0 0 1.5rem 0', fontSize: '0.9rem' }}>{redemptionResult.prizeName} - {redemptionResult.pointsSpent.toLocaleString()} pts spent</p>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)', padding: '1.2rem', marginBottom: '1.5rem', border: '1px solid var(--line)' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '0 0 6px 0', fontWeight: 'bold', letterSpacing: '1px' }}>YOUR REDEMPTION CODE</p>
            <div style={{ fontSize: '2rem', fontWeight: '900', color: 'var(--gold)', letterSpacing: '4px', fontFamily: 'monospace' }}>{redemptionResult.code}</div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', margin: '8px 0 0 0' }}>Show this to the counter staff to claim your prize</p>
          </div>
          <button onClick={() => setRedemptionResult(null)} style={{ width: '100%', padding: '14px', minHeight: '48px', borderRadius: 'var(--r-pill)', border: 'none', background: 'var(--ember)', color: '#fff', fontWeight: '900', fontSize: '1rem', cursor: 'pointer' }}>
            GOT IT!
          </button>
        </Modal>
      )}
    </div>
  );
}
