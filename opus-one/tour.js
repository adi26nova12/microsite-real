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

// `home` is the residence as a 3D model; the tour starts there. The rooms open from it as full photographs.
const NODES = {
  tower:   { title: 'Select a House', still: 'tower' },
  home:    { title: 'Your residence in 3D', chip: '3D view', still: 'lobby', parent: 'tower' },
  foyer:   { title: 'Entrance Foyer', chip: 'Foyer', still: 'foyer', parent: 'home', specs: 'Italian marble flooring' },
  living:  { title: 'Lounge', chip: 'Living', still: 'living', parent: 'home', specs: 'Italian marble · home automation' },
  dining:  { title: 'Dining', chip: 'Dining', still: 'dining', parent: 'home', specs: 'Italian marble flooring' },
  bedroom: { title: 'Master Bedroom', chip: 'Bedroom', still: 'bedroom', parent: 'home', specs: 'Laminate wood & Italian marble' },
  bath:    { title: 'Master Bath', chip: 'Bath', still: 'bath', parent: 'bedroom', specs: 'Hansgrohe / TOTO · Duravit' },
};
const ROOMS = ['home', 'foyer', 'living', 'dining', 'bedroom', 'bath'];
const ORDER = ['tower', 'home', 'foyer', 'living', 'dining', 'bedroom', 'bath'];

// Each edge is one move. An edge with a frame sequence is a real camera move (played backwards to return); the rest walk from still to still.
const EDGES = [
  ['tower', 'home', { seq: 'entrance', frames: 79, fps: 24 }],
  ['home', 'foyer'],
  ['home', 'living'],
  ['home', 'dining'],
  ['home', 'bedroom'],
  ['home', 'bath'],
  ['foyer', 'living'],
  ['living', 'dining'],
  ['living', 'bedroom'],
  ['bedroom', 'bath'],
];

// Labelled pins that lead on from each room (% of the stage).
const PINS = {
  foyer: [['living', 30, 50]],
  living: [['dining', 16, 70], ['bedroom', 86, 46], ['foyer', 50, 86]],
  dining: [['living', 86, 52]],
  bedroom: [['bath', 9, 44], ['living', 86, 84]],
  bath: [['bedroom', 84, 48]],
};

// Rooms on the 3D model: points on its surface (metres in model space), picked from a top-down view of assets/model/residence.glb.
const MODEL = { plan: 'evalia-3', layout: '3+1 BHK · Evalia & Cecilia layout' };
const SPOTS = [
  { room: 'living', label: 'Lounge', at: [-0.222, 0.014, 0.158] },
  { room: 'dining', label: 'Dining', at: [0.046, 0.047, 0.02] },
  { room: 'bedroom', label: 'Master Bedroom', at: [-0.226, -0.019, 0.37] },
  { room: 'bath', label: 'Master Bath', at: [-0.289, -0.045, 0.008] },
  { room: 'foyer', label: 'Entrance Foyer', at: [0.31, -0.045, 0.264] },
  { room: null, label: 'Kitchen', at: [0.23, -0.045, 0.067], specs: 'Italian marble counters · Häfele fittings' },
  { room: null, label: 'Balcony', at: [-0.453, -0.011, 0.053], specs: 'Glass railing · anti-skid tiles' },
];

// Inside a room you stand where the render's camera stood. SRC_FOV is the renders' horizontal lens angle (degrees);
// ROOM_ZOOM is how far the view is narrowed inside it, which is the room left over for looking around.
const SRC_FOV = 90;
const ROOM_ZOOM = { landscape: 1.4, portrait: 1.2 };

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

const stillUrl = name => `assets/stills/${NODES[name]?.still ?? name}.webp`;
const edgeOf = (a, b) => EDGES.find(e => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a));

let current = 'home', target = 'home', running = false, house = 1;

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
  // From the 3D model into a room the camera dives down to it, then the model fades and you're standing in the room.
  if (from === 'home' && to !== 'tower') {
    await diveTo(to);
    await showStill(to);
    firstPerson(true, true);
    return show3d(false);
  }
  if (to === 'home' && from !== 'tower') { await show3d(true); firstPerson(false); return showStill(to); }
  if (from === 'home') await show3d(false);
  // Room to room: you walk through while your head turns back to face straight ahead.
  if (inRoom(from) && inRoom(to)) {
    await Promise.all([walk(to, forward, rate), reducedMotion ? centreLook() : lookTo(0, 0, Math.round(760 / rate))]);
    return;
  }
  if (seq && !reducedMotion && await playSequence(seq, edge[0] !== from, rate)) {
    await showStill(to);
    if (to === 'home') await show3d(true);
    seqEl.classList.remove('on');
    await sleep(240);
    return;
  }
  await walk(to, forward, rate);
  if (to === 'home') await show3d(true);
}

