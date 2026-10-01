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

/* Inside the Expo Go shell (prototype/expo) this page is the phone's whole
   screen: the shell hands it real safe areas, GPS and the compass, and iOS
   draws the status bar and the island itself. ?shell=expo tries the same on
   a desk with an iPhone 15's insets. index.html sets .in-shell before the
   first paint; this is the same test. */
/* The iPhone app (App/Sources/Shell) is the same kind of shell, with
   window.webkit.messageHandlers.vc instead (docs/ios-shell.md). */
const SHELL = window.VC_SHELL
  || (['expo', 'ios'].includes(new URLSearchParams(location.search).get('shell'))
    ? { kind: new URLSearchParams(location.search).get('shell'), insets: { top: 59, right: 0, bottom: 34, left: 0 } } : null);
/* A message to whichever shell holds the page; nothing on a desk. */
function shellPost(message) {
  try {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.vc) window.webkit.messageHandlers.vc.postMessage(JSON.stringify(message));
    else if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  } catch { /* no shell */ }
}
if (SHELL) document.documentElement.classList.add('in-shell');
// Words that differ on a phone: there is no "browser" in an app.
const say = (inShell, onDesk) => (SHELL ? inShell : onDesk);
const themeDark = () => {
  const root = document.documentElement;
  return root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
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
  ticket: '<path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4z"/><path d="M14.5 6.5v11" stroke-dasharray="1.6 2"/>',
  location: '<path d="M3 11 21 3l-8 18-2-8-8-2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  house: '<path d="M4 11 12 4l8 7v9H4z"/><path d="M10 20v-5h4v5"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  stop: '<rect x="6" y="3" width="12" height="9" rx="2"/><path d="M12 12v9"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  map: '<path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4z"/><path d="M9 4v13.5M15 6.5V20"/>',
  // A zebra crossing seen as you walk up to it: stripes across your way.
  crossing: '<path d="M3.5 3v18M20.5 3v18"/><path d="M8 6h8M8 10h8M8 14h8M8 18h8" stroke-width="2.6"/>',
  // The "this time is live" mark transit apps share: a source and two waves.
  live: '<circle cx="6.5" cy="17.5" r="2" class="fill"/><path d="M5 11.5a7.5 7.5 0 0 1 7.5 7.5M5 5a14 14 0 0 1 14 14"/>',
  // The design's symbols (SF Symbols names in the Foundations board).
  clock: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2"/>',
  cap: '<path d="M2.5 9L12 4.5 21.5 9 12 13.5 2.5 9zM6 11.5v4.5c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/>',
  brief: '<path d="M5.5 7.5h13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 13h17"/>',
  sliders: '<path d="M4 8h9M17 8h3M4 16h3M11 16h9M15 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM9 13.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/>',
  tabBus: '<path d="M7 3.5h10a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3zM4 11h16M8 18.5V21M16 18.5V21M8 14.5h.01M16 14.5h.01"/>',
  tabMap: '<path d="M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4zM9 4v14M15 6v14"/>',
  arrow: '<path d="M20 4L4 11l6.5 2.5L13 20z"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
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

// ---------------------------------------------------------------- palettes
//
// The banner sits on the rider's own wallpaper, so it can take one of these
// colourways. Presets, never a colour wheel: each is three colours that were
// chosen together (60-30-10: the base, the ink, one accent) and checked for
// contrast (WCAG: ink 7:1 or more, secondary text 4.5:1, accent 3:1, and a
// red that still reads as a problem on that base). Route colours never
// change, and neither does the map: they mean the same thing everywhere.
const PALETTES = [
  { id: 'grafitas', name: 'Grafitas', base: '#1C1C1E', ink: '#FFFFFF', accent: '#FFFFFF', red: '#FF453A' },
  { id: 'balta', name: 'Balta', base: '#F5F5F7', ink: '#1C1C1E', accent: '#1C1C1E', red: '#D70015' },
  { id: 'smelis', name: 'Smėlis', base: '#E6D8C4', ink: '#33271E', accent: '#8A5E3B', red: '#B00020' },
  { id: 'nude', name: 'Nude', base: '#EAD3C3', ink: '#3E2A22', accent: '#A2604B', red: '#B00020' },
  { id: 'linas', name: 'Linas', base: '#EDE6DA', ink: '#2B2620', accent: '#6F5F4C', red: '#B00020' },
  { id: 'popierius', name: 'Popierius', base: '#FAF6EF', ink: '#1E1A15', accent: '#8C7150', red: '#D70015' },
  { id: 'kakava', name: 'Kakava', base: '#3A2A22', ink: '#F4E8DC', accent: '#D9A77E', red: '#FF6B61' },
  { id: 'gintaras', name: 'Gintaras', base: '#2A1C0F', ink: '#F7E6CC', accent: '#F0A43A', red: '#FF453A' },
  { id: 'molis', name: 'Molis', base: '#7E3B2A', ink: '#FFF1E8', accent: '#F5B899', red: '#FFB0A6' },
  { id: 'salavijas', name: 'Šalavijas', base: '#C8D2BF', ink: '#26301F', accent: '#4F6443', red: '#B00020' },
  { id: 'alyvuoge', name: 'Alyvuogė', base: '#4A4E36', ink: '#F2EFDD', accent: '#D4CF8E', red: '#FFB0A6' },
  { id: 'miskas', name: 'Miškas', base: '#1E3226', ink: '#E6F0E6', accent: '#86C08D', red: '#FF6B61' },
  { id: 'rukas', name: 'Rūkas', base: '#D6DDE4', ink: '#1C2733', accent: '#4C6680', red: '#B00020' },
  { id: 'ledas', name: 'Ledas', base: '#E6EFF6', ink: '#102636', accent: '#336E9C', red: '#D70015' },
  { id: 'jura', name: 'Jūra', base: '#0F3A44', ink: '#E3F1F0', accent: '#62C2C6', red: '#FF8F85' },
  { id: 'naktis', name: 'Naktis', base: '#151C2E', ink: '#E9EDF6', accent: '#93A7D6', red: '#FF453A' },
  { id: 'roze', name: 'Rožė', base: '#DDB9B5', ink: '#3A1E22', accent: '#8E3F4A', red: '#8E0012' },
  { id: 'levanda', name: 'Levanda', base: '#D3CBE6', ink: '#282140', accent: '#5E4E94', red: '#B00020' },
  { id: 'bordo', name: 'Bordo', base: '#4A1620', ink: '#F8E6E9', accent: '#E39AA7', red: '#FF6B61' },
  { id: 'slyva', name: 'Slyva', base: '#3B2340', ink: '#F3E7F5', accent: '#C9A1D6', red: '#FF6B61' },
  { id: 'anglis', name: 'Anglis', base: '#202124', ink: '#F2F2F2', accent: '#C8E86A', red: '#FF453A' },
];
const paletteOf = (id) => PALETTES.find((p) => p.id === id) || PALETTES[0];

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgba = (h, a) => `rgba(${hexRgb(h).join(', ')}, ${a})`;
function luminance(h) {
  const [r, g, b] = hexRgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrastOf = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const bestOn = (fill, choices) => choices.slice().sort((a, b) => contrastOf(b, fill) - contrastOf(a, fill))[0];

/* The banner's colours as custom properties. Grafitas is the banner as it
   always was, to the value; the others derive their secondary text, fills
   and track from their own ink, so three colours are all there is. */
function paletteVars(p) {
  if (p.id === 'grafitas') return {};
  return {
    '--act-bg': rgba(p.base, 0.94), '--act-solid': p.base,
    '--act-ink': p.ink, '--act-ink2': rgba(p.ink, 0.8), '--act-ink3': rgba(p.ink, 0.64),
    '--act-fill': rgba(p.ink, 0.12), '--act-fill2': rgba(p.ink, 0.22), '--act-track': rgba(p.ink, 0.2),
    '--act-accent': p.accent, '--act-on-accent': bestOn(p.accent, [p.ink, p.base, '#000000', '#FFFFFF']),
    '--act-problem': p.red,
  };
}
const varsStyle = (vars) => Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');

function applyPalette() {
  const p = paletteOf(state.palette);
  const lock = $('#lock');
  if (lock) {
    for (const name of ['--act-bg', '--act-solid', '--act-ink', '--act-ink2', '--act-ink3', '--act-fill', '--act-fill2', '--act-track', '--act-accent', '--act-on-accent', '--act-problem']) lock.style.removeProperty(name);
    for (const [k, v] of Object.entries(paletteVars(p))) lock.style.setProperty(k, v);
  }
  applyAppAccent();
}

/* The app takes the colourway as its accent: the buttons that act. Of the
   palette's base and ink, the one that stands out on the page fills the
   button, and the other writes on it, so it reads in light and dark alike.
   Grafitas leaves the system's own black and white. */
function applyAppAccent() {
  const root = document.documentElement;
  const p = paletteOf(state.palette);
  if (p.id === 'grafitas' || p.id === 'balta') {
    root.style.removeProperty('--prominent'); root.style.removeProperty('--on-prominent');
    return;
  }
  const page = themeDark() ? '#1C1C1E' : '#F2F2F7';
  const fill = contrastOf(p.base, page) >= contrastOf(p.ink, page) ? p.base : p.ink;
  root.style.setProperty('--prominent', fill);
  root.style.setProperty('--on-prominent', fill === p.base ? p.ink : p.base);
}

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
  // Live state of rides, by their "trip" reference; null = no vehicle known.
  live: {},
  // What leaves the stops around the origin (see refreshNearby).
  nearby: null,
  // Per saved place, when to leave for it now (see refreshPlaceTimes).
  placeTimes: {},
  // The banner's colourway (see PALETTES).
  palette: store.get('palette', 'grafitas'),
  // The phone's compass, from the Expo Go shell: { deg, at } (see facing).
  compass: SHELL && SHELL.heading && Number.isFinite(SHELL.heading.deg) ? { deg: SHELL.heading.deg, at: SHELL.heading.at || Date.now() } : null,
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
  if (String(state.originChoice).startsWith('city:')) {
    const city = cityNamed(state.originChoice.slice(5));
    return city ? { name: `${city.name} · ${city.stop}`, lat: city.lat, lon: city.lon } : null;
  }
  const place = state.places.find((p) => p.id === state.originChoice);
  return place ? { name: place.name, lat: place.lat, lon: place.lon } : null;
}

/* The five cities, each with a place to start from (its bus station), from
   /api/cities. On a phone the city is simply where you are; on a computer in
   Vilnius the switcher is how Kaunas and Klaipėda get tried at all. */
const cityNamed = (name) => (state.cities || []).find((c) => c.name === name) || null;
// "in Kaunas", "from Kaunas": Lithuanian names change with the case.
const CITY_IN = { Vilnius: 'Vilniuje', Kaunas: 'Kaune', 'Klaipėda': 'Klaipėdoje' };
const cityIn = (name) => CITY_IN[name] || name;

function chooseCity(name) {
  if (!cityNamed(name)) return;
  state.originChoice = `city:${name}`;
  save();
  fillOrigins();
  if (currentScreen().name === 'pick') pop();
  if (currentScreen().name === 'results' && state.destination) runPlan();
  renderAll();
  toast(`Pradžia: ${cityNamed(name).name} · ${cityNamed(name).stop}`);
}

/* Where search should look first: the rider's own city, not always Vilnius. */
function near() {
  const from = origin();
  return from ? { lat: from.lat.toFixed(4), lon: from.lon.toFixed(4) } : {};
}

// ---------------------------------------------------------------- location

const GPS_ERRORS = {
  1: say('Programėlei neleista naudoti tavo vietos.', 'Naršyklė neleidžia šiai svetainei naudoti tavo vietos.'),
  2: say('Telefonas nepateikė vietos.', 'Kompiuteris nepateikė vietos.'),
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

/* Paths are relative to the page ("api/plan", not "/api/plan"): in the Expo
   shell the app is served under /vc/ by the dev server's proxy. */
async function api(path, params) {
  const url = path.replace(/^\//, '') + (params ? '?' + new URLSearchParams(params) : '');
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

async function planTrip(place, mode, time, start = null) {
  const from = start || origin();
  if (!from) {
    const error = new Error(`Nežinau, iš kur keliauji. Leisk ${say('programėlei', 'naršyklei')} nustatyti vietą arba pasirink ją.`);
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

// ------------------------------------------------------------------- live
//
// Where the buses are now: stops.lt's positions, matched to timetable trips
// by the server. They describe the real now, so they are used only while the
// prototype's clock is at it (not at "+5 min" or 10x).

const liveClock = () => Math.abs(now().getTime() - Date.now()) < 90_000;
const refOf = (leg) => (leg && leg.kind === 'ride' && leg.trip ? leg.trip.join('.') : null);
function liveOf(leg) {
  const ref = refOf(leg);
  if (!ref || !liveClock()) return null;
  return ref in state.live ? state.live[ref] : (leg.live || null);
}
const localIsoSec = (d) => `${localIso(d).slice(0, 16)}:${pad(d.getSeconds())}`;
const atMs = (ms) => { const d = new Date(ms); return { iso: localIsoSec(d), hm: hm(d) }; };

/* Where the bus is, drawn: the stops still before yours on a line, the bus
   on it in its own colour, your stop at the end. It moves along as the bus
   does (goal-gradient: the closer, the more it matters) and the words say
   the same, so the picture is never the only way to know. */
const APPROACH_SLOTS = 6;
function approachHtml(leg) {
  const live = liveOf(leg);
  if (!live || live.departed || live.stops_away == null || live.stops_away >= APPROACH_SLOTS) return '';
  const away = live.stops_away;
  const at = ((APPROACH_SLOTS - away) / APPROACH_SLOTS) * 100;
  const ticks = Array.from({ length: APPROACH_SLOTS - 1 }, (_, i) => `<i style="left:${(((i + 1) / APPROACH_SLOTS) * 100).toFixed(1)}%"></i>`).join('');
  const words = liveWords(live, { short: true });
  const text = words.map((w) => (w.problem ? `<span class="problem-text">${esc(w.text)}</span>` : esc(w.text))).join('');
  return `<span class="approach" role="img" aria-label="${esc(`${leg.route.name}: ${words.map((w) => w.text).join(', ')}`)}">
      <span class="approach-track" aria-hidden="true">${ticks}<i class="approach-you"></i><b class="approach-bus" style="left:${at.toFixed(1)}%;background:#${esc(leg.route.color)}"></b></span>
      <span class="approach-text">${text}</span>
    </span>`;
}

/* The trip as the buses are really running. A ride whose vehicle is on the
   road moves by its delay, and everything after it moves with it. The walk
   to the first bus follows that bus, but never by all of a delay: a late bus
   can make up time, so a minute stays as margin, and under two minutes late
   is not worth moving for. An early bus moves it earlier by all of it.
   `firstShift` pins that walk once the rider has set off. A connection the
   new times break is marked `missed`. */
function withLive(option, firstShift = null) {
  if (!option || option.walk_only || !option.legs.some(liveOf)) return option;
  const move = (x, ms) => (ms ? atMs(t(x) + ms) : x);
  const legs = option.legs.map((leg) => {
    const live = liveOf(leg);
    if (!live || live.delay_s == null) return { ...leg };
    const d = live.delay_s * 1000;
    return { ...leg, delay: d, departure: move(leg.departure, d), arrival: move(leg.arrival, d),
      stops: leg.stops.map((stop) => ({ ...stop, time: move(stop.time, d) })) };
  });
  const firstRide = legs.find((l) => l.kind === 'ride');
  const lead = (firstRide && firstRide.delay) || 0;
  const shift = firstShift != null ? firstShift : lead >= 120_000 ? lead - 60_000 : lead <= -30_000 ? lead : 0;
  // Any other walk starts when the leg before it ends. Before another ride
  // it only ever starts later: arriving early does not bring the next bus
  // sooner. (A replanned rest of a trip already starts after the late bus,
  // so it does not move twice.)
  legs.forEach((leg, i) => {
    if (leg.kind !== 'walk') return;
    const gap = i === 0 ? shift : t(legs[i - 1].arrival) - t(leg.departure);
    const d = i === 0 || i === legs.length - 1 ? gap : Math.max(0, gap);
    if (d) legs[i] = { ...leg, departure: move(leg.departure, d), arrival: move(leg.arrival, d) };
  });
  let missed = false;
  for (let i = 1; i < legs.length; i++) {
    if (legs[i].kind === 'ride' && t(legs[i - 1].arrival) > t(legs[i].departure) + 30_000) {
      legs[i].missed = true; missed = true;
    }
  }
  // A bus the operator has called off will not come at all.
  legs.forEach((leg, i) => {
    const live = liveOf(leg);
    if (live && live.cancelled) { legs[i] = { ...leg, cancelled: true, missed: true }; missed = true; }
  });
  return wholeMinutes({ ...option, legs, leave: legs[0].departure, arrive: legs[legs.length - 1].arrival, missed, firstShift: shift });
}

/* What a vehicle on the road means for someone waiting for it, in a few
   words: late or early first (that is the news), then how far away it is.
   `short` keeps only the most useful one. */
function liveWords(live, { short = false } = {}) {
  if (!live) return null;
  if (live.cancelled) return [{ text: 'reisas atšauktas', problem: true }];
  if (live.departed) return [{ text: 'jau nuvažiavo', problem: true }];
  const words = [];
  const late = Math.round((live.delay_s || 0) / 60);
  if (late >= 2) words.push({ text: `vėluoja ${late} min`, problem: true });
  else if (late <= -1) words.push({ text: `${-late} min anksčiau`, problem: true });
  const away = live.stops_away;
  if (away === 0) words.push({ text: 'jau stotelėje' });
  else if (away === 1) words.push({ text: 'atvažiuoja' });
  else if (away > 1 && away <= 20) words.push({ text: `už ${away} ${plural(away, 'stotelės', 'stotelių', 'stotelių')}` });
  if (!words.some((w) => w.problem)) words.unshift({ text: 'laiku' });
  if (short) return [words.find((w) => w.problem) || words[words.length - 1]];
  return words;
}
function liveHtml(leg, options) {
  const words = liveWords(liveOf(leg), options);
  if (!words) return '';
  return `<span class="live">${icon('live')}<span>${words.map((w) => (w.problem ? `<span class="problem-text">${esc(w.text)}</span>` : esc(w.text))).join(' · ')}</span></span>`;
}

/* Keeps a running trip in step with its buses. The first walk is pinned
   once its (moved) start has passed: telling someone already on their way
   to leave two minutes later helps nobody. */
function refreshTripOption() {
  const trip = state.trip;
  if (!trip) return;
  const planned = trip.planned || trip.option;
  const setOff = now().getTime() >= t(trip.option.legs[0].departure);
  trip.option = withLive(planned, setOff ? (trip.option.firstShift || 0) : null);
}

/* The stops a short walk from the origin and what leaves them in the next
   hour: the first thing Trafi users open the app for, here without a tap. */
let nearbyAt = 0;
async function refreshNearby(force = false) {
  const from = origin();
  if (!from || !state.serverReady) return;
  const key = `${from.lat.toFixed(4)},${from.lon.toFixed(4)}`;
  if (!force && state.nearby && state.nearby.key === key && Date.now() - nearbyAt < 25_000) return;
  nearbyAt = Date.now();
  try {
    const data = await api('/api/nearby', { lat: from.lat.toFixed(5), lon: from.lon.toFixed(5), now: localIso(now()) });
    state.nearby = { key, at: now().getTime(), ...data };
    refreshHome();
  } catch { /* the board is a help, not a requirement */ }
}
function refreshHome() {
  if (currentScreen().name !== 'home') return;
  const box = inPage('#home-content');
  if (box) staggerIn(morph(box, homeContent(saveSuggestions())));
  const from = inPage('.home-from span');
  if (from) from.textContent = `Iš: ${originLabel()}`;
}

async function pollLive() {
  if (!state.serverReady) return;
  lastLiveAsk = Date.now();
  openLiveStream();
  const screen = currentScreen().name;
  if (screen === 'home' && !state.locked) { refreshNearby(); refreshPlaceTimes(); }
  if (screen === 'map' && !state.locked) {
    const sel = state.mapSel;
    if (sel && sel.kind === 'stop') api('/api/stop', { id: sel.stop.id, now: localIso(now()) }).then((board) => { if (state.mapSel === sel) { sel.board = board; refreshMapCard(); } }).catch(() => {});
  }
  if (!liveClock()) return;
  const refs = new Set();
  const add = (o) => o && !o.walk_only && o.legs.forEach((l) => { const r = refOf(l); if (r) refs.add(r); });
  if (state.trip) add(state.trip.planned || state.trip.option);
  if (!state.locked && screen === 'results' && state.plan) state.plan.options.slice(0, 5).forEach(add);
  if (!state.locked && screen === 'detail') add(state.selected);
  if (!refs.size) return;
  try {
    const data = await api('/api/live', { legs: [...refs].join(','), now: localIso(now()) });
    Object.assign(state.live, data.legs || {});
  } catch { return; }
  refreshTripOption();
  if (!state.locked && ['results', 'detail'].includes(currentScreen().name)) renderApp();
  drawVehicles();
}
/* The server says the moment new positions are in (server-sent events,
   /api/stream) and the app asks for what it shows right then: a bus moves
   on screen about a second after stops.lt publishes it, not up to ten. The
   timer stays as a safety net: every 15 s while the stream is open, every
   5 s while it is not (EventSource reconnects by itself). */
let liveStream = null, liveSoon = null, lastLiveAsk = 0, lastMapAsk = 0;
function onLiveNews() {
  if (liveSoon) return;
  // One round of asking per 700 ms, however many cities changed at once.
  liveSoon = setTimeout(() => {
    liveSoon = null;
    pollLive();
    if (currentScreen().name === 'map' && !state.locked) { lastMapAsk = Date.now(); loadMapData(); }
  }, Math.max(0, 700 - (Date.now() - lastLiveAsk)));
}
function openLiveStream() {
  if (!window.EventSource || liveStream) return;
  liveStream = new EventSource('api/stream');
  liveStream.addEventListener('live', onLiveNews);
}
const streaming = () => !!liveStream && liveStream.readyState === 1;
setInterval(() => { if (!streaming() || Date.now() - lastLiveAsk > 15_000) pollLive(); }, 5_000);
// The big map's rider and trip every 5 s; its buses with the stream.
setInterval(() => {
  if (currentScreen().name !== 'map' || state.locked) return;
  if (!streaming() || Date.now() - lastMapAsk > 15_000) { lastMapAsk = Date.now(); loadMapData(); }
  drawMe(); drawTripOnMap(); refreshMapCard();
}, 5_000);

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
    settings: settingsView, places: placesView, pick: pickView, map: mapView, guide: guideView, prefs: tripPrefsView,
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
  if (screen.name === 'map') drawBigMap();
  if (screen.name === 'results') settleWheels();
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
    ${state.timeMode !== 'now' ? `<div class="time-row reveal" data-key="time-${state.timeMode}">
      ${wheelsHtml(state.timeValue || hm(new Date(now().getTime() + 30 * 60_000)))}
      <span class="footnote">${state.timeMode === 'arrive' ? 'turi būti vietoje' : 'nori išeiti'}</span>
    </div>` : ''}`;
}

function timeSheetHtml() {
  return `<div class="sheet-backdrop" data-action="time-done"><div class="sheet time-sheet" data-stop="1" role="dialog" aria-label="Kada">
      <i class="grabber" aria-hidden="true"></i>
      <h3>Kada?</h3>
      ${timeControls()}
      <button class="prominent" data-action="time-done">Gerai</button>
    </div></div>`;
}

/* The time, picked like the iPhone's alarm: two wheels, hours and minutes,
   turned with a finger (or the mouse wheel) and settling on the row in the
   band. Nothing to type. The rows tilt away from the band as a drum's do. */
const WHEEL_ROW = 38;
function wheelsHtml(value) {
  const [h, m] = value.split(':').map(Number);
  const column = (kind, count, current, label) => `<div class="wheel-col" data-wheel="${kind}" data-value="${current}" tabindex="0" role="listbox" aria-label="${label}">
      <div class="wheel-pad"></div>${Array.from({ length: count }, (_, i) => `<div class="wheel-item" role="option" data-v="${i}" aria-selected="${i === current}">${pad(i)}</div>`).join('')}<div class="wheel-pad"></div>
    </div>`;
  return `<div class="wheel" data-morph="keep" role="group" aria-label="Laikas">
      <i class="wheel-band" aria-hidden="true"></i>
      ${column('h', 24, h, 'Valandos')}<span class="wheel-colon" aria-hidden="true">:</span>${column('m', 60, m, 'Minutės')}
    </div>`;
}
/* Put each wheel on its value (on first show), and tilt the rows. */
function settleWheels(smooth = false) {
  document.querySelectorAll('.wheel-col').forEach((col) => {
    if (!col.dataset.placed) {
      col.dataset.placed = '1';
      col.scrollTo({ top: Number(col.dataset.value) * WHEEL_ROW, behavior: smooth ? 'smooth' : 'instant' });
    }
    tiltWheel(col);
  });
}
function tiltWheel(col) {
  const middle = col.scrollTop / WHEEL_ROW;
  col.querySelectorAll('.wheel-item').forEach((item, i) => {
    const off = i - middle;
    if (Math.abs(off) > 3.5) { item.style.opacity = 0; return; }
    item.style.transform = `rotateX(${(-off * 20).toFixed(1)}deg)`;
    item.style.opacity = (1 - Math.min(1, Math.abs(off) * 0.28)).toFixed(2);
  });
}
let wheelTimer = null, wheelPlanTimer = null;
document.addEventListener('scroll', (event) => {
  const col = event.target;
  if (!(col instanceof Element) || !col.classList.contains('wheel-col')) return;
  requestAnimationFrame(() => tiltWheel(col));
  clearTimeout(wheelTimer);
  // Once the wheel has come to rest: read both, and plan again.
  wheelTimer = setTimeout(() => {
    const wheel = col.closest('.wheel');
    const read = (kind) => {
      const c = wheel.querySelector(`[data-wheel="${kind}"]`);
      const max = kind === 'h' ? 23 : 59;
      const v = Math.max(0, Math.min(max, Math.round(c.scrollTop / WHEEL_ROW)));
      c.querySelectorAll('.wheel-item').forEach((item, i) => item.setAttribute('aria-selected', String(i === v)));
      return v;
    };
    const value = `${pad(read('h'))}:${pad(read('m'))}`;
    if (value === state.timeValue) return;
    state.timeValue = value;
    clearTimeout(wheelPlanTimer);
    wheelPlanTimer = setTimeout(() => { if (currentScreen().name === 'results' && !state.sheet) runPlan(); }, 250);
  }, 140);
}, true);
// A tap on a row turns the wheel to it; arrows turn it one row.
document.addEventListener('click', (event) => {
  const item = event.target.closest && event.target.closest('.wheel-item');
  if (!item) return;
  item.parentElement.scrollTo({ top: Number(item.dataset.v) * WHEEL_ROW, behavior: 'smooth' });
});
document.addEventListener('keydown', (event) => {
  const col = event.target.closest && event.target.closest('.wheel-col');
  if (!col || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  col.scrollBy({ top: event.key === 'ArrowUp' ? -WHEEL_ROW : WHEEL_ROW, behavior: 'smooth' });
});

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
  const far = draft.walk === 'long';
  return `<div class="content onboard has-cta">
      <div class="steps" aria-hidden="true"><i class="done"></i><i></i></div>
      <h1 class="large">Kaip mėgsti keliauti?</h1>
      <p class="lede">Visada siekiame atvykti kuo greičiau. Pasakyk, ką dėl to galime aukoti.</p>
      ${choice('priority', 'fastest', 'Kuo greičiau', 'Kad ir su persėdimais ar ilgesniu pasivaikščiojimu')}
      ${choice('priority', 'single', 'Vienu autobusu', 'Jei yra, mieliau nepersėsti')}
      ${choice('priority', 'fewest', 'Kuo mažiau persėdimų', 'Verčiau truputį ilgiau, bet ramiau')}
      <div class="toggle-row">
        <span><div class="title">Eiti toliau iki stotelės</div><div class="sub">Kartais greičiausias kelias veda pro ilgesnį pasivaikščiojimą</div></span>
        <button class="switch" role="switch" aria-checked="${far}" data-action="draft-walk" aria-label="Eiti toliau iki stotelės"><i></i></button>
      </div>
      <p class="footnote inset">Pakeisti galėsi bet kada nustatymuose.</p>
      <div class="sticky-bottom"><button class="prominent" data-action="draft-next">Tęsti</button></div>
    </div>`;
}

// ---- the guide: how the banner works, swiped through inside the app

/* Five pages, one thing each, with the thing drawn and moving: the banner on
   the lock screen, its corner button, its map, the island, the lock-screen
   button. Shown once after the first questions, and from Settings. Swiped
   like any iPhone page (or the button, or the arrow keys). Everything the
   banner does is told here, because on the iPhone nothing can be drawn over
   the lock screen to point at it. */
const GUIDE = [
  { key: 'lock', title: 'Baneris užrakintame ekrane', text: 'Pradėjus kelionę, jis visada matomas. Telefono atrakinti nereikia.' },
  { key: 'corner', title: 'Spausk kampą', text: 'Mygtukas kampe keičia puslapius: ką daryti dabar, kryptis ir visas maršrutas.' },
  { key: 'map', title: 'Apvalus žemėlapis', text: 'Paspausk jį ir atsidarys didelis žemėlapis su visu maršrutu ir autobusais.' },
  { key: 'island', title: 'Salelė viršuje', text: 'Kai naudojiesi telefonu, laikas iki autobuso matomas salelėje. Palaikyk ją pirštu ir pamatysi daugiau.' },
  { key: 'control', title: 'Mygtukas užrakintame ekrane', text: 'Palaikyk pirštą ant užrakinto ekrano, pasirink tinkinimą ir apačioje pridėk „Vilnius · Baneris“. Kelionę pradėsi vienu paspaudimu.' },
];
const GUIDE_ROUTE = { name: '46', color: '0073AC', text_color: 'FFFFFF' };

// A little map for the drawings: a few streets, the path, you, the stop.
const guideMap = () => `<span class="g-map" aria-hidden="true"><svg viewBox="0 0 64 64">
    <path class="g-street" d="M-4 40 L70 22 M20 -4 L30 70 M-4 12 L40 4 M44 70 L58 -4"/>
    <path class="g-route" d="M32 34 L27 16 L50 10"/><circle class="g-stop" cx="50" cy="10" r="4"/>
    <path class="g-me" d="M32 28 l5 11 -5 -3 -5 3z"/></svg></span>`;

// The banner as drawn in the guide. `slides` are its pages (the corner page
// turns through them); `ring` marks what a finger taps.
function guideBanner({ slides = [0], ring = '', mini = false } = {}) {
  const pages = [
    `<div class="g-row">${guideMap()}<div class="g-text"><div class="g-title">Išeik 19:37</div>
       <div class="g-meta">${badge(GUIDE_ROUTE, true)}<span>Operos ir baleto teatras</span></div></div>
       <div class="g-hero"><div class="g-cap">liko</div><div class="g-big">1<small>min</small></div></div></div>
     <div class="g-foot">už 7 stotelių</div>`,
    `<div class="g-row">${guideMap()}<div class="g-text"><div class="g-title">↰ Pasuk kairėn</div>
       <div class="g-meta"><span>po 60 m · Vilniaus g.</span></div></div>
       <div class="g-hero"><div class="g-cap">liko</div><div class="g-big">1<small>min</small></div></div></div>
     <div class="g-foot"></div>`,
    `<div class="g-legs"><div><b>19:37</b><span class="g-walk">${icon('walk')}</span>720 m · Operos ir baleto t.</div>
       <div><b>19:49</b>${badge(GUIDE_ROUTE, true)}Žaliasis tiltas</div>
       <div><b>20:13</b><span class="g-walk">${icon('pin')}</span>Akropolis</div></div>
     <div class="g-foot"></div>`,
  ];
  const cycle = slides.length > 1;
  return `<div class="g-banner${mini ? ' mini' : ''}${cycle ? ' cycle' : ''}" aria-hidden="true">
      ${slides.map((p) => `<div class="g-slide">${pages[p]}</div>`).join('')}
      <span class="g-corner${ring === 'corner' ? ' ringed' : ''}"><span class="g-dots"><i></i><i></i><i></i></span></span>
      ${ring === 'map' ? '<span class="g-ring g-ring-map"></span>' : ''}
    </div>`;
}

function guideArt(key) {
  if (key === 'lock') {
    return `<div class="g-phone" aria-hidden="true"><div class="g-date">Rugsėjo 27 d., sekmadienis</div><div class="g-clock">19:36</div>
      ${guideBanner({ mini: true })}<div class="g-controls"><span>${icon('bus')}</span><span>${icon('camera')}</span></div></div>`;
  }
  if (key === 'corner') return guideBanner({ slides: [0, 1, 2], ring: 'corner' });
  if (key === 'map') return guideBanner({ ring: 'map' });
  if (key === 'island') {
    return `<div class="g-island" aria-hidden="true"><span class="g-isl-compact">${badge(GUIDE_ROUTE, true)}<b>3 min</b></span>
      <span class="g-isl-open">${guideMap()}<span class="g-text"><span class="g-title">Išeik 19:37</span>
        <span class="g-meta">${badge(GUIDE_ROUTE, true)}<span>Operos ir baleto t.</span></span></span></span>
      <span class="g-ring g-ring-island"></span></div>`;
  }
  return `<div class="g-phone short" aria-hidden="true"><div class="g-clock small">19:36</div>
    <div class="g-controls"><span class="ours">${icon('bus')}<span class="g-ring g-ring-control"></span></span><span>${icon('camera')}</span></div></div>`;
}

function guideView() {
  const page = Math.min(state.guidePage || 0, GUIDE.length - 1);
  const last = page === GUIDE.length - 1;
  return `<div class="nav">${navBar({ right: `<button class="link-button guide-skip" data-action="guide-done">${last ? '' : 'Praleisti'}</button>` })}</div>
    <div class="guide">
      <div class="guide-track" id="guide-track" data-morph="keep" tabindex="0" aria-label="Kaip naudotis baneriu">
        ${GUIDE.map((p, i) => `<section class="guide-page" aria-label="${i + 1} iš ${GUIDE.length}: ${esc(p.title)}">
          <div class="guide-art art-${p.key}">${guideArt(p.key)}</div>
          <h1 class="guide-title">${esc(p.title)}</h1><p class="guide-text">${esc(p.text)}</p></section>`).join('')}
      </div>
      <div class="guide-foot">
        <div class="guide-dots" aria-hidden="true">${GUIDE.map((_, i) => `<i class="${i === page ? 'on' : ''}"></i>`).join('')}</div>
        <button class="prominent" data-action="guide-next">${last ? 'Pradėti' : 'Toliau'}</button>
      </div>
    </div>`;
}

/* The page the track is on, after a swipe: the dots and the button follow. */
function guideSettle() {
  const track = inPage('#guide-track');
  if (!track) return;
  const page = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  if (page === state.guidePage) return;
  state.guidePage = page;
  const last = page === GUIDE.length - 1;
  inPage('.guide-dots').querySelectorAll('i').forEach((dot, i) => dot.classList.toggle('on', i === page));
  inPage('[data-action="guide-next"]').textContent = last ? 'Pradėti' : 'Toliau';
  inPage('.guide-skip').textContent = last ? '' : 'Praleisti';
}
function guideTo(page) {
  const track = inPage('#guide-track');
  if (track) track.scrollTo({ left: page * track.clientWidth, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
}
document.addEventListener('scroll', (event) => {
  if (event.target instanceof Element && event.target.id === 'guide-track') requestAnimationFrame(guideSettle);
}, true);
document.addEventListener('keydown', (event) => {
  if (currentScreen().name !== 'guide' || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  guideTo(Math.max(0, Math.min(GUIDE.length - 1, (state.guidePage || 0) + (event.key === 'ArrowRight' ? 1 : -1))));
});
// A mouse drags the pages as a finger swipes them; a finger needs nothing.
let guideDrag = null;
document.addEventListener('pointerdown', (event) => {
  const track = event.target.closest && event.target.closest('#guide-track');
  if (!track || event.pointerType !== 'mouse') return;
  guideDrag = { track, x: event.clientX, left: track.scrollLeft, moved: false };
  track.style.scrollSnapType = 'none';
});
document.addEventListener('pointermove', (event) => {
  if (!guideDrag) return;
  const dx = event.clientX - guideDrag.x;
  if (Math.abs(dx) > 4) guideDrag.moved = true;
  guideDrag.track.scrollLeft = guideDrag.left - dx;
});
document.addEventListener('pointerup', (event) => {
  if (!guideDrag) return;
  const { track, x, left } = guideDrag;
  guideDrag = null;
  const w = track.clientWidth, dx = event.clientX - x;
  // A short flick is enough to turn the page, as on the iPhone.
  let page = Math.round(left / w);
  if (dx < -40) page += 1; else if (dx > 40) page -= 1;
  page = Math.max(0, Math.min(GUIDE.length - 1, page));
  track.style.scrollSnapType = '';
  guideTo(page);
});

// ---- home: say it, or type it, or tap a place
//
// The design's Home: where from, the question, the voice card leading, the
// field and "when" under it, the saved places as circles that already know
// when to leave, the stops around you, and the Liquid Glass tab bar.

/* Three tabs. Only the tabs' own screens show the bar; a screen pushed on
   top hides it, as hidesBottomBarWhenPushed does on the iPhone. */
const TABS = [['home', 'tabBus', 'Kelionė'], ['map', 'tabMap', 'Žemėlapis'], ['settings', 'sliders', 'Nustatymai']];
function tabBar(active) {
  return `<nav class="tabbar" aria-label="Skirtukai">${TABS.map(([name, glyph, label]) =>
    `<button class="tab${active === name ? ' on' : ''}" data-action="tab" data-tab="${name}"${active === name ? ' aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span></button>`).join('')}</nav>`;
}
/* A tab's own screen is the only one in the stack. */
const tabRoot = () => state.stack.length === 1;

/* "mano vieta", a saved place's name, or a city: what the trip starts from. */
function originLabel() {
  const from = origin();
  if (!from) return state.originChoice === 'gps' && !state.gpsError ? 'ieškau vietos…' : 'pasirink vietą';
  return state.originChoice === 'gps' ? 'mano vieta' : from.name;
}
/* What the "when" pill says: "Dabar", "Iki 14:20", "Išvyksiu 14:20". */
function timeLabel() {
  if (state.timeMode === 'arrive' && state.timeValue) return `Iki ${state.timeValue}`;
  if (state.timeMode === 'depart' && state.timeValue) return `Išvyksiu ${state.timeValue}`;
  return 'Dabar';
}

function homeView() {
  const open = !!state.searchActive;
  const listening = state.listening === 'app';
  return `<div class="content home-scroll${open ? ' searching' : ''}">
      <div class="collapsible home-head"><div>
        <button class="home-from" data-action="pick-origin">${icon('arrow')}<span>Iš: ${esc(originLabel())}</span></button>
        <h1 class="large home-title">Kur keliausime?</h1>
        <button class="voice-card${listening ? ' on' : ''}" data-action="app-mic" aria-pressed="${listening}" aria-label="${listening ? 'Sustabdyti klausymą' : 'Pasakyti, kur važiuoji'}">
          <span class="voice-disc">${icon('mic')}</span>
          <span class="voice-text"><span class="voice-title">${listening ? 'Klausau…' : 'Pasakyk, kur važiuoji'}</span>
            <span class="voice-sub">${listening ? (state.interim ? `„${esc(state.interim)}“` : 'Sakyk vietą ir laiką') : 'Pvz. „Man reikia į Akropolį 14:20“'}</span></span>
        </button>
      </div></div>
      <div class="search-row">
        <label class="search pill">${icon('search')}<input id="search" type="search" placeholder="Adresas arba vieta" value="${esc(state.query)}" autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off" aria-label="Kur keliauji"></label>
        ${open ? '<button class="pill-button plain" data-action="search-cancel">Atšaukti</button>'
          : `<button class="pill-button" data-action="time-sheet" aria-label="Kada: ${esc(timeLabel())}">${icon('clock')}<span>${esc(timeLabel())}</span></button>`}
      </div>
      <div id="home-content">${open ? `<div id="dock-results">${dockResults()}</div>` : homeContent(saveSuggestions())}</div>
    </div>
    ${tabBar('home')}`;
}

function dockResults() {
  if (state.query.trim().length >= 2) return searchResultsHtml('go');
  return '<p class="footnote dock-hint">Įvesk adresą, vietą ar stotelę. Arba paliesk mikrofoną ir pasakyk, pvz., „Į Akropolį keturiolika dvidešimt“.</p>';
}

/* A saved place is a circle with its answer under it: when to leave, worked
   out before anyone asks. The one to leave for first is filled. One tap
   plans from there; the row is as long as the places are. */
function placeGlyph(p) {
  const name = fold(p.name);
  if (name === 'namai' || p.kind === 'home') return icon('house');
  if (/darb|ofis/.test(name)) return icon('brief');
  if (/mokykl|ism|univers|gimnazij|kolegij|ktu|vgtu|tech|akadem|fakultet/.test(name)) return icon('cap');
  return icon('star');
}
function placeLeave(p) {
  const info = state.placeTimes[p.id];
  const from = origin();
  if (from && straightMetres(from, p) < 250) return { text: 'čia esi' };
  if (!info) return { text: '—' };
  if (info.walk) return { text: `${info.minutes} min`, walk: true };
  if (info.leave < now().getTime() - 30_000) return { text: '—' };
  return { text: hm(new Date(info.leave)), at: info.leave };
}
function placeTiles() {
  const leaves = state.places.map(placeLeave);
  const first = leaves.reduce((best, x, i) => (x.at && (best < 0 || x.at < leaves[best].at) ? i : best), -1);
  const tiles = state.places.map((p, i) => `
      <button class="ptile${i === first ? ' next' : ''}" role="listitem" data-action="go-place" data-id="${p.id}" data-key="${p.id}" aria-label="${esc(p.name)}, išeiti ${esc(leaves[i].text)}">
        <span class="ptile-disc">${placeGlyph(p)}</span>
        <span class="ptile-name">${esc(p.name)}</span>
        <span class="ptile-sub">${leaves[i].walk ? icon('walk') : ''}${esc(leaves[i].text)}</span>
      </button>`).join('');
  return `${tiles}<button class="ptile add" role="listitem" data-action="add-place" data-key="add" aria-label="Pridėti vietą">
      <span class="ptile-disc">${icon('plus')}</span>
      <span class="ptile-name">Nauja</span><span class="ptile-sub">&nbsp;</span>
    </button>`;
}

/* When to leave for each saved place, from wherever the rider is. Planned
   once a minute at most, and only while home is on screen. */
let placeTimesAt = 0;
async function refreshPlaceTimes(force = false) {
  const from = origin();
  if (!from || !state.serverReady || !state.places.length || state.locked) return;
  const key = `${from.lat.toFixed(3)},${from.lon.toFixed(3)}`;
  if (!force && state.placeTimesKey === key && Date.now() - placeTimesAt < 60_000) return;
  placeTimesAt = Date.now();
  state.placeTimesKey = key;
  for (const p of state.places.slice(0, 6)) {
    try {
      const plan = await planTrip(p, 'now', null);
      const o = plan.options.map((x) => withLive(x)).find((x) => !x.walk_only && !x.missed) || plan.options[0];
      state.placeTimes[p.id] = !o ? null : o.walk_only
        ? { walk: true, minutes: o.duration_min }
        : { leave: t(o.leave), route: (o.legs.find((l) => l.kind === 'ride') || {}).route || null };
    } catch { state.placeTimes[p.id] = null; }
  }
  refreshDock();
}

function refreshDock() {
  if (currentScreen().name !== 'home') return;
  const row = inPage('.place-row');
  if (row) morph(row, placeTiles());
}

/* When the phone cannot say where we are, say why and what to do, in the
   app itself — not only in the test panel. */
function locationNotice() {
  if (state.originChoice !== 'gps' || state.gps || !state.gpsError) return '';
  return `<div class="notice reveal" data-key="location-notice" role="status">
      <div class="notice-title"><span class="problem">${icon('location')}</span>Nežinau, kur tu esi</div>
      <p>${esc(state.gpsError)} Patikrink du dalykus:</p>
      <ol>${say(`
        <li><b>Leidimas.</b> iPhone nustatymuose atidaryk programėlę ir leisk naudoti vietą.</li>
        <li><b>Telefonas.</b> Patikrink, ar įjungtas vietos nustatymas.</li>`, `
        <li><b>Naršyklė.</b> Paspausk ženkliuką adreso juostos kairėje ir leisk šiai svetainei naudoti vietą.</li>
        <li><b>Windows.</b> Settings › Privacy &amp; security › Location: įjunk vietos paslaugas ir leisk jomis naudotis darbalaukio programoms.</li>`)}
      </ol>
      <div class="notice-actions">
        <button class="secondary" data-action="locate">${state.locating ? 'Ieškau…' : 'Nustatyti mano vietą'}</button>
        <button class="secondary" data-action="pick-origin">Pasirinkti vietą</button>
      </div>
    </div>`;
}

/* A trip under way sits on top of home: what to do now, one tap to its map. */
function tripCard() {
  const trip = state.trip;
  if (!trip) return '';
  const at = now().getTime();
  const phase = phaseOf(trip, at);
  if (phase.kind === 'arrived') return '';
  const page = bannerNow(trip, phase, at, 'app');
  const right = page.right ? `<span class="tc-right"><span class="cap">${esc(page.right.caption)}</span><span class="tc-num">${esc(page.right.value)}<small>${esc(page.right.unit || '')}</small></span></span>` : '';
  return `<button class="trip-card reveal" data-action="open-trip" data-key="trip-card">
      <span class="tc-left"><span class="cap">${esc(page.caption || '')}${page.captionRoute ? badge(page.captionRoute, true) : ''}</span>
        <span class="tc-title${page.titleKind === 'problem' ? ' problem-text' : ''}">${esc(page.title)}</span><span class="tc-meta">Kelionė į ${esc(trip.place.name)}</span></span>${right}
    </button>`;
}

function homeContent(suggestions) {
  const live = state.nearby && state.nearby.live_available;
  return `
    ${tripCard()}
    ${locationNotice()}
    ${suggestions.map((s) => `<div class="notice reveal" data-key="suggest-${esc(s.key)}">
        <div class="notice-title">${esc(s.name)}</div>
        <p>Dažnai čia važiuoji. Išsaugoti ir pavadinti savaip?</p>
        <div class="notice-actions">
          <button class="secondary" data-action="save-suggestion" data-key-ref="${esc(s.key)}">Išsaugoti</button>
          <button class="secondary" data-action="dismiss-suggestion" data-key-ref="${esc(s.key)}">Ne</button>
        </div></div>`).join('')}
    <div class="heading"><h2>Mano vietos</h2><span class="heading-side">kada išeiti</span></div>
    <div class="place-row" role="list" aria-label="Mano vietos">${placeTiles()}</div>
    <div class="heading"><h2>Šalia tavęs</h2>${live ? `<span class="heading-side">${icon('live')}gyvai</span>` : ''}</div>
    ${boardHtml()}`;
}

/* The stops around the origin, one row each: its name and how far, and the
   next two lines to leave it with their minutes. A tap opens the stop's
   whole board (directions, more times, called-off trips). */
function boardHtml() {
  const from = origin();
  if (!from) return state.gpsError ? '' : skeletonCards(1);
  const n = state.nearby;
  if (!n || n.key !== `${from.lat.toFixed(4)},${from.lon.toFixed(4)}`) return skeletonCards(1);
  const stops = (n.stops || []).filter((stop) => stop.lines.length);
  if (!stops.length) {
    return `<div class="notice reveal" data-key="no-stops">
        <div class="notice-title">Šalia nėra stotelių</div>
        <p>Programėlė planuoja keliones ${AREA}.</p>
        ${(state.cities || []).length ? `<div class="notice-actions">${state.cities.map((c) =>
          `<button class="secondary" data-action="origin-city" data-city="${esc(c.name)}">Pradėti ${esc(cityIn(c.name))}</button>`).join('')}</div>` : ''}
      </div>`;
  }
  const at = now().getTime();
  const next = (stop) => stop.lines.map((l) => {
    const d = l.departures.find((x) => !x.cancelled && new Date(x.iso).getTime() >= at - 30_000);
    return d ? { route: l.route, d, m: Math.max(0, Math.round((new Date(d.iso).getTime() - at) / 60_000)) } : null;
  }).filter(Boolean).sort((a, b) => a.m - b.m)
    // One per line: the same number twice is its two directions.
    .filter((x, i, all) => all.findIndex((y) => y.route.name === x.route.name) === i).slice(0, 2);
  return `<div class="stops-card stagger">${stops.slice(0, 3).map((stop) => {
    const key = `stop-${stop.name}-${stop.metres}`;
    const open = !!(state.openBoards || {})[key];
    return `<div class="stop-row-wrap" data-key="${esc(key)}">
        <button class="stop-row" data-action="toggle-board" data-board="${esc(key)}" aria-expanded="${open}">
          <span class="stop-text"><span class="stop-name">${esc(stop.name)}</span><span class="stop-dist">${metresText(stop.metres)}</span></span>
          <span class="stop-next">${next(stop).map((x) => `<span class="stop-dep">${badge(x.route)}<span class="stop-min">${x.d.live ? icon('live') : ''}${x.m === 0 ? 'dabar' : `${x.m} min`}</span></span>`).join('')}</span>
        </button>
        ${open ? `<div class="stop-board reveal">${stop.lines.slice(0, 6).map(depLine).join('')}</div>` : ''}
      </div>`;
  }).join('')}</div>`;
}

/* A line on a stop's board: badge, direction, the next times in minutes. */
function depLine(l) {
  const at = now().getTime();
  const minutes = (d) => Math.round((new Date(d.iso).getTime() - at) / 60_000);
  const shown = l.departures.filter((d) => minutes(d) >= 0).slice(0, 3);
  if (!shown.length) return '';
  const time = (d, i) => {
    const m = minutes(d);
    if (d.cancelled) return `<s class="off" aria-label="${esc(d.hm)} atšauktas">${m <= 0 ? 'dabar' : m}</s>`;
    return `<span class="${i === 0 ? 'first' : ''}">${d.live && i === 0 ? icon('live') : ''}${m <= 0 ? 'dabar' : m}</span>`;
  };
  const unit = shown.some((d) => minutes(d) > 0) ? '<small>min</small>' : '';
  // A bus that will not come is said in words, not only struck through.
  const gone = shown.filter((d) => d.cancelled);
  const off = gone.length ? `<span class="dep-off">${esc(gone.map((d) => d.hm).join(', '))} ${gone.length === 1 ? 'atšauktas' : 'atšaukti'}</span>` : '';
  return `<div class="dep" data-key="${esc(`${l.route.name}>${l.headsign}`)}">
      ${badge(l.route)}<span class="dep-dir">${esc(l.headsign)}${off}</span>
      <span class="dep-times">${shown.map(time).join('<i>·</i>')}${unit}</span>
    </div>`;
}

/* Placeholders the shape of what is coming: the screen answers at once
   (well inside 400 ms), and nothing jumps when the content lands. */
const skeletonCards = (n) => `<div class="board" role="status" aria-label="Kraunama">${
  Array.from({ length: n }, (_, i) => `<div class="skel skel-card" data-key="skel-${i}"></div>`).join('')}</div>`;

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
  const container = inPage('#dock-results') || inPage('#pick-content');
  const isPick = currentScreen().name === 'pick';
  const dock = inPage('#dock');
  if (dock) dock.classList.toggle('typing', value.trim().length >= 2);
  if (value.trim().length < 2) {
    state.results = [];
    if (container) staggerIn(morph(container, isPick ? pickContent() : dockResults()));
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
    const box = inPage('#dock-results') || inPage('#pick-content');
    if (box) staggerIn(morph(box, searchResultsHtml(currentScreen().name === 'pick' ? 'picked' : 'go')));
  }, 250);
}

/* A saved place hides a search result only when it is the same place: same
   name AND within a few hundred metres. A saved "Akropolis" in Vilnius must
   not hide the Akropolis in Kaunas. */
const samePlace = (a, b) => sameName(a.name, b.name)
  && Math.abs(a.lat - b.lat) < 0.004 && Math.abs(a.lon - b.lon) < 0.006;

function currentItems() {
  const q = state.query.trim();
  const saved = state.places.filter((p) => fold(p.name).includes(fold(q)) || sameName(p.name, q)).map((p) => ({ ...p, saved: true }));
  return [...saved, ...cleanResults(state.results.filter((r) => !saved.some((s) => samePlace(s, r))), q, saved)];
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


function resultsView() {
  const place = state.destination;
  const plan = state.plan;
  const transit = plan && plan.options.some((o) => !o.walk_only);
  let body = '', cta = '';
  if (state.planning) body = resultsSkeleton();
  else if (state.planError) body = `<p class="footnote error-text">${esc(state.planError)}</p>`;
  else if (plan && plan.cross_city && !transit) body = crossCityNotice(plan);
  else if (plan && (!plan.from_city || !plan.to_city) && !transit) body = outOfAreaNotice(plan);
  else if (plan && !plan.options.length) body = '<p class="footnote">Maršruto šiuo laiku nerasta. Pabandyk kitą laiką.</p>';
  else if (plan) {
    // One recommendation, ringed, and the rest as plainer cards: comparing
    // six equal cards is work (Hick's law); choosing to look further is not.
    let shown = plan.options.map((o, index) => ({ ...withLive(o), index }));
    // Asked for "now", a way whose (live) start has passed is not a way:
    // an early bus has made it one you cannot catch.
    if (state.timeMode === 'now' && shown.some((o) => !isLate(o))) shown = shown.filter((o) => !isLate(o));
    const best = shown.find((o) => !isLate(o) && !o.missed) || shown[0];
    const rest = shown.filter((o) => o !== best).sort((a, b) => Number(!!a.missed) - Number(!!b.missed));
    body = `${lateNotice(plan)}<div class="option-list stagger">${chosenCard(best, shown)}${rest.map((o) => optionCard(o, shown)).join('')}</div>`;
    // Going is one tap, at the bottom where the thumb is. It starts the
    // ringed way; any card opens its own steps and map.
    if (!isLate(best) && !best.missed) {
      cta = `<div class="sticky-bottom"><button class="prominent cta" data-action="go-option" data-index="${best.index}">Pradėti kelionę</button></div>`;
    }
  }
  return `<div class="float-bar">
      <button class="glass-circle" data-action="back" aria-label="Atgal">${icon('back')}</button>
      <button class="glass-pill" data-action="time-sheet" aria-label="Kada: ${esc(timeLabel())}">${icon('clock')}<span>${esc(timeLabel())}</span></button>
    </div>
    <div class="content under-float${cta ? ' has-cta' : ''}">
      <h1 class="large title2">${esc(place ? place.name : '')}</h1>
      <div class="from-line">Iš: ${esc(originLabel())}</div>
      ${body}
      ${cta}
    </div>`;
}

/* The way as the design draws it: badges in order with the walks' minutes
   between them, a chevron for each change. */
function routeRow(o) {
  if (o.walk_only) return `<span class="walk-leg">${icon('walk')}${o.duration_min} min pėsčiomis</span>`;
  const parts = [];
  o.legs.forEach((leg) => {
    if (leg.kind === 'ride') parts.push(badge(leg.route));
    else if (leg.metres >= 120) parts.push(`<span class="walk-leg">${icon('walk')}${leg.minutes} min</span>`);
  });
  return parts.join(`<span class="sep">${icon('chevron')}</span>`);
}
const optionChip = (o, all) => {
  const tags = o.missed ? [] : distinctTags(o, all);
  return tags.length ? `<span class="opt-chip">${esc(tags[0])}</span>` : '<span></span>';
};
function optionProblem(o) {
  if (o.legs.some((l) => l.cancelled)) return '<div class="opt-line problem-text">Reisas atšauktas</div>';
  if (o.missed) return '<div class="opt-line problem-text">Persėdimas gali nepavykti: autobusas vėluoja</div>';
  return '';
}

/* The recommended way: when to leave and when you arrive, as clock times,
   the way there, how much walking, and which ticket. */
function chosenCard(o, all) {
  const ride = o.walk_only ? null : o.legs.find((l) => l.kind === 'ride');
  const live = ride ? liveHtml(ride) : '';
  const meta = [o.walk_only ? '' : capital(transfersText(o.transfers)), `${metresText(o.walk_m)} pėsčiomis`].filter(Boolean).join(' · ');
  const ticket = ticketFor(o);
  return `<button class="opt chosen${isLate(o) ? ' late' : ''}" data-action="open-option" data-index="${o.index}" data-key="${esc(o.id)}">
      <div class="opt-head">${optionChip(o, all)}<span class="opt-dur">${o.duration_min} min</span></div>
      <div><div class="cap${isLate(o) ? ' problem-text' : ''}">${isLate(o) ? 'Reikėjo išeiti' : `Išeik ${esc(inText(t(o.leave)))} → atvyksi`}</div>
        <div class="opt-clock">${esc(o.leave.hm)} <span class="arrow">→</span> <span class="${o.late ? 'problem-text' : ''}">${esc(o.arrive.hm)}</span></div></div>
      <div class="opt-route">${routeRow(o)}</div>
      <div class="opt-line">${meta}</div>
      ${live ? `<div class="opt-line">${badge(ride.route, true)}${live}</div>` : ''}
      ${optionProblem(o)}
      ${ticket ? `<div class="opt-ticket">${icon('ticket')}<span>${esc(ticket.what)}${ticket.price ? ` · ${esc(ticket.price)}` : ''}</span></div>` : ''}
    </button>`;
}

function optionCard(o, all) {
  const rides = o.legs.filter((l) => l.kind === 'ride');
  const what = o.walk_only ? 'Pėsčiomis'
    : rides.length === 1 ? { trolleybus: 'Vienas troleibusas', ferry: 'Vienas keltas' }[rides[0].route.category] || 'Vienas autobusas'
      : capital(transfersText(o.transfers));
  return `<button class="opt" data-action="open-option" data-index="${o.index}" data-key="${esc(o.id)}">
      <div class="opt-head">${optionChip(o, all)}<span class="opt-dur">${o.duration_min} min</span></div>
      <div class="opt-row"><span class="opt-clock small${isLate(o) ? ' problem-text' : ''}">${esc(o.leave.hm)} <span class="arrow">→</span> ${esc(o.arrive.hm)}</span>
        <span class="opt-badges">${o.walk_only ? icon('walk') : rides.map((l) => badge(l.route)).join('')}</span></div>
      <div class="opt-line">${what} · ${metresText(o.walk_m)} pėsčiomis</div>
      ${optionProblem(o)}
    </button>`;
}

const resultsSkeleton = () => `<div role="status" aria-label="Ieškau maršrutų">
    <div class="skel skel-hero"></div><div class="skel skel-row"></div><div class="skel skel-row"></div>
  </div>`;

/* When to leave, the way it is said: "po 5 min", "dabar", "18:22". */
function leaveOf(o) {
  if (isLate(o)) return { cap: 'Reikėjo išeiti', big: esc(o.leave.hm), words: 'Reikėjo išeiti', late: true };
  const m = Math.ceil((t(o.leave) - now().getTime()) / 60_000);
  if (m <= 0) return { cap: 'Išeik', big: 'dabar', words: 'dabar' };
  if (m < 60) return { cap: 'Išeik po', big: `${roll(m)}<small>min</small>`, words: `po ${m} min` };
  const day = dayWord(t(o.leave));
  return { cap: `Išeik${esc(day)}`, big: esc(o.leave.hm), words: `${day.trim() ? `${day.trim()} ` : ''}${o.leave.hm}` };
}


/* The destination is in another city. Trips are planned inside a city, by
   its buses, so say that plainly and offer to start there instead. */
function crossCityNotice(plan) {
  const to = plan.to_city, from = plan.from_city;
  const place = state.destination ? state.destination.name : '';
  return `<div class="notice reveal" data-key="cross-city" role="status">
      <div class="notice-title"><span class="problem">${icon('pin')}</span>${esc(place)} yra ${esc(cityIn(to))}</div>
      <p>Programėlė planuoja keliones miesto autobusais, o tu esi ${esc(cityIn(from))}. Kelionių tarp miestų ji neieško.</p>
      ${cityNamed(to) ? `<div class="notice-actions">
        <button class="secondary" data-action="origin-city" data-city="${esc(to)}">Pradėti ${esc(cityIn(to))}</button>
      </div>` : ''}
    </div>`;
}

/* One end is outside the three cities: say where the app works instead of
   a bare "no route", and offer a city to start in when it is the rider who
   is outside. */
const AREA = 'Vilniuje, Kaune ir Klaipėdoje';
function outOfAreaNotice(plan) {
  const place = state.destination ? state.destination.name : '';
  const away = !plan.from_city;
  return `<div class="notice reveal" data-key="out-of-area" role="status">
      <div class="notice-title"><span class="problem">${icon('pin')}</span>${away ? 'Tu esi už miesto ribų' : `${esc(place)}: už miesto ribų`}</div>
      <p>Programėlė planuoja keliones miesto autobusais ${AREA}.</p>
      ${away && (state.cities || []).length ? `<div class="notice-actions">${state.cities.map((c) =>
        `<button class="secondary" data-action="origin-city" data-city="${esc(c.name)}">Pradėti ${esc(cityIn(c.name))}</button>`).join('')}</div>` : ''}
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
    for (const o of state.plan.options) for (const l of o.legs) { const r = refOf(l); if (r) state.live[r] = l.live || null; }
    // Their walking paths, before anyone opens a map of them.
    state.plan.options.slice(0, 3).forEach((o) => fetchWalks(o));
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

// ---- which ticket

/* Which ticket the trip needs, by each city's own rules. The app sells none
   (no operator offers a public way to), but "which one, and where" is half
   of what Trafi's reviews complain about. Checked 2026-09-28 on the
   operators' own pages:
   - Vilnius (judu.lt): 30 min 1,00 €, 60 min 1,25 €, changes free within
     them; sold in the JUDU and m.Ticket apps and on the Vilniečio card.
   - Kaunas (kvt.lt): the Žiogas e-ticket, 0,70 €, with one change within
     30 min; 1,50 € from the driver, one ride.
   - Klaipėda (klaipeda.lt): 1,50 € from the driver, a ticket a ride; less
     with an e-ticket or a bank card at the reader. How much less is not
     said: two sources disagree (1,00 € from 2024, 0,70 € elsewhere). */
const euro = (x) => `${x.toFixed(2).replace('.', ',')} €`;
function ticketFor(o) {
  if (!o || o.walk_only) return null;
  const rides = o.legs.filter((l) => l.kind === 'ride');
  if (!rides.length) return null;
  const start = t(rides[0].departure);
  const minutes = Math.ceil((t(rides[rides.length - 1].arrival) - start) / 60_000);
  if (o.city === 'Vilnius') {
    // A few minutes to spare: a late bus should not outlast the ticket.
    if (minutes <= 25) return { what: `Važiuosi ${minutes} min: užteks 30 min bilieto`, price: euro(1), where: 'JUDU ar m.Ticket programėlėje, Vilniečio kortele' };
    if (minutes <= 55) return { what: `Važiuosi ${minutes} min: reikės 60 min bilieto`, price: euro(1.25), where: 'JUDU ar m.Ticket programėlėje, Vilniečio kortele' };
    return { what: `Važiuosi ${minutes} min: vieno bilieto neužteks`, price: '', where: '60 min bilietas baigsis pakeliui' };
  }
  if (o.city === 'Kaunas') {
    // One e-ticket covers a ride and one change within 30 minutes.
    let tickets = 0, from = -Infinity, changes = 0;
    for (const ride of rides) {
      const at = t(ride.departure);
      if (at - from <= 30 * MINUTE && changes < 1) { changes++; continue; }
      tickets++; from = at; changes = 0;
    }
    const n = tickets === 1 ? 'vieno Žiogo el. bilieto' : `${tickets} Žiogo el. bilietų`;
    return { what: `${tickets === 1 ? 'Užteks' : 'Reikės'} ${n}`, price: euro(0.7 * tickets),
      where: `Žiogo programėlėje ar kortele; pas vairuotoją ${euro(1.5)} už kiekvieną važiavimą` };
  }
  if (o.city === 'Klaipėda') {
    const n = rides.length;
    return { what: n === 1 ? 'Reikės vieno bilieto' : `Reikės ${n} bilietų, po vieną kiekvienam važiavimui`, price: '',
      where: `Pas vairuotoją ${euro(1.5)}; pigiau el. bilietu ar banko kortele prie skaitytuvo` };
  }
  return null;
}
function ticketHtml(o) {
  const ticket = ticketFor(o);
  if (!ticket) return '';
  return `<div class="ticket-row">${icon('ticket')}<span><span class="ticket-what">${esc(ticket.what)}${ticket.price ? ` · ${esc(ticket.price)}` : ''}</span>
      <span class="ticket-where">${esc(ticket.where)}</span></span></div>`;
}

// ---- detail

/* The design's "Trip on the map": the whole screen is the map, the trip a
   sheet over its lower half. Before the trip it previews the way; during
   it, the sheet's top says what to do now, and the step in hand is lit. */
function detailView() {
  if (!state.selected) return homeView();
  const o = withLive(state.selected);
  const planned = state.trip && (state.trip.planned || state.trip.option);
  const running = !!planned && planned.id === state.selected.id && planned.leave.iso === state.selected.leave.iso;
  const at = now().getTime();
  const phase = running ? phaseOf(state.trip, at) : null;
  const current = !phase || phase.kind === 'before' ? -1 : phase.kind === 'arrived' ? o.legs.length : phase.i;

  let head;
  if (running && phase.kind !== 'arrived') {
    head = sheetHead(bannerNow(state.trip, phase, at, 'app'));
  } else if (running) {
    head = `<div class="ts-head"><div class="ts-left"><div class="cap">${esc(state.trip.place.name)}</div><div class="ts-title">Atvykai ${esc(o.arrive.hm)}</div></div></div>`;
  } else {
    head = `<div class="ts-head">
        <div class="ts-left"><div class="cap${isLate(o) ? ' problem-text' : ''}">${isLate(o) ? 'Reikėjo išeiti' : `Išeik ${esc(inText(t(o.leave)))}`}</div>
          <div class="ts-clock">${esc(o.leave.hm)} <span class="arrow">→</span> <span class="${o.late ? 'problem-text' : ''}">${esc(o.arrive.hm)}</span></div>
          <div class="ts-meta">${capital(transfersText(o.transfers))} · ${metresText(o.walk_m)} pėsčiomis</div></div>
        <div class="ts-right"><div class="cap">Kelionė</div><div class="ts-num">${o.duration_min}<small>min</small></div></div>
      </div>`;
  }

  const rows = o.legs.map((leg, i) => {
    const cls = i === current ? ' now' : i < current ? ' done' : '';
    let glyph, text, more = '';
    if (leg.kind === 'ride') {
      const first = i === o.legs.findIndex((l) => l.kind === 'ride');
      glyph = badge(leg.route, true);
      text = first ? `Į ${esc(leg.to.name)} · ${stopsText(leg.stop_count)} · ${leg.minutes || Math.round((t(leg.arrival) - t(leg.departure)) / 60_000)} min`
        : `Persėsk · iki ${esc(leg.to.name)} · ${leg.minutes || Math.round((t(leg.arrival) - t(leg.departure)) / 60_000)} min`;
      if (leg.cancelled) more = '<div class="ts-sub problem-text">Reisas atšauktas</div>';
      else if (leg.missed) more = '<div class="ts-sub problem-text">Gali nespėti: ankstesnis autobusas vėluoja</div>';
      else if (liveOf(leg) && first) more = `<div class="ts-sub">${liveHtml(leg)}</div>`;
      if (state.openStops[i]) more += `<div class="ts-sub stops reveal">${leg.stops.slice(1, -1).map((s) => esc(s.name)).join(' · ')}</div>`;
    } else {
      glyph = icon('walk');
      const move = leg.from.name === leg.to.name && leg.to.stop != null ? sameStopMove(o.legs, i) : null;
      const crosses = walkRoute(leg).crossings || [];
      const marked = crosses.length && crosses.every((c) => c.kind === 'marked');
      const cross = crosses.length ? ` · pereik gatvę${marked ? ' per perėją' : ''}` : '';
      if (move === 'across' || (move && crosses.length && move !== 'same-side')) text = `Pereik gatvę į stotelę „${esc(leg.to.name)}“`;
      else if (move === 'same-side') text = `Eik į stotelę „${esc(leg.to.name)}“ toje pačioje pusėje`;
      else if (leg.to.stop == null) text = `Eik į ${esc(state.destination ? state.destination.name : 'tikslą')} · ${leg.minutes} min${cross}`;
      else text = `Eik į ${esc(leg.to.name)} · ${leg.minutes} min${cross}`;
    }
    const tap = leg.kind === 'ride' && leg.stops.length > 2 ? ` data-action="toggle-stops" data-index="${i}" aria-expanded="${!!state.openStops[i]}"` : '';
    return `<${tap ? 'button' : 'div'} class="ts-step${cls}"${tap}><span class="t">${esc(leg.departure.hm)}</span><span class="glyph">${glyph}</span><span class="text">${text}</span></${tap ? 'button' : 'div'}>${more}`;
  }).join('') + `<div class="ts-step end${current >= o.legs.length ? ' now' : ''}"><span class="t">${esc(o.arrive.hm)}</span><span class="glyph">${icon('pin')}</span><span class="text"><b>${esc(state.destination ? state.destination.name : '')}</b></span></div>`;

  const ticket = ticketFor(o);
  return `<div class="trip-screen">
      <div id="map" class="trip-map" data-morph="keep"></div>
      <div class="float-bar"><button class="glass-circle" data-action="back" aria-label="Atgal">${icon('back')}</button><span></span></div>
      <button class="glass-circle map-locate" data-action="trip-fit" aria-label="Rodyti visą kelionę">${icon('location')}</button>
      <div class="trip-sheet" role="region" aria-label="Kelionė">
        <i class="grabber" aria-hidden="true"></i>
        ${head}
        <div class="ts-steps">${rows}
          ${!running && ticket ? `<div class="opt-ticket">${icon('ticket')}<span>${esc(ticket.what)}${ticket.price ? ` · ${esc(ticket.price)}` : ''}<small>${esc(ticket.where)}</small></span></div>` : ''}
        </div>
        <div class="ts-cta">${running
          ? '<button class="secondary wide" data-action="end-trip">Baigti kelionę</button>'
          : `<button class="prominent" data-action="start-trip"${isLate(o) ? ' disabled' : ''}>Pradėti kelionę</button>`}</div>
      </div>
    </div>`;
}

/* The sheet's top during a trip: the banner's page, in the app's colours. */
function sheetHead(page) {
  const right = page.right ? `<div class="ts-right"><div class="cap">${esc(page.right.caption)}</div><div class="ts-num">${esc(page.right.value)}<small>${esc(page.right.unit || '')}</small></div></div>` : '';
  const kind = page.titleKind === 'clock' ? 'ts-clock' : 'ts-title';
  return `<div class="ts-head">
      <div class="ts-left"><div class="cap">${esc(page.caption || '')}${page.captionRoute ? badge(page.captionRoute, true) : ''}</div>
        <div class="${kind}${page.titleKind === 'problem' ? ' problem-text' : ''}">${esc(page.title)}</div>
        ${page.meta ? `<div class="ts-meta">${metaGlyph(page)}${esc(page.meta)}</div>` : ''}</div>
      ${right}
    </div>`;
}

/* The trip's marks, as the design's map spec draws them: each ride in its
   route's colour on a white casing, walks as dots on the pavement, the stop
   to board on a ring of the route's colour, a change on a black ring, the
   stops between as small rings, and the destination named in a black pill. */
function drawTripMarks(group, o, { label = true } = {}) {
  const bounds = [];
  const ink = themeDark() ? '#F2F2F7' : '#1C1C1E';
  const ground = themeDark() ? '#1C1C1E' : '#FFFFFF';
  o.legs.forEach((leg) => {
    const points = leg.kind === 'ride' ? rideRoute(leg).coords : walkDrawn(leg);
    // The ends still frame the map while a walk's path is on its way.
    bounds.push(...(points || [[leg.from.lat, leg.from.lon], [leg.to.lat, leg.to.lon]]));
    if (!points) return;
    if (leg.kind === 'ride') {
      L.polyline(points, { color: ground, weight: 10, opacity: 1, interactive: false, lineJoin: 'round' }).addTo(group);
      L.polyline(points, { color: `#${leg.route.color}`, weight: 6, opacity: 1, interactive: false, lineJoin: 'round' }).addTo(group);
    } else {
      L.polyline(points, { color: ink, weight: 4, opacity: 0.9, dashArray: '0.1 8', lineCap: 'round', interactive: false }).addTo(group);
    }
  });
  const rides = o.legs.filter((l) => l.kind === 'ride');
  rides.forEach((leg, n) => {
    const colour = `#${leg.route.color}`;
    leg.stops.slice(1, -1).forEach((s) => L.circleMarker([s.lat, s.lon], { radius: 3.5, color: colour, weight: 2, fillColor: ground, fillOpacity: 1, interactive: false }).addTo(group));
    const board = (n === 0)
      ? L.circleMarker([leg.from.lat, leg.from.lon], { radius: 7, color: colour, weight: 3.5, fillColor: ground, fillOpacity: 1, interactive: false })
      : L.circleMarker([leg.from.lat, leg.from.lon], { radius: 8, color: ink, weight: 3.5, fillColor: ground, fillOpacity: 1, interactive: false });
    board.addTo(group);
    if (n === 0) L.circleMarker([leg.from.lat, leg.from.lon], { radius: 2.5, stroke: false, fillColor: colour, fillOpacity: 1, interactive: false }).addTo(group);
    if (n === rides.length - 1) L.circleMarker([leg.to.lat, leg.to.lon], { radius: 6, color: colour, weight: 3, fillColor: ground, fillOpacity: 1, interactive: false }).addTo(group);
  });
  const first = o.legs[0].from, last = o.legs[o.legs.length - 1].to;
  L.circleMarker([first.lat, first.lon], { radius: 6, color: ground, weight: 3, fillColor: ink, fillOpacity: 1, interactive: false }).addTo(group);
  if (label) {
    const name = state.destination ? state.destination.name : last.name;
    L.marker([last.lat, last.lon], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'dest-icon', iconSize: null,
      html: `<span class="dest-pill">${esc(name)} · ${esc(o.arrive.hm)}</span><span class="dest-dot"></span>` }) }).addTo(group);
  }
  return bounds;
}

// ---- the map's look: a quiet ground, so the only colour is the route's
//
// The design's map theme ("Map · layers and marks"): neutral grey land,
// greyed parks and water, white streets with a hairline casing, dashed
// footways, no shops or icons. Drawn by MapLibre from OpenFreeMap's
// OpenMapTiles vector tiles (free, no key), inside Leaflet, so the markers
// and lines stay Leaflet's. Without WebGL the OSM tiles are shown greyed.

const MAP_THEME = {
  light: { land: '#EEEEF0', park: '#DFE7DC', water: '#CFDCE6', building: '#E2E2E7', buildingEdge: '#D5D5DB', minor: '#FFFFFF', major: '#FFFFFF',
    casing: '#D8D8DE', footway: '#A0A0A8', rail: '#C7C7CC', street: '#6E6E73', place: '#1C1C1E', halo: '#EEEEF0', waterName: '#7F8C99' },
  dark: { land: '#232326', park: '#27322B', water: '#1E2B35', building: '#2D2D31', buildingEdge: '#36363B', minor: '#3A3A40', major: '#4B4B52',
    casing: '#1B1B1E', footway: '#7A7A82', rail: '#46464C', street: '#A4A4AB', place: '#F2F2F7', halo: '#232326', waterName: '#6F8290' },
};
const ROADS_MINOR = ['minor', 'service', 'track', 'raceway'];
const ROADS_MAJOR = ['primary', 'secondary', 'tertiary', 'trunk', 'motorway'];
const zoomed = (stops) => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops.flat()];
function mapStyle(dark) {
  const c = MAP_THEME[dark ? 'dark' : 'light'];
  const line = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
  const road = (classes) => ['all', line, ['match', ['get', 'class'], classes, true, false], ['!=', ['get', 'brunnel'], 'tunnel']];
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': c.land } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': c.park } },
      { id: 'green', type: 'fill', source: 'omt', 'source-layer': 'landcover',
        filter: ['match', ['get', 'class'], ['wood', 'grass', 'farmland', 'wetland'], true, false], paint: { 'fill-color': c.park } },
      { id: 'green-use', type: 'fill', source: 'omt', 'source-layer': 'landuse',
        filter: ['match', ['get', 'class'], ['park', 'cemetery', 'pitch', 'playground', 'garden'], true, false], paint: { 'fill-color': c.park } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', filter: ['!=', ['get', 'brunnel'], 'tunnel'], paint: { 'fill-color': c.water } },
      { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': c.water, 'line-width': zoomed([[10, 0.5], [16, 3]]) } },
      { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14,
        paint: { 'fill-color': c.building, 'fill-outline-color': c.buildingEdge } },
      { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', line, ['match', ['get', 'class'], ['rail', 'transit'], true, false]],
        paint: { 'line-color': c.rail, 'line-width': zoomed([[12, 0.6], [17, 2]]) } },
      // Casings first, then fills: one hairline around every street.
      { id: 'minor-casing', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: road(ROADS_MINOR), minzoom: 13,
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.casing, 'line-width': zoomed([[13, 1.5], [16, 7], [18, 18]]) } },
      { id: 'major-casing', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: road(ROADS_MAJOR),
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.casing, 'line-width': zoomed([[10, 1.5], [13, 3.5], [16, 11], [18, 26]]) } },
      { id: 'footway', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 15,
        filter: ['all', line, ['match', ['get', 'class'], ['path'], true, false]],
        paint: { 'line-color': c.footway, 'line-width': zoomed([[15, 1], [18, 2]]), 'line-dasharray': [1.875, 1.875] } },
      { id: 'minor', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: road(ROADS_MINOR), minzoom: 12,
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.minor, 'line-width': zoomed([[12, 0.5], [16, 5], [18, 15]]) } },
      { id: 'major', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: road(ROADS_MAJOR),
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.major, 'line-width': zoomed([[10, 0.8], [13, 2], [16, 8], [18, 22]]) } },
      { id: 'water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name',
        layout: { 'text-field': ['coalesce', ['get', 'name:lt'], ['get', 'name']], 'text-font': ['Noto Sans Italic'], 'text-size': 12, 'symbol-placement': 'line', 'text-letter-spacing': 0.15 },
        paint: { 'text-color': c.waterName, 'text-halo-color': c.water, 'text-halo-width': 1 } },
      { id: 'street-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14,
        filter: ['match', ['get', 'class'], [...ROADS_MINOR, ...ROADS_MAJOR], true, false],
        layout: { 'text-field': ['coalesce', ['get', 'name:lt'], ['get', 'name']], 'text-font': ['Noto Sans Bold'], 'text-size': 10.5, 'symbol-placement': 'line', 'text-max-angle': 30 },
        paint: { 'text-color': c.street, 'text-halo-color': c.minor, 'text-halo-width': 1.5 } },
      { id: 'place-name', type: 'symbol', source: 'omt', 'source-layer': 'place',
        filter: ['match', ['get', 'class'], ['city', 'town', 'suburb', 'quarter', 'neighbourhood', 'village'], true, false],
        layout: { 'text-field': ['coalesce', ['get', 'name:lt'], ['get', 'name']], 'text-font': ['Noto Sans Bold'], 'text-size': ['match', ['get', 'class'], ['city', 'town'], 14, 12], 'text-max-width': 8 },
        paint: { 'text-color': c.place, 'text-halo-color': c.halo, 'text-halo-width': 1.5 } },
    ],
  };
}
const ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
let webglChecked = null;
function hasWebGL() {
  if (webglChecked !== null) return webglChecked;
  try { const c = document.createElement('canvas'); webglChecked = !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { webglChecked = false; }
  return webglChecked;
}
/* The ground under a Leaflet map. The map follows light and dark: a
   theme change swaps the style in place. */
const baseLayers = new Set();
function addBase(leafletMap) {
  leafletMap.attributionControl.setPrefix(false);
  if (window.maplibregl && L.maplibreGL && hasWebGL()) {
    const layer = L.maplibreGL({ style: mapStyle(themeDark()), attribution: ATTRIBUTION, interactive: false });
    layer.addTo(leafletMap);
    layer.vcDark = themeDark();
    baseLayers.add(layer);
    leafletMap.on('unload', () => baseLayers.delete(layer));
    return layer;
  }
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap', className: 'grey-tiles' }).addTo(leafletMap);
}
function restyleMaps() {
  const dark = themeDark();
  for (const layer of baseLayers) {
    if (layer.vcDark === dark) continue;
    try { layer.getMaplibreMap().setStyle(mapStyle(dark)); layer.vcDark = dark; } catch { /* the map is gone */ }
  }
}

let map, mapFor;
function fitTrip(animate = false) {
  if (!map || !map.vcBounds) return;
  const sheet = inPage('.trip-sheet');
  const below = sheet ? sheet.offsetHeight : 0;
  map.fitBounds(map.vcBounds, { paddingTopLeft: [28, 110], paddingBottomRight: [28, below + 28], animate, maxZoom: 17 });
}
function drawMap() {
  const o = state.selected;
  const el = inPage('#map');
  if (!o || !el || !window.L) return;
  if (map && map.getContainer() === el && mapFor === o && map.vcWalks === walksLoaded) return;
  if (map && map.getContainer() === el && mapFor === o) {
    // A walk's path has come: redraw the marks, keep the view.
    map.vcMarks.clearLayers();
    map.vcBounds = drawTripMarks(map.vcMarks, o);
    map.vcWalks = walksLoaded;
    return;
  }
  if (map) { map.remove(); map = null; }
  vehicleLayer = null;
  map = L.map(el, { zoomControl: false, attributionControl: true });
  mapFor = o;
  addBase(map);
  map.vcMarks = L.layerGroup().addTo(map);
  map.vcBounds = drawTripMarks(map.vcMarks, o);
  map.vcWalks = walksLoaded;
  fitTrip();
  // The page slides in; once it has, the map knows its size.
  setTimeout(() => { if (map) { map.invalidateSize(); fitTrip(); } }, 480);
  drawVehicles();
}

/* The trip's buses where they are now, as their own badge. Moved, not
   redrawn, when a new position comes in, so they glide along the street. */
let vehicleLayer = null;
const vehicleMarkers = {};
function drawVehicles() {
  if (!map || !window.L || currentScreen().name !== 'detail' || !state.selected) return;
  if (!vehicleLayer) {
    vehicleLayer = L.layerGroup().addTo(map);
    Object.keys(vehicleMarkers).forEach((k) => delete vehicleMarkers[k]);
  }
  const seen = new Set();
  state.selected.legs.forEach((leg) => {
    const live = liveOf(leg), ref = refOf(leg);
    if (!live || live.lat == null || live.departed === undefined) return;
    seen.add(ref);
    const known = vehicleMarkers[ref];
    if (known) { follow(known, live); return; }
    const html = `<span class="bus-marker" style="background:#${esc(leg.route.color)};color:#${esc(leg.route.text_color)}">${esc(leg.route.name)}</span>`;
    const at = ahead(live);
    vehicleMarkers[ref] = L.marker([at.lat, at.lon], {
      icon: L.divIcon({ className: 'bus-icon', html, iconSize: null }), keyboard: false, interactive: false,
    }).addTo(vehicleLayer);
    follow(vehicleMarkers[ref], live);
  });
  Object.keys(vehicleMarkers).forEach((ref) => {
    if (!seen.has(ref)) { vehicleLayer.removeLayer(vehicleMarkers[ref]); delete vehicleMarkers[ref]; }
  });
}

// ---- the map: stops, the buses on the road, and a pin to go anywhere

/* The city as a map, opened from home. Stops appear once zoomed in close
   enough to tell them apart; the buses in service move on it in their own
   colours. Tap a stop: what leaves it. Tap anywhere else: a pin, its
   address, and "Keliauti čia". The card sits at the bottom, under the
   thumb. The map's own colours never change with the banner's palette. */
function mapView() {
  const root = tabRoot();
  return `<div class="map-screen">
      <div id="bigmap" class="bigmap" data-morph="keep"></div>
      ${root ? '' : `<div class="float-bar"><button class="glass-circle" data-action="back" aria-label="Atgal">${icon('back')}</button><span></span></div>`}
      <div class="map-card${root ? ' above-tabs' : ''}" id="map-card">${mapCard()}</div>
    </div>
    ${root ? tabBar('map') : ''}`;
}

function mapCard() {
  const sel = state.mapSel;
  const me = `<button class="map-me" data-action="map-me" aria-label="Rodyti mano vietą">${icon('location')}</button>`;
  const from = origin();
  const away = (p) => (from ? ` · ${metresText(Math.round(straightMetres(from, p) * 1.3))} pėsčiomis` : '');
  if (!sel && state.trip) {
    // A trip under way: where it goes next, and what to do there.
    const at = now().getTime();
    const phase = phaseOf(state.trip, at);
    const w = waypointOf(state.trip, phase);
    if (w) {
      let line = '';
      if (phase.kind === 'wait') line = `${badge(w.ride.route, true)} išvyksta ${esc(w.ride.departure.hm)}`;
      else if (phase.kind === 'ride') line = `${badge(w.ride.route, true)} išlipsi ${esc(w.ride.arrival.hm)}`;
      else {
        const g = guidance(state.trip, phase, at);
        line = `${metresText(g.metres)} pėsčiomis${w.ride ? ` · ${badge(w.ride.route, true)} išvyksta ${esc(w.ride.departure.hm)}` : ` · atvyksi ${esc(state.trip.option.arrive.hm)}`}`;
      }
      return `${me}<div class="map-card-head"><span class="glyph">${icon('pin')}</span>
          <div class="main"><div class="title">${esc(w.label)}</div><div class="sub trip-line">${line}</div></div></div>
        <button class="secondary map-go" data-action="lock">Rodyti banerį</button>`;
    }
  }
  if (!sel) {
    return `${me}<p class="map-hint">${state.mapTooWide ? 'Priartink, kad matytum stoteles.' : 'Paliesk stotelę arba bet kurią vietą.'}</p>`;
  }
  if (sel.kind === 'pin') {
    return `${me}<div class="map-card-head"><span class="glyph">${icon('pin')}</span>
        <div class="main"><div class="title">${esc(sel.name || (sel.naming ? 'Ieškau adreso…' : 'Pažymėta vieta'))}</div><div class="sub">Pažymėta vieta${away(sel)}</div></div></div>
      <button class="prominent" data-action="map-go">Keliauti čia</button>`;
  }
  const board = sel.board;
  const lines = board ? board.lines.slice(0, 4).map(depLine).join('') : '';
  return `${me}<div class="map-card-head"><span class="glyph">${icon('stop')}</span>
      <div class="main"><div class="title">${esc(sel.stop.name)}</div><div class="sub">Stotelė${away(sel.stop)}${board && board.live ? ' · realiu laiku' : ''}</div></div></div>
    <div class="map-deps">${!board ? '<div class="skel skel-row"></div>' : lines || '<p class="footnote">Artimiausią valandą iš čia nieko neišvyksta.</p>'}</div>
    <button class="secondary map-go" data-action="map-go">Keliauti čia</button>`;
}

function refreshMapCard() {
  const card = inPage('#map-card');
  if (card && currentScreen().name === 'map') morph(card, mapCard());
}

let bigmap = null, bigLayers = null, busMarkers = {}, mapLoadTimer = null, lastLayerClick = 0;
let meMarker = null, meRing = null;

/* Where the rider is on the big map: the phone's fix with its accuracy as a
   faint circle; during a trip without one, where the timetable puts them. */
function mePoint() {
  const fix = gpsFix() || (state.originChoice === 'gps' ? state.gps : null);
  if (fix) return { lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy };
  if (state.trip) {
    const at = now().getTime();
    const phase = phaseOf(state.trip, at);
    if (phase.kind !== 'arrived') { const g = guidance(state.trip, phase, at); return { lat: g.here.lat, lon: g.here.lon, accuracy: 0 }; }
  }
  const from = origin();
  return from ? { lat: from.lat, lon: from.lon, accuracy: 0 } : null;
}
function drawMe() {
  if (!bigmap || !bigLayers) return;
  const me = mePoint();
  if (!me) return;
  if (!meMarker) {
    meRing = L.circle([me.lat, me.lon], { radius: me.accuracy || 1, stroke: false, fillColor: '#1C1C1E', fillOpacity: 0.12, interactive: false }).addTo(bigLayers.me);
    meMarker = L.circleMarker([me.lat, me.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#1C1C1E', fillOpacity: 1, interactive: false }).addTo(bigLayers.me);
    return;
  }
  glideTo(meMarker, me.lat, me.lon, 900);
  meRing.setLatLng([me.lat, me.lon]).setRadius(me.accuracy || 1);
}

/* The next place the trip goes: the stop to walk to, the stop to get off
   at, or the destination. The big map marks it and says what it is. */
function waypointOf(trip, phase) {
  if (phase.kind === 'arrived') return null;
  const legs = trip.option.legs;
  const leg = phase.kind === 'before' ? legs[0] : phase.leg;
  if (phase.kind === 'wait') return { lat: leg.from.lat, lon: leg.from.lon, label: leg.from.name, color: leg.route.color, ride: leg };
  if (leg.kind === 'ride') return { lat: leg.to.lat, lon: leg.to.lon, label: `Išlipk: ${leg.to.name}`, color: leg.route.color, ride: leg };
  const ride = leg.to.stop != null ? nextRide(legs, (phase.i ?? -1) + 1) : null;
  return { lat: leg.to.lat, lon: leg.to.lon, label: leg.to.stop == null ? trip.place.name : leg.to.name, color: ride ? ride.route.color : null, ride };
}
let tripDrawn = '';
function drawTripOnMap(fit = false) {
  if (!bigmap || !bigLayers) return;
  const trip = state.trip;
  const at = now().getTime();
  const phase = trip ? phaseOf(trip, at) : null;
  const w = trip ? waypointOf(trip, phase) : null;
  const key = trip ? `${trip.option.id}|${trip.option.leave.iso}|${w ? w.label : ''}|${walksLoaded}` : '';
  if (key === tripDrawn && !fit) return;
  tripDrawn = key;
  bigLayers.trip.clearLayers();
  if (!trip) return;
  drawTripMarks(bigLayers.trip, trip.option, { label: false });
  if (!w) return;
  L.circleMarker([w.lat, w.lon], { radius: 11, color: w.color ? `#${w.color}` : '#1C1C1E', weight: 4, fillColor: '#fff', fillOpacity: 1, interactive: false })
    .bindTooltip(esc(w.label), { permanent: true, direction: 'top', offset: [0, -12], className: 'waypoint-tip' }).addTo(bigLayers.trip);
  if (fit) {
    const me = mePoint();
    const box = L.latLngBounds([[w.lat, w.lon], ...(me ? [[me.lat, me.lon]] : [])]);
    bigmap.fitBounds(box.pad(0.45), { maxZoom: 17, animate: false });
  }
}
function drawBigMap() {
  const el = inPage('#bigmap');
  if (!el || !window.L) return;
  if (bigmap && bigmap.getContainer() === el) return;
  if (bigmap) { bigmap.remove(); bigmap = null; }
  const from = origin() || { lat: 54.6872, lon: 25.2797 };
  bigmap = L.map(el, { zoomControl: false, attributionControl: true, preferCanvas: true }).setView([from.lat, from.lon], 16);
  addBase(bigmap);
  bigLayers = { trip: L.layerGroup().addTo(bigmap), stops: L.layerGroup().addTo(bigmap), buses: L.layerGroup().addTo(bigmap), marks: L.layerGroup().addTo(bigmap), me: L.layerGroup().addTo(bigmap) };
  busMarkers = {};
  meMarker = null; meRing = null;
  drawMe();
  drawTripOnMap(true);
  bigmap.on('moveend', () => { clearTimeout(mapLoadTimer); mapLoadTimer = setTimeout(loadMapData, 250); });
  bigmap.on('click', (e) => { if (Date.now() - lastLayerClick > 350) dropPin(e.latlng.lat, e.latlng.lng); });
  // The page slides in; once it has, the map knows its real size and asks
  // for everything that size shows.
  setTimeout(() => { if (bigmap) { bigmap.invalidateSize(); loadMapData(); } }, 480);
  loadMapData();
}

async function loadMapData() {
  if (!bigmap || currentScreen().name !== 'map') return;
  const b = bigmap.getBounds();
  const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((v) => v.toFixed(5)).join(',');
  try {
    const [stops, buses] = await Promise.all([api('/api/stops', { bbox }), api('/api/vehicles', { bbox, now: localIso(now()) })]);
    if (!bigmap) return;
    const wasWide = state.mapTooWide;
    state.mapTooWide = !!stops.too_wide;
    drawStops(stops.stops || []);
    drawBuses(buses.vehicles || []);
    if (!state.mapSel && wasWide !== state.mapTooWide) refreshMapCard();
  } catch { /* the map still pans; the next move asks again */ }
}

function drawStops(stops) {
  bigLayers.stops.clearLayers();
  for (const stop of stops) {
    const chosen = state.mapSel && state.mapSel.kind === 'stop' && state.mapSel.stop.id === stop.id;
    L.circleMarker([stop.lat, stop.lon], {
      radius: chosen ? 8 : 5, color: '#3A3A3C', weight: chosen ? 3 : 2, fillColor: '#fff', fillOpacity: 1,
    }).on('click', () => { lastLayerClick = Date.now(); selectStop(stop); }).addTo(bigLayers.stops);
  }
}

function drawBuses(list) {
  const seen = new Set();
  for (const v of list) {
    seen.add(v.key);
    const known = busMarkers[v.key];
    if (known) { follow(known, v); continue; }
    const html = `<span class="bus-marker" style="background:#${esc(v.color)};color:#${esc(v.text_color)}">${esc(v.route)}</span>`;
    const at = ahead(v);
    busMarkers[v.key] = L.marker([at.lat, at.lon], {
      icon: L.divIcon({ className: 'bus-icon', html, iconSize: null }), keyboard: false, interactive: false,
    }).addTo(bigLayers.buses);
    follow(busMarkers[v.key], v);
  }
  for (const key of Object.keys(busMarkers)) {
    if (!seen.has(key)) { bigLayers.buses.removeLayer(busMarkers[key]); delete busMarkers[key]; }
  }
}

async function selectStop(stop) {
  state.mapSel = { kind: 'stop', stop, board: null };
  bigLayers.marks.eachLayer((layer) => { if (layer.options && layer.options.pin) bigLayers.marks.removeLayer(layer); });
  refreshMapCard();
  loadMapData();
  try {
    const board = await api('/api/stop', { id: stop.id, now: localIso(now()) });
    if (state.mapSel && state.mapSel.stop === stop) { state.mapSel.board = board; refreshMapCard(); }
  } catch { if (state.mapSel && state.mapSel.stop === stop) { state.mapSel.board = { lines: [] }; refreshMapCard(); } }
}

async function dropPin(lat, lon) {
  const sel = { kind: 'pin', lat, lon, name: null, naming: true };
  state.mapSel = sel;
  bigLayers.marks.eachLayer((layer) => { if (layer.options && layer.options.pin) bigLayers.marks.removeLayer(layer); });
  L.marker([lat, lon], { pin: true, interactive: false, keyboard: false,
    icon: L.divIcon({ className: 'pin-icon', html: `<span class="map-pin">${icon('pin')}</span>`, iconSize: null }) }).addTo(bigLayers.marks);
  refreshMapCard();
  try {
    const found = await api('/api/reverse', { lat: lat.toFixed(6), lon: lon.toFixed(6) });
    if (state.mapSel === sel) { sel.name = found.name; sel.naming = false; refreshMapCard(); }
  } catch { if (state.mapSel === sel) { sel.naming = false; refreshMapCard(); } }
}

// ---- settings, places, pick

/* The colourway: the banner as the lock screen will show it, on the lock
   screen's own ground, and the 21 presets as small swatches under it: the
   base, the ink as a bar, the accent as a dot. */
function paletteSection() {
  const chosen = paletteOf(state.palette);
  const sample = {
    stage: 'countdown', caption: 'Išeik', title: '13:52', titleKind: 'clock',
    right: { caption: 'Liko', value: '12', unit: 'min' },
    foot: { routes: [{ name: '3G', color: '008000', text: 'FFFFFF' }, { name: '2', color: 'DC3131', text: 'FFFFFF' }], text: 'ISM 14:20' },
  };
  const dots = '<span class="pager-dots static" aria-hidden="true"><span class="pdots"><i class="on"></i><i></i><i></i></span></span>';
  return `<div class="section-label">Banerio spalva</div>
    <div class="palette-stage" data-key="palette-${chosen.id}">
      <div class="activity trip palette-card" style="${varsStyle(paletteVars(chosen))}${chosen.id === 'grafitas' ? ';--act-bg:#1C1C1E' : ''}">
        <div class="act-body">${bannerHtml(sample)}</div><div class="act-pager">${dots}</div></div>
    </div>
    <div class="palettes" role="radiogroup" aria-label="Banerio spalva">
      ${PALETTES.map((p) => `<button class="swatch" role="radio" aria-checked="${p.id === chosen.id}" aria-label="${esc(p.name)}" data-action="palette" data-id="${p.id}" data-key="sw-${p.id}" style="background:${p.base}">
          <i class="sw-ink" style="background:${p.ink}"></i><i class="sw-accent" style="background:${p.accent};box-shadow:0 0 0 2px ${p.base}"></i>
        </button>`).join('')}
    </div>
    <p class="footnote">${esc(chosen.name)}. Autobusų spalvos ir žemėlapis nesikeičia: visur reiškia tą patį.</p>`;
}

const PRIORITY_WORDS = { fastest: 'Kuo greičiau', single: 'Vienu autobusu', fewest: 'Kuo mažiau persėdimų' };
function settingsView() {
  const root = tabRoot();
  return `${root ? '' : `<div class="nav">${navBar({ back: true, title: 'Nustatymai' })}</div>`}
    <div class="content${root ? ' tab-content' : ''}">
      <h1 class="large">Nustatymai</h1>
      ${paletteSection()}
      <div class="group tall">
        <button class="row" data-action="places"><span class="main"><div class="title">Mano vietos</div></span><span class="trail">${state.places.length}${icon('chevron')}</span></button>
        <button class="row" data-action="trip-prefs"><span class="main"><div class="title">Kelionės nuostatos</div></span><span class="trail">${esc(PRIORITY_WORDS[state.prefs.priority] || '')}${icon('chevron')}</span></button>
        <button class="row" data-action="guide"><span class="main"><div class="title">Kaip veikia baneris</div></span><span class="trail">${icon('chevron')}</span></button>
      </div>
      <div class="group tall">
        <button class="row" data-action="pick-origin"><span class="main"><div class="title">Iš kur keliauji</div></span><span class="trail">${esc(originLabel())}${icon('chevron')}</span></button>
        <button class="row" data-action="tips-reset"><span class="main"><div class="title">Rodyti patarimus iš naujo</div></span></button>
        ${SHELL ? `<button class="row" data-action="test-panel"><span class="main"><div class="title">Bandymų pultas</div><div class="sub">Laikas, užrakintas ekranas, tema, balsas raštu</div></span></button>
        <button class="row" data-action="lock"><span class="main"><div class="title">Užrakinto ekrano peržiūra</div></span></button>` : ''}
        ${SHELL && SHELL.kind === 'ios' ? '<button class="row" data-action="native-diagnostics"><span class="main"><div class="title">Diagnostika</div></span><span class="trail">' + icon('chevron') + '</span></button>' : ''}
      </div>
      <p class="footnote" id="data-info">${esc(state.dataInfo || '')}</p>
      <div style="margin-top:20px"><button class="secondary wide" data-action="reset">Pradėti iš naujo</button></div>
    </div>
    ${root ? tabBar('settings') : ''}`;
}

/* How to travel, one screen: what to give up for speed, and how far to walk. */
function tripPrefsView() {
  const p = state.prefs;
  const choice = (key, value, title, sub) =>
    `<button class="choice" data-action="pref" data-pref="${key}" data-value="${value}" aria-pressed="${p[key] === value}">
       <span><div class="title">${title}</div><div class="sub">${sub}</div></span><span class="tick">${icon('check')}</span></button>`;
  return `<div class="nav">${navBar({ back: true, title: 'Kelionės nuostatos' })}</div>
    <div class="content">
      <h1 class="large title2">Kelionės nuostatos</h1>
      <div class="section-label">Kas svarbiausia</div>
      ${choice('priority', 'fastest', 'Kuo greičiau', 'Kad ir su persėdimais ar ilgesniu pasivaikščiojimu')}
      ${choice('priority', 'single', 'Vienu autobusu', 'Jei yra, mieliau nepersėsti')}
      ${choice('priority', 'fewest', 'Kuo mažiau persėdimų', 'Verčiau truputį ilgiau, bet ramiau')}
      <div class="section-label">Ėjimas iki stotelės</div>
      ${choice('walk', 'short', 'Kuo mažiau', 'Iki 400 m')}
      ${choice('walk', 'normal', 'Įprastai', 'Iki 800 m')}
      ${choice('walk', 'long', 'Galiu ir toliau', 'Iki 1,5 km')}
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
  let gpsSub = `Paliesk, kad ${say('telefonas', 'naršyklė')} nustatytų`;
  if (state.locating) gpsSub = 'Ieškau…';
  else if (state.gps) gpsSub = `Pagal ${say('telefoną', 'naršyklę')}, tikslumas ±${Math.round(state.gps.accuracy)} m`;
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
    ${(state.cities || []).length ? `<div class="heading"><h2>Kitas miestas</h2></div>
    <div class="group stagger">
      ${state.cities.map((c) => `<button class="row" data-action="origin-city" data-city="${esc(c.name)}" data-key="city-${esc(c.name)}"><span class="lead">${icon('bus')}</span>
        <span class="main"><div class="title">${esc(c.name)}</div><div class="sub">${esc(c.stop)} · ${c.stops} stotelės</div></span>
        <span class="trail check">${state.originChoice === `city:${c.name}` ? icon('check') : ''}</span></button>`).join('')}
    </div>` : ''}
    <p class="footnote">${say('Patalpose', 'Kompiuteryje naršyklės')} vieta gali būti netiksli. Tada geriau pasirinkti vietą iš sąrašo arba surasti ją paieškoje.</p>`;
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
  state.trip = { option: withLive(option), planned: option, place, startedAt: now().getTime(), snoozeUntil: 0, page: 0 };
  fetchWalks(option);
  state.banner = { stage: 'trip' };
  store.set('trip', state.trip);
  recordVisit(place);
  state.islandExpanded = false;
  renderAll();
}

async function replanTrip() {
  const trip = state.trip;
  if (!trip || state.replanning) return;
  const legs = trip.option.legs;
  const first = legs.findIndex((l) => l.kind === 'ride');
  const k = legs.findIndex((l, i) => l.cancelled || (l.missed && i !== first));
  if (k < 1) return;
  const before = legs[k - 1];
  // The first bus called off: from wherever the trip starts, not its stop.
  const from = k === first ? legs[0].from : before.to;
  const start = { name: from.name, lat: from.lat, lon: from.lon };
  state.replanning = true;
  renderAll();
  try {
    const plan = await planTrip(trip.place, 'depart', hm(new Date(t(before.arrival))), start);
    const next = plan.options.find((o) => !o.walk_only) || plan.options[0];
    if (!next) throw new Error('Kito kelio nerasta.');
    const planned = trip.planned || trip.option;
    const kept = planned.legs.slice(0, k);
    const joined = [...kept, ...next.legs];
    const rides = joined.filter((l) => l.kind === 'ride');
    trip.planned = wholeMinutes({
      ...planned, id: `${planned.id}~${next.id}`, legs: joined, arrive: next.arrive,
      transfers: Math.max(0, rides.length - 1), routes: rides.map((l) => l.route),
      walk_m: joined.filter((l) => l.kind === 'walk').reduce((sum, l) => sum + l.metres, 0),
    });
    for (const l of next.legs) { const r = refOf(l); if (r) state.live[r] = l.live || null; }
    refreshTripOption();
    fetchWalks(trip.planned);
    store.set('trip', state.trip);
    toast(`Naujas kelias: atvyksi ${state.trip.option.arrive.hm}`);
  } catch (e) {
    toast(e.message);
  }
  state.replanning = false;
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


/* The map turns the short way round: 350° to 10° is 20°, not 340°. */
const needleTurns = {};
function needleAngle(where, deg) {
  const prev = needleTurns[where];
  if (prev == null) return (needleTurns[where] = deg);
  const delta = ((((deg - prev) % 360) + 540) % 360) - 180;
  return (needleTurns[where] = prev + delta);
}

// ---- walking directions: the street path, its turns, a map that turns with you

/* Each walk gets its real path along footways, pavements, yards and
   crossings (/api/walk, OpenStreetMap's foot router), asked for as soon as a
   plan is on screen, so it is there before the map is. Until it arrives, or
   without the internet, the walk is not drawn at all (a straight line would
   cut through buildings), and the arrow says "tiesiai": nothing invented. */
const walkRoutes = {};
const walkAsked = {};
let walksLoaded = 0;
const WALK_STRAIGHT_M = 15;     // shorter than this, a straight line is the path
const walkKey = (leg) => `${leg.from.lat.toFixed(5)},${leg.from.lon.toFixed(5)}>${leg.to.lat.toFixed(5)},${leg.to.lon.toFixed(5)}`;
function fetchWalks(option) {
  if (!option || !option.legs) return Promise.resolve();
  return Promise.all(option.legs.map((leg) => {
    if (leg.kind !== 'walk' || leg.metres < WALK_STRAIGHT_M) return null;
    const key = walkKey(leg);
    if (!walkAsked[key]) {
      walkRoutes[key] = null;
      walkAsked[key] = api('/api/walk', { from: `${leg.from.lat},${leg.from.lon}`, to: `${leg.to.lat},${leg.to.lon}` })
        .then((route) => { walkRoutes[key] = route; walksLoaded++; }).catch(() => {});
    }
    return walkAsked[key];
  }));
}
/* A walk as drawn on a map: its street path, or nothing yet. */
function walkDrawn(leg) {
  const real = walkRoutes[walkKey(leg)];
  if (real) return real.coords;
  return leg.metres < WALK_STRAIGHT_M ? [[leg.from.lat, leg.from.lon], [leg.to.lat, leg.to.lon]] : null;
}
function straightRoute(a, b) {
  const metres = straightMetres(a, b);
  return { metres, coords: [[a.lat, a.lon], [b.lat, b.lon]], along: [0, metres], turns: [], straight: true };
}
const walkRoute = (leg) => walkRoutes[walkKey(leg)] || straightRoute(leg.from, leg.to);
/* A ride's path: the street its line drives (the feed's shape), with where
   each stop is along it; without one, its stops joined in order. Straight
   lines from stop to stop cut through buildings. */
const rideRoutes = new WeakMap();
function rideRoute(leg) {
  const known = rideRoutes.get(leg);
  if (known) return known;
  const street = leg.shape && leg.shape.length >= 2 && leg.shape_m && leg.shape_m.length === leg.stops.length;
  const coords = street ? leg.shape : leg.stops.map((stop) => [stop.lat, stop.lon]);
  const along = [0];
  for (let i = 1; i < coords.length; i++) {
    along.push(along[i - 1] + straightMetres({ lat: coords[i - 1][0], lon: coords[i - 1][1] }, { lat: coords[i][0], lon: coords[i][1] }));
  }
  const route = { metres: along[along.length - 1], coords, along, turns: [], stopsAt: street ? leg.shape_m : along.slice() };
  rideRoutes.set(leg, route);
  return route;
}

/* The point `d` metres along a path, and which way the path runs there. */
function pointAlong(route, d) {
  const { coords, along } = route;
  let i = 0;
  while (i < along.length - 2 && along[i + 1] < d) i++;
  const a = { lat: coords[i][0], lon: coords[i][1] }, b = { lat: coords[i + 1][0], lon: coords[i + 1][1] };
  const f = clamp01((d - along[i]) / Math.max(0.01, along[i + 1] - along[i]));
  return { ...lerp(a, b, f), heading: bearing(a, b) };
}

/* The next thing to do on a walk: cross a street or turn, whichever comes
   first, or keep going to the end. A crossing is said as it is: "per
   perėją" where there is one, a plain "Pereik gatvę" where there is not. */
function walkStep(g) {
  const turn = g.next, cross = g.crossing;
  if (cross && (!turn || cross.in <= turn.in + 5)) return { kind: 'cross', in: cross.in, road: cross.road, marked: cross.marked };
  if (turn) return { kind: 'turn', in: turn.in, angle: turn.angle, name: turn.name };
  return { kind: 'straight', in: g.metres };
}
const crossWords = () => 'Pereik gatvę';
const crossHow = (step) => (step.marked ? 'per perėją' : 'kur nėra perėjos');

/* A turn as it is said. The word comes from the angle; the arrow is drawn
   at the angle itself, bent as much as the street bends. */
function turnWords(angle) {
  const a = Math.abs(angle), side = angle < 0 ? 'kairėn' : 'dešinėn';
  if (a < 20) return 'tiesiai';
  if (a < 60) return `šiek tiek ${side}`;
  if (a < 125) return side;
  if (a < 165) return `staigiai ${side}`;
  return 'apsisuk';
}
function turnArrow(angle, cls = '') {
  const a = Math.max(-179, Math.min(179, angle));
  let d;
  if (Math.abs(a) < 20) d = 'M12 22V4M6.5 9.5 12 4l5.5 5.5';
  else if (a <= -165) d = 'M16 22V11a4 4 0 0 0-8 0v6M4.5 13.5 8 17.5l3.5-4';
  else if (a >= 165) d = 'M8 22V11a4 4 0 0 1 8 0v6M12.5 13.5 16 17.5l3.5-4';
  else {
    const r = rad(a), ex = 12 + 9 * Math.sin(r), ey = 12 - 9 * Math.cos(r);
    const back = (k) => `${(ex - 5.5 * Math.sin(r + rad(k))).toFixed(2)} ${(ey + 5.5 * Math.cos(r + rad(k))).toFixed(2)}`;
    d = `M12 22V12L${ex.toFixed(2)} ${ey.toFixed(2)}M${back(38)}L${ex.toFixed(2)} ${ey.toFixed(2)}L${back(-38)}`;
  }
  return `<svg class="turn${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
}

// Web Mercator, as the map tiles are drawn.
const TILE = 256;
function worldPx(lat, lon, z) {
  const n = TILE * 2 ** z, sin = Math.sin(rad(lat));
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n];
}
const metresPerPx = (lat, z) => (156543.03392 * Math.cos(rad(lat))) / 2 ** z;

/* A small round map that turns with you, the way a game's minimap does: you
   in the middle pointing up, the path ahead as a line, where you are going
   as a ring. "Which way?" is answered by turning until the line runs up;
   no north, south or compass words to decode. Only lines and dots, so the
   real Live Activity can draw it natively. */
function minimapHtml(where, { route, here, heading, target, color, done = 0, bus = null, busKey = '', size = 84, reach = 150 }) {
  const R = size / 2;
  const perMetre = R / reach;
  // The tile zoom whose pixels come closest to the screen's without being
  // stretched: sharp on a 2x screen, streets still readable at a glance.
  let z = 17;
  while (z > 13 && perMetre * metresPerPx(here.lat, z) < 0.55) z--;
  while (z < 18 && perMetre * metresPerPx(here.lat, z) > 1.1) z++;
  const scale = perMetre * metresPerPx(here.lat, z);
  const [hx, hy] = worldPx(here.lat, here.lon, z);
  const half = (R * 1.45) / scale;   // the rotated circle's corners are covered too
  const tiles = [];
  for (let x = Math.floor((hx - half) / TILE); x <= Math.floor((hx + half) / TILE); x++) {
    for (let y = Math.floor((hy - half) / TILE); y <= Math.floor((hy + half) / TILE); y++) {
      tiles.push(`<img alt="" data-key="t${z}-${x}-${y}" src="https://tile.openstreetmap.org/${z}/${x}/${y}.png" draggable="false"
        style="left:${(R + (x * TILE - hx) * scale).toFixed(1)}px;top:${(R + (y * TILE - hy) * scale).toFixed(1)}px;width:${(TILE * scale + 0.5).toFixed(1)}px">`);
    }
  }
  const px = (p) => { const [x, y] = worldPx(p.lat, p.lon, z); return [R + (x - hx) * scale, R + (y - hy) * scale]; };
  const pts = (list) => list.map((p) => px(p).map((v) => v.toFixed(1)).join(',')).join(' ');
  const points = route.coords.map(([lat, lon]) => ({ lat, lon }));
  const cut = route.along.findIndex((x) => x > done);
  const split = cut < 0 ? points.length : cut;
  const behind = [...points.slice(0, split), here], ahead = [here, ...points.slice(split)];
  let [tx, ty] = px(target);
  const far = Math.hypot(tx - R, ty - R), rim = R - 7;
  if (far > rim) { tx = R + ((tx - R) * rim) / far; ty = R + ((ty - R) * rim) / far; }
  let busDot = '';
  if (bus && bus.lat != null) {
    const b = fixPoint(busKey || `${where}-bus`, bus);
    const [bx, by] = px(b);
    if (Math.hypot(bx - R, by - R) < R + 6) busDot = `<circle class="mm-bus" cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="5" style="fill:#${esc(color || '1C1C1E')}"/>`;
  }
  const turned = needleAngle(`${where}-map-${size}`, heading);
  return `<span class="minimap" data-action="open-map" role="button" aria-label="Atidaryti žemėlapį" style="width:${size}px;height:${size}px">
      <span class="mm-turn" style="transform:rotate(${(-turned).toFixed(1)}deg)">${tiles.join('')}
        <svg viewBox="0 0 ${size} ${size}">
          ${route.straight ? '' : `<polyline class="mm-case" points="${pts(ahead)}"/><polyline class="mm-done" points="${pts(behind)}"/><polyline class="mm-path" points="${pts(ahead)}"/>`}
          <circle class="mm-target" cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="5.5"${color ? ` style="stroke:#${esc(color)}"` : ''}/>${busDot}
        </svg></span>
      <svg class="mm-me" viewBox="-40 -40 80 80"><path d="M0 -8 6 6.5 0 3.2 -6 6.5Z"/></svg>
    </span>`;
}

/* The minimap for the banner's current moment: the walk's street path, the
   ride's stops, and, while waiting, the bus on its way. */
function phaseMap(trip, phase, at, where, size) {
  const g = guidance(trip, phase, at);
  const legs = trip.option.legs;
  if (g.mode === 'ride') {
    const leg = phase.kind === 'before' ? legs[0] : phase.leg;
    const live = phase.kind === 'wait' ? liveOf(leg) : null;
    return minimapHtml(where, { route: g.route, here: g.here, heading: g.heading, target: g.targetPoint, color: leg.route.color,
      done: g.done, bus: live, busKey: refOf(leg), size, reach: phase.kind === 'wait' ? 450 : 600 });
  }
  const ride = nextRide(legs, (phase.i ?? -1) + 1);
  return minimapHtml(where, { route: g.route, here: g.here, heading: g.gpsHeading ?? g.heading, target: g.targetPoint,
    color: g.toStop && ride ? ride.route.color : null, done: g.done, size, reach: Math.max(70, Math.min(160, g.metres * 1.2)) });
}

/* A change between two stops of one name ("Vinco Kudirkos aikštė" both
   ways). Across the street is said only when it is plain: the bus you came
   on and the next one run along the same street (their directions parallel
   or opposite), and the second stop is off to the side of that street,
   within a street's width. Anything else is "the other stop of that name",
   which is true whatever the corner looks like. */
function sameStopMove(legs, i) {
  const walk = legs[i], before = legs[i - 1], after = legs[i + 1];
  const direction = (ride, end) => (ride && ride.kind === 'ride' && ride.stops.length >= 2
    ? (end ? bearing(ride.stops[ride.stops.length - 2], ride.stops[ride.stops.length - 1]) : bearing(ride.stops[0], ride.stops[1]))
    : null);
  const into = direction(before, true), out = direction(after, false);
  if (into == null || out == null || walk.metres > 120) return 'other';
  const along = Math.cos(rad(into - out));                        // +1 same way, -1 opposite
  const aside = Math.abs(Math.sin(rad(bearing(walk.from, walk.to) - into))) > 0.7;
  if (along < -0.7 && aside) return 'across';                     // both ways of one street, facing
  if (along > 0.7 && !aside) return 'same-side';                  // one way, further along the curb
  if (Math.abs(along) < 0.7) return 'corner';                     // the street round the corner
  return 'other';
}

/* What a walk crosses, from OpenStreetMap: "Pereisi gatvę per perėją:
   Gedimino pr." Empty until the walk's path has arrived, or when it crosses
   nothing. */
function crossingsLine(leg) {
  const list = walkRoute(leg).crossings || [];
  if (!list.length) return '';
  const n = list.length;
  const roads = [...new Set(list.map((c) => c.road).filter(Boolean))];
  const marked = list.every((c) => c.kind === 'marked');
  return `Pereisi ${n === 1 ? 'gatvę' : `${n} ${plural(n, 'gatvę', 'gatves', 'gatvių')}`}${marked ? (n === 1 ? ' per perėją' : ' per perėjas') : ''}${roads.length ? `: ${roads.join(', ')}` : ''}`;
}

/* Where a bus is now, not where it was when it last reported. A position
   is ~8 s old when it arrives (stops.lt's own delay); moved on along its
   heading at its reported speed for that long (at most AHEAD_MAX_S), a
   moving bus is drawn a median 20 m from where it really is, against 67 m
   left where it was reported, and 110 m as the app used to show it
   (measured on Vilnius' feed, 2026-09-27; see vc/live.py). A new fix eases
   the drawn position over CORRECT_MS instead of jumping; a jump of more
   than 600 m (a vehicle back from nowhere) is taken at once. */
const AHEAD_MAX_S = 30, CORRECT_MS = 900;
function ahead(fix, at = Date.now()) {
  const age = fix.measured_ms ? Math.min(Math.max(0, (at - fix.measured_ms) / 1000), AHEAD_MAX_S) : 0;
  const go = fix.speed > 0.5 ? fix.speed * age : 0;
  // On its line's street, moved on along it and held at the next stop (a
  // bus stops there): a median 17 m from the truth for a moving bus, on the
  // road, never through a building (same recording; 91% of fixes lie within
  // 40 m of their street, the rest go straight along their heading).
  const street = fix.pattern != null && fix.along != null ? streetOf(fix.pattern) : null;
  if (street) {
    const next = street.stops.find((m) => m > fix.along + 3) ?? street.length;
    return pointOnStreet(street, Math.min(fix.along + go, next));
  }
  if (!go || fix.bearing == null) return { lat: fix.lat, lon: fix.lon };
  const b = rad(fix.bearing);
  return { lat: fix.lat + (go * Math.cos(b)) / 111_320, lon: fix.lon + (go * Math.sin(b)) / (111_320 * Math.cos(rad(fix.lat))) };
}
/* Each line's street, asked for once when a bus of it first shows. */
const streets = new Map();
function streetOf(pattern) {
  const known = streets.get(pattern);
  if (known) return known === 'asked' ? null : known;
  streets.set(pattern, 'asked');
  api('/api/shape', { pattern }).then((street) => {
    street.length = street.along[street.along.length - 1];
    streets.set(pattern, street);
    // Buses of the line already drawn ease onto the street.
    for (const [marker, m] of movers) {
      if (m.fix.pattern === pattern) { const p = marker.getLatLng(); movers.set(marker, nextMotion({ lat: p.lat, lon: p.lng }, m.fix)); }
    }
    for (const [key, m] of Object.entries(dotMotion)) {
      if (m.fix.pattern === pattern) dotMotion[key] = nextMotion(motionAt(m), m.fix);
    }
  }).catch(() => streets.delete(pattern));
  return null;
}
function pointOnStreet(street, m) {
  const { coords, along } = street;
  let lo = 0, hi = along.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (along[mid] <= m) lo = mid; else hi = mid; }
  const f = clamp01((m - along[lo]) / Math.max(0.01, along[hi] - along[lo]));
  return { lat: coords[lo][0] + (coords[hi][0] - coords[lo][0]) * f, lon: coords[lo][1] + (coords[hi][1] - coords[lo][1]) * f };
}
const easeOut3 = (x) => 1 - (1 - x) ** 3;
function nextMotion(shown, fix) {
  const target = ahead(fix);
  const off = shown && straightMetres(shown, target) <= 600 ? [shown.lat - target.lat, shown.lon - target.lon] : [0, 0];
  return { fix, off, t0: performance.now() };
}
function motionAt(m, ts = performance.now()) {
  const p = ahead(m.fix);
  const k = 1 - easeOut3(Math.min(1, (ts - m.t0) / CORRECT_MS));
  return { lat: p.lat + m.off[0] * k, lon: p.lon + m.off[1] * k };
}
const movers = new Map();
let moving = false, lastMove = 0;
function follow(marker, fix) {
  const was = movers.get(marker);
  if (was && was.fix.measured_ms === fix.measured_ms && was.fix.lat === fix.lat && was.fix.lon === fix.lon) return;
  const shown = marker.getLatLng();
  movers.set(marker, nextMotion(was ? { lat: shown.lat, lon: shown.lng } : null, fix));
  if (!moving) { moving = true; requestAnimationFrame(moveFrame); }
}
function moveFrame(ts) {
  // About 30 frames a second: smooth for something moving a few pixels a second.
  if (ts - lastMove >= 33) {
    lastMove = ts;
    for (const [marker, m] of movers) {
      if (!marker._map) { movers.delete(marker); continue; }
      const p = motionAt(m, ts);
      marker.setLatLng([p.lat, p.lon]);
    }
  }
  if (movers.size) requestAnimationFrame(moveFrame); else moving = false;
}
// The same for a dot drawn by hand (the banner's minimap redraws 4x a second).
const dotMotion = {};
function fixPoint(key, fix) {
  const m = dotMotion[key];
  if (!m || m.fix.measured_ms !== fix.measured_ms || m.fix.lat !== fix.lat || m.fix.lon !== fix.lon) {
    dotMotion[key] = nextMotion(m ? motionAt(m) : null, fix);
  }
  return motionAt(dotMotion[key]);
}

/* The rider's own dot glides from one fix to the next instead of jumping. */
const glides = new Map();
let gliding = false;
function glideTo(marker, lat, lon, ms = 5200) {
  const from = marker.getLatLng();
  if (straightMetres({ lat: from.lat, lon: from.lng }, { lat, lon }) > 600) { glides.delete(marker); marker.setLatLng([lat, lon]); return; }
  glides.set(marker, { a: [from.lat, from.lng], b: [lat, lon], t0: performance.now(), ms });
  if (!gliding) { gliding = true; requestAnimationFrame(glideFrame); }
}
function glideFrame(ts) {
  for (const [marker, g] of glides) {
    const f = Math.min(1, (ts - g.t0) / g.ms);
    marker.setLatLng([g.a[0] + (g.b[0] - g.a[0]) * f, g.a[1] + (g.b[1] - g.a[1]) * f]);
    if (f >= 1) glides.delete(marker);
  }
  if (glides.size) requestAnimationFrame(glideFrame); else gliding = false;
}

// ---- where the rider really is

/* The position the phone gives, kept sharp: every fix the browser reports
   is watched, and a vaguer one replaces a sharper one only once the sharper
   one is old or the person has clearly moved on. On a phone outdoors GPS
   gives 5–15 m; a computer has no GPS and its Wi-Fi guess is coarser, so
   the accuracy is always shown rather than assumed. */
let watchId = null;
function watchLocation() {
  if (!navigator.geolocation || watchId != null) return;
  watchId = navigator.geolocation.watchPosition(onFix, onFixError, { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 });
}
function onFix(pos) {
  const c = pos.coords;
  const fix = { lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, heading: c.heading, speed: c.speed, at: Date.now() };
  const cur = state.gps;
  const keep = cur && fix.accuracy > cur.accuracy + 5 && Date.now() - cur.at < 15_000
    && straightMetres(cur, fix) < cur.accuracy + fix.accuracy;
  const hadNone = !cur;
  if (!keep) state.gps = fix;
  state.gpsError = null;
  state.locating = false;
  if (hadNone || !keep) {
    fillOrigins();
    if (['home', 'pick', 'settings'].includes(currentScreen().name) && !state.searchActive) {
      if (currentScreen().name === 'home') refreshHome(); else renderApp();
    }
    drawMe();
  }
}
function onFixError(err) {
  if (state.gps) return;   // a fix in hand beats a timeout
  state.gpsError = GPS_ERRORS[err.code] || 'Vietos nustatyti nepavyko.';
  state.locating = false;
  fillOrigins(); renderApp();
}
/* A fix recent and sharp enough to steer by, and only when the prototype's
   clock is the real one (a GPS fix at "+5 min" describes another moment). */
function gpsFix() {
  if (aheadOnly) return null;
  const g = state.gps;
  return g && liveClock() && Date.now() - g.at < 20_000 && g.accuracy <= 50 ? g : null;
}

/* The phone's compass, pushed by the Expo Go shell as "vc-heading" events:
   true north, 0–360. It counts only while it keeps arriving. */
const compassDeg = () => (state.compass && Date.now() - state.compass.at < 3000 ? state.compass.deg : null);
let compassPaint = 0, compassSoon = null;
window.addEventListener('vc-heading', (event) => {
  const deg = event.detail && Number(event.detail.deg);
  if (!Number.isFinite(deg)) return;
  state.compass = { deg: ((deg % 360) + 360) % 360, at: Date.now() };
  // Only what draws the heading, and about five times a second: the
  // sensor reports far more often than a turning map can use.
  if (compassSoon || !state.trip) return;
  compassSoon = setTimeout(() => { compassSoon = null; compassPaint = Date.now(); renderLock(); renderIsland(); },
    Math.max(0, 200 - (Date.now() - compassPaint)));
});
/* The panel's heading slider only stands in for turning on a desk: it goes
   while a real compass is talking. */
function syncHeadingBox() {
  const box = $('#heading-box');
  const hide = compassDeg() != null;
  if (box && box.hidden !== hide) box.hidden = hide;
}
/* The nearest point of a path to a position: how far along it, how far off. */
function projectOnRoute(route, p) {
  let best = { d: 0, off: Infinity };
  const k = Math.cos(rad(p.lat)) * 111_320;
  for (let i = 0; i < route.coords.length - 1; i++) {
    const [alat, alon] = route.coords[i], [blat, blon] = route.coords[i + 1];
    const ax = (alon - p.lon) * k, ay = (alat - p.lat) * 111_320;
    const bx = (blon - p.lon) * k, by = (blat - p.lat) * 111_320;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
    const f = clamp01(-(ax * dx + ay * dy) / len2);
    const off = Math.hypot(ax + dx * f, ay + dy * f);
    if (off < best.off) best = { d: route.along[i] + (route.along[i + 1] - route.along[i]) * f, off };
  }
  return best;
}

/* The prototype has no GPS during a trip, so the rider is placed where the
   timetable says they should be: along the walk by elapsed time, between two
   stops by their times. What the real app will replace with a location fix. */
function guidance(trip, phase, at) {
  const legs = trip.option.legs;
  const leg = phase.kind === 'before' ? legs[0] : phase.leg;
  const lastLeg = legs.indexOf(leg) === legs.length - 1;
  // Where the phone points: its compass, in the Expo Go shell. On the desk,
  // the way the path runs, turned by the panel's "Kur atsisukęs" slider.
  const compass = compassDeg();
  const facing = (deg) => (compass != null ? compass : (deg + (state.headingOffset || 0) + 360) % 360);
  if (leg.kind === 'walk') {
    const span = Math.max(1, t(leg.arrival) - t(leg.departure));
    const done = phase.kind === 'before' ? 0 : clamp01((at - t(leg.departure)) / span);
    const route = walkRoute(leg);
    let d = done * route.metres;
    // A real position near the path beats the timetable's guess of it.
    const fix = gpsFix();
    let snapped = false;
    if (fix && phase.kind !== 'before') {
      const p = projectOnRoute(route, fix);
      if (p.off <= Math.max(25, fix.accuracy)) { d = p.d; snapped = true; }
    }
    const here = pointAlong(route, d);
    const next = route.turns.find((turn) => turn.at > d + 2 && Math.abs(turn.angle) >= 20) || null;
    const cross = (route.crossings || []).find((c) => c.at > d - 3) || null;
    const left = Math.max(0, route.metres - d);
    return {
      mode: 'walk', route, here, done: d,
      heading: facing(route.straight ? bearing(here, leg.to) : here.heading),
      deg: bearing(here, leg.to),
      metres: Math.round(left),
      straight: straightMetres(here, leg.to),
      next: next && next.at - d < left - 10 ? { angle: next.angle, in: Math.round(next.at - d), name: next.name } : null,
      crossing: cross && cross.at - d < left - 3 ? { in: Math.max(0, Math.round(cross.at - d)), marked: cross.kind === 'marked', road: cross.road } : null,
      // GPS knows which way the rider has been moving, the compass which way
      // the phone points now: the minimap turns with the phone when it can.
      snapped, gpsHeading: compass == null && fix && fix.speed > 0.6 && fix.heading != null ? fix.heading : null,
      target: leg.to.name, targetPoint: leg.to,
      toStop: !lastLeg && leg.to.stop != null,
    };
  }
  const stops = leg.stops;
  let k = 0;
  while (k < stops.length - 2 && t(stops[k + 1].time) <= at) k++;
  const a = stops[k], b = stops[k + 1] || stops[k];
  const same = a.lat === b.lat && a.lon === b.lon;
  const f = clamp01((at - t(a.time)) / Math.max(1, t(b.time) - t(a.time)));
  const route = rideRoute(leg);
  const s = route.stopsAt, k2 = Math.min(k + 1, s.length - 1);
  const done = s[k] + (s[k2] - s[k]) * f;
  const on = pointAlong(route, Math.min(route.metres, done));
  const deg = same ? bearing(leg.from, leg.to) : on.heading;
  return {
    mode: 'ride', route,
    here: { lat: on.lat, lon: on.lon },
    done,
    deg,
    heading: facing(deg),
    next: b.name,
    left: Math.max(1, stops.filter((stop) => t(stop.time) > at).length),
    minutes: Math.max(1, minutesUntil(t(b.time), at)),
    targetPoint: leg.to,
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
      return `<div class="caption listen-cap">${state.listening === 'lock' ? `${dotsHtml}<span>Klausau</span>` : '&nbsp;'}</div>
        <div class="question">Kur keliausime šiandien?</div>
        <div class="heard">${b.problem ? esc(b.problem) : state.interim ? `„${esc(state.interim)}“` : 'Sakyk balsu arba bakstelėk ir rašyk'}</div>
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
      return `<div class="caption">Girdėjau</div><div class="question heard-q">${esc(b.heard ? capital(b.heard) : `Į ${b.place.name}`)}</div>
        ${actions([['Dabar', 'banner-now', true], ['Planuoti', 'banner-plan']])}`;
    case 'askTime':
      return `<div class="question">Kada turi būti vietoje?${state.listening === 'lock' ? dotsHtml : ''}</div>
        <div class="heard">${b.problem ? esc(b.problem) : state.interim ? `„${esc(state.interim)}“` : `${esc(b.place.name)} · pasakyk laiką, pvz., „keturiolika dvidešimt“`}</div>
        ${actions([['Dabar', 'banner-now', !!b.problem], b.problem ? ['Bandyti dar kartą', 'banner-plan'] : ['Atšaukti', 'banner-cancel']])}`;
    case 'error':
      return `<div class="question small">${esc(b.message)}</div>
        ${b.detail ? `<div class="heard wrap">${esc(b.detail)}</div>` : ''}
        ${b.code === 'no-origin' ? actions([['Pasirinkti vietą', 'banner-pick-origin', true], ['Atšaukti', 'banner-cancel']])
          : b.code === 'cross-city' && cityNamed(b.city) ? actions([[`Pradėti ${cityIn(b.city)}`, 'banner-city', true], ['Atšaukti', 'banner-cancel']])
          : actions([['Bandyti dar kartą', 'banner-retry', true], ['Rašyti', 'banner-open-search']])}`;
    case 'saved':
      return `<div class="question small">Išsaugota: ${esc(b.name)}</div>`;
    case 'done':
      return `<div class="done"><svg class="done-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>
        <div><div class="question small">Atvykai</div><div class="heard">${esc(b.name)} · ${b.minutes} min kelionė</div></div></div>`;
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

const PAGES = ['Laikas', 'Kryptis', 'Maršrutas'];

/* The page the banner shows. A new stage is a new instruction, so it opens
   on the first page again: the rider never misses "Ruoškis išlipti" because
   the map was left up. */
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

/* The page button: the banner's corner, cut off by a quarter circle, in the
   banner's accent colour, with the dots inside. A filled shape reads as
   something to press, where bare dots read as decoration; the dots still say
   "page 2 of 3". A Live Activity takes taps on buttons, not swipes. */
function activityPager() {
  const b = state.banner, trip = state.trip;
  if (!b || b.stage !== 'trip' || !trip) return '';
  const phase = phaseOf(trip, now().getTime());
  if (phase.kind === 'arrived') return '';
  const page = pageOf(trip, phase);
  const next = (page + 1) % PAGES.length;
  const dots = PAGES.map((_, i) => `<i${i === page ? ' class="on"' : ''}></i>`).join('');
  // Only the dots: they say which page this is, and a tap on them turns to
  // the next one. A Live Activity takes taps on buttons, not swipes, so the
  // dots are that button, with a finger-sized target around them.
  return `<button class="pager-dots" data-action="banner-page" data-page="${next}" aria-label="${esc(PAGES[page])}, ${page + 1} iš ${PAGES.length}. Rodyti: ${esc(PAGES[next])}"><span class="pdots" aria-hidden="true">${dots}</span></button>`;
}

function tripContent(at, actions, where) {
  const trip = state.trip;
  if (!trip) return '';
  const o = trip.option;
  const phase = phaseOf(trip, at);

  if (phase.kind === 'arrived') return bannerHtml(bannerArrived(trip, at));
  const page = pageOf(trip, phase);
  if (page === 1) return bannerHtml(bannerDirection(trip, phase, at, where));
  if (page === 2) return bannerHtml(bannerRoute(trip, phase, at));
  return bannerHtml(bannerNow(trip, phase, at, where));
}

const clip = (html) => `<span class="clip">${html}</span>`;
const distanceHtml = (m) => `${roll(roundMetres(m))} ${m >= 1000 ? 'km' : 'm'}`;
/* The ride's progress, notched at every stop in between: the fill visibly
   moves stop by stop, and the notches count what "Važiuok 5 stoteles" says. */
const progressHtml = (f, ticks = []) => `<div class="progress"><i style="width:${(clamp01(f) * 100).toFixed(1)}%"></i>${
  ticks.map((x) => `<b class="tick" style="left:${(clamp01(x) * 100).toFixed(1)}%"></b>`).join('')}</div>`;
// Counts to the minute that is shown beside it: "išeik 08:01" never sits
// over "2 min" at 08:00 because the plan said 08:01:40.
const countdown = (ms, at) => {
  const m = ms > at ? Math.max(1, minutesUntil(Math.floor(ms / 60_000) * 60_000, at)) : 0;
  return { hero: durationHtml(m), long: m >= 60 };
};

/* ---- the banner as data
   The design's one template: what to do and where on the left (a caption,
   the title, one line of detail), how long until the next thing on the
   right (a caption and the number), one line along the bottom (the routes,
   or the walk's or ride's progress) beside the page button. The page is
   data first (docs/ios-shell.md, "The banner as data"): the web banner and
   the iPhone's Live Activity draw the same object. */

const routeRef = (r) => ({ name: r.name, color: r.color, text: r.text_color });
/* "12 min", or "1:20 val." once it is an hour or more. */
function minutesValue(m) {
  if (m <= 0) return { value: 'dabar', unit: '' };
  if (m < 60) return { value: String(m), unit: 'min' };
  return { value: `${Math.floor(m / 60)}:${pad(m % 60)}`, unit: 'val.' };
}
// Counts to the minute shown beside it: "išeik 08:01" never sits over
// "2 min" at 08:00 because the plan said 08:01:40.
const minutesLeft = (ms, at) => (ms > at ? Math.max(1, minutesUntil(Math.floor(ms / 60_000) * 60_000, at)) : 0);
const rightBlock = (caption, ms, at) => ({ caption, ...minutesValue(minutesLeft(ms, at)), until: ms });

/* The number block: how long until the next thing happens, and what. It
   sits in the same place on every page, so flipping pages never hides it. */
function rightOf(trip, phase, at) {
  const o = trip.option;
  const legs = o.legs;
  if (phase.kind === 'before') return rightBlock('Liko', t(legs[0].departure), at);
  const leg = phase.leg;
  if (phase.kind === 'wait') return rightBlock(`${leg.route.name} atvyks`, t(leg.departure), at);
  if (phase.kind === 'ride') return rightBlock('Išlipk už', t(leg.arrival), at);
  const ride = nextRide(legs, phase.i + 1);
  if (!ride) return rightBlock('Liko', t(o.arrive), at);
  return rightBlock(`${ride.route.name} atvyks`, t(ride.departure), at);
}

/* The next thing on a walk, in words and as an arrow: the bend ahead, the
   street to cross, or straight on. */
function walkMeta(g) {
  if (g.metres < 15 || g.straight < 12) return { meta: 'Tu jau čia', metaIcon: null };
  const step = walkStep(g);
  if (step.kind === 'cross') {
    return { meta: `Pereik gatvę${step.marked ? ' per perėją' : ''}${step.in > 8 ? ` · po ${roundMetres(step.in)} m` : ''}`, metaIcon: 'crossing' };
  }
  if (step.kind === 'turn') return { meta: `${capital(turnWords(step.angle))} · po ${metresText(step.in)}`, metaIcon: { turn: step.angle } };
  return { meta: `Tiesiai · ${metresText(g.metres)}`, metaIcon: { turn: 0 } };
}
// "po 1 stotelės", "po 6 stotelių": after so many stops.
const stopsAfter = (n) => `po ${n} ${n % 10 === 1 && n % 100 !== 11 ? 'stotelės' : 'stotelių'}`;

// Page 1: what to do now.
function bannerNow(trip, phase, at, where = 'lock') {
  const o = trip.option;
  const legs = o.legs;
  const right = rightOf(trip, phase, at);

  // A late bus has broken a connection ahead, or a trip was called off:
  // the one line in red, and the way on. (An early first bus is not a
  // connection: "Paskubėk" covers it below.)
  const firstRide = legs.find((l) => l.kind === 'ride');
  const broken = legs.slice((phase.i ?? -1) + 1).find((l) => l.cancelled || (l.missed && l !== firstRide));
  if (broken) {
    const live = liveOf(broken);
    return {
      stage: 'problem', titleKind: 'problem',
      title: broken.cancelled ? 'Autobusas atšauktas' : 'Nespėsi persėsti',
      meta: broken.cancelled ? `${broken.route.name} ${broken.departure.hm} · ${broken.from.name}`
        : live && live.delay_s >= 120 ? `${broken.route.name} vėluoja ${Math.round(live.delay_s / 60)} min` : `${broken.route.name} išvyks ${broken.departure.hm}`,
      buttons: [{ label: state.replanning ? 'Ieškau…' : 'Planuoti iš čia', action: 'trip-replan', primary: true }],
    };
  }

  if (phase.kind === 'before') {
    const leave = t(legs[0].departure);
    const ride = nextRide(legs, 0);
    const words = ride && liveOf(ride) ? liveWords(liveOf(ride), { short: true }) : null;
    return {
      stage: 'countdown', caption: `Išeik${dayWord(leave)}`, title: o.leave.hm, titleKind: 'clock',
      meta: words ? `${ride.route.name} ${words.map((w) => w.text).join(' · ')}` : '', metaLive: !!words,
      right, foot: { routes: legs.filter((l) => l.kind === 'ride').map((l) => routeRef(l.route)), text: `${trip.place.name} ${o.arrive.hm}` },
    };
  }

  const leg = phase.leg;
  if (phase.kind === 'wait') {
    const transfer = phase.i > 0 && legs[phase.i - 1].kind === 'ride';
    const live = liveOf(leg);
    const words = live ? liveWords(live, { short: true }) : null;
    return {
      stage: 'wait', caption: transfer ? 'Persėsk' : 'Lauk stotelėje', captionRoute: routeRef(leg.route),
      title: leg.from.name, titleKind: 'text',
      meta: words ? words.map((w) => w.text).join(' · ') : leg.headsign ? `→ ${leg.headsign}` : '', metaLive: !!words,
      right, foot: { html: approachHtml(leg) || '', text: leg.headsign ? `→ ${leg.headsign}` : '' },
    };
  }

  if (phase.kind === 'ride') {
    const remaining = Math.max(1, leg.stops.filter((s) => t(s.time) > at).length);
    const from = t(leg.departure), span = Math.max(1, t(leg.arrival) - from);
    const then = nextRide(legs, phase.i + 1);
    return {
      stage: 'ride', caption: 'Važiuoji', captionRoute: routeRef(leg.route),
      title: remaining === 1 ? 'Ruoškis išlipti' : then ? `Persėsk į ${then.route.name}` : 'Išlipk',
      titleKind: 'text',
      meta: `${leg.to.name} · ${remaining === 1 ? 'kita stotelė' : stopsAfter(remaining)}`,
      right, foot: { progress: clamp01((at - from) / span), ticks: leg.stops.slice(1, -1).map((s) => (t(s.time) - from) / span) },
    };
  }

  // Walking: to the first stop, between vehicles, or to the destination.
  const g = guidance(trip, phase, at);
  const route = g.route;
  const ride = nextRide(legs, phase.i + 1);
  const { meta, metaIcon } = walkMeta(g);
  const map = where === 'data' ? '' : phaseMap(trip, phase, at, where, 84);
  const foot = { progress: route.metres ? clamp01(g.done / route.metres) : 0 };
  if (!ride) return { stage: 'walk', caption: 'Eik pėsčiomis', title: trip.place.name, titleKind: 'text', meta, metaIcon, right, foot, map };
  let caption = 'Eik į stotelę';
  if (phase.i > 0) caption = leg.from.name === leg.to.name && sameStopMove(legs, phase.i) === 'across' ? 'Pereik gatvę' : 'Persėsk';
  else if (leavingNow(trip, phase, at)) caption = 'Išeik dabar';
  // The bus will be there before you at this pace; or, late enough, it
  // spares you the rush, and saying so is worth the caption.
  let captionProblem = false;
  if (ride.missed) { caption = 'Paskubėk'; captionProblem = true; }
  else if (phase.i === legs.indexOf(ride) - 1 && liveOf(ride) && t(ride.departure) - t(leg.arrival) >= 150_000) caption = 'Eik ramiai';
  return { stage: 'walk', caption, captionProblem, title: ride.from.name, titleKind: 'text', meta, metaIcon, right, foot, map };
}

// Page 2: which way, as the street says it: the next bend's arrow at its
// real angle beside a map that turns with the rider. On the bus, the next
// stop; waiting, where the bus is. The number block stays.
function bannerDirection(trip, phase, at, where = 'lock') {
  const g = guidance(trip, phase, at);
  const right = rightOf(trip, phase, at);
  const map = where === 'data' ? '' : phaseMap(trip, phase, at, where, 84);
  if (g.mode === 'ride') {
    const leg = phase.leg;
    if (phase.kind === 'wait') {
      const live = liveOf(leg);
      const words = live ? liveWords(live, { short: true }) : null;
      return { stage: 'wait', caption: 'Autobusas', captionRoute: routeRef(leg.route), title: words ? capital(words[0].text) : 'Lauk stotelėje',
        titleKind: words && words[0].problem ? 'problem' : 'text', meta: `→ ${leg.headsign || leg.to.name}`, right, map, foot: {} };
    }
    return { stage: 'ride', caption: 'Kita stotelė', captionRoute: routeRef(leg.route), title: g.next, titleKind: 'text', meta: `Išlipk: ${leg.to.name}`, right, map, foot: {} };
  }
  const { meta, metaIcon } = walkMeta(g);
  const step = walkStep(g);
  const title = g.metres < 15 || g.straight < 12 ? 'Tu jau čia'
    : step.kind === 'cross' ? crossWords(step) : step.kind === 'turn' ? capital(turnWords(step.angle)) : 'Tiesiai';
  return { stage: 'walk', caption: 'Kryptis', title, titleKind: 'text', titleIcon: metaIcon,
    meta: step.kind === 'turn' && step.name ? `po ${metresText(step.in)} · ${step.name}` : meta.replace(/^[^·]*· /, ''), right, map, foot: {} };
}

// Page 3: the next three steps, then the arrival on the bottom line. The
// whole list lives in the app, one tap away.
function bannerRoute(trip, phase, at) {
  const o = trip.option;
  const legs = o.legs;
  const current = phase.kind === 'before' ? 0 : phase.i;
  const row = (leg, now) => {
    let text;
    if (leg.kind === 'ride') text = leg.to.name;
    else if (leg.to.stop == null) text = `${metresText(leg.metres)} · iki tikslo`;
    else if (leg.from.name === leg.to.name) {
      const move = sameStopMove(legs, legs.indexOf(leg));
      text = move === 'across' ? `per gatvę · ${leg.to.name}` : move === 'same-side' ? `${metresText(leg.metres)} · ta pati gatvės pusė` : `${metresText(leg.metres)} · kita stotelė „${leg.to.name}“`;
    } else text = `${metresText(leg.metres)} · ${leg.to.name}`;
    return { time: leg.departure.hm, route: leg.kind === 'ride' ? routeRef(leg.route) : null, text, now };
  };
  // A few metres across the same stop is not a step worth a line; the walk
  // to the destination always is.
  const shown = [legs[current]];
  for (const leg of legs.slice(current + 1)) {
    if (shown.length === 3) break;
    if (leg.kind === 'ride' || leg.metres >= 120 || leg.to.stop == null) shown.push(leg);
  }
  return { stage: 'route', rows: shown.map((leg, i) => row(leg, i === 0 && phase.kind !== 'before')),
    right: rightOf(trip, phase, at), foot: { text: `${o.arrive.hm} · ${trip.place.name}`, pin: true } };
}

function bannerArrived(trip, at) {
  const o = trip.option;
  if (trip.snoozeUntil > at) return { stage: 'done', caption: trip.place.name, title: `Atvykai ${o.arrive.hm}`, titleKind: 'text' };
  return { stage: 'arrive', caption: `${trip.place.name} · ${o.arrive.hm}`, title: 'Ar baigėte kelionę?', titleKind: 'question',
    buttons: [{ label: 'Taip', action: 'trip-done', primary: true }, { label: 'Dar ne', action: 'trip-snooze' }] };
}

/* The three pages of the moment, as data: what the iPhone's banner draws. */
function bannerPages(trip, at, where = 'data') {
  const phase = phaseOf(trip, at);
  if (phase.kind === 'arrived') return [bannerArrived(trip, at)];
  return [bannerNow(trip, phase, at, where), bannerDirection(trip, phase, at, where), bannerRoute(trip, phase, at)];
}

// ---- the banner drawn

function metaGlyph(page) {
  const i = page.metaIcon;
  if (i === 'crossing') return `<svg class="icon cross-ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS.crossing}</svg>`;
  if (i && typeof i.turn === 'number') return turnArrow(i.turn, 'small');
  return page.metaLive ? icon('live') : '';
}
const footRoutes = (routes) => routes.map((r) => badge({ name: r.name, color: r.color, text_color: r.text }, true))
  .join(`<svg class="icon chev" viewBox="0 0 24 24" aria-hidden="true">${ICONS.chevron}</svg>`);
function footHtml(foot) {
  if (!foot) return '';
  if (typeof foot.progress === 'number') return progressHtml(foot.progress, foot.ticks || []);
  if (foot.html) return foot.html;
  if (foot.routes && foot.routes.length) return `<span class="bn-routes">${footRoutes(foot.routes)}</span>${foot.text ? `<span class="bn-foot-text">${esc(foot.text)}</span>` : ''}`;
  if (foot.text) return `${foot.pin ? icon('pin') : ''}<span class="bn-foot-text left">${esc(foot.text)}</span>`;
  return '';
}
function bannerHtml(p) {
  const right = p.right ? `<div class="bn-right"><div class="bn-cap">${esc(p.right.caption)}</div>
      <div class="big">${roll(p.right.value)}${p.right.unit ? `<small>${esc(p.right.unit)}</small>` : ''}</div></div>` : '';
  const buttons = p.buttons ? `<div class="actions">${p.buttons.map((b) =>
    `<button data-action="${b.action}"${b.primary ? ' class="primary"' : ''}>${esc(b.label)}</button>`).join('')}</div>` : '';
  if (p.stage === 'route') {
    const rows = p.rows.map((r) => `<div class="leg-row${r.now ? ' now' : ''}"><span class="t">${esc(r.time)}</span><span class="glyph">${r.route
      ? badge({ name: r.route.name, color: r.route.color, text_color: r.route.text }, true) : icon('walk')}</span><span class="text">${esc(r.text)}</span></div>`).join('');
    return `<div class="bn bn-route"><div class="bn-top"><div class="legs">${rows}</div>${right}</div><div class="bn-foot">${footHtml(p.foot)}</div></div>`;
  }
  const title = `${p.titleIcon ? metaGlyph({ metaIcon: p.titleIcon }) : ''}<span class="clip">${esc(p.title)}</span>`;
  return `<div class="bn bn-${p.stage}${p.map ? ' with-map' : ''}">
      <div class="bn-top">
        ${p.map ? `<div class="bn-map">${p.map}</div>` : ''}
        <div class="bn-left">
          ${p.caption || p.captionRoute ? `<div class="bn-cap${p.captionProblem ? ' problem-text' : ''}">${esc(p.caption || '')}${p.captionRoute ? badge({ name: p.captionRoute.name, color: p.captionRoute.color, text_color: p.captionRoute.text }, true) : ''}</div>` : ''}
          <div class="bn-title ${p.titleKind || 'text'}${p.titleKind === 'problem' ? ' problem-text' : ''}">${title}</div>
          ${p.meta ? `<div class="bn-meta">${metaGlyph(p)}<span class="clip">${esc(p.meta)}</span></div>` : ''}
        </div>
        ${right}
      </div>
      ${buttons || `<div class="bn-foot">${footHtml(p.foot)}</div>`}
    </div>`;
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

/* The phone's real status bar, in the Expo Go shell: light over the
   simulated lock screen or a dark theme, dark otherwise. Told only when
   that changes. */
let chromeDark = null;
function syncChrome() {
  if (!SHELL) return;
  const dark = (state.locked && !panelOpen()) || themeDark();
  if (dark === chromeDark) return;
  chromeDark = dark;
  shellPost({ type: 'chrome', dark });
}

/* ---- the iPhone's real banner (docs/ios-shell.md, "The banner as data")
   The page sends what the banner says now and at every change still ahead
   (leave, board, get off, arrive), because its scripts stop soon after the
   phone is locked. The iPhone app turns those into a Live Activity on the
   lock screen and the Dynamic Island, and moves from one to the next. */
let aheadOnly = false;               // planning ahead: the phone's fix is now, not then
const nativeBanner = () => !!(SHELL && SHELL.kind === 'ios' && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.vc);
const plainPage = (page) => {
  const out = { ...page };
  delete out.map;
  if (out.foot) { out.foot = { ...out.foot }; delete out.foot.html; }
  return out;
};
function tripMoments(trip, at) {
  const marks = new Set([at]);
  for (const leg of trip.option.legs) {
    for (const ms of [t(leg.departure), t(leg.arrival)]) if (ms > at) marks.add(ms + 1000);
  }
  marks.add(t(trip.option.arrive) + 60_000);
  return [...marks].sort((a, b) => a - b).slice(0, 24).map((ms, i) => {
    aheadOnly = i > 0;
    try { return { at: ms, pages: bannerPages(trip, ms, 'data').map(plainPage) }; } finally { aheadOnly = false; }
  });
}
let nativeSent = '', nativeAt = 0, nativeRunning = false;
function syncNativeBanner() {
  if (!nativeBanner()) return;
  const trip = state.trip;
  if (!trip) {
    if (nativeRunning) { shellPost({ type: 'activity', op: 'end' }); nativeRunning = false; nativeSent = ''; }
    return;
  }
  if (Date.now() - nativeAt < 4000) return;
  const at = now().getTime();
  const phase = phaseOf(trip, at);
  const p = paletteOf(state.palette);
  const message = {
    type: 'activity', op: nativeRunning ? 'update' : 'start', destination: trip.place.name,
    palette: { base: p.base, ink: p.ink, accent: p.accent, red: p.red },
    moments: tripMoments(trip, at), page: phase.kind === 'arrived' ? 0 : pageOf(trip, phase),
  };
  const key = JSON.stringify({ ...message, op: '' });
  if (key === nativeSent) return;
  nativeSent = key; nativeAt = Date.now(); nativeRunning = true;
  shellPost(message);
}
/* What was tapped on the iPhone's banner, or opened by its links. */
function shellAction(name) {
  if (name === 'trip') { state.locked = false; if (state.trip) actions['open-trip'](); return; }
  if (name === 'replan') { state.locked = false; if (state.trip) replanTrip(); return; }
  if (name.startsWith('page:') && state.trip) { state.trip.page = Number(name.slice(5)) || 0; renderAll(); return; }
  if (actions[name]) { actions[name]({ dataset: {} }, { target: document.body }); renderAll(); }
}
if (SHELL) {
  window.__vcShell = window.__vcShell || {};
  window.__vcShell.action = shellAction;
  window.addEventListener('vc-action', (event) => shellAction(String(event.detail || '')));
}

function renderLock() {
  const lock = $('#lock');
  $('#statusbar').classList.toggle('on-lock', state.locked);
  syncChrome();
  if (state.locked && !lock.firstChild) {
    // In the Expo Go shell this is drawn inside a real, unlocked iPhone: a
    // label says so, under the phone's own status bar.
    lock.innerHTML = `
      <div class="lock-top">${SHELL ? '<div class="lock-preview">Užrakinto ekrano peržiūra</div>' : ''}<div class="date"></div><div class="clock"><span class="roll"></span></div></div>
      <div class="stack"></div>
      <div class="controls">
        <button class="control ours" data-action="lock-button" aria-label="Vilnius · Kur keliausime">${icon('mic')}</button>
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
  // Lithuanian writes the day with "d.": "Rugsėjo 28 d., pirmadienis".
  const part = Object.fromEntries(new Intl.DateTimeFormat('lt-LT', { weekday: 'long', month: 'long', day: 'numeric' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  const date = `${capital(part.month)} ${part.day} d., ${part.weekday}`;
  const dateEl = $('.date', lock);
  if (dateEl.textContent !== date) dateEl.textContent = date;
  rollTo($('.clock .roll', lock), hm(d));
  const card = renderActivity($('.stack', lock), 'lock');
  // The system's own hint gives way to a banner, as on the iPhone.
  lock.classList.toggle('has-activity', !!card);
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

function autoExpandIsland() {
  const trip = state.trip;
  if (!trip || state.locked || !state.banner || state.banner.stage !== 'trip') return;
  const at = now().getTime();
  const phase = phaseOf(trip, at);
  if (phase.kind !== 'ride') return;
  const left = phase.leg.stops.filter((stop) => t(stop.time) > at).length;
  trip.expandedFor = trip.expandedFor || {};
  if (left > 2 || trip.expandedFor[phase.i]) return;
  trip.expandedFor[phase.i] = true;
  state.islandExpanded = true;
  setTimeout(() => { state.islandExpanded = false; renderIsland(); }, 6000);
}

function renderIsland() {
  autoExpandIsland();
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
  renderApp(); renderLock(); renderIsland(); renderOverlay(); renderClock(); syncNativeBanner();
  $('#toggle-lock').textContent = state.locked ? 'Atrakinti' : 'Užrakinti';
}

// Four times a second, but the DOM only changes where the content did.
let lastMinute = '';
setInterval(() => {
  renderClock(); renderLock(); renderIsland(); coachTick(); syncHeadingBox(); syncNativeBanner();
  const minute = hm(now());
  if (minute !== lastMinute) {
    lastMinute = minute;
    // "Išeik po 5 min" on the results and the route must not go stale.
    if (state.prefs && ['results', 'detail'].includes(currentScreen().name)) renderApp();
    else if (state.prefs && currentScreen().name === 'home') refreshHome();
  }
}, 250);

// ==================================================================== tips
//
// How to use it, told to a first-time user a few words at a time, next to
// the thing itself and the first time it is on screen: a tour up front is
// skipped and forgotten, a tip beside the button is not. The highlighted
// thing keeps working: a tap on it does what it does and moves the tips on,
// so each one is learnt by doing. Each group is shown once; Settings brings
// them back. Only inside the app: on a real iPhone nothing can be drawn over
// the lock screen or the island, so the banner is explained in the guide.

const TOURS = {
  home: {
    when: () => !state.locked && !!state.prefs && !state.sheet && currentScreen().name === 'home',
    steps: [
      { target: '#app .voice-card', text: 'Pasakyk, kur ir kada nori būti, pvz.: „ISM universitete 14:20“.' },
      { target: '#app .ptile:not(.add)', text: 'Tavo vietos. Paspausk ir iškart matysi, kada išeiti.' },
      { target: '#app .tab[data-tab="map"]', text: 'Žemėlapis: stotelės ir autobusai realiu laiku.' },
    ],
  },
  results: {
    when: () => !state.locked && !state.sheet && currentScreen().name === 'results' && !!coachFind('#app .cta'),
    steps: [
      { target: '#app .glass-pill', text: 'Reikia būti iki tam tikro laiko? Paliesk čia, rinkis „Atvykti iki“ ir pasuk ratukus.' },
      { target: '#app .cta', text: 'Spausk ir vesiu iki pat vietos, net kai telefonas užrakintas.' },
    ],
  },
};

let coach = null;           // the tour on screen: { name, steps, i, missing }
const coachWait = {};       // since when each tour's moment has lasted

/* The live element, not a copy fading out during a page turn. */
function coachFind(selector) {
  return [...document.querySelectorAll(selector)].find((el) => !el.closest('.act-ghost, .leaving') && el.getClientRects().length) || null;
}

function coachTick() {
  if (coach) return;
  const done = store.get('tips', {});
  for (const [name, tour] of Object.entries(TOURS)) {
    if (done[name] || !tour.when()) { delete coachWait[name]; continue; }
    coachWait[name] = coachWait[name] || Date.now();
    // Let the screen settle, and its entrance play, before pointing at it.
    if (Date.now() - coachWait[name] >= 900) { startTour(name); return; }
  }
}

function startTour(name) {
  const steps = TOURS[name].steps.filter((step) => coachFind(step.target));
  if (!steps.length) return;
  let layer = $('#coachmark');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'coachmark';
    layer.className = 'coachmark';
    layer.innerHTML = `${'<i class="cm-block"></i>'.repeat(5)}<div class="cm-spot"></div>
      <div class="cm-bubble" role="dialog" aria-label="Patarimas">
        <p class="cm-text" aria-live="polite"></p>
        <div class="cm-foot"><span class="cm-count"></span><button class="cm-skip" data-cm="skip">Praleisti</button><button class="cm-next" data-cm="next"></button></div>
        <i class="cm-arrow" aria-hidden="true"></i>
      </div>`;
    $('#screen').appendChild(layer);
  }
  layer.hidden = false;
  coach = { name, steps, i: 0, missing: 0 };
  showStep(true);
  play(layer, [{ opacity: 0 }, { opacity: 1 }], 'fade');
  requestAnimationFrame(coachFrame);
}

function showStep(first = false) {
  const layer = $('#coachmark');
  const step = coach.steps[coach.i];
  const last = coach.i === coach.steps.length - 1;
  $('.cm-text', layer).textContent = step.text;
  $('.cm-count', layer).textContent = coach.steps.length > 1 ? `${coach.i + 1} iš ${coach.steps.length}` : '';
  $('.cm-next', layer).textContent = last ? 'Supratau' : 'Toliau';
  $('.cm-skip', layer).hidden = last;
  placeCoach();
  const bubble = $('.cm-bubble', layer);
  if (!first) play(bubble, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], 'content');
  $('.cm-next', layer).focus({ preventScroll: true });
}

function nextStep() {
  if (!coach) return;
  // The next tip whose thing is on screen; the ones gone with it are skipped.
  let i = coach.i + 1;
  while (i < coach.steps.length && !coachFind(coach.steps[i].target)) i++;
  if (i >= coach.steps.length) { endTour(); return; }
  coach.i = i; coach.missing = 0;
  showStep();
}

function endTour() {
  if (!coach) return;
  const done = store.get('tips', {});
  done[coach.name] = true;
  store.set('tips', done);
  coach = null;
  const layer = $('#coachmark');
  afterPlay(play(layer, [{ opacity: 1 }, { opacity: 0 }], 'exit', { fill: 'forwards' }), () => {
    if (!coach) { layer.hidden = true; layer.getAnimations().forEach((a) => a.cancel()); }
  });
}

/* Follows its thing as the screen moves under it; a thing that has gone
   (the phone unlocked, the page turned) moves the tips on. */
function coachFrame() {
  if (!coach) return;
  const step = coach.steps[coach.i];
  if (coachFind(step.target)) { coach.missing = 0; placeCoach(); }
  else if (++coach.missing > 30) nextStep();
  requestAnimationFrame(coachFrame);
}

function placeCoach() {
  const step = coach.steps[coach.i];
  const el = coachFind(step.target);
  const layer = $('#coachmark');
  if (!el || !layer) return;
  const screen = $('#screen');
  const box = screen.getBoundingClientRect();
  const k = box.width / screen.offsetWidth || 1;
  const r = el.getBoundingClientRect();
  const W = screen.offsetWidth, H = screen.offsetHeight;
  const pad = step.pad ?? 6;
  let x = (r.left - box.left) / k - pad, y = (r.top - box.top) / k - pad;
  let w = r.width / k + pad * 2, h = r.height / k + pad * 2;
  let radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 12;
  if (step.round) {
    const d = Math.max(w, h);
    x -= (d - w) / 2; y -= (d - h) / 2; w = h = d; radius = d / 2;
  } else {
    radius = Math.min(radius + pad, h / 2);
  }
  const put = (node, left, top, width, height) => Object.assign(node.style, {
    left: `${left}px`, top: `${top}px`, width: `${Math.max(0, width)}px`, height: `${Math.max(0, height)}px` });
  const [top, bottom, left, right, hole] = layer.querySelectorAll('.cm-block');
  put(top, 0, 0, W, y);
  put(bottom, 0, y + h, W, H - y - h);
  put(left, 0, y, x, h);
  put(right, x + w, y, W - x - w, h);
  put(hole, x, y, w, h);
  hole.hidden = !step.look;
  const spot = $('.cm-spot', layer);
  put(spot, x, y, w, h);
  spot.style.borderRadius = `${radius}px`;

  // The words go where there is room: below a thing in the top half, above
  // one lower down, with the arrow pointing at its middle. A thing inside
  // the banner has them outside it, so they cover nothing it says.
  const bubble = $('.cm-bubble', layer);
  const bw = bubble.offsetWidth, bh = bubble.offsetHeight, gap = 14;
  const around = step.anchor && coachFind(step.anchor);
  let ay = y, ah = h;
  if (around) {
    const a = around.getBoundingClientRect();
    ay = Math.min(y, (a.top - box.top) / k - 4);
    ah = Math.max(y + h, (a.bottom - box.top) / k + 4) - ay;
  }
  const safeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-top')) || 54;
  const roomBelow = H - (ay + ah) - gap - 30, roomAbove = ay - gap - safeTop;
  const below = (ay + ah / 2 < H * 0.5 && roomBelow >= bh) || roomAbove < bh;
  const cx = x + w / 2;
  const bx = Math.min(Math.max(cx - bw / 2, 16), W - 16 - bw);
  bubble.style.left = `${bx}px`;
  bubble.style.top = `${below ? ay + ah + gap : ay - gap - bh}px`;
  bubble.classList.toggle('below', below);
  $('.cm-arrow', layer).style.left = `${Math.min(Math.max(cx - bx - 7, 20), bw - 34)}px`;
}

// The tips' own buttons; and a tap on the highlighted thing moves them on
// after the thing has done what it does.
document.addEventListener('click', (event) => {
  if (!coach) return;
  const button = event.target.closest('[data-cm]');
  if (button) {
    event.stopPropagation();
    if (button.dataset.cm === 'skip') endTour(); else nextStep();
    return;
  }
  const el = coachFind(coach.steps[coach.i].target);
  if (el && el.contains(event.target)) setTimeout(nextStep, 0);
}, true);
document.addEventListener('keydown', (event) => { if (coach && event.key === 'Escape') endTour(); });

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
    failVoice(surface, 'Balso atpažinimas nepasiekiamas.', true);
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
    // Silence or a dropped line is worth another try; the rest (inside the
    // Expo Go shell the web view may not be allowed to listen) is not.
    failVoice(surface, message, !['no-speech', 'network'].includes(event.error));
  };
  r.onend = () => { if (!finished && !stale()) { state.listening = null; recognition = null; renderAll(); } };
  recognition = r;
  state.listening = surface;
  state.pendingVoice = onText;
  try { r.start(); } catch { recognition = null; failVoice(surface, 'Balso atpažinimas nepasiekiamas.', true); }
  renderAll();
}

/* On the lock screen the question stays up with the reason under it, and
   the banner offers writing instead: see activityContent. In the app, when
   there is no listening to be had, the search field opens for typing (still
   inside the tap when recognition is missing, so a phone shows its keyboard). */
function failVoice(surface, message, typeInstead = false) {
  if (surface === 'lock' && state.banner && ['ask', 'askTime'].includes(state.banner.stage)) {
    state.banner = { ...state.banner, problem: message };
  } else if (surface === 'lock') {
    state.banner = { stage: 'ask', problem: message };
  } else if (typeInstead && currentScreen().name === 'home') {
    toast(`${message} Parašyk, kur keliauji.`);
    state.searchActive = true;
    renderApp();
    const field = inPage('#search');
    if (field) field.focus({ preventScroll: true });
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
      if (plan.cross_city && !plan.options.some((o) => !o.walk_only)) {
        state.banner = { stage: 'error', code: 'cross-city', city: plan.to_city, place,
          message: `${place.name} yra ${cityIn(plan.to_city)}`,
          detail: `Planuoju keliones mieste, o tu esi ${cityIn(plan.from_city)}.`, retry: 'ask' };
        renderAll();
        return;
      }
      if ((!plan.from_city || !plan.to_city) && !plan.options.some((o) => !o.walk_only)) {
        state.banner = { stage: 'error', message: plan.from_city ? `${place.name}: už miesto ribų` : 'Tu esi už miesto ribų',
          detail: `Planuoju keliones ${AREA}.`, retry: 'ask' };
        renderAll();
        return;
      }
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
        ? { stage: 'error', message: 'Nežinau, iš kur keliauji.', detail: `Pasirink vietą arba leisk ${say('programėlei', 'naršyklei')} ją nustatyti.`, code: e.code, retry: 'ask' }
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
  settings: () => actions.tab({ dataset: { tab: 'settings' } }),
  /* A tab is a root: its screen alone in the stack, cross-faded in. */
  tab: (el) => {
    const name = el.dataset.tab;
    if (state.stack.length === 1 && currentScreen().name === name) {
      const scroller = inPage('.content'); if (scroller) scroller.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (name === 'map') state.mapSel = null;
    state.searchActive = false;
    state.stack = [name === 'home' ? HOME() : { name, id: uid(), depth: 1 }];
    renderApp();
  },
  'trip-prefs': () => push({ name: 'prefs' }),
  'time-sheet': () => { state.sheet = timeSheetHtml(); renderOverlay(); settleWheels(); },
  'time-done': () => {
    state.sheet = null; renderOverlay();
    if (currentScreen().name === 'results') runPlan(); else renderApp();
  },
  'toggle-board': (el) => {
    state.openBoards = state.openBoards || {};
    state.openBoards[el.dataset.board] = !state.openBoards[el.dataset.board];
    refreshHome();
  },
  'open-trip': () => {
    if (!state.trip) return;
    state.selected = state.trip.planned || state.trip.option; state.destination = state.trip.place; state.openStops = {};
    push({ name: 'detail' });
  },
  'trip-fit': () => fitTrip(true),
  'draft-walk': () => { state.draft.walk = state.draft.walk === 'long' ? 'normal' : 'long'; renderApp(); },
  'native-diagnostics': () => shellPost({ type: 'native', screen: 'diagnostics' }),
  'test-panel': () => openPanel(),
  guide: () => { state.guidePage = 0; push({ name: 'guide' }); },
  'guide-next': () => {
    const page = state.guidePage || 0;
    if (page < GUIDE.length - 1) guideTo(page + 1); else actions['guide-done']();
  },
  'guide-done': () => {
    store.set('guideSeen', true);
    if (currentScreen().name === 'guide') pop();
  },
  'tips-reset': () => {
    store.set('tips', {});
    Object.keys(coachWait).forEach((name) => delete coachWait[name]);
    toast('Patarimai bus rodomi iš naujo');
  },
  map: () => actions.tab({ dataset: { tab: 'map' } }),
  'map-me': () => { const me = mePoint(); if (bigmap && me) bigmap.flyTo([me.lat, me.lon], 17, { duration: 0.6 }); },
  // The banner's minimap opens the big one, with the trip on it.
  'open-map': () => {
    stopListening();
    state.locked = false; state.islandExpanded = false; state.mapSel = null;
    state.stack = [HOME(), { name: 'map', id: uid() }];
    renderAll();
  },
  'map-go': () => {
    const sel = state.mapSel;
    if (!sel) return;
    const place = sel.kind === 'stop'
      ? { name: sel.stop.name, subtitle: 'Stotelė', lat: sel.stop.lat, lon: sel.stop.lon }
      : { name: sel.name || 'Pažymėta vieta', subtitle: '', lat: sel.lat, lon: sel.lon };
    openDestination(place);
  },
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
    state.prefs = { priority: state.draft.priority, walk: state.draft.walk };
    state.draft = null; save();
    // Then what the banner does, before the first trip needs it.
    state.guidePage = 0;
    state.stack = [HOME(), { name: 'guide', id: uid() }];
    renderAll();
  },
  pref: (el) => { state.prefs[el.dataset.pref] = el.dataset.value; save(); renderApp(); },
  reset: () => {
    if (!confirm(`Ištrinti nustatymus, vietas ir istoriją ${say('šiame telefone', 'šioje naršyklėje')}?`)) return;
    Object.assign(state, { prefs: null, places: [], visits: {}, dismissed: [], originChoice: 'gps', stack: [HOME()] });
    store.set('lockButtonUsed', false);
    save(); endTrip();
  },

  'time-mode': (el) => {
    state.timeMode = el.dataset.mode;
    if (state.timeMode !== 'now' && !state.timeValue) state.timeValue = hm(new Date(now().getTime() + 30 * 60_000));
    if (state.sheet) { state.sheet = timeSheetHtml(); renderOverlay(); settleWheels(); } else renderApp();
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
  'origin-city': (el) => chooseCity(el.dataset.city),
  'banner-city': () => {
    const b = state.banner;
    chooseCity(b.city);
    if (b.place) planAndGo(b.place, 'now', null, 'lock');
  },
  'origin-gps': () => { state.originChoice = 'gps'; save(); pop(); fillOrigins(); },
  'origin-place': (el) => { state.originChoice = el.dataset.id; save(); pop(); fillOrigins(); },
  'delete-place': (el) => {
    state.places = state.places.filter((p) => p.id !== el.dataset.id);
    if (state.originChoice === el.dataset.id) state.originChoice = 'gps';
    save(); renderApp(); fillOrigins();
  },
  'open-option': (el) => {
    const option = state.plan.options[Number(el.dataset.index)];
    state.selected = option; state.openStops = {};
    push({ name: 'detail' });
    fetchWalks(option).then(() => { if (state.selected === option && currentScreen().name === 'detail') drawMap(); });
  },
  'toggle-stops': (el) => { const i = el.dataset.index; state.openStops[i] = !state.openStops[i]; renderApp(); },
  'go-option': (el) => {
    const option = state.plan && state.plan.options[Number(el.dataset.index)];
    if (!option) return;
    startTrip(option, state.destination);
    // Unlocking later shows the trip under way, not the list it came from.
    state.selected = option; state.openStops = {};
    state.stack = [HOME(), { name: 'detail', id: uid() }];
    toast('Kelionė pradėta');
    setTimeout(() => { state.locked = true; renderAll(); }, 700);
  },
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
      state.selected = state.trip.planned || state.trip.option; state.destination = state.trip.place; state.openStops = {};
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
  // The search opens by itself too: a phone may not let a script focus the
  // field outside the tap (no keyboard), and the field must still be there.
  'banner-open-search': () => { stopListening(); state.banner = null; state.locked = false; state.stack = [HOME()]; state.searchActive = true; renderAll(); setTimeout(() => { const s = inPage('#search'); if (s) s.focus(); }, 50); },
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
  'trip-replan': () => replanTrip(),
  palette: (el) => {
    state.palette = el.dataset.id;
    store.set('palette', state.palette);
    applyPalette();
    renderAll();
  },
  'trip-done': () => {
    const trip = state.trip;
    const place = trip.place;
    const key = placeKey(place);
    const known = state.places.some((p) => Math.abs(p.lat - place.lat) < 0.0015 && Math.abs(p.lon - place.lon) < 0.0015);
    state.trip = null;
    store.set('trip', null);
    const visits = state.visits[key];
    const next = !known && visits && visits.count >= 2 && !state.dismissed.includes(key)
      ? { stage: 'suggestSave', name: place.name, key } : null;
    // A moment to land (the peak-end rule: the end is what is remembered).
    state.banner = { stage: 'done', name: place.name, minutes: trip.option.duration_min };
    renderAll();
    setTimeout(() => { if (state.banner && state.banner.stage === 'done') { state.banner = next; renderAll(); } }, 2400);
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
  if (event.key === 'Escape') { state.islandExpanded = false; state.sheet = null; if (SHELL) closePanel(); renderAll(); }
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
  if (SHELL) closePanel();
  if (stacked.matches && window.scrollY > 0) window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}
// Every button there, "Baigti" included, goes back to the phone.
$('.panel').addEventListener('click', (event) => { if (event.target.closest('button')) showPhone(); });

/* In the Expo Go shell there is no desk: the panel is a sheet over the app,
   opened from Settings › Prototipas. */
function panelOpen() { return document.documentElement.classList.contains('panel-open'); }
function openPanel() {
  $('#panel').scrollTop = 0;
  document.documentElement.classList.add('panel-open');
  syncChrome();
}
function closePanel() {
  if (!panelOpen()) return;
  document.documentElement.classList.remove('panel-open');
  syncChrome();
}

$('#speed-buttons').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.speed) {
    setSpeed(Number(button.dataset.speed));
    document.querySelectorAll('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
  }
});
$('#jump-5').addEventListener('click', () => { jumpTo(now().getTime() + 5 * 60_000); renderAll(); });
$('#heading-offset').addEventListener('input', (event) => {
  state.headingOffset = Number(event.target.value);
  $('#heading-value').textContent = state.headingOffset === 0 ? 'žiūri, kur eini' : `pasisukęs ${Math.abs(state.headingOffset)}° ${state.headingOffset < 0 ? 'kairėn' : 'dešinėn'}`;
  renderLock(); renderIsland();
});
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
  root.dataset.theme = themeDark() ? 'light' : 'dark';
  store.set('theme', root.dataset.theme);
  restyleMaps();
  applyAppAccent();
  syncChrome();
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
$('#city-buttons').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-city]');
  if (button) chooseCity(button.dataset.city);
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
  if (state.serverReady) setTimeout(() => { refreshNearby(); refreshPlaceTimes(); }, 0);
  const select = $('#origin-select');
  const options = [['gps', `Tavo vieta (${say('telefonas', 'naršyklė')})`],
    ...(state.cities || []).map((c) => [`city:${c.name}`, `${c.name} · ${c.stop}`]),
    ...state.places.map((p) => [p.id, p.name]), ['__pick', 'Kita vieta…']];
  const cityButtons = $('#city-buttons');
  if (cityButtons) {
    cityButtons.innerHTML = (state.cities || []).map((c) =>
      `<button data-city="${esc(c.name)}" aria-pressed="${state.originChoice === `city:${c.name}`}">${esc(c.name)}</button>`).join('');
  }
  select.innerHTML = options.map(([value, label]) => `<option value="${esc(value)}"${value === state.originChoice ? ' selected' : ''}>${esc(label)}</option>`).join('');
  const from = origin();
  $('#origin-status').textContent = state.originChoice === 'gps'
    ? (state.gps ? say(`Telefono vieta, tikslumas ±${Math.round(state.gps.accuracy)} m.`, `Naršyklės vieta, tikslumas ±${Math.round(state.gps.accuracy)} m. Kompiuteryje ji gali būti netiksli.`)
      : state.locating ? 'Ieškau vietos…' : (state.gpsError ? `${state.gpsError} Pasirink vietą iš sąrašo.` : `Laukiu ${say('telefono', 'naršyklės')} vietos…`))
    : (from ? `${from.lat.toFixed(4)}, ${from.lon.toFixed(4)}` : '');
}

// ------------------------------------------------------------------- start

(function start() {
  const theme = store.get('theme', null);
  if (theme) document.documentElement.dataset.theme = theme;
  applyPalette();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyAppAccent(); syncChrome(); restyleMaps(); });
  // A trip survives a reload, like a Live Activity survives the app quitting.
  const trip = store.get('trip', null);
  if (trip && new Date(trip.option.arrive.iso).getTime() > Date.now() - 2 * 3600_000) {
    const planned = wholeMinutes(mergeWalks(trip.planned || trip.option));
    state.trip = { ...trip, planned, option: planned };
    fetchWalks(planned);
    state.banner = { stage: 'trip' };
  }
  // Once set up, the phone starts locked: the banner is the product, and the
  // app is one swipe away. Not in the Expo Go shell: there the person has
  // just unlocked a real phone to open the app.
  if (state.prefs && !SHELL) state.locked = true;
  fillOrigins();
  renderAll();
  locate(false);
  watchLocation();

  const poll = async () => {
    try {
      const s = await api('/api/status');
      const status = $('#server-status');
      if (s.ready) {
        const built = s.built_at ? new Date(s.built_at) : null;
        state.dataInfo = `${stopsText(s.stops)} · atnaujinta ${built ? built.toLocaleDateString('lt-LT') : '—'}`;
        status.textContent = `Tvarkaraščiai: ${state.dataInfo}`;
        state.serverReady = true;
        api('/api/cities').then((data) => { state.cities = data.cities || []; fillOrigins(); renderAll(); refreshNearby(true); refreshPlaceTimes(true); }).catch(() => {});
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
