import { Award, QrCode, Gamepad2, Lock, History } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';
import './Loyalty.css';

export default function Loyalty() {
  const { points, pointHistory } = useStore();
  const nextRank = 5000;
  const progress = Math.min(100, (points / nextRank) * 100);

  const prizes = [
    {
      id: 1,
      name: 'Mushy2\nBurger',
      pts: 5000,
      img: '/images/mushy2.jpg'
    },
    {
      id: 2,
      name: 'Solero\nSplit',
      pts: 3500,
      img: '/images/SoleroSplit.jpg'
    },
    {
      id: 3,
      name: 'Regular\nFries',
      pts: 500,
      img: '/images/regular_fries.png'
    }
  ];

  return (
    <div className="loyalty-page">
      
      {/* Rank Header */}
      <div className="card rank-header-card">
        <div className="medal-circle">
          <Award size={32} color="var(--munchies-white)" />
        </div>
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

      {/* Actions */}
      <div className="actions-row">
        <div className="card action-btn action-scan" style={{ cursor: 'pointer' }} onClick={() => window.location.href = '/cart'}>
          <QrCode size={32} />
          <span>Order Now</span>
        </div>
        <div className="card action-btn action-play" style={{ cursor: 'pointer' }} onClick={() => window.location.href = '/arcade'}>
          <Gamepad2 size={32} />
          <span>Play to Earn</span>
        </div>
      </div>

      {/* Prize Vault */}
      <div className="section-header mt-4">
        <h2>PRIZE VAULT</h2>
        <Lock size={20} color="var(--munchies-orange)" />
      </div>

      <div className="prize-list">
        {prizes.map(prize => (
          <div key={prize.id} className="card prize-card">
            <div className="prize-img" style={{ backgroundImage: `url('${prize.img}')` }}></div>
            <div className="prize-info">
              <h3>{prize.name.split('\n').map((line, i) => <span key={i}>{line}<br/></span>)}</h3>
              <p className="pts-req text-orange">{prize.pts.toLocaleString()} PTS</p>
            </div>
            <button 
              className={`btn ${points >= prize.pts ? 'btn-primary' : 'btn-dark'} prize-btn`}
              disabled={points < prize.pts}
              onClick={() => {
                if (points >= prize.pts) {
                  alert(`Congratulations! You've redeemed ${prize.name.replace('\n', ' ')}! Show this to the counter.`);
                }
              }}
            >
              {points >= prize.pts ? 'REDEEM' : 'LOCKED'}
            </button>
          </div>
        ))}
      </div>

      {/* Point History */}
      <div className="card history-card">
        <div className="history-header">
          <History size={20} />
          <h3>POINT HISTORY</h3>
        </div>
        
        <div className="history-list">
          {pointHistory && pointHistory.length > 0 ? (
            pointHistory.map(item => (
              <div key={item.id} className="history-item">
                <div className="history-info">
                  <p className="history-action">{item.description || item.type}</p>
                  <p className="history-date">{item.date}</p>
                </div>
                <div className="history-pts text-orange font-bold">
                  +{item.amount || item.pts}
                </div>
              </div>
            ))
          ) : (
            <p className="text-muted text-sm p-3">No transactions recorded yet. Place orders or play Munch-Man to earn points!</p>
          )}
        </div>
      </div>

    </div>
  );
}
