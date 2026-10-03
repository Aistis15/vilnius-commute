// F02 arrive by a time (said, not tapped), F03 when does my bus come,
// F04 the map. Cases from replica/test-plan.md.
import { test, expect, pastOnboarding, tipsSeen, at, serveCdnLocally } from './fixtures';

const say = async (page, text: string) => {
  const box = page.getByRole('textbox', { name: 'Tai, ką pasakytum' });
  await box.fill(text);
  await box.press('Enter');
};

test.describe('F02 arrive by a time, said in Lithuanian', () => {
  test.beforeEach(async ({ page }) => { await at(page); await tipsSeen(page); await pastOnboarding(page); });

  test('F02-H1 "Man reikia į Žaliąjį tiltą aštuonios trisdešimt"', async ({ page, errors }) => {
    await say(page, 'Man reikia į Žaliąjį tiltą aštuonios trisdešimt');
    const app = page.locator('#app');
    await expect(app.getByRole('heading', { name: 'Žaliasis tiltas', level: 1 })).toBeVisible();
    await expect(app.getByRole('button', { name: /Kada: Iki 08:30/ })).toBeVisible();
    // Every option arrives by 08:30.
    await expect(app.getByRole('button', { name: /→ \d\d:\d\d/ }).first()).toBeVisible();
    const names = await app.getByRole('button', { name: /→ \d\d:\d\d/ }).evaluateAll((els) => els.map((e) => e.textContent || ''));
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      const arrive = [...n.matchAll(/→ (\d\d):(\d\d)/g)].pop()!;
      expect(+arrive[1] * 60 + +arrive[2], n).toBeLessThanOrEqual(8 * 60 + 30);
    }
  });

  test('F02-E1 the time said as digits', async ({ page, errors }) => {
    await say(page, 'Į Žaliąjį tiltą 8:30');
    await expect(page.locator('#app').getByRole('button', { name: /Kada: Iki 08:30/ })).toBeVisible();
  });
});

test.describe('F03 when does my bus come', () => {
  test('F03-H1 the nearest stop opens its next departures', async ({ page, errors }) => {
    await at(page); await tipsSeen(page); await pastOnboarding(page);
    const stop = page.locator('#app').getByRole('button', { name: /^Karaliaus Mindaugo tiltas/ });
    await stop.click();
    await expect(stop).toHaveAttribute('aria-expanded', 'true');
    // Line, headsign, minutes: at least three departures on a weekday morning.
    await expect(page.locator('#app')).toContainText(/Naujininkai|Guriai|Antakalnis/);
    await expect(page.locator('#app')).toContainText(/\d+ min/);
  });
});

test.describe('F04 the map', () => {
  test('F04-H1 the map tab opens a map with stops', async ({ page, errors }) => {
    await at(page); await tipsSeen(page); await pastOnboarding(page);
    await page.locator('#app').getByRole('button', { name: 'Žemėlapis' }).click();
    await expect(page.locator('#app .leaflet-container').first()).toBeVisible({ timeout: 15_000 });
  });

  test('F04-E1 the map recovers after the map libraries failed once', async ({ page, errors }) => {
    await at(page); await tipsSeen(page);
    // The network is down at start: the idle-time preload of the map fails.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route('https://cdn.jsdelivr.net/npm/**', (r) => r.abort('internetdisconnected'));
    await pastOnboarding(page);
    await page.waitForTimeout(6000); // the preload runs in idle time
    // The network is back.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await serveCdnLocally(page);
    errors.length = 0; // the failed preload is the setup, not the finding
    await page.locator('#app').getByRole('button', { name: 'Žemėlapis' }).click();
    await expect(page.locator('#app .leaflet-container').first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Settings', () => {
  test('S-H1 settings list the places and trip preferences', async ({ page, errors }) => {
    await at(page); await tipsSeen(page); await pastOnboarding(page);
    await page.locator('#app').getByRole('button', { name: 'Nustatymai' }).click();
    await expect(page.locator('#app').getByRole('button', { name: /Mano vietos/ })).toBeVisible();
    await expect(page.locator('#app').getByRole('button', { name: /Kelionės nuostatos/ })).toBeVisible();
  });
});
