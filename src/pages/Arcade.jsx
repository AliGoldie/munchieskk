import { useState, useEffect } from 'react';
import { Award, Star, Clock } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import MunchManModal from '../components/MunchManModal';
import './Arcade.css';

export default function Arcade() {
  const { points } = useStore();
  const { user } = useAuth();
  const [isMunchManOpen, setIsMunchManOpen] = useState(false);
  const [globalRank, setGlobalRank] = useState(null);
  const [rankPercentile, setRankPercentile] = useState(null);

  useEffect(() => {
    const fetchGlobalRank = async () => {
      if (!user?.id) {
        setGlobalRank(null);
        setRankPercentile(null);
        return;
      }
      try {
        const { data, error } = await supabase.rpc('get_user_rank');
        if (error) throw error;
        setGlobalRank(data?.rank ?? null);
        setRankPercentile(data?.percentile ?? null);
      } catch (err) {
        console.error('Error fetching global rank:', err);
      }
    };

    fetchGlobalRank();
  }, [user?.id, points]);

  const games = [
    {
      id: 1,
      title: 'MUNCH MAN',
      desc: 'Eat all the dots before the Food Ghosts catch you! Grab a power pellet to turn the tables.',
      difficulty: 'HARD',
      rating: 4.9,
      time: '1m',
      img: '/images/munchman_game.jpg',
      bgClass: 'game-bg-yellow',
      onClick: () => setIsMunchManOpen(true)
    }
  ];

  return (
    <div className="arcade-page">
      
      {/* Weekly Prize Banner with CZ CHIX Image Background */}
      <div
        className="card arcade-prize-banner"
        style={{
          backgroundImage: "linear-gradient(rgba(10, 10, 10, .35), rgba(10, 10, 10, .96)), url('/images/cz_chix_burger.png')",
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}
      >
        <div className="prize-content">
          <span className="badge-light-blue">WEEKLY PRIZE</span>
          <h2>WIN A FREE<br/>CZ CHIX<br/>BURGER SET!</h2>
          <p>Rank in the Top 10 to claim your crown!</p>
          <button className="btn btn-dark mt-2" onClick={() => setIsMunchManOpen(true)}>PLAY NOW</button>
        </div>
        <div className="prize-img-wrapper">
          <div className="prize-img-circle">
            <div className="prize-burger" style={{backgroundImage: "url('/images/cz_chix_burger.png')"}}></div>
          </div>
        </div>
      </div>

      {/* Global Rank */}
      <div className="card rank-card">
        <Award size={24} className="rank-icon" color="var(--ember)" />
        <p className="rank-label">GLOBAL RANK</p>
        <h2 className="rank-number">
          {globalRank ? `#${globalRank}` : user ? '...' : '—'}
        </h2>
        <span className="rank-sub">
          {rankPercentile
            ? `top ${rankPercentile}% this week`
            : user ? 'calculating rank...' : 'Log in to see your rank'}
        </span>
      </div>

      {/* High Contrast Colorful My Points Card */}
      <div className="card points-card">
        <div className="points-card-left">
          <h2 className="points-card-title">MY POINTS</h2>
          <div className="points-badge">
            <div className="points-star-circle">
              <Star size={16} fill="#ffffff" color="#ffffff" />
            </div>
            <span>{points || 0} PTS</span>
          </div>
        </div>
      </div>

      <h2 className="mt-4 mb-2">CHOOSE YOUR<br/>GAME</h2>

      {/* Games List */}
      <div className="games-list">
        {games.map(game => (
          <div 
            key={game.id} 
            className="card game-card"
            style={{ cursor: 'pointer' }}
            onClick={game.onClick}
          >
            <div className={`game-img-container ${game.bgClass}`}>
              <span className={`difficulty-badge diff-${game.difficulty.toLowerCase()}`}>
                {game.difficulty}
              </span>
              <div className="game-thumb" style={{backgroundImage: `url('${game.img}')`}}></div>
              {/* Fallback pattern if no image */}
              <div className="game-pattern"></div>
            </div>
            <div className="game-info">
              <h3>{game.title}</h3>
              <p>{game.desc}</p>
              <div className="game-stats">
                <span className="stat"><Star size={14} fill="var(--gold)" color="var(--gold)" /> {game.rating}</span>
                <span className="stat"><Clock size={14} /> {game.time}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <MunchManModal 
        isOpen={isMunchManOpen} 
        onClose={() => setIsMunchManOpen(false)} 
      />

    </div>
  );
}
