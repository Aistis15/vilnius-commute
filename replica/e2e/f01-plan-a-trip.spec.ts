// F01 Plan a trip now (the core loop). Cases from replica/test-plan.md.
import { test, expect, pastOnboarding, tipsSeen, at, guardSearch } from './fixtures';

// Every case but F01-E8 searches with BUG-001's fix applied in the page, so
// each tests what it is for rather than the race.
const searchFor = async (page, text: string, { raw = false } = {}) => {
  if (!raw) await guardSearch(page);
  await page.locator('#app').getByRole('searchbox', { name: 'Kur keliauji' }).fill(text);
};

test.describe('F01 plan a trip now', () => {
  test.beforeEach(async ({ page }) => { await at(page); });

  test('F01-H1 stop search -> options -> start the trip', async ({ page, errors }) => {
    await tipsSeen(page);
    await pastOnboarding(page);
    const app = page.locator('#app');
    await searchFor(page, 'Žaliasis tiltas');
    await app.getByRole('button', { name: /^Žaliasis tiltas Stotelė/ }).click();
    await expect(app.getByRole('heading', { name: 'Žaliasis tiltas', level: 1 })).toBeVisible();
    const best = app.getByRole('button', { name: /^Atvyksi anksčiausiai/ });
    await expect(best).toBeVisible();
    await expect(best).toContainText('6G');
    await expect(best).toContainText('€'); // which ticket, and its price
    await expect(app.getByRole('button', { name: /^Pėsčiomis/ })).toBeVisible();
    await app.getByRole('button', { name: 'Pradėti kelionę' }).click();
    // The trip is on: the island carries it.
    await expect(page.locator('#island')).toContainText(/6G|min/, { timeout: 10_000 });
  });

  test('F01-E1 accent-free typing finds the stop', async ({ page, errors }) => {
    await tipsSeen(page);
    await pastOnboarding(page);
    await searchFor(page, 'zaliasis tiltas');
    await expect(page.locator('#app').getByRole('button', { name: /^Žaliasis tiltas Stotelė/ })).toBeVisible();
  });

  test('F01-E2 very long input', async ({ page, errors }) => {
    await tipsSeen(page);
    await pastOnboarding(page);
    const long = 'Gedimino '.repeat(25);
    await searchFor(page, long);
    // Still usable: the text is kept and the search answers (fuzzy: Gedimino stops).
    await expect(page.locator('#app').getByRole('searchbox', { name: 'Kur keliauji' })).toHaveValue(long);
    await expect(page.locator('#app').getByRole('button', { name: /^Gedimino/ }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('F01-E3 emoji and accents', async ({ page, errors }) => {
    await tipsSeen(page);
    await pastOnboarding(page);
    await searchFor(page, '🚌 Šeškinė ąčęėįšųūž');
    await expect(page.locator('#app').getByRole('searchbox', { name: 'Kur keliauji' })).toHaveValue('🚌 Šeškinė ąčęėįšųūž');
    await page.waitForTimeout(1500);
  });

  test('F01-E4 a trip planned for now is never already missed', async ({ page, errors }) => {
    // 45 s into the minute: a walk "leaving 08:00" would already be late.
    await at(page, '2026-10-05T08:00:45+03:00');
    await tipsSeen(page);
    await pastOnboarding(page);
    await searchFor(page, 'Žaliasis tiltas');
    await page.locator('#app').getByRole('button', { name: /^Žaliasis tiltas Stotelė/ }).click();
    await expect(page.locator('#app').getByRole('button', { name: /^Pėsčiomis/ })).toBeVisible();
    await expect(page.locator('#app')).not.toContainText('Reikėjo išeiti');
  });

  test('F01-E5 back from results returns home, search still there', async ({ page, errors }) => {
    await tipsSeen(page);
    await pastOnboarding(page);
    const app = page.locator('#app');
    await searchFor(page, 'Žaliasis tiltas');
    await app.getByRole('button', { name: /^Žaliasis tiltas Stotelė/ }).click();
    await app.getByRole('button', { name: 'Atgal' }).click();
    await expect(app.getByRole('heading', { name: 'Kur keliausime?' })).toBeVisible();
    await expect(app.getByRole('searchbox', { name: 'Kur keliauji' })).toBeVisible();
  });

  test('F01-E6 phone width: nothing wider than the screen', async ({ page, errors }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await tipsSeen(page);
    await page.goto('/?shell=ios');
    await page.locator('#app').getByRole('button', { name: 'Tęsti' }).click();
    await page.locator('#app').getByRole('button', { name: 'Praleisti' }).click();
    await page.locator('#app').getByRole('heading', { name: 'Šalia tavęs' }).waitFor();
    await searchFor(page, 'Žaliasis tiltas');
    await page.locator('#app').getByRole('button', { name: /^Žaliasis tiltas Stotelė/ }).click();
    await expect(page.locator('#app').getByRole('button', { name: /^Atvyksi anksčiausiai/ })).toBeVisible();
    const wide = await page.evaluate(() => document.scrollingElement!.scrollWidth);
    expect(wide).toBeLessThanOrEqual(390);
  });

  test('F01-N1 address search without internet says so', async ({ page, errors }) => {
    test.fail(!process.env.RAW, 'BUG-002: the rider is told the place does not exist');
    await tipsSeen(page);
    await pastOnboarding(page);
    await searchFor(page, 'Akropolis'); // not a stop name: needs Photon, which is unreachable
    // Wait for the search to answer at all, then check what it says.
    await expect(page.locator('#app')).toContainText(/Nieko neradau|internet|ryš|neprisijung/i, { timeout: 20_000 });
    await expect(page.locator('#app')).toContainText(/internet|ryš|neprisijung/i, { timeout: 1000 });
  });

  test('F01-E7 first-visit tips do not take the search away', async ({ page, errors }) => {
    await pastOnboarding(page); // a first-time rider: tips not seen
    const box = page.locator('#app').getByRole('searchbox', { name: 'Kur keliauji' });
    await box.click();
    await box.pressSequentially('Žaliasis', { delay: 200 }); // 1.6 s of typing
    await page.waitForTimeout(1500);
    await expect(box).toBeFocused();
    await expect(page.locator('#app').getByRole('button', { name: /^Žaliasis tiltas Stotelė/ })).toBeVisible();
  });

  test('F01-E8 search results survive the turn of the minute', async ({ page, errors }) => {
    test.fail(!process.env.RAW, 'BUG-001: refreshHome() redraws home over the open search');
    await at(page, '2026-10-05T08:00:40+03:00');
    await tipsSeen(page);
    await pastOnboarding(page);
    await searchFor(page, 'Žaliasis tiltas', { raw: true });
    const result = page.locator('#app').getByRole('button', { name: /^Žaliasis tiltas Stotelė/ });
    await expect(result).toBeVisible();
    await page.waitForTimeout(22_000); // past 08:01:00
    await expect(page.locator('#app').getByRole('searchbox', { name: 'Kur keliauji' })).toHaveValue('Žaliasis tiltas');
    await expect(result).toBeVisible();
  });

  test('F01-E8b the same, with the proposed one-line fix applied in the page', async ({ page, errors }) => {
    await at(page, '2026-10-05T08:00:40+03:00');
    await tipsSeen(page);
    await pastOnboarding(page);
    await searchFor(page, 'Žaliasis tiltas');
    const result = page.locator('#app').getByRole('button', { name: /^Žaliasis tiltas Stotelė/ });
    await expect(result).toBeVisible();
    await page.waitForTimeout(22_000); // past 08:01:00
    await expect(result).toBeVisible();
  });
});
