import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const e2ePort = new URL(baseURL).port || '3000';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/globalSetup.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'on-first-retry',
  },
  // Requires a prior `npm run build` (Vite → dist-renderer) so SPA routes resolve.
  // Playwright starts Express with COLLECTRX_E2E=1 (rate-limit skip + no fatal exit).
  // If :3000 is busy: E2E_BASE_URL=http://127.0.0.1:3010 npm run e2e
  // To attach to an existing server: E2E_REUSE_SERVER=1 (must have COLLECTRX_E2E=1).
  webServer: {
    command: 'npm run start',
    url: `${baseURL.replace(/\/$/, '')}/api/health`,
    reuseExistingServer: !isCI && process.env.E2E_REUSE_SERVER === '1',
    timeout: 120_000,
    env: { ...process.env, PORT: e2ePort, COLLECTRX_E2E: '1' },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
