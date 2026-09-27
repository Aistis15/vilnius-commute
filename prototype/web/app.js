'use strict';

/* Vilnius Commute — browser prototype.
 *
 * Everything inside the phone frame behaves like the iPhone app will: the
 * lock-screen button opens the banner, the banner asks where to go, listens,
 * plans on the real Vilnius timetable and then changes by itself as the trip
 * goes on. The panel beside the phone only exists to test that without
 * waiting for real buses: it speeds up the clock and stands in for a
 * microphone. */

// ---------------------------------------------------------------- utilities

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const pad = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
const uid = () => Math.random().toString(36).slice(2, 10);
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('vc.' + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('vc.' + key, JSON.stringify(value)); } catch { /* private mode: fine */ }
  },
};

// Lithuanian plurals: 1 stotelė, 2 stotelės, 10 stotelių.
function plural(n, one, few, many) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 9 && (n100 < 11 || n100 > 19)) return few;
  return many;
}
const transfersText = (n) => (n === 0 ? 'be persėdimų' : `${n} ${plural(n, 'persėdimas', 'persėdimai', 'persėdimų')}`);
const stopsText = (n) => `${n} ${plural(n, 'stotelė', 'stotelės', 'stotelių')}`;
// As an object: važiuok 1 stotelę, 3 stoteles, 10 stotelių.
const stopsAccText = (n) => `${n} ${plural(n, 'stotelę', 'stoteles', 'stotelių')}`;
const placesText = (n) => `${n} ${plural(n, 'vieta', 'vietos', 'vietų')}`;
const roundMetres = (m) => (m >= 1000 ? (m / 1000).toFixed(1).replace('.', ',') : String(Math.max(10, Math.round(m / 10) * 10)));
const metresText = (m) => `${roundMetres(m)} ${m >= 1000 ? 'km' : 'm'}`;

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  bus: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14M8 18v2M16 18v2"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="m10 21 2-6 3 3v3M9 11l2.5-3.5 3 1.5 2 3M11.5 7.5 9.5 14"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  // A toothed wheel, not rays: rays read as brightness.
  gear: '<circle cx="12" cy="12" r="3"/><path d="M10.06 5.07L10.15 5.04L10.30 2.65L13.70 2.65L13.85 5.04L13.94 5.07L15.53 5.73L15.61 5.77L17.41 4.19L19.81 6.59L18.23 8.39L18.27 8.47L18.93 10.06L18.96 10.15L21.35 10.30L21.35 13.70L18.96 13.85L18.93 13.94L18.27 15.53L18.23 15.61L19.81 17.41L17.41 19.81L15.61 18.23L15.53 18.27L13.94 18.93L13.85 18.96L13.70 21.35L10.30 21.35L10.15 18.96L10.06 18.93L8.47 18.27L8.39 18.23L6.59 19.81L4.19 17.41L5.77 15.61L5.73 15.53L5.07 13.94L5.04 13.85L2.65 13.70L2.65 10.30L5.04 10.15L5.07 10.06L5.73 8.47L5.77 8.39L4.19 6.59L6.59 4.19L8.39 5.77L8.47 5.73z"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  location: '<path d="M3 11 21 3l-8 18-2-8-8-2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  house: '<path d="M4 11 12 4l8 7v9H4z"/><path d="M10 20v-5h4v5"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  stop: '<rect x="6" y="3" width="12" height="9" rx="2"/><path d="M12 12v9"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
// Filled, so it reads as a direction rather than a line drawing. Points north.
const ARROW = '<path d="M12 2.5 19.5 20.5 12 16.3 4.5 20.5z"/>';
const dotsHtml = '<span class="listening-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
// A number whose digits roll when it changes (see rollTo).
const roll = (value) => `<span class="roll">${esc(value)}</span>`;

// ------------------------------------------------------------------ motion
//
// The timing lives in style.css (--t-*, --ease-*) so CSS transitions and the
// scripted animations below share one vocabulary. Reduced motion zeroes the
// durations there, which makes every play() here a no-op: changes are instant.

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const ROLES = {
  fade: ['--t-fade', '--ease-out'],
  exit: ['--t-fade', '--ease-in'],
  content: ['--t-content', '--ease-out'],
  roll: ['--t-roll', '--ease-out'],
  push: ['--t-push', '--ease-move'],
  sheet: ['--t-sheet', '--ease-move'],
  rise: ['--t-sheet', '--ease-out'],
};
let motionCache = null;
if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', () => { motionCache = null; });

function motion(role) {
  if (!motionCache) {
    const css = getComputedStyle(document.documentElement);
    motionCache = { stagger: reducedMotion.matches ? 0 : parseFloat(css.getPropertyValue('--stagger')) || 0 };
    for (const [name, [time, ease]] of Object.entries(ROLES)) {
      motionCache[name] = {
        duration: reducedMotion.matches ? 0 : parseFloat(css.getPropertyValue(time)) || 0,
        easing: css.getPropertyValue(ease).trim() || 'ease',
      };
    }
  }
  return motionCache[role];
}

function play(el, keyframes, role, extra = {}) {
  const m = motion(role);
  if (!m.duration || !el || !el.animate) return null;
  return el.animate(keyframes, { duration: m.duration, easing: m.easing, ...extra });
}
const afterPlay = (animation, fn) => { if (animation) animation.finished.then(fn, fn); else fn(); };

// -------------------------------------------------------------------- morph
//
// Every render goes through here: patch the DOM to match new HTML, keeping
// each element that is still there. Kept elements keep focus, scroll position,
// running transitions and the Leaflet map, and only genuinely new ones animate
// in — which is what lets the 250 ms loop run without restarting anything.
// Siblings with data-key are matched by key, the rest by position.

function morph(root, html) {
  const next = document.createElement('div');
  next.innerHTML = html;
  const added = [];
  patchChildren(root, next, added);
  return added;
}

function sameKind(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== 1) return true;
  return a.tagName === b.tagName && !a.dataset.key && !b.dataset.key;
}

function patchChildren(parent, next, added) {
  const keyed = new Map();
  for (const node of parent.childNodes) if (node.nodeType === 1 && node.dataset.key) keyed.set(node.dataset.key, node);
  let cursor = parent.firstChild;
  for (const node of Array.from(next.childNodes)) {
    let match = null;
    if (node.nodeType === 1 && node.dataset.key) {
      const old = keyed.get(node.dataset.key);
      if (old && old.tagName === node.tagName) { match = old; keyed.delete(node.dataset.key); }
    } else if (cursor && sameKind(cursor, node)) {
      match = cursor;
    }
    if (match) {
      if (match === cursor) cursor = cursor.nextSibling;
      else parent.insertBefore(match, cursor);
      patchNode(match, node, added);
    } else {
      parent.insertBefore(node, cursor);
      if (node.nodeType === 1) added.push(node);
    }
  }
  while (cursor) { const following = cursor.nextSibling; parent.removeChild(cursor); cursor = following; }
}

function patchNode(old, node, added) {
  if (old.nodeType !== 1) {
    if (old.nodeValue !== node.nodeValue) old.nodeValue = node.nodeValue;
    return;
  }
  if (old.dataset.morph === 'keep') return; // Leaflet owns this one
  if (old.classList.contains('roll') && node.classList.contains('roll')) { rollTo(old, node.textContent); return; }
  for (const { name } of Array.from(old.attributes)) if (!node.hasAttribute(name)) old.removeAttribute(name);
  for (const { name, value } of Array.from(node.attributes)) if (old.getAttribute(name) !== value) old.setAttribute(name, value);
  if (old.tagName === 'INPUT' || old.tagName === 'TEXTAREA') {
    // Never fight the person typing.
    if (document.activeElement !== old && old.value !== node.value) old.value = node.value;
    return;
  }
  patchChildren(old, node, added);
}

/* New list items drift in one after another, but only when they are new:
   a re-render that keeps them never replays it. */
function staggerIn(nodes) {
  const step = motion('stagger');
  let i = 0;
  nodes.forEach((node) => {
    const parent = node.parentElement;
    const targets = parent && parent.classList.contains('stagger') ? [node]
      : node.classList.contains('stagger') ? Array.from(node.children)
        : node.classList.contains('reveal') ? [node] : Array.from(node.querySelectorAll('.stagger > *'));
    targets.forEach((el) => {
      play(el, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], 'content',
        { delay: Math.min(i++, 6) * step, fill: 'backwards' });
    });
  });
}

/* Digits that change roll, the rest stay put — like the iPhone's numeric
   text transition. Counting down, the new digit drops in from above. */
function rollTo(el, text) {
  const prev = el.dataset.v != null ? el.dataset.v : el.textContent;
  if (prev === text) return;
  el.dataset.v = text;
  const m = motion('roll');
  if (!prev || !m.duration || !el.isConnected) { el.textContent = text; return; }
  const digits = (s) => Number(s.replace(/\D/g, '')) || 0;
  const down = digits(text) < digits(prev);
  const a = [...prev], b = [...text], shift = b.length - a.length;
  el.textContent = '';
  b.forEach((ch, i) => {
    const cell = document.createElement('span');
    cell.className = 'rd';
    const glyph = document.createElement('span');
    glyph.textContent = ch;
    cell.appendChild(glyph);
    el.appendChild(cell);
    const before = a[i - shift];
    if (before === ch) return;
    const offset = down ? '-0.4em' : '0.4em';
    glyph.animate([{ transform: `translateY(${offset})`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: m.duration, easing: m.easing });
    if (before == null) return;
    const ghost = document.createElement('span');
    ghost.className = 'rd-old';
    ghost.textContent = before;
    cell.appendChild(ghost);
    ghost.animate([{ transform: 'none', opacity: 1 }, { transform: `translateY(${down ? '0.4em' : '-0.4em'})`, opacity: 0 }],
      { duration: m.duration * 0.7, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }).onfinish = () => ghost.remove();
  });
}

/* A stage change in the banner: the old content lifts away, the new one
   settles in, and the card's height follows instead of jumping. Page flips
   move sideways, so the direction of the tap is visible. */
function crossfade(card, body, mutate, { dx = 0, animateHeight = true } = {}) {
  const m = motion('content');
  if (!m.duration) { mutate(); return; }
  const from = card.offsetHeight;
  const ghost = body.cloneNode(true);
  ghost.classList.add('act-ghost');
  ghost.removeAttribute('data-key');
  Object.assign(ghost.style, { left: `${body.offsetLeft}px`, top: `${body.offsetTop}px`, width: `${body.offsetWidth}px` });
  card.appendChild(ghost);
  mutate();
  const to = card.offsetHeight;
  const away = dx ? `translateX(${-dx * 16}px)` : 'translateY(-6px)';
  const toward = dx ? `translateX(${dx * 16}px)` : 'translateY(8px)';
  // The old content is mostly gone before the new one is readable, so the
  // two never sit on top of each other as a smudge.
  afterPlay(play(ghost, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: away }], 'exit',
    { duration: m.duration * 0.45, fill: 'forwards' }), () => ghost.remove());
  play(body, [{ opacity: 0, transform: toward }, { opacity: 1, transform: 'none' }], 'content', { delay: m.duration * 0.3, fill: 'backwards' });
  if (animateHeight && Math.abs(from - to) > 1) {
    play(card, [{ height: `${from}px` }, { height: `${to}px` }], 'content');
  }
}

// ------------------------------------------------------------------- clock
//
// The prototype's own clock, so a 30-minute trip can be watched in 30 seconds.

const clock = { base: Date.now(), sim: Date.now(), speed: 1 };
const now = () => new Date(clock.sim + (Date.now() - clock.base) * clock.speed);
function setSpeed(speed) { clock.sim = now().getTime(); clock.base = Date.now(); clock.speed = speed; }
function jumpTo(ms) { clock.sim = ms; clock.base = Date.now(); }

// ------------------------------------------------------------------- state

const HOME = () => ({ name: 'home', id: 'home' });

const state = {
  prefs: store.get('prefs', null),
  places: store.get('places', []),
  visits: store.get('visits', {}),
  dismissed: store.get('dismissed', []),
  originChoice: store.get('originChoice', 'gps'),
  gps: null,
  gpsError: null,
  locating: false,
  stack: [HOME()],
  query: '',
  results: [],
  heard: '',
  timeMode: 'now',
  timeValue: '',
  destination: null,
  plan: null,
  planning: false,
  planError: null,
  selected: null,
  openStops: {},
  trip: null,
  banner: null,
  locked: false,
  islandExpanded: false,
  listening: null,
  interim: '',
  sheet: null,
  toast: null,
  serverReady: false,
};

const save = () => {
  store.set('prefs', state.prefs);
  store.set('places', state.places);
  store.set('visits', state.visits);
  store.set('dismissed', state.dismissed);
  store.set('originChoice', state.originChoice);
};

function origin() {
  if (state.originChoice === 'gps') {
    return state.gps ? { name: 'Tavo vieta', lat: state.gps.lat, lon: state.gps.lon } : null;
  }
  const place = state.places.find((p) => p.id === state.originChoice);
  return place ? { name: place.name, lat: place.lat, lon: place.lon } : null;
}

/* Where search should look first: the rider's own city, not always Vilnius. */
function near() {
  const from = origin();
  return from ? { lat: from.lat.toFixed(4), lon: from.lon.toFixed(4) } : {};
}

// ---------------------------------------------------------------- location

const GPS_ERRORS = {
  1: 'Naršyklė neleidžia šiai svetainei naudoti tavo vietos.',
  2: 'Kompiuteris nepateikė vietos.',
  3: 'Vietos nepavyko gauti per 10 sekundžių.',
};

/* Asks the browser where we are. Called once at start and again from the
   "Nustatyti mano vietą" button, which is a user gesture: some browsers only
   show the permission prompt again after one. */
