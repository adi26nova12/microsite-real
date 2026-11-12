/* The Aurelle virtual tour. Edit the data here; the engine below needs no changes. */
import { Pano } from './pano.js';
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

// Each room is a 360° panorama. Directions are degrees in the panorama: yaw 0 is the middle of the image (right is +),
// pitch 0 the middle height (up is +). `look` is where you face on arrival; `doors` are the doorways to other rooms.
const PANOS = {
  living:  { look: -8, doors: { kitchen: [65, 4], bedroom: [150, 4] } },
  kitchen: { look: 35, doors: { living: [165, 0] } },
  bedroom: { look: 10, doors: { bath: [-8, 10], living: [-36, 8] } },
  bath:    { look: 15, doors: { bedroom: [-61, 0] } },
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
  // Rooms are 360° panoramas: room to room is a walk through the doorway, and the floor plan fades into (or out of) a room.
  if (pano && PANOS[from] && PANOS[to]) return walkThrough(from, to, rate);
  if (pano && PANOS[to]) return enterRoom(to);
  if (pano && PANOS[from]) return leaveRoom(to);
  // Tower to floor plan: a quick dip between the two sharp photographs. (The camera-move clips are only a fallback
  // without WebGL: at 1280 wide they look soft on a big screen.)
  if (pano) return dipTo(to, rate);
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

/* 360° rooms */
const panoEl = $('pano'), doorsEl = $('doors'), hintEl = $('lookHint');
let pano = null;
try { pano = new Pano(panoEl); } catch { pano = null; } // without WebGL the tour keeps its photographs and clips
const panoUrl = room => `assets/pano/${room}.webp`;
const view = { drag: null, vy: 0, vp: 0, gyro: null, gy: 0, gp: 0, idle: true, raf: 0, last: 0 };
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const wrap = a => ((a + 540) % 360) - 180;
// The resting field of view: wide like standing in the room (across on a landscape screen, top to bottom on a tall one).
const baseFov = () => innerWidth >= innerHeight ? 112 : 100; // wide enough to take in the room, like standing in it
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nextFrame = () => new Promise(r => { requestAnimationFrame(r); setTimeout(r, 60); });
async function animate(ms, fn) {
  const t0 = performance.now();
  for (let k = 0; k < 1;) { await nextFrame(); k = Math.min(1, (performance.now() - t0) / ms); fn(k); }
}

// Every change of scene dips briefly to dark and swaps while it's dark, so two pictures are never shown blended
// over each other (that reads as a blurry double image).
const dipEl = $('dip');
async function dip(dark, ms = 280) {
  dipEl.style.transitionDuration = ms + 'ms';
  dipEl.getBoundingClientRect();
  dipEl.style.opacity = dark ? 1 : 0;
  if (ms) await sleep(ms);
}
async function dipTo(to, rate = 1) {
  await dip(true, 260 / rate);
  await showStill(to);
  await dip(false, 340 / rate);
}

function setPano(on) {
  document.body.classList.toggle('pano-on', on);
  if (!on) { doorsEl.replaceChildren(); stopLoop(); }
}

// The view in degrees: where you look is (pano.yaw + gyro, pano.pitch + gyro); drag and the phone add up.
function frame(now) {
  view.raf = 0;
  if (!pano || !document.body.classList.contains('pano-on')) return;
  const dt = Math.min(0.05, (now - (view.last || now)) / 1000);
  view.last = now;
  // Let go of a drag and the turn glides to a stop; left alone, the room slowly turns to show it goes all the way round.
  if (!view.drag) {
    if (Math.abs(view.vy) + Math.abs(view.vp) > 0.5) { pano.yaw += view.vy * dt; pano.pitch += view.vp * dt; view.vy *= 0.9; view.vp *= 0.9; }
    else if (view.idle && !reducedMotion && !running) pano.yaw += 3 * dt;
  }
  pano.pitch = Math.max(-80, Math.min(80, pano.pitch));
  const yaw = pano.yaw, pitch = pano.pitch;
  pano.yaw = yaw + view.gy;
  pano.pitch = Math.max(-85, Math.min(85, pitch + view.gp));
  pano.draw();
  placeDoors();
  pano.yaw = yaw;
  pano.pitch = pitch;
  view.raf = requestAnimationFrame(frame);
}
function kick() { if (!view.raf) { view.last = 0; view.raf = requestAnimationFrame(frame); } }
function stopLoop() { cancelAnimationFrame(view.raf); view.raf = 0; }

function renderDoors() {
  const room = PANOS[current];
  doorsEl.replaceChildren(...Object.entries(room?.doors || {}).map(([to, [y, p]]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pin door';
    b.dataset.yaw = y;
    b.dataset.pitch = p;
    b.textContent = NODES[to].title;
    b.onclick = () => go(to);
    return b;
  }));
  placeDoors();
}
// Doorways sit where they are in the room; one behind you or off to the side waits at the edge, pointing the way.
function placeDoors() {
  if (!doorsEl.children.length) return;
  const w = innerWidth, h = innerHeight, top = 76, bottom = h - (w <= 820 ? 150 : 104);
  for (const b of doorsEl.children) {
    const yaw = +b.dataset.yaw, pitch = +b.dataset.pitch;
    const rel = wrap(yaw - pano.yawA * 180 / Math.PI - (pano.yaw));
    const at = pano.project(yaw, pitch);
    const half = b.offsetWidth / 2 + 12;
    let x, y, side = '';
    if (at && at.x > half && at.x < w - half) { x = at.x; y = at.y; }
    else { side = rel < 0 ? 'l' : 'r'; x = side === 'l' ? half : w - half; y = at ? at.y : h * 0.55; }
    b.style.left = x + 'px';
    b.style.top = Math.max(top, Math.min(bottom, y)) + 'px';
    b.classList.toggle('edge-l', side === 'l');
    b.classList.toggle('edge-r', side === 'r');
  }
}

// Turn the head smoothly to a direction (degrees in the room's panorama).
async function turnTo(yaw, pitch, ms) {
  const y0 = pano.yaw, p0 = pano.pitch, worldYaw = yaw - pano.yawA * 180 / Math.PI - view.gy;
  const dy = wrap(worldYaw - y0), dp = pitch - view.gp - p0, t0 = performance.now();
  view.vy = view.vp = 0;
  for (let k = 0; k < 1;) {
    await nextFrame();
    k = Math.min(1, (performance.now() - t0) / ms);
    pano.yaw = y0 + dy * ease(k);
    pano.pitch = p0 + dp * ease(k);
  }
}

async function enterRoom(to, instant = false) {
  const img = pano.load(panoUrl(to));
  await dip(true, instant ? 0 : 260);
  await img.catch(() => {});
  await pano.show(panoUrl(to), 0);
  view.gyro = null; view.gy = view.gp = 0;
  // Arrive a step inside the doorway and settle back: at most a few degrees, so the room stays sharp.
  const settle = reducedMotion ? 0 : 6;
  pano.yaw = PANOS[to].look; pano.pitch = 0; pano.fov = baseFov() - settle;
  view.idle = true;
  setPano(true);
  kick();
  showHint();
  const lift = dip(false, 380);
  await animate(380, k => { pano.fov = baseFov() - settle * (1 - ease(k)); });
  await lift;
}

async function leaveRoom(to) {
  await dip(true, 260);
  await showStill(to);
  setPano(false);
  await dip(false, 340);
}

// Walking through a doorway: face it, step towards it as the screen dips, and arrive facing into the next room.
async function walkThrough(from, to, rate) {
  view.idle = false;
  const door = PANOS[from].doors[to];
  const next = pano.stage(panoUrl(to), 0);
  if (door && !reducedMotion) await turnTo(door[0], door[1] * 0.5, 380 / rate);
  await next;
  doorsEl.replaceChildren();
  const fov0 = pano.fov, p0 = pano.pitch, step = reducedMotion ? 0 : 10;
  const out = dip(true, 260 / rate);
  await animate(260 / rate, k => { pano.fov = fov0 - step * ease(k); pano.pitch = p0 * (1 - ease(k)); });
  await out;
  // Arrive facing the new room's own view: its panorama is turned so that view is straight ahead.
  pano.yawB = (PANOS[to].look - pano.yaw - view.gy) * Math.PI / 180;
  pano.swap();
  const land = reducedMotion ? 0 : 6;
  pano.fov = baseFov() - land;
  const lift = dip(false, 340 / rate);
  await animate(340 / rate, k => { pano.fov = baseFov() - land * (1 - ease(k)); });
  await lift;
  view.idle = true;
}

let hinted = false;
function showHint() {
  if (hinted) return;
  hinted = true;
  hintEl.textContent = matchMedia('(pointer: coarse)').matches ? 'Drag, or turn your phone, to look all around' : 'Drag to look all around the room';
  hintEl.hidden = false;
  setTimeout(() => { hintEl.hidden = true; }, 4500);
}

if (pano) {
  addEventListener('resize', () => { pano.resize(); placeDoors(); });
  panoEl.addEventListener('pointerdown', e => {
    if (running || e.button > 0) return;
    e.preventDefault();
    try { panoEl.setPointerCapture(e.pointerId); } catch {} // keeps the drag going if the pointer leaves the window
    view.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), pointers: new Map([[e.pointerId, e]]) };
    view.idle = false;
    view.vy = view.vp = 0;
    hintEl.hidden = true;
    document.body.classList.add('looking');
  });
  panoEl.addEventListener('pointermove', e => {
    const d = view.drag;
    if (!d || e.pointerId !== d.id) return;
    // One screen pixel of drag turns the view by one pixel's worth of angle, so the room stays under the finger.
    const degPerPx = pano.vfov() * 180 / Math.PI / innerHeight, now = performance.now(), dt = Math.max(1, now - d.t) / 1000;
    const dy = (e.clientX - d.x) * degPerPx, dp = (e.clientY - d.y) * degPerPx;
    pano.yaw -= dy;
    pano.pitch += dp;
    view.vy = -dy / dt * 0.6;
    view.vp = dp / dt * 0.6;
    d.x = e.clientX; d.y = e.clientY; d.t = now;
  });
  const release = e => {
    if (!view.drag || e.pointerId !== view.drag.id) return;
    if (performance.now() - view.drag.t > 80) view.vy = view.vp = 0; // held still before letting go: no glide
    view.drag = null;
    document.body.classList.remove('looking');
    if (e.type === 'pointerup' && e.pointerType === 'touch') askMotion();
  };
  panoEl.addEventListener('pointerup', release);
  panoEl.addEventListener('pointercancel', release);
  // Scroll (or pinch on a trackpad) to zoom.
  panoEl.addEventListener('wheel', e => {
    if (embedded && !e.ctrlKey) return;
    e.preventDefault();
    pano.fov = Math.max(35, Math.min(125, pano.fov + e.deltaY * (e.ctrlKey ? 0.2 : 0.04)));
    view.idle = false;
  }, { passive: false });
  // Two-finger pinch on a phone.
  let pinch = null;
  panoEl.addEventListener('touchstart', e => {
    if (e.touches.length === 2) { pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), fov: pano.fov }; view.drag = null; }
  }, { passive: true });
  panoEl.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    pano.fov = Math.max(35, Math.min(125, pinch.fov * pinch.d / d));
  }, { passive: true });
  panoEl.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; }, { passive: true });
}