/* The residence in 3D */
const model = $('model');
const HOME_ORBIT = '90deg 55deg auto'; // from the entrance side, balcony and bedrooms at the back
// Coming back to the model always shows the whole residence again, not the room last zoomed into.
async function show3d(on) {
  if (on) resetView();
  else closeSpot();
  document.body.classList.toggle('three-on', on);
  model.autoRotate = on && !reducedMotion;
  await sleep(420);
}

function placeSpots() {
  model.querySelectorAll('.spot').forEach(b => b.remove());
  SPOTS.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = s.room ? 'spot' : 'spot info';
    b.slot = `hotspot-${i}`;
    b.dataset.position = s.at.map(v => v + 'm').join(' ');
    b.dataset.normal = '0m 1m 0m';
    b.textContent = s.label;
    b.onclick = e => { e.stopPropagation(); openSpot(i); };
    model.append(b);
  });
}

// Fly the camera down to a spot on the model; `near` is the distance as a share of the residence's width.
function flyTo(i, near, polar) {
  const b = model.querySelector(`[slot="hotspot-${i}"]`), size = model.getDimensions();
  if (!b) return;
  model.autoRotate = false;
  model.cameraTarget = b.dataset.position;
  model.cameraOrbit = `${model.getCameraOrbit().theta}rad ${polar} ${Math.max(size.x, size.z) * near}m`;
  model.querySelectorAll('.spot.on').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
}
async function diveTo(room) {
  const i = SPOTS.findIndex(s => s.room === room);
  if (i < 0 || reducedMotion || !model.loaded) return;
  closeSpot();
  flyTo(i, 0.25, '35deg');
  await sleep(700);
}

// A room on the model takes you straight into it; the kitchen and balcony have no photograph, so they show a card.
function openSpot(i) {
  const s = SPOTS[i];
  if (s.room) return go(s.room);
  flyTo(i, 0.6, '45deg');
  $('spotTitle').textContent = s.label;
  $('spotSpecs').textContent = s.specs || NODES[s.room].specs || '';
  $('spotGo').hidden = !s.room;
  $('spotGo').onclick = () => go(s.room);
  $('spotCard').hidden = false;
}
function closeSpot() {
  $('spotCard').hidden = true;
  model.querySelectorAll('.spot.on').forEach(x => x.classList.remove('on'));
}
function resetView() {
  closeSpot();
  model.cameraTarget = 'auto auto auto';
  // A tall phone screen gets a closer, steeper view so the residence fills it.
  model.cameraOrbit = innerWidth < innerHeight ? '90deg 60deg 1.8m' : HOME_ORBIT;
  model.resetTurntableRotation?.();
  model.autoRotate = !reducedMotion;
}
$('spotClose').onclick = resetView;
model.addEventListener('load', placeSpots);
// In a microsite, vertical swipes over the model still scroll the page around it.
if (embedded) model.setAttribute('touch-action', 'pan-y');

/* First person: in a room, the render is the view in front of you, set at the distance that matches its lens.
   Dragging (or turning the phone) turns your head inside it, so the perspective shifts the way a real room does. */
const zoomer = $('zoomer'), viewport = $('viewport'), hint = $('lookHint'), fpPinsEl = $('fpPins');
const inRoom = n => ROOMS.includes(n) && n !== 'home';
const look = { on: false, y: 0, p: 0, ty: 0, tp: 0, gy: 0, gp: 0, W: 0, H: 0, P: 1, k: 1, raf: 0, drag: null, tween: false, gyro: false };

function lens() {
  look.k = innerWidth < innerHeight ? ROOM_ZOOM.portrait : ROOM_ZOOM.landscape;
  look.W = stage.offsetWidth * look.k;
  look.H = stage.offsetHeight * look.k;
  look.P = look.W / 2 / Math.tan(SRC_FOV * Math.PI / 360);
  viewport.style.perspective = look.P + 'px';
}

// Does the screen stay inside the render with the head turned y (right +) and tilted p (up +), both in radians?
function sees(y, p) {
  const { W, H, P } = look, cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p);
  for (const u of [-innerWidth / 2, innerWidth / 2]) for (const v of [-innerHeight / 2, innerHeight / 2]) {
    const y1 = v * cp + P * sp, z1 = v * sp - P * cp; // corner ray, tilted
    const x2 = u * cy - z1 * sy, z2 = u * sy + z1 * cy; // then turned
    if (z2 >= 0) return false;
    const t = -P / z2;
    if (Math.abs(x2 * t) > W / 2 + 0.5 || Math.abs(y1 * t) > H / 2 + 0.5) return false;
  }
  return true;
}
function bisect(ok) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
  return lo;
}
// Turning sideways wins over tilting: the sideways limit is taken level, then the tilt is fitted to it.
function clampLook(y, p) {
  if (sees(y, p)) return [y, p];
  if (!sees(y, 0)) y *= bisect(t => sees(y * t, 0));
  if (!sees(y, p)) p *= bisect(t => sees(y, p * t));
  return [y, p];
}

