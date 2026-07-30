import { Award, QrCode, Gamepad2, Lock, History } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';
import './Loyalty.css';

export default function Loyalty() {
  const points = 2450;
  const nextRank = 3000;
  const progress = (points / nextRank) * 100;

  const history = [
    { id: 1, action: 'Level Up Bonus', date: 'OCT 24, 2023', pts: '+500' },
    { id: 2, action: 'Munchie Match Win', date: 'OCT 22, 2023', pts: '+120' },
    { id: 3, action: 'Ordered: OG Burger Box', date: 'OCT 20, 2023', pts: '+450' }
  ];

  return (
    <div className="loyalty-page">
      
      {/* Rank Header */}
      <div className="card rank-header-card">
        <div className="medal-circle">
          <Award size={32} color="var(--munchies-white)" />
        </div>
        <h1>BURGER MASTER</h1>
        <p className="rank-level">RANK LEVEL 04</p>
        
        <div className="points-flex">
          <span>{points.toLocaleString()} POINTS</span>
          <span>{nextRank.toLocaleString()} NEXT RANK</span>
        </div>
        <div className="progress-bar-lg">
          <div className="progress-fill-lg" style={{ width: `${progress}%` }}></div>
        </div>
      </div>

      {/* Actions */}
      <div className="actions-row">
        <div className="card action-btn action-scan">
          <QrCode size={32} />
          <span>Scan Receipt</span>
        </div>
        <div className="card action-btn action-play">
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
        <div className="card prize-card">
          <div className="prize-img" style={{backgroundImage: "url('/images/mushy2.jpg')"}}></div>
          <div className="prize-info">
            <h3>Mushy2<br/>Burger</h3>
            <p className="pts-req text-orange">1,650 PTS</p>
          </div>
          <button className="btn btn-dark prize-btn">REDEEM</button>
        </div>

        <div className="card prize-card">
          <div className="prize-img" style={{backgroundImage: "url('/images/regular_fries.png')"}}></div>
          <div className="prize-info">
            <h3>Regular<br/>Fries</h3>
            <p className="pts-req text-orange">500 PTS</p>
          </div>
          <button className="btn btn-dark prize-btn">REDEEM</button>
        </div>
      </div>

      {/* Point History */}
      <div className="card history-card">
        <div className="history-header">
          <History size={20} />
          <h3>POINT HISTORY</h3>
        </div>
        
        <div className="history-list">
          {history.map(item => (
            <div key={item.id} className="history-item">
              <div className="history-info">
                <p className="history-action">{item.action}</p>
                <p className="history-date">{item.date}</p>
              </div>
              <div className="history-pts">
                {item.pts}
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
