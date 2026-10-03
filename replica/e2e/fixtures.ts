// Test harness for the prototype in a sandbox with no CDN access: the map
// libraries the page loads from cdn.jsdelivr.net are served from this
// folder's node_modules (same versions), map tiles are answered empty, and
// console errors, page errors and 5xx responses fail the test.
import { test as base, expect, Page } from '@playwright/test';
import path from 'path';

const LOCAL: Record<string, string> = {
  'leaflet@1.9.4/dist/leaflet.css': 'leaflet/dist/leaflet.css',
  'leaflet@1.9.4/dist/leaflet.js': 'leaflet/dist/leaflet.js',
  'maplibre-gl@5.24.0/dist/maplibre-gl.css': 'maplibre-gl/dist/maplibre-gl.css',
  'maplibre-gl@5.24.0/dist/maplibre-gl.js': 'maplibre-gl/dist/maplibre-gl.js',
  '@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js': '@maplibre/maplibre-gl-leaflet/leaflet-maplibre-gl.js',
};

export async function serveCdnLocally(page: Page) {
  await page.route('https://cdn.jsdelivr.net/npm/**', (route) => {
    const key = route.request().url().split('/npm/')[1];
    const file = LOCAL[key];
    if (!file) return route.abort();
    return route.fulfill({ path: path.join(__dirname, 'node_modules', file) });
  });
  // No tiles in the sandbox: a valid empty TileJSON, then empty tiles, so
  // nothing waits on a dead tunnel and MapLibre has nothing to complain about.
  await page.route('https://tiles.openfreemap.org/planet', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ tilejson: '2.2.0', tiles: ['https://tiles.openfreemap.org/empty/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 }),
  }));
  await page.route(/tile\.openstreetmap\.org|tiles\.openfreemap\.org\/(empty|fonts)/, (route) => route.fulfill({ status: 204, body: '' }));
}

// Known noise in this sandbox, not the app's fault: outside hosts the
// egress policy blocks (Photon, OSRM, stops.lt live feed through the server).
const SANDBOX_NOISE = [/ERR_TUNNEL_CONNECTION_FAILED/, /Failed to load resource: the server responded with a status of 503/];

export const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !SANDBOX_NOISE.some((r) => r.test(m.text()))) errors.push('console: ' + m.text());
    });
    page.on('pageerror', (e) => errors.push('pageerror: ' + (e.message || String(e))));
    page.on('response', (r) => { if (r.status() >= 500 && r.status() !== 503) errors.push(`${r.status()} on ${r.url()}`); });
    await serveCdnLocally(page);
    await use(errors);
    expect(errors, 'console errors, page errors or 5xx').toEqual([]);
  },
});

export { expect };

// First run asks the travel preferences once; accept the defaults.
// Then the five-page guide to the banner; skip it.
export async function pastOnboarding(page: Page) {
  await page.goto('/');
  const app = page.locator('#app');
  await app.getByRole('button', { name: 'Tęsti' }).click({ timeout: 10_000 });
  await app.getByRole('button', { name: 'Praleisti' }).click({ timeout: 10_000 });
  // Nearby departures load once at start; wait for them so their refresh
  // does not land in the middle of a test (see BUG-001).
  await app.getByRole('heading', { name: 'Šalia tavęs' }).waitFor({ timeout: 15_000 });
}

// The tips tour ("1 iš 2") appears once per screen on first visit; skip it.
export async function skipTips(page: Page) {
  const skip = page.locator('#coachmark').getByRole('button', { name: 'Praleisti' });
  if (await skip.isVisible({ timeout: 1500 }).catch(() => false)) await skip.click();
}

// A weekday morning in Vilnius, with time flowing from there.
export async function at(page: Page, iso = '2026-10-05T08:00:00+03:00') {
  await page.clock.install({ time: new Date(iso) });
  await page.clock.resume();
}

// A rider who has already seen the tips (each test starts on a clean profile).
export async function tipsSeen(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('vc.tips', JSON.stringify({ home: true, results: true })); } catch {}
  });
}

// The one-line fix proposed for BUG-001, applied inside the test page only
// (app.js is untouched): home does not redraw itself over an open search.
// refreshHome is a top-level function in a classic script, so replacing the
// window property changes what every call to it runs.
export async function guardSearch(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    const original = w.refreshHome;
    // eslint-disable-next-line no-undef
    w.refreshHome = function (...args) { if ((0, eval)('state').searchActive) return; return original.apply(this, args); };
  });
}
