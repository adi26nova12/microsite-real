/* The Aurelle virtual tour. Edit the data here; the engine below needs no changes. */
const BUILDING = { name: 'The Aurelle', residence: 'Residence A', specs: '1 bed · 1.5 bath · 1,860 sq ft' };

const FLOOR_RANGE = { first: 6, last: 38, top: 14.6, bottom: 75.6, left: 45.3, right: 54.5 }; // top/bottom/left/right: % of the tower image
const priceFor = f => '$' + (2.35 + (f - FLOOR_RANGE.first) * 0.048).toFixed(2) + 'M';
const isReserved = f => f % 7 === 3;

const NODES = {
  tower:   { title: 'Select a floor', still: 'tower' },
  plan:    { title: 'Full floor', still: 'plan', parent: 'tower' },
  living:  { title: 'Living', still: 'living', parent: 'plan', specs: '26 × 18 ft · water views' },
  kitchen: { title: 'Kitchen & Dining', still: 'kitchen', parent: 'plan', specs: '22 × 16 ft · travertine island' },
  bedroom: { title: 'Primary Bedroom', still: 'bedroom', parent: 'plan', specs: '18 × 15 ft · sunset side' },
  bath:    { title: 'Spa Bath', still: 'bath', parent: 'plan', specs: '14 × 11 ft · freestanding tub' },
};
const ROOMS = ['living', 'kitchen', 'bedroom', 'bath'];
const ORDER = ['tower', 'plan', 'living', 'kitchen', 'bedroom', 'bath'];

// Each edge is one generated camera move, with a reversed copy for going back.
const EDGES = [
  ['tower', 'plan'],
  ['plan', 'living'],
  ['living', 'kitchen'],
  ['living', 'bedroom'],
  ['bedroom', 'bath'],
];

// Room areas on the floor cutaway (1100 x 622 coordinates) and labelled pins (% of the stage).
const ZONES = {
  bedroom: '100,100 325,125 275,372 28,340',
  bath: '330,125 458,135 420,388 275,372',
  living: '462,135 650,152 700,425 425,395',
  kitchen: '650,152 1025,178 1070,400 950,462 700,425',
};
const PINS = {
  plan: [['bedroom', 14, 46], ['bath', 34.5, 42], ['living', 50, 52], ['kitchen', 80, 52]],
  living: [['kitchen', 87, 56], ['bedroom', 13, 76]],
  kitchen: [['living', 13, 74]],
  bedroom: [['bath', 54, 34], ['living', 13, 84]],
  bath: [['bedroom', 13, 80]],
};

/* Engine */
const $ = id => document.getElementById(id);
const stage = $('stage'), still = $('still'), floorsEl = $('floors'), zonesEl = $('zones'), pinsEl = $('pins'), tipEl = $('floorTip');
const players = [$('clipA'), $('clipB')];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// A personalised link (?for=Name) greets the buyer. Inside a microsite (?embed=1) the page around the tour keeps the scroll wheel, vertical swipes and the back button.
const params = new URLSearchParams(location.search);
const guest = (params.get('for') || '').trim().slice(0, 40);
const embedded = params.has('embed');
const clipSize = Math.max(innerWidth, innerHeight) < 1000 ? '854' : '1280';

const stillUrl = name => `assets/stills/${name}.webp`;
const clipUrl = (a, b) => {
  const fwd = EDGES.some(e => e[0] === a && e[1] === b);
  return `assets/clips/${clipSize}/${fwd ? a + '-' + b : b + '-' + a}${fwd ? '' : '-rev'}.mp4`;
};

let current = 'tower', target = 'tower', running = false, floor = 28, player = 0;
const blobs = new Map();

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

async function showStill(name) {
  const img = new Image();
  img.src = stillUrl(name);
  await Promise.race([img.decode().catch(() => {}), new Promise(r => setTimeout(r, 1000))]);
  still.src = img.src;
}

function prepare(video, src) {
  return new Promise(resolve => {
    const done = ok => {
      clearTimeout(timer);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onFail);
      resolve(ok);
    };
    const onReady = () => done(true), onFail = () => done(false);
    const timer = setTimeout(onFail, 6000);
    video.addEventListener('canplay', onReady);
    video.addEventListener('error', onFail);
    video.src = src;
    video.load();
  });
}

// Frame callbacks stop on a hidden page, so every wait here has a timer behind it and a tab switch can't stall the tour.
const firstFrame = video => new Promise(resolve => {
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => resolve());
  else video.addEventListener('playing', resolve, { once: true });
  setTimeout(resolve, 300);
});

