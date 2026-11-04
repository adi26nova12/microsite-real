/* Opus One virtual tour. Edit the data here; the engine below needs no changes. Content is from the Opus One brochure. */
const BUILDING = { name: 'Opus One', by: 'GB Realty', place: 'New Chandigarh' };

// The seven Houses, left to right across the tower image. left/right/top/bottom: % of the image.
const TOWERS = { top: 12, bottom: 73 };
const HOUSES = [
  { name: 'Vidalia House', type: '3+1 BHK', left: 13, right: 23, units: [{ label: 'Typical unit', plan: 'vidalia-3', carpet: 2066, superA: 3544 }] },
  { name: 'Evalia House', type: '3+1 BHK', left: 23, right: 33, units: [{ label: 'Typical unit', plan: 'evalia-3', carpet: 1765, superA: 3305 }] },
  { name: 'Cecilia House', type: '3+1 BHK', left: 33, right: 43.5, units: [{ label: 'Typical unit', plan: 'evalia-3', carpet: 1765, superA: 3305 }] },
  { name: 'Amelia House', type: '3+1 & 4+1 BHK', left: 43.5, right: 55, units: [
    { label: 'Unit 1 · 3+1', plan: 'amelia-3', carpet: 1751, superA: 5323 },
    { label: 'Unit 2 · 4+1', plan: 'amelia-4', carpet: 2206, superA: 4016 }] },
  { name: 'Ezalia House', type: '4+1 BHK', left: 55, right: 64.5, units: [
    { label: 'Unit 1', plan: 'ezalia-4a', carpet: 2869, superA: 5007 },
    { label: 'Unit 2', plan: 'ezalia-4b', carpet: 2869, superA: 5058 }] },
  { name: 'Zenelia House', type: '5+1 BHK', left: 64.5, right: 74, units: [
    { label: 'Unit 1', plan: 'zenelia-5a', carpet: 3533, superA: 6041 },
    { label: 'Unit 2', plan: 'zenelia-5b', carpet: 3533, superA: 5985 }] },
  { name: 'Miralia House', type: '5+1 BHK', left: 74, right: 85.5, units: [
    { label: 'Unit 1', plan: 'miralia-5a', carpet: 3533, superA: 6041 },
    { label: 'Unit 2', plan: 'miralia-5b', carpet: 3533, superA: 6041 }] },
];

const NODES = {
  tower:   { title: 'Select a House', still: 'tower' },
  lobby:   { title: 'Grand Arrival Lobby', chip: 'Lobby', still: 'lobby', parent: 'tower', specs: 'Double-height timber, marble and light' },
  lift:    { title: 'Lift Lobby', still: 'lift', parent: 'lobby', specs: 'Swipe-card access to lobby & lifts' },
  foyer:   { title: 'Entrance Foyer', chip: 'Foyer', still: 'foyer', parent: 'lift', specs: 'Italian marble flooring' },
  living:  { title: 'Lounge', chip: 'Living', still: 'living', parent: 'foyer', specs: 'Italian marble · home automation' },
  dining:  { title: 'Dining', chip: 'Dining', still: 'dining', parent: 'living', specs: 'Italian marble flooring' },
  bedroom: { title: 'Master Bedroom', chip: 'Bedroom', still: 'bedroom', parent: 'living', specs: 'Laminate wood & Italian marble' },
  bath:    { title: 'Master Bath', chip: 'Bath', still: 'bath', parent: 'bedroom', specs: 'Hansgrohe / TOTO · Duravit' },
};
const ROOMS = ['lobby', 'foyer', 'living', 'dining', 'bedroom', 'bath'];
const ORDER = ['tower', 'lobby', 'lift', 'foyer', 'living', 'dining', 'bedroom', 'bath'];

// Each edge is one move. An edge with a frame sequence is a real camera move (played backwards to return); the rest walk from still to still.
const EDGES = [
  ['tower', 'lobby', { seq: 'entrance', frames: 79, fps: 24 }],
  ['lobby', 'lift'],
  ['lift', 'foyer'],
  ['foyer', 'living'],
  ['living', 'dining'],
  ['living', 'bedroom'],
  ['bedroom', 'bath'],
];

