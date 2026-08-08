'use strict';

/* =====================================================================
   THE BIRTHDAY QUEST — for Olek
   Pure HTML + CSS + vanilla JS. No build step, no backend, no deps.

   Chapter I  — The Rune Lock : a Mastermind-style deduction lock.
                Every reading is honest, so the code is provably
                solvable by pure logic (verified: a player who only
                ever guesses codes consistent with previous readings
                averages ~2.4 attempts, worst case 4).
   Chapter II — The Labyrinth : a 17x17 braided maze under fog of war
                with 3 shards to collect before the gate unseals.
                Braiding adds loops, which defeats the "hug one wall"
                cheese that makes a plain maze trivial.
===================================================================== */

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const randInt = (n) => Math.floor(Math.random() * n);

/* ---------------------------------------------------------------------
   SCREEN ROUTING
   The celebration screen is only ever reached from inside the maze's
   goal check, which itself is only reachable after the lock is cracked.
   There is no URL/hash routing, so no chapter can be skipped.
--------------------------------------------------------------------- */
const state = { lockSolved: false, mazeSolved: false, muted: false };

function showScreen(id) {
  $$('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------------------------------------------------------------
   AUDIO — tiny WebAudio synth, so there are no sound files to 404
--------------------------------------------------------------------- */
let actx = null;
function ensureAudio() {
  try {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    } else if (actx.state === 'suspended') {
      actx.resume();
    }
  } catch (_) { /* audio is a nice-to-have; never break the game over it */ }
}

function tone(freq, delay, dur, type = 'sine', vol = 0.16) {
  if (!actx || state.muted) return;
  try {
    const t0 = actx.currentTime + delay;
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(actx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch (_) {}
}

const sfx = {
  click:  () => tone(520, 0, 0.09, 'triangle', 0.11),
  place:  () => tone(660, 0, 0.07, 'sine', 0.09),
  clear:  () => tone(280, 0, 0.08, 'sine', 0.08),
  step:   () => tone(190 + Math.random() * 30, 0, 0.05, 'square', 0.035),
  wall:   () => tone(95, 0, 0.11, 'sawtooth', 0.07),
  near:   () => { tone(420, 0, 0.12, 'triangle', 0.11); tone(500, 0.09, 0.12, 'triangle', 0.09); },
  wrong:  () => { tone(200, 0, 0.16, 'sawtooth', 0.11); tone(150, 0.09, 0.2, 'sawtooth', 0.1); },
  shard:  () => [660, 880, 1180].forEach((f, i) => tone(f, i * 0.07, 0.2, 'triangle', 0.13)),
  unlock: () => [392, 523, 659, 784].forEach((f, i) => tone(f, i * 0.1, 0.3, 'triangle', 0.14)),
  win:    () => [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.11, 0.28, 'triangle', 0.15)),
  fanfare:() => [523, 523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, i * 0.16, 0.32, 'triangle', 0.13)),
};

const muteBtn = $('#muteBtn');
muteBtn.addEventListener('click', () => {
  state.muted = !state.muted;
  muteBtn.textContent = state.muted ? '🔇' : '🔊';
});

/* ---------------------------------------------------------------------
   STARFIELD
--------------------------------------------------------------------- */
(function starfield() {
  const canvas = $('#starfield');
  const ctx = canvas.getContext('2d');
  let stars = [], w = 0, h = 0;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    stars = Array.from({ length: Math.floor((w * h) / 8000) }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.3 + 0.25,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 0.9,
      hue: Math.random() < 0.18 ? 45 : 265,
    }));
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * 0.001 * s.speed + s.phase);
      ctx.beginPath();
      ctx.fillStyle = `hsla(${s.hue}, 90%, 82%, ${tw * 0.85})`;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(draw);
})();

/* =====================================================================
   CHAPTER I — THE RUNE LOCK
===================================================================== */
const RUNES = [
  { sym: '✦', name: 'Star',  color: '#f4c95d' },
  { sym: '◆', name: 'Ember', color: '#f7539e' },
  { sym: '❋', name: 'Bloom', color: '#4de3c1' },
  { sym: '⬢', name: 'Hex',   color: '#8a5cf6' },
  { sym: '✹', name: 'Spark', color: '#ff9f45' },
  { sym: '☾', name: 'Moon',  color: '#7db8ff' },
];
const CODE_LEN = 4;