const finished = video => new Promise(resolve => {
  if (video.ended) return resolve();
  const stop = () => { video.removeEventListener('ended', stop); clearTimeout(guard); resolve(); };
  const guard = setTimeout(stop, ((video.duration - video.currentTime) / video.playbackRate + 1) * 1000);
  video.addEventListener('ended', stop);
});

async function crossfade(to) {
  const ghost = still.cloneNode();
  ghost.removeAttribute('id');
  ghost.style.transition = 'opacity 420ms linear';
  still.after(ghost);
  await showStill(to);
  ghost.getBoundingClientRect();
  ghost.style.opacity = 0;
  await new Promise(r => setTimeout(r, 430));
  ghost.remove();
}

// The clip fades in over the resting still, and the next still is swapped in beneath its last frame.
async function move(from, to, rate) {
  if (reducedMotion) return crossfade(to);
  player = 1 - player;
  const video = players[player], url = clipUrl(from, to);
  if (!await prepare(video, blobs.get(url) || url)) return crossfade(to);
  video.playbackRate = rate;
  const shown = firstFrame(video);
  try { await video.play(); } catch { return crossfade(to); }
  await shown;
  video.classList.add('on');
  await finished(video);
  await showStill(to);
  video.classList.remove('on');
}

function setOverview(on) {
  const fit = on && innerWidth / innerHeight < 1.1;
  document.body.classList.toggle('overview', fit);
  $('zoomer').style.setProperty('--zoom', fit ? innerWidth / stage.offsetWidth * 1.02 : 1);
}