function locate(userAsked = false) {
  if (!navigator.geolocation) {
    state.gpsError = 'Ši naršyklė nepateikia vietos.';
    fillOrigins(); renderApp();
    return;
  }
  state.locating = true;
  renderApp();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.gps = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };
      state.gpsError = null; state.locating = false;
      if (userAsked) { state.originChoice = 'gps'; save(); toast(`Vieta nustatyta, tikslumas ±${Math.round(pos.coords.accuracy)} m`); }
      fillOrigins(); renderApp();
    },
    (err) => {
      state.gpsError = GPS_ERRORS[err.code] || 'Vietos nustatyti nepavyko.';
      state.locating = false;
      fillOrigins(); renderApp();
    },
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
  );
}

// --------------------------------------------------------------------- api

async function api(path, params) {
  const url = path + (params ? '?' + new URLSearchParams(params) : '');
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Serverio klaida ${response.status}`);
  return data;
}

function atFor(mode, time) {
  const t = now();
  if (mode === 'now' || !time) return t;
  const [H, M] = time.split(':').map(Number);
  const at = new Date(t);
  at.setHours(H, M, 0, 0);
  // "By 08:00" said at 22:00 means tomorrow morning.
  if (at.getTime() < t.getTime() - 5 * 60_000) at.setDate(at.getDate() + 1);
  return at;
}

async function planTrip(place, mode, time) {
  const from = origin();
  if (!from) {
    const error = new Error('Nežinau, iš kur keliauji. Leisk naršyklei nustatyti vietą arba pasirink ją.');
    error.code = 'no-origin';
    throw error;
  }
  const prefs = state.prefs || { priority: 'fastest', walk: 'normal' };
  const plan = await api('/api/plan', {
    from: `${from.lat},${from.lon}`, from_name: from.name,
    to: `${place.lat},${place.lon}`, to_name: place.name,
    at: localIso(atFor(mode, time)),
    // The prototype's clock, not the computer's: "be there by 9" must not
    // offer a trip that left before the simulated now.
    now: localIso(now()),
    mode: mode === 'arrive' ? 'arrive' : 'depart',
    priority: prefs.priority, walk: prefs.walk,
  });
  plan.options = (plan.options || []).map(mergeWalks).map(wholeMinutes);
  return plan;
}

/* The router can hand back two walks in a row: to a stop, then on to the
   destination without boarding anything there. To the rider that is one
   walk, and its distance may only ever go down. (The server now merges them
   itself; this stays as a safety net for older plans.) */
function mergeWalks(option) {
  if (!option || !option.legs) return option;
  const legs = [];
  for (const leg of option.legs) {
    const prev = legs[legs.length - 1];
    if (prev && prev.kind === 'walk' && leg.kind === 'walk') {
      legs[legs.length - 1] = { ...prev, to: leg.to, arrival: leg.arrival, metres: prev.metres + leg.metres };
    } else {
      legs.push(leg);
    }
  }
  return legs.length === option.legs.length ? option : { ...option, legs };
}

/* Every time the rider sees is a whole minute, and the parts add up to the
   total: starts round down (leave a little early), ends round up (arrive a
   little late), and each leg lasts exactly the difference. "09:03 + 7 min"
   then arrives at 09:10, never 09:09. Bus times are whole minutes already. */
const MINUTE = 60_000;
const atMinute = (ms) => { const d = new Date(ms); return { iso: localIso(d), hm: hm(d) }; };
function wholeMinutes(option) {
  if (!option || !option.legs) return option;
  const floor = (x) => atMinute(Math.floor(new Date(x.iso).getTime() / MINUTE) * MINUTE);
  const ceil = (x) => atMinute(Math.ceil(new Date(x.iso).getTime() / MINUTE) * MINUTE);
  const legs = option.legs.map((leg) => {
    const departure = floor(leg.departure), arrival = ceil(leg.arrival);
    const minutes = Math.max(1, Math.round((new Date(arrival.iso) - new Date(departure.iso)) / MINUTE));
    return { ...leg, departure, arrival, minutes };
  });
  const leave = floor(option.leave), arrive = ceil(option.arrive);
  return { ...option, legs, leave, arrive, duration_min: Math.round((new Date(arrive.iso) - new Date(leave.iso)) / MINUTE) };
}

/* Earliest arrival first: what "you will not make it" should offer. */
const earliest = (options) => options.slice().sort((a, b) => new Date(a.arrive.iso) - new Date(b.arrive.iso))[0] || null;

// -------------------------------------------------------------- navigation

const currentScreen = () => state.stack[state.stack.length - 1];
function push(screen) { state.stack.push({ id: uid(), ...screen }); renderApp(); }
function pop() { if (state.stack.length > 1) state.stack.pop(); renderApp(); }
function goHome() { state.stack = [HOME()]; renderApp(); }

function toast(text) {
  state.toast = text;
  renderOverlay();
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { state.toast = null; renderOverlay(); }, 2600);
}

// ------------------------------------------------------------ small pieces

function badge(route, small = false) {
  return `<span class="badge${small ? ' small' : ''}" style="background:#${esc(route.color)};color:#${esc(route.text_color)}">${esc(route.name)}</span>`;
}

function routeLine(option, small = false) {
  if (option.walk_only) return `<span class="walk-glyph">${icon('walk')}</span><span>Pėsčiomis</span>`;
  const parts = [];
  option.legs.forEach((leg) => {
    if (leg.kind === 'ride') parts.push(badge(leg.route, small));
    else if (leg.metres >= 120) parts.push(`<span class="walk-glyph" title="${metresText(leg.metres)} pėsčiomis">${icon('walk')}</span>`);
  });
  return parts.join('<span class="sep">›</span>');
}

/* "Prekybos centras, Ozo g. 25, Vilnius" → "Ozo g. 25": on a tile, the
   street is what tells two places apart. */
function shortAddress(subtitle) {
  const parts = String(subtitle || '').split(',').map((x) => x.trim()).filter(Boolean);
  return parts.find((x) => /\d|(^|\s)(g|pr|al|pl|a)\.(\s|$)/.test(x)) || parts[0] || '';
}

/* Some sources write names in capitals ("AKROPOLIS", "PC AKROPOLIS"); show
   them as names. Short words stay as they are: "PC", "UAB", "VGTU" are
   abbreviations. */
const nameCase = (name) => String(name || '').replace(name === String(name).toUpperCase() ? /\p{Lu}{4,}/gu : /\p{Lu}{5,}/gu,
  (w) => w[0] + w.slice(1).toLowerCase());

/* What search returns, as a rider would want it: no parcel lockers (nobody
   travels to a paštomatas), and one row per address, so the shops inside a
   mall fold under the mall. The row kept is the one whose name is closest to
   what was asked; saved places come first and win their address. */
const LOCKER = /pa[sš]tomat|omniva|venipak|lp express|dpd pickup|smartpost|siunt\S* terminal/i;
function cleanResults(results, query = '', saved = []) {
  const q = fold(query);
  const score = (r) => { const n = fold(r.name); return n === q ? 3 : n.startsWith(q) ? 2 : n.includes(q) ? 1 : 0; };
  const address = (r) => {
    const street = shortAddress(r.subtitle);
    return /\d/.test(street) ? `${fold(street)}|${fold(r.city || String(r.subtitle || '').split(',').pop())}` : null;
  };
  const taken = new Set(saved.map(address).filter(Boolean));
  const best = new Map();
  const kept = [];
  for (const r of results) {
    if (!r || LOCKER.test(`${r.name} ${r.subtitle || ''}`)) continue;
    const key = address(r);
    if (key && taken.has(key)) continue;
    if (key && best.has(key)) {
      const slot = best.get(key);
      if (score(r) > score(kept[slot])) kept[slot] = r;
      continue;
    }
    if (key) best.set(key, kept.length);
    kept.push(r);
  }
  return kept.map((r) => ({ ...r, name: nameCase(r.name) }));
}

function placeIcon(place) {
  const name = fold(place.name);
  if (name === 'namai') return icon('house');
  if (place.kind === 'stop') return icon('stop');
  if (place.saved) return icon('star');
  return icon('pin');
}

/* "Prekybos centras, Ozo g. 25, Vilnius" — plus the city when the search
   says which one and the subtitle does not already. */
function placeSubtitle(item) {
  if (item.saved) return item.subtitle || 'Tavo vieta';
  const sub = item.subtitle || '';
  if (item.city && !fold(sub).includes(fold(item.city))) return [sub, item.city].filter(Boolean).join(', ');
  return sub;
}

function sameName(a, b) {
  const fa = fold(a), fb = fold(b);
  return fa === fb || (fa.length >= 5 && fb.length >= 5 && fa.slice(0, -2) === fb.slice(0, -2));
}

const placeKey = (p) => `${fold(p.name)}@${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;

// ================================================================ app screens
//
// Each screen is its own .page. Re-rendering the same screen morphs it in
// place; a different screen slides over (push) or away (pop) like UIKit.

let pageEl = null;
let pageScreen = null;
let pageDepth = 0;

function renderApp() {
  const screen = state.prefs ? currentScreen() : onboardingScreen();
  const view = {
    onboarding: onboardingView, home: homeView, results: resultsView, detail: detailView,
    settings: settingsView, places: placesView, pick: pickView,
  }[screen.name] || homeView;
  const html = view(screen);

  if (pageEl && pageScreen && pageScreen.id === screen.id && pageEl.isConnected) {
    staggerIn(morph(pageEl, html));
  } else {
    const depth = screen.depth || state.stack.length;
    let kind = 'fade';
    if (!pageEl) kind = 'none';
    else if ((screen.name === 'onboarding') === (pageScreen.name === 'onboarding')) {
      if (depth > pageDepth) kind = 'push';
      else if (depth < pageDepth) kind = 'pop';
    }
    const content = pageEl && pageEl.querySelector('.content');
    if (content && pageScreen) pageScreen.scroll = content.scrollTop;
    const page = document.createElement('div');
    page.className = 'page';
    page.innerHTML = html;
    transitionPages(pageEl, page, kind);
    const scroller = page.querySelector('.content');
    if (scroller && screen.scroll) scroller.scrollTop = screen.scroll;
    pageEl = page; pageScreen = screen; pageDepth = depth;
  }
  if (screen.name === 'detail') drawMap();
  $('#statusbar').classList.toggle('on-lock', state.locked);
}

// Queries scoped to the screen on top: during a slide two pages exist.
const inPage = (sel) => (pageEl ? pageEl.querySelector(sel) : null);

function transitionPages(from, to, kind) {
  const app = $('#app');
  // A navigation during a slide finishes the old slide at once.
  app.querySelectorAll('.page.leaving').forEach((p) => p.remove());
  if (kind === 'pop' && from) app.insertBefore(to, from); else app.appendChild(to);
  if (!from) return;
  from.classList.add('leaving');
  from.inert = true;
  const done = () => from.remove();
  const behind = [{ transform: 'none', filter: 'brightness(1)' }, { transform: 'translateX(-30%)', filter: 'brightness(0.92)' }];
  if (kind === 'push') {
    play(to, [{ transform: 'translateX(100%)' }, { transform: 'none' }], 'push');
    afterPlay(play(from, behind, 'push', { fill: 'forwards' }), done);
  } else if (kind === 'pop') {
    play(to, [...behind].reverse(), 'push');
    afterPlay(play(from, [{ transform: 'none' }, { transform: 'translateX(100%)' }], 'push', { fill: 'forwards' }), done);
  } else {
    play(to, [{ opacity: 0 }, { opacity: 1 }], 'content');
    afterPlay(play(from, [{ opacity: 1 }, { opacity: 0 }], 'exit', { fill: 'forwards' }), done);
  }
}

// iOS shows the title in the bar once the large one has scrolled away.
document.addEventListener('scroll', (event) => {
  const el = event.target;
  if (!(el instanceof Element) || !el.classList.contains('content')) return;
  const page = el.closest('.page');
  if (page) page.classList.toggle('scrolled', el.scrollTop > 40);
}, true);

function navBar({ back = false, title = '', right = '', always = false } = {}) {
  return `<div class="bar">
    ${back ? `<button class="back" data-action="back">${icon('back')}<span>Atgal</span></button>` : '<span></span>'}
    <span class="title-inline${always ? ' always' : ''}">${esc(title)}</span>
    ${right || '<span></span>'}
  </div>`;
}

function timeControls() {
  const modes = [['now', 'Dabar'], ['arrive', 'Atvykti iki'], ['depart', 'Išvykti']];
  const sel = Math.max(0, modes.findIndex(([m]) => m === state.timeMode));
  return `<div class="segmented" role="group" aria-label="Kada" style="--sel:${sel};--count:${modes.length}">
      <span class="seg-pill" aria-hidden="true"></span>
      ${modes.map(([m, label]) => `<button data-action="time-mode" data-mode="${m}" aria-pressed="${state.timeMode === m}">${label}</button>`).join('')}
    </div>
    ${state.timeMode !== 'now' ? `<div class="time-row reveal">
      <input class="time-input" id="time-value" type="text" inputmode="numeric" autocomplete="off" maxlength="5" placeholder="14:20"
        value="${esc(state.timeValue || hm(new Date(now().getTime() + 30 * 60_000)))}" aria-label="Laikas, pvz., 14:20">
      <span class="footnote">${state.timeMode === 'arrive' ? 'turi būti vietoje' : 'nori išeiti'}</span>
    </div>` : ''}`;
}

// ---- onboarding: the preferences from the vision, asked once

function onboardingScreen() {
  const draft = state.draft || (state.draft = { priority: 'fastest', walk: 'normal', step: 0 });
  return { name: 'onboarding', id: `onboarding-${draft.step}`, depth: draft.step + 1 };
}

function onboardingView() {
  const draft = state.draft;
  const choice = (key, value, title, sub) =>
    `<button class="choice" data-action="draft" data-pref="${key}" data-value="${value}" aria-pressed="${draft[key] === value}">
       <span><div class="title">${title}</div><div class="sub">${sub}</div></span><span class="tick">${icon('check')}</span></button>`;
  const steps = [
    `<h1 class="large">Kaip mėgsti keliauti?</h1>
     <p class="lede">Visada ieškosiu greičiausio kelio, bet kartais jis reiškia persėdimus ar ilgesnį ėjimą. Pasakyk, kas tau svarbiau.</p>
     ${choice('priority', 'fastest', 'Kuo greičiau', 'Nesvarbu, kiek persėdimų')}
     ${choice('priority', 'single', 'Vienu autobusu, jei įmanoma', 'Mieliau važiuosiu kiek ilgiau be persėdimų')}
     ${choice('priority', 'fewest', 'Kuo mažiau persėdimų', 'Persėsti tik tada, kai kitaip neišeina')}`,
    `<h1 class="large">Kiek gali paeiti?</h1>
     <p class="lede">Iki stotelės ir nuo jos. Daugiau ėjimo kartais reiškia greitesnį kelią.</p>
     ${choice('walk', 'short', 'Kuo mažiau', 'Iki 400 m')}
     ${choice('walk', 'normal', 'Įprastai', 'Iki 800 m')}
     ${choice('walk', 'long', 'Galiu ir toliau', 'Iki 1,5 km')}`,
  ];
  return `<div class="nav">${navBar({ back: draft.step > 0 })}</div>
    <div class="content">
      <div class="steps" aria-hidden="true">${steps.map((_, i) => `<i class="${i <= draft.step ? 'done' : ''}"></i>`).join('')}</div>
      ${steps[draft.step]}
      <div style="margin-top:28px">
        <button class="prominent" data-action="draft-next">${draft.step < steps.length - 1 ? 'Toliau' : 'Pradėti'}</button>
      </div>
      <p class="footnote inset">Pakeisti galėsi bet kada nustatymuose.</p>
    </div>`;
}

// ---- home: say it, or type it, or tap a place

function homeView() {
  const listening = state.listening === 'app';
  return `<div class="nav">
      ${navBar({ title: 'Kur keliausime?', right: `<button class="icon-button" data-action="settings" aria-label="Nustatymai">${icon('gear')}</button>` })}
    </div>
    <div class="content${state.searchActive ? ' searching' : ''}">
      <div class="collapsible"><div>
        <h1 class="large one-line">Kur keliausime šiandien?</h1>
        <button class="voice${listening ? ' listening' : ''}" data-action="app-mic" aria-pressed="${listening}">
          <span class="voice-disc">${icon('mic')}</span>
          <span class="voice-text">
            <span class="voice-title">${listening ? `Klausau${dotsHtml}` : 'Pasakyk, kur keliauji'}</span>
            <span class="voice-sub">${listening
              ? (state.interim ? `„${esc(state.interim)}“` : 'Paliesk dar kartą, kad sustabdytum')
              : 'Pvz.: „Į Akropolį keturiolika dvidešimt“'}</span>
          </span>
        </button>
      </div></div>
      <div class="search-row">
        <label class="search">
          ${icon('search')}
          <input id="search" type="search" placeholder="${state.searchActive ? 'Adresas, vieta ar stotelė' : 'Arba įvesk adresą ar stotelę'}" value="${esc(state.query)}" autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off" aria-label="Kur keliausi">
        </label>
        <button class="search-cancel" data-action="search-cancel" tabindex="${state.searchActive ? 0 : -1}" aria-hidden="${!state.searchActive}">Atšaukti</button>
      </div>
      ${originChip()}
      <div id="home-content">${homeContent(saveSuggestions())}</div>
    </div>`;
}

function originChip() {
  const from = origin();
  let label = from ? from.name : 'pasirink vietą';
  if (!from && state.originChoice === 'gps' && !state.gpsError) label = 'ieškau vietos…';
  return `<div class="from-row"><button class="chip" data-action="pick-origin">${icon('location')}<span>Iš: ${esc(label)}</span>${icon('chevron')}</button></div>`;
}

/* When the browser cannot say where we are, say why and what to do, in the
   app itself — not only in the test panel. */
function locationNotice() {
  if (state.originChoice !== 'gps' || state.gps || !state.gpsError) return '';
  return `<div class="notice reveal" data-key="location-notice" role="status">
      <div class="notice-title"><span class="problem">${icon('location')}</span>Nežinau, kur tu esi</div>
      <p>${esc(state.gpsError)} Patikrink du dalykus:</p>
      <ol>
        <li><b>Naršyklė.</b> Paspausk ženkliuką adreso juostos kairėje ir leisk šiai svetainei naudoti vietą.</li>
        <li><b>Windows.</b> Settings › Privacy &amp; security › Location: įjunk vietos paslaugas ir leisk jomis naudotis darbalaukio programoms.</li>
      </ol>
      <div class="notice-actions">
        <button class="secondary" data-action="locate">${state.locating ? 'Ieškau…' : 'Nustatyti mano vietą'}</button>
        <button class="secondary" data-action="pick-origin">Pasirinkti vietą</button>
      </div>
    </div>`;
}

function homeContent(suggestions) {
  if (state.query.trim().length >= 2) return searchResultsHtml('go');
  const tiles = state.places.map((p) => `
      <button class="tile" data-action="go-place" data-id="${p.id}" data-key="${p.id}">
        <span class="glyph">${placeIcon({ ...p, saved: true })}</span>
        <span><span class="title">${esc(p.name)}</span><span class="sub">${esc(shortAddress(p.subtitle) || ' ')}</span></span>
      </button>`).join('');
  return `
    ${locationNotice()}
    ${suggestions.map((s) => `<div class="notice reveal" data-key="suggest-${esc(s.key)}">
        <div class="notice-title">${esc(s.name)}</div>
        <p>Dažnai čia važiuoji. Išsaugoti ir pavadinti savaip?</p>
        <div class="notice-actions">
          <button class="secondary" data-action="save-suggestion" data-key-ref="${esc(s.key)}">Išsaugoti</button>
          <button class="secondary" data-action="dismiss-suggestion" data-key-ref="${esc(s.key)}">Ne</button>
        </div></div>`).join('')}
    <div class="heading"><h2>Tavo vietos</h2>${state.places.length ? '<button data-action="places">Keisti</button>' : ''}</div>
    <div class="places stagger">
      ${tiles}
      <button class="tile add" data-action="add-place" data-key="add"><span class="glyph">${icon('plus')}</span>
        <span><span class="title">Pridėti vietą</span><span class="sub">Kiek tik nori</span></span></button>
    </div>
    ${state.places.length ? '' : '<p class="footnote">Namai, mokykla, darbas, močiutė: paliesk vietą, ir maršrutas jau skaičiuojamas.</p>'}`;
}

function searchResultsHtml(action) {
  const items = currentItems();
  const q = state.query.trim();
  const heard = state.heard ? `<p class="heard-line">Išgirdau: „<b>${esc(state.heard)}</b>“. Kurią vietą turėjai omeny?</p>` : '';
  if (!items.length) {
    return `${heard}<p class="footnote">${state.searching ? 'Ieškau…' : `Nieko neradau pagal „${esc(q)}“.`}</p>`;
  }
  return `${heard}<div class="group stagger" style="margin-top:14px">${items.map((item, i) => `
    <button class="row" data-action="${action}" data-index="${i}" data-key="${esc(item.saved ? `saved-${item.id}` : placeKey(item))}">
      <span class="lead">${placeIcon(item)}</span>
      <span class="main"><div class="title">${esc(item.name)}</div><div class="sub">${esc(placeSubtitle(item))}</div></span>
    </button>`).join('')}</div>`;
}

let searchTimer;
function onSearchInput(value) {
  state.query = value;
  state.heard = '';
  clearTimeout(searchTimer);
  const container = inPage('#home-content') || inPage('#pick-content');
  const isPick = currentScreen().name === 'pick';
  if (value.trim().length < 2) {
    state.results = [];
    if (container) staggerIn(morph(container, isPick ? pickContent() : homeContent(saveSuggestions())));
    return;
  }
  state.searching = true;
  if (container) staggerIn(morph(container, searchResultsHtml(isPick ? 'picked' : 'go')));
  searchTimer = setTimeout(async () => {
    try {
      const data = await api('/api/search', { q: value, ...near() });
      if (state.query !== value) return;
      state.results = data.results || [];
    } catch (e) {
      state.results = [];
      toast(e.message);
    }
    state.searching = false;
    const box = inPage('#home-content') || inPage('#pick-content');
    if (box) staggerIn(morph(box, searchResultsHtml(currentScreen().name === 'pick' ? 'picked' : 'go')));
  }, 250);
}

function currentItems() {
  const q = state.query.trim();
  const saved = state.places.filter((p) => fold(p.name).includes(fold(q)) || sameName(p.name, q)).map((p) => ({ ...p, saved: true }));
  return [...saved, ...cleanResults(state.results.filter((r) => !saved.some((s) => sameName(s.name, r.name))), q, saved)];
}

// ---- results

/* "po 5 min", "po 1 val. 20 min", "rytoj": how soon, with its unit. */
function inText(ms) {
  const minutes = Math.ceil((ms - now().getTime()) / 60_000);
  if (minutes <= 0) return 'dabar';
  const day = dayWord(ms);
  if (day) return day.trim();
  if (minutes < 60) return `po ${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `po ${h} val.${m ? ` ${m} min` : ''}`;
}

/* An arrive-by plan can start before now (the only bus that makes it has
   gone). Say so instead of "Išeik dabar". */
const isLate = (o) => new Date(o.leave.iso).getTime() < now().getTime() - 60_000;
const leaveCaption = (o) => (isLate(o)
  ? '<div class="cap late">Reikėjo išeiti</div>'
  : `<div class="cap">Išeik ${esc(inText(new Date(o.leave.iso).getTime()))}</div>`);

/* A row like Apple Maps' transit rows: the time span and how long, the
   vehicles, one line of detail. Where to board is on the route screen. The
   first row is the recommended one, and only it says why. */
/* A chip says what sets this option apart. One whose fact is already in the
   line above it ("be persėdimų"), or that another option shares, tells the
   options apart on nothing. */
function distinctTags(o, all) {
  const others = all.filter((x) => x !== o);
  return (o.tags || []).filter((tag) => fold(tag) !== fold(transfersText(0)) && !others.some((x) => (x.tags || []).includes(tag)));
}

function optionCard(o, i, all) {
  const when = isLate(o) ? '<span class="late">Reikėjo išeiti</span>' : `Išeik ${esc(inText(new Date(o.leave.iso).getTime()))}`;
  const meta = [when, `${metresText(o.walk_m)} pėsčiomis`, o.walk_only ? '' : transfersText(o.transfers)].filter(Boolean).join(' · ');
  const tags = i === 0 ? distinctTags(o, all) : [];
  return `<button class="option${isLate(o) ? ' late' : ''}" data-action="open-option" data-index="${i}" data-key="${esc(o.id)}">
      <div class="top">
        <div class="span">${esc(o.leave.hm)}–<span class="${o.late ? 'late' : ''}">${esc(o.arrive.hm)}</span></div>
        <div class="dur">${o.duration_min} min</div>
      </div>
      <div class="route-line">${routeLine(o)}</div>
      <div class="meta">${meta}</div>
      ${tags.length ? `<div class="tags">${tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}</div>` : ''}
    </button>`;
}

function resultsView() {
  const place = state.destination;
  let body;
  if (state.planning) body = `<p class="footnote loading">Ieškau maršrutų${dotsHtml}</p>`;
  else if (state.planError) body = `<p class="footnote error-text">${esc(state.planError)}</p>`;
  else if (state.plan && !state.plan.options.length) body = '<p class="footnote">Maršruto šiuo laiku nerasta. Pabandyk kitą laiką.</p>';
  else if (state.plan) {
    body = `${lateNotice(state.plan)}<div class="options stagger">${state.plan.options.map(optionCard).join('')}</div>`;
  } else body = '';
  const from = origin();
  return `<div class="nav">${navBar({ back: true, title: place ? place.name : '' })}</div>
    <div class="content">
      <h1 class="large title2">${esc(place ? place.name : '')}</h1>
      <div class="from-line">Iš: ${esc(from ? from.name : '—')}</div>
      ${timeControls()}
      ${body}
    </div>`;
}

/* "Be there by 9" that cannot be kept. The options below are then the
   fastest from now, so say by how much they miss, not "leave now". */
function lateNotice(plan) {
  if (state.timeMode !== 'arrive') return '';
  const by = esc(state.timeValue);
  if (plan.late) {
    const first = earliest(plan.options.filter((o) => !isLate(o)));
    return `<div class="late-note reveal" data-key="late" role="status">
        <div class="late-title">Nespėsi iki ${by}</div>
        ${first ? `<p>Anksčiausiai atvyksi ${esc(first.arrive.hm)}${plan.late_by_min ? `, ${plan.late_by_min} min vėliau` : ''}.</p>` : ''}
      </div>`;
  }
  // A server that does not know "now" yet sends trips that have left.
  if (plan.options.length && plan.options.every(isLate)) {
    return `<div class="late-note reveal" data-key="late" role="status">
        <div class="late-title">Nespėsi iki ${by}</div>
        <p>Visi šie keliai turėjo prasidėti anksčiau. Pasirink „Dabar“ — parodysiu greičiausią.</p>
      </div>`;
  }
  return '';
}

async function runPlan() {
  if (!state.destination) return;
  state.planning = true; state.planError = null; state.plan = null;
  renderApp();
  try {
    state.plan = await planTrip(state.destination, state.timeMode, state.timeValue);
  } catch (e) {
    state.planError = e.message;
  }
  state.planning = false;
  if (currentScreen().name === 'results') renderApp();
}

function openDestination(place) {
  state.destination = place;
  state.searchActive = false;
  state.query = ''; state.results = []; state.heard = '';
  if (currentScreen().name !== 'results') state.stack.push({ name: 'results', id: uid() });
  runPlan();
}

// ---- detail

function detailView() {
  const o = state.selected;
  if (!o) return homeView();
  const steps = o.legs.map((leg, i) => {
    let what, seg;
    if (leg.kind === 'ride') {
      const between = leg.stops.slice(1, -1).map((s) => esc(s.name)).join(' · ');
      const open = !!state.openStops[i];
      // Names stay in the nominative after a colon; "išlipk „X“" would not.
      what = `<div class="route-line">${badge(leg.route)} <span class="headsign">${esc(leg.headsign || '')}</span></div>
        <div class="sub">Įlipk: ${esc(leg.from.name)}</div>
        <div class="sub">Išlipk: ${esc(leg.to.name)} · ${esc(leg.arrival.hm)}</div>
        ${between ? `<button class="stops-toggle" data-action="toggle-stops" data-index="${i}" aria-expanded="${open}">${stopsText(leg.stop_count)}${icon('chevron')}</button>
          ${open ? `<div class="stops reveal">${between}</div>` : ''}` : `<div class="sub">${stopsText(leg.stop_count)}</div>`}`;
      seg = `<b class="seg" style="background:#${esc(leg.route.color)}"></b>`;
    } else {
      const target = leg.to.stop == null ? 'iki tikslo' : (leg.from.name === leg.to.name ? 'į kitą tos pačios stotelės peroną' : `į stotelę „${esc(leg.to.name)}“`);
      what = `<div>Eik ${target}</div><div class="sub">${metresText(leg.metres)} · ${leg.minutes} min</div>`;
      seg = '<b class="seg walk"></b>';
    }
    return `<div class="step">
      <div class="t">${esc(leg.departure.hm)}</div>
      <div class="rail"><i class="node"></i>${seg}</div>
      <div class="what">${what}</div>
    </div>`;
  }).join('') + `<div class="step"><div class="t">${esc(o.arrive.hm)}</div><div class="rail"><i class="node end"></i></div>
      <div class="what"><b class="arrive-name">${esc(state.destination ? state.destination.name : '')}</b></div></div>`;

  const running = state.trip && state.trip.option.id === o.id && state.trip.option.leave.iso === o.leave.iso;
  return `<div class="nav">${navBar({ back: true, title: 'Maršrutas', always: true })}</div>
    <div class="content">
      <div id="map" class="map" data-morph="keep"></div>
      <div class="summary">
        <div>${leaveCaption(o)}<div class="leave${isLate(o) ? ' late' : ''}">${esc(o.leave.hm)}</div></div>
        <div class="right"><div class="dur">${o.duration_min} min</div><div class="cap${o.late ? ' late' : ''}">atvyksi ${esc(o.arrive.hm)}</div></div>
      </div>
      <div class="summary-meta">${metresText(o.walk_m)} pėsčiomis · ${transfersText(o.transfers)}</div>
      <div class="timeline">${steps}</div>
      <div class="sticky-bottom">${running
        ? '<div class="trip-running"><button class="secondary" data-action="end-trip" style="height:52px;flex:1">Baigti kelionę</button><button class="prominent" data-action="lock">Rodyti banerį</button></div>'
        : '<button class="prominent" data-action="start-trip">Pradėti kelionę</button>'}</div>
    </div>`;
}

let map, mapFor;
function drawMap() {
  const o = state.selected;
  const el = inPage('#map');
  if (!o || !el || !window.L) return;
  if (map && map.getContainer() === el && mapFor === o) return;
  if (map) { map.remove(); map = null; }
  map = L.map(el, { zoomControl: false, attributionControl: true });
  // Plain text: the only colour on the map is the route's own.
  map.attributionControl.setPrefix('Leaflet');
  mapFor = o;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(map);
  const bounds = [];
  o.legs.forEach((leg) => {
    const points = leg.kind === 'ride' ? leg.stops.map((s) => [s.lat, s.lon]) : [[leg.from.lat, leg.from.lon], [leg.to.lat, leg.to.lon]];
    bounds.push(...points);
    L.polyline(points, leg.kind === 'ride'
      ? { color: '#' + leg.route.color, weight: 6, opacity: 0.95 }
      : { color: '#8E8E93', weight: 4, dashArray: '2 8', lineCap: 'round' }).addTo(map);
  });
  const first = o.legs[0].from, last = o.legs[o.legs.length - 1].to;
  L.circleMarker([first.lat, first.lon], { radius: 7, color: '#000', weight: 3, fillColor: '#fff', fillOpacity: 1 }).addTo(map);
  L.circleMarker([last.lat, last.lon], { radius: 7, color: '#fff', weight: 3, fillColor: '#000', fillOpacity: 1 }).addTo(map);
  map.fitBounds(bounds, { padding: [24, 24] });
}

// ---- settings, places, pick

function settingsView() {
  const p = state.prefs;
  const choice = (key, value, title) =>
    `<button class="row plain" data-action="pref" data-pref="${key}" data-value="${value}" aria-pressed="${p[key] === value}">
       <span class="main"><div class="title">${title}</div></span><span class="trail check">${p[key] === value ? icon('check') : ''}</span></button>`;
  return `<div class="nav">${navBar({ back: true, title: 'Nustatymai' })}</div>
    <div class="content">
      <h1 class="large">Nustatymai</h1>
      <div class="section-title"><span>Kaip keliauti</span></div>
      <div class="group">${choice('priority', 'fastest', 'Kuo greičiau')}${choice('priority', 'single', 'Vienu autobusu, jei įmanoma')}${choice('priority', 'fewest', 'Kuo mažiau persėdimų')}</div>
      <div class="section-title"><span>Ėjimas iki stotelės</span></div>
      <div class="group">${choice('walk', 'short', 'Kuo mažiau · iki 400 m')}${choice('walk', 'normal', 'Įprastai · iki 800 m')}${choice('walk', 'long', 'Galiu ir toliau · iki 1,5 km')}</div>
      <div class="section-title"><span>Vietos</span></div>
      <div class="group">
        <button class="row" data-action="places"><span class="lead">${icon('star')}</span><span class="main"><div class="title">Tavo vietos</div></span><span class="trail">${placesText(state.places.length)}${icon('chevron')}</span></button>
        <button class="row" data-action="pick-origin"><span class="lead">${icon('location')}</span><span class="main"><div class="title">Iš kur keliauji</div></span><span class="trail">${esc(origin() ? origin().name : 'nežinoma')}${icon('chevron')}</span></button>
      </div>
      <div class="section-title"><span>Duomenys</span></div>
      <div class="group"><div class="row plain"><span class="main"><div class="title">Vilniaus tvarkaraščiai</div><div class="sub" id="data-info">${esc(state.dataInfo || '')}</div></span></div></div>
      <div style="margin-top:24px"><button class="secondary" style="width:100%" data-action="reset">Pradėti iš naujo</button></div>
    </div>`;
}

function placesView() {
  const rows = state.places.map((p) => `
    <div class="row" data-key="${p.id}">
      <span class="lead">${placeIcon({ ...p, saved: true })}</span>
      <span class="main"><input id="name-${p.id}" data-action="rename" data-id="${p.id}" value="${esc(p.name)}" aria-label="Pavadinimas"
        style="border:0;background:none;font-size:17px;width:100%;outline:0;padding:0"><div class="sub">${esc(p.subtitle || '')}</div></span>
      <button data-action="delete-place" data-id="${p.id}" aria-label="Ištrinti ${esc(p.name)}" style="color:var(--red);font-size:19px;padding:6px">${icon('trash')}</button>
    </div>`).join('');
  return `<div class="nav">${navBar({ back: true, title: 'Tavo vietos' })}</div>
    <div class="content">
      <h1 class="large">Tavo vietos</h1>
      <div class="group">${rows || '<div class="row plain"><span class="main"><div class="sub">Dar nėra vietų.</div></span></div>'}
        <button class="row" data-action="add-place" data-key="add"><span class="lead">${icon('plus')}</span><span class="main"><div class="title">Pridėti vietą</div></span></button></div>
      <p class="footnote">Paspausk pavadinimą, kad pakeistum. Pavadinimai gali būti bet kokie: „Mokykla“, „Močiutė“, „Sporto klubas“.</p>
    </div>`;
}

function pickView(screen) {
  const title = screen.purpose === 'origin' ? 'Iš kur keliauji?' : 'Nauja vieta';
  return `<div class="nav">${navBar({ back: true, title })}</div>
    <div class="content">
      <h1 class="large title2">${title}</h1>
      <label class="search">${icon('search')}
        <input id="search" type="search" placeholder="Adresas, vieta ar stotelė" value="${esc(state.query)}" autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off" aria-label="Paieška"></label>
      <div id="pick-content">${state.query.trim().length >= 2 ? searchResultsHtml('picked') : pickContent()}</div>
    </div>`;
}

function pickContent() {
  if (currentScreen().purpose !== 'origin') return '<p class="footnote">Surask vietą ir duok jai vardą.</p>';
  let gpsSub = 'Paliesk, kad naršyklė nustatytų';
  if (state.locating) gpsSub = 'Ieškau…';
  else if (state.gps) gpsSub = `Pagal naršyklę, tikslumas ±${Math.round(state.gps.accuracy)} m`;
  else if (state.gpsError) gpsSub = state.gpsError;
  return `${locationNotice()}
    <div class="group stagger" style="margin-top:14px">
      <button class="row" data-action="${state.gps ? 'origin-gps' : 'locate'}" data-key="gps"><span class="lead">${icon('location')}</span>
        <span class="main"><div class="title">${state.gps ? 'Tavo vieta' : 'Nustatyti mano vietą'}</div><div class="sub">${esc(gpsSub)}</div></span>
        <span class="trail check">${state.originChoice === 'gps' && state.gps ? icon('check') : ''}</span></button>
      ${state.places.map((p) => `<button class="row" data-action="origin-place" data-id="${p.id}" data-key="${p.id}"><span class="lead">${placeIcon({ ...p, saved: true })}</span>
        <span class="main"><div class="title">${esc(p.name)}</div><div class="sub">${esc(p.subtitle || '')}</div></span>
        <span class="trail check">${state.originChoice === p.id ? icon('check') : ''}</span></button>`).join('')}
    </div>
    <p class="footnote">Kompiuteryje naršyklės vieta gali būti netiksli. Tada geriau pasirinkti vietą iš sąrašo arba surasti ją paieškoje.</p>`;
}

// ---- save suggestions: "you go there often, save it?"

function saveSuggestions() {
  return Object.entries(state.visits)
    .filter(([key, v]) => v.count >= 2 && !state.dismissed.includes(key)
      && !state.places.some((p) => Math.abs(p.lat - v.lat) < 0.0015 && Math.abs(p.lon - v.lon) < 0.0015))
    .map(([key, v]) => ({ key, ...v }))
    .slice(0, 1);
}

function recordVisit(place) {
  const key = placeKey(place);
  const v = state.visits[key] || { count: 0, name: place.name, lat: place.lat, lon: place.lon, subtitle: place.subtitle || '' };
  v.count += 1;
  state.visits[key] = v;
  save();
}

// ================================================================ the trip

function startTrip(option, place) {
  state.trip = { option, place, startedAt: now().getTime(), snoozeUntil: 0, page: 0 };
  state.banner = { stage: 'trip' };
  store.set('trip', state.trip);
  recordVisit(place);
  state.islandExpanded = false;
  renderAll();
}

function endTrip() {
  state.trip = null;
  store.set('trip', null);
  state.banner = null;
  state.islandExpanded = false;
  renderAll();
}

const t = (x) => new Date(x.iso).getTime();

function phaseOf(trip, at) {
  const legs = trip.option.legs;
  if (at < t(legs[0].departure)) return { kind: 'before' };
  for (let i = 0; i < legs.length; i++) {
    if (at >= t(legs[i].arrival)) continue;
    // Standing at the stop until the bus leaves is its own moment: the rider
    // needs "in 3 min", not a progress bar that has not started.
    if (legs[i].kind === 'ride' && at < t(legs[i].departure)) return { kind: 'wait', i, leg: legs[i] };
    return { kind: legs[i].kind, i, leg: legs[i] };
  }
  return { kind: 'arrived' };
}

function minutesUntil(ms, at) { return Math.max(0, Math.ceil((ms - at) / 60_000)); }

/* "12 min", or "9 val. 12 min" once it is over an hour: a bare 552 min is
   a number nobody can read at a glance. Units always attached. */
function durationHtml(minutes, rolling = true) {
  const n = rolling ? roll : esc;
  if (minutes < 60) return `${n(minutes)}<small>min</small>`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `${n(h)}<small>val.</small>${m ? ` ${n(m)}<small>min</small>` : ''}`;
}

function dayWord(ms) {
  const today = now(); today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(ms).setHours(0, 0, 0, 0) - today.getTime()) / 86_400_000);
  return days === 1 ? ' rytoj' : days > 1 ? ` ${new Date(ms).toLocaleDateString('lt-LT', { weekday: 'long' })}` : '';
}

function nextRide(legs, from) {
  for (let i = from; i < legs.length; i++) if (legs[i].kind === 'ride') return legs[i];
  return null;
}

// ---- direction: where the rider is, and which way the target lies

const rad = (d) => (d * Math.PI) / 180;
const lerp = (a, b, f) => ({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/* Initial great-circle bearing, degrees clockwise from north. */
function bearing(a, b) {
  const p1 = rad(a.lat), p2 = rad(b.lat), dl = rad(b.lon - a.lon);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function straightMetres(a, b) {
  const dy = (b.lat - a.lat) * 111_320;
  const dx = (b.lon - a.lon) * 111_320 * Math.cos(rad((a.lat + b.lat) / 2));
  return Math.hypot(dx, dy);
}

// Which way, as the rider would say it: "į šiaurės vakarus".
const TOWARDS = ['į šiaurę', 'į šiaurės rytus', 'į rytus', 'į pietryčius', 'į pietus', 'į pietvakarius', 'į vakarus', 'į šiaurės vakarus'];
const towards = (deg) => TOWARDS[Math.round(deg / 45) % 8];

/* The needle turns the short way round: 350° to 10° is 20°, not 340°. */
const needleTurns = {};
function needleAngle(where, deg) {
  const prev = needleTurns[where];
  if (prev == null) return (needleTurns[where] = deg);
  const delta = ((((deg - prev) % 360) + 540) % 360) - 180;
  return (needleTurns[where] = prev + delta);
}
const needle = (where, deg) => `<svg class="needle" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${needleAngle(where, deg).toFixed(1)}deg)">${ARROW}</svg>`;
const pointer = (deg) => `<span class="pointer" aria-hidden="true"><svg viewBox="0 0 24 24" style="transform:rotate(${deg.toFixed(0)}deg)">${ARROW}</svg></span>`;

/* The prototype has no GPS during a trip, so the rider is placed where the
   timetable says they should be: along the walk by elapsed time, between two
   stops by their times. What the real app will replace with a location fix. */
function guidance(trip, phase, at) {
  const legs = trip.option.legs;
  const leg = phase.kind === 'before' ? legs[0] : phase.leg;
  const lastLeg = legs.indexOf(leg) === legs.length - 1;
  if (leg.kind === 'walk') {
    const span = Math.max(1, t(leg.arrival) - t(leg.departure));
    const done = phase.kind === 'before' ? 0 : clamp01((at - t(leg.departure)) / span);
    const here = lerp(leg.from, leg.to, done);
    return {
      mode: 'walk',
      deg: bearing(here, leg.to),
      metres: Math.round(leg.metres * (1 - done)),
      straight: straightMetres(here, leg.to),
      target: leg.to.name,
      toStop: !lastLeg && leg.to.stop != null,
    };
  }
  const stops = leg.stops;
  let k = 0;
  while (k < stops.length - 2 && t(stops[k + 1].time) <= at) k++;
  const a = stops[k], b = stops[k + 1] || stops[k];
  const same = a.lat === b.lat && a.lon === b.lon;
  return {
    mode: 'ride',
    deg: bearing(same ? leg.from : a, same ? leg.to : b),
    next: b.name,
    minutes: Math.max(1, minutesUntil(t(b.time), at)),
  };
}

/* The banner's content for the current moment. Shared by the lock screen and
   the expanded Dynamic Island, like one ActivityConfiguration drawing both. */
function activityContent(where) {
  const b = state.banner;
  if (!b) return '';
  const at = now().getTime();
  const actions = (buttons) => `<div class="actions">${buttons.map(([label, action, primary]) =>
    `<button data-action="${action}"${primary ? ' class="primary"' : ''}>${label}</button>`).join('')}</div>`;

  switch (b.stage) {
    case 'ask':
      // Without a microphone the question stays, and writing is the way on:
      // not speaking is a first-class path, not a dead end.
      return `<div class="question">Kur keliausime šiandien?${state.listening === 'lock' ? dotsHtml : ''}</div>
        <div class="heard">${b.problem ? esc(b.problem) : state.interim ? `„${esc(state.interim)}“` : state.listening === 'lock' ? 'Klausau…' : 'Paliesk, kad rašytum'}</div>
        ${b.problem
          ? actions([['Rašyti', 'banner-open-search', true], ['Bandyti dar kartą', 'lock-button']])
          : actions([['Rašyti', 'banner-open-search'], ['Atšaukti', 'banner-cancel']])}`;
    case 'late':
      // "Be there by 9" that cannot be kept: say so, and offer the earliest
      // arrival there is instead of a trip that should have started already.
      return `<div class="question small problem-text">Nespėsi iki ${esc(b.by)}</div>
        <div class="heard">${b.option
          ? `Anksčiausiai atvyksi ${esc(b.option.arrive.hm)}${b.lateBy ? `, ${b.lateBy} min vėliau` : ''}`
          : `Galiu parodyti greičiausią kelią dabar.`}</div>
        ${b.option ? actions([['Važiuoti', 'banner-go-late', true], ['Atšaukti', 'banner-cancel']])
          : actions([['Dabar', 'banner-now', true], ['Atšaukti', 'banner-cancel']])}`;
    case 'thinking':
      return `<div class="question">Ieškau maršruto${dotsHtml}</div><div class="heard">„${esc(b.heard || '')}“</div>`;
    case 'choosePlace':
      return `<div class="caption">Išgirdau: „${esc(b.heard)}“</div>
        <div class="question small" style="margin-top:4px">Kurią vietą turėjai omeny?</div>
        <div class="choices">${b.choices.slice(0, 2).map((c, i) => `<button data-action="banner-choose" data-index="${i}">
            <span class="t">${esc(c.name)}</span><span class="s">${esc(placeSubtitle(c) || ' ')}</span></button>`).join('')}</div>
        <button class="link-button" data-action="banner-none">Nė viena</button>`;
    case 'chooseTime':
      return `<div class="caption">Į</div><div class="question">${esc(b.place.name)}</div>
        <div class="heard">Kada?</div>
        ${actions([['Dabar', 'banner-now', true], ['Planuoti', 'banner-plan']])}`;
    case 'askTime':
      return `<div class="question">Kada turi būti vietoje?${state.listening === 'lock' ? dotsHtml : ''}</div>
        <div class="heard">${b.problem ? esc(b.problem) : state.interim ? `„${esc(state.interim)}“` : `${esc(b.place.name)} · pasakyk laiką, pvz., „keturiolika dvidešimt“`}</div>
        ${actions([['Dabar', 'banner-now', !!b.problem], b.problem ? ['Bandyti dar kartą', 'banner-plan'] : ['Atšaukti', 'banner-cancel']])}`;
    case 'error':
      return `<div class="question small">${esc(b.message)}</div>
        ${b.detail ? `<div class="heard wrap">${esc(b.detail)}</div>` : ''}
        ${b.code === 'no-origin' ? actions([['Pasirinkti vietą', 'banner-pick-origin', true], ['Atšaukti', 'banner-cancel']])
          : actions([['Bandyti dar kartą', 'banner-retry', true], ['Rašyti', 'banner-open-search']])}`;
    case 'saved':
      return `<div class="question small">Išsaugota: ${esc(b.name)}</div>`;
    case 'suggestSave':
      return `<div class="question small">Išsaugoti šią vietą?</div>
        <div class="heard">${esc(b.name)} · važiuoji čia dažnai</div>
        ${actions([['Išsaugoti', 'banner-save', true], ['Ne', 'banner-nosave']])}`;
    case 'trip':
      return tripContent(at, actions, where);
    default:
      return '';
  }
}

const PAGES = ['Dabar', 'Kryptis', 'Maršrutas'];

/* The page the banner shows. A new stage is a new instruction, so it opens
   on "Dabar" again: the rider never misses "Ruoškis išlipti" because the
   compass was left up. */
const stageOf = (phase) => `${phase.kind}:${phase.i ?? ''}`;
function pageOf(trip, phase) {
  if (trip.pageStage !== stageOf(phase)) {
    trip.pageStage = stageOf(phase);
    trip.page = 0;
  }
  return trip.page || 0;
}

// The first two minutes of the first walk are "leave now": the prototype
// has no location, and that is the moment the rider must be told to go.
const LEAVE_NOW_MS = 2 * 60_000;
const leavingNow = (trip, phase, at) => phase.kind === 'walk' && phase.i === 0
  && !!nextRide(trip.option.legs, 1) && at - t(phase.leg.departure) < LEAVE_NOW_MS;

/* Identity of what the banner shows. When it changes the content cross-fades;
   when it stays, only the numbers inside it move. */
function activityKey() {
  const b = state.banner;
  if (!b) return '';
  if (b.stage !== 'trip' || !state.trip) return b.problem ? `${b.stage}:problem` : b.stage;
  const at = now().getTime();
  const phase = phaseOf(state.trip, at);
  if (phase.kind === 'arrived') return `arrived:${state.trip.snoozeUntil > at}`;
  return `trip:${stageOf(phase)}${leavingNow(state.trip, phase, at) ? ':now' : ''}|${pageOf(state.trip, phase)}`;
}

/* One button that names the next page. No dots: a Live Activity cannot be
   swiped, so nothing should look as if it could. */
function activityPager() {
  const b = state.banner, trip = state.trip;
  if (!b || b.stage !== 'trip' || !trip || phaseOf(trip, now().getTime()).kind === 'arrived') return '';
  const next = (pageOf(trip, phaseOf(trip, now().getTime())) + 1) % PAGES.length;
  return `<button class="pager-next" data-action="banner-page" data-page="${next}" aria-label="Rodyti: ${esc(PAGES[next])}">${esc(PAGES[next])}${icon('chevron')}</button>`;
}

function tripContent(at, actions, where) {
  const trip = state.trip;
  if (!trip) return '';
  const o = trip.option;
  const phase = phaseOf(trip, at);

  if (phase.kind === 'arrived') {
    if (trip.snoozeUntil > at) {
      return `<div class="question small">${esc(trip.place.name)}</div><div class="heard">Atvykai ${esc(o.arrive.hm)}</div>`;
    }
    return `<div class="question">Ar baigėte kelionę?</div>
      <div class="heard">${esc(trip.place.name)} · ${esc(o.arrive.hm)}</div>
      ${actions([['Taip', 'trip-done', true], ['Dar ne', 'trip-snooze']])}`;
  }
  const page = pageOf(trip, phase);
  if (page === 1) return directionPage(trip, phase, at, where);
  if (page === 2) return routePage(trip, phase);
  return nowPage(trip, phase, at);
}

/* One template for every stage, so nothing moves between them. Left: what to
   do, then where. Right: how long until the next thing happens, and what and
   when that is. The bottom line holds the distance or the ride's progress,
   beside the page button. Three type sizes: the number, the instruction,
   everything else. */
function stageHtml({ title, meta = '', label = '', hero = '', long = false, foot = '' }) {
  return `<div class="stage">
      <div class="stage-text"><div class="stage-title">${title}</div><div class="stage-meta">${meta}</div></div>
      <div class="stage-hero"><div class="stage-label">${label}</div><div class="big${long ? ' hours' : ''}">${hero}</div></div>
    </div>
    <div class="stage-foot">${foot}</div>`;
}
const clip = (html) => `<span class="clip">${html}</span>`;
const distanceHtml = (m) => `${roll(roundMetres(m))} ${m >= 1000 ? 'km' : 'm'}`;
const progressHtml = (f) => `<div class="progress"><i style="width:${(clamp01(f) * 100).toFixed(1)}%"></i></div>`;
// Counts to the minute that is shown beside it: "išeik 08:01" never sits
// over "2 min" at 08:00 because the plan said 08:01:40.
const countdown = (ms, at) => {
  const m = ms > at ? Math.max(1, minutesUntil(Math.floor(ms / 60_000) * 60_000, at)) : 0;
  return { hero: durationHtml(m), long: m >= 60 };
};

// Page 1: what to do now.
function nowPage(trip, phase, at) {
  const o = trip.option;
  const legs = o.legs;

  if (phase.kind === 'before') {
    const leave = t(legs[0].departure);
    const ride = nextRide(legs, 0);
    const walk = legs[0].kind === 'walk' ? legs[0] : null;
    return stageHtml({
      title: `Išeik${esc(dayWord(leave))} ${esc(o.leave.hm)}`,
      meta: ride ? `${badge(ride.route, true)}${clip(esc(ride.from.name))}` : clip(esc(trip.place.name)),
      label: 'liko',
      ...countdown(leave, at),
      foot: clip([walk ? `${metresText(walk.metres)} pėsčiomis` : '', ride ? `išvyksta ${esc(ride.departure.hm)}` : `atvyksi ${esc(o.arrive.hm)}`]
        .filter(Boolean).join(' · ')),
    });
  }

  const leg = phase.leg;
  if (phase.kind === 'wait') {
    const transfer = phase.i > 0 && legs[phase.i - 1].kind === 'ride';
    return stageHtml({
      title: transfer ? 'Persėsk' : 'Lauk stotelėje',
      meta: `${badge(leg.route, true)}${clip(esc(leg.from.name))}`,
      label: `išvyksta ${esc(leg.departure.hm)}`,
      ...countdown(t(leg.departure), at),
      foot: leg.headsign ? clip(`→ ${esc(leg.headsign)}`) : '',
    });
  }

  if (phase.kind === 'ride') {
    const remaining = Math.max(1, leg.stops.filter((s) => t(s.time) > at).length);
    return stageHtml({
      title: remaining === 1 ? 'Ruoškis išlipti' : `Važiuok ${stopsAccText(remaining)}`,
      meta: `${badge(leg.route, true)}${clip(`iki stotelės „${esc(leg.to.name)}“`)}`,
      label: `išlipsi ${esc(leg.arrival.hm)}`,
      ...countdown(t(leg.arrival), at),
      foot: progressHtml((at - t(leg.departure)) / Math.max(1, t(leg.arrival) - t(leg.departure))),
    });
  }

  // Walking: to the first stop, between vehicles, or to the destination. The
  // distance is what is left of this walk, so it only ever goes down.
  const g = guidance(trip, phase, at);
  const foot = clip(`${pointer(g.deg)}${distanceHtml(g.metres)}`);
  const ride = nextRide(legs, phase.i + 1);
  if (!ride) {
    return stageHtml({
      title: 'Eik pėsčiomis',
      meta: clip(esc(trip.place.name)),
      label: `atvyksi ${esc(o.arrive.hm)}`,
      ...countdown(t(o.arrive), at),
      foot,
    });
  }
  let title = 'Eik į stotelę';
  if (phase.i > 0) title = 'Persėsk';
  else if (leavingNow(trip, phase, at)) title = 'Išeik dabar';
  return stageHtml({
    title,
    meta: `${badge(ride.route, true)}${clip(esc(ride.from.name))}`,
    label: `išvyksta ${esc(ride.departure.hm)}`,
    ...countdown(t(ride.departure), at),
    foot,
  });
}

// Page 2: which way. Walking, towards the next stop or the destination;
// riding, the direction of travel and the next stop.
function directionPage(trip, phase, at, where) {
  const g = guidance(trip, phase, at);
  const view = (inner, title, meta) => `<div class="dir">
      <div class="compass"><span class="north">Š</span>${inner}</div>
      <div class="stage-text"><div class="stage-title">${title}</div><div class="stage-meta">${meta}</div></div>
    </div><div class="stage-foot"></div>`;
  if (phase.kind === 'wait') {
    const leg = phase.leg;
    return view(needle(where, g.deg), capital(towards(g.deg)), `${badge(leg.route, true)}${clip(`→ ${esc(leg.headsign || leg.to.name)}`)}`);
  }
  if (g.mode === 'ride') {
    return view(needle(where, g.deg), capital(towards(g.deg)), clip(`Kita stotelė: ${esc(g.next)} · ${g.minutes} min`));
  }
  if (g.straight < 15 || g.metres < 15) return view('<i class="here"></i>', 'Tu jau čia', clip(esc(g.target)));
  return view(needle(where, g.deg), capital(towards(g.deg)), clip(`${esc(g.target)} · ${distanceHtml(g.metres)}`));
}

// Page 3: now, next, arrival. Three lines fit a Live Activity; the whole
// list lives in the app, one tap away.
function routePage(trip, phase) {
  const o = trip.option;
  const legs = o.legs;
  const current = phase.kind === 'before' ? 0 : phase.i;
  const row = (leg, cls) => {
    let glyph = icon('walk'), text;
    if (leg.kind === 'ride') {
      glyph = badge(leg.route, true);
      text = `iki stotelės „${esc(leg.to.name)}“`;
    } else if (leg.to.stop == null) {
      text = `${metresText(leg.metres)} iki tikslo`;
    } else {
      text = leg.from.name === leg.to.name ? 'į kitą tos pačios stotelės peroną' : `${metresText(leg.metres)} iki stotelės „${esc(leg.to.name)}“`;
    }
    return `<div class="leg-row${cls}"><span class="t">${esc(leg.departure.hm)}</span><span class="glyph">${glyph}</span><span class="text">${text}</span></div>`;
  };
  const rows = [row(legs[current], phase.kind === 'before' ? '' : ' now')];
  // A few metres across the same stop is not a step worth a line.
  const next = legs.slice(current + 1).find((l) => l.kind === 'ride' || l.metres >= 120);
  if (next) rows.push(row(next, ''));
  rows.push(`<div class="leg-row"><span class="t">${esc(o.arrive.hm)}</span><span class="glyph">${icon('pin')}</span><span class="text">${esc(trip.place.name)}</span></div>`);
  return `<div class="legs">${rows.join('')}</div><div class="stage-foot"></div>`;
}

function islandCompact() {
  const b = state.banner;
  if (!b) return null;
  const at = now().getTime();
  if (b.stage !== 'trip' || !state.trip) {
    return { left: icon('mic'), right: state.listening ? 'Klausau' : '' };
  }
  const legs = state.trip.option.legs;
  const phase = phaseOf(state.trip, at);
  if (phase.kind === 'before') {
    const ride = nextRide(legs, 0);
    const left = minutesUntil(t(legs[0].departure), at);
    return { left: ride ? badge(ride.route, true) : icon('walk'), right: left >= 60 ? `${roll(Math.floor(left / 60))} val.` : `${roll(left)} min` };
  }
  if (phase.kind === 'arrived') return { left: icon('pin'), right: 'Atvykai' };
  if (phase.kind === 'wait') return { left: badge(phase.leg.route, true), right: `${roll(minutesUntil(t(phase.leg.departure), at))} min` };
  if (phase.kind === 'ride') return { left: badge(phase.leg.route, true), right: esc(phase.leg.arrival.hm) };
  const ride = nextRide(legs, phase.i + 1);
  return ride
    ? { left: badge(ride.route, true), right: `${roll(minutesUntil(t(ride.departure), at))} min` }
    : { left: icon('walk'), right: esc(state.trip.option.arrive.hm) };
}

/* Puts the banner into `host`, or updates the one already there. Same key:
   morph, so only the digits move. New key: cross-fade. No content: the card
   leaves. */
function renderActivity(host, where, { fresh = false } = {}) {
  const body = activityContent(where);
  let card = host.querySelector(':scope > .activity:not(.leaving)');
  if (!body) {
    if (card) {
      card.classList.add('leaving');
      afterPlay(play(card, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px) scale(0.97)' }], 'exit', { fill: 'forwards' }), () => card.remove());
    }
    return null;
  }
  const key = activityKey();
  const pager = activityPager();
  if (card && fresh) { card.remove(); card = null; }
  if (!card) {
    card = document.createElement('div');
    card.className = 'activity';
    if (where === 'lock') {
      card.dataset.action = 'activity-tap';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', 'Kelionės baneris');
    }
    card.innerHTML = '<div class="act-body"></div><div class="act-pager"></div>';
    card.classList.toggle('trip', key.startsWith('trip:'));
    card.firstChild.innerHTML = body;
    card.lastChild.innerHTML = pager;
    card.dataset.key = key;
    host.appendChild(card);
    if (where === 'lock' && !fresh) {
      play(card, [{ opacity: 0, transform: 'translateY(16px) scale(0.97)' }, { opacity: 1, transform: 'none' }], 'rise');
    }
    return card;
  }
  const bodyEl = card.querySelector('.act-body');
  const pagerEl = card.querySelector('.act-pager');
  if (card.dataset.key !== key) {
    const [oldStage, oldPage] = card.dataset.key.split('|');
    const [newStage, newPage] = key.split('|');
    const dx = oldStage === newStage && oldPage !== newPage
      ? ((Number(newPage) - Number(oldPage) + PAGES.length) % PAGES.length === 1 ? 1 : -1) : 0;
    card.dataset.key = key;
    // A trip keeps one height on every stage and page, so the banner's top
    // edge stays put; only questions and answers around it change size.
    crossfade(card, bodyEl, () => {
      card.classList.toggle('trip', key.startsWith('trip:'));
      bodyEl.innerHTML = body; morph(pagerEl, pager);
    }, { dx, animateHeight: where === 'lock' });
    return card;
  }
  morph(bodyEl, body);
  morph(pagerEl, pager);
  return card;
}

// ============================================================ lock screen

let lockShown = false;

function renderLock() {
  const lock = $('#lock');
  $('#statusbar').classList.toggle('on-lock', state.locked);
  if (state.locked && !lock.firstChild) {
    lock.innerHTML = `
      <div class="lock-top"><div class="date"></div><div class="clock"><span class="roll"></span></div></div>
      <div class="coach" hidden></div>
      <div class="stack"></div>
      <div class="controls">
        <button class="control ours" data-action="lock-button" aria-label="Vilnius · Kur keliausime">${icon('bus')}</button>
        <button class="control" aria-label="Kamera" tabindex="-1">${icon('camera')}</button>
      </div>
      <div class="unlock-hint">Braukite aukštyn, kad atidarytumėte</div>
      <div class="home-indicator" data-action="unlock" role="button" tabindex="0" aria-label="Atrakinti"></div>`;
  }
  if (state.locked !== lockShown) {
    lockShown = state.locked;
    animateLock(lock, state.locked);
  }
  if (!state.locked) return;
  const d = now();
  // The locale's own order and its "d." ("rugsėjo 28 d., pirmadienis"),
  // capitalised at the start of the line, as iOS does.
  const date = capital(new Intl.DateTimeFormat('lt-LT', { weekday: 'long', month: 'long', day: 'numeric' }).format(d));
  const dateEl = $('.date', lock);
  if (dateEl.textContent !== date) dateEl.textContent = date;
  rollTo($('.clock .roll', lock), hm(d));
  const card = renderActivity($('.stack', lock), 'lock');
  // The system's own hint gives way to a banner, as on the iPhone.
  lock.classList.toggle('has-activity', !!card);
  // Until the button has been used once, say what it is for.
  const coach = $('.coach', lock);
  const showCoach = !card && !store.get('lockButtonUsed', false);
  if (coach.hidden === showCoach) {
    coach.hidden = !showCoach;
    coach.innerHTML = showCoach ? 'Paspausk <b>mygtuką</b> ir pasakyk, kur keliauji.' : '';
    if (showCoach) play(coach, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], 'content', { delay: 300, fill: 'backwards' });
  }
}

/* Locking fades the lock screen in; unlocking slides it up and the app
   zooms back to full size under it, from wherever a swipe left it. */
function animateLock(lock, show) {
  lock.getAnimations().forEach((a) => a.cancel());
  if (show) {
    lock.hidden = false;
    lock.style.transform = '';
    play(lock, [{ opacity: 0 }, { opacity: 1 }], 'fade');
    play($('.lock-top', lock), [{ transform: 'translateY(-10px)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], 'content');
    return;
  }
  const from = lock.style.transform || 'none';
  lock.style.transform = '';
  const slide = play(lock, [{ transform: from }, { transform: 'translateY(-100%)' }], 'push', { fill: 'forwards' });
  play($('#app'), [{ transform: 'scale(0.94)', opacity: 0.6 }, { transform: 'none', opacity: 1 }], 'push');
  afterPlay(slide, () => {
    if (state.locked) return;
    lock.hidden = true;
    lock.innerHTML = '';
    if (slide) slide.cancel();
  });
}

let islandWasExpanded = false;

function renderIsland() {
  const island = $('#island');
  const compact = islandCompact();
  // The island only expands for a trip; a question or a confirmation belongs
  // on the lock screen.
  if (!state.banner || state.banner.stage !== 'trip') state.islandExpanded = false;
  // On the lock screen the banner is already there; the island stays idle,
  // as it does on a real iPhone.
  const showCompact = !!compact && !state.locked;
  const expanded = showCompact && state.islandExpanded;
  island.classList.toggle('compact', showCompact && !expanded);
  island.classList.toggle('expanded', expanded);
  if (!island.firstChild) {
    island.innerHTML = '<div class="compact-row"><span class="c-left"></span><span class="c-right"></span></div><div class="expanded-body"></div>';
  }
  if (showCompact) {
    const row = $('.compact-row', island);
    const html = `<span class="c-left">${compact.left}</span><span class="c-right">${compact.right}</span>`;
    if (row.dataset.html !== html) { morph(row, html); row.dataset.html = html; }
  }
  const body = $('.expanded-body', island);
  if (expanded) {
    renderActivity(body, 'island', { fresh: !islandWasExpanded });
    island.style.height = `${body.offsetHeight}px`;
  } else {
    island.style.height = '';
  }
  islandWasExpanded = expanded;
}

function renderOverlay() {
  const overlay = $('#overlay');
  let sheet = overlay.querySelector('.sheet-backdrop:not(.leaving)');
  if (state.sheet && !sheet) {
    overlay.insertAdjacentHTML('afterbegin', state.sheet);
    sheet = overlay.querySelector('.sheet-backdrop');
    sheet.dataset.html = state.sheet;
    play(sheet, [{ backgroundColor: 'rgba(0,0,0,0)' }, { backgroundColor: 'rgba(0,0,0,0.35)' }], 'fade');
    play(sheet.firstElementChild, [{ transform: 'translateY(100%)' }, { transform: 'none' }], 'sheet');
  } else if (state.sheet && sheet.dataset.html !== state.sheet) {
    sheet.dataset.html = state.sheet;
    morph(sheet, $('.sheet-backdrop', Object.assign(document.createElement('div'), { innerHTML: state.sheet })).innerHTML);
  } else if (!state.sheet && sheet) {
    const leaving = sheet;
    leaving.classList.add('leaving');
    play(leaving.firstElementChild, [{ transform: 'none' }, { transform: 'translateY(100%)' }], 'exit', { fill: 'forwards' });
    afterPlay(play(leaving, [{ backgroundColor: 'rgba(0,0,0,0.35)' }, { backgroundColor: 'rgba(0,0,0,0)' }], 'exit', { fill: 'forwards' }), () => leaving.remove());
  }

  let toastEl = overlay.querySelector('.toast:not(.leaving)');
  if (toastEl && toastEl.textContent !== state.toast) {
    const leaving = toastEl;
    leaving.classList.add('leaving');
    afterPlay(play(leaving, [{ opacity: 1 }, { opacity: 0 }], 'exit', { fill: 'forwards' }), () => leaving.remove());
    toastEl = null;
  }
  if (state.toast && !toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    toastEl.textContent = state.toast;
    overlay.appendChild(toastEl);
    play(toastEl, [{ opacity: 0, transform: 'translateY(10px) scale(0.96)' }, { opacity: 1, transform: 'none' }], 'content');
  }
}

function renderClock() {
  const d = now();
  const status = $('#status-time');
  if (status.textContent !== hm(d)) status.textContent = hm(d);
  $('#sim-clock').textContent = `${hm(d)}:${pad(d.getSeconds())}`;
}

function renderAll() {
  renderApp(); renderLock(); renderIsland(); renderOverlay(); renderClock();
  $('#toggle-lock').textContent = state.locked ? 'Atrakinti' : 'Užrakinti';
}

// Four times a second, but the DOM only changes where the content did.
let lastMinute = '';
setInterval(() => {
  renderClock(); renderLock(); renderIsland();
  const minute = hm(now());
  if (minute !== lastMinute) {
    lastMinute = minute;
    // "Išeik po 5 min" on the results and the route must not go stale.
    if (state.prefs && ['results', 'detail'].includes(currentScreen().name)) renderApp();
  }
}, 250);

// =================================================================== voice

let recognition = null;

function stopListening() {
  if (recognition) { try { recognition.abort(); } catch { /* already stopped */ } }
  recognition = null;
  state.listening = null;
}

function listen(surface, onText) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  stopListening();
  state.interim = '';
  // Inside the phone the words are the phone's: no "browser". The panel's
  // typed field is the desk's stand-in for a microphone.
  if (!Recognition) {
    failVoice(surface, 'Balso atpažinimas nepasiekiamas.');
    return;
  }
  const r = new Recognition();
  r.lang = 'lt-LT';
  r.interimResults = true;
  r.maxAlternatives = 1;
  let finished = false;
  // Cancelling aborts the recognition, which then reports "aborted": by then
  // it is no longer the one listening, and has nothing more to say.
  const stale = () => recognition !== r;
  r.onresult = (event) => {
    if (stale()) return;
    let text = '', final = false;
    for (const result of event.results) { text += result[0].transcript; if (result.isFinal) final = true; }
    state.interim = text;
    renderAll();
    if (final && !finished) { finished = true; stopListening(); onText(text); }
  };
  r.onerror = (event) => {
    if (finished || stale()) return;
    finished = true;
    state.listening = null;
    recognition = null;
    const message = {
      'not-allowed': 'Mikrofonas nepasiekiamas.',
      'service-not-allowed': 'Mikrofonas nepasiekiamas.',
      'audio-capture': 'Mikrofonas nepasiekiamas.',
      'no-speech': 'Nieko neišgirdau.',
      'language-not-supported': 'Lietuvių kalbos atpažinimas nepasiekiamas.',
      network: 'Balso atpažinimui reikia interneto.',
    }[event.error] || 'Balso atpažinimas nepasiekiamas.';
    failVoice(surface, message);
  };
  r.onend = () => { if (!finished && !stale()) { state.listening = null; recognition = null; renderAll(); } };
  recognition = r;
  state.listening = surface;
  state.pendingVoice = onText;
  try { r.start(); } catch { recognition = null; failVoice(surface, 'Balso atpažinimas nepasiekiamas.'); }
  renderAll();
}

/* On the lock screen the question stays up with the reason under it, and
   the banner offers writing instead: see activityContent. */
function failVoice(surface, message) {
  if (surface === 'lock' && state.banner && ['ask', 'askTime'].includes(state.banner.stage)) {
    state.banner = { ...state.banner, problem: message };
  } else if (surface === 'lock') {
    state.banner = { stage: 'ask', problem: message };
  } else {
    toast(message);
  }
  renderAll();
}

/* A spoken place is taken only when the search is sure of it. Otherwise the
   rider picks: better one tap than a trip to the wrong Akropolis. Servers
   that do not report confidence keep the old behaviour (take the top). */
async function resolvePlace(parsed) {
  if (parsed.home) {
    const home = state.places.find((p) => ['namai', 'namo'].includes(fold(p.name)));
    if (!home) throw new Error('Dar neišsaugojai vietos „Namai“.');
    return { place: home };
  }
  const candidates = parsed.candidates && parsed.candidates.length ? parsed.candidates : [parsed.destination];
  for (const candidate of candidates) {
    const saved = state.places.find((p) => sameName(p.name, candidate));
    if (saved) return { place: saved };
  }
  let unsure = null;
  for (const candidate of candidates) {
    const data = await api('/api/search', { q: candidate, ...near() });
    const results = cleanResults(data.results || [], candidate);
    if (!results.length) continue;
    const top = results[0];
    const sure = !data.ambiguous && (top.confidence == null || top.confidence === 'high');
    if (sure) return { place: top };
    if (!unsure) unsure = { choices: results, query: candidate };
  }
  return unsure;
}

/* One utterance, from the lock screen or from the app. `awaiting` is the
   place whose time was just asked for. */
async function handleUtterance(text, surface, awaiting = null) {
  const onLock = surface === 'lock';
  const fail = (message) => {
    if (onLock) { state.banner = { stage: 'error', message, retry: awaiting ? 'askTime' : 'ask', place: awaiting }; renderAll(); }
    else toast(message);
  };
  if (onLock) { state.banner = { stage: 'thinking', heard: text, place: awaiting }; renderAll(); }
  try {
    const parsed = await api('/api/parse', { text, now: hm(now()) });
    if (awaiting) {
      if (!parsed.time && !parsed.now) return fail('Neišgirdau laiko. Pasakyk, pvz., „keturiolika dvidešimt“.');
      return planAndGo(awaiting, parsed.now ? 'now' : parsed.mode === 'depart' ? 'depart' : 'arrive', parsed.time, surface);
    }
    if (!parsed.destination) return fail('Neišgirdau, kur keliausi.');
    const found = await resolvePlace(parsed);
    if (!found) return fail(`Neradau „${parsed.destination}“.`);
    if (found.choices) {
      const when = { time: parsed.time, mode: parsed.mode, now: parsed.now };
      if (onLock) {
        state.banner = { stage: 'choosePlace', heard: text, choices: found.choices, query: found.query, when };
        renderAll();
      } else {
        state.heard = text; state.query = found.query; state.results = found.choices; state.searching = false;
        state.stack = [HOME()];
        renderApp();
      }
      return;
    }
    return goWithPlace(found.place, parsed, surface);
  } catch (e) {
    fail(e.message);
  }
}

function goWithPlace(place, when, surface) {
  if (when.time) return planAndGo(place, when.mode || 'arrive', when.time, surface);
  if (when.now) return planAndGo(place, 'now', null, surface);
  if (surface === 'lock') { state.banner = { stage: 'chooseTime', place }; renderAll(); return; }
  state.destination = place;
  state.sheet = `<div class="sheet-backdrop" data-action="close-sheet"><div class="sheet" data-stop="1" role="dialog" aria-label="Kada keliausi">
      <h3>${esc(place.name)}</h3><p>Kada keliausi?</p>
      <div class="buttons"><button class="prominent" data-action="sheet-now">Dabar</button>
      <button class="secondary" style="height:52px" data-action="sheet-plan">Planuoti</button></div></div></div>`;
  renderOverlay();
}

async function planAndGo(place, mode, time, surface) {
  if (surface === 'lock') {
    state.banner = { stage: 'thinking', heard: state.interim || place.name, place };
    renderAll();
    try {
      const plan = await planTrip(place, mode, time);
      if (!plan.options.length) throw new Error('Maršruto šiuo laiku nerasta.');
      if (plan.late) {
        // Nothing gets there in time: the plan is already the fastest way
        // from now. Say so before starting it.
        state.banner = { stage: 'late', by: time, option: earliest(plan.options.filter((o) => !isLate(o))), lateBy: plan.late_by_min, place };
        renderAll();
        return;
      }
      const reachable = mode === 'arrive' ? plan.options.find((o) => !isLate(o)) : plan.options[0];
      if (!reachable) {
        // A server that does not know "now" yet: only the fallback offer.
        state.banner = { stage: 'late', by: time, option: null, place };
        renderAll();
        return;
      }
      startTrip(reachable, place);
    } catch (e) {
      // A banner has room for a sentence, not a paragraph.
      state.banner = e.code === 'no-origin'
        ? { stage: 'error', message: 'Nežinau, iš kur keliauji.', detail: 'Pasirink vietą arba leisk naršyklei ją nustatyti.', code: e.code, retry: 'ask' }
        : { stage: 'error', message: e.message, retry: 'ask' };
      renderAll();
    }
    return;
  }
  state.timeMode = mode; state.timeValue = time || '';
  openDestination(place);
}

// ================================================================= events

document.addEventListener('click', (event) => {
  // Like iOS: a tap anywhere else folds the expanded island back.
  if (state.islandExpanded && !event.target.closest('#island')) { state.islandExpanded = false; renderIsland(); }
  const target = event.target.closest('[data-action]');
  if (!target) return;
  if (event.target.closest('[data-stop]') && target.dataset.action === 'close-sheet' && !event.target.closest('button')) return;
  const action = target.dataset.action;
  const handler = actions[action];
  if (handler) { event.preventDefault(); handler(target, event); }
});

const actions = {
  back: () => {
    if (!state.prefs && state.draft) { state.draft.step = Math.max(0, state.draft.step - 1); renderApp(); return; }
    // The pick screen's search is its own: home must not come back showing it.
    if (currentScreen().name === 'pick') { state.query = ''; state.results = []; }
    pop();
  },
  settings: () => push({ name: 'settings' }),
  places: () => push({ name: 'places' }),
  'add-place': () => { state.query = ''; state.results = []; state.heard = ''; push({ name: 'pick', purpose: 'place' }); },
  'pick-origin': () => { state.query = ''; state.results = []; state.heard = ''; push({ name: 'pick', purpose: 'origin' }); },
  locate: () => locate(true),
  lock: () => { state.locked = true; state.islandExpanded = false; renderAll(); },
  unlock: () => {
    state.locked = false; state.islandExpanded = false; stopListening();
    // A question or an error was for the lock screen; only a trip lives on
    // in the island.
    if (state.banner && state.banner.stage !== 'trip') state.banner = state.trip ? { stage: 'trip' } : null;
    renderAll();
  },

  draft: (el) => { state.draft[el.dataset.pref] = el.dataset.value; renderApp(); },
  'draft-next': () => {
    if (state.draft.step < 1) { state.draft.step += 1; renderApp(); return; }
    state.prefs = { priority: state.draft.priority, walk: state.draft.walk };
    state.draft = null; save();
    state.stack = [HOME()];
    // Straight to the lock screen: the banner is the product.
    state.locked = true;
    renderAll();
  },
  pref: (el) => { state.prefs[el.dataset.pref] = el.dataset.value; save(); renderApp(); },
  reset: () => {
    if (!confirm('Ištrinti nustatymus, vietas ir istoriją šioje naršyklėje?')) return;
    Object.assign(state, { prefs: null, places: [], visits: {}, dismissed: [], originChoice: 'gps', stack: [HOME()] });
    store.set('lockButtonUsed', false);
    save(); endTrip();
  },

  'time-mode': (el) => {
    state.timeMode = el.dataset.mode;
    if (state.timeMode !== 'now' && !state.timeValue) state.timeValue = hm(new Date(now().getTime() + 30 * 60_000));
    renderApp();
    if (currentScreen().name === 'results') runPlan();
  },

  go: (el) => openDestination(currentItems()[Number(el.dataset.index)]),
  'go-place': (el) => openDestination(state.places.find((p) => p.id === el.dataset.id)),
  picked: (el) => {
    const item = currentItems()[Number(el.dataset.index)];
    if (currentScreen().purpose === 'origin') {
      const existing = state.places.find((p) => sameName(p.name, item.name) && Math.abs(p.lat - item.lat) < 0.002);
      const place = existing || { id: uid(), name: item.name, subtitle: placeSubtitle(item), lat: item.lat, lon: item.lon, temporary: true };
      if (!existing) state.places.push(place);
      state.originChoice = place.id; save(); state.query = ''; pop(); fillOrigins();
      if (!existing) toast('Pridėta prie tavo vietų — gali pervadinti');
      return;
    }
    askName(item);
  },
  'origin-gps': () => { state.originChoice = 'gps'; save(); pop(); fillOrigins(); },
  'origin-place': (el) => { state.originChoice = el.dataset.id; save(); pop(); fillOrigins(); },
  'delete-place': (el) => {
    state.places = state.places.filter((p) => p.id !== el.dataset.id);
    if (state.originChoice === el.dataset.id) state.originChoice = 'gps';
    save(); renderApp(); fillOrigins();
  },
  'open-option': (el) => { state.selected = state.plan.options[Number(el.dataset.index)]; state.openStops = {}; push({ name: 'detail' }); },
  'toggle-stops': (el) => { const i = el.dataset.index; state.openStops[i] = !state.openStops[i]; renderApp(); },
  'start-trip': () => {
    startTrip(state.selected, state.destination);
    toast('Kelionė pradėta');
    setTimeout(() => { state.locked = true; renderAll(); }, 700);
  },
  'end-trip': () => { endTrip(); pop(); },
  'save-suggestion': (el) => { const v = state.visits[el.dataset.keyRef]; if (v) askName({ ...v }); },
  'dismiss-suggestion': (el) => { state.dismissed.push(el.dataset.keyRef); save(); renderApp(); },

  'app-mic': () => {
    if (state.listening === 'app') { stopListening(); renderAll(); return; }
    listen('app', (text) => handleUtterance(text, 'app'));
  },
  'close-sheet': () => { state.sheet = null; renderOverlay(); },
  'sheet-now': () => { state.sheet = null; renderOverlay(); state.timeMode = 'now'; openDestination(state.destination); },
  'sheet-plan': () => {
    state.sheet = null; renderOverlay();
    state.timeMode = 'arrive'; state.timeValue = hm(new Date(now().getTime() + 60 * 60_000));
    openDestination(state.destination);
  },
  'confirm-name': () => {
    const input = $('#new-name');
    const pending = state.pendingPlace;
    if (!pending || !input) return;
    const name = input.value.trim() || pending.name;
    state.places.push({ id: uid(), name, subtitle: placeSubtitle(pending) || pending.name, lat: pending.lat, lon: pending.lon });
    state.pendingPlace = null; state.sheet = null; save(); renderOverlay();
    if (currentScreen().name === 'pick') { state.query = ''; state.results = []; pop(); } else renderApp();
    fillOrigins();
    toast(`Išsaugota: ${name}`);
  },

  // --- lock screen and banner
  'lock-button': () => {
    store.set('lockButtonUsed', true);
    state.banner = { stage: 'ask' };
    state.islandExpanded = false;
    renderAll();
    listen('lock', (text) => handleUtterance(text, 'lock'));
  },
  'activity-tap': (el, event) => {
    if (event.target.closest('button')) return;
    const b = state.banner;
    stopListening();
    state.locked = false;
    if (b && b.stage === 'trip' && state.trip) {
      state.selected = state.trip.option; state.destination = state.trip.place; state.openStops = {};
      state.stack = [HOME(), { name: 'detail', id: uid() }];
    } else if (b && b.stage === 'choosePlace') {
      // The full list, with what was heard, is one tap away.
      state.heard = b.heard; state.query = b.query; state.results = b.choices;
      state.banner = state.trip ? { stage: 'trip' } : null;
      state.stack = [HOME()];
    } else {
      if (b && b.stage !== 'trip') state.banner = null;
      state.stack = [HOME()];
      setTimeout(() => { const s = inPage('#search'); if (s) s.focus(); }, 50);
    }
    renderAll();
  },
  'search-cancel': () => {
    state.searchActive = false; state.query = ''; state.results = []; state.heard = '';
    const field = inPage('#search');
    if (field) { field.value = ''; field.blur(); }
    renderApp();
  },
  'banner-open-search': () => { stopListening(); state.banner = null; state.locked = false; state.stack = [HOME()]; renderAll(); setTimeout(() => { const s = inPage('#search'); if (s) s.focus(); }, 50); },
  'banner-cancel': () => { stopListening(); state.banner = state.trip ? { stage: 'trip' } : null; renderAll(); },
  'banner-now': () => { const place = state.banner.place; stopListening(); planAndGo(place, 'now', null, 'lock'); },
  'banner-go-late': () => { const b = state.banner; if (b && b.option) startTrip(b.option, b.place); },
  'banner-plan': () => {
    const place = state.banner.place;
    state.banner = { stage: 'askTime', place };
    renderAll();
    listen('lock', (text) => handleUtterance(text, 'lock', place));
  },
  'banner-retry': () => {
    const b = state.banner;
    if (b.retry === 'askTime' && b.place) return actions['banner-plan']();
    actions['lock-button']();
  },
  'banner-choose': (el) => {
    const b = state.banner;
    const place = b.choices[Number(el.dataset.index)];
    stopListening();
    goWithPlace(place, b.when, 'lock');
  },
  'banner-none': () => actions['lock-button'](),
  'banner-pick-origin': () => {
    stopListening();
    state.banner = state.trip ? { stage: 'trip' } : null;
    state.locked = false; state.query = ''; state.results = [];
    state.stack = [HOME(), { name: 'pick', purpose: 'origin', id: uid() }];
    renderAll();
  },
  'banner-page': (el) => {
    if (!state.trip) return;
    state.trip.page = Number(el.dataset.page) % PAGES.length;
    state.trip.pageStage = stageOf(phaseOf(state.trip, now().getTime()));
    store.set('trip', state.trip);
    renderLock(); renderIsland();
  },
  'trip-done': () => {
    const place = state.trip.place;
    const key = placeKey(place);
    const known = state.places.some((p) => Math.abs(p.lat - place.lat) < 0.0015 && Math.abs(p.lon - place.lon) < 0.0015);
    state.trip = null;
    store.set('trip', null);
    const visits = state.visits[key];
    if (!known && visits && visits.count >= 2 && !state.dismissed.includes(key)) {
      state.banner = { stage: 'suggestSave', name: place.name, key };
    } else {
      state.banner = null;
    }
    renderAll();
  },
  'trip-snooze': () => { state.trip.snoozeUntil = now().getTime() + 5 * 60_000; renderAll(); },
  'banner-save': () => {
    const v = state.visits[state.banner.key];
    state.places.push({ id: uid(), name: v.name, subtitle: v.subtitle, lat: v.lat, lon: v.lon });
    save(); fillOrigins();
    state.banner = { stage: 'saved', name: v.name };
    renderAll();
    setTimeout(() => { if (state.banner && state.banner.stage === 'saved') { state.banner = null; renderAll(); } }, 2500);
  },
  'banner-nosave': () => { state.dismissed.push(state.banner.key); save(); state.banner = null; renderAll(); },
};

function askName(item) {
  state.pendingPlace = item;
  state.sheet = `<div class="sheet-backdrop" data-action="close-sheet"><div class="sheet" data-stop="1" role="dialog" aria-label="Kaip pavadinti">
      <h3>Kaip pavadinti?</h3><p>${esc(item.name)}${placeSubtitle(item) ? ` · ${esc(placeSubtitle(item))}` : ''}</p>
      <input id="new-name" class="time-input name-input" value="${esc(item.name)}" spellcheck="false" autocorrect="off" aria-label="Pavadinimas">
      <div class="buttons"><button class="secondary" style="height:52px" data-action="close-sheet">Atšaukti</button>
      <button class="prominent" data-action="confirm-name">Išsaugoti</button></div></div></div>`;
  renderOverlay();
  setTimeout(() => { const i = $('#new-name'); if (i) { i.focus(); i.select(); } }, 30);
}

/* Times are typed as 24-hour HH:MM. The browser's own time field follows the
   system locale and shows "12:53 AM" on an English Windows. */
function readTime(text) {
  let digits = String(text || '').replace(/\D/g, '').slice(0, 4);
  if (digits.length === 3) digits = '0' + digits;
  if (digits.length !== 4) return null;
  const h = Number(digits.slice(0, 2)), m = Number(digits.slice(2));
  return h < 24 && m < 60 ? `${pad(h)}:${pad(m)}` : null;
}

/* Like iOS search: once the field is in use, the title and the voice card
   fold away, the field moves up and "Atšaukti" leads back. */
document.addEventListener('focusin', (event) => {
  if (event.target.id !== 'search' || currentScreen().name !== 'home' || state.searchActive) return;
  state.searchActive = true;
  renderApp();
});

document.addEventListener('input', (event) => {
  const el = event.target;
  if (el.id === 'search') onSearchInput(el.value);
  if (el.id === 'time-value') {
    const digits = el.value.replace(/\D/g, '').slice(0, 4);
    const shown = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
    if (el.value !== shown) el.value = shown;
    const time = readTime(shown);
    if (time && digits.length === 4) state.timeValue = time;
  }
  if (el.dataset && el.dataset.action === 'rename') {
    const place = state.places.find((p) => p.id === el.dataset.id);
    if (place) { place.name = el.value; save(); fillOrigins(); }
  }
});

document.addEventListener('change', (event) => {
  if (event.target.id !== 'time-value') return;
  const time = readTime(event.target.value);
  if (time) state.timeValue = time;
  event.target.value = state.timeValue;
  if (time && currentScreen().name === 'results') runPlan();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { state.islandExpanded = false; state.sheet = null; renderAll(); }
  if (event.key === 'Enter' && event.target.id === 'new-name') actions['confirm-name']();
  if (event.key === 'Enter' && event.target.id === 'time-value') event.target.blur();
  if (event.key === 'Enter' && event.target.id === 'search') {
    const first = currentItems()[0];
    if (first && currentScreen().name === 'home') openDestination(first);
  }
  // The home indicator and the banner are role="button": keys press them too.
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches && event.target.matches('[role="button"][data-action]')) {
    event.preventDefault();
    event.target.click();
  }
});

// Dynamic Island: tap to expand, tap again to collapse.
$('#island').addEventListener('click', (event) => {
  if (event.target.closest('button')) return;
  if (!state.banner || state.locked) return;
  state.islandExpanded = !state.islandExpanded;
  renderIsland();
});

// Swipe up on the lock screen unlocks, like the real thing; the screen
// follows the finger, and springs back if the swipe was too short.
let swipe = null;
const lockEl = $('#lock');
lockEl.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button, .activity')) return;
  swipe = { y: e.clientY, moved: false };
});
lockEl.addEventListener('pointermove', (e) => {
  if (!swipe) return;
  const dy = Math.min(0, e.clientY - swipe.y);
  if (dy < -4) swipe.moved = true;
  if (swipe.moved) lockEl.style.transform = `translateY(${dy}px)`;
});
const endSwipe = (e) => {
  if (!swipe) return;
  const dy = e.clientY - swipe.y;
  const moved = swipe.moved;
  swipe = null;
  if (!moved) return;
  if (dy < -80) { actions.unlock(); return; }
  const from = lockEl.style.transform;
  lockEl.style.transform = '';
  play(lockEl, [{ transform: from }, { transform: 'none' }], 'content');
};
lockEl.addEventListener('pointerup', endSwipe);
lockEl.addEventListener('pointerleave', endSwipe);
lockEl.addEventListener('pointercancel', endSwipe);

// ------------------------------------------------------------------ panel

/* On a phone-sized window the panel sits under the phone, a screen away
   from it. Whatever is done there shows up in the phone, so go back to it —
   and let go of the field, so its focus ring does not hold the page down. */
const stacked = window.matchMedia('(max-width: 800px)');
function showPhone() {
  const active = document.activeElement;
  if (active && active.closest && active.closest('.panel')) active.blur();
  if (stacked.matches && window.scrollY > 0) window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}
$('.panel').addEventListener('click', (event) => { if (event.target.closest('button')) showPhone(); });

$('#speed-buttons').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.speed) {
    setSpeed(Number(button.dataset.speed));
    document.querySelectorAll('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
  }
});
$('#jump-5').addEventListener('click', () => { jumpTo(now().getTime() + 5 * 60_000); renderAll(); });
$('#reset-clock').addEventListener('click', () => {
  jumpTo(Date.now()); setSpeed(1);
  document.querySelectorAll('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.speed === '1')));
  renderAll();
});
$('#jump-stage').addEventListener('click', () => {
  const at = now().getTime();
  if (!state.trip) { jumpTo(at + 5 * 60_000); renderAll(); return; }
  const marks = [];
  state.trip.option.legs.forEach((leg) => { marks.push(t(leg.departure), t(leg.arrival)); });
  const next = marks.filter((m) => m > at + 1000).sort((a, b) => a - b)[0];
  jumpTo((next || at + 5 * 60_000) + 1000);
  renderAll();
});
$('#toggle-lock').addEventListener('click', () => (state.locked ? actions.unlock() : actions.lock()));
$('#toggle-theme').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  store.set('theme', root.dataset.theme);
});
$('#typed-voice').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const text = event.target.value.trim();
  if (!text) return;
  event.target.value = '';
  showPhone();
  stopListening();
  state.interim = text;
  if (state.locked) {
    const b = state.banner;
    const awaiting = b && (b.stage === 'askTime' || (b.stage === 'error' && b.retry === 'askTime')) ? b.place : null;
    if (!b || b.stage === 'trip') state.banner = { stage: 'ask' };
    handleUtterance(text, 'lock', awaiting);
  } else {
    handleUtterance(text, 'app');
  }
});
$('#origin-select').addEventListener('change', (event) => {
  if (event.target.value === '__pick') {
    state.locked = false;
    actions['pick-origin']();
    renderAll();
    fillOrigins();
    showPhone();
    return;
  }
  state.originChoice = event.target.value;
  save(); renderAll(); fillOrigins();
  showPhone();
});
$('#locate').addEventListener('click', () => locate(true));