/* The two carved "ancient readings" the player starts with. */
const PROBES = [[0, 1, 2, 3], [4, 5, 1, 0]];

let secret = [];
let slotValues = [null, null, null, null];
let attempts = 0;
let oracleUses = 0;
let revealed = [];       // slot indices the Oracle has given away
let lockBuilt = false;

/* every ordered selection of 4 distinct runes out of 6 => 360 codes */
function allCodes() {
  const out = [];
  const n = RUNES.length;
  for (let a = 0; a < n; a++)
    for (let b = 0; b < n; b++) { if (b === a) continue;
      for (let c = 0; c < n; c++) { if (c === a || c === b) continue;
        for (let d = 0; d < n; d++) { if (d === a || d === b || d === c) continue;
          out.push([a, b, c, d]);
        } } }
  return out;
}
const ALL_CODES = allCodes();

function readLock(guess, code) {
  let exact = 0;
  for (let i = 0; i < CODE_LEN; i++) if (guess[i] === code[i]) exact++;
  let common = 0;
  for (const g of guess) if (code.indexOf(g) !== -1) common++;
  return { exact, misplaced: common - exact };
}

const sameCode = (a, b) => a.every((v, i) => v === b[i]);

/* Choose a secret whose candidate pool after the two free readings is
   big enough to be a real deduction, small enough to stay friendly. */
function pickSecret() {
  for (let tries = 0; tries < 500; tries++) {
    const cand = ALL_CODES[randInt(ALL_CODES.length)];
    if (PROBES.some((p) => sameCode(p, cand))) continue;
    const pool = ALL_CODES.filter((c) =>
      PROBES.every((p) => {
        const a = readLock(p, c), b = readLock(p, cand);
        return a.exact === b.exact && a.misplaced === b.misplaced;
      })
    );
    if (pool.length >= 6 && pool.length <= 40) return cand;
  }
  return [1, 5, 0, 2]; // verified fallback, should never be needed
}

function runeSpan(i, size) {
  const r = RUNES[i];
  return `<span style="color:${r.color};${size ? `font-size:${size};` : ''}
          text-shadow:0 0 10px ${r.color}66" title="${r.name}">${r.sym}</span>`;
}

function buildLockUI() {
  const palette = $('#palette');
  palette.innerHTML = '';
  RUNES.forEach((r, i) => {
    const b = document.createElement('button');
    b.className = 'rune-btn';
    b.dataset.rune = String(i);
    b.style.color = r.color;
    b.style.textShadow = `0 0 12px ${r.color}77`;
    b.textContent = r.sym;
    b.title = r.name;
    b.setAttribute('aria-label', `Place rune ${r.name}`);
    b.addEventListener('click', () => placeRune(i));
    palette.appendChild(b);
  });

  $$('.slot').forEach((s) =>
    s.addEventListener('click', () => clearSlot(Number(s.dataset.slot)))
  );
  $('#clearBtn').addEventListener('click', () => { sfx.clear(); resetSlots(); });
  $('#submitLock').addEventListener('click', trySubmitLock);
  $('#oracleBtn').addEventListener('click', consultOracle);
}

function initLock() {
  if (!lockBuilt) { buildLockUI(); lockBuilt = true; }

  secret = pickSecret();
  attempts = 0;
  oracleUses = 0;
  revealed = [];
  state.lockSolved = false;

  $('#lockLog').innerHTML = '';
  $('#lockFeedback').textContent = '';
  $('#lockFeedback').className = 'feedback';
  $('#oracleBtn').classList.add('is-hidden');
  $('#submitLock').disabled = true;
  $('#clearBtn').disabled = false;
  resetSlots();

  // Carve in the two free readings.
  PROBES.forEach((p) => addLogEntry(p, readLock(p, secret), 'ancient', 'Ancient'));
}

function resetSlots() {
  slotValues = [null, null, null, null];
  $$('.slot').forEach((s) => { s.innerHTML = ''; s.classList.remove('filled'); });
  $$('.rune-btn').forEach((b) => { b.disabled = false; });
  updateSubmitState();
}