// Labelled pins that lead on from each room (% of the stage).
const PINS = {
  lobby: [['lift', 66, 48]],
  lift: [['foyer', 78, 44], ['lobby', 13, 82]],
  foyer: [['living', 30, 50], ['lift', 13, 84]],
  living: [['dining', 16, 70], ['bedroom', 86, 46], ['foyer', 50, 86]],
  dining: [['living', 86, 52]],
  bedroom: [['bath', 9, 44], ['living', 86, 84]],
  bath: [['bedroom', 84, 48]],
};

/* Engine */
const $ = id => document.getElementById(id);
const stage = $('stage'), still = $('still'), seqEl = $('seq'), housesEl = $('houses'), pinsEl = $('pins'), tipEl = $('houseTip');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const seqSize = Math.max(innerWidth, innerHeight) < 1000 ? '854' : '1280';
const sqft = n => n.toLocaleString('en-IN') + ' sq ft';
const fromSuper = h => Math.min(...h.units.map(u => u.superA));

// A personalised link (?for=Name) greets the buyer. Inside a microsite (?embed=1) the page around the tour keeps the scroll wheel, vertical swipes and the back button.
const params = new URLSearchParams(location.search);
const guest = (params.get('for') || '').trim().slice(0, 40);
const embedded = params.has('embed');

const stillUrl = name => `assets/stills/${name}.webp`;
const edgeOf = (a, b) => EDGES.find(e => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a));

let current = 'tower', target = 'tower', running = false, house = 3;

function route(from, to) {
  const prev = { [from]: null }, queue = [from];
  while (queue.length) {
    const n = queue.shift();
    if (n === to) break;
    for (const [a, b] of EDGES) {
      const m = a === n ? b : b === n ? a : null;
      if (m && !(m in prev)) { prev[m] = n; queue.push(m); }
    }
  }
  const path = [];
  for (let n = to; n !== from; n = prev[n]) path.unshift(n);
  return path;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Frame callbacks stop on a hidden page, so every frame wait has a timer behind it and a tab switch can't stall the tour.
const nextFrame = () => new Promise(r => { requestAnimationFrame(r); setTimeout(r, 60); });

async function showStill(name) {
  const img = new Image();
  img.src = stillUrl(name);
  await Promise.race([img.decode().catch(() => {}), sleep(1000)]);
  still.src = img.src;
}

/* Frame sequences: decoded ahead of time, drawn to a canvas, so the camera move starts instantly. */
const sequences = new Map();
function framesOf(seq) {
  if (!sequences.has(seq.seq)) {
    sequences.set(seq.seq, Array.from({ length: seq.frames }, (_, i) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = `assets/seq/${seq.seq}/${seqSize}/f${String(i + 1).padStart(3, '0')}.webp`;
      return img;
    }));
  }
  return sequences.get(seq.seq);
}
const ready = img => img.complete && img.naturalWidth > 0;
const loaded = img => ready(img) ? Promise.resolve() : new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); });

async function playSequence(seq, reverse, rate) {
  const frames = framesOf(seq), n = frames.length;
  const order = i => frames[reverse ? n - 1 - i : i];
  // Wait briefly for the first stretch of frames; on a slow connection walk instead of stuttering.
  const head = Array.from({ length: Math.min(12, n) }, (_, i) => order(i));
  const ok = await Promise.race([Promise.all(head.map(f => f.decode())).then(() => true, () => false), sleep(2500).then(() => false)]);
  if (!ok) return false;

  const ctx = seqEl.getContext('2d');
  seqEl.width = head[0].naturalWidth;
  seqEl.height = head[0].naturalHeight;
  ctx.drawImage(head[0], 0, 0, seqEl.width, seqEl.height);
  seqEl.classList.add('on');
  await sleep(240);

  const fps = seq.fps * rate, t0 = performance.now();
  let drawn = 0;
  while (drawn < n - 1) {
    await nextFrame();
    const due = Math.min(n - 1, Math.floor((performance.now() - t0) / 1000 * fps));
    // Decode a little ahead of the playhead, so frames are ready when they're due without holding every frame in memory.
    for (let i = due + 1; i <= Math.min(n - 1, due + 8); i++) order(i).decode().catch(() => {});
    // Draw the newest frame that has arrived; a late frame is skipped rather than waited for.
    for (let i = due; i > drawn; i--) {
      if (ready(order(i))) { ctx.drawImage(order(i), 0, 0, seqEl.width, seqEl.height); drawn = i; break; }
    }
    if (due === n - 1 && !ready(order(n - 1))) drawn = n - 1;
  }
  return true;
}

