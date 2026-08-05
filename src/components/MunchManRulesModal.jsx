import React from 'react';
import { X, Award, ShieldAlert, Zap, Flame } from 'lucide-react';
import './MunchManRulesModal.css';

export default function MunchManRulesModal({ isOpen, onClose, onConfirm, streak = 0 }) {
  if (!isOpen) return null;

  return (
    <div className="munchman-rules-overlay" onClick={onClose}>
      <div className="munchman-rules-card" onClick={(e) => e.stopPropagation()}>
        <button className="munchman-close-btn" onClick={onClose}>
          <X size={20} />
        </button>

        <h2 className="munchman-rules-title">🎮 Munch-Man Rules</h2>

        {streak > 0 && (
          <div className="munchman-streak-badge">
            <Flame size={14} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
            Current Daily Streak: {streak} Day{streak > 1 ? 's' : ''}!
          </div>
        )}

        <div className="munchman-rules-list">
          <div className="munchman-rule-item">
            <span className="munchman-rule-icon">🟡</span>
            <div><strong>Munch All Dots:</strong> Clear the maze to secure a WIN and earn <strong>+50 Loyalty Points</strong>.</div>
          </div>
          <div className="munchman-rule-item">
            <span className="munchman-rule-icon">👻</span>
            <div><strong>Avoid Food Ghosts:</strong> Stay away from Sauce, Grease, and Crumb unless powered up!</div>
          </div>
          <div className="munchman-rule-item">
            <span className="munchman-rule-icon">⚡</span>
            <div><strong>Power Pellets:</strong> Grab orange pellets to turn ghosts blue and munch them for extra game score!</div>
          </div>
          <div className="munchman-rule-item">
            <span className="munchman-rule-icon">🎁</span>
            <div><strong>Rewards & Streaks:</strong> Clear 50%+ dots on loss for a <strong>+20 Pts</strong> partial reward. Keep a daily streak for 3-day and 7-day bonuses!</div>
          </div>
        </div>

        <button className="munchman-btn" style={{ width: '100%' }} onClick={onConfirm}>
          Got it! Let's Play
        </button>
      </div>
    </div>
  );
}