// On a phone, turning the phone turns your head: the aim is where the back of the phone points, relative to where it
// pointed when you entered the room.
function onTilt(e) {
  if (!pano || !document.body.classList.contains('pano-on') || e.alpha == null || e.beta == null) return;
  const r = Math.PI / 180, a = e.alpha * r, b = e.beta * r, g = (e.gamma || 0) * r;
  const fx = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g);
  const fy = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g);
  const fz = -Math.cos(b) * Math.cos(g);
  const heading = Math.atan2(fx, fy) / r, elevation = Math.asin(Math.max(-1, Math.min(1, fz))) / r;
  if (!view.gyro) view.gyro = { heading, elevation };
  view.gy = wrap(heading - view.gyro.heading);
  view.gp = elevation - view.gyro.elevation;
  view.idle = false;
}
let motionAsked = false;
function askMotion() {
  const D = window.DeviceOrientationEvent;
  if (motionAsked || !D?.requestPermission) return;
  motionAsked = true;
  D.requestPermission().catch(() => {});
}
addEventListener('deviceorientation', onTilt);

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
  doorsEl.replaceChildren();
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
  if (pano && PANOS[current]) { pinsEl.replaceChildren(); return renderDoors(); }
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
  if (embedded || document.body.classList.contains('pano-on')) return;
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
  if (!touchStart || e.target.closest('.chips') || document.body.classList.contains('pano-on')) return;
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
    if (document.body.classList.contains('pano-on')) return;
    tx = (0.5 - e.clientX / innerWidth) * innerWidth * 0.018;
    ty = (0.5 - e.clientY / innerHeight) * innerHeight * 0.018;
    if (!raf) raf = requestAnimationFrame(tick);
  }, { passive: true });
}