// Still to still: the room you leave moves past you and fades while the next one settles into place.
async function walk(to, forward, rate) {
  const ghost = still.cloneNode();
  ghost.removeAttribute('id');
  ghost.className = 'ghost';
  still.after(ghost);
  const ms = Math.round(760 / rate);
  await showStill(to);
  const ease = 'cubic-bezier(.4, 0, .2, 1)';
  if (!reducedMotion) {
    still.style.transition = 'none';
    still.style.transform = `scale(${forward ? 0.94 : 1.1})`;
    still.getBoundingClientRect();
    still.style.transition = `transform ${ms}ms ${ease}`;
    still.style.transform = '';
  }
  ghost.getBoundingClientRect();
  ghost.style.transition = `opacity ${ms}ms ${ease}, transform ${ms}ms ${ease}`;
  ghost.style.opacity = 0;
  if (!reducedMotion) ghost.style.transform = `scale(${forward ? 1.18 : 0.92})`;
  await sleep(ms + 20);
  ghost.remove();
  still.style.transition = still.style.transform = '';
}

async function move(from, to, rate) {
  const edge = edgeOf(from, to), forward = ORDER.indexOf(to) > ORDER.indexOf(from);
  const seq = edge?.[2];
  if (seq && !reducedMotion && await playSequence(seq, edge[0] !== from, rate)) {
    await showStill(to);
    seqEl.classList.remove('on');
    await sleep(240);
    return;
  }
  return walk(to, forward, rate);
}

async function run() {
  if (running) return;
  running = true;
  document.body.classList.add('moving');
  pinsEl.replaceChildren();
  setTip(false);
  if (current === 'tower') { panTo(50); await sleep(460); }
  let walking = false; // a walk through several rooms keeps one brisker pace from start to finish
  while (current !== target) {
    const path = route(current, target);
    walking = walking || path.length > 1;
    await move(current, path[0], walking ? 1.5 : 1);
    current = path[0];
  }
  running = false;
  document.body.classList.remove('moving');
  renderPins();
  if (current === 'tower') highlightHouse(house);
}

function go(node, push = true) {
  if (!NODES[node] || node === target) return;
  target = node;
  if (push) history[embedded ? 'replaceState' : 'pushState'](null, '', '#' + node);
  renderDock();
  run();
}

/* Dock and breadcrumbs */
function renderDock() {
  const node = NODES[target], h = HOUSES[house];
  document.body.dataset.node = target;
  $('title').textContent = node.title;
  $('kicker').textContent = `${h.name} · ${h.type}`;
  $('specs').textContent = target === 'tower' ? `From ${sqft(fromSuper(h))} super area` : node.specs || '';

  const chips = $('chips');
  if (target === 'tower') {
    chips.replaceChildren(stepChip(-1), chip(`Enter ${h.name.replace(' House', '')}`, 'lobby', true), stepChip(1), planChip());
  } else {
    chips.replaceChildren(...ROOMS.map(r => chip(NODES[r].chip, r, r === target)), planChip());
  }

  if (target === 'tower') return $('crumbs').replaceChildren();
  const crumbs = [['tower', BUILDING.name], [null, h.name], [target, node.title]];
  $('crumbs').replaceChildren(...crumbs.flatMap(([n, label], i) => {
    const last = i === crumbs.length - 1;
    const el = document.createElement(last || !n ? 'span' : 'button');
    el.textContent = label;
    if (!last && n) { el.type = 'button'; el.onclick = () => go(n); }
    return i ? [Object.assign(document.createElement('span'), { textContent: '/', ariaHidden: 'true' }), el] : [el];
  }));
}

