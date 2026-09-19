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
  const [activeEffects, setActiveEffects] = useState({ speed: 0, invincible: 0 });
  const [deathReason, setDeathReason] = useState(null);

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
  const sfxSmash = () => tone(300, 0.12, 'square', 0.16, 0);
  const sfxPowerupSpeed = () => [500, 700, 900].forEach((f, i) => tone(f, 0.08, 'sawtooth', 0.1, i * 0.05));
  const sfxPowerupInvincible = () => [400, 600, 800, 1000].forEach((f, i) => tone(f, 0.1, 'triangle', 0.12, i * 0.06));

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
    // Jump feel, take 2: the floaty 1.4s hang time was tuned back when
    // scroll speed was ~15-30px/s. Speed has since gone up ~4-6x (94/166
    // now) without the jump changing, so the same hang time now covers a
    // much larger, disproportionate horizontal distance (jumpDist = speed *
    // airtime), which is exactly what threw off obstacle/gap placement --
    // that math scales off jump distance. Snapping the jump back down to
    // ~0.8s hang time (apex height unchanged at ~110px, still clears the
    // raised tier) brings jump distance back in proportion to the current
    // pace.
    const GRAVITY = 1400;
    const JUMP_VELOCITY = -555;
    const PLAYER_X = 54;
    const PLAYER_W = 30;
    const PLAYER_H = 34;
    // Another explicit +20% on top of the last nudge (78/138 -> 94/166),
    // a further +13% requested on top of that (94/166 -> 106/188), and a
    // small +6% "tiny bit faster" nudge on top of that (106/188 -> 112/199).
    // SPEED_RAMP is slowed (not scaled proportionally) alongside it so the
    // climb from base to max takes noticeably longer in real time -- the
    // "make it faster AND make it last longer" request together mean less
    // ramp per second, not just a higher final speed.
    const BASE_SPEED = 112;
    const MAX_SPEED = 199;
    const SPEED_RAMP = 0.45;
    const TERRAIN_LOOKAHEAD = 260;
    // No obstacles or tier changes on the first few segments -- a clear
    // runway to get a feel for the controls before anything shows up.
    const GRACE_SEGMENTS = 4;
    // Minimum real-world spacing between obstacles regardless of how the
    // segment RNG lands, so back-to-back hazards can't stack into an
    // effectively unbeatable chain a couple of jumps in.
    const MIN_OBSTACLE_SPACING = 200;
    // Chance a given segment gets a burger, and how much clear room it
    // needs from any obstacle on that same segment (see ensureTerrain).
    const COLLECTIBLE_CHANCE = 0.55;
    const MIN_COLLECTIBLE_CLEARANCE = 45;
    const TREX_DRAW_W = PLAYER_W + 8;
    const TREX_DRAW_H = TREX_DRAW_W * (121 / 180);

    const trexImg = new Image();
    trexImg.src = '/images/Trex.png';

    // Sprite art for the new obstacle variety / power-ups / background --
    // each Image is checked for `.complete && naturalWidth > 0` before every
    // draw, so the game renders correctly (procedural fallback shapes) even
    // before these files exist or if one fails to load.
    const OBSTACLE_SPRITES = {
      pan: new Image(),
      crate: new Image(),
      bottle: new Image()
    };
    OBSTACLE_SPRITES.pan.src = '/images/trex_obstacle_pan.png';
    OBSTACLE_SPRITES.crate.src = '/images/trex_obstacle_crate.png';
    OBSTACLE_SPRITES.bottle.src = '/images/trex_obstacle_bottle.png';

    const POWERUP_SPRITES = {
      speed: new Image(),
      invincible: new Image()
    };
    POWERUP_SPRITES.speed.src = '/images/trex_powerup_speed.png';
    POWERUP_SPRITES.invincible.src = '/images/trex_powerup_shield.png';

    const bgImg = new Image();
    bgImg.src = '/images/trex_bg_kitchen.png';

    const OBSTACLE_VARIANTS = [
      { w: 22, h: 26, spriteKey: 'crate' },
      { w: 34, h: 20, spriteKey: 'pan' },
      { w: 18, h: 38, spriteKey: 'bottle' }
    ];

    // Power-up tuning: speed boost multiplies world-scroll speed (and so
    // score, which is distance-based) for a limited window; invincibility
    // lets obstacle hits be shrugged off for the same window. Neither
    // protects against a missed jump/pit fall or running into a raised
    // platform's side wall -- those are timing mistakes, not hazards, so
    // "invincible" only ever means "immune to obstacles".
    const POWERUP_DURATION = 6;
    const POWERUP_SPEED_MULTIPLIER = 1.5;
    const POWERUP_CHANCE = 0.1;
    const MIN_POWERUP_SPACING = 500;
    const OBSTACLE_SMASH_BONUS = 15;

    const state = {
      player: { y: LOW_Y - PLAYER_H, vy: 0, onGround: true },
      terrain: [],
      obstacles: [],
      collectibles: [],
      powerups: [],
      effects: [],
      distance: 0,
      score: 0,
      bonusScore: 0,
      burgersCollected: 0,
      speed: BASE_SPEED,
      elapsed: 0,
      scoreThrottle: 0,
      lastTime: null,
      segmentsGenerated: 0,
      lastObstacleRightEdge: -9999,
      lastPowerupRightEdge: -9999,
      speedBoostUntil: 0,
      invincibleUntil: 0,
      running: false,
      animFrameId: null
    };
    gameStateRef.current = state;

    // Difficulty ramps the platform layout (wider pits, more tier changes)
    // rather than relying on scroll speed alone to feel harder over time.
    // Cap raised from 6000 to 7800 alongside the slower SPEED_RAMP above --
    // both push "full difficulty" further out so an average run has more
    // breathing room before tier-change jumps get tight.
    function difficulty() {
      return Math.min(1, state.distance / 7800);
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

    // Shared placement math for anything that needs to land somewhere clear
    // of a same-segment obstacle (collectibles, power-ups): pick before the
    // obstacle if there's more room there, after it otherwise, or null if
    // neither side has minRoom+20 of clearance. Used to keep both spawn
    // kinds' clearance rules identical instead of drifting apart.
    function pickClearX(seg, placedObstacle, minRoom) {
      if (placedObstacle) {
        const roomBefore = placedObstacle.x - seg.xStart;
        const roomAfter = seg.xEnd - (placedObstacle.x + placedObstacle.w);
        if (roomBefore >= minRoom + 20 && roomBefore >= roomAfter) {
          return seg.xStart + 10 + Math.random() * (roomBefore - minRoom - 10);
        } else if (roomAfter >= minRoom + 20) {
          return placedObstacle.x + placedObstacle.w + minRoom + Math.random() * (roomAfter - minRoom - 10);
        }
        return null;
      }
      if (seg.xEnd - seg.xStart > 40) {
        return seg.xStart + 15 + Math.random() * (seg.xEnd - seg.xStart - 30);
      }
      return null;
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
        const inGrace = state.segmentsGenerated <= GRACE_SEGMENTS;
        const obstacleChance = 0.4 + difficulty() * 0.35;
        let placedObstacle = null;
        if (last && !inGrace && seg.xEnd - seg.xStart > 130 && Math.random() < obstacleChance) {
          const v = OBSTACLE_VARIANTS[Math.floor(Math.random() * OBSTACLE_VARIANTS.length)];
          const ox = seg.xStart + 34 + Math.random() * (seg.xEnd - seg.xStart - 68);
          if (ox - state.lastObstacleRightEdge >= MIN_OBSTACLE_SPACING) {
            placedObstacle = { x: ox, w: v.w, h: v.h, tierY: seg.y, spriteKey: v.spriteKey };
            state.obstacles.push(placedObstacle);
            state.lastObstacleRightEdge = ox + v.w;
          }
        }

        // Collectible for this segment, placed with real clearance from
        // any obstacle just placed on it. Previously burgers spawned on an
        // independent real-time timer with zero awareness of obstacle
        // positions, so a burger could land right in an obstacle's danger
        // zone -- reachable only by flying straight into the obstacle,
        // which isn't a real choice. Deciding both together here means a
        // burger only ever appears somewhere it can actually be grabbed
        // without risking the hit.
        if (last && Math.random() < COLLECTIBLE_CHANCE) {
          const hopHeight = 30 + Math.random() * 34;
          const cx = pickClearX(seg, placedObstacle, MIN_COLLECTIBLE_CLEARANCE);
          if (cx != null) {
            state.collectibles.push({ x: cx, y: seg.y - PLAYER_H - hopHeight, size: 9 });
          }
        }

        // Power-up: rarer than a burger, same clearance rule from any
        // obstacle on the segment, plus its own minimum world-space gap
        // from the last power-up so speed/invincibility pickups can't
        // cluster together.
        if (last && !inGrace && Math.random() < POWERUP_CHANCE) {
          const px = pickClearX(seg, placedObstacle, MIN_COLLECTIBLE_CLEARANCE);
          if (px != null && px - state.lastPowerupRightEdge >= MIN_POWERUP_SPACING) {
            const type = Math.random() < 0.5 ? 'speed' : 'invincible';
            state.powerups.push({ x: px, y: seg.y - PLAYER_H - 34, size: 11, type });
            state.lastPowerupRightEdge = px;
          }
        }
      }
    }

    function resetGame() {
      state.player = { y: LOW_Y - PLAYER_H, vy: 0, onGround: true };
      state.terrain = [];
      state.obstacles = [];
      state.collectibles = [];
      state.powerups = [];
      state.effects = [];
      state.distance = 0;
      state.score = 0;
      state.bonusScore = 0;
      state.burgersCollected = 0;
      state.speed = BASE_SPEED;
      state.elapsed = 0;
      state.scoreThrottle = 0;
      state.lastTime = null;
      state.segmentsGenerated = 0;
      state.lastObstacleRightEdge = -9999;
      state.lastPowerupRightEdge = -9999;
      state.speedBoostUntil = 0;
      state.invincibleUntil = 0;
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

    function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
      return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
    }

    async function endGame(reason) {
      state.running = false;
      sfxHit();

      const finalScore = state.score;
      const finalBurgers = state.burgersCollected;
      setGameOver(true);
      setGameStarted(false);
      setScore(finalScore);
      setBurgersCollected(finalBurgers);
      setDeathReason(reason);

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

      const speedBoostActive = state.elapsed < state.speedBoostUntil;
      const invincibleActive = state.elapsed < state.invincibleUntil;
      // The boost multiplies the *effective* scroll speed only -- state.speed
      // itself keeps ramping toward MAX_SPEED underneath it, so the game
      // returns to the normal ramped pace (not a compounded one) once the
      // boost window ends.
      const effectiveSpeed = speedBoostActive ? state.speed * POWERUP_SPEED_MULTIPLIER : state.speed;

      state.distance += effectiveSpeed * dt;
      // Score is distance + burger bonus + smashed-obstacle bonus (from
      // invincibility). Distance already accrues faster while boosted, so
      // that alone rewards the speed power-up without a separate multiplier.
      state.score = Math.floor(state.distance / 8) + state.burgersCollected * 5 + state.bonusScore;
      state.scoreThrottle += dt;
      if (state.scoreThrottle >= 0.1) {
        state.scoreThrottle = 0;
        setScore(state.score);
        setActiveEffects({
          speed: Math.max(0, state.speedBoostUntil - state.elapsed),
          invincible: Math.max(0, state.invincibleUntil - state.elapsed)
        });
      }

      // Scroll the world -- terrain, obstacles and collectibles all move
      // left in screen space, same approach the flat-runner version used
      // for obstacles, just now applied to platform segments too.
      const moveBy = effectiveSpeed * dt;
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
        endGame('wall');
        return;
      }

      state.player.onGround = landed;

      // Fell into a pit -- no platform under the player and they've
      // dropped past the bottom of the canvas.
      if (!landed && state.player.y > H) {
        endGame('pit');
        return;
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
          if (invincibleActive) {
            state.bonusScore += OBSTACLE_SMASH_BONUS;
            state.effects.push({ x: o.x + o.w / 2, y: obY + o.h / 2, ttl: 0.25 });
            sfxSmash();
            state.obstacles.splice(i, 1);
            continue;
          }
          endGame('obstacle');
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

      for (let i = state.powerups.length - 1; i >= 0; i--) {
        const p = state.powerups[i];
        p.x -= moveBy;
        if (p.x + p.size * 2 < 0) {
          state.powerups.splice(i, 1);
          continue;
        }
        if (overlap(hitboxX, hitboxY, hitboxW, hitboxH, p.x - p.size, p.y - p.size, p.size * 2, p.size * 2)) {
          if (p.type === 'speed') {
            state.speedBoostUntil = state.elapsed + POWERUP_DURATION;
            sfxPowerupSpeed();
          } else {
            state.invincibleUntil = state.elapsed + POWERUP_DURATION;
            sfxPowerupInvincible();
          }
          state.powerups.splice(i, 1);
        }
      }

      for (let i = state.effects.length - 1; i >= 0; i--) {
        const e = state.effects[i];
        e.x -= moveBy;
        e.ttl -= dt;
        if (e.ttl <= 0) state.effects.splice(i, 1);
      }
    }

    function drawBackground() {
      ctx.clearRect(0, 0, W, H);
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#242320');
      grad.addColorStop(1, '#1a1a1a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Parallax scenery, scrolling slower (0.3x) than the foreground so it
      // reads as background depth. No-op (just the gradient above) until
      // the art file exists or if it fails to load.
      if (bgImg.complete && bgImg.naturalWidth > 0) {
        const bh = H * 0.7;
        const bw = bgImg.naturalWidth * (bh / bgImg.naturalHeight);
        const offset = -(state.distance * 0.3) % bw;
        // Lowered from 0.5 -- the food-city art is busy enough at full
        // strength to camouflage small obstacle/pickup sprites in front of
        // it, which made some deaths look like they came from nowhere.
        ctx.globalAlpha = 0.38;
        for (let x = offset - bw; x < W; x += bw) {
          ctx.drawImage(bgImg, x, H - bh - 26, bw, bh);
        }
        ctx.globalAlpha = 1;
      }
    }

    function drawTerrain() {
      for (const seg of state.terrain) {
        const w = seg.xEnd - seg.xStart;
        if (w <= 0) continue;
        ctx.fillStyle = '#2c2924';
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
      // Dark contact shadow behind every obstacle regardless of sprite --
      // keeps hazards readable against the busy background art instead of
      // blending into it.
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(o.x + o.w / 2, y + o.h / 2, o.w * 0.68, o.h * 0.68, 0, 0, Math.PI * 2);
      ctx.fill();
      const sprite = OBSTACLE_SPRITES[o.spriteKey];
      if (sprite && sprite.complete && sprite.naturalWidth > 0) {
        ctx.drawImage(sprite, o.x, y, o.w, o.h);
        return;
      }
      ctx.fillStyle = '#c73b0f';
      ctx.beginPath();
      ctx.roundRect(o.x, y, o.w, o.h, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(o.x, y, o.w, 4);
    }

    function drawPowerup(p) {
      // Same readability aid as obstacles, plus a bit of glow since these
      // are worth actively chasing rather than just avoiding.
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 1.15, 0, Math.PI * 2);
      ctx.fill();
      const sprite = POWERUP_SPRITES[p.type];
      if (sprite && sprite.complete && sprite.naturalWidth > 0) {
        ctx.drawImage(sprite, p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
        return;
      }
      ctx.fillStyle = p.type === 'speed' ? '#3FA9E0' : '#FFD23F';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    function drawEffects() {
      for (const e of state.effects) {
        const alpha = Math.max(0, e.ttl / 0.25);
        ctx.strokeStyle = `rgba(255, 199, 44, ${alpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(e.x, e.y, (1 - alpha) * 20 + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
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
      const running = state.player.onGround && state.running;
      // Stride cycle standing in for a real run-cycle sprite sheet: a bob
      // synced with a small forward/back lean, both speeding up as the
      // world speed ramps. Deliberately not multiple AI-generated frames --
      // independent image generations of "the same character running"
      // don't reliably match each other in style/proportions, so swapping
      // between them would look worse than a single well-animated pose.
      const strideSpeed = 12 + (state.speed - BASE_SPEED) * 0.04;
      const phase = state.elapsed * strideSpeed;
      const bob = running ? Math.abs(Math.sin(phase)) * 3 : 0;
      const lean = running ? Math.sin(phase * 2) * 0.06 : 0;
      const invincibleActive = state.elapsed < state.invincibleUntil;

      ctx.save();
      ctx.translate(cx, cy - bob);
      if (invincibleActive) {
        ctx.shadowColor = 'rgba(255, 210, 63, 0.9)';
        ctx.shadowBlur = 14;
      }
      ctx.rotate(lean);
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
      state.powerups.forEach(drawPowerup);
      drawEffects();
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
    setActiveEffects({ speed: 0, invincible: 0 });
    setDeathReason(null);
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

            {(activeEffects.speed > 0 || activeEffects.invincible > 0) && (
              <div className="runner-powerup-badges">
                {activeEffects.speed > 0 && (
                  <span className="runner-badge runner-badge-speed">⚡ {activeEffects.speed.toFixed(1)}s</span>
                )}
                {activeEffects.invincible > 0 && (
                  <span className="runner-badge runner-badge-shield">🛡 {activeEffects.invincible.toFixed(1)}s</span>
                )}
              </div>
            )}

            {(!gameStarted || gameOver) && (
              <div className="runner-overlay-screen">
                {!gameOver ? (
                  <>
                    <h2>Ready to Run?</h2>
                    <p>Tap, click, or press Space to jump your T-Rex between raised platforms and over pits. Grab floating burgers for bonus points, ⚡ speed boosts to rack up distance fast, and 🛡 shields to smash through obstacles -- missing a jump still ends the run!</p>
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
                    {deathReason && (
                      <p style={{ fontSize: 12, color: '#aaa', marginTop: -10, marginBottom: 4 }}>
                        {deathReason === 'wall' && 'Ran into a platform mid-jump'}
                        {deathReason === 'pit' && 'Missed a jump into a pit'}
                        {deathReason === 'obstacle' && 'Hit an obstacle'}
                      </p>
                    )}

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
