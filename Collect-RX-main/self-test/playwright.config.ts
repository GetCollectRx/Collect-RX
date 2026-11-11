import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.SELFTEST_BASE_URL ?? 'http://127.0.0.1:3120';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/u,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  outputDir: process.env.SELFTEST_REPORT_DIR ? `${process.env.SELFTEST_REPORT_DIR}/artifacts` : 'report/artifacts',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'off',
    launchOptions: {
      // Set when the Chromium that Playwright wants is not installed (for example a sandbox with its own build).
      executablePath: process.env.SELFTEST_CHROMIUM_PATH || undefined,
      // Browser-level containment: every host except loopback fails to resolve.
      args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost', '--no-sandbox'],
    },
  },
  projects: [{ name: 'self-test', use: { ...devices['Desktop Chrome'] } }],
});