function placeRune(i) {
  if (state.lockSolved) return;
  if (slotValues.indexOf(i) !== -1) return;        // no repeats
  const idx = slotValues.indexOf(null);
  if (idx === -1) return;                          // all slots full
  ensureAudio(); sfx.place();

  slotValues[idx] = i;
  const slot = $$('.slot')[idx];
  slot.innerHTML = runeSpan(i);
  slot.classList.add('filled');
  const btn = $(`.rune-btn[data-rune="${i}"]`);
  if (btn) btn.disabled = true;
  updateSubmitState();
}

function clearSlot(idx) {
  if (state.lockSolved) return;
  const v = slotValues[idx];
  if (v === null) return;
  ensureAudio(); sfx.clear();

  slotValues[idx] = null;
  const slot = $$('.slot')[idx];
  slot.innerHTML = '';
  slot.classList.remove('filled');
  const btn = $(`.rune-btn[data-rune="${v}"]`);
  if (btn) btn.disabled = false;
  updateSubmitState();
}

function updateSubmitState() {
  $('#submitLock').disabled = slotValues.some((v) => v === null);
}

function addLogEntry(guess, result, cls, tag) {
  const li = document.createElement('li');
  if (cls) li.className = cls;

  const runes = guess.map((g) => runeSpan(g)).join('');
  let pips = '';
  for (let i = 0; i < result.exact; i++) pips += '<span class="pip pip-exact"></span>';
  for (let i = 0; i < result.misplaced; i++) pips += '<span class="pip pip-near"></span>';
  for (let i = result.exact + result.misplaced; i < CODE_LEN; i++) pips += '<span class="pip pip-miss"></span>';

  li.innerHTML =
    `<span class="log-runes">${runes}</span>` +
    (tag ? `<span class="log-tag">${tag}</span>` : '') +
    `<span class="log-pips">${pips}</span>`;
  $('#lockLog').appendChild(li);
  return li;
}

function trySubmitLock() {
  if (state.lockSolved) return;
  if (slotValues.some((v) => v === null)) return;
  ensureAudio();

  const guess = slotValues.slice();
  const result = readLock(guess, secret);
  attempts++;

  const fbEl = $('#lockFeedback');

  if (result.exact === CODE_LEN) {
    state.lockSolved = true;
    sfx.unlock();
    addLogEntry(guess, result, 'hit', 'Opened');
    fbEl.textContent = 'The runes align. The lock falls open…';
    fbEl.className = 'feedback correct';
    $('#submitLock').disabled = true;
    $('#clearBtn').disabled = true;
    $('#oracleBtn').classList.add('is-hidden');
    $$('.rune-btn').forEach((b) => (b.disabled = true));
    setTimeout(() => { showScreen('screen-maze'); initMaze(); }, 1500);
    return;
  }

  sfx.near();
  addLogEntry(guess, result, '', null);

  const parts = [];
  if (result.exact) parts.push(`${result.exact} in the right slot`);
  if (result.misplaced) parts.push(`${result.misplaced} right rune, wrong slot`);
  fbEl.textContent = parts.length
    ? `The door answers: ${parts.join(' · ')}.`
    : 'The door answers: none of these runes belong to the code.';
  fbEl.className = 'feedback neutral';

  if (attempts >= 4 && oracleUses < 2) $('#oracleBtn').classList.remove('is-hidden');
  resetSlots();
}

function consultOracle() {
  if (state.lockSolved || oracleUses >= 2) return;
  ensureAudio(); sfx.click();

  let slot = -1;
  for (let i = 0; i < CODE_LEN; i++) if (revealed.indexOf(i) === -1) { slot = i; break; }
  if (slot === -1) return;

  revealed.push(slot);
  oracleUses++;

  const li = document.createElement('li');
  li.className = 'ancient';
  li.innerHTML =
    `<span class="log-runes">${runeSpan(secret[slot])}</span>` +
    `<span class="log-tag">Oracle</span>` +
    `<span class="log-pips" style="font-size:.78rem;color:var(--text-dim)">slot ${slot + 1}</span>`;
  $('#lockLog').appendChild(li);

  $('#lockFeedback').textContent =
    `The Oracle whispers: slot ${slot + 1} holds ${RUNES[secret[slot]].name}.`;
  $('#lockFeedback').className = 'feedback neutral';

  if (oracleUses >= 2) $('#oracleBtn').classList.add('is-hidden');
}