async function run() {
  if (running) return;
  running = true;
  document.body.classList.add('moving');
  pinsEl.replaceChildren();
  setTip(false);
  if (document.body.classList.contains('overview')) {
    setOverview(false);
    await new Promise(r => setTimeout(r, 460));
  }
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
  setOverview(current === 'plan');
  if (current === 'tower') highlightFloor(floor);
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
  const node = NODES[target];
  document.body.dataset.node = target;
  $('title').textContent = target === 'plan' ? BUILDING.residence : node.title;
  $('kicker').textContent = target === 'tower' ? `Floor ${floor} · ${priceFor(floor)}${isReserved(floor) ? ' · Reserved' : ''}` : `Floor ${floor} · ${target === 'plan' ? 'Full floor' : BUILDING.residence}`;
  $('specs').textContent = target === 'tower' ? '' : node.specs || BUILDING.specs;

  const chips = $('chips');
  if (target === 'tower') {
    chips.replaceChildren(chip(`Tour floor ${floor}`, 'plan', true));
  } else {
    chips.replaceChildren(chip('Floor', 'plan', target === 'plan'), ...ROOMS.map(r => chip(NODES[r].title.split(' ').pop() === 'Dining' ? 'Kitchen' : NODES[r].title.split(' ').pop(), r, r === target)));
  }

  if (target === 'tower') return $('crumbs').replaceChildren();
  const crumbs = [['tower', 'Tower'], ['plan', `Floor ${floor}`]];
  if (ROOMS.includes(target)) crumbs.push([target, NODES[target].title]);
  $('crumbs').replaceChildren(...crumbs.flatMap(([n, label], i) => {
    const last = i === crumbs.length - 1;
    const el = document.createElement(last ? 'span' : 'button');
    el.textContent = label;
    if (!last) { el.type = 'button'; el.onclick = () => go(n); }
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

/* Tower floors */
function floorY(f) {
  const n = FLOOR_RANGE.last - FLOOR_RANGE.first + 1, h = (FLOOR_RANGE.bottom - FLOOR_RANGE.top) / n;
  return { top: FLOOR_RANGE.bottom - (f - FLOOR_RANGE.first + 1) * h, h };
}

function buildFloors() {
  const toSvgY = p => p * 0.5625;
  for (let f = FLOOR_RANGE.first; f <= FLOOR_RANGE.last; f++) {
    const { top, h } = floorY(f);
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', FLOOR_RANGE.left);
    r.setAttribute('width', FLOOR_RANGE.right - FLOOR_RANGE.left);
    r.setAttribute('y', toSvgY(top));
    r.setAttribute('height', toSvgY(h));
    r.dataset.floor = f;
    if (isReserved(f)) r.classList.add('reserved');
    floorsEl.append(r);
  }
  floorsEl.addEventListener('pointerover', e => {
    if (e.pointerType === 'mouse' && e.target.dataset.floor) { pauseAuto(); highlightFloor(+e.target.dataset.floor); }
  });
  floorsEl.addEventListener('pointerleave', resumeAuto);
  floorsEl.addEventListener('click', e => {
    if (!e.target.dataset.floor) return;
    const f = +e.target.dataset.floor;
    highlightFloor(f);
    pauseAuto();
    if (e.pointerType !== 'touch') go('plan');
  });
  tipEl.addEventListener('click', () => go('plan'));
}

function highlightFloor(f) {
  floor = f;
  floorsEl.querySelectorAll('.on').forEach(r => r.classList.remove('on'));
  floorsEl.querySelector(`[data-floor="${f}"]`)?.classList.add('on');
  const { top, h } = floorY(f);
  tipEl.style.top = top + h / 2 + '%';
  tipEl.innerHTML = `<b>${f}</b><strong>${BUILDING.residence}</strong><small>${BUILDING.specs.split(' · ').pop()} · ${priceFor(f)}</small><em>${isReserved(f) ? 'Reserved' : 'Available'} · Enter floor →</em>`;
  setTip(true);
  if (target === 'tower') renderDock();
}
const setTip = on => tipEl.classList.toggle('show', on);

// Until someone interacts, the tower quietly shows off a floor at a time.
let autoTimer = null;
const pauseAuto = () => { clearInterval(autoTimer); autoTimer = null; };
function resumeAuto() {
  pauseAuto();
  if (reducedMotion) return;
  autoTimer = setInterval(() => {
    if (current !== 'tower' || target !== 'tower') return;
    let f;
    do { f = FLOOR_RANGE.first + 2 + Math.floor(Math.random() * (FLOOR_RANGE.last - FLOOR_RANGE.first - 3)); } while (f === floor || isReserved(f));
    highlightFloor(f);
  }, 2600);
}

/* Floor plan and room pins */
function buildZones() {
  for (const [room, points] of Object.entries(ZONES)) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    p.setAttribute('points', points);
    p.dataset.room = room;
    p.addEventListener('pointerenter', () => linkHover(room, true));
    p.addEventListener('pointerleave', () => linkHover(room, false));
    p.addEventListener('click', () => go(room));
    zonesEl.append(p);
  }
}
function linkHover(room, on) {
  zonesEl.querySelector(`[data-room="${room}"]`)?.classList.toggle('on', on);
  pinsEl.querySelector(`[data-room="${room}"]`)?.classList.toggle('on', on);
}
function renderPins() {
  pinsEl.replaceChildren(...(PINS[current] || []).map(([room, x, y]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pin' + (current === 'plan' ? ' plan-pin' : '');
    b.dataset.room = room;
    b.style.left = x + '%';
    b.style.top = y + '%';
    b.textContent = NODES[room].title;
    b.onclick = () => go(room);
    if (current === 'plan') {
      b.onpointerenter = () => linkHover(room, true);
      b.onpointerleave = () => linkHover(room, false);
    }
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
  if (embedded) return;
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
  if (!touchStart || e.target.closest('.chips')) return;
  const t = e.changedTouches[0], dx = t.clientX - touchStart.clientX, dy = t.clientY - touchStart.clientY;
  if (embedded && Math.abs(dy) > Math.abs(dx)) return;
  if (Math.hypot(dx, dy) > 60) step(Math.abs(dx) > Math.abs(dy) ? -Math.sign(dx) : -Math.sign(dy));
}, { passive: true });

addEventListener('keydown', e => {
  if (target === 'tower' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    pauseAuto();
    highlightFloor(Math.min(FLOOR_RANGE.last, Math.max(FLOOR_RANGE.first, floor + (e.key === 'ArrowUp' ? 1 : -1))));
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || (e.key === 'Enter' && e.target === document.body)) step(1);
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') step(-1);
  else if (e.key === 'Escape') up();
});

// The whole stage shifts with the pointer, so stills, clips and hotspots never drift apart.
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

/* Preload: clips become in-memory blobs so playback starts instantly. Without them, the clips still stream. */
async function preload() {
  Object.values(NODES).forEach(n => { new Image().src = stillUrl(n.still); });
  const queue = [...EDGES.map(([a, b]) => clipUrl(a, b)), ...EDGES.map(([a, b]) => clipUrl(b, a))];
  const bar = $('progress'), total = queue.length;
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        const res = await fetch(url);
        if (res.ok) blobs.set(url, URL.createObjectURL(await res.blob()));
      } catch {}
      bar.style.setProperty('--p', ++done / total);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
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
  buildFloors();
  buildZones();
  const hash = location.hash.slice(1);
  if (NODES[hash] && hash !== 'tower') {
    current = target = hash;
    showStill(hash);
  }
  renderDock();
  renderPins();
  setOverview(current === 'plan');
  addEventListener('resize', () => { if (!running) setOverview(current === 'plan'); });
  if (current === 'tower') { highlightFloor(floor); resumeAuto(); }
  preload();
}
start();
