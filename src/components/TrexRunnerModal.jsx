import { useEffect, useRef, useState } from 'react';
import { X, Volume2, VolumeX, Trophy, Award } from 'lucide-react';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import './TrexRunnerModal.css';

export default function TrexRunnerModal({ isOpen, onClose }) {
  const { user, setUser } = useAuth();
  const canvasRef = useRef(null);

  const [gameStarted, setGameStarted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [burgersCollected, setBurgersCollected] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  const [rewardMsg, setRewardMsg] = useState(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [rankInfo, setRankInfo] = useState(null);

  const gameStateRef = useRef(null);
  const audioCtxRef = useRef(null);
  const jumpRef = useRef(null);
  const startSessionRef = useRef(null);

  // Same stale-closure guard as MunchManModal: the game-loop effect only
  // re-runs on isOpen, so endGame's closure needs a live read of `user`.
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

  // Fetch the player's personal best for this game on open, so the ready
  // screen can show a goal and the game-over screen knows if this run is a
  // new record. Guests always see 0 -- their runs aren't saved server-side.
  useEffect(() => {
    if (!isOpen) return;
    const fetchBest = async () => {
      if (!user) {
        setBestScore(0);
        return;
      }
      try {
        const { data, error } = await supabase.rpc('get_trex_runner_best');
        if (!error && typeof data === 'number') setBestScore(data);
      } catch (err) {
        console.warn('Could not fetch best score:', err);
      }
    };
    fetchBest();
  }, [isOpen, user]);

  // Sound Utility Functions (Web Audio API) -- same lightweight approach as
  // MunchManModal, kept self-contained rather than shared to avoid touching
  // that component.
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
    if (!soundOn || !audioCtxRef.current) return;
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

  const sfxJump = () => tone(520, 0.09, 'square', 0.10, 0);
  const sfxCollect = () => tone(780, 0.06, 'square', 0.11, 0);
  const sfxHit = () => tone(140, 0.3, 'sawtooth', 0.2, 0);
  const sfxNewBest = () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, 'triangle', 0.14, i * 0.13));

  const toggleSound = () => setSoundOn(prev => !prev);

  // Setup Canvas & Game loop
  useEffect(() => {
    if (!isOpen) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const W = 408;
    const H = 200;
    canvas.width = W;
    canvas.height = H;

    const GROUND_Y = H - 26;
    const GRAVITY = 0.85;
    const JUMP_VELOCITY = -12.5;
    const PLAYER_X = 54;
    const PLAYER_W = 30;
    const PLAYER_H = 34;
    const BASE_SPEED = 3.2;
    const MAX_SPEED = 7.5;
    const SPEED_RAMP = 0.0006;
    const TREX_DRAW_W = PLAYER_W + 8;
    const TREX_DRAW_H = TREX_DRAW_W * (121 / 180);

    const trexImg = new Image();
    trexImg.src = '/images/Trex.png';

    const OBSTACLE_VARIANTS = [
      { w: 22, h: 26 },
      { w: 34, h: 20 },
      { w: 18, h: 38 }
    ];

    const state = {
      player: { y: GROUND_Y - PLAYER_H, vy: 0, onGround: true },
      obstacles: [],
      collectibles: [],
      distance: 0,
      score: 0,
      burgersCollected: 0,
      speed: BASE_SPEED,
      spawnTimer: 70,
      collectTimer: 130,
      frameCount: 0,
      running: false,
      animFrameId: null
    };
    gameStateRef.current = state;

    function resetGame() {
      state.player = { y: GROUND_Y - PLAYER_H, vy: 0, onGround: true };
      state.obstacles = [];
      state.collectibles = [];
      state.distance = 0;
      state.score = 0;
      state.burgersCollected = 0;
      state.speed = BASE_SPEED;
      state.spawnTimer = 70;
      state.collectTimer = 130;
      state.frameCount = 0;
      state.running = false;
    }

    function jump() {
      if (!state.running || !state.player.onGround) return;
      state.player.vy = JUMP_VELOCITY;
      state.player.onGround = false;
      sfxJump();
    }
    jumpRef.current = jump;

    function spawnObstacle() {
      const v = OBSTACLE_VARIANTS[Math.floor(Math.random() * OBSTACLE_VARIANTS.length)];
      state.obstacles.push({ x: W + 10, w: v.w, h: v.h });
    }

    function spawnCollectible() {
      const hopHeight = 34 + Math.random() * 26;
      state.collectibles.push({ x: W + 10, y: GROUND_Y - PLAYER_H - hopHeight, size: 9 });
    }

    function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
      return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
    }

    async function endGame() {
      state.running = false;
      sfxHit();

      const finalScore = state.score;
      const finalBurgers = state.burgersCollected;
      setGameOver(true);
      setGameStarted(false);
      setScore(finalScore);
      setBurgersCollected(finalBurgers);

      const liveUser = userRef.current;
      if (!liveUser || !liveUser.id) return;

      try {
        const { data, error } = await supabase.rpc('claim_trex_runner_reward', { p_score: finalScore });
        if (!error && data) {
          setRewardMsg(data.message || null);
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
        console.warn('Could not claim T-Rex Runner reward:', err);
      }

      try {
        const { data: rankData, error: rankError } = await supabase.rpc('get_user_rank');
        if (!rankError && rankData && rankData.rank) setRankInfo(rankData);
      } catch (err) {
        console.warn('Could not fetch rank:', err);
      }
    }

    function update() {
      state.frameCount++;
      state.speed = Math.min(MAX_SPEED, state.speed + SPEED_RAMP);
      state.distance += state.speed;
      state.score = Math.floor(state.distance / 8) + state.burgersCollected * 5;
      if (state.frameCount % 6 === 0) setScore(state.score);

      state.player.vy += GRAVITY;
      state.player.y += state.player.vy;
      const floorY = GROUND_Y - PLAYER_H;
      if (state.player.y >= floorY) {
        state.player.y = floorY;
        state.player.vy = 0;
        state.player.onGround = true;
      }

      state.spawnTimer--;
      if (state.spawnTimer <= 0) {
        spawnObstacle();
        state.spawnTimer = 60 + Math.random() * 50;
      }

      state.collectTimer--;
      if (state.collectTimer <= 0) {
        spawnCollectible();
        state.collectTimer = 150 + Math.random() * 120;
      }

      const hitboxX = PLAYER_X + 5;
      const hitboxW = PLAYER_W - 10;
      const hitboxY = state.player.y + 4;
      const hitboxH = PLAYER_H - 8;

      for (let i = state.obstacles.length - 1; i >= 0; i--) {
        const o = state.obstacles[i];
        o.x -= state.speed;
        if (o.x + o.w < 0) {
          state.obstacles.splice(i, 1);
          continue;
        }
        const obY = GROUND_Y - o.h;
        if (overlap(hitboxX, hitboxY, hitboxW, hitboxH, o.x, obY, o.w, o.h)) {
          endGame();
          return;
        }
      }

      for (let i = state.collectibles.length - 1; i >= 0; i--) {
        const c = state.collectibles[i];
        c.x -= state.speed;
        if (c.x + c.size * 2 < 0) {
          state.collectibles.splice(i, 1);
          continue;
        }
        if (overlap(hitboxX, hitboxY, hitboxW, hitboxH, c.x - c.size, c.y - c.size, c.size * 2, c.size * 2)) {
          state.burgersCollected++;
          sfxCollect();
          state.collectibles.splice(i, 1);
        }
      }
    }

    function drawBackground() {
      ctx.clearRect(0, 0, W, H);
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#1E293B');
      grad.addColorStop(1, '#0a0f1d');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = '#111827';
      ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
      ctx.strokeStyle = 'rgba(255, 199, 44, 0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, GROUND_Y);
      ctx.lineTo(W, GROUND_Y);
      ctx.stroke();

      const dashOffset = -(state.distance % 40);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 3;
      ctx.setLineDash([16, 24]);
      ctx.lineDashOffset = dashOffset;
      ctx.beginPath();
      ctx.moveTo(0, GROUND_Y + 10);
      ctx.lineTo(W, GROUND_Y + 10);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    function drawObstacle(o) {
      const y = GROUND_Y - o.h;
      ctx.fillStyle = '#C23B15';
      ctx.beginPath();
      ctx.roundRect(o.x, y, o.w, o.h, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(o.x, y, o.w, 4);
    }

    function drawMiniBurger(cx, cy, size) {
      ctx.fillStyle = '#C97A34';
      ctx.beginPath();
      ctx.roundRect(cx - size, cy + size * 0.15, size * 2, size * 0.55, size * 0.3);
      ctx.fill();
      ctx.fillStyle = '#6B3A1F';
      ctx.fillRect(cx - size * 0.95, cy - size * 0.15, size * 1.9, size * 0.4);
      ctx.fillStyle = '#E8A84F';
      ctx.beginPath();
      ctx.arc(cx, cy - size * 0.25, size, Math.PI, 0);
      ctx.fill();
    }

    function drawPlayer() {
      const cx = PLAYER_X + PLAYER_W / 2;
      const cy = state.player.y + PLAYER_H / 2;
      const bob = state.player.onGround && state.running ? Math.abs(Math.sin(state.frameCount / 6)) * 2 : 0;

      ctx.save();
      ctx.translate(cx, cy - bob);
      ctx.scale(-1, 1); // T-Rex sprite art faces left; flip so it runs facing right
      if (trexImg.complete && trexImg.naturalWidth > 0) {
        ctx.drawImage(trexImg, -TREX_DRAW_W / 2, -TREX_DRAW_H / 2, TREX_DRAW_W, TREX_DRAW_H);
      } else {
        ctx.fillStyle = '#FFC72C';
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    function draw() {
      drawBackground();
      state.obstacles.forEach(drawObstacle);
      state.collectibles.forEach(c => drawMiniBurger(c.x, c.y, c.size));
      drawPlayer();
    }

    function loop() {
      try {
        if (state.running) update();
        draw();
      } catch (err) {
        console.error('T-Rex Runner frame error:', err);
      }
      state.animFrameId = requestAnimationFrame(loop);
    }

    function handleKeyDown(e) {
      if (e.code === 'Space' || e.key === ' ' || e.key === 'ArrowUp') {
        e.preventDefault();
        jump();
      }
    }

    function handlePointerDown() {
      jump();
    }

    window.addEventListener('keydown', handleKeyDown);
    canvas.addEventListener('pointerdown', handlePointerDown);

    startSessionRef.current = async () => {
      resetGame();
      state.running = true;
    };

    resetGame();
    loop();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      if (state.animFrameId) cancelAnimationFrame(state.animFrameId);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePlayButtonClick = async () => {
    setRewardMsg(null);
    setIsNewBest(false);
    setRankInfo(null);
    setBurgersCollected(0);
    ensureAudio();

    if (user) {
      try {
        await supabase.rpc('start_trex_runner_session');
      } catch (err) {
        console.error('Error starting T-Rex Runner session:', err);
      }
    }

    setGameOver(false);
    setScore(0);
    setGameStarted(true);
    if (startSessionRef.current) startSessionRef.current();
  };

  return (
    <div className="runner-modal-overlay" onClick={onClose}>
      <div className="runner-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="runner-close-btn" onClick={onClose}>
          <X size={20} />
        </button>

        <div className="runner-container">
          <h1>T-Rex Runner</h1>

          <div className="runner-hud">
            <span>Score: {score}</span>
            {user && <span>Best: {bestScore}</span>}
          </div>

          <div className="runner-canvas-wrap">
            <button className="runner-mute-btn" onClick={toggleSound} aria-label="Toggle sound">
              {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>

            <canvas ref={canvasRef}></canvas>

            {(!gameStarted || gameOver) && (
              <div className="runner-overlay-screen">
                {!gameOver ? (
                  <>
                    <h2>Ready to Run?</h2>
                    <p>Tap, click, or press Space to jump your T-Rex over kitchen chaos. Grab floating burgers for bonus points -- one hit and it's game over!</p>
                    {user && bestScore > 0 && (
                      <p style={{ fontSize: 12, color: 'var(--munchies-yellow)', marginTop: -12 }}>Your Best: {bestScore}</p>
                    )}
                    <button className="runner-btn" onClick={handlePlayButtonClick}>
                      Play Now
                    </button>
                  </>
                ) : (
                  <>
                    <h2>{isNewBest ? '🎉 New Best!' : '💥 Game Over'}</h2>
                    <p>Score: {score}{!isNewBest && user ? ` -- Best: ${bestScore}` : ''}</p>

                    {burgersCollected > 0 && (
                      <div style={{ fontSize: 12, color: '#ccc', marginBottom: 10 }}>
                        🍔 x{burgersCollected} collected
                      </div>
                    )}

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

                    {rankInfo && rankInfo.rank && (
                      <p style={{ fontSize: 13, color: 'var(--munchies-yellow)', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 0, marginBottom: 6 }}>
                        <Award size={14} /> You'd rank #{rankInfo.rank} of {rankInfo.total} (top {rankInfo.percentile}%)
                      </p>
                    )}

                    {!user && (
                      <p style={{ fontSize: 12, color: '#aaa', marginTop: 0, marginBottom: 16 }}>
                        Log in to save your best score and earn loyalty points!
                      </p>
                    )}

                    <button className="runner-btn" onClick={handlePlayButtonClick}>
                      Play Again
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <button
            className="runner-jump-btn"
            onClick={() => jumpRef.current && jumpRef.current()}
          >
            TAP TO JUMP
          </button>
        </div>
      </div>
    </div>
  );
}
