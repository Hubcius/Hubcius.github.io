'use strict';

/* =========================================================
   THE BIRTHDAY QUEST — for Olek
   Pure HTML/CSS/JS. No dependencies, no backend.
========================================================= */

/* ---------------------------------------------------------
   0. SMALL UTILITIES
--------------------------------------------------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------------------------------------------------------
   1. SCREEN MANAGEMENT
   Progression is gated purely by which function calls
   showScreen() — the puzzle screen only calls showScreen
   ('screen-maze') after a verified-correct accusation, and
   the maze only calls showScreen('screen-celebration') after
   the goal cell is actually reached. There is no hash-based
   routing, so screens cannot be jumped to via the URL.
--------------------------------------------------------- */
const state = {
  puzzleSolved: false,
  mazeSolved: false,
  muted: false,
};

function showScreen(id) {
  $$('.screen').forEach((s) => s.classList.remove('active'));
  const target = document.getElementById(id);
  target.classList.add('active');
}

/* ---------------------------------------------------------
   2. SOUND ENGINE (WebAudio synth — no audio files needed)
--------------------------------------------------------- */
let actx = null;
function ensureAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) actx = new AC();
  } else if (actx.state === 'suspended') {
    actx.resume();
  }
}

function tone(freq, start, dur, type = 'sine', vol = 0.18) {
  if (!actx || state.muted) return;
  const t0 = actx.currentTime + start;
  const osc = actx.createOscillator();
  const gain = actx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(actx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

const sfx = {
  click() { tone(520, 0, 0.09, 'triangle', 0.12); },
  hover() { tone(720, 0, 0.05, 'sine', 0.05); },
  step() { tone(300 + Math.random() * 40, 0, 0.06, 'square', 0.05); },
  wall() { tone(110, 0, 0.12, 'sawtooth', 0.1); },
  wrong() {
    tone(220, 0, 0.16, 'sawtooth', 0.14);
    tone(160, 0.08, 0.2, 'sawtooth', 0.12);
  },
  correct() {
    tone(523.25, 0, 0.14, 'triangle', 0.15);
    tone(659.25, 0.1, 0.14, 'triangle', 0.15);
    tone(783.99, 0.2, 0.22, 'triangle', 0.16);
  },
  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone(f, i * 0.12, 0.28, 'triangle', 0.16)
    );
  },
  fanfare() {
    const notes = [523.25, 523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    notes.forEach((f, i) => tone(f, i * 0.16, 0.3, 'triangle', 0.14));
  },
};

const muteBtn = $('#muteBtn');
muteBtn.addEventListener('click', () => {
  state.muted = !state.muted;
  muteBtn.textContent = state.muted ? '🔇' : '🔊';
});

/* ---------------------------------------------------------
   3. STARFIELD BACKGROUND (all screens)
--------------------------------------------------------- */
(function starfield() {
  const canvas = $('#starfield');
  const ctx = canvas.getContext('2d');
  let stars = [];
  let w, h;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    const count = Math.floor((w * h) / 9000);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.4 + 0.3,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 0.8,
      hue: Math.random() < 0.15 ? 45 : 260,
    }));
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const tw = 0.55 + 0.45 * Math.sin(t * 0.001 * s.speed + s.phase);
      ctx.beginPath();
      ctx.fillStyle = `hsla(${s.hue}, 90%, 80%, ${tw})`;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(draw);
})();

/* ---------------------------------------------------------
   4. START SCREEN
--------------------------------------------------------- */
$('#startBtn').addEventListener('click', () => {
  ensureAudio();
  sfx.click();
  showScreen('screen-puzzle');
  initPuzzle();
});

