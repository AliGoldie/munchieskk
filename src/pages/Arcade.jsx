import { useState } from 'react';
import { Star, Clock } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import MunchManModal from '../components/MunchManModal';
import TrexRunnerModal from '../components/TrexRunnerModal';
import SpeedGrabModal from '../components/SpeedGrabModal';
import ArcadeContestCard from '../components/ArcadeContestCard';
import './Arcade.css';

export default function Arcade() {
  const { points } = useStore();
  const { user } = useAuth();
  const [isMunchManOpen, setIsMunchManOpen] = useState(false);
  const [isTrexRunnerOpen, setIsTrexRunnerOpen] = useState(false);
  const [isSpeedGrabOpen, setIsSpeedGrabOpen] = useState(false);
  const games = [
    {
      id: 1,
      title: 'MUNCH MAN',
      desc: 'Eat all the dots before the Food Ghosts catch you! Grab a power pellet to turn the tables.',
      difficulty: 'HARD',
      rating: 4.9,
      time: '1m',
      img: '/images/munchman_game.webp',
      bgClass: 'game-bg-yellow',
      onClick: () => setIsMunchManOpen(true)
    },
    {
      id: 2,
      title: 'T-REX RUNNER',
      desc: 'Leap your T-Rex across raised platforms and pits, dodging kitchen chaos and grabbing burgers along the way. How far can you get?',
      difficulty: 'EASY',
      rating: 4.7,
      time: 'Endless',
      img: '/images/trex_runner_game.webp',
      bgClass: 'game-bg-blue',
      onClick: () => setIsTrexRunnerOpen(true)
    },
    {
      id: 3,
      title: 'SPEED GRAB',
      desc: 'Snacks and drinks flash across the counter -- tap the good ones before they vanish and dodge the wrong orders. Chase your combo for a new daily high score!',
      difficulty: 'MEDIUM',
      rating: 4.8,
      time: '30s',
      img: '/images/fry_catch.webp',
      bgClass: 'game-bg-pink',
      onClick: () => setIsSpeedGrabOpen(true)
    }
  ];

  return (
    <div className="arcade-page">
      
      {/* Arcade contest, weekly goal and any contest claim codes */}
      <ArcadeContestCard refreshKey={`${user?.id || 'guest'}-${isTrexRunnerOpen}-${isSpeedGrabOpen}`} />

      {/* High Contrast Colorful My Points Card */}
      <div className="card points-card">
        <div className="points-card-left">
          <h2 className="points-card-title">MY MONSTA COINS</h2>
          <div className="points-badge">
            <div className="points-star-circle">
              <Star size={16} fill="#ffffff" color="#ffffff" />
            </div>
            <span>{user ? `${points || 0} Coins` : 'Log in to earn'}</span>
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

      <TrexRunnerModal
        isOpen={isTrexRunnerOpen}
        onClose={() => setIsTrexRunnerOpen(false)}
      />

      <SpeedGrabModal
        isOpen={isSpeedGrabOpen}
        onClose={() => setIsSpeedGrabOpen(false)}
      />

    </div>
  );
}
