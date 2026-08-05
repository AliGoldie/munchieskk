import { useEffect, useRef, useState } from 'react';
import { X, Lock, Trophy, Flame } from 'lucide-react';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import MunchManRulesModal from './MunchManRulesModal';
import './MunchManModal.css';

export default function MunchManModal({ isOpen, onClose }) {
  const { user, setUser } = useAuth();
  const canvasRef = useRef(null);

  // Game state
  const [gameStarted, setGameStarted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [gameWon, setGameWon] = useState(false);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);

  // Daily play state
  const [canPlay, setCanPlay] = useState(true);
  const [alreadyPlayedToday, setAlreadyPlayedToday] = useState(false);
  const [streak, setStreak] = useState(0);
  const [checkingPlayStatus, setCheckingPlayStatus] = useState(true);

  // Rules modal state
  const [showRules, setShowRules] = useState(false);

  // Reward state
  const [rewardMsg, setRewardMsg] = useState(null);

  const gameStateRef = useRef(null);

  // Check play status on open
  useEffect(() => {
    if (!isOpen) return;

    const checkDailyStatus = async () => {
      setCheckingPlayStatus(true);
      if (!user) {
        setCanPlay(true);
        setAlreadyPlayedToday(false);
        setCheckingPlayStatus(false);
        return;
      }

      try {
        const { data, error } = await supabase.rpc('check_can_play_munchman');
        if (error) throw error;

        if (data) {
          setCanPlay(data.can_play);
          setAlreadyPlayedToday(data.played_today);
          setStreak(data.streak || 0);
        }
      } catch (err) {
        console.error('Error checking daily play status:', err);
        const todayStr = new Date().toISOString().split('T')[0];
        const { data: plays } = await supabase
          .from('game_plays')
          .select('id, played_at')
          .eq('user_id', user.id)
          .eq('game_name', 'munch_man')
          .gte('played_at', `${todayStr}T00:00:00Z`);

        if (plays && plays.length > 0) {
          setCanPlay(false);
          setAlreadyPlayedToday(true);
        } else {
          setCanPlay(true);
          setAlreadyPlayedToday(false);
        }
      } finally {
        setCheckingPlayStatus(false);
      }
    };

    checkDailyStatus();
  }, [isOpen, user]);

  // Setup Canvas & Game loop
  useEffect(() => {
    if (!isOpen) return;

    const COLS = 17;
    const ROWS = 15;
    const CELL = 24;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = COLS * CELL;
    canvas.height = ROWS * CELL;

    // Load T-Rex image sprite
    const trexImg = new Image();
    trexImg.src = "/images/Trex.png";

    function buildMaze() {
      const g = [];
      for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) {
          let wall = (r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1);
          if (!wall && r % 2 === 0 && c % 2 === 0) wall = true;
          row.push(wall);
        }
        g.push(row);
      }
      return g;
    }

    const maze = buildMaze();

    function isWall(r, c) {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return true;
      return maze[r][c];
    }

    const PLAYER_START = { r: ROWS - 2, c: Math.floor(COLS / 2) };
    const GHOST_STARTS = [
      { r: 1, c: 5, color: '#6FBF3E', dark: '#3E7A21', name: 'Dill' },
      { r: 1, c: 11, color: '#8FCB4A', dark: '#4E8B27', name: 'Gherkin' },
      { r: 7, c: 8, color: '#5BAA33', dark: '#356A1B', name: 'Relish' }
    ];

    const PELLET_SPOTS = [
      { r: 1, c: 1, type: 'scare' },
      { r: 1, c: COLS - 2, type: 'speed' },
      { r: ROWS - 2, c: 1, type: 'freeze' },
      { r: ROWS - 2, c: COLS - 2, type: 'scare' }
    ];

    const SPEED_BOOST_DURATION = 300;
    const SPEED_BOOST_MULTIPLIER = 1.6;
    const FREEZE_DURATION = 240;
    const PLAYER_SPEED = 2;
    const GHOST_SPEED = 1;
    const GHOST_SCARED_SPEED = 1;
    const GHOST_CHASE_CHANCE = 0.45;
    const SCARED_DURATION = 320;
    const GRACE_PERIOD = 120;

    function cellFree(r, c) {
      return !isWall(r, c);
    }

    const DIRS = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 }
    ];

    const state = {
      dots: [],
      totalDots: 0,
      dotsEaten: 0,
      pellets: [],
      player: {
        x: PLAYER_START.c * CELL,
        y: PLAYER_START.r * CELL,
        dir: { dx: 0, dy: 0 },
        next: { dx: 0, dy: 0 },
        speed: PLAYER_SPEED
      },
      ghosts: [],
      score: 0,
      lives: 3,
      running: false,
      won: false,
      speedBoostTimer: 0,
      freezeTimer: 0,
      graceTimer: GRACE_PERIOD,
      animFrameId: null
    };

    gameStateRef.current = state;

    function resetGame() {
      state.dots = [];
      let totalCount = 0;
      for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) {
          const isFree = cellFree(r, c);
          row.push(isFree);
          if (isFree) totalCount++;
        }
        state.dots.push(row);
      }
      state.pellets = PELLET_SPOTS.map(p => ({ ...p, eaten: false }));
      state.pellets.forEach(p => {
        if (state.dots[p.r][p.c]) {
          state.dots[p.r][p.c] = false;
          totalCount--;
        }
      });
      if (state.dots[PLAYER_START.r][PLAYER_START.c]) {
        state.dots[PLAYER_START.r][PLAYER_START.c] = false;
        totalCount--;
      }
      GHOST_STARTS.forEach(g => {
        if (state.dots[g.r][g.c]) {
          state.dots[g.r][g.c] = false;
          totalCount--;
        }
      });

      state.totalDots = totalCount;
      state.dotsEaten = 0;

      state.player = {
        x: PLAYER_START.c * CELL,
        y: PLAYER_START.r * CELL,
        dir: { dx: 0, dy: 0 },
        next: { dx: 0, dy: 0 },
        speed: PLAYER_SPEED
      };
      state.ghosts = GHOST_STARTS.map(g => ({
        x: g.c * CELL,
        y: g.r * CELL,
        dir: { dx: 1, dy: 0 },
        color: g.color,
        dark: g.dark,
        name: g.name,
        scared: false,
        scaredTimer: 0,
        speed: GHOST_SPEED,
        spawn: { r: g.r, c: g.c },
        respawnFlash: 0
      }));
      state.score = 0;
      state.lives = 3;
      state.running = false;
      state.won = false;
      state.speedBoostTimer = 0;
      state.freezeTimer = 0;
      state.graceTimer = GRACE_PERIOD;

      setScore(0);
      setLives(3);
    }

    function aligned(x, y) {
      return x % CELL === 0 && y % CELL === 0;
    }

    function tryMove(entity, wantDir, speed) {
      if (aligned(entity.x, entity.y)) {
        const c = entity.x / CELL;
        const r = entity.y / CELL;
        if (wantDir && (wantDir.dx || wantDir.dy) && !isWall(r + wantDir.dy, c + wantDir.dx)) {
          entity.dir = wantDir;
        } else if (isWall(r + entity.dir.dy, c + entity.dir.dx)) {
          entity.dir = { dx: 0, dy: 0 };
        }
      }
      entity.x += entity.dir.dx * speed;
      entity.y += entity.dir.dy * speed;
    }

    function ghostChooseDir(g) {
      if (!aligned(g.x, g.y)) return;
      const r = g.y / CELL;
      const c = g.x / CELL;
      const opts = DIRS.filter(d => {
        if (d.dx === -g.dir.dx && d.dy === -g.dir.dy) return false;
        return !isWall(r + d.dy, c + d.dx);
      });
      let choices = opts.length ? opts : DIRS.filter(d => !isWall(r + d.dy, c + d.dx));
      if (!choices.length) { g.dir = { dx: 0, dy: 0 }; return; }

      const pr = state.player.y / CELL;
      const pc = state.player.x / CELL;
      choices.sort((a, b) => {
        const da = Math.hypot((r + a.dy) - pr, (c + a.dx) - pc);
        const db = Math.hypot((r + b.dy) - pr, (c + b.dx) - pc);
        return g.scared ? db - da : da - db;
      });

      if (Math.random() < GHOST_CHASE_CHANCE) {
        g.dir = choices[0];
      } else {
        g.dir = choices[Math.floor(Math.random() * choices.length)];
      }
    }

    function cellOf(entity) {
      return { r: Math.round(entity.y / CELL), c: Math.round(entity.x / CELL) };
    }

    function checkDotEat() {
      const { r, c } = cellOf(state.player);
      if (state.dots[r] && state.dots[r][c]) {
        state.dots[r][c] = false;
        state.score += 10;
        state.dotsEaten++;
        setScore(state.score);
      }
      state.pellets.forEach(p => {
        if (!p.eaten && p.r === r && p.c === c) {
          p.eaten = true;
          state.score += 50;
          setScore(state.score);
          if (p.type === 'speed') {
            state.speedBoostTimer = SPEED_BOOST_DURATION;
          } else if (p.type === 'freeze') {
            state.freezeTimer = FREEZE_DURATION;
          } else {
            state.ghosts.forEach(g => { g.scared = true; g.scaredTimer = SCARED_DURATION; });
          }
        }
      });
    }

    function checkWin() {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (state.dots[r][c]) return false;
        }
      }
      return state.pellets.every(p => p.eaten);
    }

    function checkGhostCollision() {
      const pc = cellOf(state.player);
      for (const g of state.ghosts) {
        const gc = cellOf(g);
        if (gc.r === pc.r && gc.c === pc.c) {
          if (g.scared) {
            state.score += 200;
            setScore(state.score);
            g.x = g.spawn.c * CELL;
            g.y = g.spawn.r * CELL;
            g.scared = false;
            g.scaredTimer = 0;
            g.dir = { dx: 0, dy: 0 };
            g.respawnFlash = 40;
          } else {
            state.lives--;
            setLives(state.lives);
            if (state.lives <= 0) {
              endGame(false);
            } else {
              state.player.x = PLAYER_START.c * CELL;
              state.player.y = PLAYER_START.r * CELL;
              state.player.dir = { dx: 0, dy: 0 };
              state.player.next = { dx: 0, dy: 0 };
              state.ghosts.forEach(gh => {
                gh.x = gh.spawn.c * CELL;
                gh.y = gh.spawn.r * CELL;
                gh.dir = { dx: 1, dy: 0 };
                gh.scared = false;
                gh.scaredTimer = 0;
              });
              state.graceTimer = GRACE_PERIOD;
            }
            return;
          }
        }
      }
    }

    async function endGame(win) {
      state.running = false;
      state.won = win;
      setGameOver(true);
      setGameWon(win);
      setGameStarted(false);

      if (user && user.id) {
        let ptsAwarded = 0;
        let msg = '';
        if (win) {
          ptsAwarded = 50;
          msg = '+50 Loyalty Points Earned for Victory!';
        } else if (state.totalDots > 0 && (state.dotsEaten / state.totalDots) >= 0.5) {
          ptsAwarded = 20;
          msg = '+20 Loyalty Points Earned for Progress!';
        }

        if (ptsAwarded > 0) {
          setRewardMsg(msg);
          const currentPts = user.points || 0;
          const newTotal = currentPts + ptsAwarded;

          setUser(prev => prev ? ({ ...prev, points: newTotal }) : prev);

          try {
            const { data, error } = await supabase.rpc('claim_munchman_reward', {
              p_won: win,
              p_dots_eaten: state.dotsEaten,
              p_total_dots: state.totalDots
            });

            if (error) {
              await supabase.from('profiles').update({ points: newTotal }).eq('id', user.id);
            } else if (data && data.total_points !== undefined) {
              setUser(prev => prev ? ({ ...prev, points: data.total_points }) : prev);
            }
          } catch (err) {
            await supabase.from('profiles').update({ points: newTotal }).eq('id', user.id);
          }
        }
      }
    }

    function drawMaze() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0a0f1d';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#1e293b';
      ctx.shadowColor = 'rgba(56, 189, 248, 0.4)';
      ctx.shadowBlur = 10;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (maze[r][c]) {
            ctx.beginPath();
            ctx.roundRect(c * CELL + 2, r * CELL + 2, CELL - 4, CELL - 4, 4);
            ctx.fill();
          }
        }
      }
      ctx.shadowBlur = 0;

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (state.dots[r] && state.dots[r][c]) {
            drawMiniBurger(c * CELL + CELL / 2, r * CELL + CELL / 2, 5);
          }
        }
      }

      state.pellets.forEach(p => {
        if (!p.eaten) {
          const px = p.c * CELL + CELL / 2;
          const py = p.r * CELL + CELL / 2;
          const ringColor = p.type === 'speed' ? '#FFD23F' : p.type === 'freeze' ? '#4FC3F7' : '#E8491D';
          const pulse = 1 + Math.sin(Date.now() / 220) * 0.12;
          ctx.strokeStyle = ringColor;
          ctx.lineWidth = 2;

          ctx.shadowColor = ringColor;
          ctx.shadowBlur = 8;

          ctx.beginPath();
          ctx.arc(px, py, 12 * pulse, 0, Math.PI * 2);
          ctx.stroke();

          ctx.shadowBlur = 0;
          drawMiniBurger(px, py, 9);
        }
      });
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
      if (size > 6) {
        ctx.fillStyle = '#FFE9C4';
        ctx.beginPath();
        ctx.arc(cx - size * 0.4, cy - size * 0.55, 1, 0, Math.PI * 2);
        ctx.arc(cx + size * 0.2, cy - size * 0.65, 1, 0, Math.PI * 2);
        ctx.arc(cx + size * 0.6, cy - size * 0.4, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const TREX_DRAW_W = 32;
    const TREX_DRAW_H = TREX_DRAW_W * (121 / 180);

    function drawPlayer() {
      const cx = state.player.x + CELL / 2;
      const cy = state.player.y + CELL / 2;
      const facing = (state.player.dir.dx || state.player.dir.dy) ? Math.atan2(state.player.dir.dy, state.player.dir.dx) : 0;
      const faceRight = Math.cos(facing) >= 0;
      let flip = faceRight ? 1 : -1;

      const moving = (state.player.dir.dx || state.player.dir.dy);
      const bounce = moving ? Math.abs(Math.sin(Date.now() / 140)) * 2 : 0;

      ctx.save();
      ctx.translate(cx, cy - bounce);
      ctx.scale(flip, 1);

      if (trexImg.complete && trexImg.naturalWidth > 0) {
        ctx.drawImage(trexImg, -TREX_DRAW_W / 2, -TREX_DRAW_H / 2, TREX_DRAW_W, TREX_DRAW_H);
      } else {
        ctx.fillStyle = '#FFC72C';
        ctx.beginPath();
        ctx.arc(0, 0, 9.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    function drawGhosts() {
      state.ghosts.forEach(g => {
        const cx = g.x + CELL / 2;
        const cy = g.y + CELL / 2;

        if (g.respawnFlash > 0) {
          const t = g.respawnFlash / 40;
          ctx.save();
          ctx.globalAlpha = t;
          ctx.strokeStyle = '#FFD23F';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, 16 * (1.6 - t), 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        const scaredLook = g.scared;
        const blink = g.scared && g.scaredTimer < 90 && Math.floor(Date.now() / 150) % 2 === 0;
        const base = scaredLook ? (blink ? '#fff' : '#4FC3F7') : g.color;
        const dark = scaredLook ? (blink ? '#ccc' : '#1E88C7') : g.dark;

        ctx.fillStyle = base;
        ctx.beginPath();
        ctx.roundRect(cx - 7, cy - 10, 14, 20, 7);
        ctx.fill();

        if (!scaredLook) {
          ctx.fillStyle = dark;
          const bumps = [[-3, -5], [3, -1], [-2, 3], [3, 7]];
          bumps.forEach(([bx, by]) => {
            ctx.beginPath();
            ctx.arc(cx + bx, cy + by, 1.2, 0, Math.PI * 2);
            ctx.fill();
          });
        }

        if (scaredLook) {
          ctx.strokeStyle = '#0a3a52';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(cx - 3.5, cy - 2); ctx.lineTo(cx - 1.5, cy);
          ctx.moveTo(cx - 1.5, cy - 2); ctx.lineTo(cx - 3.5, cy);
          ctx.moveTo(cx + 1.5, cy - 2); ctx.lineTo(cx + 3.5, cy);
          ctx.moveTo(cx + 3.5, cy - 2); ctx.lineTo(cx + 1.5, cy);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cx, cy + 4, 2.5, Math.PI * 0.15, Math.PI * 0.85);
          ctx.stroke();
        } else {
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(cx - 3, cy - 3, 2.4, 0, Math.PI * 2);
          ctx.arc(cx + 3, cy - 3, 2.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#14140f';
          ctx.beginPath();
          ctx.arc(cx - 3, cy - 2.3, 1.1, 0, Math.PI * 2);
          ctx.arc(cx + 3, cy - 2.3, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    function drawFreezeOverlay() {
      ctx.save();
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = '#4FC3F7';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    function handleKeyDown(e) {
      const map = {
        ArrowUp: { dx: 0, dy: -1 }, w: { dx: 0, dy: -1 }, W: { dx: 0, dy: -1 },
        ArrowDown: { dx: 0, dy: 1 }, s: { dx: 0, dy: 1 }, S: { dx: 0, dy: 1 },
        ArrowLeft: { dx: -1, dy: 0 }, a: { dx: -1, dy: 0 }, A: { dx: -1, dy: 0 },
        ArrowRight: { dx: 1, dy: 0 }, d: { dx: 1, dy: 0 }, D: { dx: 1, dy: 0 }
      };
      if (map[e.key]) {
        e.preventDefault();
        state.player.next = map[e.key];
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    function loop() {
      if (state.running) {
        if (state.speedBoostTimer > 0) state.speedBoostTimer--;
        const effectivePlayerSpeed = state.speedBoostTimer > 0
          ? Math.round(state.player.speed * SPEED_BOOST_MULTIPLIER)
          : state.player.speed;

        tryMove(state.player, state.player.next, effectivePlayerSpeed);
        checkDotEat();

        if (state.freezeTimer > 0) state.freezeTimer--;
        if (state.graceTimer > 0) {
          state.graceTimer--;
        } else {
          state.ghosts.forEach(g => {
            if (g.scared) {
              g.scaredTimer--;
              if (g.scaredTimer <= 0) g.scared = false;
            }
            if (g.respawnFlash > 0) g.respawnFlash--;
            if (state.freezeTimer > 0) return;
            ghostChooseDir(g);
            tryMove(g, g.dir, g.scared ? GHOST_SCARED_SPEED : g.speed);
          });
          checkGhostCollision();
        }

        if (state.running && checkWin()) endGame(true);
        drawMaze();
        drawPlayer();
        drawGhosts();
        if (state.freezeTimer > 0) drawFreezeOverlay();
      } else {
        drawMaze();
        drawPlayer();
        drawGhosts();
      }
      state.animFrameId = requestAnimationFrame(loop);
    }

    resetGame();
    loop();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (state.animFrameId) cancelAnimationFrame(state.animFrameId);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePlayButtonClick = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const savedDate = localStorage.getItem('munchman_rules_date');
    const savedCount = parseInt(localStorage.getItem('munchman_rules_count') || '0', 10);

    let currentCount = savedCount;
    if (savedDate !== todayStr) {
      currentCount = 0;
    }

    if (currentCount < 2) {
      setShowRules(true);
    } else {
      executeStartGameSession();
    }
  };

  const handleConfirmRules = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const savedDate = localStorage.getItem('munchman_rules_date');
    const savedCount = parseInt(localStorage.getItem('munchman_rules_count') || '0', 10);

    let nextCount = savedCount + 1;
    if (savedDate !== todayStr) {
      nextCount = 1;
    }

    localStorage.setItem('munchman_rules_date', todayStr);
    localStorage.setItem('munchman_rules_count', nextCount.toString());

    setShowRules(false);
    executeStartGameSession();
  };

  const executeStartGameSession = async () => {
    setRewardMsg(null);

    if (user) {
      try {
        const { data, error } = await supabase.rpc('start_munchman_session');
        if (!error && data) {
          setStreak(data.streak || 0);
          if (data.bonus_points) {
            setUser(prev => ({ ...prev, points: (prev.points || 0) + data.bonus_points }));
          }
        } else {
          await supabase.from('game_plays').insert([{
            user_id: user.id,
            game_name: 'munch_man',
            played_at: new Date().toISOString()
          }]);
        }
      } catch (err) {
        console.error('Error starting game session:', err);
      }
    }

    setCanPlay(false);
    setAlreadyPlayedToday(true);

    if (gameStateRef.current) {
      const s = gameStateRef.current;
      s.dots = [];
      let totalCount = 0;
      const COLS = 17, ROWS = 15, CELL = 24;

      function isWall(r, c) {
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return true;
        return (r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1 || (! (r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1) && r % 2 === 0 && c % 2 === 0));
      }

      for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) {
          const free = !isWall(r, c);
          row.push(free);
          if (free) totalCount++;
        }
        s.dots.push(row);
      }

      const PLAYER_START = { r: ROWS - 2, c: Math.floor(COLS / 2) };
      const GHOST_STARTS = [
        { r: 1, c: 5, color: '#6FBF3E', dark: '#3E7A21', name: 'Dill' },
        { r: 1, c: 11, color: '#8FCB4A', dark: '#4E8B27', name: 'Gherkin' },
        { r: 7, c: 8, color: '#5BAA33', dark: '#356A1B', name: 'Relish' }
      ];
      const PELLET_SPOTS = [
        { r: 1, c: 1, type: 'scare' },
        { r: 1, c: COLS - 2, type: 'speed' },
        { r: ROWS - 2, c: 1, type: 'freeze' },
        { r: ROWS - 2, c: COLS - 2, type: 'scare' }
      ];

      s.pellets = PELLET_SPOTS.map(p => ({ ...p, eaten: false }));
      s.pellets.forEach(p => {
        if (s.dots[p.r][p.c]) { s.dots[p.r][p.c] = false; totalCount--; }
      });
      if (s.dots[PLAYER_START.r][PLAYER_START.c]) {
        s.dots[PLAYER_START.r][PLAYER_START.c] = false;
        totalCount--;
      }
      GHOST_STARTS.forEach(g => {
        if (s.dots[g.r][g.c]) { s.dots[g.r][g.c] = false; totalCount--; }
      });

      s.totalDots = totalCount;
      s.dotsEaten = 0;

      s.player.x = PLAYER_START.c * CELL;
      s.player.y = PLAYER_START.r * CELL;
      s.player.dir = { dx: 0, dy: 0 };
      s.player.next = { dx: 0, dy: 0 };

      s.ghosts = GHOST_STARTS.map(g => ({
        x: g.c * CELL, y: g.r * CELL, dir: { dx: 1, dy: 0 },
        color: g.color, dark: g.dark, name: g.name, scared: false, scaredTimer: 0,
        speed: 1, spawn: { r: g.r, c: g.c }, respawnFlash: 0
      }));

      s.score = 0;
      s.lives = 3;
      s.running = true;
      s.won = false;
      s.speedBoostTimer = 0;
      s.freezeTimer = 0;
      s.graceTimer = 120;
    }

    setScore(0);
    setLives(3);
    setGameStarted(true);
    setGameOver(false);
  };

  const setDir = (dir) => {
    if (gameStateRef.current) {
      gameStateRef.current.player.next = dir;
    }
  };

  return (
    <>
      <div className="munchman-modal-overlay" onClick={onClose}>
        <div className="munchman-modal-content" onClick={(e) => e.stopPropagation()}>
          <button className="munchman-close-btn" onClick={onClose}>
            <X size={20} />
          </button>

          <div className="munchman-container">
            <h1>Munch-Man</h1>

            <div className="munchman-hud">
              <span id="score">Score: {score}</span>
              {streak > 0 && (
                <span style={{ color: '#FFC72C', fontSize: 13, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <Flame size={14} color="#FF9800" /> {streak}d Streak
                </span>
              )}
              <div className="munchman-lives">
                {Array.from({ length: lives }).map((_, i) => (
                  <div key={i} className="munchman-life"></div>
                ))}
              </div>
            </div>

            <div className="munchman-canvas-wrap">
              <canvas ref={canvasRef}></canvas>

              {(!gameStarted || gameOver) && (
                <div className="munchman-overlay-screen">
                  {checkingPlayStatus ? (
                    <p style={{ color: '#ccc' }}>Checking play status...</p>
                  ) : alreadyPlayedToday && !gameOver ? (
                    <>
                      <Lock size={36} color="#FFC72C" style={{ marginBottom: 8 }} />
                      <h2>Played Today!</h2>
                      <p>Come back tomorrow for another free play!</p>
                      {streak > 0 && (
                        <p style={{ fontSize: 12, color: '#FFC72C' }}>
                          🔥 Daily Streak: {streak} Day{streak > 1 ? 's' : ''}
                        </p>
                      )}
                    </>
                  ) : !gameOver ? (
                    <>
                      <h2>Ready to Munch?</h2>
                      <p>Gobble every mini burger before the Pickle Bunch catches your T-Rex! Grab a giant burger power-up to turn the tables.</p>
                      <button className="munchman-btn" onClick={handlePlayButtonClick}>
                        Play Now
                      </button>
                    </>
                  ) : (
                    <>
                      <h2>{gameWon ? '🎉 Victory!' : '💥 Game Over'}</h2>
                      <p>
                        {gameWon
                          ? `Every burger munched! Score: ${score}. Solid run.`
                          : `The Pickle Bunch caught your T-Rex. Score: ${score}.`}
                      </p>

                      {rewardMsg && (
                        <div style={{
                          background: 'rgba(255, 199, 44, 0.2)',
                          border: '1px solid #FFC72C',
                          color: '#FFC72C',
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

                      <p style={{ fontSize: 12, color: '#aaa', marginTop: 0 }}>
                        Come back tomorrow for your next free play!
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="munchman-touch-controls">
              <div className="munchman-tbtn" id="mm-up" onClick={() => setDir({ dx: 0, dy: -1 })}>&#9650;</div>
              <div className="munchman-tbtn" id="mm-left" onClick={() => setDir({ dx: -1, dy: 0 })}>&#9664;</div>
              <div className="munchman-tbtn" id="mm-right" onClick={() => setDir({ dx: 1, dy: 0 })}>&#9654;</div>
              <div className="munchman-tbtn" id="mm-down" onClick={() => setDir({ dx: 0, dy: 1 })}>&#9660;</div>
            </div>
          </div>
        </div>
      </div>

      <MunchManRulesModal
        isOpen={showRules}
        onClose={() => setShowRules(false)}
        onConfirm={handleConfirmRules}
        streak={streak}
      />
    </>
  );
}