function applyLook() {
  zoomer.style.transform = `translateZ(${look.P}px) rotateX(${look.p}rad) rotateY(${look.y}rad) translateZ(${-look.P}px) scale(${look.k})`;
  placePins();
}

// Doorway pins sit on the screen, not on the render, so one that's off to the side waits at the edge pointing the way.
function placePins() {
  const cy = Math.cos(look.y), sy = Math.sin(look.y), cp = Math.cos(look.p), sp = Math.sin(look.p), P = look.P;
  const top = 76, bottom = innerHeight - (innerWidth <= 820 ? 150 : 104);
  for (const b of fpPinsEl.children) {
    const X = (b.dataset.x / 100 - 0.5) * look.W, Y = (0.5 - b.dataset.y / 100) * look.H;
    const x1 = cy * X - sy * P, z1 = -sy * X - cy * P; // turned
    const y2 = cp * Y + sp * z1, z2 = -sp * Y + cp * z1; // then tilted
    let sx = innerWidth / 2 + x1 * P / -z2, sY = innerHeight / 2 - y2 * P / -z2;
    const half = b.offsetWidth / 2 + 12;
    const side = sx < half ? 'l' : sx > innerWidth - half ? 'r' : '';
    sx = Math.max(half, Math.min(innerWidth - half, sx));
    sY = Math.max(top, Math.min(bottom, sY));
    b.style.left = sx + 'px';
    b.style.top = sY + 'px';
    b.classList.toggle('edge-l', side === 'l');
    b.classList.toggle('edge-r', side === 'r');
  }
}
function lookLoop() {
  if (!look.on) return void (look.raf = 0);
  const [y, p] = clampLook(look.ty + look.gy, look.tp + look.gp);
  // Dragging past the edge doesn't wind up: the aim stops where the view stops. (A phone turned past the edge
  // isn't trimmed, so the view comes back to the same place when the phone does.)
  if (look.drag || !look.gyro) {
    look.ty = y - look.gy;
    look.tp = p - look.gp;
  }
  const ease = look.drag || look.tween ? 0.5 : 0.18;
  look.y += (y - look.y) * ease;
  look.p += (p - look.p) * ease;
  applyLook();
  const busy = look.drag || look.tween || look.gyro || Math.abs(y - look.y) + Math.abs(p - look.p) > 1e-4;
  look.raf = look.on && busy ? requestAnimationFrame(lookLoop) : 0;
}
const kick = () => { if (look.on && !look.raf) look.raf = requestAnimationFrame(lookLoop); };

async function lookTo(y, p, ms) {
  const y0 = look.ty, p0 = look.tp, t0 = performance.now();
  look.tween = true;
  kick();
  for (let k = 0; k < 1;) {
    await nextFrame();
    k = Math.min(1, (performance.now() - t0) / ms);
    const e = 1 - (1 - k) ** 3;
    look.ty = y0 + (y - y0) * e;
    look.tp = p0 + (p - p0) * e;
  }
  look.tween = false;
  look.y = look.ty + look.gy;
  look.p = look.tp + look.gp;
  if (look.on) applyLook();
}
function centreLook() {
  look.y = look.p = look.ty = look.tp = 0;
  if (look.on) applyLook();
}

// The angle to a point on the render, given as % of the stage like the room pins.
function aimAt(x, y) {
  const u = (x / 100 - 0.5) * look.W, v = (0.5 - y / 100) * look.H;
  return clampLook(Math.atan2(u, look.P), Math.atan2(v, Math.hypot(u, look.P)));
}

let hinted = false, hintTimer = 0;
function showHint() {
  if (hinted) return;
  hinted = true;
  hint.textContent = matchMedia('(pointer: coarse)').matches ? 'Drag, or turn your phone, to look around' : 'Drag to look around the room';
  hint.hidden = false;
  hintTimer = setTimeout(hideHint, 4200);
}
function hideHint() { clearTimeout(hintTimer); hint.hidden = true; }

function firstPerson(on, sweep) {
  if (on === look.on) return;
  look.on = on;
  if (!on) {
    cancelAnimationFrame(look.raf);
    look.raf = 0;
    look.drag = null;
    centreLook();
    viewport.style.perspective = zoomer.style.transform = zoomer.style.transition = '';
    return hideHint();
  }
  tx = ty = px = py = 0;
  stage.style.transform = '';
  zoomer.style.transition = 'none';
  gyroBase = null;
  look.gy = look.gp = 0;
  lens();
  centreLook();
  showHint();
  // Arriving, the head starts turned a little and comes round to face the room, which says "you can look around".
  if (sweep && !reducedMotion) {
    look.ty = look.y = clampLook(1, 0)[0] * 0.8;
    applyLook();
    lookTo(0, 0, 1800);
  }
  kick();
}