/* ---------------------------------------------------------
   5. LOGIC PUZZLE — "The Guests Who Stayed"
   ---------------------------------------------------------
   Four guests, three linked attributes (name / favorite cake
   flavor / hiding spot). Five clues, each one PROVEN necessary
   (removing any single clue produces more than one possible
   solution), and together they pin down exactly ONE consistent
   assignment. This was brute-force verified across all 4!×4!
   permutations before shipping.

   Solution (unique):
     Kuba  -> Chocolate  -> Gift Box   <-- the culprit
     Nina  -> Vanilla    -> Balloon
     Zosia -> Lemon       -> Rug
     Tomek -> Strawberry  -> Cake
--------------------------------------------------------- */
const NAMES = ['Nina', 'Kuba', 'Zosia', 'Tomek'];
const FLAVORS = ['Vanilla', 'Chocolate', 'Lemon', 'Strawberry'];
const SPOTS = ['Balloon Pile', 'Gift Box', 'Rug', 'Cake Stand'];

const PUZZLE_SOLUTION = { name: 'Kuba', flavor: 'Chocolate', spot: 'Gift Box' };

const CLUES = [
  'Tomek has a well-known sweet tooth for <b>Strawberry</b> cake.',
  'Whoever loves <b>Chocolate</b> cake hid their secret inside the <b>Gift Box</b>.',
  'Whoever hid something on the <b>Cake Stand</b> loves <b>Strawberry</b> cake.',
  'Nina\'s favorite flavor, without question, is <b>Vanilla</b>.',
  'Zosia was seen crouching by the <b>Rug</b> just before the key vanished.',
];

let puzzleInitialized = false;

function initPuzzle() {
  if (puzzleInitialized) return;
  puzzleInitialized = true;

  const clueList = $('#clueList');
  CLUES.forEach((text, i) => {
    const li = document.createElement('li');
    li.style.animationDelay = `${i * 0.12}s`;
    li.innerHTML = `<span class="clue-num">${i + 1}.</span>${text}`;
    clueList.appendChild(li);
  });

  fillSelect('#selName', NAMES);
  fillSelect('#selFlavor', FLAVORS);
  fillSelect('#selSpot', SPOTS);

  $('#submitPuzzle').addEventListener('click', onPuzzleSubmit);
}

function fillSelect(selector, options) {
  const el = $(selector);
  shuffle(options).forEach((opt) => {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    el.appendChild(o);
  });
}

function onPuzzleSubmit() {
  ensureAudio();
  const name = $('#selName').value;
  const flavor = $('#selFlavor').value;
  const spot = $('#selSpot').value;
  const feedback = $('#puzzleFeedback');

  if (!name || !flavor || !spot) {
    sfx.wrong();
    feedback.textContent = 'Choose all three before making your accusation.';
    feedback.className = 'feedback wrong';
    return;
  }

  const isCorrect =
    name === PUZZLE_SOLUTION.name &&
    flavor === PUZZLE_SOLUTION.flavor &&
    spot === PUZZLE_SOLUTION.spot;

  if (isCorrect) {
    sfx.correct();
    state.puzzleSolved = true;
    feedback.textContent = `Correct! ${name} loved ${flavor} cake and hid the key in the ${spot}. The truth is revealed...`;
    feedback.className = 'feedback correct';
    $('#submitPuzzle').disabled = true;
    $$('#screen-puzzle select').forEach((s) => (s.disabled = true));
    setTimeout(() => {
      showScreen('screen-maze');
      initMaze();
    }, 1600);
  } else {
    sfx.wrong();
    feedback.textContent = 'That doesn\'t fit all the clues. Look again...';
    feedback.className = 'feedback wrong';
  }
}

/* ---------------------------------------------------------
   6. MAZE — generated fresh each playthrough, guaranteed
   solvable (recursive-backtracker spanning tree + a BFS
   safety check that regenerates in the extremely unlikely
   event a maze isn't fully connected).
--------------------------------------------------------- */
const MAZE_SIZE = 11; // cols/rows of cells
let maze = null; // { cells, size }
let player = { x: 0, y: 0 };
let goal = { x: MAZE_SIZE - 1, y: MAZE_SIZE - 1 };
let visited = new Set();
let mazeCtx = null;
let mazeCanvas = null;
let cellPx = 0;
let mazeReady = false;
let shakeUntil = 0;