/* =====================================================================
   CHAPTER II — THE LABYRINTH
===================================================================== */
const SIZE = 17;
const BRAID = 0.18;   // fraction of dead ends opened up -> loops
const FOG = 3.3;      // lantern radius, in cells
const BEACON = 5.6;   // how far a shard's light bleeds through the fog
const REPEAT_MS = 115;
const DIRS = [
  { dx: 0, dy: -1, self: 'N', opp: 'S', key: 'up' },
  { dx: 1, dy: 0,  self: 'E', opp: 'W', key: 'right' },
  { dx: 0, dy: 1,  self: 'S', opp: 'N', key: 'down' },
  { dx: -1, dy: 0, self: 'W', opp: 'E', key: 'left' },
];

let cells = [];
let player = { x: 0, y: 0 };
let render = { x: 0, y: 0 };
let exitCell = { x: SIZE - 1, y: SIZE - 1 };
let shards = [];
let explored = new Set();
let trail = new Set();
let steps = 0;
let flashUntil = 0;
let shakeUntil = 0;
let mazeActive = false;
let loopRunning = false;
let mazeCanvas = null, mctx = null, cellPx = 0;

const idx = (x, y) => y * SIZE + x;
const inBounds = (x, y) => x >= 0 && x < SIZE && y >= 0 && y < SIZE;

function generateMaze() {
  const c = Array.from({ length: SIZE * SIZE }, () => ({ N: true, E: true, S: true, W: true, seen: false }));
  const stack = [{ x: 0, y: 0 }];
  c[0].seen = true;

  while (stack.length) {
    const cur = stack[stack.length - 1];
    const nb = [];
    for (const d of DIRS) {
      const nx = cur.x + d.dx, ny = cur.y + d.dy;
      if (inBounds(nx, ny) && !c[idx(nx, ny)].seen) nb.push({ nx, ny, d });
    }
    if (nb.length) {
      const pick = nb[randInt(nb.length)];
      c[idx(cur.x, cur.y)][pick.d.self] = false;
      c[idx(pick.nx, pick.ny)][pick.d.opp] = false;
      c[idx(pick.nx, pick.ny)].seen = true;
      stack.push({ x: pick.nx, y: pick.ny });
    } else stack.pop();
  }

  // Braid: knock out some dead ends so wall-following no longer solves it.
  const deads = [];
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const cc = c[idx(x, y)];
      if (['N', 'E', 'S', 'W'].filter((k) => cc[k]).length === 3) deads.push({ x, y });
    }
  for (let i = deads.length - 1; i > 0; i--) { const j = randInt(i + 1); [deads[i], deads[j]] = [deads[j], deads[i]]; }

  const nOpen = Math.floor(deads.length * BRAID);
  for (let i = 0; i < nOpen; i++) {
    const { x, y } = deads[i];
    const opts = DIRS.filter((d) => c[idx(x, y)][d.self] && inBounds(x + d.dx, y + d.dy));
    if (!opts.length) continue;
    const d = opts[randInt(opts.length)];
    c[idx(x, y)][d.self] = false;
    c[idx(x + d.dx, y + d.dy)][d.opp] = false;
  }
  return c;
}

/* BFS distances from a cell, walking only through open walls. */
function bfs(c, sx, sy) {
  const dist = new Map([[idx(sx, sy), 0]]);
  const q = [{ x: sx, y: sy }];
  for (let head = 0; head < q.length; head++) {
    const { x, y } = q[head];
    const cur = c[idx(x, y)];
    for (const d of DIRS) {
      if (cur[d.self]) continue;
      const nx = x + d.dx, ny = y + d.dy;
      if (!inBounds(nx, ny) || dist.has(idx(nx, ny))) continue;
      dist.set(idx(nx, ny), dist.get(idx(x, y)) + 1);
      q.push({ x: nx, y: ny });
    }
  }
  return dist;
}

/* Place 3 shards: reachable, a real trek from the start, spread apart.
   Constraints relax step by step so this can never fail to place them. */
