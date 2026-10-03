// The axe scan replica-test asks for on every screen, light and dark.
// Violations are written to a11y-<screen>.json for replica/bugs.md.
import AxeBuilder from '@axe-core/playwright';
import fs from 'fs';
import path from 'path';
import { test, expect, pastOnboarding, tipsSeen, at, guardSearch } from './fixtures';

async function scan(page, name: string) {
  const result = await new AxeBuilder({ page }).include('#app').analyze();
  const summary = result.violations.map((v) => ({
    id: v.id, impact: v.impact, help: v.help, count: v.nodes.length,
    targets: v.nodes.slice(0, 6).map((n) => n.target.join(' ')),
    sample: v.nodes[0]?.failureSummary?.split('\n').slice(0, 3).join(' '),
  }));
  // Contrast axe could not decide (text over translucent or blurred layers).
  const unsure = result.incomplete.filter((v) => v.id === 'color-contrast')
    .flatMap((v) => v.nodes.map((n) => ({ target: n.target.join(' '), why: (n.any[0]?.message || '').slice(0, 160) })));
  fs.writeFileSync(path.join(__dirname, `a11y-${name}.incomplete.json`), JSON.stringify(unsure, null, 2));
  fs.writeFileSync(path.join(__dirname, `a11y-${name}.json`), JSON.stringify(summary, null, 2));
  return summary;
}

const screens: [string, (page) => Promise<void>][] = [
  ['home', async () => {}],
  ['results', async (page) => {
    await guardSearch(page); // around BUG-001
    await page.locator('#app').getByRole('searchbox', { name: 'Kur keliauji' }).fill('Žaliasis tiltas');
    await page.locator('#app').getByRole('button', { name: /^Žaliasis tiltas Stotelė/ }).click();
    await expect(page.locator('#app').getByRole('button', { name: /^Atvyksi anksčiausiai/ })).toBeVisible();
  }],
  ['settings', async (page) => {
    await page.locator('#app').getByRole('button', { name: 'Nustatymai' }).click();
    await expect(page.locator('#app').getByRole('button', { name: /Kelionės nuostatos/ })).toBeVisible();
  }],
];

for (const theme of ['light', 'dark'] as const) {
  for (const [name, open] of screens) {
    test(`A11Y ${name} (${theme})`, async ({ page, errors }) => {
      test.fail(!process.env.RAW && name === 'home', 'BUG-003: the add-place tile is a button with role listitem');
      await page.emulateMedia({ colorScheme: theme });
      await at(page); await tipsSeen(page); await pastOnboarding(page);
      await open(page);
      await page.waitForTimeout(800); // entrances finish before the scan
      const violations = await scan(page, `${name}-${theme}`);
      expect(violations).toEqual([]);
    });
  }
}