function fillOrigins() {
  const select = $('#origin-select');
  const options = [['gps', 'Tavo vieta (naršyklė)'], ...state.places.map((p) => [p.id, p.name]), ['__pick', 'Kita vieta…']];
  select.innerHTML = options.map(([value, label]) => `<option value="${esc(value)}"${value === state.originChoice ? ' selected' : ''}>${esc(label)}</option>`).join('');
  const from = origin();
  $('#origin-status').textContent = state.originChoice === 'gps'
    ? (state.gps ? `Naršyklės vieta, tikslumas ±${Math.round(state.gps.accuracy)} m. Kompiuteryje ji gali būti netiksli.`
      : state.locating ? 'Ieškau vietos…' : (state.gpsError ? `${state.gpsError} Pasirink vietą iš sąrašo.` : 'Laukiu naršyklės vietos…'))
    : (from ? `${from.lat.toFixed(4)}, ${from.lon.toFixed(4)}` : '');
}

// ------------------------------------------------------------------- start

(function start() {
  const theme = store.get('theme', null);
  if (theme) document.documentElement.dataset.theme = theme;
  // A trip survives a reload, like a Live Activity survives the app quitting.
  const trip = store.get('trip', null);
  if (trip && new Date(trip.option.arrive.iso).getTime() > Date.now() - 2 * 3600_000) {
    state.trip = { ...trip, option: wholeMinutes(mergeWalks(trip.option)) };
    state.banner = { stage: 'trip' };
  }
  // Once set up, the phone starts locked: the banner is the product, and the
  // app is one swipe away.
  if (state.prefs) state.locked = true;
  fillOrigins();
  renderAll();
  locate(false);

  const poll = async () => {
    try {
      const s = await api('/api/status');
      const status = $('#server-status');
      if (s.ready) {
        const built = s.built_at ? new Date(s.built_at) : null;
        state.dataInfo = `${stopsText(s.stops)} · atnaujinta ${built ? built.toLocaleDateString('lt-LT') : '—'}`;
        status.textContent = `Tvarkaraščiai: ${state.dataInfo}`;
        state.serverReady = true;
        return;
      }
      status.textContent = s.error ? `Klaida: ${s.error}` : 'Kraunami tvarkaraščiai…';
    } catch {
      $('#server-status').textContent = 'Serveris nepasiekiamas. Paleisk: python prototype/server.py';
    }
    setTimeout(poll, 1500);
  };
  poll();
})();
