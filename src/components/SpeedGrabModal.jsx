import { useEffect, useRef, useState } from 'react';
import { X, Volume2, VolumeX, Trophy, Award, Heart } from 'lucide-react';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import { isSoundMuted, setSoundMuted, playSfx, vibrate, createMusic, SONGS } from '../utils/gameFx';
import './SpeedGrabModal.css';

const ROUND_SECONDS = 45;
const GRID_SIZE = 9;
const START_LIVES = 3;
const GOOD_ICONS = { burger: '🍔', fries: '🍟', drink: '🥤' };
// Lookalikes that are NOT on the menu: tapping one costs a life (red-edged so it is fair).
const DECOY_ICONS = { burger: '🥪', fries: '🥔', drink: '🧃' };

// Tuning knobs, all in one place.
const RAMP_SECONDS = 18;       // seconds until the first full difficulty
const LATE_START = 20;         // then a tougher second half builds up until the end of the round
const GOLD_CHANCE = 0.06;      // share of good spawns that are a rare gold star
const GOLD_POINTS = 40;        // flat bonus, never multiplied
const FRENZY_EVERY = 10;       // a frenzy starts at every 10th combo
const FRENZY_SECONDS = 4;
const FRENZY_BONUS = 1.5;      // score multiplier during a frenzy (on top of the combo multiplier)
// Safety net: the server rejects scores above about 110 x seconds + 100 (3,400 for a
// 45-second round, about 5,000). Keeping every round under 4,500 and 100 x seconds keeps
// honest scores valid.
const MAX_ROUND_SCORE = 4500;

