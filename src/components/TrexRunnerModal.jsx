import { useEffect, useRef, useState } from 'react';
import { X, Volume2, VolumeX, Trophy, Award } from 'lucide-react';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import { STAGES, stageIndexForScore, drawSky, drawScenery, drawHazard } from './trexStages';
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
  const [activeEffects, setActiveEffects] = useState({ speed: 0, invincible: 0, magnet: 0 });
  const [deathReason, setDeathReason] = useState(null);
  const [stageIdx, setStageIdx] = useState(0);
  // Optional "learn about this place" card: a chip appears when a new stage
  // starts; tapping it pauses the run, closing the card gives a 3-2-1 resume.
  const [infoChip, setInfoChip] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [lives, setLives] = useState(3);
  const [countdown, setCountdown] = useState(null);
  const pauseRef = useRef(null);
  const resumeRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const chipTimerRef = useRef(null);

  const gameStateRef = useRef(null);
  const audioCtxRef = useRef(null);
  const jumpRef = useRef(null);
  const startSessionRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      setInfoOpen(false);
      setCountdown(null);
      setInfoChip(null);
    }
    return () => {
      clearInterval(countdownTimerRef.current);
      clearTimeout(chipTimerRef.current);
    };
  }, [isOpen]);

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
  const sfxStage = () => [440, 554, 659, 880].forEach((f, i) => tone(f, 0.12, 'triangle', 0.13, i * 0.07));
  const sfxPowerupMagnet = () => [600, 450, 600, 800].forEach((f, i) => tone(f, 0.07, 'square', 0.1, i * 0.05));
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
    const MID_Y = LOW_Y - 32;
    const HIGH_Y = LOW_Y - 62;
    const TIER_Y = { low: LOW_Y, mid: MID_Y, high: HIGH_Y };
    // Lava / water sits this far below the road surface so a gap reads as a drop.
    const HAZARD_DROP = 11;
    const HAZARD_Y = LOW_Y + HAZARD_DROP;
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
    const COLLECTIBLE_CHANCE = 0.6;
    const MIN_COLLECTIBLE_CLEARANCE = 45;
    const TREX_DRAW_W = PLAYER_W + 8;
    const TREX_DRAW_H = TREX_DRAW_W * (121 / 180);
    // Feet sit at 105/121 of the sprite height (the rest is transparent).
    const TREX_FEET_FRAC = 105 / 121;

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

    const OBSTACLE_VARIANTS = [
      { w: 22, h: 26, spriteKey: 'crate' },
      { w: 34, h: 20, spriteKey: 'pan' },
      { w: 18, h: 38, spriteKey: 'bottle' },
      // two stacked crates: too tall for a hop, needs a held jump
      { w: 22, h: 52, spriteKey: 'crate', stack: 2, tall: true }
    ];

    // Power-up tuning: speed boost multiplies world-scroll speed (and so
    // score, which is distance-based) for a limited window; invincibility
    // lets obstacle hits be shrugged off for the same window. Neither
    // protects against a missed jump/pit fall or running into a raised
    // platform's side wall -- those are timing mistakes, not hazards, so
    // "invincible" only ever means "immune to obstacles".
    const POWERUP_DURATION = 6;
    const POWERUP_SPEED_MULTIPLIER = 1.5;
    const POWERUP_CHANCE = 0.3;
    const MIN_POWERUP_SPACING = 380;
    // Three lives: a crash costs one and the run continues from solid ground
    // with a short grace period; the run ends on the third.
    const START_LIVES = 3;
    const RESPAWN_GRACE = 2.2;
    const MAGNET_RADIUS = 120;
    const MAGNET_PULL = 320;
    const OBSTACLE_SMASH_BONUS = 15;

    // Variable-height jump: pressing jumps immediately at full power, and
    // letting go while still rising cuts the jump short. A full hold is the
    // original jump, so every gap the terrain generator makes is still
    // clearable; a quick tap is a hop (about half height). Jump buffering
    // (a press just before landing still counts) and coyote time (a short
    // grace after running off an edge) keep it feeling fair.
    const JUMP_CUT = 0.5;
    const JUMP_CUT_MIN_RISE = -170;
    const COYOTE_TIME = 0.1;
    const JUMP_BUFFER = 0.12;
    // Full difficulty is reached at the start of the Tanjung Aru stage, and
    // the final stage adds a bit more on top.
    const DIFFICULTY_FULL_DISTANCE = 12000;

    const state = {
      player: { y: LOW_Y - PLAYER_H, vy: 0, onGround: true, coyote: 0 },
      holding: false,
      jumpBuffer: 0,
      jumpCutApplied: false,
      stageIdx: 0,
      prevStageIdx: 0,
      stageBlend: 1,
      stageBannerUntil: 0,
      paused: false,
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
      magnetUntil: 0,
      lives: START_LIVES,
      graceUntil: 0,
      scoreAdjust: 0,
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
      return Math.min(1, state.distance / DIFFICULTY_FULL_DISTANCE);
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
      // Tiers step one level at a time (low <-> mid <-> high), so each step
      // is a small climb a quick hop can manage; only the higher jumps and
      // wider pits need a full hold.
      let nextTier = prevTier;
      if (Math.random() < changeTierChance) {
        if (prevTier === 'low') nextTier = 'mid';
        else if (prevTier === 'high') nextTier = 'mid';
        else nextTier = Math.random() < 0.5 ? 'low' : 'high';
      }

      const gapFrac = nextTier === prevTier
        ? 0.4 + Math.random() * (0.3 + diff * 0.1)
        : 0.22 + Math.random() * 0.28;
      const gap = Math.max(36, jumpDist * gapFrac);
      const segW = 110 + Math.random() * 140;
      const xStart = afterX + gap;
      const xEnd = xStart + segW;

      return { xStart, xEnd, tier: nextTier, y: TIER_Y[nextTier] };
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
        const obstacleChance = 0.4 + difficulty() * 0.25 + (STAGES[state.stageIdx].final ? 0.08 : 0);
        let placedObstacle = null;
        if (last && !inGrace && seg.xEnd - seg.xStart > 130 && Math.random() < obstacleChance) {
          // Tall stacked crates only show up once the run is under way, and
          // never on a raised tier (the climb plus the stack would be unfair).
          const allowTall = difficulty() > 0.12 && seg.tier === 'low';
          const pool = OBSTACLE_VARIANTS.filter((o) => allowTall || !o.tall);
          const v = pool[Math.floor(Math.random() * pool.length)];
          const ox = seg.xStart + 34 + Math.random() * (seg.xEnd - seg.xStart - 68);
          if (ox - state.lastObstacleRightEdge >= MIN_OBSTACLE_SPACING) {
            placedObstacle = { x: ox, w: v.w, h: v.h, tierY: seg.y, spriteKey: v.spriteKey, stack: v.stack || 1 };
            state.obstacles.push(placedObstacle);
            state.lastObstacleRightEdge = ox + v.w;
          }
        }

        // Burgers over the pit just before this segment: a small arc above the
        // lava/water, so the jump across is the way to collect them.
        let placedCollectible = false;
        const gapStart = last ? last.xEnd : 0;
        const gapWidth = last ? seg.xStart - gapStart : 0;
        if (last && !inGrace && gapWidth >= 40 && Math.random() < 0.75) {
          const n = gapWidth > 95 ? 3 : gapWidth > 60 ? 2 : 1;
          const base = Math.min(last.y, seg.y) - PLAYER_H;
          const heights = n === 1 ? [46] : n === 2 ? [44, 44] : [38, 54, 38];
          for (let k = 0; k < n; k++) {
            const gx = gapStart + (gapWidth * (k + 1)) / (n + 1);
            state.collectibles.push({ x: gx, y: base - heights[k], size: 9 });
          }
          placedCollectible = true;
        }

        // Burgers on the road: a mix of singles, pairs and the odd arc of
        // three, at varied heights, never in an obstacle's danger zone. Every
        // wide stretch past the warm-up still gets something.
        const roll = Math.random();
        const wantsBurger = last && (roll < COLLECTIBLE_CHANCE || (!inGrace && !placedObstacle && !placedCollectible && seg.xEnd - seg.xStart > 130));
        if (wantsBurger) {
          const hopHeight = 26 + Math.random() * 44;
          const cx = pickClearX(seg, placedObstacle, MIN_COLLECTIBLE_CLEARANCE);
          if (cx != null) {
            const room = seg.xEnd - cx - 12;
            const pick = Math.random();
            const count = room >= 60 && pick < 0.15 ? 3 : room >= 40 && pick < 0.4 ? 2 : 1;
            for (let k = 0; k < count; k++) {
              const lift = count === 3 ? [0, 12, 0][k] : count === 2 ? k * 8 : 0;
              state.collectibles.push({ x: cx + k * 24, y: seg.y - PLAYER_H - hopHeight - lift, size: 9 });
            }
            placedCollectible = true;
          }
        }
        // Safety net: if nothing fit, drop a single burger mid-segment.
        if (!inGrace && last && !placedObstacle && !placedCollectible && seg.xEnd - seg.xStart > 60) {
          state.collectibles.push({ x: (seg.xStart + seg.xEnd) / 2, y: seg.y - PLAYER_H - 36, size: 9 });
        }

        // Power-up: rarer than a burger, same clearance rule from any
        // obstacle on the segment, plus its own minimum world-space gap
        // from the last power-up so speed/invincibility pickups can't
        // cluster together.
        if (last && !inGrace && Math.random() < POWERUP_CHANCE) {
          const px = pickClearX(seg, placedObstacle, MIN_COLLECTIBLE_CLEARANCE);
          if (px != null && px - state.lastPowerupRightEdge >= MIN_POWERUP_SPACING) {
            const r = Math.random();
            const type = r < 0.34 ? 'speed' : r < 0.68 ? 'invincible' : 'magnet';
            state.powerups.push({ x: px, y: seg.y - PLAYER_H - 34, size: 11, type });
            state.lastPowerupRightEdge = px;
          }
        }
      }
    }

    function resetGame() {
      state.player = { y: LOW_Y - PLAYER_H, vy: 0, onGround: true, coyote: 0 };
      state.holding = false;
      state.jumpBuffer = 0;
      state.jumpCutApplied = false;
      state.stageIdx = 0;
      state.prevStageIdx = 0;
      state.stageBlend = 1;
      state.stageBannerUntil = 0;
      state.paused = false;
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
      state.magnetUntil = 0;
      state.lives = START_LIVES;
      state.graceUntil = 0;
      state.scoreAdjust = 0;
      state.running = false;
      ensureTerrain();
    }

    function startJump() {
      state.player.vy = JUMP_VELOCITY;
      state.player.onGround = false;
      state.player.coyote = 0;
      state.jumpBuffer = 0;
      state.jumpCutApplied = false;
      sfxJump();
    }

    function jump() {
      if (!state.running) return;
      state.holding = true;
      if (state.player.onGround || state.player.coyote > 0) {
        startJump();
      } else {
        state.jumpBuffer = JUMP_BUFFER;
      }
    }

    function releaseJump() {
      state.holding = false;
      if (!state.player.onGround && !state.jumpCutApplied && state.player.vy < JUMP_CUT_MIN_RISE) {
        state.player.vy *= JUMP_CUT;
        state.jumpCutApplied = true;
      }
    }
    jumpRef.current = jump;
    pauseRef.current = () => {
      if (!state.running) return false;
      state.running = false;
      state.paused = true;
      state.holding = false;
      return true;
    };
    resumeRef.current = () => {
      if (!state.paused) return;
      state.paused = false;
      state.running = true;
    };

    // Lose a life. With lives left the run carries on from solid ground (the
    // world skips ahead past a pit or obstacle) with a short grace period.
    function crash(reason) {
      state.lives -= 1;
      if (state.lives <= 0) {
        setLives(0);
        endGame(reason);
        return;
      }
      setLives(state.lives);
      sfxHit();
      const cx = PLAYER_X + PLAYER_W / 2;
      // a segment with room under the runner, else the next one ahead
      let target = state.terrain.find((sg) => sg.xStart + 10 <= cx && sg.xEnd - cx > 70);
      let shift = 0;
      if (!target) {
        target = state.terrain.find((sg) => sg.xStart > cx - 10 && sg.xEnd - sg.xStart > 60);
        if (target) shift = target.xStart + 20 - cx;
      }
      if (!target) target = state.terrain[0];
      if (shift > 0) {
        for (const sg of state.terrain) { sg.xStart -= shift; sg.xEnd -= shift; }
        for (const o of state.obstacles) o.x -= shift;
        for (const c of state.collectibles) c.x -= shift;
        for (const q of state.powerups) q.x -= shift;
        for (const e of state.effects) e.x -= shift;
        state.lastObstacleRightEdge -= shift;
        state.lastPowerupRightEdge -= shift;
        // keep the scenery moving, but the skipped stretch earns no score
        state.distance += shift;
        state.scoreAdjust -= shift;
      }
      // clear a little runway so the respawn is not on top of a hazard
      state.obstacles = state.obstacles.filter((o) => o.x > cx + 110 || o.x + o.w < cx - 40);
      state.player.y = target.y - PLAYER_H;
      state.player.vy = 0;
      state.player.onGround = true;
      state.player.coyote = COYOTE_TIME;
      state.holding = false;
      state.jumpBuffer = 0;
      state.graceUntil = state.elapsed + RESPAWN_GRACE;
    }

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
      const shieldActive = state.elapsed < state.invincibleUntil;
      const graceActive = state.elapsed < state.graceUntil;
      const invincibleActive = shieldActive || graceActive;
      // The boost multiplies the *effective* scroll speed only -- state.speed
      // itself keeps ramping toward MAX_SPEED underneath it, so the game
      // returns to the normal ramped pace (not a compounded one) once the
      // boost window ends.
      const effectiveSpeed = speedBoostActive ? state.speed * POWERUP_SPEED_MULTIPLIER : state.speed;

      state.distance += effectiveSpeed * dt;
      // Score is distance + burger bonus + smashed-obstacle bonus (from
      // invincibility). Distance already accrues faster while boosted, so
      // that alone rewards the speed power-up without a separate multiplier.
      state.score = Math.floor((state.distance + state.scoreAdjust) / 8) + state.burgersCollected * 5 + state.bonusScore;
      const nextStage = stageIndexForScore(state.score);
      if (nextStage !== state.stageIdx) {
        state.prevStageIdx = state.stageIdx;
        state.stageIdx = nextStage;
        state.stageBlend = 0;
        state.stageBannerUntil = state.elapsed + 2.6;
        sfxStage();
        setStageIdx(nextStage);
        setInfoChip(nextStage);
        clearTimeout(chipTimerRef.current);
        chipTimerRef.current = setTimeout(() => setInfoChip((c) => (c === nextStage ? null : c)), 4500);
      }
      if (state.stageBlend < 1) state.stageBlend = Math.min(1, state.stageBlend + dt / 1.5);
      state.jumpBuffer = Math.max(0, state.jumpBuffer - dt);
      state.scoreThrottle += dt;
      if (state.scoreThrottle >= 0.1) {
        state.scoreThrottle = 0;
        setScore(state.score);
        setActiveEffects({
          speed: Math.max(0, state.speedBoostUntil - state.elapsed),
          invincible: Math.max(0, state.invincibleUntil - state.elapsed),
          magnet: Math.max(0, state.magnetUntil - state.elapsed)
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
      // The spacing markers live in screen space, so they scroll with the world.
      state.lastObstacleRightEdge -= moveBy;
      state.lastPowerupRightEdge -= moveBy;
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

      if (hitWall && invincibleActive) {
        // The shield lifts the runner up onto the platform instead of ending the run.
        const seg = state.terrain.find((sg) => centerX >= sg.xStart && centerX <= sg.xEnd);
        if (seg) {
          state.player.y = seg.y - PLAYER_H;
          state.player.vy = 0;
          landed = true;
          hitWall = false;
        }
      }
      if (hitWall) {
        crash('wall');
        return;
      }

      state.player.onGround = landed;
      if (landed) {
        state.player.coyote = COYOTE_TIME;
        state.jumpCutApplied = false;
        if (state.jumpBuffer > 0) {
          startJump();
          // A tap that was already released before landing is just a hop.
          if (!state.holding) releaseJump();
        }
      } else {
        state.player.coyote = Math.max(0, state.player.coyote - dt);
      }

      // With the shield on, lava and water can't hurt: the runner bounces
      // straight back out of the pit.
      if (!landed && invincibleActive && state.player.y + PLAYER_H > HAZARD_Y + 8) {
        state.player.vy = JUMP_VELOCITY;
        state.player.coyote = 0;
        state.jumpCutApplied = true;
        state.effects.push({ x: PLAYER_X + PLAYER_W / 2, y: HAZARD_Y, ttl: 0.25 });
        sfxSmash();
      }

      // Fell into a pit -- no platform under the player and they've
      // dropped past the bottom of the canvas.
      if (!landed && state.player.y > H) {
        crash('pit');
        return;
      }

      const hitboxX = PLAYER_X + 5;
      const hitboxW = PLAYER_W - 10;
      const hitboxY = state.player.y + 7;
      const hitboxH = PLAYER_H - 9;

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
            if (shieldActive) state.bonusScore += OBSTACLE_SMASH_BONUS;
            state.effects.push({ x: o.x + o.w / 2, y: obY + o.h / 2, ttl: 0.25 });
            sfxSmash();
            state.obstacles.splice(i, 1);
            continue;
          }
          crash('obstacle');
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
        if (state.elapsed < state.magnetUntil) {
          // Magnet: burgers nearby drift toward the runner.
          const dx = PLAYER_X + PLAYER_W / 2 - c.x;
          const dy = state.player.y + PLAYER_H / 2 - c.y;
          const dist = Math.hypot(dx, dy);
          if (dist < MAGNET_RADIUS && dist > 1) {
            c.x += (dx / dist) * MAGNET_PULL * dt;
            c.y += (dy / dist) * MAGNET_PULL * dt;
          }
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
          } else if (p.type === 'magnet') {
            state.magnetUntil = state.elapsed + POWERUP_DURATION;
            sfxPowerupMagnet();
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
      const blending = state.stageBlend < 1;
      drawSky(ctx, W, H, blending ? state.prevStageIdx : state.stageIdx, state.stageIdx, blending ? state.stageBlend : 1);
      // Parallax scenery for the current stage, cross-fading from the
      // previous one when a new stage starts.
      if (blending) drawScenery(ctx, W, LOW_Y, state.prevStageIdx, state.distance, 1, state.elapsed);
      drawScenery(ctx, W, LOW_Y, state.stageIdx, state.distance, blending ? state.stageBlend : 1, state.elapsed);
      // dark pit walls between the road and the hazard, then the hazard itself
      const wall = ctx.createLinearGradient(0, LOW_Y, 0, H);
      wall.addColorStop(0, '#241d16');
      wall.addColorStop(1, '#0d0a07');
      ctx.fillStyle = wall;
      ctx.fillRect(0, LOW_Y, W, H - LOW_Y);
      drawHazard(ctx, W, H, HAZARD_Y, STAGES[state.stageIdx].hazard, state.distance, state.elapsed, 1, null);
    }

    // Translucent hazard over the gaps in the road only, drawn after the
    // runner so one that falls in visibly sinks into it.
    function drawHazardFront() {
      const segs = [...state.terrain].sort((a, b) => a.xStart - b.xStart);
      const gaps = [];
      let edge = 0;
      for (const seg of segs) {
        if (seg.xStart > edge) gaps.push([edge, Math.min(W, seg.xStart)]);
        edge = Math.max(edge, seg.xEnd);
        if (edge >= W) break;
      }
      if (edge < W) gaps.push([edge, W]);
      if (gaps.length) drawHazard(ctx, W, H, HAZARD_Y, STAGES[state.stageIdx].hazard, state.distance, state.elapsed, 0.6, gaps);
    }

    function drawStageBanner() {
      const left = state.stageBannerUntil - state.elapsed;
      if (left <= 0) return;
      const alpha = Math.min(1, left / 0.6);
      const stage = STAGES[state.stageIdx];
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 40, W, 40);
      ctx.fillStyle = '#FFC72C';
      ctx.font = '900 12px sans-serif';
      ctx.fillText(stage.final ? 'FINAL RUN' : `STAGE ${state.stageIdx + 1}`, W / 2, 56);
      ctx.fillStyle = '#fff';
      ctx.font = '800 17px sans-serif';
      ctx.fillText(stage.name.toUpperCase(), W / 2, 74);
      ctx.restore();
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
        const n = o.stack || 1;
        for (let k = 0; k < n; k++) ctx.drawImage(sprite, o.x, y + k * (o.h / n), o.w, o.h / n);
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
      ctx.fillStyle = p.type === 'speed' ? '#3FA9E0' : p.type === 'magnet' ? '#232838' : '#FFD23F';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (p.type === 'magnet') {
        // horseshoe magnet: red body with white tips
        const r = 5.5;
        ctx.lineCap = 'butt';
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#E5483B';
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, Math.PI, 0);
        ctx.moveTo(p.x - r, p.y);
        ctx.lineTo(p.x - r, p.y + 3);
        ctx.moveTo(p.x + r, p.y);
        ctx.lineTo(p.x + r, p.y + 3);
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(p.x - r, p.y + 3);
        ctx.lineTo(p.x - r, p.y + 7);
        ctx.moveTo(p.x + r, p.y + 3);
        ctx.lineTo(p.x + r, p.y + 7);
        ctx.stroke();
      }
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
      // The sprite has transparent padding under the feet, so place it by
      // where the feet are drawn, not by the image centre: feet rest on the road.
      const cy = state.player.y + PLAYER_H + 1 - TREX_FEET_FRAC * TREX_DRAW_H + TREX_DRAW_H / 2;
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
      const blinking = state.elapsed < state.graceUntil && Math.floor(state.elapsed * 10) % 2 === 0;

      ctx.save();
      if (blinking) ctx.globalAlpha = 0.35;
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
      drawHazardFront();
      drawStageBanner();
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

    const isJumpKey = (e) => e.code === 'Space' || e.key === ' ' || e.key === 'ArrowUp';

    function handleKeyDown(e) {
      if (isJumpKey(e)) {
        e.preventDefault();
        // A held key auto-repeats; only the first press is a jump.
        if (!e.repeat) jump();
      }
    }

    function handleKeyUp(e) {
      if (isJumpKey(e)) releaseJump();
    }

    function handlePointerDown() {
      jump();
    }

    function handlePointerUp() {
      releaseJump();
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    canvas.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    if (import.meta.env.DEV) window.__trex = state;

    startSessionRef.current = async () => {
      resetGame();
      state.running = true;
    };

    resetGame();
    loop();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      if (state.animFrameId) cancelAnimationFrame(state.animFrameId);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const openStageInfo = () => {
    if (pauseRef.current && pauseRef.current()) {
      setInfoOpen(true);
      setInfoChip(null);
    }
  };

  const closeStageInfo = () => {
    setInfoOpen(false);
    let n = 3;
    setCountdown(n);
    clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(countdownTimerRef.current);
        setCountdown(null);
        if (resumeRef.current) resumeRef.current();
      } else {
        setCountdown(n);
      }
    }, 800);
  };

  const handlePlayButtonClick = async () => {
    setRewardMsg(null);
    setIsNewBest(false);
    setRankInfo(null);
    setBurgersCollected(0);
    setActiveEffects({ speed: 0, invincible: 0, magnet: 0 });
    setDeathReason(null);
    setStageIdx(0);
    setLives(3);
    setInfoChip(null);
    setInfoOpen(false);
    setCountdown(null);
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
            <span>Stage {stageIdx + 1}/{STAGES.length}</span>
            {user && <span>Best: {bestScore}</span>}
          </div>

          <div className={`runner-canvas-wrap${(!gameStarted || gameOver) ? ' is-idle' : ''}`}>
            <button className="runner-mute-btn" onClick={toggleSound} aria-label="Toggle sound">
              {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>

            <canvas ref={canvasRef}></canvas>

            {(activeEffects.speed > 0 || activeEffects.invincible > 0 || activeEffects.magnet > 0) && (
              <div className="runner-powerup-badges">
                {activeEffects.speed > 0 && (
                  <span className="runner-badge runner-badge-speed">⚡ {activeEffects.speed.toFixed(1)}s</span>
                )}
                {activeEffects.magnet > 0 && (
                  <span className="runner-badge runner-badge-magnet">🧲 {activeEffects.magnet.toFixed(1)}s</span>
                )}
                {activeEffects.invincible > 0 && (
                  <span className="runner-badge runner-badge-shield">🛡 {activeEffects.invincible.toFixed(1)}s</span>
                )}
              </div>
            )}

            {gameStarted && !gameOver && (
              <div className="runner-lives" aria-label={`${lives} lives left`}>
                {[0, 1, 2].map((i) => (
                  <span key={i} className={i < lives ? 'on' : 'off'}>❤</span>
                ))}
              </div>
            )}

            {infoChip != null && !infoOpen && countdown == null && gameStarted && !gameOver && (
              <button className="runner-info-chip" onClick={openStageInfo} aria-label={`About ${STAGES[infoChip].name}`}>
                ⓘ
              </button>
            )}

            {countdown != null && <div className="runner-countdown">{countdown}</div>}

            {(!gameStarted || gameOver) && (
              <div className="runner-overlay-screen">
                {!gameOver ? (
                  <>
                    <h2>Ready to Run?</h2>
                    <ul className="runner-howto">
                      <li><span>👆</span>Tap for a hop, hold for a big jump (or Space)</li>
                      <li><span>❤️</span>You have 3 lives. A crash costs one and you carry on from where you were</li>
                      <li><span>🍔</span>Grab burgers for bonus points</li>
                      <li><span>📍</span>Run through 5 Kota Kinabalu landmarks. Tap the ⓘ chip to learn about each one</li>
                      <li><span>⚡</span>Speed boost · 🧲 Magnet pulls burgers · 🛡 Shield: smash obstacles and float over lava</li>
                    </ul>
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
                        {deathReason === 'pit' && (STAGES[stageIdx].hazard === 'lava' ? 'Fell into the lava' : 'Fell into the water')}
                        {deathReason === 'obstacle' && 'Hit an obstacle'}
                      </p>
                    )}

                    {burgersCollected > 0 && (
                      <div style={{ fontSize: 12, color: '#ccc', marginBottom: 10 }}>
                        🍔 x{burgersCollected} collected
                      </div>
                    )}

                    {stageIdx > 0 && (
                      <div className="runner-landmarks">
                        <strong>Landmarks you passed</strong>
                        {STAGES.slice(0, stageIdx + 1).map((st) => (
                          <div key={st.name}>📍 <b>{st.name}</b> — {st.info.short}</div>
                        ))}
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

          {infoOpen && (
            <div className="runner-info-card" role="dialog" aria-label={STAGES[stageIdx].info.title}>
              <div className="runner-info-card-body">
                <img className="runner-info-img" src={`/images/trex/stage${stageIdx + 1}.webp`} alt="" style={{ objectPosition: `${STAGES[stageIdx].focus}% 50%` }} />
                <h2>{STAGES[stageIdx].info.title}</h2>
                {STAGES[stageIdx].info.lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
                <button className="runner-btn" onClick={closeStageInfo}>Continue</button>
              </div>
            </div>
          )}

          <button
            className="runner-jump-btn"
            onPointerDown={(e) => { e.preventDefault(); if (jumpRef.current) jumpRef.current(); }}
          >
            TAP = HOP · HOLD = JUMP
          </button>
        </div>
      </div>
    </div>
  );
}
