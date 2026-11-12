import { useEffect, useRef, useState } from 'react';
import { X, Volume2, VolumeX, Trophy, Award } from 'lucide-react';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import { STAGES, STAGE_MOODS, stageIndexForScore, drawSky, drawScenery, drawHazard, drawWeather, drawWeatherFront } from './trexStages';
import { isSoundMuted, setSoundMuted, playSfx, vibrate, createParticles, createShake, createMusic, SONGS } from '../utils/gameFx';
import './TrexRunnerModal.css';

export default function TrexRunnerModal({ isOpen, onClose }) {
  const { user, setUser } = useAuth();
  const canvasRef = useRef(null);

  const [gameStarted, setGameStarted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [burgersCollected, setBurgersCollected] = useState(0);
  const [soundOn, setSoundOn] = useState(() => !isSoundMuted());
  const [rewardMsg, setRewardMsg] = useState(null);
  const [weekInfo, setWeekInfo] = useState(null);
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
  // The game loop is created once per open, so it reads the live sound setting through a ref.
  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;
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
  const sfxJump = () => fx('jump');
  const sfxLand = () => fx('land');
  const sfxBird = () => fx('bird');
  const sfxGate = () => fx('gate');
  const sfxCollect = () => fx('collect');
  const sfxHit = () => fx('crash');
  const sfxNewBest = () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, 'triangle', 0.14, i * 0.13));
  const sfxSmash = () => tone(300, 0.12, 'square', 0.16, 0);
  const sfxPowerupSpeed = () => [500, 700, 900].forEach((f, i) => tone(f, 0.08, 'sawtooth', 0.1, i * 0.05));
  const sfxStage = () => [440, 554, 659, 880].forEach((f, i) => tone(f, 0.12, 'triangle', 0.13, i * 0.07));
  const sfxPowerupMagnet = () => [600, 450, 600, 800].forEach((f, i) => tone(f, 0.07, 'square', 0.1, i * 0.05));
  const sfxPowerupInvincible = () => [400, 600, 800, 1000].forEach((f, i) => tone(f, 0.1, 'triangle', 0.12, i * 0.06));

  const toggleSound = () => setSoundOn(prev => { setSoundMuted(prev); return !prev; });

  // Setup Canvas & Game loop
  useEffect(() => {
    if (!isOpen) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const W = 408;
    // Taller frame (was 200) so the game fills more of a phone screen instead
    // of a thin strip. Everything is anchored to the ground (LOW_Y = H - 26),
    // and the background art is drawn up to the ground line, so the extra
    // height simply adds sky and scales the scenery -- jump height, gaps and
    // all gameplay stay exactly the same.
    const H = 300;
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
    const MIN_OBSTACLE_SPACING = 240;
    // Chance a given segment gets a burger, and how much clear room it
    // needs from any obstacle on that same segment (see ensureTerrain).
    const COLLECTIBLE_CHANCE = 0.6;
    const MIN_COLLECTIBLE_CLEARANCE = 70;
    const TREX_DRAW_W = PLAYER_W + 14;
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

    // Sizes keep each sprite's own proportions (the old crate was squashed tall, which is
    // what made it look ugly). The cone is drawn in code.
    const OBSTACLE_VARIANTS = [
      { w: 30, h: 23, spriteKey: 'crate' },
      { w: 40, h: 15, spriteKey: 'pan' },
      { w: 15, h: 38, spriteKey: 'bottle' },
      { w: 20, h: 28, spriteKey: 'cone' },
      // two stacked crates: too tall for a hop, needs a held jump
      { w: 30, h: 46, spriteKey: 'crate', stack: 2, tall: true }
    ];
    // Where on a platform an obstacle may sit (after the landing room): earlier or later in
    // the stretch, chosen by weight and never the same twice in a row.
    const POSITION_BUCKETS = [
      { lo: 0.05, hi: 0.45, weight: 0.5 },
      { lo: 0.45, hi: 0.95, weight: 0.5 }
    ];
    // Obstacles only go on platforms wide enough to land, then take off again.
    const OBSTACLE_MIN_PLATFORM = 160;
    const OBSTACLE_LANDING_ROOM = 50;
    const PAIR_FROM_STAGE = 3;
    // Late-game extras. Flying birds (last two landmarks) pass at head height: stay on the
    // ground as one passes. Rolling barrels (from the third landmark) roll toward you on a
    // flat platform: jump them.
    const FLYER_FROM_STAGE = 3;
    const FLYER_EXTRA_SPEED = 55;
    const FLYER_HEIGHT = 44;       // bird centre above the ground; a standing runner clears it
    const FLYER_SPAWN_OFFSET = 150; // starts this far off-screen so there is a warning
    const BARREL_FROM_STAGE = 3;
    const BARREL_CHANCE = 0.14;
    const BARREL_EXTRA_SPEED = 70;
    // Landmark gates: a glowing arch at the start of each landmark. Run through for a bonus.
    const GATE_BONUS = 50;
    const GATE_W = 56;
    const PAIR_CHANCE = 0.12;      // chance of a two-item cluster (late stages only)
    const OBSTACLE_SCALE_JITTER = 0.12; // each obstacle is a little bigger or smaller than its variant

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

    const particles = createParticles();
    const shake = createShake();
    const music = createMusic(SONGS.trex);
    let shakeOffset = { x: 0, y: 0 };

    const state = {
      birds: [],
      lastVariantKey: '',
      lastBucket: -1,
      flyers: [],
      gates: [],
      pops: [],
      nextFlyerAt: 0,
      jumpedAt: -9,
      landedAt: -9,
      lastStep: 0,
      scrollPx: 0,
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

    // Widest block (px) a full jump clears at the current speed: the time the
    // runner stays above height h, times speed, minus the runner's own width.
    function maxClearWidth(h) {
      const up = JUMP_VELOCITY * JUMP_VELOCITY - 2 * GRAVITY * h;
      if (up <= 0) return 0;
      return (2 * Math.sqrt(up) / GRAVITY) * state.speed - 28;
    }

    function pickBucket() {
      const choices = POSITION_BUCKETS.map((b, i) => ({ b, i })).filter((c) => c.i !== state.lastBucket);
      const total = choices.reduce((sum, c) => sum + c.b.weight, 0);
      let r = Math.random() * total;
      for (const c of choices) {
        r -= c.b.weight;
        if (r <= 0) { state.lastBucket = c.i; return c.b; }
      }
      state.lastBucket = choices[0].i;
      return choices[0].b;
    }

    function jitteredVariant(v) {
      if (v.tall) return { ...v };
      const k = 1 - OBSTACLE_SCALE_JITTER / 2 + Math.random() * OBSTACLE_SCALE_JITTER;
      return { ...v, w: Math.round(v.w * k), h: Math.round(v.h * k) };
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
        const obstacleChance = 0.5 + difficulty() * 0.2 + (STAGES[state.stageIdx].final ? 0.06 : 0);
        let placedObstacle = null;
        if (last && !inGrace && seg.xEnd - seg.xStart >= OBSTACLE_MIN_PLATFORM && Math.random() < obstacleChance) {
          const wantsBarrel = state.stageIdx >= BARREL_FROM_STAGE && seg.xEnd - seg.xStart >= 190 && Math.random() < BARREL_CHANCE;
          if (wantsBarrel) {
            const bx = seg.xEnd - 40;
            if (bx - state.lastObstacleRightEdge >= MIN_OBSTACLE_SPACING) {
              state.obstacles.push({ x: bx, w: 22, h: 22, tierY: seg.y, spriteKey: 'barrel', stack: 1, roll: true, active: false, seg, extra: BARREL_EXTRA_SPEED, spin: 0 });
              placedObstacle = { x: seg.xStart + 30, w: seg.xEnd - seg.xStart - 60, h: 22, tierY: seg.y };
              state.lastObstacleRightEdge = bx + 22;
            }
          }
          if (!placedObstacle) {
            // Tall stacked crates only once the run is under way, and never on a raised tier.
            const allowTall = difficulty() > 0.25 && seg.tier === 'low';
            const pool = OBSTACLE_VARIANTS.filter((o) => (allowTall || !o.tall) && o.spriteKey + o.w + o.h !== state.lastVariantKey);
            const base = pool[Math.floor(Math.random() * pool.length)];
            const first = jitteredVariant(base);
            // Late stages only: sometimes a cluster of two low items, as wide as a jump clears.
            let items = [first];
            if (!first.tall && state.stageIdx >= PAIR_FROM_STAGE && Math.random() < PAIR_CHANCE) {
              const lowPool = OBSTACLE_VARIANTS.filter((o) => !o.tall);
              const second = jitteredVariant(lowPool[Math.floor(Math.random() * lowPool.length)]);
              const gapPx = 3 + Math.random() * 7;
              const widest = Math.max(first.h, second.h);
              if (first.w + gapPx + second.w <= maxClearWidth(widest)) items = [first, { ...second, gapPx }];
            }
            const blockW = items.reduce((sum, it) => sum + it.w + (it.gapPx || 0), 0);
            const bucket = pickBucket();
            // always leave room to land before it and to take off after it
            const room = Math.max(0, seg.xEnd - seg.xStart - 2 * OBSTACLE_LANDING_ROOM - blockW);
            const ox = seg.xStart + OBSTACLE_LANDING_ROOM + room * (bucket.lo + Math.random() * (bucket.hi - bucket.lo));
            const minSpacing = MIN_OBSTACLE_SPACING * (0.9 + Math.random() * 0.4);
            if (ox - state.lastObstacleRightEdge >= minSpacing) {
              let cursor = ox;
              for (const it of items) {
                cursor += it.gapPx || 0;
                state.obstacles.push({ x: cursor, w: it.w, h: it.h, tierY: seg.y, spriteKey: it.spriteKey, stack: it.stack || 1 });
                cursor += it.w;
              }
              const topH = Math.max(...items.map((it) => it.h));
              placedObstacle = { x: ox, w: blockW, h: topH, tierY: seg.y };
              state.lastObstacleRightEdge = ox + blockW;
              state.lastVariantKey = first.spriteKey + base.w + base.h;
              // A small arc of burgers over the obstacle: they show where to jump.
              if (Math.random() < 0.6) {
                const mid = ox + blockW / 2;
                state.collectibles.push(
                  { x: mid - 24, y: seg.y - topH - 30, size: 9 },
                  { x: mid, y: seg.y - topH - 44, size: 9 },
                  { x: mid + 24, y: seg.y - topH - 30, size: 9 }
                );
              }
            }
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
      state.birds = [];
      particles.clear();
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
      state.lastVariantKey = '';
      state.lastBucket = -1;
      state.flyers = [];
      state.gates = [];
      state.pops = [];
      state.nextFlyerAt = 8;
      state.jumpedAt = -9;
      state.landedAt = -9;
      state.lastStep = 0;
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
      state.jumpedAt = state.elapsed;
      state.player.coyote = 0;
      state.jumpBuffer = 0;
      state.jumpCutApplied = false;
      sfxJump();
      particles.emit(PLAYER_X + PLAYER_W / 2, state.player.y + PLAYER_H, { n: 5, color: '230,220,200', speed: 40, life: 0.35, size: 3, spread: Math.PI * 0.8, angle: Math.PI / 2 });
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
      shake.kick(8, 0.3);
      vibrate(soundOnRef.current, 60);
      particles.emit(PLAYER_X + PLAYER_W / 2, state.player.y + PLAYER_H / 2, { n: 14, color: '255,140,60', speed: 150, life: 0.55, size: 4, gravity: 260 });
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
      music.stop();
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
      music.setBpm(112 + state.stageIdx * 7);

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
        state.stageBannerUntil = state.elapsed + 2;
        state.gates.push({ x: W + 30, passed: false, name: STAGES[nextStage].name });
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
      state.scrollPx = moveBy;
      updateBirds(dt, moveBy);
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
      const impactVy = state.player.vy;
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

      if (landed && !state.player.onGround && impactVy > 240) {
        sfxLand();
        state.landedAt = state.elapsed;
        particles.emit(PLAYER_X + PLAYER_W / 2, state.player.y + PLAYER_H, { n: 8, color: '225,215,195', speed: 70, life: 0.45, size: 4, spread: Math.PI * 0.9, angle: -Math.PI / 2, gravity: 40 });
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
        if (o.roll) {
          if (!o.active && o.x < W + 4) o.active = true;
          if (o.active) {
            const dx = o.extra * dt;
            o.x -= dx;
            o.spin += (moveBy + dx) / (o.w / 2);
            // it rolls off the end of its platform and is gone
            if (o.seg && o.x < o.seg.xStart + 2) {
              state.obstacles.splice(i, 1);
              continue;
            }
          }
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

      updateFlyers(dt, moveBy, hitboxX, hitboxY, hitboxW, hitboxH, invincibleActive);
      updateGates(moveBy);
      if (!state.running) return;

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
          particles.emit(c.x, c.y, { n: 7, color: '255,214,80', speed: 90, life: 0.45, size: 3, gravity: 120 });
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

    // Landmark gate: purely visual, never in the way. Passing it pays a bonus.
    function updateGates(moveBy) {
      for (let i = state.gates.length - 1; i >= 0; i--) {
        const g = state.gates[i];
        g.x -= moveBy;
        if (!g.passed && g.x + GATE_W < PLAYER_X) {
          g.passed = true;
          state.bonusScore += GATE_BONUS;
          sfxGate();
          const px = PLAYER_X + PLAYER_W / 2;
          particles.emit(px, state.player.y + PLAYER_H / 2, { n: 18, color: '255,214,80', speed: 130, life: 0.7, size: 3, gravity: 80 });
          state.pops.push({ x: px, y: state.player.y - 6, text: `+${GATE_BONUS} XP`, ttl: 1 });
        }
        if (g.x < -GATE_W - 20) state.gates.splice(i, 1);
      }
    }

    function drawGates() {
      for (const g of state.gates) {
        const gy = groundYAt(g.x + GATE_W / 2);
        const top = gy - 82;
        const glow = ctx.createRadialGradient(g.x + GATE_W / 2, top + 20, 4, g.x + GATE_W / 2, top + 20, 60);
        glow.addColorStop(0, g.passed ? 'rgba(255, 214, 80, 0.12)' : 'rgba(255, 214, 80, 0.28)');
        glow.addColorStop(1, 'rgba(255, 214, 80, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(g.x - 30, top - 30, GATE_W + 60, 120);
        const post = ctx.createLinearGradient(0, top, 0, gy);
        post.addColorStop(0, 'rgba(255, 214, 80, 0.85)');
        post.addColorStop(1, 'rgba(255, 170, 40, 0.55)');
        ctx.fillStyle = post;
        ctx.fillRect(g.x - 3, top + 8, 6, gy - top - 8);
        ctx.fillRect(g.x + GATE_W - 3, top + 8, 6, gy - top - 8);
        // the arch across the top and a small hanging sign with the landmark name
        ctx.strokeStyle = 'rgba(255, 214, 80, 0.9)';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(g.x, top + 12);
        ctx.quadraticCurveTo(g.x + GATE_W / 2, top - 8, g.x + GATE_W, top + 12);
        ctx.stroke();
        ctx.font = '800 8px sans-serif';
        const label = g.name.toUpperCase();
        const lw = ctx.measureText(label).width + 10;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath();
        ctx.roundRect(g.x + GATE_W / 2 - lw / 2, top + 14, lw, 13, 6);
        ctx.fill();
        ctx.fillStyle = '#FFC72C';
        ctx.textAlign = 'center';
        ctx.fillText(label, g.x + GATE_W / 2, top + 24);
      }
    }

    function updateAndDrawPops(dt) {
      ctx.font = '900 13px sans-serif';
      ctx.textAlign = 'center';
      for (let i = state.pops.length - 1; i >= 0; i--) {
        const p = state.pops[i];
        p.ttl -= dt;
        if (p.ttl <= 0) { state.pops.splice(i, 1); continue; }
        ctx.fillStyle = `rgba(255, 214, 80, ${Math.min(1, p.ttl * 1.6).toFixed(2)})`;
        ctx.fillText(p.text, p.x, p.y - (1 - p.ttl) * 26);
      }
    }

    // Height of the platform under screen x (the last one before it when over a gap).
    function groundYAt(x) {
      let best = LOW_Y;
      for (const sg of state.terrain) {
        if (x >= sg.xStart && x <= sg.xEnd) return sg.y;
        if (sg.xEnd < x) best = sg.y;
      }
      return best;
    }

    // A bird only starts when, by the time it reaches the runner, the ground there is a
    // flat stretch with no obstacle or gap nearby, so it is never combined with another hazard.
    function trySpawnFlyer() {
      if (state.stageIdx < FLYER_FROM_STAGE || state.elapsed < state.nextFlyerAt) return;
      const spawnX = W + FLYER_SPAWN_OFFSET;
      const t = (spawnX - PLAYER_X) / (state.speed + FLYER_EXTRA_SPEED);
      const meetX = PLAYER_X + 12 + state.speed * t;
      const seg = state.terrain.find((sg) => meetX - 90 >= sg.xStart && meetX + 90 <= sg.xEnd);
      const clear = state.obstacles.every((o) => o.x + o.w < meetX - 100 || o.x > meetX + 100);
      state.nextFlyerAt = state.elapsed + 0.5;
      if (!seg || !clear) return;
      state.nextFlyerAt = state.elapsed + (STAGES[state.stageIdx].final ? 4 : 6) + Math.random() * 4;
      state.flyers.push({ x: spawnX, y: seg.y - FLYER_HEIGHT, phase: 0 });
      sfxBird();
    }

    function updateFlyers(dt, moveBy, hx, hy, hw, hh, shielded) {
      trySpawnFlyer();
      for (let i = state.flyers.length - 1; i >= 0; i--) {
        const f = state.flyers[i];
        f.x -= moveBy + FLYER_EXTRA_SPEED * dt;
        f.phase += dt * 11;
        f.y += (groundYAt(f.x) - FLYER_HEIGHT - f.y) * Math.min(1, dt * 6);
        if (f.x < -40) { state.flyers.splice(i, 1); continue; }
        if (overlap(hx, hy, hw, hh, f.x - 13, f.y - 6, 26, 12)) {
          if (shielded) {
            state.effects.push({ x: f.x, y: f.y, ttl: 0.25 });
            sfxSmash();
            state.flyers.splice(i, 1);
            continue;
          }
          crash('bird');
          return;
        }
      }
    }

    function drawFlyers() {
      for (const f of state.flyers) {
        if (f.x > W - 4) {
          // warning: a pulsing "!" at the right edge until the bird flies in
          const pulse = 0.55 + 0.45 * Math.sin(state.elapsed * 14);
          ctx.fillStyle = `rgba(255, 90, 60, ${pulse})`;
          ctx.font = '900 18px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('!', W - 14, f.y + 6);
          continue;
        }
        const flap = Math.sin(f.phase) * 9;
        ctx.fillStyle = '#2b2430';
        ctx.beginPath();
        ctx.ellipse(f.x, f.y, 9, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#2b2430';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(f.x - 2, f.y - 1);
        ctx.lineTo(f.x + 3, f.y - 4 - flap);
        ctx.moveTo(f.x - 2, f.y + 1);
        ctx.lineTo(f.x + 3, f.y + 4 + flap * 0.4);
        ctx.stroke();
        ctx.fillStyle = '#ff9a3c';
        ctx.beginPath();
        ctx.moveTo(f.x - 9, f.y - 1);
        ctx.lineTo(f.x - 15, f.y + 1);
        ctx.lineTo(f.x - 9, f.y + 3);
        ctx.fill();
      }
    }

    // Scenery birds: pure decoration drifting across the sky (no collisions). Now pale, so they
    // show against the dark evening skies, and sometimes a small V-shaped flock.
    function updateBirds(dt, moveBy) {
      if (state.birds.length < 6 && Math.random() < dt * 0.5) {
        const y = 24 + Math.random() * (LOW_Y * 0.4);
        const speed = 34 + Math.random() * 36;
        const size = 6 + Math.random() * 4;
        const flock = Math.random() < 0.35 ? 3 : 1;
        for (let j = 0; j < flock; j++) {
          const side = j === 0 ? 0 : (j === 1 ? -1 : 1);
          state.birds.push({ x: W + 20 + (j ? 18 : 0), y: y + (j ? 9 : 0) * side + (j ? 4 : 0), speed, phase: Math.random() * 6 + j * 0.7, size: size * (j ? 0.85 : 1), base: y });
        }
      }
      for (let i = state.birds.length - 1; i >= 0; i--) {
        const b = state.birds[i];
        b.x -= b.speed * dt + moveBy * 0.15;
        b.y += Math.sin(state.elapsed * 1.5 + b.phase) * 0.15;
        b.phase += dt * 9;
        if (b.x < -40) state.birds.splice(i, 1);
      }
    }

    function drawBirds() {
      const tint = state.stageIdx === 3 ? '255, 226, 192' : state.stageIdx === 4 ? '215, 228, 255' : '255, 250, 240';
      ctx.strokeStyle = `rgba(${tint}, 0.85)`;
      ctx.fillStyle = `rgba(${tint}, 0.85)`;
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      for (const b of state.birds) {
        const flap = Math.sin(b.phase) * b.size * 0.75;
        ctx.beginPath();
        ctx.moveTo(b.x - b.size, b.y - flap);
        ctx.quadraticCurveTo(b.x - b.size * 0.4, b.y - flap * 0.2 - 3, b.x, b.y);
        ctx.quadraticCurveTo(b.x + b.size * 0.4, b.y - flap * 0.2 - 3, b.x + b.size, b.y - flap);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(b.x, b.y + 0.5, 1.6, 0, Math.PI * 2);
        ctx.fill();
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
      drawBirds();
      if (blending) drawWeather(ctx, W, LOW_Y, state.prevStageIdx, state.distance, 1, state.elapsed);
      drawWeather(ctx, W, LOW_Y, state.stageIdx, state.distance, blending ? state.stageBlend : 1, state.elapsed);
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

    // Small translucent tag in the top-left corner: it never covers the track.
    function drawStageBanner() {
      const left = state.stageBannerUntil - state.elapsed;
      if (left <= 0) return;
      const stage = STAGES[state.stageIdx];
      const label = `${stage.final ? 'FINAL' : `STAGE ${state.stageIdx + 1}`} · ${stage.name.toUpperCase()} · ${(STAGE_MOODS[state.stageIdx] || '').toUpperCase()}`;
      ctx.save();
      ctx.globalAlpha = Math.min(0.8, left / 0.5);
      ctx.font = '800 11px sans-serif';
      const w = ctx.measureText(label).width + 16;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.roundRect(8, 44, w, 20, 10);
      ctx.fill();
      ctx.fillStyle = '#FFC72C';
      ctx.textAlign = 'left';
      ctx.fillText(label, 16, 58);
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

    // A traffic cone drawn in code, with light and dark sides.
    function drawCone(x, y, w, h) {
      const cx = x + w / 2;
      const grad = ctx.createLinearGradient(x, 0, x + w, 0);
      grad.addColorStop(0, '#ff9a3c');
      grad.addColorStop(0.45, '#ff7a1a');
      grad.addColorStop(1, '#c4540a');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.14, y);
      ctx.lineTo(cx + w * 0.14, y);
      ctx.lineTo(x + w * 0.86, y + h - 4);
      ctx.lineTo(x + w * 0.14, y + h - 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      for (const f of [0.3, 0.62]) {
        const yy = y + h * f;
        const half = w * (0.16 + 0.34 * f);
        ctx.beginPath();
        ctx.moveTo(cx - half, yy);
        ctx.lineTo(cx + half, yy);
        ctx.lineTo(cx + half + w * 0.04, yy + h * 0.12);
        ctx.lineTo(cx - half - w * 0.04, yy + h * 0.12);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = '#3a2f2a';
      ctx.beginPath();
      ctx.roundRect(x, y + h - 5, w, 5, 2);
      ctx.fill();
    }

    function drawObstacle(o) {
      const y = o.tierY - o.h;
      // Dark contact shadow behind every obstacle regardless of sprite --
      // keeps hazards readable against the busy background art instead of
      // blending into it.
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(o.x + o.w / 2, y + o.h / 2, o.w * 0.62, o.h * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.beginPath();
      ctx.ellipse(o.x + o.w / 2, o.tierY - 1, o.w * 0.6, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      if (o.spriteKey === 'cone') {
        drawCone(o.x, y, o.w, o.h);
        return;
      }
      if (o.roll) {
        const r = o.w / 2;
        ctx.save();
        ctx.translate(o.x + r, y + r);
        ctx.rotate(o.spin || 0);
        ctx.fillStyle = '#8a5a2b';
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#3f2810';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-r, 0); ctx.lineTo(r, 0);
        ctx.moveTo(0, -r); ctx.lineTo(0, r);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        return;
      }
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

    // A shaded burger with a glossy bun, sesame seeds, lettuce, tomato, cheese and patty.
    function drawMiniBurger(cx0, cy0, size) {
      const k = size / 9;
      const bob = Math.sin(state.elapsed * 4 + cx0 * 0.05) * 1.4;
      const cx = cx0;
      const cy = cy0 + bob;
      const w = 12.5 * k;
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(cx, cy0 + 11 * k, w * 0.8, 2.6 * k, 0, 0, Math.PI * 2);
      ctx.fill();
      let g = ctx.createLinearGradient(0, cy + 3 * k, 0, cy + 8 * k);
      g.addColorStop(0, '#d98b3a');
      g.addColorStop(1, '#9b5a1d');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(cx - w * 0.92, cy + 3.4 * k, w * 1.84, 5 * k, 2.4 * k);
      ctx.fill();
      g = ctx.createLinearGradient(0, cy, 0, cy + 4 * k);
      g.addColorStop(0, '#7b4425');
      g.addColorStop(1, '#4a2611');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(cx - w, cy + 0.2 * k, w * 2, 3.6 * k, 1.8 * k);
      ctx.fill();
      ctx.fillStyle = '#d6372a';
      ctx.fillRect(cx - w * 0.9, cy - 1.2 * k, w * 1.8, 1.6 * k);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(cx - w * 0.9, cy - 1.2 * k, w * 1.8, 0.5 * k);
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.95, cy - 2.6 * k);
      ctx.lineTo(cx + w * 0.95, cy - 2.6 * k);
      ctx.lineTo(cx + w * 0.7, cy - 0.4 * k);
      ctx.lineTo(cx + w * 0.3, cy - 1.8 * k);
      ctx.lineTo(cx - w * 0.2, cy - 0.2 * k);
      ctx.lineTo(cx - w * 0.6, cy - 1.8 * k);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#6fc24b';
      ctx.beginPath();
      ctx.moveTo(cx - w * 1.02, cy - 2.4 * k);
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        ctx.lineTo(cx - w * 1.02 + t * w * 2.04, cy - 2.4 * k + (i % 2 ? 1.6 : -0.3) * k);
      }
      ctx.lineTo(cx + w * 1.02, cy - 3.2 * k);
      ctx.lineTo(cx - w * 1.02, cy - 3.2 * k);
      ctx.closePath();
      ctx.fill();
      g = ctx.createRadialGradient(cx - w * 0.35, cy - 8 * k, 1, cx, cy - 4 * k, w * 1.15);
      g.addColorStop(0, '#fbd185');
      g.addColorStop(0.55, '#e39a45');
      g.addColorStop(1, '#a8601f');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx - w, cy - 3 * k);
      ctx.bezierCurveTo(cx - w * 1.05, cy - 11.5 * k, cx + w * 1.05, cy - 11.5 * k, cx + w, cy - 3 * k);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff1cf';
      for (const [sx, sy] of [[-0.45, -8.2], [0.05, -9.2], [0.5, -7.8], [-0.1, -6.4], [0.62, -5.6], [-0.7, -5.8]]) {
        ctx.beginPath();
        ctx.ellipse(cx + w * sx, cy + sy * k, 0.9 * k, 0.5 * k, sx, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.ellipse(cx - w * 0.38, cy - 8.6 * k, w * 0.32, 1.5 * k, -0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // The body comes from the picture, cut just under the hips. The two legs are drawn in
    // code so they can run, tuck in the air and land (the picture has one still leg).
    const TREX_CUT = 84;
    const TREX_LEG = '#FFDD00';
    const TREX_LEG_FAR = '#D9B400';
    const TREX_OUTLINE = '#1B3B2D';
    function drawTrexLeg(hipX, footX, footY, fill) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = TREX_OUTLINE;
      ctx.lineWidth = 25;
      ctx.beginPath();
      ctx.moveTo(hipX, TREX_CUT + 2);
      ctx.lineTo(footX + 7, footY - 4);
      ctx.stroke();
      ctx.strokeStyle = fill;
      ctx.lineWidth = 17;
      ctx.beginPath();
      ctx.moveTo(hipX, TREX_CUT - 6);
      ctx.lineTo(footX + 7, footY - 4);
      ctx.stroke();
      ctx.fillStyle = fill;
      ctx.strokeStyle = TREX_OUTLINE;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(footX, footY, 17, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    function drawPlayer() {
      const cx = PLAYER_X + PLAYER_W / 2;
      const feetY = state.player.y + PLAYER_H + 1;
      const airborne = !state.player.onGround;
      const running = !airborne && state.running;
      // Stride cycle: the body bobs twice per leg cycle and the legs swing in opposite
      // directions, both speeding up as the world speed ramps.
      const strideSpeed = 12 + (state.speed - BASE_SPEED) * 0.04;
      const phase = state.elapsed * strideSpeed;
      const bob = running ? Math.abs(Math.sin(phase)) * 2.5 : 0;
      const lean = running ? Math.sin(phase * 2) * 0.05 : 0;
      const invincibleActive = state.elapsed < state.invincibleUntil;
      const blinking = state.elapsed < state.graceUntil && Math.floor(state.elapsed * 10) % 2 === 0;

      // squash and stretch: long and thin leaving the ground, short and wide on landing
      let sx = 1;
      let sy = 1;
      const sinceJump = state.elapsed - (state.jumpedAt || -9);
      const sinceLand = state.elapsed - (state.landedAt || -9);
      if (airborne && sinceJump < 0.14) { sx = 0.9; sy = 1.12; }
      else if (!airborne && sinceLand < 0.13) { const k = 1 - sinceLand / 0.13; sx = 1 + 0.16 * k; sy = 1 - 0.14 * k; }
      // nose up while rising, nose down while falling
      const tilt = airborne ? Math.max(-0.22, Math.min(0.22, state.player.vy / 1500)) : 0;

      // a little puff of dust at each footfall
      if (running) {
        const step = Math.floor(phase / Math.PI);
        if (step !== state.lastStep) {
          state.lastStep = step;
          particles.emit(cx - 6, feetY, { n: 2, color: '220,205,180', speed: 22, life: 0.28, size: 2, spread: Math.PI * 0.7, angle: -Math.PI * 0.85, gravity: 20 });
        }
      }

      const k = TREX_DRAW_W / 180;
      // foot positions in picture pixels: [x, y] for the near and the far leg
      let near;
      let far;
      if (airborne) {
        near = [83, 82];
        far = [108, 87];
      } else if (running) {
        near = [95 + Math.sin(phase) * 15, 94 - Math.max(0, Math.cos(phase)) * 14];
        far = [95 + Math.sin(phase + Math.PI) * 15, 94 - Math.max(0, Math.cos(phase + Math.PI)) * 14];
      } else {
        near = [95, 94];
        far = [95, 94];
      }

      ctx.save();
      if (blinking) ctx.globalAlpha = 0.35;
      ctx.translate(cx, feetY - bob);
      if (invincibleActive) {
        ctx.shadowColor = 'rgba(255, 210, 63, 0.9)';
        ctx.shadowBlur = 14;
      }
      ctx.rotate(lean + tilt);
      ctx.scale(-sx, sy); // the picture faces left; flip so it runs facing right
      ctx.translate(-TREX_DRAW_W / 2, -TREX_FEET_FRAC * TREX_DRAW_H);
      ctx.scale(k, k);
      if (trexImg.complete && trexImg.naturalWidth > 0) {
        drawTrexLeg(94, far[0], far[1], TREX_LEG_FAR);
        ctx.drawImage(trexImg, 0, 0, 180, TREX_CUT, 0, 0, 180, TREX_CUT);
        drawTrexLeg(101, near[0], near[1], TREX_LEG);
      } else {
        ctx.fillStyle = '#FFC72C';
        ctx.beginPath();
        ctx.arc(90, 70, 40, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    function draw() {
      ctx.save();
      ctx.translate(shakeOffset.x, shakeOffset.y);
      drawBackground();
      drawTerrain();
      drawGates();
      state.obstacles.forEach(drawObstacle);
      state.collectibles.forEach(c => drawMiniBurger(c.x, c.y, c.size));
      state.powerups.forEach(drawPowerup);
      drawFlyers();
      drawEffects();
      drawPlayer();
      particles.draw(ctx);
      updateAndDrawPops(1 / 60);
      drawHazardFront();
      if (state.stageBlend < 1) drawWeatherFront(ctx, W, H, state.prevStageIdx, 1 - state.stageBlend, state.elapsed);
      drawWeatherFront(ctx, W, H, state.stageIdx, state.stageBlend, state.elapsed);
      drawStageBanner();
      ctx.restore();
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
        shakeOffset = shake.step(dt);
        particles.update(dt, state.running ? state.scrollPx : 0);
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
      music.start(audioCtxRef.current, () => soundOnRef.current && state.running && !state.paused);
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
      music.stop();
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
    setWeekInfo(null);
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
                      <li><span>🍔</span>Grab burgers for bonus Burger XP</li>
                      <li><span>📍</span>Run through 5 Kota Kinabalu landmarks. Tap the ⓘ chip to learn about each one</li>
                      <li><span>🏆</span>Your best score counts toward the arcade contest: top 3 win free food</li>
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
                        {deathReason === 'bird' && 'Jumped into a bird'}
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