function generateMaze(size) {
  const cells = Array.from({ length: size * size }, () => ({
    N: true, E: true, S: true, W: true, seen: false,
  }));
  const idx = (x, y) => y * size + x;

  const stack = [{ x: 0, y: 0 }];
  cells[0].seen = true;

  while (stack.length) {
    const cur = stack[stack.length - 1];
    const neighbors = [];
    const dirs = [
      { dx: 0, dy: -1, self: 'N', opp: 'S' },
      { dx: 1, dy: 0, self: 'E', opp: 'W' },
      { dx: 0, dy: 1, self: 'S', opp: 'N' },
      { dx: -1, dy: 0, self: 'W', opp: 'E' },
    ];
    for (const d of dirs) {
      const nx = cur.x + d.dx, ny = cur.y + d.dy;
      if (nx >= 0 && nx < size && ny >= 0 && ny < size && !cells[idx(nx, ny)].seen) {
        neighbors.push({ x: nx, y: ny, ...d });
      }
    }
    if (neighbors.length) {
      const n = neighbors[Math.floor(Math.random() * neighbors.length)];
      cells[idx(cur.x, cur.y)][n.self] = false;
      cells[idx(n.x, n.y)][n.opp] = false;
      cells[idx(n.x, n.y)].seen = true;
      stack.push({ x: n.x, y: n.y });
    } else {
      stack.pop();
    }
  }
  return { cells, size };
}

function isReachable(m, start, end) {
  const { cells, size } = m;
  const idx = (x, y) => y * size + x;
  const seen = new Set([idx(start.x, start.y)]);
  const q = [start];
  while (q.length) {
    const { x, y } = q.shift();
    if (x === end.x && y === end.y) return true;
    const c = cells[idx(x, y)];
    const options = [];
    if (!c.N) options.push({ x, y: y - 1 });
    if (!c.E) options.push({ x: x + 1, y });
    if (!c.S) options.push({ x, y: y + 1 });
    if (!c.W) options.push({ x: x - 1, y });
    for (const o of options) {
      const k = idx(o.x, o.y);
      if (!seen.has(k)) {
        seen.add(k);
        q.push(o);
      }
    }
  }
  return false;
}

function buildSolvableMaze() {
  let m, tries = 0;
  do {
    m = generateMaze(MAZE_SIZE);
    tries++;
  } while (!isReachable(m, { x: 0, y: 0 }, { x: MAZE_SIZE - 1, y: MAZE_SIZE - 1 }) && tries < 10);
  return m;
}

function initMaze() {
  maze = buildSolvableMaze();
  player = { x: 0, y: 0 };
  visited = new Set([`0,0`]);
  mazeReady = true;

  mazeCanvas = $('#mazeCanvas');
  mazeCtx = mazeCanvas.getContext('2d');
  resizeMazeCanvas();
  drawMaze();
}

function resizeMazeCanvas() {
  if (!mazeCanvas) return;
  const wrap = mazeCanvas.parentElement;
  const maxW = Math.min(wrap.clientWidth || 560, 560);
  const size = Math.max(260, maxW);
  const dpr = window.devicePixelRatio || 1;
  cellPx = size / MAZE_SIZE;

  mazeCanvas.style.width = size + 'px';
  mazeCanvas.style.height = size + 'px';
  mazeCanvas.width = Math.floor(size * dpr);
  mazeCanvas.height = Math.floor(size * dpr);
  mazeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', () => {
  if (mazeReady) {
    resizeMazeCanvas();
    drawMaze();
  }
});

