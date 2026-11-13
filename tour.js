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
  // Rooms are 360° panoramas: choosing a floor goes in through the residence's front door, room to room is a walk
  // through the doorway, and leaving pulls back out to the tower.
  if (pano && from === 'tower' && PANOS[to]) return arrive(to);
  if (pano && PANOS[from] && PANOS[to]) return walkThrough(from, to, rate);
  if (pano && PANOS[to]) return enterRoom(to);
  if (pano && PANOS[from]) return leaveRoom(from, to);
  // Tower and floor plan: the camera flies between the two sharp photographs. (The camera-move clips are only a
  // fallback without WebGL: at 1280 wide they look soft on a big screen.)
  if (pano) return reducedMotion ? dipTo(to, rate) : flyStill(to, stillOrigin('plan'), to === 'plan', rate);
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

/* Smooth moves. The camera is always moving while one scene gives way to the next, and the two overlap only for a
   moment mid-move, so it reads as travelling rather than as a blurry double image. Each scene comes to rest sharp. */
const easeIn = t => t * t * t;
const easeOut = t => 1 - (1 - t) ** 3;
const wrapEl = document.querySelector('.pano-wrap');
// Web Animations, with a timer behind each so a hidden tab cannot stall the tour.
function play(el, frames, opts) {
  const a = el.animate(frames, { fill: 'forwards', ...opts });
  return Promise.race([a.finished.catch(() => {}), sleep(opts.duration + 150)]).then(() => a);
}
// Where on the photograph (in % of the stage) a move heads: the chosen floor on the tower, or a room on the plan.
function stillOrigin(node) {
  if (node === 'plan') { const { top, h } = floorY(floor); return [(FLOOR_RANGE.left + FLOOR_RANGE.right) / 2, top + h / 2]; }
  const pts = ZONES[node]?.split(' ').map(p => p.split(',').map(Number));
  if (!pts) return [50, 50];
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length / 11, pts.reduce((a, p) => a + p[1], 0) / pts.length / 6.22];
}
// Fly into the floor from the tower (inward), or pull back out of it to the tower.
async function flyStill(to, [ox, oy], inward, rate = 1) {
  const D = 1000 / rate;
  const ghost = still.cloneNode();
  ghost.removeAttribute('id');
  ghost.alt = '';
  ghost.style.transformOrigin = `${ox}% ${oy}%`;
  still.after(ghost);
  await showStill(to);
  still.style.transformOrigin = inward ? '50% 50%' : `${ox}% ${oy}%`;
  const [g, n] = await Promise.all(inward
    ? [play(ghost, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(2)', opacity: 1, offset: 0.6 }, { transform: 'scale(2.6)', opacity: 0 }], { duration: D * 0.85, easing: 'cubic-bezier(.45,0,.75,.75)' }),
       play(still, [{ transform: 'scale(1.3)' }, { transform: 'scale(1.3)', offset: 0.5 }, { transform: 'scale(1)' }], { duration: D, easing: 'cubic-bezier(.3,.6,.25,1)' })]
    : [play(ghost, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.88)', opacity: 1, offset: 0.35 }, { transform: 'scale(.8)', opacity: 0 }], { duration: D * 0.6, easing: 'ease-in' }),
       play(still, [{ transform: 'scale(2.4)' }, { transform: 'scale(1)' }], { duration: D, easing: 'cubic-bezier(.2,.65,.25,1)' })]);
  ghost.remove();
  n.cancel();
  g.cancel();
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
  if (instant || reducedMotion) await dip(true, instant ? 0 : 260);
  await img.catch(() => {});
  await pano.show(panoUrl(to), 0);
  view.gyro = null; view.gy = view.gp = 0;
  pano.yaw = PANOS[to].look; pano.pitch = 0;
  view.idle = true;
  if (instant || reducedMotion) {
    pano.fov = baseFov();
    setPano(true);
    kick();
    showHint();
    return dip(false, 380);
  }
  // Zoom into the room on the floor plan; part way in, the room opens out around you and settles.
  const D = 1150, [ox, oy] = stillOrigin(to), push = 28;
  still.style.transformOrigin = `${ox}% ${oy}%`;
  const zoom = play(still, [{ transform: 'scale(1)' }, { transform: 'scale(2.6)' }], { duration: D * 0.6, easing: 'cubic-bezier(.5,0,.8,.7)' });
  await sleep(D * 0.38);
  pano.fov = baseFov() - push;
  const appear = play(wrapEl, [{ opacity: 0 }, { opacity: 1 }], { duration: D * 0.22, easing: 'linear' });
  setPano(true);
  kick();
  await animate(D * 0.62, k => { pano.fov = baseFov() - push * (1 - easeOut(k)); });
  (await appear).cancel();
  (await zoom).cancel();
  showHint();
}

async function leaveRoom(from, to) {
  if (reducedMotion) {
    await dip(true, 260);
    await showStill(to);
    setPano(false);
    return dip(false, 340);
  }
  // Step back out of the room: it falls away as the camera pulls back from the floor to the whole tower.
  await showStill(to);
  const D = 1000, [ox, oy] = stillOrigin(to === 'tower' ? 'plan' : from), fov0 = pano.fov;
  still.style.transformOrigin = `${ox}% ${oy}%`;
  doorsEl.replaceChildren();
  const settle = play(still, [{ transform: 'scale(2.4)' }, { transform: 'scale(1)' }], { duration: D, easing: 'cubic-bezier(.2,.65,.25,1)' });
  const fade = play(wrapEl, [{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: D * 0.5, easing: 'linear' });
  await animate(D * 0.5, k => { pano.fov = fov0 + (125 - fov0) * easeIn(k); });
  await fade;
  setPano(false);
  (await fade).cancel();
  (await settle).cancel();
}

// Arriving on a floor: the camera pushes in on that floor of the tower, comes to rest at the residence's front door,
// the doors swing open onto the living room, and you walk through into it.
// The front door photographs (wide for landscape screens, tall for phones held upright): image size in pixels and the
// doorway inside the brass frame as [left, top, right, bottom], also in pixels.
const ENTRY = {
  wide: { size: [2688, 1520], door: [877, 220, 1813, 1343] },
  tall: { size: [1520, 2688], door: [271, 806, 1250, 1976] },
};
const entryEl = $('entry'), entryScene = $('entryScene'), entryPhoto = $('entryPhoto'), entryFrame = $('entryFrame');
const spillEl = $('entrySpill'), leaves = entryEl.querySelectorAll('.leaf');
function setEntry() {
  const name = innerWidth / innerHeight < 0.9 ? 'tall' : 'wide', { size: [w, h], door: [l, t, r, b] } = ENTRY[name];
  const src = `assets/entry/${name}`;
  if (!$('entryWall').src.endsWith(src + '.webp')) {
    $('entryWall').src = src + '.webp';
    leaves[0].src = src + '-l.webp';
    leaves[1].src = src + '-r.webp';
  }
  const st = entryPhoto.style;
  st.setProperty('--ar', w / h);
  st.setProperty('--dl', l / w * 100 + '%');
  st.setProperty('--dt', t / h * 100 + '%');
  st.setProperty('--dw', (r - l) / w * 100 + '%');
  st.setProperty('--dh', (b - t) / h * 100 + '%');
}
// Load the photographs before they're needed, so the door is never drawn half-loaded.
function preloadEntry() {
  setEntry();
  return Promise.all([$('entryWall'), ...leaves].map(i => i.decode().catch(() => {})));
}

async function arrive(to) {
  const ready = pano.load(panoUrl(to)).catch(() => {});
  const doorReady = preloadEntry();
  document.body.classList.add('arriving');
  const settleRoom = async fov => {
    await ready;
    await pano.show(panoUrl(to), 0);
    view.gyro = null; view.gy = view.gp = 0; view.vy = view.vp = 0;
    pano.yaw = PANOS[to].look; pano.pitch = 0; pano.fov = fov;
    view.idle = true;
  };
  const showRoom = () => { setPano(true); kick(); };
  if (reducedMotion) {
    await dip(true, 260);
    await settleRoom(baseFov());
    showRoom();
    document.body.classList.remove('arriving');
    showHint();
    return dip(false, 380);
  }
  // 1. Push in on the floor. Equal steps in scale read as a steady speed, so the zoom has no lurch.
  const [ox, oy] = stillOrigin('plan'), ZOOM = 1150;
  still.style.transformOrigin = `${ox}% ${oy}%`;
  still.style.willChange = 'transform';
  const zoom = play(still, [0, 1, 2, 3, 4, 5, 6].map(i => ({ transform: `scale(${(5.5 ** (i / 6)).toFixed(3)})` })), { duration: ZOOM, easing: 'cubic-bezier(.55,0,.8,.55)' });
  await Promise.all([doorReady, sleep(ZOOM * 0.66)]);
  // 2. ...still moving, arrive at the residence's front door and come to a stop in front of it.
  leaves.forEach(l => { l.style.transform = ''; });
  entryEl.classList.add('on');
  entryScene.style.transform = 'none';
  const fr = entryFrame.getBoundingClientRect();
  entryScene.style.transform = '';
  entryScene.style.transformOrigin = `${fr.left + fr.width / 2}px ${fr.top + fr.height / 2}px`;
  entryFrame.style.perspective = fr.height * 2.2 + 'px';
  $('plaque').textContent = `${floor}A`;
  $('plaque').style.fontSize = fr.height * 0.07 + 'px';
  const near = 1.14;
  const approach = play(entryScene, [{ transform: 'scale(1)' }, { transform: `scale(${near})` }], { duration: 1000, easing: 'cubic-bezier(.12,.62,.3,1)' });
  const appear = play(entryEl, [{ opacity: 0 }, { opacity: 1 }], { duration: ZOOM * 0.34, easing: 'linear' });
  await settleRoom(124);
  await appear;
  showRoom(); // behind the closed doors, so nothing shows yet
  (await zoom).cancel();
  still.style.willChange = '';
  await approach;
  await sleep(220);
  // 3. The doors swing open, and warm light falls out across the floor...
  const OPEN = 1150, swing = { duration: OPEN, easing: 'cubic-bezier(.5,0,.2,1)' };
  const opened = Promise.all([
    play(leaves[0], [{ transform: 'rotateY(0deg)', filter: 'brightness(1)' }, { transform: 'rotateY(100deg)', filter: 'brightness(.45)' }], swing),
    play(leaves[1], [{ transform: 'rotateY(0deg)', filter: 'brightness(1)' }, { transform: 'rotateY(-100deg)', filter: 'brightness(.45)' }], swing),
    play(spillEl, [{ opacity: 0 }, { opacity: 1 }], { duration: OPEN * 0.8, easing: 'ease-out' }),
  ]);
  await sleep(OPEN * 0.5);
  // 4. ...and you walk through the doorway into the living room, which settles around you.
  const WALK = 1400, cover = Math.max(innerWidth / fr.width, innerHeight / fr.height) * 1.4;
  const walk = play(entryScene, [{ transform: `scale(${near})` }, { transform: `scale(${(near * cover) ** 0.5})`, offset: 0.6 }, { transform: `scale(${cover})` }], { duration: WALK, easing: 'cubic-bezier(.45,0,.7,1)' });
  const leave = play(entryEl, [{ opacity: 1 }, { opacity: 1, offset: 0.72 }, { opacity: 0 }], { duration: WALK, easing: 'linear' });
  const fov0 = pano.fov, base = baseFov();
  await animate(WALK + 350, k => { pano.fov = fov0 + (base - fov0) * easeOut(k); });
  await Promise.all([walk, leave, opened]);
  entryEl.classList.remove('on');
  for (const a of entryEl.getAnimations({ subtree: true })) a.cancel();
  document.body.classList.remove('arriving');
  showHint();
}

// Walking through a doorway: face it, push through it, and the next room settles around you. The two rooms overlap
// only for a moment at the fastest point of the push.
async function walkThrough(from, to, rate) {
  view.idle = false;
  const door = PANOS[from].doors[to];
  const next = pano.stage(panoUrl(to), 0);
  if (door && !reducedMotion) await turnTo(door[0], door[1] * 0.5, 380 / rate);
  await next;
  doorsEl.replaceChildren();
  // Arrive facing the new room's own view: its panorama is turned so that view is straight ahead.
  pano.yawB = (PANOS[to].look - pano.yaw - view.gy) * Math.PI / 180;
  if (reducedMotion) {
    await dip(true, 260);
    pano.swap();
    await dip(false, 340);
    view.idle = true;
    return;
  }
  const D = 1200 / rate, base = baseFov(), fov0 = pano.fov, p0 = pano.pitch, low = Math.min(fov0, base) - 26;
  await animate(D, k => {
    if (k < 0.5) { const e = easeIn(k / 0.5); pano.fov = fov0 + (low - fov0) * e; pano.pitch = p0 * (1 - e); }
    else { pano.fov = low + (base - low) * easeOut((k - 0.5) / 0.5); pano.pitch = 0; }
    pano.mixB = Math.min(1, Math.max(0, (k - 0.4) / 0.2));
  });
  pano.swap();
  pano.fov = base;
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
    // With 360° rooms there's no stop at the floor plan: a floor is entered at its front door, which opens onto the
    // living room, and leaving any room goes straight back out to the tower.
    const next = pano && current === 'tower' ? 'living' : pano && target === 'tower' ? 'tower' : route(current, target)[0];
    walking = walking || next !== target;
    await move(current, next, walking && current !== 'tower' ? 1.5 : 1);
    current = next;
    if (pano) markMinimap(current);
  }
  running = false;
  document.body.classList.remove('moving');
  renderPins();
  setOverview(current === 'plan');
  if (current === 'tower') highlightFloor(floor);
}

function go(node, push = true) {
  if (pano && node === 'plan') node = 'living'; // the floor plan is the minimap now; "enter the floor" goes in the front door
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
    chips.replaceChildren(...(pano ? [] : [chip('Floor', 'plan', target === 'plan')]), ...ROOMS.map(r => chip(shortName(r), r, r === target)));
  }
  $('mmFloor').textContent = `Floor ${floor}`;

  if (target === 'tower') return $('crumbs').replaceChildren();
  const crumbs = [['tower', 'Tower'], [pano ? null : 'plan', `Floor ${floor}`]];
  if (ROOMS.includes(target)) crumbs.push([target, NODES[target].title]);
  $('crumbs').replaceChildren(...crumbs.flatMap(([n, label], i) => {
    const link = i < crumbs.length - 1 && n;
    const el = document.createElement(link ? 'button' : 'span');
    el.textContent = label;
    if (link) { el.type = 'button'; el.onclick = () => go(n); }
    return i ? [Object.assign(document.createElement('span'), { textContent: '/', ariaHidden: 'true' }), el] : [el];
  }));
}

