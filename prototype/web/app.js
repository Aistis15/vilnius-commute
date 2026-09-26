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
// After "po" Lithuanian wants the genitive: po 1 stotelės, po 5 stotelių.
const stopsAfterText = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'stotelės' : 'stotelių'}`;
const metresText = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`);

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  bus: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14M8 18v2M16 18v2"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="m10 21 2-6 3 3v3M9 11l2.5-3.5 3 1.5 2 3M11.5 7.5 9.5 14"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  location: '<path d="M3 11 21 3l-8 18-2-8-8-2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  house: '<path d="M4 11 12 4l8 7v9H4z"/><path d="M10 20v-5h4v5"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  stop: '<rect x="6" y="3" width="12" height="9" rx="2"/><path d="M12 12v9"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// ------------------------------------------------------------------- clock
//
// The prototype's own clock, so a 30-minute trip can be watched in 30 seconds.

const clock = { base: Date.now(), sim: Date.now(), speed: 1 };
const now = () => new Date(clock.sim + (Date.now() - clock.base) * clock.speed);
function setSpeed(speed) { clock.sim = now().getTime(); clock.base = Date.now(); clock.speed = speed; }
function jumpTo(ms) { clock.sim = ms; clock.base = Date.now(); }

// ------------------------------------------------------------------- state

const state = {
  prefs: store.get('prefs', null),
  places: store.get('places', []),
  visits: store.get('visits', {}),
  dismissed: store.get('dismissed', []),
  originChoice: store.get('originChoice', 'gps'),
  gps: null,
  gpsError: null,
  stack: [{ name: 'home' }],
  query: '',
  results: [],
  timeMode: 'now',
  timeValue: '',
  destination: null,
  plan: null,
  planning: false,
  planError: null,
  selected: null,
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
  if (!from) throw new Error('Nežinau, iš kur keliauji. Pasirink šone, skiltyje „Iš kur keliauji“.');
  const prefs = state.prefs || { priority: 'fastest', walk: 'normal' };
  return api('/api/plan', {
    from: `${from.lat},${from.lon}`, from_name: from.name,
    to: `${place.lat},${place.lon}`, to_name: place.name,
    at: localIso(atFor(mode, time)),
    mode: mode === 'arrive' ? 'arrive' : 'depart',
    priority: prefs.priority, walk: prefs.walk,
  });
}

// -------------------------------------------------------------- navigation

const currentScreen = () => state.stack[state.stack.length - 1];
function push(screen) { state.stack.push(screen); renderApp(); }
function pop() { if (state.stack.length > 1) state.stack.pop(); renderApp(); }
function goHome() { state.stack = [{ name: 'home' }]; renderApp(); }

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

function placeIcon(place) {
  const name = fold(place.name);
  if (name === 'namai') return icon('house');
  if (place.kind === 'stop') return icon('stop');
  if (place.saved) return icon('star');
  return icon('pin');
}

function sameName(a, b) {
  const fa = fold(a), fb = fold(b);
  return fa === fb || (fa.length >= 5 && fb.length >= 5 && fa.slice(0, -2) === fb.slice(0, -2));
}

// ================================================================ app screens

function renderApp() {
  const screen = state.prefs ? currentScreen() : { name: 'onboarding' };
  const app = $('#app');
  const focused = document.activeElement && document.activeElement.id;
  const caret = focused ? document.activeElement.selectionStart : null;

  const view = {
    onboarding: onboardingView, home: homeView, results: resultsView, detail: detailView,
    settings: settingsView, places: placesView, pick: pickView,
  }[screen.name] || homeView;
  app.innerHTML = view(screen);

  if (focused) {
    const again = document.getElementById(focused);
    if (again) { again.focus(); if (caret != null && again.setSelectionRange) again.setSelectionRange(caret, caret); }
  }
  if (screen.name === 'detail') drawMap();
  $('#statusbar').classList.toggle('on-lock', state.locked);
}

function navBar({ back = false, title = '', right = '' } = {}) {
  return `<div class="bar">
    ${back ? `<button class="back" data-action="back">${icon('back')}<span>Atgal</span></button>` : '<span></span>'}
    ${title ? `<span class="title-inline">${esc(title)}</span>` : ''}
    ${right || '<span style="width:36px"></span>'}
  </div>`;
}

function timeControls() {
  const modes = [['now', 'Dabar'], ['arrive', 'Atvykti iki'], ['depart', 'Išvykti']];
  return `<div class="segmented" role="group" aria-label="Kada">
      ${modes.map(([m, label]) => `<button data-action="time-mode" data-mode="${m}" aria-pressed="${state.timeMode === m}">${label}</button>`).join('')}
    </div>
    ${state.timeMode !== 'now' ? `<div class="time-row">
      <input class="time-input" id="time-value" type="time" value="${esc(state.timeValue || hm(new Date(now().getTime() + 30 * 60_000)))}" aria-label="Laikas">
      <span class="footnote" style="margin:0">${state.timeMode === 'arrive' ? 'turi būti vietoje' : 'nori išeiti'}</span>
    </div>` : ''}`;
}

// ---- onboarding: the preferences from the vision, asked once