/* Preload: clips become in-memory blobs so playback starts instantly. Without them, the clips still stream. */
async function preload() {
  Object.values(NODES).forEach(n => { new Image().src = stillUrl(n.still); });
  if (pano) Object.keys(PANOS).forEach(r => pano.load(panoUrl(r)).catch(() => {}));
  // With 360° rooms nothing plays a clip any more: the clips are only the fallback without WebGL.
  const clipEdges = pano ? [] : EDGES;
  const queue = [...clipEdges.map(([a, b]) => clipUrl(a, b)), ...clipEdges.map(([a, b]) => clipUrl(b, a))];
  const bar = $('progress'), total = queue.length;
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        const res = await fetch(url);
        if (res.ok) blobs.set(url, URL.createObjectURL(await res.blob()));
      } catch {}
      bar.style.setProperty('--p', ++done / Math.max(1, total));
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
    showStill(PANOS[hash] && pano ? 'plan' : hash);
    if (pano && PANOS[hash]) enterRoom(hash, true).then(renderPins);
  }
  renderDock();
  renderPins();
  setOverview(current === 'plan');
  addEventListener('resize', () => { if (!running) setOverview(current === 'plan'); });
  if (current === 'tower') { highlightFloor(floor); resumeAuto(); }
  preload();
}
start();