function drawMaze() {
  if (!mazeReady) return;
  const ctx = mazeCtx;
  const size = MAZE_SIZE;
  const px = cellPx;
  const w = size * px, h = size * px;

  const now = performance.now();
  ctx.save();
  if (now < shakeUntil) {
    const dt = shakeUntil - now;
    ctx.translate((Math.random() - 0.5) * 4 * (dt / 200), (Math.random() - 0.5) * 4 * (dt / 200));
  }

  ctx.clearRect(-10, -10, w + 20, h + 20);

  // subtle visited trail
  ctx.fillStyle = 'rgba(138, 92, 246, 0.12)';
  visited.forEach((key) => {
    const [x, y] = key.split(',').map(Number);
    ctx.fillRect(x * px + 2, y * px + 2, px - 4, px - 4);
  });

  // goal glow
  const gx = goal.x * px + px / 2, gy = goal.y * px + px / 2;
  const pulse = 0.6 + 0.4 * Math.sin(now * 0.005);
  const grad = ctx.createRadialGradient(gx, gy, 2, gx, gy, px * 0.9);
  grad.addColorStop(0, `rgba(244, 201, 93, ${0.55 * pulse})`);
  grad.addColorStop(1, 'rgba(244, 201, 93, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(gx - px, gy - px, px * 2, px * 2);
  ctx.font = `${px * 0.6}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🎁', gx, gy + 1);

  // walls
  ctx.strokeStyle = '#f4c95d';
  ctx.lineWidth = Math.max(2, px * 0.06);
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(244, 201, 93, 0.45)';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = maze.cells[y * size + x];
      const x0 = x * px, y0 = y * px, x1 = x0 + px, y1 = y0 + px;
      if (c.N) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); }
      if (c.W) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); }
      if (y === size - 1 && c.S) { ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); }
      if (x === size - 1 && c.E) { ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); }
    }
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  // outer border
  ctx.strokeStyle = 'rgba(244, 201, 93, 0.6)';
  ctx.lineWidth = Math.max(2, px * 0.05);
  ctx.strokeRect(0, 0, w, h);

  // player
  const px_ = player.x * px + px / 2, py_ = player.y * px + px / 2;
  const glow = ctx.createRadialGradient(px_, py_, 1, px_, py_, px * 0.7);
  glow.addColorStop(0, 'rgba(247, 83, 158, 0.85)');
  glow.addColorStop(1, 'rgba(247, 83, 158, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(px_ - px, py_ - px, px * 2, px * 2);

  ctx.beginPath();
  ctx.fillStyle = '#ffe08a';
  ctx.arc(px_, py_, px * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#f7539e';
  ctx.stroke();

  ctx.restore();
  if (mazeReady) requestAnimationFrame(drawMaze);
}

function movePlayer(dir) {
  if (!mazeReady || state.mazeSolved) return;
  const c = maze.cells[player.y * MAZE_SIZE + player.x];
  let nx = player.x, ny = player.y, blocked = false;

  if (dir === 'up') { if (!c.N) ny--; else blocked = true; }
  else if (dir === 'down') { if (!c.S) ny++; else blocked = true; }
  else if (dir === 'left') { if (!c.W) nx--; else blocked = true; }
  else if (dir === 'right') { if (!c.E) nx++; else blocked = true; }

  if (blocked) {
    sfx.wall();
    shakeUntil = performance.now() + 180;
    return;
  }

  player.x = nx;
  player.y = ny;
  visited.add(`${nx},${ny}`);
  sfx.step();

  if (player.x === goal.x && player.y === goal.y) {
    state.mazeSolved = true;
    sfx.win();
    setTimeout(() => {
      showScreen('screen-celebration');
      startCelebration();
    }, 500);
  }
}

const KEY_MAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};
window.addEventListener('keydown', (e) => {
  if (!$('#screen-maze').classList.contains('active')) return;
  const dir = KEY_MAP[e.code];
  if (dir) {
    e.preventDefault();
    ensureAudio();
    movePlayer(dir);
  }
});

$$('.dpad-btn').forEach((btn) => {
  const go = (e) => {
    e.preventDefault();
    ensureAudio();
    movePlayer(btn.dataset.dir);
  };
  btn.addEventListener('click', go);
  btn.addEventListener('touchstart', go, { passive: false });
});

// swipe support directly on the maze canvas (mobile bonus control)
(function swipeControls() {
  let sx = 0, sy = 0, tracking = false;
  const canvasHolder = $('.maze-wrap');
  canvasHolder.addEventListener('touchstart', (e) => {
    if (!e.touches[0]) return;
    tracking = true;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }, { passive: true });
  canvasHolder.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    ensureAudio();
    if (Math.abs(dx) > Math.abs(dy)) movePlayer(dx > 0 ? 'right' : 'left');
    else movePlayer(dy > 0 ? 'down' : 'up');
  }, { passive: true });
})();

/* ---------------------------------------------------------
   7. CELEBRATION — confetti + heartfelt message
--------------------------------------------------------- */
const BIRTHDAY_MESSAGE =
  "You cracked the case and conquered the labyrinth — exactly the kind of stubborn, clever energy that makes you, well, you. " +
  "Here's to another year of chaos, laughter, terrible jokes, and everything in between. " +
  "Go eat some cake, open your presents, and enjoy being the birthday legend of the day. " +
  "Happy Birthday, Olek. 🎂✨";

let confettiCanvas, confettiCtx, confettiParticles = [], confettiRunning = false;

function startCelebration() {
  typeMessage($('#birthdayMessage'), BIRTHDAY_MESSAGE);
  sfx.fanfare();
  initConfetti();
}

function typeMessage(el, text) {
  el.textContent = '';
  let i = 0;
  const speed = 18;
  function step() {
    el.textContent = text.slice(0, i);
    i++;
    if (i <= text.length) setTimeout(step, speed);
  }
  step();
}

function initConfetti() {
  confettiCanvas = $('#confettiCanvas');
  confettiCtx = confettiCanvas.getContext('2d');
  resizeConfetti();
  const colors = ['#f4c95d', '#f7539e', '#8a5cf6', '#4de3c1', '#ffe08a'];

  confettiParticles = Array.from({ length: 160 }, () => spawnConfetto(colors, true));

  if (!confettiRunning) {
    confettiRunning = true;
    requestAnimationFrame(confettiLoop);
  }

  // gentle extra bursts
  let bursts = 0;
  const burstTimer = setInterval(() => {
    bursts++;
    for (let i = 0; i < 40; i++) confettiParticles.push(spawnConfetto(colors, false));
    if (bursts >= 4) clearInterval(burstTimer);
  }, 1400);
}

function spawnConfetto(colors, fromTop) {
  return {
    x: Math.random() * window.innerWidth,
    y: fromTop ? -20 - Math.random() * window.innerHeight * 0.5 : -20,
    vx: (Math.random() - 0.5) * 2.2,
    vy: 2 + Math.random() * 2.4,
    size: 6 + Math.random() * 7,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.25,
    shape: Math.random() < 0.5 ? 'rect' : 'circle',
  };
}

function resizeConfetti() {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}
window.addEventListener('resize', () => {
  if (confettiCanvas) resizeConfetti();
});

function confettiLoop() {
  const ctx = confettiCtx;
  const w = confettiCanvas.width, h = confettiCanvas.height;
  ctx.clearRect(0, 0, w, h);

  for (const p of confettiParticles) {
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    if (p.y > h + 30) {
      p.y = -20;
      p.x = Math.random() * w;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.shape === 'rect') {
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (confettiParticles.length > 500) confettiParticles.splice(0, confettiParticles.length - 500);

  requestAnimationFrame(confettiLoop);
}

/* ---------------------------------------------------------
   8. REPLAY
--------------------------------------------------------- */
$('#replayBtn').addEventListener('click', () => {
  sfx.click();
  state.puzzleSolved = false;
  state.mazeSolved = false;
  mazeReady = false;

  // reset puzzle UI
  $('#puzzleFeedback').textContent = '';
  $('#puzzleFeedback').className = 'feedback';
  $('#submitPuzzle').disabled = false;
  $$('#screen-puzzle select').forEach((s) => {
    s.disabled = false;
    s.value = '';
  });

  showScreen('screen-start');
});