function placeShards(c) {
  const dist = bfs(c, 0, 0);
  const out = [];
  for (let s = 0; s < 3; s++) {
    let placed = false;
    for (const [minDist, minGap] of [[SIZE, 5], [SIZE - 4, 4], [6, 3], [3, 2], [1, 0]]) {
      const pool = [];
      dist.forEach((dv, key) => {
        const x = key % SIZE, y = Math.floor(key / SIZE);
        if (dv < minDist) return;
        if (x === exitCell.x && y === exitCell.y) return;
        if (x === 0 && y === 0) return;
        if (out.some((o) => Math.max(Math.abs(o.x - x), Math.abs(o.y - y)) < minGap)) return;
        pool.push({ x, y });
      });
      if (pool.length) { out.push({ ...pool[randInt(pool.length)], taken: false }); placed = true; break; }
    }
    if (!placed) out.push({ x: 1, y: 1, taken: false });
  }
  return out;
}

function initMaze() {
  // Regenerate until every shard and the exit are provably reachable.
  for (let attempt = 0; attempt < 25; attempt++) {
    cells = generateMaze();
    const dist = bfs(cells, 0, 0);
    if (dist.size !== SIZE * SIZE) continue;            // fully connected
    if (!dist.has(idx(exitCell.x, exitCell.y))) continue;
    shards = placeShards(cells);
    if (shards.every((s) => dist.has(idx(s.x, s.y)))) break;
  }
  if (!Array.isArray(shards) || shards.length !== 3) shards = placeShards(cells);

  player = { x: 0, y: 0 };
  render = { x: 0, y: 0 };
  explored = new Set();
  trail = new Set([idx(0, 0)]);
  steps = 0;
  flashUntil = 0;
  shakeUntil = 0;
  state.mazeSolved = false;
  markExplored();

  mazeCanvas = $('#mazeCanvas');
  mctx = mazeCanvas.getContext('2d');
  resizeMaze();
  updateHUD();

  mazeActive = true;
  if (!loopRunning) { loopRunning = true; requestAnimationFrame(mazeLoop); }
}

function markExplored() {
  const r = Math.ceil(FOG);
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const x = player.x + dx, y = player.y + dy;
      if (inBounds(x, y) && Math.hypot(dx, dy) <= FOG) explored.add(idx(x, y));
    }
}

