import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 45_000,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'results.json' }]],
  use: {
    baseURL: process.env.VC_URL || 'http://localhost:8765',
    viewport: { width: 1440, height: 900 },
    locale: 'lt-LT',
    timezoneId: 'Europe/Vilnius',
    // Vilnius Cathedral Square, so "Tavo vieta" is a real place.
    geolocation: { latitude: 54.6858, longitude: 25.2877 },
    permissions: ['geolocation'],
    screenshot: 'only-on-failure',
  },
});