function onboardingView() {
  const draft = state.draft || (state.draft = { priority: 'fastest', walk: 'normal', step: 0 });
  const choice = (key, value, title, sub) =>
    `<button class="choice" data-action="draft" data-key="${key}" data-value="${value}" aria-pressed="${draft[key] === value}">
       <div class="title">${title}</div><div class="sub">${sub}</div></button>`;
  const steps = [
    `<div class="large">Kaip mėgsti keliauti?</div>
     <p class="footnote" style="margin:0 4px 6px">Visada ieškosiu greičiausio kelio, bet kartais jis reiškia persėdimus ar ilgesnį ėjimą. Pasakyk, kas tau svarbiau.</p>
     ${choice('priority', 'fastest', 'Kuo greičiau', 'Nesvarbu, kiek persėdimų')}
     ${choice('priority', 'single', 'Vienu autobusu, jei įmanoma', 'Mieliau važiuosiu kiek ilgiau be persėdimų')}
     ${choice('priority', 'fewest', 'Kuo mažiau persėdimų', 'Persėsti tik tada, kai kitaip neišeina')}`,
    `<div class="large">Kiek gali paeiti?</div>
     <p class="footnote" style="margin:0 4px 6px">Iki stotelės ir nuo jos. Daugiau ėjimo kartais reiškia greitesnį kelią.</p>
     ${choice('walk', 'short', 'Kuo mažiau', 'Iki 400 m')}
     ${choice('walk', 'normal', 'Įprastai', 'Iki 800 m')}
     ${choice('walk', 'long', 'Galiu ir toliau', 'Iki 1,5 km')}`,
  ];
  return `<div class="nav">${navBar({ back: draft.step > 0 })}</div>
    <div class="content">
      ${steps[draft.step]}
      <div style="margin-top:28px">
        <button class="prominent" data-action="draft-next">${draft.step < steps.length - 1 ? 'Toliau' : 'Pradėti'}</button>
      </div>
      <p class="footnote">Pakeisti galėsi bet kada nustatymuose.</p>
    </div>`;
}

// ---- home: the question, search, your places

function homeView() {
  const from = origin();
  const suggestions = saveSuggestions();
  return `<div class="nav">
      ${navBar({ right: `<button class="icon-button" data-action="settings" aria-label="Nustatymai">${icon('gear')}</button>` })}
      <div class="large">Kur keliausime šiandien?</div>
      <label class="search">
        ${icon('search')}
        <input id="search" type="search" placeholder="Adresas, vieta ar stotelė" value="${esc(state.query)}" autocomplete="off" aria-label="Kur keliausi">
        <button class="mic${state.listening === 'app' ? ' listening' : ''}" data-action="app-mic" aria-label="Sakyk balsu">${icon('mic')}</button>
      </label>
      ${state.listening === 'app' ? `<p class="footnote">Klausau… ${esc(state.interim)}</p>` : ''}
      <div class="time-row">
        <button class="chip" data-action="pick-origin">${icon('location')}<span>Iš: ${esc(from ? from.name : 'pasirink')}</span></button>
      </div>
      ${timeControls()}
    </div>
    <div class="content" id="home-content">${homeContent(suggestions)}</div>`;
}

function homeContent(suggestions) {
  if (state.query.trim().length >= 2) return searchResultsHtml('go');
  const places = state.places.map((p) => `
      <button class="row" data-action="go-place" data-id="${p.id}">
        <span class="lead">${placeIcon({ ...p, saved: true })}</span>
        <span class="main"><div class="title">${esc(p.name)}</div><div class="sub">${esc(p.subtitle || '')}</div></span>
        <span class="trail">${icon('chevron')}</span>
      </button>`).join('');
  return `
    ${suggestions.map((s) => `<div class="section-title"><span>Pasiūlymas</span></div>
      <div class="group"><div class="row plain"><span class="main">
        <div class="title">Dažnai važiuoji į „${esc(s.name)}“</div>
        <div class="sub">Išsaugoti ir pavadinti savaip?</div></span></div>
        <div class="row plain" style="gap:8px">
          <button class="secondary" data-action="save-suggestion" data-key="${esc(s.key)}">Išsaugoti</button>
          <button class="secondary" data-action="dismiss-suggestion" data-key="${esc(s.key)}">Ne</button>
        </div></div>`).join('')}
    <div class="section-title"><span>Tavo vietos</span><button data-action="places">Keisti</button></div>
    <div class="group">
      ${places}
      <button class="row" data-action="add-place"><span class="lead">${icon('plus')}</span><span class="main"><div class="title">Pridėti vietą</div></span></button>
    </div>
    <p class="footnote">Vietų gali būti kiek nori. Ne tik namai ir darbas.</p>
    <div class="section-title"><span>Užrakto ekrane</span></div>
    <div class="group"><button class="row" data-action="lock"><span class="lead">${icon('bus')}</span>
      <span class="main"><div class="title">Užrakinti telefoną</div>
      <div class="sub">Apačioje kairėje — mygtukas, kuris atidaro banerį</div></span></button></div>`;
}

function searchResultsHtml(action) {
  const q = state.query.trim();
  const saved = state.places.filter((p) => fold(p.name).includes(fold(q)) || sameName(p.name, q))
    .map((p) => ({ ...p, saved: true }));
  const items = [...saved, ...state.results.filter((r) => !saved.some((s) => sameName(s.name, r.name)))];
  if (!items.length) {
    return `<p class="footnote">${state.searching ? 'Ieškau…' : `Nieko neradau pagal „${esc(q)}“.`}</p>`;
  }
  return `<div class="group" style="margin-top:12px">${items.map((item, i) => `
    <button class="row" data-action="${action}" data-index="${i}">
      <span class="lead">${placeIcon(item)}</span>
      <span class="main"><div class="title">${esc(item.name)}</div><div class="sub">${esc(item.saved ? 'Tavo vieta' : item.subtitle || '')}</div></span>
    </button>`).join('')}</div>`;
}