function resizeMaze() {
  if (!mazeCanvas) return;
  const wrap = mazeCanvas.parentElement;
  const avail = wrap.clientWidth || 560;
  // Cap by viewport height too: arrow keys are intercepted for movement, so the
  // board must fit on screen rather than forcing the player to scroll.
  const maxByHeight = Math.max(240, (window.innerHeight || 800) * 0.52);
  const size = Math.max(240, Math.min(avail, 620, maxByHeight));
  const dpr = window.devicePixelRatio || 1;
  cellPx = size / SIZE;
  mazeCanvas.style.width = size + 'px';
  mazeCanvas.style.height = size + 'px';
  mazeCanvas.width = Math.round(size * dpr);
  mazeCanvas.height = Math.round(size * dpr);
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', () => { if (mazeActive) resizeMaze(); });

const shardsLeft = () => shards.filter((s) => !s.taken).length;
const gateOpen = () => shardsLeft() === 0;

function updateHUD() {
  const got = 3 - shardsLeft();
  $('#hudShards').textContent = `${got} / 3`;
  $('#hudSteps').textContent = String(steps);
  const gate = $('#hudGate');
  if (gateOpen()) { gate.textContent = 'Open'; gate.className = 'hud-value open'; }
  else { gate.textContent = 'Sealed'; gate.className = 'hud-value locked'; }
}

/* ---------- rendering ---------- */
function lightAt(x, y) {
  const d = Math.hypot(x - render.x, y - render.y);
  if (d <= FOG) return 1 - 0.42 * (d / FOG);
  return explored.has(idx(x, y)) ? 0.26 : 0;
}

function mazeLoop(now) {
  if (!mazeActive) { loopRunning = false; return; }

  // held-key auto-repeat
  if (heldOrder.length && now - lastMoveAt > REPEAT_MS) {
    move(heldOrder[heldOrder.length - 1]);
    lastMoveAt = now;
  }

  render.x += (player.x - render.x) * 0.3;
  render.y += (player.y - render.y) * 0.3;
  if (Math.abs(render.x - player.x) < 0.002) render.x = player.x;
  if (Math.abs(render.y - player.y) < 0.002) render.y = player.y;

  drawMaze(now);
  requestAnimationFrame(mazeLoop);
}

function drawMaze(now) {
  const ctx = mctx, px = cellPx, W = SIZE * px;
  ctx.save();
  if (now < shakeUntil) {
    const k = (shakeUntil - now) / 160;
    ctx.translate((Math.random() - 0.5) * 5 * k, (Math.random() - 0.5) * 5 * k);
  }

  ctx.clearRect(-12, -12, W + 24, W + 24);
  ctx.fillStyle = '#05020c';
  ctx.fillRect(-12, -12, W + 24, W + 24);

  // floors + trail
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const a = lightAt(x, y);
      if (a <= 0.02) continue;
      ctx.fillStyle = `rgba(120, 84, 220, ${a * 0.11})`;
      ctx.fillRect(x * px, y * px, px, px);
      if (trail.has(idx(x, y))) {
        ctx.fillStyle = `rgba(247, 83, 158, ${a * 0.13})`;
        ctx.fillRect(x * px + px * 0.22, y * px + px * 0.22, px * 0.56, px * 0.56);
      }
    }

  // exit
  const ex = exitCell.x * px + px / 2, ey = exitCell.y * px + px / 2;
  const exitLight = gateOpen() ? Math.max(lightAt(exitCell.x, exitCell.y), 0.55) : lightAt(exitCell.x, exitCell.y);
  if (exitLight > 0.02) {
    const pulse = 0.6 + 0.4 * Math.sin(now * 0.005);
    if (gateOpen()) {
      const g = ctx.createRadialGradient(ex, ey, 1, ex, ey, px * 1.5);
      g.addColorStop(0, `rgba(244,201,93,${0.5 * pulse * exitLight})`);
      g.addColorStop(1, 'rgba(244,201,93,0)');
      ctx.fillStyle = g;
      ctx.fillRect(ex - px * 1.6, ey - px * 1.6, px * 3.2, px * 3.2);
    }
    ctx.globalAlpha = exitLight;
    ctx.font = `${px * 0.62}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(gateOpen() ? '🎁' : '🔒', ex, ey + 1);
    ctx.globalAlpha = 1;
  }

  // shards
  for (const s of shards) {
    if (s.taken) continue;
    const d = Math.hypot(s.x - render.x, s.y - render.y);
    const beaconA = d <= BEACON ? 0.22 * (1 - d / BEACON) : 0;
    const a = Math.max(lightAt(s.x, s.y), beaconA);
    if (a <= 0.02) continue;
    const sx = s.x * px + px / 2, sy = s.y * px + px / 2;
    const pulse = 0.65 + 0.35 * Math.sin(now * 0.006 + s.x + s.y);
    const g = ctx.createRadialGradient(sx, sy, 1, sx, sy, px * 1.25);
    g.addColorStop(0, `rgba(77, 227, 193, ${0.62 * a * pulse})`);
    g.addColorStop(1, 'rgba(77, 227, 193, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx - px * 1.3, sy - px * 1.3, px * 2.6, px * 2.6);
    ctx.globalAlpha = Math.min(1, a * 1.35);
    ctx.font = `${px * 0.5}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✦', sx, sy + 1);
    ctx.globalAlpha = 1;
  }

  // walls (only for lit/remembered cells — the fog IS the difficulty)
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.6, px * 0.085);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const a = lightAt(x, y);
      if (a <= 0.02) continue;
      const c = cells[idx(x, y)];
      const x0 = x * px, y0 = y * px, x1 = x0 + px, y1 = y0 + px;
      ctx.strokeStyle = `rgba(244, 201, 93, ${a * 0.9})`;
      ctx.beginPath();
      if (c.N) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); }
      if (c.W) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); }
      if (c.S) { ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); }
      if (c.E) { ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); }
      ctx.stroke();
    }

  // player
  const pxp = render.x * px + px / 2, pyp = render.y * px + px / 2;
  const lantern = ctx.createRadialGradient(pxp, pyp, 1, pxp, pyp, px * FOG);
  lantern.addColorStop(0, 'rgba(255, 224, 138, 0.20)');
  lantern.addColorStop(0.5, 'rgba(247, 83, 158, 0.07)');
  lantern.addColorStop(1, 'rgba(247, 83, 158, 0)');
  ctx.fillStyle = lantern;
  ctx.fillRect(pxp - px * FOG, pyp - px * FOG, px * FOG * 2, px * FOG * 2);

  ctx.beginPath();
  ctx.fillStyle = '#ffe6a3';
  ctx.arc(pxp, pyp, px * 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#f7539e';
  ctx.stroke();

  // pickup flash
  if (now < flashUntil) {
    ctx.fillStyle = `rgba(77, 227, 193, ${0.3 * ((flashUntil - now) / 260)})`;
    ctx.fillRect(0, 0, W, W);
  }

  ctx.restore();
}