const shortName = r => ({ kitchen: 'Kitchen', bedroom: 'Bedroom', bath: 'Bath' })[r] || NODES[r].title;

/* Minimap: the residence's floor plan, drawn like an architect's plan, in the corner while you're inside.
   Units are tenths of a foot; x runs along the window wall (y = 0, facing the water), y runs back to the entrance. */
const PLAN = {
  view: [-24, -46, 818, 300],
  rooms: {
    bedroom: { pts: '0,0 180,0 180,180 0,180', at: [92, 150], dims: '18′ × 15′' },
    bath:    { pts: '180,0 290,0 290,140 180,140', at: [228, 112], dims: '14′ × 11′' },
    living:  { pts: '290,0 550,0 550,180 290,180', at: [420, 162], dims: '26′ × 18′' },
    kitchen: { pts: '550,0 770,0 770,160 640,160 640,180 550,180', at: [690, 145], dims: '22′ × 16′' },
  },
  minor: [['WC', 235, 163], ['Gallery', 420, 202], ['Entry', 705, 190]],
  walls: 'M0,0V220H685 M735,220H770V0 M180,0V100 M180,130V180H175 M0,180H140 M180,140H290 M290,0V180H250 M220,180H180 M550,0V30 M550,150V180 M640,160H770 M640,160V180',
  glass: 'M0,-3H770 M0,3H770 M90,-3V3 M180,-3V3 M235,-3V3 M290,-3V3 M420,-3V3 M550,-3V3 M660,-3V3',
  doors: 'M175,180V145A35,35 0 0 0 140,180 M180,130H210A30,30 0 0 0 180,100 M250,180V150A30,30 0 0 0 220,180',
  entry: 'M685,220V195A25,25 0 0 1 710,220 M735,220V195A25,25 0 0 0 710,220',
  furniture: [
    'M24,34h122v112h-122z', 'M12,48h70v70h-70z', 'M16,53h14v26h-14z', 'M16,87h14v26h-14z', 'M12,32h16v12h-16z', 'M12,122h16v12h-16z', 'M90,56h10v54h-10z', // bed, pillows, side tables, bench
    'M235,16a34,16 0 1 0 0.1,0', 'M266,52h18v70h-18z', 'M275,72a6,6 0 1 0 0.1,0', 'M275,102a6,6 0 1 0 0.1,0', // tub, vanity, basins
    'M266,152a6,9 0 1 0 0.1,0', 'M196,154a6,6 0 1 0 0.1,0', // WC, basin
    'M318,36h200v114h-200z', 'M336,62Q336,134 404,134Q472,134 472,62', 'M404,80a14,14 0 1 0 0.1,0', 'M490,98a13,13 0 1 0 0.1,0', // rug, curved sofa, table, chair
    'M615,26a26,44 0 1 0 0.1,0', 'M579,44a6,6 0 1 0 0.1,0', 'M579,70a6,6 0 1 0 0.1,0', 'M579,96a6,6 0 1 0 0.1,0', 'M651,44a6,6 0 1 0 0.1,0', 'M651,70a6,6 0 1 0 0.1,0', 'M651,96a6,6 0 1 0 0.1,0', 'M615,12a6,6 0 1 0 0.1,0', 'M615,128a6,6 0 1 0 0.1,0', // dining
    'M688,40h24v84h-24z', 'M748,8h16v144h-16z', 'M660,8h88v14h-88z', 'M652,190h30v10h-30z', // island, counters, console
  ],
};
const mapEl = $('minimap');
const svgEl = (tag, attrs) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const planPos = ([x, y]) => { const [vx, vy, vw, vh] = PLAN.view; return [(x - vx) / vw * 100, (y - vy) / vh * 100]; };
function buildMinimap() {
  const svg = $('mmPlan'), [vx, vy, vw, vh] = PLAN.view;
  svg.setAttribute('viewBox', PLAN.view.join(' '));
  let grid = '';
  for (let x = 0; x <= 780; x += 20) grid += `M${x},${vy}V${vy + vh}`;
  for (let y = -40; y <= vy + vh; y += 20) grid += `M${vx},${y}H${vx + vw}`;
  svg.append(svgEl('path', { d: grid, class: 'mm-grid' }));
  for (const [room, { pts }] of Object.entries(PLAN.rooms)) {
    const p = svgEl('polygon', { points: pts, class: 'mm-room', 'data-room': room });
    p.addEventListener('click', () => go(room));
    svg.append(p);
  }
  svg.append(svgEl('path', { d: 'M0,180H770V220H0Z M640,160H770V180H640Z', class: 'mm-room', style: 'pointer-events:none' }));
  for (const d of PLAN.furniture) svg.append(svgEl('path', { d, class: 'mm-furn' }));
  svg.append(svgEl('path', { d: PLAN.glass, class: 'mm-glass' }),
    svgEl('path', { d: PLAN.walls, class: 'mm-wall' }),
    svgEl('path', { d: PLAN.doors, class: 'mm-door' }),
    svgEl('path', { d: PLAN.entry, class: 'mm-door mm-entry' }));
  const water = svgEl('text', { x: 385, y: -20, 'text-anchor': 'middle', class: 'mm-note' });
  water.textContent = 'WATERFRONT';
  svg.append(water);
  const label = (cls, at, html) => {
    const el = document.createElement(cls === 'minor' ? 'span' : 'button');
    el.className = 'mm-label' + (cls ? ' ' + cls : '');
    const [l, t] = planPos(at);
    el.style.left = l + '%';
    el.style.top = t + '%';
    el.innerHTML = html;
    return el;
  };
  $('mmInner').append(
    ...PLAN.minor.map(([name, x, y]) => label('minor', [x, y], name)),
    ...Object.entries(PLAN.rooms).map(([room, { at, dims }]) => {
      const b = label('', at, `${shortName(room)}<small>${dims}</small>`);
      b.type = 'button';
      b.dataset.room = room;
      b.setAttribute('aria-label', `Go to the ${NODES[room].title}`);
      b.onclick = () => go(room);
      return b;
    }),
    Object.assign(document.createElement('i'), { className: 'mm-you', id: 'mmYou' }));
  $('mmToggle').onclick = () => {
    const closed = mapEl.classList.toggle('closed');
    $('mmToggle').setAttribute('aria-expanded', !closed);
  };
}
// "You are here": the room lights up, and a dot sits in it (just above its label).
function markMinimap(room) {
  mapEl.querySelectorAll('[data-room]').forEach(el => {
    el.classList.toggle('here', el.dataset.room === room);
    if (el.tagName === 'BUTTON') el.toggleAttribute('aria-current', el.dataset.room === room);
  });
  const r = PLAN.rooms[room], you = $('mmYou');
  if (!r || !you) return;
  const [l, t] = planPos([r.at[0], r.at[1] - 44]);
  you.style.left = l + '%';
  you.style.top = t + '%';
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
  const order = pano ? ORDER.filter(n => n !== 'plan') : ORDER;
  const i = order.indexOf(target) + dir;
  if (order[i]) go(order[i]);
};
const up = () => { const p = pano && PANOS[target] ? 'tower' : NODES[target].parent; if (p) go(p); };
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
  if (pano) { Object.keys(PANOS).forEach(r => pano.load(panoUrl(r)).catch(() => {})); preloadEntry(); }
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
  if (pano) buildMinimap();
  let hash = location.hash.slice(1);
  if (pano && hash === 'plan') hash = 'living';
  if (NODES[hash] && hash !== 'tower') {
    current = target = hash;
    if (pano) markMinimap(hash);
    showStill(PANOS[hash] && pano ? 'tower' : hash);
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