// A whack-a-mole reflex game is a grid of discrete hit targets, not a
// continuously moving scene -- so unlike MunchManModal/TrexRunnerModal this
// renders the grid as plain DOM buttons (trivial, correct touch hit-testing)
// rather than a canvas, even though the round-timing loop below still runs
// on requestAnimationFrame like its siblings.
export default function SpeedGrabModal({ isOpen, onClose }) {
  const { user, setUser } = useAuth();

  const [gameStarted, setGameStarted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [cells, setCells] = useState(() => Array(GRID_SIZE).fill(null));
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [combo, setCombo] = useState(0);
  const [timerDisplay, setTimerDisplay] = useState(String(ROUND_SECONDS).padStart(2, '0'));
  const [isUrgent, setIsUrgent] = useState(false);
  const [soundOn, setSoundOn] = useState(() => !isSoundMuted());
  const [frenzy, setFrenzy] = useState(false);
  const [pops, setPops] = useState([]);
  const [rewardMsg, setRewardMsg] = useState(null);
  const [weekInfo, setWeekInfo] = useState(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [rankInfo, setRankInfo] = useState(null);
  const [missFlash, setMissFlash] = useState(false);

  const gameRef = useRef(null);
  const audioCtxRef = useRef(null);
  // The round loop is created once, so it reads the live sound setting through a ref.
  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;
  const startSessionRef = useRef(null);
  const userRef = useRef(user);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const fetchBest = async () => {
      if (!user) {
        setBestScore(0);
        return;
      }
      try {
        const { data, error } = await supabase.rpc('get_speed_grab_best');
        if (!error && typeof data === 'number') setBestScore(data);
      } catch (err) {
        console.warn('Could not fetch best score:', err);
      }
    };
    fetchBest();
  }, [isOpen, user]);

  const ensureAudio = () => {
    try {
      if (!audioCtxRef.current) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtxRef.current = new AC();
      }
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
    } catch (err) {
      console.warn('Audio unavailable:', err);
    }
  };

  const tone = (freq, dur, type = 'square', vol = 0.12, delay = 0) => {
    if (!soundOnRef.current || !audioCtxRef.current) return;
    try {
      const t0 = audioCtxRef.current.currentTime + delay;
      const osc = audioCtxRef.current.createOscillator();
      const gain = audioCtxRef.current.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(audioCtxRef.current.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (err) {}
  };

  const fx = (name, n) => playSfx(audioCtxRef.current, soundOnRef.current, name, n);
  const sfxGood = (combo) => fx('tap', combo);
  const sfxGold = () => fx('gold');
  const sfxFrenzy = () => fx('frenzy');
  const sfxDecoy = () => fx('decoy');
  const sfxBad = () => tone(140, 0.25, 'sawtooth', 0.2, 0);
  const sfxMiss = () => tone(220, 0.15, 'triangle', 0.12, 0);
  const sfxNewBest = () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, 'triangle', 0.14, i * 0.13));
  const toggleSound = () => setSoundOn(prev => { setSoundMuted(prev); return !prev; });

  // Round-timing loop only -- no canvas, no continuous physics. Runs on rAF
  // (like the other two games) purely so spawn/expire timing stays smooth
  // and doesn't drift the way a chain of setTimeouts would.
  useEffect(() => {
    if (!isOpen) return;

    const music = createMusic(SONGS.grab);

    const state = {
      cellData: Array(GRID_SIZE).fill(null),
      elapsed: 0,
      lastTime: null,
      nextSpawnAt: 0,
      score: 0,
      lives: START_LIVES,
      combo: 0,
      scoreThrottle: 0,
      frenzyUntil: 0,
      frenzyOn: false,
      popId: 0,
      running: false,
      animFrameId: null
    };
    gameRef.current = state;

    function resetGame() {
      state.cellData = Array(GRID_SIZE).fill(null);
      state.elapsed = 0;
      state.lastTime = null;
      state.nextSpawnAt = 0.3;
      state.score = 0;
      state.lives = START_LIVES;
      state.combo = 0;
      state.scoreThrottle = 0;
      state.frenzyUntil = 0;
      state.frenzyOn = false;
      state.running = false;
      setFrenzy(false);
      setPops([]);
      setCells(state.cellData.slice());
      setScore(0);
      setLives(START_LIVES);
      setCombo(0);
      setTimerDisplay(String(ROUND_SECONDS).padStart(2, '0'));
      setIsUrgent(false);
    }

    async function endGame() {
      state.running = false;
      music.stop();
      // never above what the server will accept for a round of this length
      const finalScore = Math.min(state.score, Math.floor(100 * state.elapsed + 90));
      setFrenzy(false);
      setGameOver(true);
      setGameStarted(false);
      setScore(finalScore);
      sfxBad();

      const liveUser = userRef.current;
      if (!liveUser || !liveUser.id) return;

      try {
        const { data, error } = await supabase.rpc('claim_speed_grab_reward', { p_score: finalScore });
        if (!error && data) {
          setRewardMsg(data.message || null);
          if (data.goal_score) setWeekInfo({ week: data.week_score, goal: data.goal_score, bonus: data.goal_points });
          if (data.points_awarded > 0) {
            setUser(prev => prev ? ({ ...prev, points: data.total_points }) : prev);
          }
          if (data.is_best) {
            setIsNewBest(true);
            setBestScore(finalScore);
            sfxNewBest();
          }
        }
      } catch (err) {
        console.warn('Could not claim Speed Grab reward:', err);
      }

      try {
        const { data: rankData, error: rankError } = await supabase.rpc('get_user_rank');
        if (!rankError && rankData && rankData.rank) setRankInfo(rankData);
      } catch (err) {
        console.warn('Could not fetch rank:', err);
      }
    }

    function difficultyT() {
      return Math.min(1, state.elapsed / RAMP_SECONDS);
    }

    // 0 until LATE_START, then rises to 1 at the end of the round.
    function lateT() {
      return Math.max(0, Math.min(1, (state.elapsed - LATE_START) / (ROUND_SECONDS - LATE_START)));
    }

    function lerp(a, b, t) {
      return a + (b - a) * t;
    }

    function trySpawn() {
      const t = difficultyT();
      const inFrenzy = state.elapsed < state.frenzyUntil;
      const late = lateT();
      const spawnInterval = lerp(0.8, 0.32, t) * (1 - 0.18 * late) * (inFrenzy ? 0.65 : 1);
      if (state.elapsed < state.nextSpawnAt) return;

      const emptyIdx = state.cellData
        .map((c, i) => (c ? -1 : i))
        .filter(i => i >= 0);

      if (emptyIdx.length === 0) {
        state.nextSpawnAt = state.elapsed + 0.15;
        return;
      }

      const idx = emptyIdx[Math.floor(Math.random() * emptyIdx.length)];
      const badChance = lerp(0.18, 0.38, t) + 0.06 * late;
      const lifeMs = lerp(950, 480, t) * (1 - 0.15 * late);
      const variants = Object.keys(GOOD_ICONS);
      const pickVariant = () => variants[Math.floor(Math.random() * variants.length)];
      let type = 'good';
      let variant = pickVariant();
      if (Math.random() < badChance) {
        // From a quarter of the way in, some bad items are lookalikes of real food.
        type = t > 0.25 && Math.random() < 0.45 ? 'decoy' : 'bad';
        if (type === 'bad') variant = 'bad';
      } else if (t > 0.1 && Math.random() < GOLD_CHANCE) {
        type = 'gold';
        variant = 'gold';
      }
      state.cellData[idx] = {
        type,
        variant,
        bornAt: state.elapsed,
        lifeMs: (type === 'gold' ? lifeMs * 0.8 : lifeMs) / 1000
      };

      state.nextSpawnAt = state.elapsed + spawnInterval + Math.random() * 0.15;
      setCells(state.cellData.slice());
    }

    function expireCells() {
      let changed = false;
      let missed = false;
      for (let i = 0; i < GRID_SIZE; i++) {
        const cell = state.cellData[i];
        if (!cell) continue;
        if (state.elapsed - cell.bornAt > cell.lifeMs) {
          if (cell.type === 'good') {
            state.lives--;
            state.combo = 0;
            missed = true;
          }
          state.cellData[i] = null;
          changed = true;
        }
      }
      if (changed) setCells(state.cellData.slice());
      if (missed) {
        setLives(state.lives);
        setCombo(0);
        setMissFlash(true);
        sfxMiss();
        setTimeout(() => setMissFlash(false), 200);
        if (state.lives <= 0) endGame();
      }
    }

    function update(dt) {
      state.elapsed += dt;
      music.setBpm(lerp(128, 164, difficultyT()) + 8 * lateT());
      music.setIntensity(state.elapsed < state.frenzyUntil ? 1 : 0);
      trySpawn();
      expireCells();
      if (state.frenzyOn && state.elapsed >= state.frenzyUntil) {
        state.frenzyOn = false;
        setFrenzy(false);
      }

      state.scoreThrottle += dt;
      if (state.scoreThrottle >= 0.1) {
        state.scoreThrottle = 0;
        const timeLeft = Math.max(0, ROUND_SECONDS - state.elapsed);
        setTimerDisplay(String(Math.ceil(timeLeft)).padStart(2, '0'));
        setIsUrgent(timeLeft <= 5 && timeLeft > 0);
      }

      if (state.elapsed >= ROUND_SECONDS && state.running) {
        endGame();
      }
    }

    function loop(timestamp) {
      try {
        if (state.lastTime == null) state.lastTime = timestamp;
        const dt = Math.min((timestamp - state.lastTime) / 1000, 0.05);
        state.lastTime = timestamp;
        if (state.running) update(dt);
      } catch (err) {
        console.error('Speed Grab frame error:', err);
      }
      state.animFrameId = requestAnimationFrame(loop);
    }

    function addPop(i, text, gold) {
      const id = ++state.popId;
      setPops((prev) => [...prev, { id, i, text, gold }]);
      setTimeout(() => setPops((prev) => prev.filter((p) => p.id !== id)), 750);
    }

    function startFrenzy() {
      state.frenzyUntil = state.elapsed + FRENZY_SECONDS;
      state.frenzyOn = true;
      setFrenzy(true);
      sfxFrenzy();
    }

    function handleCellTap(i) {
      if (!state.running) return;
      const cell = state.cellData[i];
      if (!cell) return;

      if (cell.type === 'good' || cell.type === 'gold') {
        state.combo++;
        const multiplier = Math.min(4, 1 + Math.floor(state.combo / 5));
        const inFrenzy = state.elapsed < state.frenzyUntil;
        let gain;
        if (cell.type === 'gold') {
          gain = GOLD_POINTS;
          sfxGold();
          vibrate(soundOnRef.current, 15);
        } else {
          gain = Math.round(10 * multiplier * (inFrenzy ? FRENZY_BONUS : 1));
          sfxGood(state.combo);
        }
        state.score = Math.min(MAX_ROUND_SCORE, state.score + gain);
        addPop(i, `+${gain}`, cell.type === 'gold');
        if (state.combo % FRENZY_EVERY === 0) startFrenzy();
      } else {
        // a wrong order or a lookalike decoy
        state.score = Math.max(0, state.score - 20);
        state.combo = 0;
        state.lives--;
        if (cell.type === 'decoy') sfxDecoy(); else sfxBad();
        vibrate(soundOnRef.current, 40);
        addPop(i, '-20', false);
      }

      state.cellData[i] = null;
      setCells(state.cellData.slice());
      setScore(state.score);
      setCombo(state.combo);
      setLives(state.lives);

      if (state.lives <= 0) endGame();
    }
    gameRef.current.handleCellTap = handleCellTap;

    startSessionRef.current = async () => {
      resetGame();
      state.running = true;
      music.start(audioCtxRef.current, () => soundOnRef.current && state.running);
    };

    resetGame();
    loop();

    return () => {
      if (state.animFrameId) cancelAnimationFrame(state.animFrameId);
      music.stop();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePlayButtonClick = async () => {
    setRewardMsg(null);
    setWeekInfo(null);
    setIsNewBest(false);
    setRankInfo(null);
    ensureAudio();

    if (user) {
      try {
        await supabase.rpc('start_speed_grab_session');
      } catch (err) {
        console.error('Error starting Speed Grab session:', err);
      }
    }

    setGameOver(false);
    setScore(0);
    setGameStarted(true);
    if (startSessionRef.current) startSessionRef.current();
  };

  const handleCellClick = (i) => {
    if (gameRef.current && gameRef.current.handleCellTap) {
      gameRef.current.handleCellTap(i);
    }
  };

  const comboMultiplier = Math.min(4, 1 + Math.floor(combo / 5));

  return (
    <div className="grab-modal-overlay" onClick={onClose}>
      <div className="grab-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="grab-close-btn" onClick={onClose}>
          <X size={20} />
        </button>

        <div className="grab-container">
          <h1>Speed Grab</h1>

          <div className="grab-hud">
            <span>Score: {score}</span>
            <span className={isUrgent ? 'urgent-text' : ''}>{timerDisplay}s</span>
            {user && <span>Best: {bestScore}</span>}
          </div>

          <div className={`grab-board-wrap ${missFlash ? 'flash-miss' : ''} ${frenzy ? 'grab-frenzy-on' : ''}`}>
            <button className="grab-mute-btn" onClick={toggleSound} aria-label="Toggle sound">
              {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>

            <div className="grab-lives">
              {Array.from({ length: START_LIVES }).map((_, i) => (
                <Heart
                  key={i}
                  size={16}
                  fill={i < lives ? 'var(--ember)' : 'none'}
                  color={i < lives ? 'var(--ember)' : 'rgba(255,255,255,0.3)'}
                />
              ))}
            </div>

            {frenzy ? (
              <div className="grab-combo grab-frenzy-label">FRENZY! x{FRENZY_BONUS}</div>
            ) : combo >= 5 && (
              <div className="grab-combo">x{comboMultiplier} COMBO</div>
            )}

            <div className="grab-grid">
              {cells.map((cell, i) => (
                <button
                  key={i}
                  className={`grab-cell ${cell ? `grab-cell-${cell.type}` : ''}`}
                  onClick={() => handleCellClick(i)}
                  disabled={!gameStarted || gameOver}
                >
                  {cell && (cell.type === 'bad' ? '❌' : cell.type === 'gold' ? '⭐' : cell.type === 'decoy' ? DECOY_ICONS[cell.variant] : GOOD_ICONS[cell.variant])}
                  {pops.filter((p) => p.i === i).map((p) => (
                    <span key={p.id} className={`grab-pop ${p.gold ? 'grab-pop-gold' : ''}`}>{p.text}</span>
                  ))}
                </button>
              ))}
            </div>

            {(!gameStarted || gameOver) && (
              <div className="grab-overlay-screen">
                {!gameOver ? (
                  <>
                    <h2>Ready to Grab?</h2>
                    <p>Snacks and drinks flash across the counter -- tap the good ones before they vanish. Avoid the wrong orders (❌) and the red-edged lookalikes (🥪🥔🧃). Grab the rare ⭐ for a bonus and reach a 10 combo for FRENZY. 3 misses ends the round, or ride out {ROUND_SECONDS} seconds for the win.</p>
                    {user && bestScore > 0 && (
                      <p style={{ fontSize: 12, color: 'var(--munchies-yellow)', marginTop: -12 }}>Your Best: {bestScore}</p>
                    )}
                    <button className="grab-btn" onClick={handlePlayButtonClick}>
                      Play Now
                    </button>
                  </>
                ) : (
                  <>
                    <h2>{isNewBest ? '🎉 New Best!' : '⏰ Round Over'}</h2>
                    <p>Score: {score}{!isNewBest && user ? ` -- Best: ${bestScore}` : ''}</p>

                    {rewardMsg && (
                      <div style={{
                        background: 'rgba(255, 199, 44, 0.2)',
                        border: '1px solid var(--munchies-yellow)',
                        color: 'var(--munchies-yellow)',
                        padding: '8px 16px',
                        borderRadius: '8px',
                        fontWeight: 700,
                        fontSize: 14,
                        marginBottom: 12
                      }}>
                        <Trophy size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
                        {rewardMsg}
                      </div>
                    )}

                    {weekInfo && (
                      <p style={{ fontSize: 12, color: '#ccc', marginTop: 0, marginBottom: 10 }}>
                        Burger XP this week: <b>{Math.min(weekInfo.week, weekInfo.goal).toLocaleString()} / {weekInfo.goal.toLocaleString()}</b>
                        {weekInfo.week >= weekInfo.goal ? ' (goal reached!)' : ` · reach it for +${weekInfo.bonus} Monsta Coins`}
                      </p>
                    )}

                    {rankInfo && rankInfo.rank && (
                      <p style={{ fontSize: 13, color: 'var(--munchies-yellow)', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 0, marginBottom: 6 }}>
                        <Award size={14} /> You'd rank #{rankInfo.rank} of {rankInfo.total} (top {rankInfo.percentile}%)
                      </p>
                    )}

                    {!user && (
                      <p style={{ fontSize: 12, color: '#aaa', marginTop: 0, marginBottom: 16 }}>
                        Log in to save your score and join the arcade contest!
                      </p>
                    )}

                    <button className="grab-btn" onClick={handlePlayButtonClick}>
                      Play Again
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