/* ---------- movement ---------- */
function move(dirKey) {
  if (!mazeActive || state.mazeSolved) return;
  const d = DIRS.find((dd) => dd.key === dirKey);
  if (!d) return;

  const c = cells[idx(player.x, player.y)];
  if (c[d.self]) { sfx.wall(); shakeUntil = performance.now() + 160; return; }

  const nx = player.x + d.dx, ny = player.y + d.dy;
  if (!inBounds(nx, ny)) { sfx.wall(); shakeUntil = performance.now() + 160; return; }

  player.x = nx; player.y = ny;
  steps++;
  trail.add(idx(nx, ny));
  markExplored();
  sfx.step();

  const hit = shards.find((s) => !s.taken && s.x === nx && s.y === ny);
  if (hit) {
    hit.taken = true;
    flashUntil = performance.now() + 260;
    sfx.shard();
    if (gateOpen()) setTimeout(() => sfx.unlock(), 260);
  }

  updateHUD();

  if (gateOpen() && nx === exitCell.x && ny === exitCell.y) {
    state.mazeSolved = true;
    sfx.win();
    heldOrder.length = 0;
    setTimeout(() => { mazeActive = false; showScreen('screen-celebration'); startCelebration(); }, 550);
  }
}

const KEY_MAP = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};
const heldOrder = [];
let lastMoveAt = 0;

function hold(dir) {
  const i = heldOrder.indexOf(dir);
  if (i !== -1) heldOrder.splice(i, 1);
  heldOrder.push(dir);
}
function release(dir) {
  const i = heldOrder.indexOf(dir);
  if (i !== -1) heldOrder.splice(i, 1);
}

window.addEventListener('keydown', (e) => {
  if (!mazeActive) return;
  const dir = KEY_MAP[e.code];
  if (!dir) return;
  e.preventDefault();
  if (e.repeat) return;           // we run our own repeat timer
  ensureAudio();
  hold(dir);
  move(dir);
  lastMoveAt = performance.now();
});
window.addEventListener('keyup', (e) => {
  const dir = KEY_MAP[e.code];
  if (dir) release(dir);
});
window.addEventListener('blur', () => { heldOrder.length = 0; });

$$('.dpad-btn').forEach((btn) => {
  const dir = btn.dataset.dir;
  const down = (e) => {
    e.preventDefault();
    ensureAudio();
    hold(dir);
    move(dir);
    lastMoveAt = performance.now();
  };
  const up = (e) => { e.preventDefault(); release(dir); };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('pointerleave', up);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
});

