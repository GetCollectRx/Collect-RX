/**
 * P7-01 — E2E happy path: sign in and land on dashboard.
 * E2E_USER_EMAIL / E2E_USER_PASSWORD are seeded by e2e/globalSetup.ts when unset.
 * Includes WCAG A/AA accessibility checks via axe-core.
 */
import { test, expect } from '@playwright/test';
import { injectAxe, checkA11y } from '@axe-core/playwright';
import { signInAsE2eUser } from './helpers/signIn';

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD || 'changeme';

test('login page is accessible (WCAG A/AA)', async ({ page }) => {
  await page.goto('/');
  await injectAxe(page);
  await checkA11y(page, null, {
    detailedReport: true,
    detailedReportOptions: {
      html: true,
    },
  });
});

test('sees dashboard after sign-in', async ({ page }) => {
  test.skip(!email, 'E2E_USER_EMAIL missing — check DATABASE_URL for e2e auto-seed');

  await signInAsE2eUser(page, email!, password);
  await expect(page.getByText('Command center', { exact: true })).toBeVisible();
});

test('dashboard is accessible (WCAG A/AA)', async ({ page }) => {
  test.skip(!email, 'E2E_USER_EMAIL missing — check DATABASE_URL for e2e auto-seed');

  await signInAsE2eUser(page, email!, password);
  await expect(page.getByText('Command center', { exact: true })).toBeVisible();

  await injectAxe(page);
  await checkA11y(page, null, {
    detailedReport: true,
    detailedReportOptions: {
      html: true,
    },
  });
});