let searchTimer;
function onSearchInput(value) {
  state.query = value;
  clearTimeout(searchTimer);
  const container = $('#home-content') || $('#pick-content');
  if (value.trim().length < 2) {
    state.results = [];
    if (container) container.innerHTML = currentScreen().name === 'pick' ? pickContent() : homeContent(saveSuggestions());
    return;
  }
  state.searching = true;
  if (container) container.innerHTML = searchResultsHtml(currentScreen().name === 'pick' ? 'picked' : 'go');
  searchTimer = setTimeout(async () => {
    try {
      const data = await api('/api/search', { q: value });
      if (state.query !== value) return;
      state.results = data.results;
    } catch (e) {
      state.results = [];
      toast(e.message);
    }
    state.searching = false;
    const box = $('#home-content') || $('#pick-content');
    if (box) box.innerHTML = searchResultsHtml(currentScreen().name === 'pick' ? 'picked' : 'go');
  }, 250);
}

function currentItems() {
  const q = state.query.trim();
  const saved = state.places.filter((p) => fold(p.name).includes(fold(q)) || sameName(p.name, q)).map((p) => ({ ...p, saved: true }));
  return [...saved, ...state.results.filter((r) => !saved.some((s) => sameName(s.name, r.name)))];
}

// ---- results

function resultsView() {
  const place = state.destination;
  let body;
  if (state.planning) body = '<p class="footnote">Ieškau maršrutų…</p>';
  else if (state.planError) body = `<p class="footnote error-text">${esc(state.planError)}</p>`;
  else if (state.plan && !state.plan.options.length) body = '<p class="footnote">Maršruto šiuo laiku nerasta. Pabandyk kitą laiką.</p>';
  else if (state.plan) {
    body = state.plan.options.map((o, i) => `
      <button class="option" data-action="open-option" data-index="${i}">
        <div class="top">
          <span class="leave num"><small>Išeik</small>${esc(o.leave.hm)}</span>
          <span class="arrive num">${esc(o.arrive.hm)} · ${o.duration_min} min</span>
        </div>
        <div class="route-line">${routeLine(o)}</div>
        <div class="meta">${o.walk_only ? metresText(o.walk_m) : `${metresText(o.walk_m)} pėsčiomis · ${transfersText(o.transfers)}${o.first_stop ? ` · nuo „${esc(o.first_stop)}“` : ''}`}</div>
        ${o.tags && o.tags.length ? `<div class="tags">${o.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      </button>`).join('');
  } else body = '';
  const from = origin();
  return `<div class="nav">${navBar({ back: true })}
      <div class="large" style="font-size:28px">${esc(place ? place.name : '')}</div>
      <div class="footnote" style="margin:-6px 0 0">Iš: ${esc(from ? from.name : '—')}</div>
      ${timeControls()}
    </div>
    <div class="content">${body}</div>`;
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
  state.query = ''; state.results = [];
  if (currentScreen().name !== 'results') state.stack.push({ name: 'results' });
  runPlan();
}

// ---- detail

function detailView() {
  const o = state.selected;
  if (!o) return homeView();
  const steps = o.legs.map((leg, i) => {
    const last = i === o.legs.length - 1;
    let what;
    if (leg.kind === 'ride') {
      const between = leg.stops.slice(1, -1).map((s) => esc(s.name)).join(' · ');
      what = `<div class="route-line">${badge(leg.route)} <span>→ ${esc(leg.headsign || '')}</span></div>
        <div class="sub">Lipk „${esc(leg.from.name)}“ ${esc(leg.departure.hm)} · išlipk „${esc(leg.to.name)}“ ${esc(leg.arrival.hm)} · ${stopsText(leg.stop_count)}</div>
        ${between ? `<div class="stops">${between}</div>` : ''}`;
    } else {
      const target = leg.to.stop == null ? `iki „${esc(leg.to.name)}“` : (leg.from.name === leg.to.name ? 'į kitą tos pačios stotelės peroną' : `į stotelę „${esc(leg.to.name)}“`);
      what = `<div>Eik ${target}</div><div class="sub">${metresText(leg.metres)} · ${leg.minutes} min</div>`;
    }
    return `<div class="step">
      <div class="t">${esc(leg.departure.hm)}</div>
      <div class="dot"><i></i>${last ? '' : `<b class="${leg.kind === 'walk' ? 'dashed' : ''}"></b>`}</div>
      <div class="what">${what}</div>
    </div>`;
  }).join('') + `<div class="step"><div class="t">${esc(o.arrive.hm)}</div><div class="dot"><i style="background:var(--label)"></i></div>
      <div class="what">Atvyksti į „${esc(state.destination ? state.destination.name : '')}“</div></div>`;

  return `<div class="nav">${navBar({ back: true, title: 'Maršrutas' })}</div>
    <div class="content">
      <div id="map" class="map"></div>
      <div class="option" style="margin-top:12px">
        <div class="top"><span class="leave num"><small>Išeik</small>${esc(o.leave.hm)}</span>
        <span class="arrive num">atvyksi ${esc(o.arrive.hm)} · ${o.duration_min} min</span></div>
        <div class="meta">${metresText(o.walk_m)} pėsčiomis · ${transfersText(o.transfers)}</div>
      </div>
      <div class="timeline">${steps}</div>
      <div class="sticky-bottom"><button class="prominent" data-action="start-trip">Pradėti kelionę</button></div>
    </div>`;
}

let map;
function drawMap() {
  const o = state.selected;
  const el = $('#map');
  if (!o || !el || !window.L) return;
  if (map) { map.remove(); map = null; }
  map = L.map(el, { zoomControl: false, attributionControl: true });
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
    `<button class="row plain" data-action="pref" data-key="${key}" data-value="${value}">
       <span class="main"><div class="title">${title}</div></span><span class="trail">${p[key] === value ? '✓' : ''}</span></button>`;
  return `<div class="nav">${navBar({ back: true })}<div class="large">Nustatymai</div></div>
    <div class="content">
      <div class="section-title"><span>Kaip keliauti</span></div>
      <div class="group">${choice('priority', 'fastest', 'Kuo greičiau')}${choice('priority', 'single', 'Vienu autobusu, jei įmanoma')}${choice('priority', 'fewest', 'Kuo mažiau persėdimų')}</div>
      <div class="section-title"><span>Ėjimas iki stotelės</span></div>
      <div class="group">${choice('walk', 'short', 'Kuo mažiau · iki 400 m')}${choice('walk', 'normal', 'Įprastai · iki 800 m')}${choice('walk', 'long', 'Galiu ir toliau · iki 1,5 km')}</div>
      <div class="section-title"><span>Vietos</span></div>
      <div class="group"><button class="row" data-action="places"><span class="lead">${icon('star')}</span><span class="main"><div class="title">Tavo vietos</div></span><span class="trail">${state.places.length}</span></button></div>
      <div class="section-title"><span>Duomenys</span></div>
      <div class="group"><div class="row plain"><span class="main"><div class="title">Vilniaus tvarkaraščiai</div><div class="sub" id="data-info">${esc(state.dataInfo || '')}</div></span></div></div>
      <div style="margin-top:22px"><button class="secondary" style="width:100%" data-action="reset">Pradėti iš naujo</button></div>
    </div>`;
}

function placesView() {
  const rows = state.places.map((p) => `
    <div class="row">
      <span class="lead">${placeIcon({ ...p, saved: true })}</span>
      <span class="main"><input id="name-${p.id}" data-action="rename" data-id="${p.id}" value="${esc(p.name)}" aria-label="Pavadinimas"
        style="border:0;background:none;font-size:17px;width:100%;outline:0;padding:0"><div class="sub">${esc(p.subtitle || '')}</div></span>
      <button data-action="delete-place" data-id="${p.id}" aria-label="Ištrinti ${esc(p.name)}" style="color:var(--red)">${icon('trash')}</button>
    </div>`).join('');
  return `<div class="nav">${navBar({ back: true })}<div class="large">Tavo vietos</div></div>
    <div class="content">
      <div class="group">${rows || '<div class="row plain"><span class="main"><div class="sub">Dar nėra vietų.</div></span></div>'}
        <button class="row" data-action="add-place"><span class="lead">${icon('plus')}</span><span class="main"><div class="title">Pridėti vietą</div></span></button></div>
      <p class="footnote">Paspausk pavadinimą, kad pakeistum. Pavadinimai gali būti bet kokie: „Mokykla“, „Močiutė“, „Sporto klubas“.</p>
    </div>`;
}

function pickView(screen) {
  return `<div class="nav">${navBar({ back: true })}
      <div class="large" style="font-size:28px">${screen.purpose === 'origin' ? 'Iš kur keliauji?' : 'Nauja vieta'}</div>
      <label class="search">${icon('search')}
        <input id="search" type="search" placeholder="Adresas, vieta ar stotelė" value="${esc(state.query)}" autocomplete="off"></label>
    </div>
    <div class="content" id="pick-content">${state.query.trim().length >= 2 ? searchResultsHtml('picked') : pickContent()}</div>`;
}

function pickContent() {
  if (currentScreen().purpose !== 'origin') return '<p class="footnote">Surask vietą ir duok jai vardą.</p>';
  return `<div class="group" style="margin-top:12px">
      <button class="row" data-action="origin-gps"><span class="lead">${icon('location')}</span>
        <span class="main"><div class="title">Tavo vieta</div><div class="sub">${esc(state.gps ? `Pagal naršyklę, ±${Math.round(state.gps.accuracy)} m` : state.gpsError || 'Naršyklė dar nepateikė vietos')}</div></span></button>
      ${state.places.map((p) => `<button class="row" data-action="origin-place" data-id="${p.id}"><span class="lead">${placeIcon({ ...p, saved: true })}</span>
        <span class="main"><div class="title">${esc(p.name)}</div><div class="sub">${esc(p.subtitle || '')}</div></span></button>`).join('')}
    </div>`;
}

// ---- save suggestions: "you go there often, save it?"

function placeKey(p) { return `${fold(p.name)}@${p.lat.toFixed(3)},${p.lon.toFixed(3)}`; }

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
  state.trip = { option, place, startedAt: now().getTime(), snoozeUntil: 0 };
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
    if (at < t(legs[i].arrival)) return { kind: legs[i].kind, i, leg: legs[i] };
  }
  return { kind: 'arrived' };
}

function minutesUntil(ms, at) { return Math.max(0, Math.ceil((ms - at) / 60_000)); }

/* "12 min", or "9 val. 12 min" once it is over an hour: a bare 552 min is
   a number nobody can read at a glance. Units always attached. */
function durationHtml(minutes) {
  if (minutes < 60) return `${minutes}<small>min</small>`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `${h}<small>val.</small>${m ? ` ${m}<small>min</small>` : ''}`;
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

/* The banner's content for the current moment. Shared by the lock screen and
   the expanded Dynamic Island, like one ActivityConfiguration drawing both. */
function activityContent(where) {
  const b = state.banner;
  if (!b) return '';
  const at = now().getTime();
  const actions = (buttons) => `<div class="actions">${buttons.map(([label, action, primary]) =>
    `<button data-action="${action}"${primary ? ' class="primary"' : ''}>${label}</button>`).join('')}</div>`;
  const dots = '<span class="listening-dots" aria-hidden="true"><i></i><i></i><i></i></span>';

  switch (b.stage) {
    case 'ask':
      return `<div class="question">Kur keliausime šiandien?${state.listening === 'lock' ? dots : ''}</div>
        <div class="heard">${state.interim ? `„${esc(state.interim)}“` : state.listening === 'lock' ? 'Klausau…' : 'Paliesk, kad rašytum'}</div>
        ${actions([['Rašyti', 'banner-open-search'], ['Atšaukti', 'banner-cancel']])}`;
    case 'thinking':
      return `<div class="question">Ieškau maršruto…</div><div class="heard">„${esc(b.heard || '')}“</div>`;
    case 'chooseTime':
      return `<div class="caption">Į</div><div class="question">${esc(b.place.name)}</div>
        <div class="heard">Kada?</div>
        ${actions([['Dabar', 'banner-now', true], ['Planuoti', 'banner-plan']])}`;
    case 'askTime':
      return `<div class="question">Kada turi būti vietoje?${state.listening === 'lock' ? dots : ''}</div>
        <div class="heard">${state.interim ? `„${esc(state.interim)}“` : `${esc(b.place.name)} · pasakyk laiką, pvz., „keturiolika dvidešimt“`}</div>
        ${actions([['Dabar', 'banner-now'], ['Atšaukti', 'banner-cancel']])}`;
    case 'error':
      return `<div class="question" style="font-size:20px">${esc(b.message)}</div>
        ${actions([['Bandyti dar', 'banner-retry', true], ['Atšaukti', 'banner-cancel']])}`;
    case 'saved':
      return `<div class="question" style="font-size:20px">Išsaugota: ${esc(b.name)}</div>`;
    case 'suggestSave':
      return `<div class="question" style="font-size:20px">Dažnai važiuoji į „${esc(b.name)}“. Išsaugoti?</div>
        ${actions([['Išsaugoti', 'banner-save', true], ['Ne', 'banner-nosave']])}`;
    case 'trip':
      return tripContent(at, actions);
    default:
      return '';
  }
}

function tripContent(at, actions) {
  const trip = state.trip;
  if (!trip) return '';
  const o = trip.option;
  const legs = o.legs;
  const phase = phaseOf(trip, at);
  const dest = `<span class="dest">${esc(trip.place.name)} ${esc(o.arrive.hm)}</span>`;
  const row2 = `<div class="row2"><div class="route-line">${routeLine(o, true)}</div>${dest}</div>`;

  if (phase.kind === 'before') {
    const leave = t(legs[0].departure);
    const left = minutesUntil(leave, at);
    return `<div class="top">
        <div><div class="caption">Išeik${dayWord(leave)}</div><div class="big">${esc(o.leave.hm)}</div></div>
        <div style="text-align:right"><div class="caption">Liko</div><div class="big"${left >= 60 ? ' style="font-size:26px"' : ''}>${durationHtml(left)}</div></div>
      </div>${row2}`;
  }

  if (phase.kind === 'arrived') {
    if (trip.snoozeUntil > at) {
      return `<div class="question" style="font-size:20px">${esc(trip.place.name)}</div><div class="heard">Atvykai ${esc(o.arrive.hm)}</div>`;
    }
    return `<div class="question">Ar baigėte kelionę?</div>
      <div class="heard">${esc(trip.place.name)} · ${esc(o.arrive.hm)}</div>
      ${actions([['Taip', 'trip-done', true], ['Dar ne', 'trip-snooze']])}`;
  }

  const leg = phase.leg;
  if (phase.kind === 'ride') {
    const remaining = leg.stops.filter((s) => t(s.time) > at).length;
    const progress = Math.min(1, Math.max(0, (at - t(leg.departure)) / (t(leg.arrival) - t(leg.departure))));
    return `<div class="top">
        <div style="min-width:0"><div class="route-line">${badge(leg.route)} <span class="instruction">→ ${esc(leg.headsign || '')}</span></div>
          <div class="heard">Išlipk „${esc(leg.to.name)}“ · po ${stopsAfterText(Math.max(1, remaining))}</div></div>
        <div style="text-align:right;flex:none"><div class="caption">Išlipk</div><div class="big" style="font-size:28px">${esc(leg.arrival.hm)}</div></div>
      </div>
      <div class="progress"><i style="width:${(progress * 100).toFixed(1)}%"></i></div>`;
  }

  // Walking: to the first stop, between vehicles, or to the destination.
  const last = phase.i === legs.length - 1;
  const ride = nextRide(legs, phase.i + 1);
  const walkLeft = Math.max(0, t(leg.arrival) - at);
  const metresLeft = Math.round(leg.metres * walkLeft / Math.max(1, t(leg.arrival) - t(leg.departure)));
  if (last || !ride) {
    return `<div class="top">
        <div style="min-width:0"><div class="caption">Liko nueiti</div><div class="instruction">${esc(trip.place.name)}</div>
          <div class="heard">${metresText(metresLeft)}</div></div>
        <div style="text-align:right;flex:none"><div class="caption">Atvyksi</div><div class="big" style="font-size:28px">${esc(o.arrive.hm)}</div></div>
      </div>`;
  }
  const busIn = minutesUntil(t(ride.departure), at);
  const title = phase.i === 0 ? 'Eik į stotelę' : 'Persėdimas · eik į stotelę';
  return `<div class="top">
      <div style="min-width:0"><div class="caption">${title}</div><div class="instruction">${esc(leg.to.name)}</div>
        <div class="heard">${metresText(metresLeft)} · ${ride.departure.hm}</div></div>
      <div style="text-align:right;flex:none"><div class="route-line" style="justify-content:flex-end">${badge(ride.route, true)}</div>
        <div class="big" style="font-size:28px">${busIn}<small>min</small></div></div>
    </div>`;
}

function islandCompact() {
  const b = state.banner;
  if (!b) return null;
  const at = now().getTime();
  if (b.stage !== 'trip' || !state.trip) {
    return { left: `<span style="font-size:18px">${icon('mic')}</span>`, right: state.listening ? 'Klausau' : '' };
  }
  const legs = state.trip.option.legs;
  const phase = phaseOf(state.trip, at);
  if (phase.kind === 'before') {
    const ride = nextRide(legs, 0);
    const left = minutesUntil(t(legs[0].departure), at);
    return { left: ride ? badge(ride.route, true) : icon('walk'), right: left >= 60 ? `${Math.floor(left / 60)} val.` : `${left} min` };
  }
  if (phase.kind === 'arrived') return { left: icon('pin'), right: 'Atvykai' };
  if (phase.kind === 'ride') return { left: badge(phase.leg.route, true), right: phase.leg.arrival.hm };
  const ride = nextRide(legs, phase.i + 1);
  return ride
    ? { left: badge(ride.route, true), right: `${minutesUntil(t(ride.departure), at)} min` }
    : { left: `<span style="font-size:18px">${icon('walk')}</span>`, right: state.trip.option.arrive.hm };
}

// ============================================================ lock screen

function renderLock() {
  const lock = $('#lock');
  lock.hidden = !state.locked;
  $('#statusbar').classList.toggle('on-lock', state.locked);
  if (!state.locked) return;
  const d = now();
  // iOS: "Šeštadienis, rugsėjo 26".
  const parts = Object.fromEntries(new Intl.DateTimeFormat('lt-LT', { weekday: 'long', month: 'long', day: 'numeric' })
    .formatToParts(d).map((p) => [p.type, p.value]));
  const date = `${parts.weekday.charAt(0).toUpperCase()}${parts.weekday.slice(1)}, ${parts.month} ${parts.day}`;
  const content = activityContent('lock');
  const html = `
    <div class="date">${esc(date)}</div>
    <div class="clock">${hm(d)}</div>
    <div class="stack">${content ? `<div class="activity" data-action="activity-tap" role="button" aria-label="Kelionės baneris">${content}</div>` : ''}</div>
    <div class="controls">
      <button class="control ours" data-action="lock-button" aria-label="Vilnius · Kur keliausime">${icon('bus')}</button>
      <button class="control" aria-label="Kamera" tabindex="-1">${icon('camera')}</button>
    </div>
    <div class="unlock-hint">Braukite aukštyn arba paspauskite juostelę</div>
    <div class="home-indicator" data-action="unlock" role="button" aria-label="Atrakinti"></div>`;
  if (lock.dataset.html !== html) { lock.innerHTML = html; lock.dataset.html = html; }
}

function renderIsland() {
  const island = $('#island');
  const compact = islandCompact();
  // The island only expands for a trip; a question or a confirmation belongs
  // on the lock screen.
  if (!state.banner || state.banner.stage !== 'trip') state.islandExpanded = false;
  // On the lock screen the banner is already there; the island stays idle,
  // as it does on a real iPhone.
  const showCompact = compact && !state.locked;
  island.classList.toggle('compact', !!showCompact && !state.islandExpanded);
  island.classList.toggle('expanded', !!showCompact && state.islandExpanded);
  const html = showCompact
    ? `<div class="compact-row"><span>${compact.left}</span><span class="compact-right">${esc(compact.right)}</span></div>
       <div class="expanded-body">${activityContent('island')}</div>`
    : '';
  if (island.dataset.html !== html) { island.innerHTML = html; island.dataset.html = html; }
}

function renderOverlay() {
  const overlay = $('#overlay');
  let html = '';
  if (state.sheet) html += state.sheet;
  if (state.toast) html += `<div class="toast">${esc(state.toast)}</div>`;
  overlay.innerHTML = html;
}

function renderClock() {
  const d = now();
  $('#status-time').textContent = hm(d);
  $('#sim-clock').textContent = `${hm(d)}:${pad(d.getSeconds())}`;
}

function renderAll() {
  renderApp(); renderLock(); renderIsland(); renderOverlay(); renderClock();
  $('#toggle-lock').textContent = state.locked ? 'Atrakinti' : 'Užrakinti';
}

setInterval(() => { renderClock(); renderLock(); renderIsland(); }, 250);

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
  if (!Recognition) {
    failVoice(surface, 'Ši naršyklė neatpažįsta balso. Naudok „Balsas be mikrofono“ šone arba Chrome / Edge.');
    return;
  }
  const r = new Recognition();
  r.lang = 'lt-LT';
  r.interimResults = true;
  r.maxAlternatives = 1;
  let finished = false;
  r.onresult = (event) => {
    let text = '', final = false;
    for (const result of event.results) { text += result[0].transcript; if (result.isFinal) final = true; }
    state.interim = text;
    renderAll();
    if (final && !finished) { finished = true; stopListening(); onText(text); }
  };
  r.onerror = (event) => {
    if (finished) return;
    finished = true;
    state.listening = null;
    const message = {
      'not-allowed': 'Naršyklė neleidžia naudoti mikrofono.',
      'no-speech': 'Nieko neišgirdau.',
      'language-not-supported': 'Naršyklė nemoka lietuvių kalbos. Naudok laukelį šone.',
      network: 'Balso atpažinimui reikia interneto.',
    }[event.error] || `Balso klaida: ${event.error}`;
    failVoice(surface, message);
  };
  r.onend = () => { if (!finished) { state.listening = null; renderAll(); } };
  recognition = r;
  state.listening = surface;
  state.pendingVoice = onText;
  try { r.start(); } catch (e) { failVoice(surface, e.message); }
  renderAll();
}

function failVoice(surface, message) {
  if (surface === 'lock') state.banner = { ...state.banner, stage: 'error', message, retry: state.banner && state.banner.stage };
  else toast(message);
  renderAll();
}

async function resolvePlace(parsed) {
  if (parsed.home) {
    const home = state.places.find((p) => ['namai', 'namo'].includes(fold(p.name)));
    if (!home) throw new Error('Dar neišsaugojai vietos „Namai“.');
    return home;
  }
  for (const candidate of parsed.candidates.length ? parsed.candidates : [parsed.destination]) {
    const saved = state.places.find((p) => sameName(p.name, candidate));
    if (saved) return saved;
  }
  for (const candidate of parsed.candidates.length ? parsed.candidates : [parsed.destination]) {
    const data = await api('/api/search', { q: candidate });
    if (data.results.length) return data.results[0];
  }
  return null;
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
    const place = await resolvePlace(parsed);
    if (!place) return fail(`Neradau „${parsed.destination}“.`);
    if (parsed.time) return planAndGo(place, parsed.mode || 'arrive', parsed.time, surface);
    if (parsed.now) return planAndGo(place, 'now', null, surface);
    if (onLock) { state.banner = { stage: 'chooseTime', place }; renderAll(); return; }
    state.destination = place;
    state.sheet = `<div class="sheet-backdrop" data-action="close-sheet"><div class="sheet" data-stop="1">
        <h3>${esc(place.name)}</h3><p>Kada keliausi?</p>
        <div class="buttons"><button class="prominent" data-action="sheet-now">Dabar</button>
        <button class="secondary" style="height:52px" data-action="sheet-plan">Planuoti</button></div></div></div>`;
    renderOverlay();
  } catch (e) {
    fail(e.message);
  }
}

async function planAndGo(place, mode, time, surface) {
  if (surface === 'lock') {
    state.banner = { stage: 'thinking', heard: state.interim || place.name, place };
    renderAll();
    try {
      const plan = await planTrip(place, mode, time);
      if (!plan.options.length) throw new Error('Maršruto šiuo laiku nerasta.');
      startTrip(plan.options[0], place);
    } catch (e) {
      state.banner = { stage: 'error', message: e.message, retry: 'ask' };
      renderAll();
    }
    return;
  }
  state.timeMode = mode; state.timeValue = time || '';
  openDestination(place);
}

// ================================================================= events

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  if (event.target.closest('[data-stop]') && target.dataset.action === 'close-sheet' && !event.target.closest('button')) return;
  const action = target.dataset.action;
  const handler = actions[action];
  if (handler) { event.preventDefault(); handler(target, event); }
});

const actions = {
  back: () => { if (!state.prefs && state.draft) { state.draft.step = Math.max(0, state.draft.step - 1); renderApp(); } else pop(); },
  settings: () => push({ name: 'settings' }),
  places: () => push({ name: 'places' }),
  'add-place': () => { state.query = ''; state.results = []; push({ name: 'pick', purpose: 'place' }); },
  'pick-origin': () => { state.query = ''; state.results = []; push({ name: 'pick', purpose: 'origin' }); },
  lock: () => { state.locked = true; renderAll(); },
  unlock: () => { state.locked = false; state.islandExpanded = false; stopListening(); renderAll(); },

  draft: (el) => { state.draft[el.dataset.key] = el.dataset.value; renderApp(); },
  'draft-next': () => {
    if (state.draft.step < 1) { state.draft.step += 1; renderApp(); return; }
    state.prefs = { priority: state.draft.priority, walk: state.draft.walk };
    state.draft = null; save(); goHome();
  },
  pref: (el) => { state.prefs[el.dataset.key] = el.dataset.value; save(); renderApp(); },
  reset: () => {
    if (!confirm('Ištrinti nustatymus, vietas ir istoriją šioje naršyklėje?')) return;
    Object.assign(state, { prefs: null, places: [], visits: {}, dismissed: [], originChoice: 'gps' });
    save(); endTrip(); goHome();
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
      const place = existing || { id: uid(), name: item.name, subtitle: item.subtitle || '', lat: item.lat, lon: item.lon, temporary: true };
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
  'open-option': (el) => { state.selected = state.plan.options[Number(el.dataset.index)]; push({ name: 'detail' }); },
  'start-trip': () => {
    startTrip(state.selected, state.destination);
    toast('Kelionė pradėta');
    setTimeout(() => { state.locked = true; renderAll(); }, 700);
  },
  'save-suggestion': (el) => { const v = state.visits[el.dataset.key]; if (v) askName({ ...v }); },
  'dismiss-suggestion': (el) => { state.dismissed.push(el.dataset.key); save(); renderApp(); },

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
    state.places.push({ id: uid(), name, subtitle: pending.subtitle || pending.name, lat: pending.lat, lon: pending.lon });
    state.pendingPlace = null; state.sheet = null; save(); renderOverlay();
    if (currentScreen().name === 'pick') pop(); else renderApp();
    fillOrigins();
    toast(`Išsaugota: ${name}`);
  },

  // --- lock screen and banner
  'lock-button': () => {
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
      state.selected = state.trip.option; state.destination = state.trip.place;
      state.stack = [{ name: 'home' }, { name: 'detail' }];
    } else {
      if (b && b.stage !== 'trip') state.banner = null;
      state.stack = [{ name: 'home' }];
      setTimeout(() => { const s = $('#search'); if (s) s.focus(); }, 50);
    }
    renderAll();
  },
  'banner-open-search': () => { stopListening(); state.banner = null; state.locked = false; goHome(); renderAll(); setTimeout(() => $('#search') && $('#search').focus(), 50); },
  'banner-cancel': () => { stopListening(); state.banner = state.trip ? { stage: 'trip' } : null; renderAll(); },
  'banner-now': () => { const place = state.banner.place; stopListening(); planAndGo(place, 'now', null, 'lock'); },
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
  state.sheet = `<div class="sheet-backdrop" data-action="close-sheet"><div class="sheet" data-stop="1">
      <h3>Kaip pavadinti?</h3><p>${esc(item.name)}${item.subtitle ? ` · ${esc(item.subtitle)}` : ''}</p>
      <input id="new-name" class="time-input" style="width:100%;height:44px;font-size:17px;margin-bottom:12px" value="${esc(item.name)}" aria-label="Pavadinimas">
      <div class="buttons"><button class="secondary" style="height:52px" data-action="close-sheet">Atšaukti</button>
      <button class="prominent" data-action="confirm-name">Išsaugoti</button></div></div></div>`;
  renderOverlay();
  setTimeout(() => { const i = $('#new-name'); if (i) { i.focus(); i.select(); } }, 30);
}

document.addEventListener('input', (event) => {
  const el = event.target;
  if (el.id === 'search') onSearchInput(el.value);
  if (el.id === 'time-value') { state.timeValue = el.value; }
  if (el.dataset && el.dataset.action === 'rename') {
    const place = state.places.find((p) => p.id === el.dataset.id);
    if (place) { place.name = el.value; save(); fillOrigins(); }
  }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'time-value' && currentScreen().name === 'results') runPlan();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { state.islandExpanded = false; state.sheet = null; renderAll(); }
  if (event.key === 'Enter' && event.target.id === 'new-name') actions['confirm-name']();
  if (event.key === 'Enter' && event.target.id === 'search') {
    const first = currentItems()[0];
    if (first && currentScreen().name === 'home') openDestination(first);
  }
});

// Dynamic Island: tap to expand, tap again to collapse.
$('#island').addEventListener('click', (event) => {
  if (event.target.closest('button')) return;
  if (!state.banner || state.locked) return;
  state.islandExpanded = !state.islandExpanded;
  renderIsland();
});

// Swipe up on the lock screen unlocks, like the real thing.
let swipeStart = null;
$('#lock').addEventListener('pointerdown', (e) => { if (!e.target.closest('button, .activity')) swipeStart = e.clientY; });
$('#lock').addEventListener('pointerup', (e) => {
  if (swipeStart != null && swipeStart - e.clientY > 80) actions.unlock();
  swipeStart = null;
});

// ------------------------------------------------------------------ panel

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
$('#toggle-lock').addEventListener('click', () => {
  state.locked = !state.locked;
  state.islandExpanded = false;
  if (!state.locked) stopListening();
  renderAll();
});
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
    fillOrigins();
    return;
  }
  state.originChoice = event.target.value;
  save(); renderAll(); fillOrigins();
});

function fillOrigins() {
  const select = $('#origin-select');
  const options = [['gps', 'Tavo vieta (naršyklė)'], ...state.places.map((p) => [p.id, p.name]), ['__pick', 'Kita vieta…']];
  select.innerHTML = options.map(([value, label]) => `<option value="${esc(value)}"${value === state.originChoice ? ' selected' : ''}>${esc(label)}</option>`).join('');
  const from = origin();
  $('#origin-status').textContent = state.originChoice === 'gps'
    ? (state.gps ? `Naršyklės vieta, tikslumas ±${Math.round(state.gps.accuracy)} m. Kompiuteryje ji gali būti netiksli.` : (state.gpsError || 'Laukiu naršyklės vietos…'))
    : (from ? `${from.lat.toFixed(4)}, ${from.lon.toFixed(4)}` : '');
}

// ------------------------------------------------------------------- start

(function start() {
  const theme = store.get('theme', null);
  if (theme) document.documentElement.dataset.theme = theme;
  // A trip survives a reload, like a Live Activity survives the app quitting.
  const trip = store.get('trip', null);
  if (trip && new Date(trip.option.arrive.iso).getTime() > Date.now() - 2 * 3600_000) {
    state.trip = trip;
    state.banner = { stage: 'trip' };
  }
  fillOrigins();
  renderAll();

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => { state.gps = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }; fillOrigins(); renderApp(); },
      (err) => { state.gpsError = err.code === 1 ? 'Naršyklė neleido naudoti vietos. Pasirink vietą iš sąrašo.' : 'Vietos nustatyti nepavyko. Pasirink vietą iš sąrašo.'; fillOrigins(); },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  } else {
    state.gpsError = 'Naršyklė nepateikia vietos. Pasirink vietą iš sąrašo.';
  }

  const poll = async () => {
    try {
      const s = await api('/api/status');
      const status = $('#server-status');
      if (s.ready) {
        const built = s.built_at ? new Date(s.built_at) : null;
        state.dataInfo = `${s.stops} stotelių · atnaujinta ${built ? built.toLocaleDateString('lt-LT') : '—'}`;
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
