import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
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
  webServer: isCI
    ? {
        command: 'npm run start',
        url: `${baseURL.replace(/\/$/, '')}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: { ...process.env, PORT: '3000' },
      }
    : undefined,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
