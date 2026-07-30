import { useState } from 'react';
import { Award, Plus, Star, Clock } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';
import './Arcade.css';

export default function Arcade() {
  const { user } = useStore();
  const tokens = 850;

  const games = [
    {
      id: 1,
      title: 'BURGER FLIP',
      desc: 'Keep those patties moving! Don\'t let \'em burn.',
      difficulty: 'HARD',
      rating: 4.9,
      time: '1m',
      img: '/images/burger_flip.png',
      bgClass: 'game-bg-yellow'
    },
    {
      id: 2,
      title: 'FRY CATCH',
      desc: 'Catch the golden fries in your carton. Watch out for salt bombs!',
      difficulty: 'EASY',
      rating: 4.7,
      time: '2m',
      img: '/images/fry_catch.png',
      bgClass: 'game-bg-blue'
    },
    {
      id: 3,
      title: 'SHAKE MATCH',
      desc: 'Match three flavors to clear the board and satisfy the rush.',
      difficulty: 'MEDIUM',
      rating: 4.8,
      time: '3m',
      img: '/images/shake_match.png',
      bgClass: 'game-bg-pink'
    }
  ];

  return (
    <div className="arcade-page">
      
      {/* Weekly Prize Banner */}
      <div className="card arcade-prize-banner">
        <div className="prize-content">
          <span className="badge-light-blue">WEEKLY PRIZE</span>
          <h2>WIN A FREE<br/>DOUBLE-<br/>DOUBLE</h2>
          <p>Rank in the Top 10 to claim your crown!</p>
          <button className="btn btn-dark mt-2">PLAY NOW</button>
        </div>
        <div className="prize-img-wrapper">
          <div className="prize-img-circle">
            <div className="prize-burger" style={{backgroundImage: "url('/images/hero_burger.png')"}}></div>
          </div>
        </div>
      </div>

      {/* Global Rank */}
      <div className="card rank-card">
        <Award size={24} className="rank-icon" color="var(--munchies-orange)" />
        <p className="rank-label">GLOBAL RANK</p>
        <h2 className="rank-number text-orange">#4,281</h2>
        <span className="rank-sub">top 15% this week</span>
      </div>

      {/* Token Balance */}
      <div className="card token-card">
        <div className="token-left">
          <h2>Token Balance</h2>
          <div className="token-amount">
            <div className="coin">
              <span className="coin-inner">M</span>
            </div>
            <span>{tokens}</span>
          </div>
        </div>
        <button className="add-token-btn">
          <Plus size={24} />
        </button>
      </div>

      <h2 className="mt-4 mb-2">CHOOSE YOUR<br/>GAME</h2>

      {/* Games List */}
      <div className="games-list">
        {games.map(game => (
          <div key={game.id} className="card game-card">
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
                <span className="stat"><Star size={14} fill="var(--munchies-dark)" /> {game.rating}</span>
                <span className="stat"><Clock size={14} /> {game.time}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