function chip(label, node, current) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = label;
  if (current) b.setAttribute('aria-current', 'true');
  b.onclick = () => go(node);
  return b;
}
function stepChip(dir) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip step-chip';
  b.textContent = dir < 0 ? '‹' : '›';
  b.setAttribute('aria-label', dir < 0 ? 'Previous House' : 'Next House');
  b.onclick = () => { pauseAuto(); highlightHouse((house + dir + HOUSES.length) % HOUSES.length); };
  return b;
}
function planChip() {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip plan-chip';
  b.textContent = 'Floor plan';
  b.onclick = () => openPlan(0);
  return b;
}

/* Floor plans */
function openPlan(u) {
  const h = HOUSES[house], unit = h.units[u];
  $('planKicker').textContent = `${BUILDING.name} · ${h.type}`;
  $('planTitle').textContent = h.name;
  $('planUnits').replaceChildren(...(h.units.length > 1 ? h.units.map((x, i) => {
    const b = chip(x.label, null, i === u);
    b.onclick = () => openPlan(i);
    return b;
  }) : []));
  $('planImg').src = `assets/plans/${unit.plan}.webp`;
  $('planImg').alt = `Floor plan, ${h.name}, ${unit.label}`;
  $('planAreas').textContent = `${unit.label} · Carpet ${sqft(unit.carpet)} · Super area ${sqft(unit.superA)}`;
  if (!$('plan').open) $('plan').showModal();
}
$('planClose').onclick = () => $('plan').close();
$('plan').addEventListener('click', e => { if (e.target === $('plan')) $('plan').close(); });

/* Houses on the towers */
function buildHouses() {
  const y = p => p * 0.5625;
  HOUSES.forEach((h, i) => {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', h.left);
    r.setAttribute('width', h.right - h.left);
    r.setAttribute('y', y(TOWERS.top));
    r.setAttribute('height', y(TOWERS.bottom - TOWERS.top));
    r.dataset.house = i;
    housesEl.append(r);
  });
  housesEl.addEventListener('pointerover', e => {
    if (e.pointerType === 'mouse' && e.target.dataset.house) { pauseAuto(); highlightHouse(+e.target.dataset.house); }
  });
  housesEl.addEventListener('pointerleave', resumeAuto);
  housesEl.addEventListener('click', e => {
    if (!e.target.dataset.house) return;
    highlightHouse(+e.target.dataset.house);
    pauseAuto();
    if (e.pointerType !== 'touch') go('lobby');
  });
  tipEl.addEventListener('click', () => go('lobby'));
}

function highlightHouse(i) {
  house = i;
  const h = HOUSES[i];
  housesEl.querySelectorAll('.on').forEach(r => r.classList.remove('on'));
  housesEl.querySelector(`[data-house="${i}"]`)?.classList.add('on');
  const rightSide = h.right < 62;
  tipEl.style.left = rightSide ? h.right + 1 + '%' : '';
  tipEl.style.right = rightSide ? '' : 100 - h.left + 1 + '%';
  panTo(current === 'tower' && target === 'tower' ? (h.left + h.right) / 2 : 50);
  tipEl.innerHTML = `<b>${i + 1}</b><strong>${h.name}</strong><small>${h.type} · from ${sqft(fromSuper(h))}</small><em>Enter ${h.name.replace(' House', '')} →</em>`;
  setTip(true);
  if (target === 'tower') renderDock();
}
const setTip = on => tipEl.classList.toggle('show', on);

// On a tall screen only the middle of the towers fits, so the camera slides across to keep the chosen House in view.
function panTo(x) {
  const spare = Math.max(0, stage.offsetWidth - innerWidth) / 2;
  const shift = Math.max(-spare, Math.min(spare, (50 - x) / 100 * stage.offsetWidth));
  $('zoomer').style.setProperty('--pan', Math.round(shift) + 'px');
}

// Until someone interacts, the towers quietly show off one House at a time.
let autoTimer = null;
const pauseAuto = () => { clearInterval(autoTimer); autoTimer = null; };
function resumeAuto() {
  pauseAuto();
  if (reducedMotion) return;
  autoTimer = setInterval(() => {
    if (current !== 'tower' || target !== 'tower') return;
    highlightHouse((house + 1) % HOUSES.length);
  }, 2600);
}