/* swipe anywhere on the maze */
(function swipe() {
  const wrap = $('.maze-wrap');
  let sx = 0, sy = 0, on = false;
  wrap.addEventListener('touchstart', (e) => {
    if (!e.touches[0]) return;
    on = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  wrap.addEventListener('touchend', (e) => {
    if (!on) return; on = false;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
    ensureAudio();
    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  }, { passive: true });
})();

/* =====================================================================
   CHAPTER III — THE REVEAL
===================================================================== */
const BIRTHDAY_MESSAGE =
  "You picked a lock that only opened for someone patient enough to think it through, " +
  "then walked a pitch-black labyrinth and came out carrying the light. " +
  "That is extremely on-brand for you.\n\n" +
  "Thank you for the ridiculous jokes, the late-night talks, and for being the kind of friend " +
  "who makes ordinary days worth remembering. May this year bring you good chaos, better luck, " +
  "and everything you have been quietly hoping for.\n\n" +
  "Now go eat something with far too much frosting on it. You have earned it. 🎂";

let confettiCanvas = null, cctx = null, confetti = [], confettiOn = false;
let typeTimer = null;

function startCelebration() {
  const stats = $('#questStats');
  const oracleNote = oracleUses ? ` · ${oracleUses} oracle hint${oracleUses > 1 ? 's' : ''}` : '';
  stats.innerHTML =
    `<span>🔐 Lock cracked in ${attempts} attempt${attempts === 1 ? '' : 's'}${oracleNote}</span>` +
    `<span>🕯️ Labyrinth walked in ${steps} steps</span>` +
    `<span>✦ 3 / 3 shards recovered</span>`;

  typeMessage($('#birthdayMessage'), BIRTHDAY_MESSAGE);
  sfx.fanfare();
  startConfetti();
}

function typeMessage(el, text) {
  if (typeTimer) clearTimeout(typeTimer);
  el.textContent = '';
  let i = 0;
  (function step() {
    el.textContent = text.slice(0, i);
    i++;
    if (i <= text.length) typeTimer = setTimeout(step, 16);
  })();
}

function startConfetti() {
  confettiCanvas = $('#confettiCanvas');
  cctx = confettiCanvas.getContext('2d');
  confettiCanvas.classList.add('on');
  sizeConfetti();

  const colors = ['#f4c95d', '#f7539e', '#8a5cf6', '#4de3c1', '#ffe6a3', '#ff9f45'];
  confetti = Array.from({ length: 170 }, () => spawn(colors, true));

  let bursts = 0;
  const t = setInterval(() => {
    if (!confettiOn) { clearInterval(t); return; }
    for (let i = 0; i < 45; i++) confetti.push(spawn(colors, false));
    if (++bursts >= 4) clearInterval(t);
  }, 1500);

  if (!confettiOn) { confettiOn = true; requestAnimationFrame(confettiLoop); }
}

function spawn(colors, scattered) {
  return {
    x: Math.random() * window.innerWidth,
    y: scattered ? -Math.random() * window.innerHeight : -20,
    vx: (Math.random() - 0.5) * 2.4,
    vy: 1.8 + Math.random() * 2.6,
    size: 6 + Math.random() * 7,
    color: colors[randInt(colors.length)],
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.26,
    rect: Math.random() < 0.55,
  };
}

function sizeConfetti() {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}
window.addEventListener('resize', () => { if (confettiOn && confettiCanvas) sizeConfetti(); });

function confettiLoop() {
  if (!confettiOn) return;
  const w = confettiCanvas.width, h = confettiCanvas.height;
  cctx.clearRect(0, 0, w, h);
  for (const p of confetti) {
    p.x += p.vx; p.y += p.vy; p.rot += p.vr;
    if (p.y > h + 30) { p.y = -20; p.x = Math.random() * w; }
    cctx.save();
    cctx.translate(p.x, p.y);
    cctx.rotate(p.rot);
    cctx.fillStyle = p.color;
    if (p.rect) cctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    else { cctx.beginPath(); cctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2); cctx.fill(); }
    cctx.restore();
  }
  if (confetti.length > 520) confetti.splice(0, confetti.length - 520);
  requestAnimationFrame(confettiLoop);
}

function stopConfetti() {
  confettiOn = false;
  confetti = [];
  if (confettiCanvas) {
    confettiCanvas.classList.remove('on');
    cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }
}

/* =====================================================================
   WIRING
===================================================================== */
$('#startBtn').addEventListener('click', () => {
  ensureAudio();
  sfx.click();
  showScreen('screen-lock');
  initLock();
});

$('#replayBtn').addEventListener('click', () => {
  ensureAudio();
  sfx.click();
  stopConfetti();
  if (typeTimer) { clearTimeout(typeTimer); typeTimer = null; }
  mazeActive = false;
  state.lockSolved = false;
  state.mazeSolved = false;
  $('#clearBtn').disabled = false;
  showScreen('screen-start');
});
