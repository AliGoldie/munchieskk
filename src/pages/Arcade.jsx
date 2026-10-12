import { useState, useEffect } from 'react';
import { Award, Star, Clock } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import MunchManModal from '../components/MunchManModal';
import TrexRunnerModal from '../components/TrexRunnerModal';
import SpeedGrabModal from '../components/SpeedGrabModal';
import './Arcade.css';

export default function Arcade() {
  const { points } = useStore();
  const { user } = useAuth();
  const [isMunchManOpen, setIsMunchManOpen] = useState(false);
  const [isTrexRunnerOpen, setIsTrexRunnerOpen] = useState(false);
  const [isSpeedGrabOpen, setIsSpeedGrabOpen] = useState(false);
  // Monthly top-spender prize: the prize, this customer's place this month,
  // and (for the winner) the claim code. Works for guests too (no personal part).
  const [monthly, setMonthly] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.resolve(supabase.rpc('monthly_prize_status'))
      .then(({ data, error }) => { if (active && !error && data) setMonthly(data); })
      .catch((err) => console.error('Error fetching monthly prize:', err));
    return () => { active = false; };
  }, [user?.id, points]);

  const rm = (cents) => `RM${(Number(cents || 0) / 100).toLocaleString('en-MY', { maximumFractionDigits: 0 })}`;
  const prize = monthly?.prize || null;
  const my = monthly?.my || null;
  const lastWinner = monthly?.last_month?.winner_first_name && ['AWARDED', 'CLAIMED'].includes(monthly.last_month.status)
    ? `Last month: ${monthly.last_month.winner_first_name} won ${monthly.last_month.prize_name}`
    : null;
  const prizeImage = prize?.image_url || '/images/cz_chix_burger.png';

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
      
      {/* Winner's claim code */}
      {monthly?.my_win && (
        <div className="card arcade-win-card">
          <h3>You won {monthly.my_win.prize_name}!</h3>
          <p>Show this code at the counter within 14 days.</p>
          <div className="arcade-win-code">{monthly.my_win.claim_code}</div>
        </div>
      )}

      {/* Monthly prize banner: set by the owner in Admin > Promotions > Monthly Prize */}
      <div
        className="card arcade-prize-banner"
        style={{
          backgroundImage: `linear-gradient(rgba(10, 10, 10, .35), rgba(10, 10, 10, .96)), url('${prizeImage}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}
      >
        <div className="prize-content">
          <span className="badge-light-blue">MONTHLY PRIZE</span>
          {prize ? (
            <>
              <h2>WIN A FREE<br />{String(prize.name).toUpperCase()}!</h2>
              <p>{String(prize.headline || 'The top spender this month wins').replace(/[.!\s]+$/, '')}. Spend {rm(prize.min_spend_cents)}+ to qualify.</p>
            </>
          ) : (
            <>
              <h2>NEW PRIZE<br />EVERY MONTH</h2>
              <p>The top spender each month wins a free treat. This month's prize is coming soon.</p>
            </>
          )}
          {lastWinner && <p style={{ fontSize: '.8rem', opacity: .85 }}>{lastWinner}</p>}
          <button className="btn btn-dark mt-2" onClick={() => setIsMunchManOpen(true)}>PLAY NOW</button>
        </div>
        <div className="prize-img-wrapper">
          <div className="prize-img-circle">
            <div className="prize-burger" style={{ backgroundImage: `url('${prizeImage}')` }}></div>
          </div>
        </div>
      </div>

      {/* This month's rank (by spend on collected orders) */}
      <div className="card rank-card">
        <Award size={24} className="rank-icon" color="var(--ember)" />
        <p className="rank-label">THIS MONTH'S RANK</p>
        <h2 className="rank-number">
          {my?.rank ? `#${my.rank}` : user ? '—' : '—'}
        </h2>
        <span className="rank-sub">
          {!user
            ? 'Log in to see your rank'
            : !my?.rank
              ? 'Place an order to join the race'
              : my.rank === 1
                ? `You lead with ${rm(my.spend_cents)} spent`
                : `${rm(my.gap_to_first_cents)} to reach #1`}
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
            <span>{user ? `${points || 0} PTS` : 'Log in to earn'}</span>
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
