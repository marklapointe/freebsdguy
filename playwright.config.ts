import { defineConfig, devices } from '@playwright/test';

/**
 * Default: local app (npm run dev / npm start).
 * Point at another host only when you mean to:
 *   MDWEB_BASE_URL=http://192.0.2.10:5173 npm run test:e2e
 *   MDWEB_FREEBSD_HOST=192.0.2.10 npm run docs:shots
 */
const host = process.env.MDWEB_FREEBSD_HOST;
const defaultBase = process.env.MDWEB_BASE_URL
  || (host ? `http://${host}:5173` : 'http://127.0.0.1:5173');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: defaultBase,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