/* Room pins */
function renderPins() {
  pinsEl.replaceChildren(...(PINS[current] || []).map(([room, x, y]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pin';
    b.style.left = x + '%';
    b.style.top = y + '%';
    b.textContent = NODES[room].title;
    b.onclick = () => go(room);
    return b;
  }));
}

/* Input: wheel, swipe, keys, pointer look-around */
const step = dir => {
  const i = ORDER.indexOf(target) + dir;
  if (ORDER[i]) go(ORDER[i]);
};
const up = () => { const p = NODES[target].parent; if (p) go(p); };
$('back').onclick = up;

let wheelSum = 0, wheelLock = 0;
addEventListener('wheel', e => {
  if (embedded || $('plan').open) return;
  const now = performance.now();
  if (running || now < wheelLock) return;
  wheelSum += e.deltaY;
  if (Math.abs(wheelSum) < 50) return;
  step(Math.sign(wheelSum));
  wheelSum = 0;
  wheelLock = now + 700;
}, { passive: true });

let touchStart = null;
addEventListener('touchstart', e => { touchStart = e.touches[0]; }, { passive: true });
addEventListener('touchend', e => {
  if (!touchStart || e.target.closest('.chips, .plan')) return;
  const t = e.changedTouches[0], dx = t.clientX - touchStart.clientX, dy = t.clientY - touchStart.clientY;
  if (embedded && Math.abs(dy) > Math.abs(dx)) return;
  if (Math.hypot(dx, dy) > 60) step(Math.abs(dx) > Math.abs(dy) ? -Math.sign(dx) : -Math.sign(dy));
}, { passive: true });

addEventListener('keydown', e => {
  if ($('plan').open) return;
  if (target === 'tower' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    pauseAuto();
    highlightHouse((house + (e.key === 'ArrowRight' ? 1 : HOUSES.length - 1)) % HOUSES.length);
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || (e.key === 'Enter' && e.target === document.body)) step(1);
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') step(-1);
  else if (e.key === 'Escape') up();
});

// The whole stage shifts with the pointer, so stills, sequences and hotspots never drift apart.
let px = 0, py = 0, tx = 0, ty = 0, raf = 0;
function tick() {
  px += (tx - px) * 0.06;
  py += (ty - py) * 0.06;
  stage.style.transform = `translate(calc(-50% + ${px.toFixed(2)}px), calc(-50% + ${py.toFixed(2)}px))`;
  raf = Math.abs(tx - px) + Math.abs(ty - py) > 0.05 ? requestAnimationFrame(tick) : 0;
}
if (!reducedMotion && matchMedia('(pointer: fine)').matches) {
  addEventListener('pointermove', e => {
    tx = (0.5 - e.clientX / innerWidth) * innerWidth * 0.018;
    ty = (0.5 - e.clientY / innerHeight) * innerHeight * 0.018;
    if (!raf) raf = requestAnimationFrame(tick);
  }, { passive: true });
}

/* Preload: stills first, then the entrance frames are downloaded (not decoded), so the move into the lobby starts instantly. */
async function preload() {
  Object.values(NODES).forEach(n => { new Image().src = stillUrl(n.still); });
  const bar = $('progress');
  const frames = EDGES.filter(e => e[2]).flatMap(e => framesOf(e[2]));
  let done = 0;
  await Promise.all(frames.map(f => loaded(f).then(() => bar.style.setProperty('--p', ++done / frames.length))));
  bar.classList.add('done');
}

addEventListener('popstate', () => go(location.hash.slice(1) || 'tower', false));

function personalise() {
  document.body.classList.toggle('embedded', embedded);
  if (!guest) return;
  document.querySelector('.intro .eyebrow').textContent = `Prepared for ${guest}`;
  const greeting = $('greeting');
  greeting.textContent = `For ${guest}`;
  greeting.hidden = false;
  document.title = `${BUILDING.name} — Virtual Tour for ${guest}`;
}

function start() {
  personalise();
  buildHouses();
  const hash = location.hash.slice(1);
  if (NODES[hash] && hash !== 'tower') {
    current = target = hash;
    showStill(hash);
  }
  renderDock();
  renderPins();
  if (current === 'tower') { highlightHouse(house); resumeAuto(); }
  addEventListener('resize', () => { if (!running && current === 'tower') highlightHouse(house); });
  preload();
}
start();
