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

    // Two platform tiers instead of one flat lane -- LOW is the original
    // ground height, HIGH is a raised platform the player has to actually
    // jump up onto. Gaps between segments are real pits: no segment under
    // you when you fall past the canvas bottom ends the run.
    const LOW_Y = H - 26;
    const HIGH_Y = LOW_Y - 62;
    // All of the below are in px/second (and px/second^2 for acceleration),
    // not px/frame -- update() multiplies by the real elapsed time each
    // frame (see loop()), so the game runs the same real-world speed
    // regardless of the device's refresh rate.
    //
    // Jump feel: direct feedback was that the jump itself felt rushed, not
    // just the scroll. Halving JUMP_VELOCITY and quartering GRAVITY from the
    // previous pass doubles hang time (0.7s -> 1.4s) while keeping the same
    // apex height (~110px, still comfortably clears the raised tier) --
    // same peak, much gentler launch and much longer float.
    const GRAVITY = 450;
    const JUMP_VELOCITY = -315;
    const PLAYER_X = 54;
    const PLAYER_W = 30;
    const PLAYER_H = 34;
    // Brought back up a bit from the last pass -- that cut (15/26) plus the
    // low obstacle chance below combined to make hazards take 80+ real
    // seconds to show up at all, which read as "too slow" and "no
    // obstacles" even though gaps (unavoidable at every segment boundary)
    // kept appearing the whole time.
    const BASE_SPEED = 22;
    const MAX_SPEED = 38;
    const SPEED_RAMP = 0.11;
    const TERRAIN_LOOKAHEAD = 260;
    // No obstacles or tier changes on the first few segments -- a clear
    // runway to get a feel for the controls before anything shows up.
    const GRACE_SEGMENTS = 4;
    // Minimum real-world spacing between obstacles regardless of how the
    // segment RNG lands, so back-to-back hazards can't stack into an
    // effectively unbeatable chain a couple of jumps in.
    const MIN_OBSTACLE_SPACING = 200;
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
      player: { y: LOW_Y - PLAYER_H, vy: 0, onGround: true },
      terrain: [],
      obstacles: [],
      collectibles: [],
      distance: 0,
      score: 0,
      burgersCollected: 0,
      speed: BASE_SPEED,
      collectTimer: 2.2,
      elapsed: 0,
      scoreThrottle: 0,
      lastTime: null,
      segmentsGenerated: 0,
      lastObstacleRightEdge: -9999,
      running: false,
      animFrameId: null
    };
    gameStateRef.current = state;

    // Difficulty ramps the platform layout (wider pits, more tier changes)
    // rather than relying on scroll speed alone to feel harder over time.
    function difficulty() {
      return Math.min(1, state.distance / 6000);
    }

    function maxJumpDistance() {
      const airTime = (2 * Math.abs(JUMP_VELOCITY)) / GRAVITY;
      return state.speed * airTime;
    }

    // Builds the next platform segment after the given x, optionally
    // changing tier, with a gap sized to always be clearable at the
    // current speed (scaled down for a tier-up jump, which needs less
    // forward distance than a same-height jump).
    function nextSegment(afterX, prevTier) {
      const diff = difficulty();
      const jumpDist = maxJumpDistance();
      const inGrace = state.segmentsGenerated < GRACE_SEGMENTS;
      const changeTierChance = inGrace ? 0 : 0.14 + diff * 0.18;
      const nextTier = Math.random() < changeTierChance
        ? (prevTier === 'low' ? 'high' : 'low')
        : prevTier;

      const gapFrac = nextTier === prevTier
        ? 0.4 + Math.random() * (0.3 + diff * 0.1)
        : 0.22 + Math.random() * 0.28;
      const gap = Math.max(36, jumpDist * gapFrac);
      const segW = 110 + Math.random() * 140;
      const xStart = afterX + gap;
      const xEnd = xStart + segW;

      return { xStart, xEnd, tier: nextTier, y: nextTier === 'high' ? HIGH_Y : LOW_Y };
    }

    function ensureTerrain() {
      while (state.terrain.length === 0 || state.terrain[state.terrain.length - 1].xEnd < W + TERRAIN_LOOKAHEAD) {
        const last = state.terrain[state.terrain.length - 1];
        const seg = last ? nextSegment(last.xEnd, last.tier) : { xStart: -20, xEnd: W * 0.65, tier: 'low', y: LOW_Y };
        state.terrain.push(seg);
        state.segmentsGenerated++;

        // Occasionally drop an obstacle onto a fresh segment (skip the
        // starting segment, the grace window, and anything too narrow to
        // place one fairly). Chance ramps with difficulty instead of being
        // flat, and a minimum real-world spacing from the last obstacle
        // stops back-to-back hazards from stacking into an unfair chain
        // regardless of how the per-segment RNG lands.
        //
        // Previous values (12% -> 50%) were too low -- combined with the
        // slower speed from the last pass, obstacles took 80+ real seconds
        // to show up at all, which read as "no obstacles, just holes."
        const inGrace = state.segmentsGenerated <= GRACE_SEGMENTS;
        const obstacleChance = 0.4 + difficulty() * 0.35;
        if (last && !inGrace && seg.xEnd - seg.xStart > 130 && Math.random() < obstacleChance) {
          const v = OBSTACLE_VARIANTS[Math.floor(Math.random() * OBSTACLE_VARIANTS.length)];
          const ox = seg.xStart + 34 + Math.random() * (seg.xEnd - seg.xStart - 68);
          if (ox - state.lastObstacleRightEdge >= MIN_OBSTACLE_SPACING) {
            state.obstacles.push({ x: ox, w: v.w, h: v.h, tierY: seg.y });
            state.lastObstacleRightEdge = ox + v.w;
          }
        }
      }
    }

    function resetGame() {
      state.player = { y: LOW_Y - PLAYER_H, vy: 0, onGround: true };
      state.terrain = [];
      state.obstacles = [];
      state.collectibles = [];
      state.distance = 0;
      state.score = 0;
      state.burgersCollected = 0;
      state.speed = BASE_SPEED;
      state.collectTimer = 2.2;
      state.elapsed = 0;
      state.scoreThrottle = 0;
      state.lastTime = null;
      state.segmentsGenerated = 0;
      state.lastObstacleRightEdge = -9999;
      state.running = false;
      ensureTerrain();
    }

    function jump() {
      if (!state.running || !state.player.onGround) return;
      state.player.vy = JUMP_VELOCITY;
      state.player.onGround = false;
      sfxJump();
    }
    jumpRef.current = jump;

    function spawnCollectible() {
      const lastTierY = state.terrain.length > 0 ? state.terrain[state.terrain.length - 1].y : LOW_Y;
      const hopHeight = 30 + Math.random() * 34;
      state.collectibles.push({ x: W + TERRAIN_LOOKAHEAD, y: lastTierY - PLAYER_H - hopHeight, size: 9 });
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

    function update(dt) {
      state.elapsed += dt;
      state.speed = Math.min(MAX_SPEED, state.speed + SPEED_RAMP * dt);
      state.distance += state.speed * dt;
      state.score = Math.floor(state.distance / 8) + state.burgersCollected * 5;
      state.scoreThrottle += dt;
      if (state.scoreThrottle >= 0.1) {
        state.scoreThrottle = 0;
        setScore(state.score);
      }

      // Scroll the world -- terrain, obstacles and collectibles all move
      // left in screen space, same approach the flat-runner version used
      // for obstacles, just now applied to platform segments too.
      const moveBy = state.speed * dt;
      for (const seg of state.terrain) {
        seg.xStart -= moveBy;
        seg.xEnd -= moveBy;
      }
      state.terrain = state.terrain.filter(seg => seg.xEnd > -5);
      ensureTerrain();

      const prevBottom = state.player.y + PLAYER_H;
      state.player.vy += GRAVITY * dt;
      state.player.y += state.player.vy * dt;
      const newBottom = state.player.y + PLAYER_H;

      const centerX = PLAYER_X + PLAYER_W / 2;
      let landed = false;
      let hitWall = false;
      for (const seg of state.terrain) {
        if (centerX >= seg.xStart && centerX <= seg.xEnd) {
          if (newBottom >= seg.y) {
            if (prevBottom <= seg.y + 1) {
              state.player.y = seg.y - PLAYER_H;
              state.player.vy = 0;
              landed = true;
            } else {
              hitWall = true;
            }
          }
          break;
        }
      }

      if (hitWall) {
        endGame();
        return;
      }

      state.player.onGround = landed;

      // Fell into a pit -- no platform under the player and they've
      // dropped past the bottom of the canvas.
      if (!landed && state.player.y > H) {
        endGame();
        return;
      }

      state.collectTimer -= dt;
      if (state.collectTimer <= 0) {
        spawnCollectible();
        state.collectTimer = 2.5 + Math.random() * 2;
      }

      const hitboxX = PLAYER_X + 5;
      const hitboxW = PLAYER_W - 10;
      const hitboxY = state.player.y + 4;
      const hitboxH = PLAYER_H - 8;

      for (let i = state.obstacles.length - 1; i >= 0; i--) {
        const o = state.obstacles[i];
        o.x -= moveBy;
        if (o.x + o.w < 0) {
          state.obstacles.splice(i, 1);
          continue;
        }
        const obY = o.tierY - o.h;
        if (overlap(hitboxX, hitboxY, hitboxW, hitboxH, o.x, obY, o.w, o.h)) {
          endGame();
          return;
        }
      }

      for (let i = state.collectibles.length - 1; i >= 0; i--) {
        const c = state.collectibles[i];
        c.x -= moveBy;
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
    }

    function drawTerrain() {
      for (const seg of state.terrain) {
        const w = seg.xEnd - seg.xStart;
        if (w <= 0) continue;
        ctx.fillStyle = '#111827';
        ctx.fillRect(seg.xStart, seg.y, w, H - seg.y);
        ctx.strokeStyle = 'rgba(255, 199, 44, 0.4)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(seg.xStart, seg.y);
        ctx.lineTo(seg.xEnd, seg.y);
        ctx.stroke();

        const dashOffset = -(state.distance % 40);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 3;
        ctx.setLineDash([16, 24]);
        ctx.lineDashOffset = dashOffset;
        ctx.beginPath();
        ctx.moveTo(seg.xStart, seg.y + 10);
        ctx.lineTo(seg.xEnd, seg.y + 10);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    function drawObstacle(o) {
      const y = o.tierY - o.h;
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
      const bob = state.player.onGround && state.running ? Math.abs(Math.sin(state.elapsed * 10)) * 2 : 0;

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
      drawTerrain();
      state.obstacles.forEach(drawObstacle);
      state.collectibles.forEach(c => drawMiniBurger(c.x, c.y, c.size));
      drawPlayer();
    }

    function loop(timestamp) {
      try {
        if (state.lastTime == null) state.lastTime = timestamp;
        // Cap dt so a paused/backgrounded tab (or a slow device hiccup)
        // doesn't dump a huge time jump into physics on the next frame --
        // without this, resuming after a few seconds away could tunnel the
        // player straight through a platform or obstacle.
        const dt = Math.min((timestamp - state.lastTime) / 1000, 0.05);
        state.lastTime = timestamp;
        if (state.running) update(dt);
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
                    <p>Tap, click, or press Space to jump your T-Rex between raised platforms and over pits. Grab floating burgers for bonus points -- missing a jump or hitting an obstacle ends the run!</p>
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