viewport.addEventListener('dragstart', e => e.preventDefault());
viewport.addEventListener('pointerdown', e => {
  if (!look.on || running || e.button > 0 || e.target.closest('.pin')) return;
  if (e.pointerType === 'mouse') e.preventDefault();
  look.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, ty: look.ty, tp: look.tp };
  document.body.classList.add('looking');
  hideHint();
  kick();
});
// Grab and drag: the room follows the finger.
addEventListener('pointermove', e => {
  const d = look.drag;
  if (!d || e.pointerId !== d.id) return;
  look.ty = d.ty - (e.clientX - d.x) / look.P;
  look.tp = d.tp + (e.clientY - d.y) / look.P;
});
function endDrag(e) {
  if (!look.drag || e.pointerId !== look.drag.id) return;
  look.drag = null;
  document.body.classList.remove('looking');
  if (e.type === 'pointerup' && e.pointerType === 'touch') askMotion();
}
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);

// On a phone, turning the phone turns your head. The aim is where the back of the phone points, relative to where it
// pointed when the room opened, so it works however the phone is held.
let gyroBase = null;
function onTilt(e) {
  if (!look.on || e.alpha == null || e.beta == null) return;
  const r = Math.PI / 180, a = e.alpha * r, b = e.beta * r, g = (e.gamma || 0) * r;
  const fx = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g);
  const fy = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g);
  const fz = -Math.cos(b) * Math.cos(g);
  const heading = Math.atan2(fx, fy), elevation = Math.asin(Math.max(-1, Math.min(1, fz)));
  if (!gyroBase) gyroBase = { heading, elevation };
  let dh = heading - gyroBase.heading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  look.gy = dh;
  look.gp = elevation - gyroBase.elevation;
  look.gyro = true;
  kick();
}
let motionAsked = false;
function askMotion() {
  const D = window.DeviceOrientationEvent;
  if (motionAsked || !D?.requestPermission) return;
  motionAsked = true;
  D.requestPermission().catch(() => {});
}
// Listen everywhere; on iPhone the readings only start once the first touch in a room has asked for motion access.
addEventListener('deviceorientation', onTilt);

async function run() {
  if (running) return;
  running = true;
  document.body.classList.add('moving');
  pinsEl.replaceChildren();
  fpPinsEl.replaceChildren();
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
  $('specs').textContent = target === 'tower' ? `From ${sqft(fromSuper(h))} super area`
    : target === 'home' ? (h.units.some(u => u.plan === MODEL.plan) ? 'Drag to turn · pinch to zoom · tap a room' : `Shown: ${MODEL.layout}`)
    : node.specs || '';

  const chips = $('chips');
  if (target === 'tower') {
    chips.replaceChildren(stepChip(-1), chip(`Enter ${h.name.replace(' House', '')}`, 'home', true), stepChip(1), planChip());
  } else if (target === 'home') {
    chips.replaceChildren(chip('Building', 'tower'), ...ROOMS.map(r => chip(NODES[r].chip, r, r === target)), planChip());
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
    if (e.pointerType !== 'touch') go('home');
  });
  tipEl.addEventListener('click', () => go('home'));
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
  fpPinsEl.replaceChildren();
  (look.on ? fpPinsEl : pinsEl).replaceChildren(...(PINS[current] || []).map(([room, x, y]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pin';
    b.dataset.x = x;
    b.dataset.y = y;
    b.style.left = x + '%';
    b.style.top = y + '%';
    b.textContent = NODES[room].title;
    // Turn to face the doorway first, then walk through it.
    b.onclick = async () => {
      if (running || look.tween) return;
      if (look.on && !reducedMotion) await lookTo(...aimAt(x, y).map((a, i) => a - (i ? look.gp : look.gy)), 420);
      go(room);
    };
    return b;
  }));
  if (look.on) placePins();
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
  if (document.body.classList.contains('three-on') && e.target.closest?.('.apt3d')) return; // the wheel zooms the model
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
  // In a room a drag looks around and on the model it turns the model, so neither is a swipe to the next room.
  if (!touchStart || e.target.closest('.chips, .plan, .apt3d') || look.on) return;
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
    if (look.on) return;
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
  if (NODES[hash]) current = target = hash;
  if (current !== 'tower') showStill(current);
  if (current === 'home') show3d(true);
  if (inRoom(current)) firstPerson(true);
  renderDock();
  renderPins();
  if (current === 'tower') { highlightHouse(house); resumeAuto(); }
  addEventListener('resize', () => {
    if (!running && current === 'tower') highlightHouse(house);
    if (look.on) { lens(); kick(); }
  });
  preload();
}
start();
